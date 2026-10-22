import type { Terminal } from '@xterm/xterm';

/** The parts of a wheel event that say how far it scrolls. */
export type Wheel = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>;

/** What the terminal's in, for where a wheel goes. */
export interface ScrollMode {
  /** A full-screen program's own screen (the alternate buffer), which has no scrollback. */
  alt: boolean;
  /** The program asked for the mouse (mouse tracking), so xterm.js would send it the wheel. */
  tracking: boolean;
}

/**
 * Whether a wheel scrolls the terminal's history ourselves rather than going where xterm.js sends
 * it. Left alone, xterm.js hands the wheel to a program that tracks the mouse, even on the normal
 * screen where the history is, so with an agent that turns tracking on the wheel did nothing and
 * the history couldn't be reached. On a full-screen program's own screen (OpenCode, vim) there's
 * no history, so the wheel stays the program's, to scroll its own view. Shift+wheel always means
 * the history: xterm.js reads Shift+wheel as sideways and does nothing with it.
 */
export function wheelScrollsHistory(e: Pick<Wheel, 'shiftKey'>, mode: ScrollMode): boolean {
  if (mode.alt) return false;
  return mode.tracking || e.shiftKey;
}

/**
 * Rows a pixel of wheel scrolls, as a share of a row's height: what xterm.js's own scrolling does
 * (50px for a 120px notch), so a notch is about 3 rows either way and the speed doesn't jump when
 * a program turns mouse tracking on.
 */
const WHEEL_PX = 50 / 120;

/**
 * Lines a wheel event scrolls, with what's left over of a line carried to the next one so a
 * trackpad's many small deltas add up. Shift+wheel comes through sideways on Windows and Linux
 * (deltaX), so that counts too.
 */
export function wheelLines(e: Wheel, cellPx: number, rows: number, carry = 0): { lines: number; carry: number } {
  const delta = e.deltaY || (e.shiftKey ? e.deltaX : 0);
  const raw = e.deltaMode === 1 ? delta : e.deltaMode === 2 ? delta * rows : (delta * WHEEL_PX) / Math.max(1, cellPx);
  const total = carry + raw;
  const lines = Math.trunc(total);
  return { lines, carry: total - lines };
}

/** How far (px) a finger moves before it's scrolling rather than tapping. */
const TOUCH_SLOP = 8;

/** The height of one of the terminal's rows on screen, px. */
function cellHeight(term: Terminal): number {
  const screen = term.element?.querySelector('.xterm-screen');
  return (screen?.clientHeight || 0) / Math.max(1, term.rows) || 16;
}

/**
 * Makes the history in a terminal reachable however you scroll: a mouse wheel or trackpad even
 * when the program tracks the mouse, Shift+wheel always, and a finger dragged up and down (xterm.js
 * has no touch scrolling of its own). On a full-screen program's own screen the drag goes to the
 * program as a wheel, the way a mouse wheel would.
 */
export function attachScrolling(term: Terminal, host: HTMLElement): () => void {
  const mode = (): ScrollMode => ({ alt: term.buffer.active.type === 'alternate', tracking: term.modes.mouseTrackingMode !== 'none' });
  let carry = 0;
  term.attachCustomWheelEventHandler((e) => {
    if (!wheelScrollsHistory(e, mode())) return true;
    e.preventDefault();
    const step = wheelLines(e, cellHeight(term), term.rows, carry);
    carry = step.carry;
    if (step.lines) term.scrollLines(step.lines);
    return false;
  });

  let touch: { id: number; y: number; moved: boolean } | null = null;
  const start = (e: TouchEvent) => {
    const t = e.touches.length === 1 ? e.touches[0] : undefined;
    touch = t ? { id: t.identifier, y: t.clientY, moved: false } : null;
  };
  const move = (e: TouchEvent) => {
    const t = touch && [...e.changedTouches].find((c) => c.identifier === touch!.id);
    if (!touch || !t) return;
    const dy = touch.y - t.clientY;
    if (!touch.moved && Math.abs(dy) < TOUCH_SLOP) return;
    touch.moved = true;
    e.preventDefault();
    const px = cellHeight(term);
    const lines = Math.trunc(dy / px);
    if (!lines) return;
    touch.y -= lines * px;
    if (!mode().alt) return term.scrollLines(lines);
    // The program's own screen: as the wheel, which xterm.js sends it as mouse or arrow keys.
    const screen = term.element?.querySelector('.xterm-screen');
    const r = screen?.getBoundingClientRect();
    screen?.dispatchEvent(new WheelEvent('wheel', { deltaY: lines, deltaMode: 1, clientX: r ? r.left + r.width / 2 : 0, clientY: t.clientY, bubbles: true, cancelable: true }));
  };
  const end = () => (touch = null);
  host.addEventListener('touchstart', start, { passive: true });
  host.addEventListener('touchmove', move, { passive: false });
  host.addEventListener('touchend', end);
  host.addEventListener('touchcancel', end);
  return () => {
    host.removeEventListener('touchstart', start);
    host.removeEventListener('touchmove', move);
    host.removeEventListener('touchend', end);
    host.removeEventListener('touchcancel', end);
  };
}
