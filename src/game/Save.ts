import type { DifficultyId, MapId, MatchResult, SaveData } from '../types/game';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../data/difficulty';
import { MAP_ORDER } from '../types/game';
import { STARTER_UNITS, getUnit } from '../data/units';
import type { Platform } from '../sdk/Platform';
import { ADS_PER_GEM_REWARD, AD_CREDITS, CREDITS_PER_GEM, GEM_REWARD, gemPrice } from '../data/economy';

/**
 * Мета-прогрессия: кредиты, открытые юниты, отряд и карты.
 * localStorage обёрнут в try/catch (приватный режим, запрет cookies) + облачное сохранение площадки (CrazyGames), если доступно.
 */

const KEY = 'clutch-arena-td-save-v1';
export const START_CREDITS = 500;
export const SQUAD_SIZE = 5;

export function defaultSave(): SaveData {
  return {
    version: 1,
    credits: START_CREDITS,
    gems: 0,
    adsWatched: 0,
    tutorialDone: false,
    difficulty: 'normal',
    winsBy: {},
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
  d.gems = Math.max(0, Math.floor(num(r.gems, 0)));
  d.adsWatched = Math.max(0, Math.floor(num(r.adsWatched, 0)));
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
  // Старые сохранения (уже играли) обучение не показывают
  d.tutorialDone = r.tutorialDone === true || d.matches > 0;
  d.difficulty = DIFFICULTY_ORDER.includes(r.difficulty as DifficultyId) ? (r.difficulty as DifficultyId) : 'normal';
  if (r.winsBy && typeof r.winsBy === 'object') {
    for (const m of MAP_ORDER) {
      const v = (r.winsBy as Record<string, unknown>)[m];
      if (Array.isArray(v)) d.winsBy[m] = DIFFICULTY_ORDER.map((_, i) => Math.max(0, Math.floor(num(v[i], 0))));
    }
  }
  d.updatedAt = num(r.updatedAt, 0);
  return d;
}

export class SaveManager {
  data: SaveData;
  private sdk: Platform;

  constructor(sdk: Platform) {
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

  /** Засчитать просмотренную рекламу. Возвращает число гемов, если набрана очередная десятка */
  recordAd(withCredits: boolean): { credits: number; gems: number } {
    this.data.adsWatched += 1;
    const credits = withCredits ? AD_CREDITS : 0;
    const gems = this.data.adsWatched % ADS_PER_GEM_REWARD === 0 ? GEM_REWARD : 0;
    this.data.credits += credits;
    this.data.gems += gems;
    this.save();
    return { credits, gems };
  }

  /** Просмотрено в текущей десятке (0…9) */
  get adProgress(): number {
    return this.data.adsWatched % ADS_PER_GEM_REWARD;
  }

  addGems(amount: number): void {
    this.data.gems += Math.max(0, Math.floor(amount));
    this.save();
  }

  /** Обмен гемов на кредиты по курсу 1 : 100 */
  exchangeGems(gems: number): boolean {
    if (gems <= 0 || this.data.gems < gems) return false;
    this.data.gems -= gems;
    this.data.credits += gems * CREDITS_PER_GEM;
    this.save();
    return true;
  }

  completeTutorial(credits: number, gems: number): void {
    if (this.data.tutorialDone) return;
    this.data.tutorialDone = true;
    this.data.credits += credits;
    this.data.gems += gems;
    this.save();
  }

  skipTutorial(): void {
    this.data.tutorialDone = true;
    this.save();
  }

  isOwned(id: string): boolean {
    return this.data.owned.includes(id);
  }

  buyUnit(id: string, withGems = false): 'ok' | 'owned' | 'credits' | 'gems' {
    const u = getUnit(id);
    if (!u) return 'owned';
    if (this.isOwned(id)) return 'owned';
    if (withGems) {
      const g = gemPrice(u.price);
      if (this.data.gems < g) return 'gems';
      this.data.gems -= g;
    } else {
      if (this.data.credits < u.price) return 'credits';
      this.data.credits -= u.price;
    }
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

  buyMap(id: MapId, price: number, withGems = false): 'ok' | 'credits' | 'gems' | 'owned' {
    if (this.isMapUnlocked(id)) return 'owned';
    if (withGems) {
      const g = gemPrice(price);
      if (this.data.gems < g) return 'gems';
      this.data.gems -= g;
    } else {
      if (this.data.credits < price) return 'credits';
      this.data.credits -= price;
    }
    this.data.unlockedMaps.push(id);
    this.save();
    return 'ok';
  }

  selectMap(id: MapId): void {
    if (!this.isMapUnlocked(id)) return;
    this.data.selectedMap = id;
    this.save();
  }

  setDifficulty(id: DifficultyId): void {
    this.data.difficulty = id;
    this.save();
  }

  winsOn(map: MapId): number[] {
    return this.data.winsBy[map] ?? DIFFICULTY_ORDER.map(() => 0);
  }

  /** Следующая карта открывается, если на этой набрано нужное число побед хотя бы на одной сложности */
  meetsUnlock(map: MapId): boolean {
    const w = this.winsOn(map);
    return DIFFICULTY_ORDER.some((d, i) => w[i] >= DIFFICULTIES[d].unlockWins);
  }

  recordMatch(r: MatchResult): { record: boolean; unlocked: MapId | null } {
    const prev = this.data.best[r.mapId] ?? 0;
    const record = r.wavesCleared > prev;
    if (record) this.data.best[r.mapId] = r.wavesCleared;
    let unlocked: MapId | null = null;
    if (r.victory) {
      this.data.wins[r.mapId] = (this.data.wins[r.mapId] ?? 0) + 1;
      const w = this.winsOn(r.mapId).slice();
      w[DIFFICULTY_ORDER.indexOf(r.difficulty)] += 1;
      this.data.winsBy[r.mapId] = w;
      const next = MAP_ORDER[MAP_ORDER.indexOf(r.mapId) + 1];
      if (next && !this.data.unlockedMaps.includes(next) && this.meetsUnlock(r.mapId)) {
        this.data.unlockedMaps.push(next);
        unlocked = next;
      }
    }
    this.data.gems += r.gems;
    this.data.credits += r.credits;
    this.data.totalKills += r.kills;
    this.data.matches += 1;
    this.save();
    return { record, unlocked };
  }
}
