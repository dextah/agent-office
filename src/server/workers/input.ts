// Terminal replies can precede PostToolUse by minutes: the approved command may still be running.
import type { SomeAdapter } from '../providers/types.js';
import type { Pty } from '../ptys.js';
import type { Worker, WorkerHandle } from './types.js';
import { TerminalInput } from './terminal-input.js';

/** Distinguishes Enter/Ctrl+C from editing, terminal reports and bracketed pastes, across chunks. */
export class ReplyInput {
  private escape = '';
  private paste = false;
  private tail = '';

  submitted(data: string): boolean {
    let submitted = false;
    // Without bracketed-paste mode xterm sends the clipboard as one plain chunk, including CRs.
    const plainPaste = data.length > 1 && !data.includes('\x1b');
    for (const ch of data) {
      if (this.paste) {
        this.tail = (this.tail + ch).slice(-6);
        if (this.tail === '\x1b[201~') {
          this.paste = false;
          this.tail = '';
        }
      } else if (ch === '\r' || ch === '\x03') {
        submitted ||= !plainPaste;
        this.escape = '';
      } else if (this.escape) {
        this.escape += ch;
        if (this.escape === '\x1b[' || this.escape === '\x1bO') continue;
        if (this.escape === '\x1b[200~') this.paste = true;
        if (this.escape.length === 2 || /[@-~]/.test(ch)) this.escape = '';
      } else if (ch === '\x1b') this.escape = ch;
    }
    return submitted;
  }
}

// A resumed/restarted process gets a fresh parser; old terminals can be collected.
const replies = new WeakMap<Pty, ReplyInput>();
const terminals = new WeakMap<Pty, TerminalInput>();

function terminalInput(w: Worker): TerminalInput {
  const pty = w.pty!;
  let input = terminals.get(pty);
  if (!input) {
    input = new TerminalInput((data) => {
      // A delayed Enter belongs only to the process that received the paste.
      if (w.pty === pty) pty.write(data);
    });
    terminals.set(pty, input);
  }
  return input;
}

export function pastePrompt(w: Worker, text: string) {
  terminalInput(w).paste(text);
}

/** Keystrokes from a browser, including presence and a provider's submitted-reply fallback. */
export function writeInput(w: Worker, data: string, by: string, adapter: SomeAdapter | undefined, handle: () => WorkerHandle): boolean {
  if (w.dsh) w.dsh.writeInput(data);
  else if (w.pty) {
    let reply = replies.get(w.pty);
    if (!reply) replies.set(w.pty, (reply = new ReplyInput()));
    const submitted = reply.submitted(data);
    const pty = w.pty;
    terminalInput(w).send(data, () => {
      if (w.pty === pty && submitted && w.info.status === 'needs_input' && !w.bootBlocked) adapter?.inputSubmitted?.(handle());
    });
  } else return false;

  const now = Date.now();
  const last = w.info.lastInput;
  let changed = !last || last.by !== by || now - last.at >= 15_000;
  if (changed) w.info.lastInput = { by, at: now };
  if (w.info.status === 'needs_input' && w.info.acked === false) {
    w.info.acked = true;
    changed = true;
  }
  return changed;
}
