// The sidebar on the right of the office, put together from the widgets registered in registry.ts: each
// one's panel in the order you put them, the ones you hid off. Its ✕, the ☰ menu's switch and ⚙️
// Settings' Widgets all come here, so they always agree; what you pick is kept with your settings.

import './widgets.css';
import { store, type Settings } from '../../state';
import { moveId, orderedIds, registeredWidgets, widgetShown, type SidebarWidget } from './registry';

let live: { settings: Settings; save: () => void } | null = null;
const panels = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

const byId = (id: string) => registeredWidgets().find((w) => w.id === id);

/** Puts the registered widgets in the sidebar and has each drawn again on what it follows. Once, after they've all registered. */
export function mountSidebar(settings: Settings, save: () => void) {
  live = { settings, save };
  for (const w of registeredWidgets()) {
    panels.set(w.id, w.el());
    const render = w.render;
    if (!render) continue;
    for (const t of w.topics ?? []) store.on(t, render);
    if (w.every) setInterval(render, w.every);
    render();
  }
  apply();
}

/** The widgets as they go down the sidebar. */
export function sidebarWidgets(): SidebarWidget[] {
  const all = registeredWidgets();
  return orderedIds(all.map((w) => w.id), live?.settings.widgetOrder ?? []).map((id) => byId(id)!);
}

export function isWidget(id: string): boolean {
  return !!byId(id);
}

export function widgetOn(id: string): boolean {
  const w = byId(id);
  return !!w && !!live && widgetShown(w, live.settings.hud);
}

/** Shows or hides a widget, as its ✕, the ☰ menu or ⚙️ Settings asks. */
export function setWidgetOn(id: string, on: boolean) {
  if (!live || !isWidget(id)) return;
  live.settings.hud = { ...live.settings.hud, [id]: on };
  changed();
}

/** Moves a widget up (-1) or down (1) the sidebar. */
export function moveWidget(id: string, step: number) {
  if (!live) return;
  live.settings.widgetOrder = moveId(sidebarWidgets().map((w) => w.id), id, step);
  changed();
}

/** Runs `fn` whenever a widget is shown, hidden or moved, from wherever. Hands back what stops it. */
export function onWidgetsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  live?.save();
  apply();
  for (const fn of listeners) fn();
}

/** Each panel in its place, and off if you hid it. Only moved when out of order, so a panel keeps where it's scrolled to. */
function apply() {
  const order = sidebarWidgets();
  const els = order.map((w) => panels.get(w.id)).filter((el): el is HTMLElement => !!el);
  order.forEach((w) => panels.get(w.id)?.classList.toggle('hud-off', !widgetOn(w.id)));
  const side = document.querySelector<HTMLElement>('#hud .side');
  if (!side) return;
  const now = [...side.children].filter((c) => els.includes(c as HTMLElement));
  if (now.length === els.length && now.every((c, i) => c === els[i])) return;
  side.append(...els);
}
