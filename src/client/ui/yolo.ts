// The "Yolo (skip approvals)" box under a worker's provider, model and effort (see agentFields in
// provider.ts): in the hire dialog, the default worker and the board agents in ⚙️ Settings. Which
// providers have one, and the flag it turns on, is their row in shared/providers.ts; the server
// checks it again, and each adapter puts that flag on the worker's command line (server/yolo.ts).
import './yolo.css';
import type { AgentProvider } from '../../shared/protocol';
import { PROVIDER_META, providerNames, takesYolo } from '../../shared/providers';
import { h } from './dom';

/** What a worker in yolo has on its card, its terminal's title and the workers list. */
export const YOLO_BADGE = '⚠️ Yolo';

export interface YoloField {
  element: HTMLElement;
  /** Puts the box on `on`, for a worker on `provider` (unticked and disabled for one without a flag). */
  set(provider: AgentProvider, on: boolean | undefined): void;
  /** Whether it's ticked, for a provider that has one. */
  value(): boolean;
}

export function yoloField(id: string): YoloField {
  const box = h('input', { type: 'checkbox', id: `${id}-yolo` }) as HTMLInputElement;
  const flag = h('code.yolo-flag');
  const label = h('label.yolo-label', { for: box.id }, box, h('span', {}, 'Yolo (skip approvals)'), flag);
  const warn = h('small.yolo-warn', { role: 'note' });
  const element = h('div.yolo-field', {}, label, warn);
  let provider: AgentProvider = 'claude';
  const paint = () => {
    const yolo = PROVIDER_META[provider].yolo;
    box.disabled = !yolo;
    if (!yolo) box.checked = false;
    flag.textContent = yolo?.flag ?? '';
    flag.classList.toggle('hidden', !yolo);
    element.classList.toggle('on', box.checked);
    warn.textContent = !yolo
      ? `${PROVIDER_META[provider].label} has no yolo mode: only ${providerNames((m) => !!m.yolo)} workers can skip approvals.`
      : box.checked
        ? '⚠️ It runs every command and edit without asking anyone first, on the office machine. Only for work you’d trust it with unattended.'
        : 'It asks before commands and edits, in its terminal.';
    label.title = yolo ? `Starts ${PROVIDER_META[provider].label} with ${yolo.flag}, on a resume too` : '';
  };
  box.addEventListener('change', paint);
  return {
    element,
    set(p, on) {
      provider = p;
      box.checked = !!on && takesYolo(p);
      paint();
    },
    value: () => box.checked && takesYolo(provider),
  };
}
