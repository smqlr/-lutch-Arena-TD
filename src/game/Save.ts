import type { MapId, MatchResult, SaveData } from '../types/game';
import { MAP_ORDER } from '../types/game';
import { STARTER_UNITS, getUnit } from '../data/units';
import type { YandexSDK } from '../sdk/YandexSDK';

/**
 * Мета-прогрессия: кредиты, открытые юниты, отряд и карты.
 * localStorage обёрнут в try/catch (приватный режим, запрет cookies) + облако Яндекса, если доступно.
 */

const KEY = 'clutch-arena-td-save-v1';
export const START_CREDITS = 500;
export const SQUAD_SIZE = 5;

export function defaultSave(): SaveData {
  return {
    version: 1,
    credits: START_CREDITS,
    owned: [...STARTER_UNITS],
    squad: [...STARTER_UNITS],
    unlockedMaps: ['bazaar'],
    best: {},
    wins: {},
    muted: false,
    lang: null,
    selectedMap: 'bazaar',
    totalKills: 0,
    matches: 0,
    updatedAt: 0,
  };
}

function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  d.credits = Math.max(0, Math.floor(num(r.credits, d.credits)));
  if (Array.isArray(r.owned)) {
    const owned = r.owned.filter((id): id is string => typeof id === 'string' && !!getUnit(id));
    d.owned = Array.from(new Set([...STARTER_UNITS, ...owned]));
  }
  if (Array.isArray(r.squad)) {
    const squad = r.squad.filter((id): id is string => typeof id === 'string' && d.owned.includes(id));
    d.squad = Array.from(new Set(squad)).slice(0, SQUAD_SIZE);
    if (!d.squad.length) d.squad = [...STARTER_UNITS];
  }
  if (Array.isArray(r.unlockedMaps)) {
    const maps = r.unlockedMaps.filter((m): m is MapId => MAP_ORDER.includes(m as MapId));
    d.unlockedMaps = Array.from(new Set<MapId>(['bazaar', ...maps]));
  }
  if (r.best && typeof r.best === 'object') {
    for (const m of MAP_ORDER) {
      const v = (r.best as Record<string, unknown>)[m];
      if (typeof v === 'number') d.best[m] = v;
    }
  }
  if (r.wins && typeof r.wins === 'object') {
    for (const m of MAP_ORDER) {
      const v = (r.wins as Record<string, unknown>)[m];
      if (typeof v === 'number') d.wins[m] = v;
    }
  }
  d.muted = !!r.muted;
  d.lang = r.lang === 'ru' || r.lang === 'en' ? r.lang : null;
  d.selectedMap = MAP_ORDER.includes(r.selectedMap as MapId) && d.unlockedMaps.includes(r.selectedMap as MapId) ? (r.selectedMap as MapId) : 'bazaar';
  d.totalKills = Math.max(0, Math.floor(num(r.totalKills, 0)));
  d.matches = Math.max(0, Math.floor(num(r.matches, 0)));
  d.updatedAt = num(r.updatedAt, 0);
  return d;
}

export class SaveManager {
  data: SaveData;
  private sdk: YandexSDK;

  constructor(sdk: YandexSDK) {
    this.sdk = sdk;
    this.data = this.loadLocal();
  }

  private loadLocal(): SaveData {
    try {
      const s = window.localStorage.getItem(KEY);
      return s ? sanitize(JSON.parse(s)) : defaultSave();
    } catch {
      return defaultSave();
    }
  }

  /** Подтягивает облачное сохранение, если оно новее локального */
  async syncCloud(): Promise<void> {
    const cloud = await this.sdk.loadCloud();
    if (!cloud) return;
    const c = sanitize(cloud);
    if (c.updatedAt > this.data.updatedAt) {
      this.data = c;
      this.writeLocal();
    }
  }

  private writeLocal(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* хранилище недоступно — прогресс живёт до перезагрузки */
    }
  }

  save(): void {
    this.data.updatedAt = Date.now();
    this.writeLocal();
    this.sdk.saveCloud(this.data);
  }

  reset(): void {
    const keepLang = this.data.lang;
    const keepMuted = this.data.muted;
    this.data = defaultSave();
    this.data.lang = keepLang;
    this.data.muted = keepMuted;
    this.save();
  }

  /* ------------------------------ Операции ------------------------------- */

  spend(amount: number): boolean {
    if (this.data.credits < amount) return false;
    this.data.credits -= amount;
    this.save();
    return true;
  }

  addCredits(amount: number): void {
    this.data.credits += Math.max(0, Math.floor(amount));
    this.save();
  }

  isOwned(id: string): boolean {
    return this.data.owned.includes(id);
  }

  buyUnit(id: string): 'ok' | 'owned' | 'credits' {
    const u = getUnit(id);
    if (!u) return 'owned';
    if (this.isOwned(id)) return 'owned';
    if (this.data.credits < u.price) return 'credits';
    this.data.credits -= u.price;
    this.data.owned.push(id);
    if (this.data.squad.length < SQUAD_SIZE) this.data.squad.push(id);
    this.save();
    return 'ok';
  }

  toggleSquad(id: string): 'added' | 'removed' | 'full' | 'last' | 'locked' {
    if (!this.isOwned(id)) return 'locked';
    const i = this.data.squad.indexOf(id);
    if (i >= 0) {
      if (this.data.squad.length <= 1) return 'last';
      this.data.squad.splice(i, 1);
      this.save();
      return 'removed';
    }
    if (this.data.squad.length >= SQUAD_SIZE) return 'full';
    this.data.squad.push(id);
    this.save();
    return 'added';
  }

  isMapUnlocked(id: MapId): boolean {
    return this.data.unlockedMaps.includes(id);
  }

  unlockMap(id: MapId): void {
    if (!this.isMapUnlocked(id)) {
      this.data.unlockedMaps.push(id);
      this.save();
    }
  }

  buyMap(id: MapId, price: number): 'ok' | 'credits' | 'owned' {
    if (this.isMapUnlocked(id)) return 'owned';
    if (this.data.credits < price) return 'credits';
    this.data.credits -= price;
    this.data.unlockedMaps.push(id);
    this.save();
    return 'ok';
  }

  selectMap(id: MapId): void {
    if (!this.isMapUnlocked(id)) return;
    this.data.selectedMap = id;
    this.save();
  }

  /** Записывает итог матча. Возвращает true, если поставлен новый рекорд волны */
  recordMatch(r: MatchResult): boolean {
    const prev = this.data.best[r.mapId] ?? 0;
    const record = r.wavesCleared > prev;
    if (record) this.data.best[r.mapId] = r.wavesCleared;
    if (r.victory) this.data.wins[r.mapId] = (this.data.wins[r.mapId] ?? 0) + 1;
    if (r.unlockedNext && !this.data.unlockedMaps.includes(r.unlockedNext)) this.data.unlockedMaps.push(r.unlockedNext);
    this.data.credits += r.credits;
    this.data.totalKills += r.kills;
    this.data.matches += 1;
    this.save();
    return record;
  }
}
