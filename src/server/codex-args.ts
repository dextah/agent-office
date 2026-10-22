// Codex's own extra args (--codex-args / AGENT_OFFICE_CODEX_ARGS): what every Codex worker runs with,
// whichever agent is the office's default, unlike --agent-args, which only the default agent gets.
// `--codex-args --yolo` runs them with Codex's approvals and sandbox bypassed, as the Yolo box does.
import { hasYolo, withYolo } from './yolo.js';

/** Codex's other flags that take no value: given twice, Codex refuses to start. (Its yolo flag is withYolo's.) */
const SWITCHES = new Set(['--full-auto', '--search', '--oss', '--no-alt-screen']);

/** Whether `args` already has the switch `arg` is. */
export function hasCodexSwitch(args: readonly string[], arg: string): boolean {
  return SWITCHES.has(arg) && args.includes(arg);
}

/**
 * The command line so far with the office's --codex-args after it, leaving out a switch it already
 * has. When either asks for yolo, by any of its names, it ends up with one yolo flag and without the
 * approval policy Codex won't take beside it (see withYolo).
 */
export function withCodexArgs(args: readonly string[], extra: readonly string[]): string[] {
  const out = [...args];
  for (const arg of extra) if (!hasCodexSwitch(out, arg)) out.push(arg);
  return hasYolo(out, 'codex') ? withYolo(out, 'codex', true) : out;
}
