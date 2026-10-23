// What the Active agents widget counts, from what the page already has: the workers on your floor and
// its task queue. Kept apart from the drawing so it can be tested without a page.

import type { QueueTask, WorkerInfo } from '../../../shared/protocol';
import { waitingOnSomeone } from '../../notify';

export interface AgentCounts {
  /** The workers hired onto desks, bean bags and the meeting table (not the board agents). */
  workers: number;
  working: number;
  /** Asking something, or finished and nobody has looked yet. */
  waiting: number;
  idle: number;
  /** Exited, or restored after a restart and not running. */
  stopped: number;
  /** The agents standing at the Issues, PR and queue kiosks. */
  board: { total: number; working: number };
  tasks: { running: number; queued: number };
  /** How many run on each provider (shell workers as "Shell"), most first. */
  providers: [label: string, count: number][];
}

const BUSY = new Set(['working', 'starting']);
const STOPPED = new Set(['exited', 'offline']);

/** `atStation` says whether a desk is a board agent's kiosk; `providerOf` names what an agent runs on. */
export function countAgents(workers: Iterable<WorkerInfo>, tasks: readonly QueueTask[], atStation: (deskId: string) => boolean, providerOf: (w: WorkerInfo) => string): AgentCounts {
  const c: AgentCounts = { workers: 0, working: 0, waiting: 0, idle: 0, stopped: 0, board: { total: 0, working: 0 }, tasks: { running: 0, queued: 0 }, providers: [] };
  const providers = new Map<string, number>();
  for (const w of workers) {
    const label = w.kind === 'agent' ? providerOf(w) : 'Shell';
    providers.set(label, (providers.get(label) ?? 0) + 1);
    if (atStation(w.deskId)) {
      c.board.total++;
      if (BUSY.has(w.status)) c.board.working++;
      continue;
    }
    c.workers++;
    if (w.lost || STOPPED.has(w.status)) c.stopped++;
    else if (waitingOnSomeone(w)) c.waiting++;
    else if (BUSY.has(w.status)) c.working++;
    else c.idle++;
  }
  for (const t of tasks) {
    if (t.status === 'running') c.tasks.running++;
    else if (t.status === 'queued') c.tasks.queued++;
  }
  c.providers = [...providers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return c;
}
