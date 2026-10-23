// The sidebar's widgets: each panel down the right of the office (who's in, the workers, the spend, the
// limits, the agents, the other floors) registers here with what it's called, whether it shows until you
// say otherwise, and how it's drawn. Which show and in what order is yours, kept with your settings
// (see sidebar.ts); this module is only the list and the rules for it, with nothing on the page.

import type { Topic } from '../../state';

export interface SidebarWidget {
  /** Kept in your settings by it, so it never changes: lowercase letters, digits and dashes. */
  id: string;
  icon: string;
  title: string;
  /** What it shows, in a few words, for the ☰ menu and ⚙️ Settings. */
  what: string;
  /** Shows until you hide it. */
  defaultOn: boolean;
  /** Its panel in the sidebar: one in the page already, or one it makes (once). */
  el(): HTMLElement;
  /** Draws it again. It runs whether it shows or not, as some write to the page outside their panel. */
  render?(): void;
  /** What it's drawn again on. */
  topics?: readonly Topic[];
  /** Drawn again this often as well (ms), for what counts down. */
  every?: number;
}

const widgets: SidebarWidget[] = [];

/** Adds a widget to the sidebar's list, after the ones before it. Hands back what takes it off again. */
export function defineWidget(w: SidebarWidget): () => void {
  if (widgets.some((o) => o.id === w.id)) throw new Error(`sidebar widget ${w.id} is defined twice`);
  widgets.push(w);
  return () => {
    const i = widgets.indexOf(w);
    if (i >= 0) widgets.splice(i, 1);
  };
}

/** Every widget, in the order they registered. */
export function registeredWidgets(): readonly SidebarWidget[] {
  return widgets;
}

/** Whether a widget shows, by what you said (`hud`) or else by its default. */
export function widgetShown(w: Pick<SidebarWidget, 'id' | 'defaultOn'>, hud: { readonly [id: string]: boolean | undefined }): boolean {
  return hud[w.id] ?? w.defaultOn;
}

/** The ids in the order they go down the sidebar: the ones you put in order first, then the rest as they registered. */
export function orderedIds(registered: readonly string[], saved: readonly string[]): string[] {
  const known = new Set(registered);
  const first = [...new Set(saved)].filter((id) => known.has(id));
  return [...first, ...registered.filter((id) => !first.includes(id))];
}

/** `order` with `id` moved `step` places (-1 up, 1 down); the same order if it can't go further. */
export function moveId(order: readonly string[], id: string, step: number): string[] {
  const out = [...order];
  const i = out.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
