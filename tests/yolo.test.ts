import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hasYolo, withYolo } from '../src/server/yolo.js';
import { validateWorkerYolo } from '../src/server/agents.js';
import { PROVIDERS } from '../src/server/providers/index.js';
import { claude, claudeBlocked } from '../src/server/providers/claude.js';
import { codex } from '../src/server/providers/codex.js';
import { cursor } from '../src/server/providers/cursor.js';
import { muse } from '../src/server/providers/muse.js';
import { AGENT_PROVIDERS, PROVIDER_META, savedYolo, takesYolo } from '../src/shared/providers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

function scratch(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-yolo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const info = (more: Partial<WorkerInfo> = {}) => ({ id: 'w1', ...more }) as WorkerInfo;

test('the providers with a yolo flag name it, and the rest have none to offer', () => {
  assert.deepEqual(AGENT_PROVIDERS.filter(takesYolo), ['claude', 'codex', 'muse', 'cursor']);
  assert.equal(PROVIDER_META.claude.yolo?.flag, '--dangerously-skip-permissions');
  assert.equal(PROVIDER_META.codex.yolo?.flag, '--dangerously-bypass-approvals-and-sandbox');
  assert.equal(PROVIDER_META.cursor.yolo?.flag, '--force');
  assert.equal(PROVIDER_META.muse.yolo?.flag, '--yolo');
  assert.equal(savedYolo('codex', true), true);
  assert.equal(savedYolo('opencode', true), undefined);
  assert.equal(savedYolo('codex', 'true'), undefined);
});

test('a worker in yolo is checked like its model and effort', () => {
  assert.equal(validateWorkerYolo('agent', 'codex', true), undefined);
  assert.equal(validateWorkerYolo('agent', 'opencode', false), undefined);
  assert.equal(validateWorkerYolo('agent', 'opencode', undefined), undefined);
  assert.match(validateWorkerYolo('agent', 'opencode', true) ?? '', /only be turned on for Claude Code, Codex, Muse or Cursor/);
  assert.match(validateWorkerYolo('agent', 'custom', true) ?? '', /only be turned on/);
  assert.match(validateWorkerYolo('shell', undefined, true) ?? '', /Shell workers/);
  assert.match(validateWorkerYolo('agent', 'claude', 'yes') ?? '', /Invalid yolo/);
});

test('the yolo flag goes on once, ahead of the prompt, whatever --agent-args already says', () => {
  // Off, or on a provider without one: left as it is.
  assert.deepEqual(withYolo(['-a', 'never'], 'codex', false), ['-a', 'never']);
  assert.deepEqual(withYolo(['--x'], 'opencode', true), ['--x']);
  assert.deepEqual(withYolo(['--model', 'm', '--', 'fix it'], 'claude', true), ['--model', 'm', '--dangerously-skip-permissions', '--', 'fix it']);
  // Codex refuses its flag twice, alias or not, and alongside an approval policy.
  assert.deepEqual(withYolo(['--yolo'], 'codex', true), ['--yolo']);
  assert.deepEqual(withYolo(['--dangerously-bypass-approvals-and-sandbox'], 'codex', true), ['--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(withYolo(['-a', 'on-request', '--search', '--ask-for-approval=never'], 'codex', true), ['--search', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(withYolo(['-f'], 'cursor', true), ['-f']);
  // Both of Codex's names at once is still twice: the first one stays.
  assert.deepEqual(withYolo(['--yolo', '--search', '--dangerously-bypass-approvals-and-sandbox'], 'codex', true), ['--yolo', '--search']);
  assert.equal(hasYolo(['--yolo'], 'codex'), true);
  assert.equal(hasYolo(['--', '--yolo'], 'codex'), false);
  assert.equal(hasYolo(['--yolo'], 'opencode'), false);
  // What comes after `--` is the prompt, never read as flags.
  assert.deepEqual(withYolo(['--', '--yolo'], 'codex', true), ['--dangerously-bypass-approvals-and-sandbox', '--', '--yolo']);
});

test('a Claude Code worker in yolo skips permissions, and the bypass warning, on a fresh start and a resume', (t) => {
  const setup = claude.prepare!({ dataDir: scratch(t), dshProfile: 'x' });
  const plain = JSON.parse(readFileSync(setup.settings, 'utf8'));
  const yolo = JSON.parse(readFileSync(setup.yoloSettings, 'utf8'));
  assert.equal(plain.skipDangerousModePermissionPrompt, undefined);
  assert.equal(yolo.skipDangerousModePermissionPrompt, true);
  assert.deepEqual(yolo.hooks, plain.hooks);
  const launch = (more: Partial<WorkerInfo>, extra: { prompt?: string; resumeSessionId?: string; args?: string[]; station?: 'queue' } = {}) =>
    claude.launch({ h: { info: info(more) } as never, args: extra.args ?? [], cwd: '.', setup, ...extra }).args;
  const fresh = launch({ yolo: true, model: 'opus' }, { prompt: 'go' });
  assert.equal(fresh[fresh.indexOf('--settings') + 1], setup.yoloSettings);
  assert.deepEqual(fresh.slice(-4), ['opus', '--dangerously-skip-permissions', '--', 'go']);
  const resumed = launch({ yolo: true }, { resumeSessionId: 's1', args: ['--dangerously-skip-permissions'] });
  assert.deepEqual(resumed.filter((a) => a === '--dangerously-skip-permissions'), ['--dangerously-skip-permissions']);
  assert.deepEqual(resumed.slice(-2), ['--resume', 's1']);
  // The queue agent keeps its tools off, yolo or not.
  const queue = launch({ yolo: true }, { station: 'queue' });
  assert.ok(queue.includes('--disallowedTools') && queue.includes('--dangerously-skip-permissions'));
  const off = launch({});
  assert.equal(off[off.indexOf('--settings') + 1], setup.settings);
  assert.equal(off.includes('--dangerously-skip-permissions'), false);
  // Should the warning show anyway (an older Claude), the desk says what it's waiting on.
  assert.match(claudeBlocked('WARNING: Claude Code running in Bypass Permissions mode', true) ?? '', /Bypass Permissions warning/);
});

test('a Codex worker in yolo bypasses approvals before `resume`, without doubling --agent-args', () => {
  const launch = (more: Partial<WorkerInfo>, args: string[], extra: { prompt?: string; resumeSessionId?: string } = {}) =>
    codex.launch({ h: { info: info(more), state: codex.createState!() } as never, args, cwd: '.', setup: { hook: '/data/hook.cjs' }, ...extra }).args;
  const fresh = launch({ yolo: true, model: 'gpt-5.5' }, ['-a', 'on-request'], { prompt: 'fix it' });
  // The box's flag goes on before the worker's model (see the Codex adapter's launch).
  assert.deepEqual(fresh.slice(0, 3), ['--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.5']);
  assert.equal(fresh.includes('-a'), false);
  assert.deepEqual(fresh.slice(-2), ['--', 'fix it']);
  const resumed = launch({ yolo: true }, ['--yolo'], { resumeSessionId: 'thread-1' });
  assert.deepEqual(resumed.filter((a) => a === '--yolo' || a === '--dangerously-bypass-approvals-and-sandbox'), ['--yolo']);
  assert.ok(resumed.indexOf('--yolo') < resumed.indexOf('resume'));
  assert.deepEqual(resumed.slice(-2), ['resume', 'thread-1']);
  assert.equal(launch({}, []).includes('--dangerously-bypass-approvals-and-sandbox'), false);
});

test('Cursor and Muse workers get their own yolo flag only when hired in yolo', (t) => {
  const cwd = scratch(t);
  const cursorArgs = (more: Partial<WorkerInfo>, args: string[], resumeSessionId?: string) =>
    cursor.launch({ h: { info: info(more) } as never, args, cwd, resumeSessionId, prompt: 'go', setup: { hook: '/data/hook.cjs' } }).args;
  // --agent-args can't give a Cursor worker --force: the office drops it, and puts it back for one in yolo.
  assert.deepEqual(cursorArgs({}, ['--force', '--yolo']), ['--trust', '--', 'go']);
  assert.deepEqual(cursorArgs({ yolo: true }, ['--force']), ['--trust', '--force', '--', 'go']);
  assert.deepEqual(cursorArgs({ yolo: true }, [], 'chat-1'), ['--trust', '--force', '--resume=chat-1', '--', 'go']);
  cursor.exited!({ info: info() } as never, cwd);

  const home = { home: cwd, configHome: cwd, dataHome: cwd, stateHome: cwd, hook: '' };
  const museArgs = (more: Partial<WorkerInfo>, args: string[], resumeSessionId?: string) =>
    muse.launch({ h: { info: info(more) } as never, args, cwd, resumeSessionId, prompt: 'go', setup: home }).args;
  assert.deepEqual(museArgs({}, ['--yolo']), ['--trust-workspace', '--', 'go']);
  assert.deepEqual(museArgs({ yolo: true }, ['--yolo']), ['--trust-workspace', '--yolo', '--', 'go']);
  assert.deepEqual(museArgs({ yolo: true }, [], 's1'), ['--trust-workspace', '--yolo', 'resume', 's1']);
});

test('a provider without a yolo flag never gets one, even when a worker somehow says yolo', (t) => {
  for (const id of ['opencode', 'grok', 'pi'] as const) {
    const adapter = PROVIDERS[id];
    const setup = adapter.prepare?.({ dataDir: scratch(t), dshProfile: 'x' });
    const args = adapter.launch({ h: { info: info({ yolo: true }), state: adapter.createState?.() } as never, args: [], cwd: '.', prompt: 'go', setup }).args;
    for (const meta of Object.values(PROVIDER_META)) if (meta.yolo) assert.equal(args.includes(meta.yolo.flag), false, `${id}: ${meta.yolo.flag}`);
  }
});
