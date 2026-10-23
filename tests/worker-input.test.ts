import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyInput, writeInput, pastePrompt } from '../src/server/workers/input.js';
import { TerminalInput } from '../src/server/workers/terminal-input.js';
import { claude } from '../src/server/providers/claude.js';
import { codex } from '../src/server/providers/codex.js';
import type { SomeAdapter } from '../src/server/providers/types.js';
import type { Worker, WorkerHandle } from '../src/server/workers/types.js';
import * as pty from '@lydell/node-pty';

function fixture(adapter: SomeAdapter) {
  const written: string[] = [];
  const w = { info: { kind:'agent', status:'needs_input', acked:false },
    pty: { write: (data: string) => written.push(data) }, state: adapter.createState?.(), tracker: {},
  } as Worker;
  let updates = 0;
  const h = { info:w.info, state:w.state, tracker:w.tracker, running:true, leftNeedsInputAt:0,
    emit() {}, persist() {}, scheduleScan() {}, clearTask() {}, notePrompt() {}, noteTool() {}, notePr() {},
    setStatus(status) { w.info.status = status; w.info.acked = status !== 'needs_input'; updates++; },
  } as WorkerHandle;
  const write = (data: string) => writeInput(w, data, 'Ada', adapter, () => h);
  return { w, h, written, write, updates: () => updates };
}

test('only submitting or interrupting answers a terminal wait; pasted newlines and editing do not', () => {
  const input = new ReplyInput();
  for (const data of ['yes', 'first\rsecond\r', '\x1b[A', '\x1b[64;2;3M', '\x1b[1;2R', '\n', '\x7f', '\x1b[20', '0~first\r\nsecond', '\r', '\x1b[20', '1~']) {
    assert.equal(input.submitted(data), false, JSON.stringify(data));
  }
  assert.equal(input.submitted('\r'), true);
  assert.equal(input.submitted('\x03'), true);
  assert.equal(input.submitted('\x1b'), false);
  assert.equal(input.submitted('\r'), true, 'Enter still works after sending an Esc');
});

for (const adapter of [claude, codex]) {
  test(`${adapter.id}: a reply clears the wait before the approved tool finishes`, () => {
    const f = fixture(adapter);
    const hook = (event: string, extra = {}) => adapter.hook!.handle(f.h, event, {session_id:'root', ...extra});
    hook('PreToolUse', {tool_name:'Bash', tool_use_id:'approved'});
    hook('PermissionRequest', {tool_name:'Bash'});
    f.write('y');
    f.write('\x1b[B');
    assert.equal(f.w.info.status, 'needs_input', 'editing does not dismiss the question');
    f.write('\r');
    assert.equal(f.w.info.status, 'working');
    assert.equal(f.w.info.acked, true);
    assert.ok(f.h.leftNeedsInputAt > 0);
    assert.ok(f.updates() > 0, 'the reply publishes a status change');
    hook('PreToolUse', {tool_name:'read_file', tool_use_id:'parallel'});
    hook('PostToolUse', {tool_name:'read_file', tool_use_id:'parallel'});
    assert.equal(f.w.info.status, 'working', 'parallel events cannot revive the answered wait');
    hook('PermissionRequest', {tool_name:'Bash'});
    assert.equal(f.w.info.status, 'needs_input', 'a new permission request still raises the alert');
    f.write('\x03');
    assert.equal(f.w.info.status, 'working');
    hook('Stop');
    assert.equal(f.w.info.status, 'done');
  });
}

test('trust/login waits and stopped processes are not cleared by pressing Enter', () => {
  const f = fixture(claude);
  f.w.bootBlocked = true;
  f.write('\r');
  assert.equal(f.w.info.status, 'needs_input');
  f.w.bootBlocked = false;
  f.w.pty = undefined;
  f.write('\r');
  assert.equal(f.w.info.status, 'needs_input');
});

test('Windows paste then Enter waits for the paste burst and preserves subsequent key order', (t) => {
  t.mock.timers.enable({apis:['Date', 'setTimeout']});
  const written: string[] = [];
  const input = new TerminalInput(data => written.push(data), true);
  input.send('Pasted prompt');
  input.send('\r');
  input.send('next');
  assert.deepEqual(written, ['Pasted prompt']);
  t.mock.timers.tick(499);
  assert.equal(written.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(written, ['Pasted prompt', '\r', 'next']);
});

for (const windows of [false, true]) {
  test(`board prompts keep multiline paste separate from Enter (${windows ? 'Windows' : 'POSIX'})`, (t) => {
    t.mock.timers.enable({apis:['Date', 'setTimeout']});
    const written: string[] = [];
    const input = new TerminalInput(data => written.push(data), windows);
    input.paste('first\nsecond');
    input.paste('next request');
    assert.deepEqual(written, ['\x1b[200~first\nsecond\x1b[201~']);
    t.mock.timers.tick(windows ? 500 : 120);
    assert.deepEqual(written, ['\x1b[200~first\nsecond\x1b[201~', '\r', '\x1b[200~next request\x1b[201~']);
    t.mock.timers.tick(windows ? 500 : 120);
    assert.equal(written.at(-1), '\r');
  });
}

test('an Enter scheduled for an old worker process cannot reach its replacement', (t) => {
  t.mock.timers.enable({apis:['Date', 'setTimeout']});
  const f = fixture(claude);
  pastePrompt(f.w, 'old prompt');
  const replacement: string[] = [];
  f.w.pty = {write: data => replacement.push(data)} as Worker['pty'];
  t.mock.timers.tick(500);
  assert.deepEqual(replacement, []);
  assert.deepEqual(f.written, ['\x1b[200~old prompt\x1b[201~']);
});

test('Windows ConPTY delivers a paste and its explicit Enter outside the paste burst', {skip:process.platform !== 'win32', timeout:10_000}, async (t) => {
  const child = pty.spawn(process.execPath, ['-e', `
    process.stdin.setRawMode(true);
    let text = '', last = 0;
    process.stdin.on('data', chunk => {
      for (const ch of chunk.toString()) {
        if (ch === '\\r') {
          process.stdout.write('RESULT:' + JSON.stringify({text, quiet:Date.now()-last}) + ':END');
        } else { text += ch; last = Date.now(); }
      }
    });
    process.stdout.write('INPUT-READY');
  `], {name:'xterm-256color', cols:120, rows:30, cwd:process.cwd(), env:process.env as Record<string,string>});
  t.after(() => child.kill());
  let output = '';
  child.onData(data => { output += data; });
  const until = async (ready: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!ready() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(ready(), 'ConPTY input fixture did not answer');
  };
  await until(() => output.includes('INPUT-READY'));
  const input = new TerminalInput(data => child.write(data), true);
  input.send('pasted PR and queue request');
  input.send('\r');
  await until(() => output.includes(':END'));
  const result = JSON.parse(/RESULT:(.*?):END/.exec(output)![1]);
  assert.equal(result.text, 'pasted PR and queue request');
  assert.ok(result.quiet >= 120, 'the explicit Enter must be outside Codex’s paste suppression window');
});
