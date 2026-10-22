import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelLines, wheelScrollsHistory, type Wheel } from '../src/client/ui/termscroll.js';

const wheel = (w: Partial<Wheel>): Wheel => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...w });

test('the wheel scrolls the history even when the agent tracks the mouse, on the normal screen', () => {
  assert.equal(wheelScrollsHistory(wheel({}), { alt: false, tracking: true }), true, 'Claude Code or Codex asking for the mouse');
  assert.equal(wheelScrollsHistory(wheel({}), { alt: false, tracking: false }), false, 'xterm.js scrolls it itself');
  assert.equal(wheelScrollsHistory(wheel({ shiftKey: true }), { alt: false, tracking: false }), true, 'Shift+wheel, which xterm.js reads as sideways');
});

test("a full-screen program's own screen keeps the wheel, Shift or not", () => {
  for (const tracking of [true, false]) {
    assert.equal(wheelScrollsHistory(wheel({}), { alt: true, tracking }), false);
    assert.equal(wheelScrollsHistory(wheel({ shiftKey: true }), { alt: true, tracking }), false);
  }
});

test('a mouse wheel notch, a page and a trackpad all come out in lines', () => {
  assert.deepEqual(wheelLines(wheel({ deltaY: -3, deltaMode: 1 }), 16, 40), { lines: -3, carry: 0 });
  assert.deepEqual(wheelLines(wheel({ deltaY: 1, deltaMode: 2 }), 16, 40), { lines: 40, carry: 0 });
  assert.equal(wheelLines(wheel({ deltaY: 120 }), 16, 40).lines, 3, 'a 120px notch is about 3 rows, as xterm.js scrolls');
});

test("a trackpad's small deltas add up rather than getting lost", () => {
  let carry = 0;
  let lines = 0;
  for (let i = 0; i < 10; i++) {
    const step = wheelLines(wheel({ deltaY: -9.6 }), 16, 40, carry);
    carry = step.carry;
    lines += step.lines;
  }
  assert.equal(lines, -2, '96px up is 40px of scroll, at 16px a row');
  assert.ok(Math.abs(carry + 0.5) < 1e-9);
});

test('Shift+wheel that the browser turned sideways still scrolls up and down', () => {
  assert.equal(wheelLines(wheel({ deltaX: -120, shiftKey: true }), 16, 40).lines, -3);
  assert.equal(wheelLines(wheel({ deltaX: -120 }), 16, 40).lines, 0, 'a sideways swipe without Shift is not a scroll');
});
