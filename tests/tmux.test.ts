import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTmuxArgs, tmuxCommand, tmuxShellCommand } from '../src/server/tmux.js';

test('tmux flags are opt-in and office CLI arguments are preserved', () => {
  assert.deepEqual(parseTmuxArgs(['--session', 'second-office', '--detached', '--port', '4700', '--', '--agent-args', '--model opus']), {
    name: 'second-office', detached: true, status: false, help: false,
    officeArgs: ['--port', '4700', '--agent-args', '--model opus'],
  });
  assert.equal(parseTmuxArgs([]).name, 'agent-office');
  assert.throws(() => parseTmuxArgs(['--session', 'bad:name']), /--session needs a name/);
  assert.throws(() => parseTmuxArgs(['--session']), /--session needs a name/);
  assert.throws(() => parseTmuxArgs(['--status', '--detached']), /cannot be combined/);
});

test('tmux command escapes spaces and single quotes without losing CLI args', () => {
  assert.equal(tmuxShellCommand(['/usr/bin/node', '/my dir/cli.js', "--password", "it's secret"]),
    "exec '/usr/bin/node' '/my dir/cli.js' '--password' 'it'\\''s secret'");
});

type Call = { args: string[]; stdio: string };
function fake(codes: number[], env: NodeJS.ProcessEnv = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const runtime = {
    platform: 'linux' as const, env, cwd: '/my projects', node: '/usr/bin/node', execArgv: [] as string[], cli: '/tmp/agent office/cli.js',
    run(args: string[], stdio: 'inherit' | 'ignore') {
      calls.push({ args, stdio });
      const status = codes.shift();
      assert.notEqual(status, undefined, `Unexpected tmux invocation: ${args.join(' ')}`);
      return { status: status! };
    },
    log(message: string) { logs.push(message); },
    error(message: string) { errors.push(message); },
  };
  return { calls, logs, errors, runtime };
}

test('existing tmux session is reattached, not restarted', () => {
  const f = fake([0, 0, 0]);
  assert.equal(tmuxCommand(['--session', 'office-two', '--port', '5000'], f.runtime), 0);
  assert.deepEqual(f.calls.map((c) => c.args.slice(0, 2)), [['-V'], ['has-session', '-t'], ['attach-session', '-t']]);
  assert.deepEqual(f.calls[1].args, ['has-session', '-t', '=office-two']);
  assert.ok(f.logs.some((s) => s.includes('startup options are ignored')));
});

test('new session starts detached before attaching and preserves the launch flags', () => {
  const f = fake([0, 1, 0, 0]);
  assert.equal(tmuxCommand(['--port', '4700', '--password', 'has spaces'], f.runtime), 0);
  assert.deepEqual(f.calls[2].args.slice(0, 6), ['new-session', '-d', '-s', 'agent-office', '-c', '/my projects']);
  assert.equal(f.calls[2].args[6], "exec '/usr/bin/node' '/tmp/agent office/cli.js' '--port' '4700' '--password' 'has spaces'");
  assert.deepEqual(f.calls[3], { args: ['attach-session', '-t', '=agent-office'], stdio: 'inherit' });
});

test('detached launch never attaches, and existing sessions are left running', () => {
  const newSession = fake([0, 1, 0]);
  assert.equal(tmuxCommand(['--detached'], newSession.runtime), 0);
  assert.equal(newSession.calls.length, 3);
  const existing = fake([0, 0]);
  assert.equal(tmuxCommand(['--detached'], existing.runtime), 0);
  assert.equal(existing.calls.length, 2);
});

test('inside tmux the command switches client without nesting or killing the current session', () => {
  const f = fake([0, 0, 0], { TMUX: '/tmp/tmux-1000/default' });
  assert.equal(tmuxCommand([], f.runtime), 0);
  assert.deepEqual(f.calls[2].args, ['switch-client', '-t', '=agent-office']);
});

test('session creation race joins the existing winner', () => {
  const f = fake([0, 1, 1, 0, 0]);
  assert.equal(tmuxCommand([], f.runtime), 0);
  assert.equal(f.calls.filter((c) => c.args[0] === 'new-session').length, 1);
});

test('--status checks but never starts or attaches', () => {
  const f = fake([0, 1]);
  assert.equal(tmuxCommand(['--status'], f.runtime), 1);
  assert.equal(f.calls.length, 2);
  assert.match(f.logs[0], /not running/);
});

test('unavailable tmux and native Windows fail without spawning anything', () => {
  const f = fake([]);
  assert.equal(tmuxCommand([], { ...f.runtime, platform: 'win32' }), 1);
  assert.equal(f.calls.length, 0);
  const missing = fake([1]);
  assert.equal(tmuxCommand([], missing.runtime), 1);
  assert.equal(missing.calls.length, 1);
});
