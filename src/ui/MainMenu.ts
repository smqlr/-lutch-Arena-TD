import type { DifficultyId, Lang, MapId, Role } from '../types/game';
import { DIFFICULTIES, DIFFICULTY_ORDER, diffHp, nightmareGems } from '../data/difficulty';
import { mapEnemyKinds, totalWaves } from '../data/waves';
import { MAP_ORDER, ROLES } from '../types/game';
import { MAPS } from '../data/maps';
import { UNITS, getUnit } from '../data/units';
import { ENEMIES } from '../data/enemies';
import type { SaveManager } from '../game/Save';
import { SQUAD_SIZE } from '../game/Save';
import type { SoundFX } from '../engine/SoundFX';
import {
  RARITY_COLORS,
  ROLE_ICONS,
  fmtMoney,
  fmtNum,
  getLang,
  loc,
  passiveDesc,
  passiveName,
  rarityName,
  roleColorCss,
  roleDesc,
  roleName,
  t,
  weaponName,
} from '../i18n';
import { icon } from './icons';
import { confirmModal, toast } from './Overlay';
import { ADS_PER_GEM_REWARD, AD_CREDITS, CREDITS_PER_GEM, GEM_PACKS, GEM_REWARD, gemPrice } from '../data/economy';
import { UnitPreview } from './UnitPreview';

/**
 * Главное меню: выбор карты, редактор отряда (Loadout на 5 слотов), магазин 30 юнитов
 * с 3D-превью и настройки (язык, звук, полный экран, сброс прогресса).
 */

export interface MenuActions {
  startMatch(mapId: MapId): void;
  previewMap(mapId: MapId): void;
  setLang(lang: Lang): void;
  toggleMute(): boolean;
  isMuted(): boolean;
  toggleFullscreen(): void;
  resetProgress(): void;
  /** Rewarded-реклама за кредиты (и гемы за каждую десятую) */
  watchAd(): Promise<void>;
}

type Tab = 'play' | 'squad' | 'shop' | 'settings';

const TAB_WIDTH: Record<Tab, string> = {
  play: '560px',
  squad: '720px',
  shop: '1040px',
  settings: '560px',
};

export class MainMenu {
  readonly el: HTMLDivElement;
  private save: SaveManager;
  private sound: SoundFX;
  private actions: MenuActions;
  private tab: Tab = 'play';
  private filter: Role | 'all' = 'all';
  private shopSel: string;
  private shopTier = 0;
  private preview: UnitPreview | null = null;
  private visible = false;

