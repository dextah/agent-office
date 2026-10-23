// The Other floors widget: every other project in the building, how many of its workers are working and
// how many are waiting on someone. Click one to go there, as the floor list under the project does.

import { cloneLabel, floorPalette } from '../../../shared/floors';
import type { FloorInfo } from '../../../shared/protocol';
import { store } from '../../state';
import { h } from '../dom';
import { panelHide } from '../menu';
import type { SidebarWidget } from './registry';

/** `go` takes you to a floor, as picking it from the floor list does. */
export function otherFloorsWidget(go: (floorId: string) => void): SidebarWidget {
  const el = h('section.panel.widget.floors-widget', { id: 'floors-widget' });
  const row = (f: FloorInfo) => {
    const stats = f.cloning
      ? [h('span.muted', { title: f.clone?.detail ?? 'Being cloned' }, cloneLabel(f.clone))]
      : [
          f.waiting ? h('span.warn', { title: 'Workers waiting on someone' }, `🙋 ${f.waiting}`) : null,
          h('span', { title: 'Working' }, `👷 ${f.busy}`),
          h('span.muted', { title: 'Workers at desks' }, `💻 ${f.workers}`),
        ];
    return h(
      'button.w-floor',
      { type: 'button', disabled: f.cloning, title: f.cloning ? 'Still being cloned' : `Go to ${f.name}`, onclick: () => go(f.id) },
      h('span.dot', { style: `background:${floorPalette(f.palette).trim}` }),
      h('span.w-name', {}, f.name),
      h('span.w-floor-stats', {}, ...stats),
    );
  };
  const render = () => {
    const others = store.floors.filter((f) => f.id !== store.floor);
    const waiting = others.reduce((n, f) => n + f.waiting, 0);
    el.replaceChildren(
      h('h3', {}, 'Other floors', others.length ? h('span.count', {}, String(others.length)) : null, panelHide('floors')),
      ...(others.length ? others.map(row) : [h('div.w-row.muted', {}, 'No other floors yet: the elevator adds a project')]),
    );
    el.classList.toggle('needs-you-panel', waiting > 0);
  };
  return { id: 'floors', icon: '🏢', title: 'Other floors', what: 'Who’s working and waiting elsewhere', defaultOn: false, el: () => el, render, topics: ['floors', 'floor'] };
}
