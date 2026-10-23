// The Active agents widget: how many of the workers on your floor are working, waiting on someone or
// idle, the board agents and the task queue, and what they run on.

import { DESK_BY_ID } from '../../../shared/layout';
import { store } from '../../state';
import { h } from '../dom';
import { panelHide } from '../menu';
import { providerLabel } from '../provider';
import { countAgents } from './counts';
import type { SidebarWidget } from './registry';

const stat = (n: number, label: string, title: string, tone = '') => h('div.w-stat', { class: tone, title }, h('b', {}, String(n)), h('span', {}, label));

export function activeAgentsWidget(): SidebarWidget {
  const el = h('section.panel.widget.agents-widget', { id: 'agents-widget' });
  const render = () => {
    const c = countAgents(store.workers.values(), store.queue.tasks, (id) => !!DESK_BY_ID.get(id)?.station, (w) => providerLabel(w.provider, store.project));
    const total = c.workers + c.board.total;
    const rows: HTMLElement[] = [];
    if (!store.floor) rows.push(h('div.w-row.muted', {}, 'Not on a floor: take the elevator to one'));
    else if (!total && !c.tasks.running && !c.tasks.queued) rows.push(h('div.w-row.muted', {}, 'No agents on this floor yet: walk up to a desk and press E'));
    else {
      rows.push(
        h(
          'div.w-stats',
          {},
          stat(c.working, 'working', 'Workers busy on a turn'),
          stat(c.waiting, 'waiting', 'Workers waiting on someone: a question, a permission, or a finished turn nobody looked at', c.waiting ? 'warn' : ''),
          stat(c.idle, 'idle', `Workers waiting for a prompt${c.stopped ? `; ${c.stopped} more stopped` : ''}`),
        ),
      );
      if (c.stopped) rows.push(h('div.w-row.muted', { title: 'Exited, or not running since the office restarted: open one to resume it' }, `⏹️ ${c.stopped} stopped`));
      if (c.board.total) rows.push(h('div.w-row', { title: 'The agents at the Issues, PR and queue kiosks' }, h('span.what', {}, '🧑‍💼 Board agents'), h('b', {}, String(c.board.working)), h('span.muted', {}, `working · ${c.board.total - c.board.working} idle`)));
      if (c.tasks.running || c.tasks.queued) rows.push(h('div.w-row', { title: 'The 📋 task queue: tasks being worked on, and waiting for a worker' }, h('span.what', {}, '📋 Tasks'), h('b', {}, String(c.tasks.running)), h('span.muted', {}, `running · ${c.tasks.queued} queued`)));
      if (c.providers.length) rows.push(h('div.w-chips', { title: 'What the agents run on' }, ...c.providers.map(([label, n]) => h('span.w-chip', {}, label, h('b', {}, String(n))))));
    }
    el.replaceChildren(h('h3', {}, 'Active agents', total ? h('span.count', {}, String(total)) : null, panelHide('agents')), ...rows);
  };
  return { id: 'agents', icon: '📊', title: 'Active agents', what: 'Working, waiting, idle, by provider', defaultOn: true, el: () => el, render, topics: ['workers', 'queue', 'project', 'floor'] };
}
