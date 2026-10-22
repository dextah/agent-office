import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort } from '../shared/providers.js';

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'Interrupt',
] as const;

export type CodexHookEventName = (typeof CODEX_HOOK_EVENTS)[number];

/** The bounded event shape forwarded to the worker bridge. */
export interface CodexHookEvent {
  sessionId: string;
  event: CodexHookEventName;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  turnId?: string;
  /** Only the server-side metric reader uses this path; never sent to browsers. */
  transcriptPath?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
const EVENT_SET = new Set<string>(CODEX_HOOK_EVENTS);

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate and compact a native Codex hook payload. Transcript paths are passed only to the
 * server-side metric reader; message bodies and other unknown fields are discarded. Events carrying an agent id/type are subagent-scoped and are ignored;
 * Codex reports those hooks with the root session id, so adopting them would corrupt root state.
 */
export function normalizeCodexHook(event: string, payload: unknown): CodexHookEvent | undefined {
  if (!EVENT_SET.has(event) || !isRecord(payload)) return undefined;
  if (hasText(payload.agent_id) || hasText(payload.agent_type)) return undefined;

  const sessionId = bounded(payload.session_id, MAX_ID);
  if (!sessionId) return undefined;
  const result: CodexHookEvent = { sessionId, event: event as CodexHookEventName };

  const transcriptPath = bounded(payload.transcript_path, 4096);
  if (transcriptPath) result.transcriptPath = transcriptPath;
  const turnId = bounded(payload.turn_id, MAX_ID);
  if (turnId) result.turnId = turnId;
  if (event === 'SessionStart') {
    const source = bounded(payload.source, MAX_ID);
    if (source) result.source = source;
  } else if (event === 'UserPromptSubmit') {
    const prompt = bounded(payload.prompt, MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PermissionRequest') {
    const tool = bounded(payload.tool_name, MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(payload.tool_use_id, MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  }
  return result;
}

/** Alias for callers that only need a validity check. */
export function validateCodexHook(event: string, payload: unknown): boolean {
  return !!normalizeCodexHook(event, payload);
}

/**
 * Codex runs hook commands through sh on POSIX and through PowerShell on Windows, where a quoted
 * program path needs the call operator and a single quote is escaped by doubling it (PowerShell
 * also takes typographic single quotes as quotes, so those are doubled too).
 */
export function codexHookCommand(argv: string[], platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `& ${argv.map((value) => `'${value.replace(/['‘-‛]/g, '$&$&')}'`).join(' ')}`;
  return argv.map((value) => `'${value.replaceAll("'", "'\"'\"'")}'`).join(' ');
}

/**
 * Build the CLI config overrides for all lifecycle hooks. The command is encoded as a TOML basic
 * string so paths containing spaces and Windows backslashes remain valid; the command itself is
 * quoted for the shell Codex runs it through.
 */
export function codexHookArgs(hookPath: string, platform: NodeJS.Platform = process.platform): string[] {
  const args: string[] = [];
  for (const event of CODEX_HOOK_EVENTS) {
    const command = codexHookCommand([process.execPath, hookPath, event], platform);
    const config = `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=3}]}]`;
    args.push('-c', config);
  }
  return args;
}

/**
 * A worker's own model and reasoning effort on Codex's command line. Codex takes --model only once,
 * so one the office's --agent-args set gives way to the worker's; the effort is a config override,
 * and the last of those wins.
 */
export function codexModelArgs(args: string[], model?: string, effort?: AgentEffort): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (model && (arg === '-m' || arg === '--model')) i++;
    else if (!model || !(arg.startsWith('--model=') || /^-m./.test(arg))) out.push(arg);
  }
  if (model) out.push('--model', model);
  if (effort) out.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
  return out;
}

/** Write the stable, self-contained helper invoked by Codex's native command hooks. */
export function writeCodexHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-codex-hook.cjs');
  writeFileSync(file, CODEX_HOOK_SOURCE, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** The helper only reads bounded hook stdin and the worker bridge environment. */
export const CODEX_HOOK_SOURCE = String.raw`'use strict';
// Native PostToolUse includes tool output even though the bridge never forwards it.
const MAX = 1024 * 1024;
const EVENTS = new Set(${JSON.stringify(CODEX_HOOK_EVENTS)});
const MAX_ID = 160;
const MAX_TEXT = 20000;
const allowed = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
let finished = false;
// Always return valid, non-controlling JSON, including ignored subagent events and failures.
// A systemMessage makes transport failures visible in Codex without leaking stdin or credentials.
const finish = (error) => {
  if (finished) return;
  finished = true;
  process.stdout.write(JSON.stringify(error ? { systemMessage: 'Agent Office Codex hook: ' + error } : {}));
};
const event = process.argv[2];
let size = 0;
let overflow = false;
const chunks = [];
process.stdin.on('data', (chunk) => {
  if (overflow) return;
  size += chunk.length;
  if (size > MAX) { overflow = true; return; }
  chunks.push(chunk);
});
process.stdin.on('error', () => finish('could not read hook input.'));
process.stdin.on('end', async () => {
  if (overflow) return finish('hook input exceeds 1 MiB; this status update was skipped.');
  if (!EVENTS.has(event)) return finish('unsupported hook event.');
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish('hook input is not valid JSON.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return finish('hook input is not an object.');
  if (hasText(input.agent_id) || hasText(input.agent_type)) return finish();
  const session = allowed(input.session_id, MAX_ID);
  if (!session) return finish('hook input has no valid session id.');
  const body = { session_id: session, hook_event_name: event };
  const source = event === 'SessionStart' ? allowed(input.source, MAX_ID) : undefined;
  const prompt = event === 'UserPromptSubmit' ? allowed(input.prompt, MAX_TEXT) : undefined;
  const tool = event === 'PreToolUse' || event === 'PostToolUse' || event === 'PermissionRequest' ? allowed(input.tool_name, MAX_ID) : undefined;
  const toolUseId = event === 'PreToolUse' || event === 'PostToolUse' || event === 'PermissionRequest' ? allowed(input.tool_use_id, MAX_ID) : undefined;
  const transcript = allowed(input.transcript_path, 4096);
  const turn = allowed(input.turn_id, MAX_ID);
  if (source) body.source = source;
  if (prompt) body.prompt = prompt;
  if (tool) body.tool_name = tool;
  if (toolUseId) body.tool_use_id = toolUseId;
  if (turn) body.turn_id = turn;
  if (transcript) body.transcript_path = transcript;
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!base || !token || !worker) return finish('worker bridge environment is missing. Resume the worker from its Office desk.');
  try {
    const url = new URL('/hooks/codex', base);
    url.searchParams.set('worker', worker);
    url.searchParams.set('event', event);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    // Never forward the server's response body: it is not a hook decision or model context.
    await response.body?.cancel();
    finish(response.ok ? undefined : 'office rejected the status update (HTTP ' + response.status + '). Resume the worker from its Office desk.');
  } catch {
    finish('could not reach the office hook server within 2 seconds. Check that the office is running, then resume the worker.');
  }
});
`;
