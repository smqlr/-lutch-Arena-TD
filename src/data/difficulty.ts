import type { DifficultyId, Loc } from '../types/game';

export interface DifficultyDef {
  id: DifficultyId;
  name: Loc;
  color: string;
  hp: number;
  count: number;
  speed: number;
  extraWaves: number;
  startMoney: number;
  credits: number;
  /** Побед на этой сложности, чтобы открыть следующую карту */
  unlockWins: number;
  gemChance: number;
}

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'veryhard', 'nightmare'];

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: { id: 'easy', name: { ru: 'Лёгкий', en: 'Easy' }, color: '#22c55e', hp: 0.7, count: 0.9, speed: 1, extraWaves: 0, startMoney: 1.25, credits: 0.5, unlockWins: 15, gemChance: 0 },
  normal: { id: 'normal', name: { ru: 'Нормальный', en: 'Normal' }, color: '#00f0ff', hp: 1, count: 1, speed: 1, extraWaves: 0, startMoney: 1, credits: 1, unlockWins: 10, gemChance: 0 },
  hard: { id: 'hard', name: { ru: 'Сложный', en: 'Hard' }, color: '#f59e0b', hp: 1.1, count: 1.03, speed: 1.02, extraWaves: 0, startMoney: 1, credits: 1.5, unlockWins: 6, gemChance: 0 },
  veryhard: { id: 'veryhard', name: { ru: 'Очень сложный', en: 'Very hard' }, color: '#ef4444', hp: 1.2, count: 1.06, speed: 1.04, extraWaves: 1, startMoney: 1, credits: 2, unlockWins: 3, gemChance: 0 },
  nightmare: { id: 'nightmare', name: { ru: 'Кошмар', en: 'Nightmare' }, color: '#c084fc', hp: 1.3, count: 1.1, speed: 1.06, extraWaves: 3, startMoney: 1, credits: 3, unlockWins: 1, gemChance: 0.2 },
};

/** Усиление сложности сильнее на ранних картах (там больше запас) и мягче на поздних */
const MAP_SCALE = [1.6, 1.4, 1, 0.55, 0.45];

function scaled(v: number, mapDifficulty: number): number {
  return v <= 1 ? v : 1 + (v - 1) * MAP_SCALE[Math.min(4, Math.max(0, mapDifficulty - 1))];
}

export const diffHp = (d: DifficultyDef, mapDifficulty: number) => scaled(d.hp, mapDifficulty);
export const diffCount = (d: DifficultyDef, mapDifficulty: number) => scaled(d.count, mapDifficulty);

export function nightmareGems(mapDifficulty: number): number {
  return 5 + 5 * mapDifficulty;
}
