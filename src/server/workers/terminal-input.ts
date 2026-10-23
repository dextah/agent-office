/** Keep an explicit Enter out of a Windows CLI's paste burst, without reordering later keys. */
export class TerminalInput {
  private readyAt = 0;
  private pending: { data: string; written?: () => void; settle?: number }[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private write: (data: string) => void, private windows = process.platform === 'win32') {}

  send(data: string, written?: () => void) {
    this.pending.push({ data, written });
    this.flush();
  }

  paste(text: string) {
    // Even outside Windows, the program needs a moment to consume the paste before Enter.
    this.pending.push({ data: `\x1b[200~${text}\x1b[201~`, settle: this.windows ? 500 : 120 });
    this.send('\r');
  }

  private flush() {
    if (this.timer) return;
    while (this.pending.length) {
      const next = this.pending[0];
      const wait = next.data === '\r' ? this.readyAt - Date.now() : 0;
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.flush();
        }, wait);
        return;
      }
      this.pending.shift();
      this.write(next.data);
      if (next.settle) this.readyAt = Date.now() + next.settle;
      // xterm sends a paste as one chunk. ConPTY can deliver it to the CLI as individual keys;
      // Codex then treats a following Enter as another pasted newline for 120ms after the burst.
      if (this.windows && next.data.length > 1 && (!next.data.includes('\x1b') || next.data.includes('\x1b[201~'))) {
        this.readyAt = Date.now() + 500;
      }
      next.written?.();
    }
  }
}
