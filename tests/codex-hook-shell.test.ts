import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexHookArgs, writeCodexHook } from '../src/server/codex.js';
import { codex } from '../src/server/providers/codex.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

test('generated hook commands survive the native shell and update the Codex lifecycle', { timeout: 30_000 }, async (t) => {
  // Exercise spaces, literal metacharacters, ASCII and PowerShell's smart quotes in real paths.
  const dir = mkdtempSync(path.join(tmpdir(), "office hook o'brien’s $data & "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = codex.createState!();
  const info = { status: 'starting', kind: 'agent' } as WorkerHandle['info'];
  const h = {
    info, state, emit() {}, persist() {}, scheduleScan() {}, clearTask() {},
    notePrompt() {}, noteTool() {}, setStatus(status) { info.status = status; },
  } as WorkerHandle<typeof state>;
  const errors: unknown[] = [];
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer test-hook-token');
      const url = new URL(req.url!, 'http://localhost');
      assert.equal(url.pathname, '/hooks/codex');
      assert.equal(url.searchParams.get('worker'), 'worker-1');
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const accepted = codex.hook!.handle(h, url.searchParams.get('event')!, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(accepted ? 200 : 401).end();
    } catch (error) {
      errors.push(error);
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const env = {
    ...process.env,
    AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`,
    AGENT_OFFICE_HOOK_TOKEN: 'test-hook-token',
    AGENT_OFFICE_WORKER_ID: 'worker-1',
  };
  const configs = codexHookArgs(writeCodexHook(dir));
  const run = async (event: string, payload: Record<string, unknown> = {}) => {
    const config = configs.find((value) => value.startsWith(`hooks.${event}=`))!;
    const command = JSON.parse(/command=("(?:[^"\\]|\\.)*")/.exec(config)![1]);
    const windows = process.platform === 'win32';
    const file = windows ? path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
    const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
    const child = spawn(file, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
      child.stdin.end(JSON.stringify({ session_id: 'root-1', ...payload }));
    });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, '{}', stderr);
    assert.deepEqual(errors, []);
  };
  await run('SessionStart', { source: 'startup' });
  assert.equal(info.status, 'idle');
  await run('UserPromptSubmit', { prompt: 'fix Windows hooks' });
  assert.equal(info.status, 'working');
  await run('PreToolUse', { tool_name: 'Bash', tool_use_id: 'call-1' });
  await run('PermissionRequest', { tool_name: 'Bash' });
  assert.equal(info.status, 'needs_input');
  await run('PostToolUse', { tool_name: 'Bash', tool_use_id: 'call-1' });
  assert.equal(info.status, 'working');
  await run('Stop');
  assert.equal(info.status, 'done');
  await run('SessionStart', { source: 'resume' });
  await run('UserPromptSubmit', { prompt: 'continue' });
  await run('Interrupt');
  assert.equal(info.status, 'done');
});
