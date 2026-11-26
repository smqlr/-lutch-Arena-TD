import type { Game } from '../game/Game';
import type { CameraMode } from '../engine/CameraController';
import { ENEMIES } from '../data/enemies';
import { waveComposition } from '../data/waves';
import {
  ROLE_ICONS,
  fmtMoney,
  loc,
  passiveDesc,
  passiveName,
  priorityName,
  roleColorCss,
  roleName,
  t,
  weaponName,
} from '../i18n';
import { icon } from './icons';

/**
 * Боевой HUD: верхняя панель (баланс, HP, волна, камера, сброс, автоволна, скорость, звук, старт),
 * нижняя панель отряда, форс-бай и эйрдроп, инспектор башни, выбор юнита для позиции.
 */

export interface HudActions {
  togglePause(): void;
  toggleCamera(): CameraMode;
  resetCamera(): void;
  toggleMute(): boolean;
  isMuted(): boolean;
  cameraMode(): CameraMode;
  airdrop(): void;
}

export class GameHUD {
  readonly el: HTMLDivElement;
  private game: Game;
  private actions: HudActions;
  private refreshT = 0;
  private lastMoney = -1;
  private cache = new Map<string, string>();
  private inspector: HTMLElement;
  private picker: HTMLElement;
  private hint: HTMLElement;
  private next: HTMLElement;
  private squadWrap: HTMLElement;

