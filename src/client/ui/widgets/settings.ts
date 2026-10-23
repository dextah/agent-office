// ⚙️ Settings › Widgets: every sidebar widget with its switch, and buttons to move it up or down the
// sidebar. It changes them where the ✕ and the ☰ menu do (sidebar.ts), so all three agree.

import { h } from '../dom';
import { moveWidget, onWidgetsChange, setWidgetOn, sidebarWidgets, widgetOn } from './sidebar';

/** `wrap` puts the list in a setting of the window's own. */
export function widgetsSetting(wrap: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const list = h('div.widget-list', { role: 'list', 'aria-label': 'Sidebar widgets' });
  const paint = () => {
    const all = sidebarWidgets();
    list.replaceChildren(
      ...all.map((w, i) => {
        const on = widgetOn(w.id);
        const move = (step: number, icon: string, what: string, disabled: boolean) =>
          h('button.btn.wp-move', { type: 'button', disabled, 'aria-label': `Move ${w.title} ${what}`, title: `Move ${what} the sidebar`, onclick: () => moveWidget(w.id, step) }, icon);
        return h(
          'div.widget-pick',
          { role: 'listitem', 'data-widget': w.id },
          h('span.wp-icon', { 'aria-hidden': 'true' }, w.icon),
          h('span.wp-text', {}, w.title, h('small', {}, w.what)),
          move(-1, '▲', 'up', i === 0),
          move(1, '▼', 'down', i === all.length - 1),
          h(
            'button.wp-toggle',
            { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': `Show ${w.title}`, title: on ? 'Showing: click to hide' : 'Hidden: click to show', onclick: () => setWidgetOn(w.id, !on) },
            h('span.switch', { 'aria-hidden': 'true' }),
          ),
        );
      }),
    );
  };
  paint();
  const off = onWidgetsChange(paint);
  const note = h('p.setting-note', {}, 'The panels down the right of the office. A panel’s ✕ hides it too, and the ☰ menu (Tab) brings it back; either way it’s the same switch here.');
  return { section: wrap([list, note]), off };
}
