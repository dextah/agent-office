/**
 * Optional tmux wrapper for the office process. A disconnected SSH terminal no longer takes the
 * office down, while its existing worker/PTY lifecycle stays entirely under the office's control.
 * Nothing here runs unless `agent-office tmux` was explicitly requested.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Stdio = 'inherit' | 'ignore';
type Result = { status: number | null; error?: Error };

type TmuxRuntime = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  node?: string;
  execArgv?: string[];
  cli?: string;
  run?: (args: string[], stdio: Stdio) => Result;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

const HELP = `Usage:
  agent-office tmux [--session NAME] [--detached] [office options]
  agent-office tmux [--session NAME] --status

Opens an existing tmux session or starts Agent Office in a new detached tmux session.
Detach without stopping the office: Ctrl+B, then D. Rejoin with agent-office tmux.

  --session NAME   Pick a tmux session (default: agent-office)
  --detached       Start without attaching, or leave a running session alone
  --status         Check the session without starting or attaching
  --help           Show this help
  --               Pass remaining arguments unchanged to Agent Office

Office startup flags (for example --port 4700) are used only when starting a new
session. Existing sessions are rejoined, never replaced. To run multiple offices,
use distinct --session names and --port values.

Requires tmux on Linux, macOS or Windows Subsystem for Linux (WSL).
Native Windows does not ship tmux: run Agent Office and tmux inside WSL.
`;

export type TmuxOptions = {
  name: string;
  detached: boolean;
  status: boolean;
  help: boolean;
  officeArgs: string[];
};

/** Parse only our own flags, leaving all regular Agent Office flags for its real CLI. */
export function parseTmuxArgs(args: string[]): TmuxOptions {
  const parsed: TmuxOptions = { name: 'agent-office', detached: false, status: false, help: false, officeArgs: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      parsed.officeArgs.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--detached') parsed.detached = true;
    else if (arg === '--status') parsed.status = true;
    else if (arg === '--session') {
      const name = args[++i];
      if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
        throw new Error('--session needs a name (1–64 letters, numbers, dots, dashes or underscores; start with a letter or number)');
      }
      parsed.name = name;
    } else parsed.officeArgs.push(arg);
  }
  if (parsed.detached && parsed.status) throw new Error('--status cannot be combined with --detached');
  return parsed;
}

/** The command is handed as one shell command to tmux, so quote every untrusted argument. */
export function tmuxShellCommand(parts: string[]): string {
  return `exec ${parts.map((part) => `'${part.replace(/'/g, `'\\''`)}'`).join(' ')}`;
}

/** Return a shell-style exit code; never terminate an existing Agent Office process. */
export function tmuxCommand(argv: string[], runtime: TmuxRuntime = {}): number {
  const log = runtime.log ?? console.log;
  const error = runtime.error ?? console.error;
  let o: TmuxOptions;
  try {
    o = parseTmuxArgs(argv);
  } catch (e) {
    error(`agent-office tmux: ${(e as Error).message}`);
    return 2;
  }
  if (o.help) {
    log(HELP);
    return 0;
  }
  if ((runtime.platform ?? process.platform) === 'win32') {
    error('agent-office tmux: tmux is not supported natively on Windows. Install WSL2 and run Agent Office inside WSL, where tmux works normally.');
    return 1;
  }

  const env = runtime.env ?? process.env;
  const run = runtime.run ?? ((args: string[], stdio: Stdio) => {
    const r = spawnSync('tmux', args, { stdio });
    return { status: r.status, error: r.error };
  });
  const version = run(['-V'], 'ignore');
  if (version.error || version.status !== 0) {
    error('agent-office tmux: tmux is unavailable. Install tmux first (e.g. sudo apt install tmux or sudo pacman -S tmux).');
    return 1;
  }

  // = is tmux's exact session-name match: never hijack a similarly named user session.
  const target = `=${o.name}`;
  const has = () => run(['has-session', '-t', target], 'ignore');
  let existing = has();
  if (existing.error || (existing.status !== 0 && existing.status !== 1)) {
    error(`agent-office tmux: cannot check session ${o.name}`);
    return 1;
  }
  if (o.status) {
    log(existing.status === 0 ? `tmux session ${o.name} is running` : `tmux session ${o.name} is not running`);
    return existing.status === 0 ? 0 : 1;
  }
  if (existing.status === 0 && o.officeArgs.length) {
    log(`tmux session ${o.name} already exists; office startup options are ignored when rejoining.`);
  }
  if (existing.status === 1) {
    const here = fileURLToPath(import.meta.url);
    const cli = runtime.cli ?? path.join(path.dirname(here), `cli${path.extname(here)}`);
    const command = tmuxShellCommand([
      runtime.node ?? process.execPath,
      ...(runtime.execArgv ?? process.execArgv).filter((arg) => !/^--(?:inspect|debug)/.test(arg)),
      cli,
      ...o.officeArgs,
    ]);
    const created = run(['new-session', '-d', '-s', o.name, '-c', runtime.cwd ?? process.cwd(), command], 'ignore');
    if (created.error || created.status !== 0) {
      // Two invocations may race to create the same session. Rejoin the winner, not a second office.
      existing = has();
      if (existing.status !== 0) {
        error(`agent-office tmux: could not create session ${o.name}`);
        return 1;
      }
    } else log(`Started Agent Office in tmux session ${o.name}.`);
  }
  if (o.detached) {
    log(`Rejoin with: agent-office tmux --session ${o.name}`);
    return 0;
  }
  const insideTmux = !!env.TMUX;
  const joined = run(insideTmux ? ['switch-client', '-t', target] : ['attach-session', '-t', target], 'inherit');
  if (joined.error || joined.status !== 0) {
    error(`agent-office tmux: could not ${insideTmux ? 'switch to' : 'attach to'} session ${o.name}`);
    return 1;
  }
  return 0;
}