  constructor(root: HTMLElement, game: Game, actions: HudActions) {
    this.game = game;
    this.actions = actions;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-cluster glass pe">
          <button class="btn btn-icon" data-act="pause" title="${t('pause')}">${icon('pause')}</button>
          <div class="stat-box"><span class="k">${t('balance')}</span><span class="v money" data-v="money">$0</span></div>
          <div class="stat-box"><span class="k">${t('hp')}</span><span class="v hp-good" data-v="hp">20</span></div>
          <div class="stat-box"><span class="k">${t('wave')}</span><span class="v" data-v="wave">0/0</span></div>
        </div>
        <div class="hud-cluster glass pe">
          <button class="btn" data-act="camera" title="${t('camera')}"><span data-v="camIcon">${icon('camera')}</span><span class="lbl-text" data-v="camMode">${t('tactical')}</span></button>
          <button class="btn" data-act="resetCam" title="${t('reset')}">${icon('reset')}<span class="lbl-text">${t('reset')}</span></button>
          <button class="btn" data-act="auto" title="${t('autoWave')}">${icon('auto')}<span class="lbl-text">${t('autoWave')}</span></button>
          <button class="btn font-display" data-act="speed" title="${t('speed')}" style="min-width:44px"><b data-v="speed">1x</b></button>
          <button class="btn btn-icon" data-act="mute" title="${t('mute')}" data-v="mute">${icon('sound')}</button>
          <button class="btn btn-primary" data-act="start" style="padding:10px 16px">${icon('play')}<span data-v="startLabel">${t('startWave')}</span></button>
        </div>
      </div>
      <div class="hud-next glass pe" data-next style="position:absolute;right:8px;top:76px;border-radius:12px;padding:8px 12px;max-width:min(360px,calc(100vw - 16px))"></div>
      <div class="hud-bottom glass pe">
        <div class="flex gap-2 scroll-x" data-squad></div>
        <div class="flex flex-col gap-1.5 justify-center">
          <button class="btn btn-gold" data-act="force" title="${t('forceBuyDesc')}">${icon('bolt')}<span class="lbl-text-sm">${t('forceBuy')}</span> <b data-v="forceCost"></b></button>
          <button class="btn" data-act="airdrop" title="${t('airdropDesc')}">${icon('box')}<span>${t('airdrop')}</span> <b class="text-ok" data-v="airdrops"></b></button>
        </div>
      </div>
      <div class="hud-side glass pe scroll-y hidden" data-inspector></div>
      <div class="hud-side glass pe scroll-y hidden" data-picker></div>
      <div class="hud-hint glass pe hidden" data-hint></div>`;
    root.appendChild(this.el);
    this.inspector = this.q('[data-inspector]');
    this.picker = this.q('[data-picker]');
    this.hint = this.q('[data-hint]');
    this.next = this.q('[data-next]');
    this.squadWrap = this.q('[data-squad]');
    this.renderSquad();
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.refresh();
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  private set(key: string, html: string, asHtml = false): void {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html);
    const el = this.el.querySelector(`[data-v="${key}"]`);
    if (!el) return;
    if (asHtml) el.innerHTML = html;
    else el.textContent = html;
  }

  dispose(): void {
    this.el.remove();
    const tr = document.getElementById('toast-root');
    if (tr) tr.style.top = '';
  }

  /** Раскладка под фактическую высоту панелей (на узких экранах они переносятся в несколько строк) */
  private layout(): void {
    const top = this.q('.hud-top').getBoundingClientRect();
    const bottom = this.q('.hud-bottom').getBoundingClientRect();
    const narrow = window.innerWidth <= 760;
    const below = Math.round(top.bottom + 6);
    this.next.style.top = `${below}px`;
    const tr = document.getElementById('toast-root');
    if (tr) tr.style.top = `${below + (narrow && !this.next.classList.contains('hidden') ? this.next.offsetHeight + 6 : 0)}px`;
    for (const side of [this.inspector, this.picker]) {
      if (narrow) {
        side.style.top = '';
        side.style.bottom = `${Math.round(window.innerHeight - bottom.top + 6)}px`;
        side.style.maxHeight = `${Math.max(160, Math.round(bottom.top - below - 12))}px`;
      } else {
        side.style.bottom = '';
        side.style.top = `${below}px`;
        side.style.maxHeight = `${Math.max(200, Math.round(bottom.top - below - 12))}px`;
      }
    }
  }

  /* ------------------------------- Клики --------------------------------- */

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-act]') as HTMLElement | null;
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const g = this.game;
    switch (btn.dataset.act) {
      case 'pause':
        this.actions.togglePause();
        break;
      case 'camera': {
        const m = this.actions.toggleCamera();
        this.set('camMode', m === 'tactical' ? t('tactical') : t('flight'));
        this.set('camIcon', m === 'tactical' ? icon('camera') : icon('flight'), true);
        btn.classList.toggle('is-on', m === 'flight');
        break;
      }
      case 'resetCam':
        this.actions.resetCamera();
        this.set('camMode', t('tactical'));
        this.set('camIcon', icon('camera'), true);
        this.q('[data-act="camera"]').classList.remove('is-on');
        break;
      case 'auto':
        g.toggleAuto();
        break;
      case 'speed':
        g.toggleSpeed();
        break;
      case 'mute': {
        const muted = this.actions.toggleMute();
        this.set('mute', muted ? icon('mute') : icon('sound'), true);
        break;
      }
      case 'start':
        g.startWave();
        break;
      case 'force':
        g.buyForce();
        break;
      case 'airdrop':
        this.actions.airdrop();
        break;
      case 'card': {
        const u = g.squad[Number(btn.dataset.i)];
        if (u) g.beginPlacement(u);
        break;
      }
      case 'cancelPlace':
        g.cancelPlacement();
        break;
      case 'upgrade':
        g.upgradeSelected();
        break;
      case 'sell':
        g.sellSelected();
        break;
      case 'priority':
        g.cyclePriority();
        break;
      case 'closeSide':
        g.deselect();
        break;
      case 'pickUnit': {
        const u = g.squad[Number(btn.dataset.i)];
        if (u && g.picked) g.placeAt(g.picked.pos, u);
        break;
      }
    }
    this.refresh();
  }

  /** Горячие клавиши: 1–5 — карточки отряда, Esc — отмена/пауза. Возвращает true, если обработано */
  handleKey(e: KeyboardEvent): boolean {
    const g = this.game;
    if (e.code.startsWith('Digit')) {
      const i = Number(e.code.slice(5)) - 1;
      if (i >= 0 && i < g.squad.length) {
        g.beginPlacement(g.squad[i]);
        this.refresh();
        return true;
      }
    }
    if (e.code === 'Escape') {
      if (g.placing || g.selected || g.picked) {
        g.deselect();
        this.refresh();
        return true;
      }
    }
    return false;
  }

  /* ----------------------------- Отрисовка ------------------------------- */

  private renderSquad(): void {
    this.squadWrap.innerHTML = this.game.squad
      .map((u, i) => {
        const c = roleColorCss(u.role);
        return `<button class="squad-card" data-act="card" data-i="${i}" style="--c:${c}" title="${roleName(u.role)} — ${passiveName(u.passive)}">
          <div class="key">${i + 1}</div>
          <div class="nick">${u.nick}</div>
          <div class="role">${roleName(u.role)}</div>
          <div class="cost">${fmtMoney(u.tiers[0].cost)}</div>
          <div class="icon">${ROLE_ICONS[u.role]}</div>
        </button>`;
      })
      .join('');
  }

  onSelectionChanged(): void {
    this.refresh();
  }

  update(dt: number): void {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.12;
      this.refresh();
    }
  }

  refresh(): void {
    const g = this.game;
    // Деньги, HP, волна
    const money = Math.floor(g.money);
    this.set('money', fmtMoney(money));
    if (this.lastMoney >= 0 && money > this.lastMoney) {
      const m = this.q('[data-v="money"]');
      m.classList.remove('pulse-gold');
      void m.offsetWidth;
      m.classList.add('pulse-gold');
    }
    this.lastMoney = money;
    const hpEl = this.q('[data-v="hp"]');
    this.set('hp', `${g.hp}/${g.maxHp}`);
    const frac = g.hp / g.maxHp;
    hpEl.className = `v ${frac > 0.6 ? 'hp-good' : frac > 0.3 ? 'hp-mid' : 'hp-low'}`;
    this.set('wave', t('waveOf', { n: g.waveIndex, total: g.waves.length }));
    this.set('speed', `${g.speed}x`);
    this.q('[data-act="speed"]').classList.toggle('is-on', g.speed === 2);
    this.q('[data-act="auto"]').classList.toggle('is-on', g.autoWave);
    this.set('mute', this.actions.isMuted() ? icon('mute') : icon('sound'), true);

    // Кнопка старта
    const start = this.q<HTMLButtonElement>('[data-act="start"]');
    if (g.phase === 'prep') {
      start.disabled = false;
      this.set('startLabel', g.autoWave ? t('autoIn', { n: Math.max(0, Math.ceil(g.autoTimer)) }) : t('startWave'));
    } else {
      start.disabled = true;
      this.set('startLabel', g.phase === 'wave' ? t('waveInProgress') : t('startWave'));
    }

    // Превью следующей волны
    let nextHtml = '';
    if (g.phase === 'prep' && g.nextWave) {
      const w = g.nextWave;
      const comp = [...waveComposition(w).entries()]
        .map(([k, n]) => `<span class="chip" style="color:#${ENEMIES[k].color.toString(16).padStart(6, '0')}">${n}× ${loc(ENEMIES[k].name)}</span>`)
        .join(' ');
      nextHtml = `<div class="text-[11px] uppercase tracking-widest text-slate-400 mb-1">${t('nextWave', { name: '' })}<b class="${w.boss ? 'text-danger' : 'text-neon'}"> ${loc(w.name)}</b> · ${t('wave')} ${w.number}</div><div class="flex flex-wrap gap-1">${comp}</div>`;
    } else if (g.phase === 'wave') {
      const w = g.currentWave;
      nextHtml = `<div class="flex items-center gap-2 text-sm"><span class="blink text-danger">●</span><b class="font-display">${w ? loc(w.name) : ''}</b><span class="text-slate-400">${t('enemiesLeft', { n: g.aliveEnemies })}</span>${
        g.forceBuyActive ? `<span class="chip text-gold">${t('forceBuyActive')}</span>` : ''
      }</div>`;
    }
    if (this.cache.get('nextHtml') !== nextHtml) {
      this.cache.set('nextHtml', nextHtml);
      this.next.innerHTML = nextHtml;
      this.next.classList.toggle('hidden', !nextHtml);
    }
    const showSide = !!g.selected || !!g.picked;
    this.next.style.display = showSide ? 'none' : '';

    // Карточки отряда
    this.squadWrap.querySelectorAll<HTMLElement>('.squad-card').forEach((el) => {
      const u = g.squad[Number(el.dataset.i)];
      el.classList.toggle('is-active', g.placing?.id === u.id);
      el.classList.toggle('is-poor', g.money < u.tiers[0].cost);
    });

    // Форс-бай и эйрдроп
    const force = this.q<HTMLButtonElement>('[data-act="force"]');
    this.set('forceCost', g.forceBuyActive ? '✓' : fmtMoney(g.forceBuyCost));
    force.disabled = g.phase !== 'prep' || g.forceBuyActive || g.money < g.forceBuyCost;
    const air = this.q<HTMLButtonElement>('[data-act="airdrop"]');
    this.set('airdrops', `+$150 ×${g.airdropsLeft}`);
    air.disabled = g.airdropsLeft <= 0 || g.phase === 'ended';

    // Подсказка установки
    let hintHtml = '';
    if (g.placing) {
      hintHtml = `<span>${t('placementMode', { nick: g.placing.nick, cost: g.placing.tiers[0].cost })}</span><button class="btn btn-ghost" data-act="cancelPlace">${icon('close')}${t('cancelPlacement')}</button>`;
    }
    if (this.cache.get('hint') !== hintHtml) {
      this.cache.set('hint', hintHtml);
      this.hint.innerHTML = hintHtml;
      this.hint.classList.toggle('hidden', !hintHtml);
    }

    this.renderInspector();
    this.renderPicker();
    this.layout();
  }

  private renderInspector(): void {
    const g = this.game;
    const tw = g.selected;
    if (!tw) {
      if (this.cache.get('insp') !== '') {
        this.cache.set('insp', '');
        this.inspector.classList.add('hidden');
        this.inspector.innerHTML = '';
      }
      return;
    }
    const u = tw.def;
    const c = roleColorCss(u.role);
    const base = u.tiers[tw.tier];
    const s = tw.stats;
    const cost = g.upgradeCost(tw);
    const next = tw.tier < 2 ? u.tiers[tw.tier + 1] : null;
    const bonus = (v: number) =>
      v > 0.001
        ? `<span class="text-ok text-[11px] font-bold ml-1">+${Math.round(v * 100)}%</span>`
        : v < -0.001
          ? `<span class="text-danger text-[11px] font-bold ml-1">${Math.round(v * 100)}%</span>`
          : '';
    const slotBonus = tw.elevated ? this.bonusText(g.highGroundBonus(u)) : '';
    const html = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <span class="chip" style="color:${c}">${ROLE_ICONS[u.role]} ${roleName(u.role)}</span>
            <span class="tier-badge" style="--c:${c}">T${tw.tier + 1}</span>
          </div>
          <div class="font-display text-2xl font-extrabold text-white mt-1 leading-none">${u.nick}</div>
          <div class="text-xs text-slate-400 mt-1">${weaponName(base.weapon)} · ${loc(tw.spot)}</div>
        </div>
        <button class="btn btn-ghost btn-icon" data-act="closeSide" title="${t('close')}">${icon('close')}</button>
      </div>
      <div class="grid grid-cols-3 gap-1.5 mt-3">
        <div class="stat-box"><span class="k">${t('damage')}</span><span class="v">${Math.round(s.damage)}${bonus(s.dmgBonus)}</span></div>
        <div class="stat-box"><span class="k">${t('fireRate')}</span><span class="v">${s.fireRate.toFixed(2)}${bonus(s.rateBonus)}</span></div>
        <div class="stat-box"><span class="k">${t('range')}</span><span class="v">${s.range.toFixed(1)}${bonus(s.rangeBonus)}</span></div>
        <div class="stat-box"><span class="k">${t('dps')}</span><span class="v text-gold">${Math.round(s.dps)}</span></div>
        <div class="stat-box"><span class="k">${t('pen')}</span><span class="v">${Math.round(base.pen * 100)}%</span></div>
        <div class="stat-box"><span class="k">${t('kills_short')}</span><span class="v">${tw.kills}</span></div>
      </div>
      ${slotBonus ? `<div class="mt-2 text-xs text-gold">★ ${t('bonusSlot')}: ${slotBonus}</div>` : ''}
      <div class="mt-3 p-2.5 rounded-lg" style="background:rgba(13,13,18,.6);border:1px solid #2a3048">
        <div class="text-[11px] uppercase tracking-widest text-slate-400">${t('passive')}</div>
        <div class="font-bold text-white text-sm" style="color:${c}">${passiveName(u.passive)}</div>
        <div class="text-xs text-slate-300 mt-0.5">${passiveDesc(u.passive)}</div>
      </div>
      ${
        next
          ? `<div class="mt-2 text-xs text-slate-400">→ T${tw.tier + 2}: <b class="text-slate-200">${weaponName(next.weapon)}</b> · ${t('damage')} ${next.damage} · ${t('fireRate')} ${next.fireRate} · ${t('range')} ${next.range}</div>`
          : ''
      }
      <div class="flex flex-col gap-1.5 mt-3">
        ${
          cost !== null
            ? `<button class="btn btn-gold w-full" style="padding:10px" data-act="upgrade" ${g.money < cost ? 'disabled' : ''}>${icon('up')} ${t('upgrade')} → T${tw.tier + 2} · ${fmtMoney(cost)}</button>`
            : `<button class="btn w-full" style="padding:10px" disabled>${icon('star')} ${t('maxTier')}</button>`
        }
        <div class="grid grid-cols-2 gap-1.5">
          <button class="btn min-w-0" style="padding:8px 6px;font-size:12px" data-act="priority">${icon('target')}<span class="truncate">${t('priority')}: <b class="text-neon">${priorityName(tw.priority)}</b></span></button>
          <button class="btn btn-danger min-w-0" style="padding:8px 6px;font-size:12px" data-act="sell">${icon('sell')}<span class="truncate">${t('sell')} +${fmtMoney(g.sellValue(tw))}</span></button>
        </div>
      </div>`;
    if (this.cache.get('insp') !== html) {
      this.cache.set('insp', html);
      this.inspector.innerHTML = html;
      this.inspector.classList.remove('hidden');
    }
  }

