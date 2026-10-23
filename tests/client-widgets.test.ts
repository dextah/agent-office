import test from 'node:test';
import assert from 'node:assert/strict';
import type { QueueTask, WorkerInfo } from '../src/shared/protocol.js';

// What the browser keeps is in localStorage, and the sidebar looks for its place on the page: stand both
// in before the modules load. With no sidebar on the page, the widgets are only switched on and off.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });

const state = await import('../src/client/state/index.js');
const { defineWidget, moveId, orderedIds, registeredWidgets, widgetShown } = await import('../src/client/ui/widgets/registry.js');
const sidebar = await import('../src/client/ui/widgets/sidebar.js');
const { countAgents } = await import('../src/client/ui/widgets/counts.js');

/** A panel that only says whether it's off. */
function panel() {
  const classes = new Set<string>();
  return { classes, el: { classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) } } as unknown as HTMLElement };
}

test('the widgets go down the sidebar in the order you put them, then the rest as they registered', () => {
  assert.deepEqual(orderedIds(['a', 'b', 'c', 'd'], []), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderedIds(['a', 'b', 'c', 'd'], ['c', 'a']), ['c', 'a', 'b', 'd']);
  // One you put in order that's gone, or there twice, is passed over.
  assert.deepEqual(orderedIds(['a', 'b'], ['gone', 'b', 'b']), ['b', 'a']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
  // Not past either end, and not one that isn't there.
  assert.deepEqual(moveId(['a', 'b'], 'a', -1), ['a', 'b']);
  assert.deepEqual(moveId(['a', 'b'], 'b', 1), ['a', 'b']);
  assert.deepEqual(moveId(['a', 'b'], 'x', 1), ['a', 'b']);
});

test('a widget shows by its default until you say otherwise', () => {
  assert.equal(widgetShown({ id: 'agents', defaultOn: true }, {}), true);
  assert.equal(widgetShown({ id: 'floors', defaultOn: false }, {}), false);
  assert.equal(widgetShown({ id: 'agents', defaultOn: true }, { agents: false }), false);
  assert.equal(widgetShown({ id: 'floors', defaultOn: false }, { floors: true }), true);
});

test('a widget registers once, and comes off again', () => {
  const p = panel();
  const off = defineWidget({ id: 'test-once', icon: '🧪', title: 'Test', what: 'x', defaultOn: true, el: () => p.el });
  assert.throws(() => defineWidget({ id: 'test-once', icon: '🧪', title: 'Again', what: 'x', defaultOn: true, el: () => p.el }), /defined twice/);
  off();
  assert.ok(!registeredWidgets().some((w) => w.id === 'test-once'));
});

test('hiding, showing and moving a widget is kept with your settings, and the ✕, the menu and Settings all hear of it', () => {
  const panels = { one: panel(), two: panel(), three: panel() };
  let drawn = 0;
  defineWidget({ id: 'one', icon: '1', title: 'One', what: '', defaultOn: false, el: () => panels.one.el });
  defineWidget({ id: 'two', icon: '2', title: 'Two', what: '', defaultOn: true, el: () => panels.two.el, render: () => drawn++ });
  defineWidget({ id: 'three', icon: '3', title: 'Three', what: '', defaultOn: true, el: () => panels.three.el });
  const settings = state.loadSettings();
  sidebar.mountSidebar(settings, () => state.saveSettings(settings));
  assert.equal(drawn, 1, 'drawn once as it goes up');
  assert.ok(panels.one.classes.has('hud-off'));
  assert.ok(!panels.two.classes.has('hud-off'));

  let heard = 0;
  const stop = sidebar.onWidgetsChange(() => heard++);
  // A panel's ✕ (through the ☰ menu's handler) and Settings' switch both come here.
  sidebar.setWidgetOn('two', false);
  sidebar.setWidgetOn('one', true);
  assert.equal(heard, 2);
  assert.ok(panels.two.classes.has('hud-off'));
  assert.ok(!panels.one.classes.has('hud-off'));
  assert.equal(sidebar.widgetOn('two'), false);
  // Something that isn't a widget isn't touched.
  sidebar.setWidgetOn('chat', false);
  assert.equal(settings.hud.chat, true);

  sidebar.moveWidget('three', -1);
  assert.deepEqual(sidebar.sidebarWidgets().map((w) => w.id), ['one', 'three', 'two']);
  stop();
  sidebar.moveWidget('three', -1);
  assert.equal(heard, 3, 'not heard once it stopped listening');

  // A reload brings them back as you left them.
  const again = state.loadSettings();
  assert.equal(again.hud.one, true);
  assert.equal(again.hud.two, false);
  assert.equal(again.hud.three, undefined);
  assert.deepEqual(again.widgetOrder, ['three', 'one', 'two']);
});

test('what is kept for widgets is only ids it could be, and only so many', () => {
  const junk: Record<string, unknown> = { agents: false, floors: true, 'Bad Id': true, nope: 'yes', people: true };
  for (let i = 0; i < 80; i++) junk[`w${i}`] = true;
  storage.set('agent-office.settings', JSON.stringify({ hud: junk, widgetOrder: ['floors', 'floors', 7, 'BAD', 'agents'] }));
  const s = state.loadSettings();
  assert.equal(s.hud.agents, false);
  assert.equal(s.hud.floors, true);
  assert.equal(s.hud.people, true);
  assert.equal(s.hud['Bad Id'], undefined);
  assert.equal(s.hud.nope, undefined);
  assert.ok(Object.keys(s.hud).length <= 6 + 50);
  assert.deepEqual(s.widgetOrder, ['floors', 'agents']);
});

test('the Active agents widget counts the workers, the board agents, the queue and the providers', () => {
  const w = (id: string, status: WorkerInfo['status'], extra: Partial<WorkerInfo> = {}) => ({ id, deskId: id, name: id, color: '#fff', kind: 'agent', status, createdAt: 1, ...extra }) as WorkerInfo;
  const workers = [
    w('a', 'working', { provider: 'claude' }),
    w('b', 'starting', { provider: 'codex' }),
    w('c', 'needs_input', { provider: 'claude' }),
    w('d', 'done', { provider: 'claude', acked: false }),
    w('e', 'done', { provider: 'opencode', acked: true }),
    w('f', 'idle', { kind: 'shell' }),
    w('g', 'exited', { provider: 'claude' }),
    w('kiosk-1', 'working', { provider: 'claude' }),
    w('kiosk-2', 'idle', { provider: 'codex' }),
  ];
  const tasks = [{ status: 'running' }, { status: 'queued' }, { status: 'queued' }, { status: 'done' }] as QueueTask[];
  const label: Record<string, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };
  const c = countAgents(workers, tasks, (id) => id.startsWith('kiosk'), (x) => label[x.provider!]);
  assert.equal(c.workers, 7);
  assert.equal(c.working, 2);
  assert.equal(c.waiting, 2);
  assert.equal(c.idle, 2);
  assert.equal(c.stopped, 1);
  assert.deepEqual(c.board, { total: 2, working: 1 });
  assert.deepEqual(c.tasks, { running: 1, queued: 2 });
  assert.deepEqual(c.providers, [['Claude', 5], ['Codex', 2], ['OpenCode', 1], ['Shell', 1]]);
});
