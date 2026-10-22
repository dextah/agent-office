import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hasCodexSwitch, withCodexArgs } from '../src/server/codex-args.js';
import { loadConfig } from '../src/server/config.js';
import { codex } from '../src/server/providers/codex.js';

test('--codex-args go after the command line so far, without a switch it already has', () => {
  assert.deepEqual(withCodexArgs([], ['--yolo']), ['--yolo']);
  assert.deepEqual(withCodexArgs(['--model', 'gpt-5.5'], ['--yolo', '-c', 'x=1']), ['--model', 'gpt-5.5', '--yolo', '-c', 'x=1']);
  // --yolo is Codex's own short name for the long flag (PROVIDER_META's yolo): Codex refuses either one twice.
  assert.deepEqual(withCodexArgs(['--yolo'], ['--dangerously-bypass-approvals-and-sandbox']), ['--yolo']);
  assert.deepEqual(withCodexArgs(['--dangerously-bypass-approvals-and-sandbox'], ['--yolo']), ['--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(withCodexArgs(['--search'], ['--search', '--no-alt-screen']), ['--search', '--no-alt-screen']);
  // Options that take a value, and repeatable -c overrides, are all kept.
  assert.deepEqual(withCodexArgs(['-c', 'a=1'], ['-c', 'a=1']), ['-c', 'a=1', '-c', 'a=1']);
  assert.equal(hasCodexSwitch(['--no-alt-screen'], '--no-alt-screen'), true);
  assert.equal(hasCodexSwitch(['-c', '--no-alt-screen'], '-c'), false);
  // The yolo flag is withYolo's to dedupe, not a switch of its own here.
  assert.equal(hasCodexSwitch(['--yolo'], '--yolo'), false);
});

test('--codex-args --yolo drops an approval policy, with its value, from either set of args', () => {
  assert.deepEqual(withCodexArgs(['-a', 'on-request', '--search'], ['--yolo']), ['--search', '--yolo']);
  assert.deepEqual(withCodexArgs(['--ask-for-approval=never'], ['--dangerously-bypass-approvals-and-sandbox']), ['--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(withCodexArgs(['--yolo'], ['--ask-for-approval', 'untrusted', '-c', 'x=1']), ['--yolo', '-c', 'x=1']);
  // Without yolo anywhere, an approval policy stays.
  assert.deepEqual(withCodexArgs(['-a', 'never'], ['--search']), ['-a', 'never', '--search']);
});

function launch(args: string[], extra: string[] | undefined, info: { model?: string; effort?: string; yolo?: boolean } = {}, more: { prompt?: string; resumeSessionId?: string } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-office-codex-args-'));
  try {
    const setup = codex.prepare!({ dataDir, mcpScript: '/office/bin/office-workers.js', dshProfile: 'acp', codexArgs: extra });
    return codex.launch({ h: { info, state: codex.createState!() } as never, args, cwd: dataDir, setup, ...more }).args;
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('a Codex worker runs with --codex-args, fresh and resumed, with the office hooks after them', () => {
  const fresh = launch([], ['--yolo'], {}, { prompt: 'fix it' });
  assert.equal(fresh[0], '--yolo');
  assert.equal(fresh.filter((a) => a.startsWith('hooks.')).length, 7);
  assert.ok(fresh.some((a) => a.startsWith('mcp_servers.agent-office.args=')));
  assert.equal(fresh.filter((a) => a === '--no-alt-screen').length, 1);
  assert.deepEqual(fresh.slice(-2), ['--', 'fix it']);
  // Before the `resume` subcommand, which then takes the session.
  const resumed = launch([], ['--yolo'], { model: 'gpt-5.5' }, { resumeSessionId: 'thread-1' });
  assert.deepEqual(resumed.slice(0, 3), ['--yolo', '--model', 'gpt-5.5']);
  assert.deepEqual(resumed.slice(-2), ['resume', 'thread-1']);
  // Without any, nothing is added.
  assert.equal(launch([], undefined).some((a) => /yolo|bypass/.test(a)), false);
});

test('--codex-args stack on --agent-args when Codex is the default agent, without repeating a switch', () => {
  const args = launch(['--yolo', '--model', 'gpt-6-astra'], ['--dangerously-bypass-approvals-and-sandbox', '--search', '--no-alt-screen']);
  assert.deepEqual(args.slice(0, 4), ['--yolo', '--model', 'gpt-6-astra', '--search']);
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(args.filter((a) => a === '--no-alt-screen').length, 1);
});

test('a Codex worker in yolo gets one bypass flag, whether it came from --agent-args, --codex-args or the box', () => {
  const bypass = (args: string[]) => args.filter((a) => a === '--yolo' || a === '--dangerously-bypass-approvals-and-sandbox').length;
  for (const [agent, extra] of [[[], []], [['--yolo'], []], [[], ['--yolo']], [['--yolo'], ['--dangerously-bypass-approvals-and-sandbox']], [['-a', 'never'], ['--yolo']]] as string[][][]) {
    const fresh = launch(agent, extra, { yolo: true, model: 'gpt-5.5' }, { prompt: 'fix it' });
    assert.equal(bypass(fresh), 1, `${agent} + ${extra}`);
    assert.equal(fresh.includes('-a'), false);
    const resumed = launch(agent, extra, { yolo: true }, { resumeSessionId: 'thread-1' });
    assert.equal(bypass(resumed), 1);
    assert.deepEqual(resumed.slice(-2), ['resume', 'thread-1']);
  }
  // Agent-args, then --codex-args, then the box's flag, then the worker's model.
  assert.deepEqual(launch(['--search'], ['-c', 'x=1'], { yolo: true, model: 'gpt-5.5' }).slice(0, 6), ['--search', '-c', 'x=1', '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.5']);
});

test("a worker's own model replaces a --model in --codex-args", () => {
  const args = launch([], ['-m', 'gpt-6-astra', '--yolo'], { model: 'gpt-5.5', effort: 'high' });
  assert.deepEqual(args.slice(0, 5), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  assert.equal(args.includes('gpt-6-astra'), false);
  // Left on Default, the one in --codex-args stays.
  assert.deepEqual(launch([], ['-m', 'gpt-6-astra']).slice(0, 2), ['-m', 'gpt-6-astra']);
});

function load(t: { after(fn: () => void): void }, env: string | undefined, ...argv: string[]) {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-config-'));
  const previous = process.env.AGENT_OFFICE_CODEX_ARGS;
  const previousAgent = process.env.AGENT_OFFICE_AGENT_ARGS;
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AGENT_OFFICE_CODEX_ARGS;
    else process.env.AGENT_OFFICE_CODEX_ARGS = previous;
    if (previousAgent !== undefined) process.env.AGENT_OFFICE_AGENT_ARGS = previousAgent;
  });
  delete process.env.AGENT_OFFICE_AGENT_ARGS;
  if (env === undefined) delete process.env.AGENT_OFFICE_CODEX_ARGS;
  else process.env.AGENT_OFFICE_CODEX_ARGS = env;
  return loadConfig(['--home', home, '--password', 'x', ...argv]);
}

test("--codex-args and AGENT_OFFICE_CODEX_ARGS set every Codex worker's extra args", (t) => {
  assert.deepEqual(load(t, undefined).codexArgs, []);
  assert.deepEqual(load(t, '--yolo -c "model_verbosity=low"').codexArgs, ['--yolo', '-c', 'model_verbosity=low']);
  // The flag wins over the environment, and takes flags as its value, as --agent-args does.
  const cfg = load(t, '--full-auto', '--codex-args', '--yolo', '--port', '4999');
  assert.deepEqual(cfg.codexArgs, ['--yolo']);
  assert.equal(cfg.port, 4999);
  assert.deepEqual(cfg.agentArgs, []);
});