  private renderPicker(): void {
    const g = this.game;
    const spot = g.picked;
    if (!spot || g.selected) {
      if (this.cache.get('picker') !== '') {
        this.cache.set('picker', '');
        this.picker.classList.add('hidden');
        this.picker.innerHTML = '';
      }
      return;
    }
    const bonus = spot.elevated
      ? g.map.highGround
          .map((b) => [b.range ? `+${Math.round(b.range * 100)}% ${t('range')}` : '', b.damage ? `+${Math.round(b.damage * 100)}% ${t('damage')}` : '', b.role ? `(${roleName(b.role)})` : ''].filter(Boolean).join(' '))
          .join(', ')
      : '';
    const rows = g.squad
      .map((u, i) => {
        const c = roleColorCss(u.role);
        const cost = u.tiers[0].cost;
        return `<button class="unit-card" style="--c:${c};min-height:56px" data-act="pickUnit" data-i="${i}" ${g.money < cost ? 'disabled' : ''}>
          <div class="flex items-center justify-between gap-2">
            <span class="nick">${u.nick}</span>
            <b class="font-display text-gold">${fmtMoney(cost)}</b>
          </div>
          <div class="text-[11px]" style="color:${c}">${ROLE_ICONS[u.role]} ${roleName(u.role)} · <span class="text-slate-400">${passiveName(u.passive)}</span></div>
        </button>`;
      })
      .join('');
    const html = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <div class="font-display text-lg font-extrabold text-white leading-tight">${t('slotTitle', { slot: loc(spot.name) })}</div>
          <div class="text-xs text-slate-400">${t('chooseUnit')}</div>
          ${bonus ? `<div class="text-xs text-gold mt-1">★ ${t('bonusSlot')}: ${bonus}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-icon" data-act="closeSide">${icon('close')}</button>
      </div>
      <div class="flex flex-col gap-1.5">${rows}</div>`;
    if (this.cache.get('picker') !== html) {
      this.cache.set('picker', html);
      this.picker.innerHTML = html;
      this.picker.classList.remove('hidden');
    }
  }

  private bonusText(b: { range: number; damage: number; fireRate: number }): string {
    return [
      b.range ? `+${Math.round(b.range * 100)}% ${t('range')}` : '',
      b.damage ? `+${Math.round(b.damage * 100)}% ${t('damage')}` : '',
      b.fireRate ? `+${Math.round(b.fireRate * 100)}% ${t('fireRate')}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Прямоугольники HUD — под ними 3D-подписи скрываются */
  getBlockers(): DOMRect[] {
    const out: DOMRect[] = [];
    this.el.querySelectorAll<HTMLElement>('.hud-cluster, .hud-bottom, [data-inspector], [data-picker], [data-hint], [data-next]').forEach((el) => {
      if (el.classList.contains('hidden') || el.style.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r);
    });
    return out;
  }
}