  constructor(root: HTMLElement, save: SaveManager, sound: SoundFX, actions: MenuActions) {
    this.save = save;
    this.sound = sound;
    this.actions = actions;
    this.shopSel = UNITS[0].id;
    this.el = document.createElement('div');
    this.el.className = 'menu-shell';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  show(): void {
    this.visible = true;
    this.el.style.display = '';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(dt: number): void {
    if (this.visible && this.tab === 'shop' && this.preview) this.preview.render(dt);
  }

  /* ------------------------------ Действия ------------------------------- */

  private onClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const d = btn.dataset;
    const s = this.save;
    this.sound.ensure();
    this.sound.click();
    switch (d.act) {
      case 'tab':
        this.tab = d.tab as Tab;
        break;
      case 'selectMap': {
        const id = d.map as MapId;
        if (s.isMapUnlocked(id)) s.selectMap(id);
        this.mapFocus = id;
        this.actions.previewMap(id);
        break;
      }
      case 'diff':
        s.setDifficulty(d.diff as DifficultyId);
        break;
      case 'watchAd':
        btn.setAttribute('disabled', '');
        void this.actions.watchAd().then(() => this.render());
        return;
      case 'exchange': {
        const g = Number(d.gems);
        if (s.exchangeGems(g)) {
          this.sound.coin();
          toast(t('exchanged', { gems: g, credits: fmtNum(g * CREDITS_PER_GEM) }), 'gold');
        } else {
          this.sound.error();
          toast(t('notEnoughGems'), 'bad');
        }
        break;
      }
      case 'buyMap': {
        const id = d.map as MapId;
        const r = s.buyMap(id, MAPS[id].unlockPrice, d.gem === '1');
        if (r === 'ok') {
          s.selectMap(id);
          this.sound.upgrade();
          toast(t('mapUnlocked', { map: loc(MAPS[id].name) }), 'gold');
        } else if (r === 'credits' || r === 'gems') {
          this.sound.error();
          toast(t(r === 'gems' ? 'notEnoughGems' : 'notEnoughCredits'), 'bad');
        }
        break;
      }
      case 'start': {
        const id = this.mapFocus;
        if (!s.isMapUnlocked(id)) return;
        if (!s.data.squad.length) {
          toast(t('squadEmpty'), 'bad');
          return;
        }
        s.selectMap(id);
        this.actions.startMatch(id);
        return;
      }
      case 'toggleSquad': {
        const r = s.toggleSquad(d.unit!);
        if (r === 'full') {
          this.sound.error();
          toast(t('squadFull'), 'bad');
        } else if (r === 'last') {
          this.sound.error();
          toast(t('squadEmpty'), 'bad');
        }
        break;
      }
      case 'filter':
        this.filter = d.role as Role | 'all';
        break;
      case 'shopSel':
        this.shopSel = d.unit!;
        this.shopTier = 0;
        break;
      case 'shopTier':
        this.shopTier = Number(d.tier);
        break;
      case 'buyUnit': {
        const u = getUnit(d.unit!);
        if (!u) return;
        const r = s.buyUnit(u.id, d.gem === '1');
        if (r === 'ok') {
          this.sound.upgrade();
          toast(t('unitUnlocked', { nick: u.nick }), 'gold');
        } else if (r === 'credits' || r === 'gems') {
          this.sound.error();
          toast(t(r === 'gems' ? 'notEnoughGems' : 'notEnoughCredits'), 'bad');
        }
        break;
      }
      case 'lang':
        this.actions.setLang(d.lang as Lang);
        break;
      case 'mute':
        this.actions.toggleMute();
        break;
      case 'fullscreen':
        this.actions.toggleFullscreen();
        break;
      case 'reset':
        void confirmModal(t('resetProgress'), t('resetConfirm'), t('confirm'), true).then((ok) => {
          if (ok) {
            this.actions.resetProgress();
            toast(t('progressReset'), 'info');
            this.mapFocus = 'bazaar';
            this.actions.previewMap('bazaar');
            this.render();
          }
        });
        return;
    }
    this.render();
  }

  private mapFocus: MapId = 'bazaar';

  /** Синхронизирует фокус карты с сохранением при открытии меню */
  syncFocus(): void {
    this.mapFocus = this.save.data.selectedMap;
  }

  get focusedMap(): MapId {
    return this.mapFocus;
  }

  /* ------------------------------ Отрисовка ------------------------------ */

  render(): void {
    if (!this.visible) return;
    const s = this.save.data;
    const prevScroll = (this.el.querySelector('[data-scroll]') as HTMLElement | null)?.scrollTop ?? 0;
    const tabs: [Tab, string, string][] = [
      ['play', t('play'), icon('map')],
      ['squad', t('squad'), icon('users')],
      ['shop', t('shop'), icon('cart')],
      ['settings', t('settings'), icon('gear')],
    ];
    let body = '';
    switch (this.tab) {
      case 'play':
        body = this.renderPlay();
        break;
      case 'squad':
        body = this.renderSquad();
        break;
      case 'shop':
        body = this.renderShop();
        break;
      case 'settings':
        body = this.renderSettings();
        break;
    }
    this.el.innerHTML = `
      <aside class="flex flex-col h-full p-3 sm:p-5 gap-3" style="width:min(100%,${TAB_WIDTH[this.tab]})">
        <header class="flex items-start justify-between gap-3">
          <div>
            <div class="font-display font-extrabold tracking-wider text-white leading-none" style="font-size:clamp(26px,4vw,40px)">CLUTCH<span class="text-neon ml-2" style="text-shadow:0 0 22px rgba(0,240,255,.55)">ARENA</span></div>
            <div class="text-xs uppercase tracking-[0.3em] text-slate-400 mt-1">${t('gameSubtitle')}</div>
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <div class="flex gap-1.5">
              <div class="glass rounded-xl px-2.5 py-1.5 flex items-center gap-1.5" title="${t('credits')}">
                <span class="text-gold">${icon('coin')}</span>
                <span class="font-display text-lg font-extrabold text-gold leading-none">${fmtNum(s.credits)}</span>
              </div>
              <div class="glass rounded-xl px-2.5 py-1.5 flex items-center gap-1.5" title="${t('gems')}">
                <span class="text-gem">${icon('gem')}</span>
                <span class="font-display text-lg font-extrabold text-gem leading-none">${fmtNum(s.gems)}</span>
              </div>
            </div>
            ${this.adButton()}
          </div>
        </header>
        <nav class="flex gap-1 flex-wrap">
          ${tabs.map(([id, label, ic]) => `<button class="nav-tab ${this.tab === id ? 'is-active' : ''}" data-act="tab" data-tab="${id}">${ic}${label}</button>`).join('')}
        </nav>
        <section class="flex-1 min-h-0 scroll-y pr-1" data-scroll>${body}</section>
      </aside>`;
    const sc = this.el.querySelector('[data-scroll]') as HTMLElement | null;
    if (sc) sc.scrollTop = prevScroll;
    if (this.tab === 'shop') this.mountPreview();
  }

  /** Кнопка рекламы за кредиты с прогрессом до награды гемами */
  private adButton(): string {
    const done = this.save.adProgress;
    const left = ADS_PER_GEM_REWARD - done;
    const pct = Math.round((done / ADS_PER_GEM_REWARD) * 100);
    return `<button class="ad-btn" data-act="watchAd" title="${t('watchAdFor', { n: AD_CREDITS })}">
      <span class="flex items-center gap-1 font-bold">${icon('tv')} +${AD_CREDITS} <span class="text-gold">${icon('coin')}</span></span>
      <span class="ad-progress"><i style="width:${pct}%"></i></span>
      <span class="text-[10px] text-slate-400 whitespace-nowrap">${t('adProgress', { n: left, gems: GEM_REWARD })}</span>
    </button>`;
  }

  private mapCard(id: MapId): string {
    const m = MAPS[id];
    const s = this.save;
    const unlocked = s.isMapUnlocked(id);
    const active = this.mapFocus === id;
    const c = '#' + m.accent.toString(16).padStart(6, '0');
    const dots = Array.from({ length: 5 }, (_, i) => `<span class="diff-dot ${i < m.difficulty ? 'on' : ''}"></span>`).join('');
    const best = s.data.best[id];
    return `<button class="map-card ${active ? 'is-active' : ''} ${unlocked ? '' : 'is-locked'}" style="--c:${c}" data-act="selectMap" data-map="${id}">
      <div class="flex items-center justify-between gap-2">
        <div class="font-display text-lg font-extrabold text-white leading-none">${loc(m.name)}</div>
        ${unlocked ? `<span class="text-[11px] text-slate-400">${best ? t('bestWave', { n: best }) : ''}</span>` : `<span class="text-slate-400">${icon('lock')}</span>`}
      </div>
      <div class="flex items-center justify-between gap-2 text-xs">
        <span class="text-slate-400">${loc(m.tagline)}</span>
        <span>${dots}</span>
      </div>
    </button>`;
  }

  /** Прогресс открытия следующей карты: победы на карте по сложностям */
  private unlockProgress(from: MapId, target: MapId): string {
    const w = this.save.winsOn(from);
    const items = DIFFICULTY_ORDER.map((d, i) => {
      const df = DIFFICULTIES[d];
      return `<span class="chip" style="color:${df.color}">${loc(df.name)} ${Math.min(w[i], df.unlockWins)}/${df.unlockWins}</span>`;
    }).join(` <span class="text-[10px] text-slate-500">${t('unlockOr')}</span> `);
    return `<div class="text-[11px] uppercase tracking-widest text-slate-400 mt-3 mb-1">${t('unlockTitle', { map: loc(MAPS[target].name) })}</div><div class="flex flex-wrap items-center gap-1">${items}</div>`;
  }

  private renderPlay(): string {
    const s = this.save;
    const id = this.mapFocus;
    const m = MAPS[id];
    const unlocked = s.isMapUnlocked(id);
    const idx = MAP_ORDER.indexOf(id);
    const prev = idx > 0 ? MAPS[MAP_ORDER[idx - 1]] : null;
    const diff = DIFFICULTIES[s.data.difficulty];
    const nextId = MAP_ORDER[idx + 1];
    const diffSeg = DIFFICULTY_ORDER.map((d) => {
      const df = DIFFICULTIES[d];
      return `<button class="${d === diff.id ? 'is-on' : ''}" style="${d === diff.id ? `color:${df.color};border-color:${df.color}` : ''}" data-act="diff" data-diff="${d}">${loc(df.name)}</button>`;
    }).join('');
    const squad = s.data.squad.map((uid) => getUnit(uid)).filter((u): u is NonNullable<typeof u> => !!u);
    const squadSlots = Array.from({ length: SQUAD_SIZE }, (_, i) => {
      const u = squad[i];
      if (!u) return `<div class="squad-slot" style="height:48px"><span class="text-xs text-slate-500">${t('squadSlotEmpty')}</span></div>`;
      return `<div class="squad-slot is-filled" style="--c:${roleColorCss(u.role)};height:48px"><div class="font-display font-extrabold text-[13px] truncate">${u.nick}</div><div class="text-[10px]" style="color:${roleColorCss(u.role)}">${roleName(u.role)}</div></div>`;
    }).join('');
    // Только враги, которые реально появляются в волнах этой карты (без спавнов от способностей)
    const onMap = mapEnemyKinds(m);
    const enemyChips = (Object.keys(ENEMIES) as (keyof typeof ENEMIES)[])
      .filter((k) => onMap.has(k) && !ENEMIES[k].summon)
      .map((k) => {
        const e = ENEMIES[k];
        return `<span class="chip" title="${loc(e.desc)}" style="color:#${e.color.toString(16).padStart(6, '0')}">${loc(e.name)}</span>`;
      })
      .join('');
    return `
      <div class="text-[11px] uppercase tracking-widest text-slate-400 mb-2">${t('selectMap')}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${MAP_ORDER.map((mid) => this.mapCard(mid)).join('')}</div>
      <div class="glass rounded-xl p-4 mt-3">
        <div class="flex items-center justify-between gap-2">
          <div class="font-display text-2xl font-extrabold text-white">${loc(m.name)}</div>
          <span class="chip" style="color:#${m.accent.toString(16).padStart(6, '0')}">${t('difficulty')} ${m.difficulty}/5</span>
        </div>
        <p class="text-sm text-slate-300 mt-2 leading-relaxed">${loc(m.desc)}</p>
        <div class="grid grid-cols-3 gap-2 mt-3">
          <div class="stat-box"><span class="k">${t('startMoney')}</span><span class="v money">${fmtMoney(Math.round(m.startMoney * diff.startMoney))}</span></div>
          <div class="stat-box"><span class="k">${t('baseHp')}</span><span class="v hp-good">${m.baseHp}</span></div>
          <div class="stat-box"><span class="k">${t('waves')}</span><span class="v">${totalWaves(m, diff)}</span></div>
        </div>
        <div class="text-[11px] uppercase tracking-widest text-slate-400 mt-3 mb-1">${t('diffLabel')}</div>
        <div class="seg diff-seg flex-wrap">${diffSeg}</div>
        <div class="text-xs mt-1.5" style="color:${diff.color}">${t('diffStats', { hp: +diffHp(diff, m.difficulty).toFixed(2), cr: diff.credits, w: totalWaves(m, diff) })}${diff.gemChance ? ` · <span class="text-gem">${icon('gem')} ${t('diffGems', { p: Math.round(diff.gemChance * 100), n: nightmareGems(m.difficulty) })}</span>` : ''}</div>
        ${unlocked && nextId && !s.isMapUnlocked(nextId) ? this.unlockProgress(id, nextId) : ''}
        <div class="text-[11px] uppercase tracking-widest text-slate-400 mt-3 mb-1">${t('routes')}</div>
        <div class="flex flex-wrap gap-1">${m.routes.map((r) => `<span class="chip text-neon">${loc(r.name)}${r.fastOnly ? ' ⚡' : ''}</span>`).join('')}</div>
        <div class="text-[11px] uppercase tracking-widest text-slate-400 mt-3 mb-1">${t('enemies')}</div>
        <div class="flex flex-wrap gap-1">${enemyChips}</div>
        <div class="flex items-center justify-between mt-4 mb-1">
          <div class="text-[11px] uppercase tracking-widest text-slate-400">${t('yourSquad')}</div>
          <button class="btn btn-ghost text-xs" data-act="tab" data-tab="squad">${icon('users')} ${t('editSquad')}</button>
        </div>
        <div class="grid grid-cols-5 gap-1.5">${squadSlots}</div>
        <div class="mt-4">
          ${
            unlocked
              ? `<button class="btn btn-primary w-full font-display" style="padding:14px;font-size:20px;letter-spacing:.12em" data-act="start">${icon('sword')} ${t('startMatch').toUpperCase()}</button>`
              : `<div class="grid grid-cols-[1fr_auto] gap-2"><button class="btn btn-gold w-full" style="padding:12px;font-size:16px" data-act="buyMap" data-map="${id}" ${s.data.credits < m.unlockPrice ? 'disabled' : ''}>${icon('lock')} ${t('unlockFor', { price: fmtNum(m.unlockPrice) })}</button><button class="btn btn-gem" data-act="buyMap" data-map="${id}" data-gem="1" ${s.data.gems < gemPrice(m.unlockPrice) ? 'disabled' : ''}>${icon('gem')} ${gemPrice(m.unlockPrice)}</button></div>
                 ${prev ? this.unlockProgress(MAP_ORDER[idx - 1], id) : ''}`
          }
        </div>
      </div>`;
  }

  private unitCard(uid: string, act: string, active = false): string {
    const u = getUnit(uid)!;
    const s = this.save;
    const owned = s.isOwned(uid);
    const inSquad = s.data.squad.includes(uid);
    const c = roleColorCss(u.role);
    return `<button class="unit-card ${active ? 'is-active' : ''} ${owned ? '' : 'is-locked'} ${inSquad ? 'in-squad' : ''}" style="--c:${c}" data-act="${act}" data-unit="${uid}">
      <div class="nick pr-5 truncate">${u.nick}</div>
      <div class="text-[11px] font-bold" style="color:${c}">${ROLE_ICONS[u.role]} ${roleName(u.role)}</div>
      <div class="flex items-center justify-between mt-auto pt-1 text-[11px]">
        <span style="color:${RARITY_COLORS[u.rarity]}">${rarityName(u.rarity)}</span>
        ${owned ? `<span class="text-slate-400">${fmtMoney(u.tiers[0].cost)}</span>` : `<b class="text-gold">${icon('coin')} ${fmtNum(u.price)}</b>`}
      </div>
    </button>`;
  }

  private renderSquad(): string {
    const s = this.save;
    const squad = s.data.squad;
    const slots = Array.from({ length: SQUAD_SIZE }, (_, i) => {
      const uid = squad[i];
      const u = uid ? getUnit(uid) : null;
      if (!u) return `<div class="squad-slot"><span class="text-xs text-slate-500">${i + 1}. ${t('squadSlotEmpty')}</span></div>`;
      const c = roleColorCss(u.role);
      return `<button class="squad-slot is-filled" style="--c:${c}" data-act="toggleSquad" data-unit="${u.id}" title="${t('removeFromSquad')}">
        <div class="font-display font-extrabold text-sm truncate">${i + 1}. ${u.nick}</div>
        <div class="text-[11px]" style="color:${c}">${ROLE_ICONS[u.role]} ${roleName(u.role)}</div>
        <div class="text-[10px] text-slate-400 truncate">${passiveName(u.passive)}</div>
      </button>`;
    }).join('');
    const owned = UNITS.filter((u) => s.isOwned(u.id));
    return `
      <div class="text-[11px] uppercase tracking-widest text-slate-400 mb-2">${t('yourSquad')} · ${squad.length}/${SQUAD_SIZE}</div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">${slots}</div>
      <p class="text-xs text-slate-400 mt-3">${t('squadHint')}</p>
      <div class="text-[11px] uppercase tracking-widest text-slate-400 mt-4 mb-2">${t('unitsOwned', { n: owned.length, total: UNITS.length })}</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${owned.map((u) => this.unitCard(u.id, 'toggleSquad')).join('')}</div>
      <div class="mt-4"><button class="btn" data-act="tab" data-tab="shop">${icon('cart')} ${t('shop')}</button></div>`;
  }

  private renderShop(): string {
    const s = this.save;
    const list = UNITS.filter((u) => this.filter === 'all' || u.role === this.filter);
    const u = getUnit(this.shopSel) ?? UNITS[0];
    const c = roleColorCss(u.role);
    const owned = s.isOwned(u.id);
    const inSquad = s.data.squad.includes(u.id);
    const tier = u.tiers[this.shopTier];
    const filters = (['all', ...ROLES] as (Role | 'all')[])
      .map((r) => `<button class="${this.filter === r ? 'is-on' : ''}" data-act="filter" data-role="${r}">${r === 'all' ? t('allRoles') : ROLE_ICONS[r] + ' ' + roleName(r)}</button>`)
      .join('');
    const tierRows = u.tiers
      .map(
        (ti, i) => `<tr class="${i === this.shopTier ? 'text-white' : 'text-slate-400'}">
          <td class="py-0.5 pr-2 font-display font-extrabold">T${i + 1}</td>
          <td class="pr-2">${weaponName(ti.weapon)}</td>
          <td class="pr-2 text-right">${ti.damage}</td>
          <td class="pr-2 text-right">${ti.fireRate}</td>
          <td class="pr-2 text-right">${ti.range}</td>
          <td class="text-right text-gold">${fmtMoney(ti.cost)}</td>
        </tr>`,
      )
      .join('');
    let action = '';
    if (!owned) {
      action = `<div class="grid grid-cols-[1fr_auto] gap-2"><button class="btn btn-gold w-full" style="padding:12px;font-size:15px" data-act="buyUnit" data-unit="${u.id}" ${s.data.credits < u.price ? 'disabled' : ''}>${icon('coin')} ${t('buy')} · ${fmtNum(u.price)}</button><button class="btn btn-gem" style="padding:12px 14px" data-act="buyUnit" data-unit="${u.id}" data-gem="1" title="${t('buyGems')}" ${s.data.gems < gemPrice(u.price) ? 'disabled' : ''}>${icon('gem')} ${gemPrice(u.price)}</button></div>`;
    } else {
      action = `<button class="btn ${inSquad ? 'btn-danger' : 'btn-primary'} w-full" style="padding:12px;font-size:15px" data-act="toggleSquad" data-unit="${u.id}">${icon('users')} ${inSquad ? t('removeFromSquad') : t('addToSquad')}</button>`;
    }
    const packs = GEM_PACKS.map((g) => `<button class="btn btn-gem" data-act="exchange" data-gems="${g}" ${s.data.gems < g ? 'disabled' : ''}>${icon('gem')} ${g} → <span class="text-gold">${fmtNum(g * CREDITS_PER_GEM)}</span></button>`).join('');
    return `
      <div class="glass rounded-xl p-3 mb-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="font-display font-extrabold text-white flex items-center gap-1.5"><span class="text-gem">${icon('gem')}</span>${t('exchange')}</div>
          <div class="flex gap-1.5 flex-wrap">${packs}</div>
        </div>
        <div class="text-[11px] text-slate-400 mt-1.5">${t('exchangeHint')}</div>
      </div>
      <div class="seg mb-3 flex-wrap">${filters}</div>
      <div class="flex flex-col lg:flex-row gap-3">
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 content-start lg:w-[55%]">${list.map((x) => this.unitCard(x.id, 'shopSel', x.id === u.id)).join('')}</div>
        <div class="glass rounded-xl p-3 lg:w-[45%] lg:sticky lg:top-0 self-start w-full">
          <div class="h-[260px]" data-preview></div>
          <div class="flex items-center justify-between gap-2 mt-2">
            <div>
              <div class="font-display text-2xl font-extrabold text-white leading-none">${u.nick}</div>
              <div class="text-xs mt-1" style="color:${c}">${ROLE_ICONS[u.role]} ${roleName(u.role)} · <span style="color:${RARITY_COLORS[u.rarity]}">${rarityName(u.rarity)}</span></div>
            </div>
            <div class="seg">${[0, 1, 2].map((i) => `<button class="${this.shopTier === i ? 'is-on' : ''}" data-act="shopTier" data-tier="${i}">T${i + 1}</button>`).join('')}</div>
          </div>
          <p class="text-xs text-slate-300 mt-2 leading-relaxed">${loc(u.bio)}</p>
          <p class="text-[11px] text-slate-500 mt-1">${roleDesc(u.role)}</p>
          <div class="grid grid-cols-4 gap-1.5 mt-2">
            <div class="stat-box"><span class="k">${t('damage')}</span><span class="v">${tier.damage}</span></div>
            <div class="stat-box"><span class="k">${t('fireRate')}</span><span class="v">${tier.fireRate}</span></div>
            <div class="stat-box"><span class="k">${t('range')}</span><span class="v">${tier.range}</span></div>
            <div class="stat-box"><span class="k">${t('dps')}</span><span class="v text-gold">${Math.round(tier.damage * tier.fireRate)}</span></div>
          </div>
          <table class="w-full text-[11px] mt-2">
            <thead><tr class="text-slate-500 text-left"><th></th><th></th><th class="text-right pr-2">${t('damage')}</th><th class="text-right pr-2">${t('fireRate')}</th><th class="text-right pr-2">${t('range')}</th><th class="text-right">$</th></tr></thead>
            <tbody>${tierRows}</tbody>
          </table>
          <div class="mt-2 p-2 rounded-lg" style="background:rgba(13,13,18,.6);border:1px solid #2a3048">
            <div class="text-[10px] uppercase tracking-widest text-slate-400">${t('passive')}</div>
            <div class="font-bold text-sm" style="color:${c}">${passiveName(u.passive)}</div>
            <div class="text-xs text-slate-300">${passiveDesc(u.passive)}</div>
          </div>
          <div class="mt-3">${action}</div>
        </div>
      </div>`;
  }

  private mountPreview(): void {
    const host = this.el.querySelector('[data-preview]');
    if (!host) return;
    if (!this.preview) {
      try {
        this.preview = new UnitPreview();
      } catch {
        this.preview = null;
        return;
      }
    }
    host.appendChild(this.preview.canvas);
    const u = getUnit(this.shopSel) ?? UNITS[0];
    this.preview.show(u, this.shopTier);
  }

  private renderSettings(): string {
    const s = this.save.data;
    const lang = getLang();
    const muted = this.actions.isMuted();
    return `
      <div class="glass rounded-xl p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm">${icon('globe')} ${t('language')}</div>
          <div class="seg"><button class="${lang === 'ru' ? 'is-on' : ''}" data-act="lang" data-lang="ru">Русский</button><button class="${lang === 'en' ? 'is-on' : ''}" data-act="lang" data-lang="en">English</button></div>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm">${muted ? icon('mute') : icon('sound')} ${t('sound')}</div>
          <button class="btn ${muted ? '' : 'is-on'}" data-act="mute">${muted ? t('off') : t('on')}</button>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm">${icon('fullscreen')} ${t('fullscreen')}</div>
          <button class="btn" data-act="fullscreen">${icon('fullscreen')}</button>
        </div>
      </div>
      <div class="glass rounded-xl p-4 mt-3">
        <div class="font-display font-extrabold text-white mb-2">${icon('info')} ${t('howToPlay')}</div>
        <ul class="text-sm text-slate-300 flex flex-col gap-1.5 list-disc pl-5">
          <li>${t('howTo1')}</li><li>${t('howTo2')}</li><li>${t('howTo3')}</li><li>${t('howTo4')}</li>
        </ul>
        <div class="font-display font-extrabold text-white mt-4 mb-2">${t('controlsTitle')}</div>
        <ul class="text-sm text-slate-300 flex flex-col gap-1.5 list-disc pl-5">
          <li>${t('controls1')}</li><li>${t('controls2')}</li><li>${t('controls3')}</li>
        </ul>
      </div>
      <div class="glass rounded-xl p-4 mt-3">
        <div class="font-display font-extrabold text-white mb-2">${t('progress')}</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="stat-box"><span class="k">${t('unitsOwned', { n: '', total: '' }).replace(/[\d/:\s]+$/, '')}</span><span class="v">${s.owned.length}/${UNITS.length}</span></div>
          <div class="stat-box"><span class="k">${t('maps')}</span><span class="v">${s.unlockedMaps.length}/${MAP_ORDER.length}</span></div>
          <div class="stat-box"><span class="k">${t('kills')}</span><span class="v">${fmtNum(s.totalKills)}</span></div>
          <div class="stat-box"><span class="k">${t('wins', { n: '' }).replace(/[:\s]+$/, '')}</span><span class="v">${Object.values(s.wins).reduce((a, b) => a + (b ?? 0), 0)}</span></div>
        </div>
        <button class="btn btn-danger mt-3" data-act="reset">${icon('trash')} ${t('resetProgress')}</button>
      </div>`;
  }
}
