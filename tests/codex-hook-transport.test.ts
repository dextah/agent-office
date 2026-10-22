import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeCodexHook } from '../src/server/codex.js';

test('hook failures surface safe warnings, and large tool results still update status', { timeout: 15_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-codex-transport-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = writeCodexHook(dir);
  const received: unknown[] = [];
  let status = 200;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(status).end('private server response');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const bridge = {
    AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`,
    AGENT_OFFICE_HOOK_TOKEN: 'private-token',
    AGENT_OFFICE_WORKER_ID: 'worker-1',
  };
  const run = async (payload: unknown, overrides: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [file, 'PostToolUse'], {
      env: { ...process.env, ...bridge, ...overrides }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
      child.stdin.end(JSON.stringify(payload));
    });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    assert.doesNotMatch(stdout, /private-token|private server response|private tool output/);
    const result = JSON.parse(stdout);
    // Observational hooks never approve, deny, block, or continue an operation.
    assert.ok(Object.keys(result).every((key) => key === 'systemMessage'));
    return result;
  };
  const payload = { session_id: 'thread-1', tool_name: 'Bash', tool_use_id: 'call-1' };
  assert.deepEqual(await run({ ...payload, tool_response: 'private tool output'.repeat(8000) }), {});
  assert.deepEqual(received, [{ ...payload, hook_event_name: 'PostToolUse' }]);
  status = 401;
  assert.match((await run(payload)).systemMessage, /HTTP 401/);
  assert.match((await run(payload, { AGENT_OFFICE_HOOK_TOKEN: '' })).systemMessage, /environment is missing/);
  assert.match((await run(payload, { AGENT_OFFICE_HOOK_URL: 'not a url' })).systemMessage, /could not reach/);
  const before = received.length;
  assert.deepEqual(await run({ ...payload, agent_id: 'child-1' }), {});
  assert.match((await run({ ...payload, tool_response: 'x'.repeat(1024 * 1024) })).systemMessage, /exceeds 1 MiB/);
  assert.equal(received.length, before);
});
