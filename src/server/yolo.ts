// Yolo: a worker whose CLI skips every approval prompt (see AgentChoice.yolo). Each provider that
// has such a flag names it in its row of shared/providers.ts; its adapter puts it on the command
// line with withYolo, on a fresh start and on a resume alike.
import { PROVIDER_META, type AgentProvider } from '../shared/providers.js';

/** `provider`'s yolo flag and its aliases, or none when it has no yolo. */
function yoloNames(provider: AgentProvider): Set<string> {
  const yolo = PROVIDER_META[provider].yolo;
  return new Set(yolo ? [yolo.flag, ...(yolo.aliases ?? [])] : []);
}

/** Whether the command line, ahead of any `--`, already has `provider`'s yolo flag by any of its names. */
export function hasYolo(args: readonly string[], provider: AgentProvider): boolean {
  const names = yoloNames(provider);
  const end = args.indexOf('--');
  return (end < 0 ? args : args.slice(0, end)).some((a) => names.has(a));
}

/**
 * The command line with `provider`'s yolo flag on it, ahead of any `--` and the prompt after it.
 * It goes on once: --agent-args (or --codex-args) that already has it, or one of its aliases,
 * keeps its first one and loses the rest. The options its CLI won't take with it are dropped, with
 * their values. Off, or for a provider without one, the command line is left as it is.
 */
export function withYolo(args: string[], provider: AgentProvider, on: boolean | undefined): string[] {
  const yolo = PROVIDER_META[provider].yolo;
  if (!on || !yolo) return args;
  const end = args.indexOf('--');
  const head = end < 0 ? args : args.slice(0, end);
  const tail = end < 0 ? [] : args.slice(end);
  const names = yoloNames(provider);
  const conflicts = yolo.conflicts ?? [];
  const kept: string[] = [];
  let has = false;
  for (let i = 0; i < head.length; i++) {
    const arg = head[i];
    if (conflicts.includes(arg)) {
      if (head[i + 1] !== undefined && !head[i + 1].startsWith('-')) i++;
      continue;
    }
    if (conflicts.some((c) => c.startsWith('--') && arg.startsWith(`${c}=`))) continue;
    if (names.has(arg)) {
      if (has) continue;
      has = true;
    }
    kept.push(arg);
  }
  if (!has) kept.push(yolo.flag);
  return [...kept, ...tail];
}
