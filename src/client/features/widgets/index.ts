/**
 * The sidebar's widgets: who's in the office, the workers, the spend, the Claude limits, the active
 * agents and the other floors, each registered with the sidebar (ui/widgets) and put in the order and
 * shown or hidden as you chose in ⚙️ Settings › Widgets. A new one is a module in ui/widgets and a line here.
 */
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { saveSettings } from '../../state';
import { $ } from '../../ui/dom';
import { renderLimits } from '../../ui/limits';
import { renderUsage } from '../../ui/usage';
import { activeAgentsWidget } from '../../ui/widgets/agents';
import { otherFloorsWidget } from '../../ui/widgets/floors';
import { defineWidget } from '../../ui/widgets/registry';
import { mountSidebar } from '../../ui/widgets/sidebar';

export type WidgetsParts = Pick<Parts, 'travel'>;

export function installWidgets(ctx: Ctx, parts: WidgetsParts) {
  const { net, settings } = ctx;
  // The people and workers lists are drawn by their own features (peers, workers/views), which know who's speaking and what clicking does.
  defineWidget({ id: 'people', icon: '👥', title: 'People', what: 'Who’s here, on which floor', defaultOn: false, el: () => $('people-panel') });
  defineWidget({ id: 'workers', icon: '🤖', title: 'Workers', what: 'Every desk and what it’s up to', defaultOn: false, el: () => $('workers-panel') });
  defineWidget({ id: 'spend', icon: '💸', title: 'Spend', what: 'Today, the budget, all time', defaultOn: false, el: () => $('spend'), render: renderUsage, topics: ['workers', 'usage'] });
  defineWidget({
    id: 'limits',
    icon: '⏳',
    title: 'Claude limits',
    what: 'The plan’s 5-hour and week',
    defaultOn: false,
    el: () => {
      const el = $('limits');
      // Click it to read them again.
      el.addEventListener('click', () => net.send({ t: 'limits.refresh' }));
      return el;
    },
    render: renderLimits,
    topics: ['limits'],
    // The reset countdowns tick down between reads.
    every: 30_000,
  });
  defineWidget(activeAgentsWidget());
  defineWidget(otherFloorsWidget((id) => parts.travel.switchFloor(id)));
  mountSidebar(settings, () => saveSettings(settings));
}
