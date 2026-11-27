import type { Game } from '../game/Game';
import { t } from '../i18n';
import { TUTORIAL_CREDITS, TUTORIAL_GEMS } from '../data/economy';

/**
 * Обучение при первом запуске: игрок сразу попадает в бой на Базаре, а пузырь с подсказкой ведёт
 * по шагам — выбрать бойца, поставить его, поставить второго, начать волну, отбить её, улучшить бойца.
 * Нужный элемент HUD подсвечивается пульсирующей рамкой. Шаги переключаются по состоянию игры.
 */

interface Step {
  text: () => string;
  /** Селектор элемента HUD для подсветки */
  target?: (g: Game) => string | null;
  /** Шаг выполнен (для шагов без кнопки) */
  done?: (g: Game) => boolean;
  /** Кнопка в пузыре: «Дальше» или финальная */
  button?: 'next' | 'finish';
  /** Вернуться на шаг назад (например, игрок отменил выбор бойца) */
  back?: (g: Game) => boolean;
}

export interface TutorialCallbacks {
  finish(skipped: boolean): void;
}

const STEPS: Step[] = [
  { text: () => t('tut1'), button: 'next' },
  {
    text: () => t('tut2'),
    target: () => '.squad-card[data-i="0"]',
    done: (g) => !!g.placing || g.towers.size > 0,
  },
  {
    text: () => t('tut3'),
    done: (g) => g.towers.size >= 1,
    back: (g) => !g.placing && g.towers.size === 0,
  },
  {
    text: () => t('tut4'),
    target: (g) => (g.placing ? null : '.squad-card[data-i="1"]'),
    // Второй боец — если хватает денег; иначе шаг пропускается
    done: (g) => g.towers.size >= 2 || g.phase !== 'prep' || (!g.placing && g.money < Math.min(...g.squad.map((u) => u.tiers[0].cost))),
  },
  {
    text: () => t('tut5'),
    target: () => '[data-act="start"]',
    done: (g) => g.phase !== 'prep',
  },
  {
    text: () => t('tut6'),
    done: (g) => (g.phase === 'prep' && g.waveIndex >= 1) || g.phase === 'ended',
  },
  {
    text: () => t('tut7'),
    target: (g) => (g.selected ? '[data-inspector] [data-act="upgrade"]' : null),
    done: (g) => [...g.towers.values()].some((tw) => tw.tier > 0) || g.phase !== 'prep',
  },
  { text: () => t('tut8', { credits: TUTORIAL_CREDITS, gems: TUTORIAL_GEMS }), button: 'finish' },
];

export class Tutorial {
  private readonly el: HTMLDivElement;
  private readonly game: Game;
  private readonly cb: TutorialCallbacks;
  private step = 0;
  private rendered = -1;
  private highlighted: HTMLElement | null = null;
  private acc = 0;
  private closed = false;

  constructor(root: HTMLElement, game: Game, cb: TutorialCallbacks) {
    this.game = game;
    this.cb = cb;
    this.el = document.createElement('div');
    this.el.className = 'tut-bubble glass pe';
    root.appendChild(this.el);
    document.body.classList.add('tut-on');
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-tut]')?.getAttribute('data-tut');
      if (act === 'next') this.go(this.step + 1);
      else if (act === 'finish') this.close(false);
      else if (act === 'skip') this.close(true);
    });
    this.render();
  }

  get active(): boolean {
    return !this.closed;
  }

  /** Сколько шагов пройдено (для решения «засчитать ли обучение» при выходе из матча) */
  get progress(): number {
    return this.step;
  }

  private go(i: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, i));
    this.render();
  }

  update(dt: number): void {
    if (this.closed) return;
    this.acc += dt;
    if (this.acc < 0.15) return;
    this.acc = 0;
    const s = STEPS[this.step];
    if (s.done?.(this.game)) this.go(this.step + 1);
    else if (s.back?.(this.game)) this.go(this.step - 1);
    this.highlight();
    // Пузырь — под верхней панелью HUD (на телефоне она бывает в две строки)
    const top = document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? 60;
    this.el.style.top = `${Math.round(top + 8)}px`;
  }

  private render(): void {
    if (this.rendered === this.step) return;
    this.rendered = this.step;
    const s = STEPS[this.step];
    const btn =
      s.button === 'next'
        ? `<button class="btn btn-primary" data-tut="next">${t('tutNext')}</button>`
        : s.button === 'finish'
          ? `<button class="btn btn-primary" data-tut="finish">${t('tutDone')}</button>`
          : '';
    const skip = s.button === 'finish' ? '' : `<button class="tut-skip" data-tut="skip">${t('tutSkip')}</button>`;
    const dots = STEPS.map((_, i) => `<i class="${i <= this.step ? 'on' : ''}"></i>`).join('');
    this.el.innerHTML = `
      <div class="tut-text">${s.text()}</div>
      <div class="tut-row"><span class="tut-dots">${dots}</span><span class="flex items-center gap-2">${skip}${btn}</span></div>`;
    this.highlight();
  }

  private highlight(): void {
    const sel = STEPS[this.step].target?.(this.game) ?? null;
    const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    if (el === this.highlighted) return;
    this.highlighted?.classList.remove('tut-target');
    this.highlighted = el;
    el?.classList.add('tut-target');
  }

  close(skipped: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.dispose();
    this.cb.finish(skipped);
  }

  dispose(): void {
    this.closed = true;
    document.body.classList.remove('tut-on');
    this.highlighted?.classList.remove('tut-target');
    this.highlighted = null;
    this.el.remove();
  }
}
