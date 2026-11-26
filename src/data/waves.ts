import type { EnemyKind, Loc, MapDef, WaveDef, WaveGroup, WaveTag } from '../types/game';

export const WAVE_NAMES: Record<WaveTag, Loc> = {
  pistol: { ru: 'Пистолетка', en: 'Pistol round' },
  eco: { ru: 'Эко-раунд', en: 'Eco round' },
  force: { ru: 'Форс-бай', en: 'Force buy' },
  rush: { ru: 'Раш-Б', en: 'Rush B' },
  smoke: { ru: 'Смокеры', en: 'Smokers' },
  lag: { ru: 'Пинг 999', en: 'Ping 999' },
  ddos: { ru: 'DDoS-атака', en: 'DDoS attack' },
  scream: { ru: 'Крикуны', en: 'Screamers' },
  full: { ru: 'Фулл-бай', en: 'Full buy' },
  boss: { ru: 'Босс: Спинбот', en: 'Boss: Spinbot' },
  noobs: { ru: 'Баер-раунд', en: 'Buyer round' },
  afk: { ru: 'АФК-стена', en: 'AFK wall' },
  toxic: { ru: 'Токсики', en: 'Toxics' },
  flash: { ru: 'Флеш-тролли', en: 'Flash trolls' },
  cheaters: { ru: 'Читеры', en: 'Cheaters' },
};

const g = (kind: EnemyKind, count: number, interval: number, delay = 0): WaveGroup => ({ kind, count, interval, delay });

/** Множитель HP волны: плавный рост + квадратичный хвост. */
export function waveHpMul(n: number, map: MapDef): number {
  const k = n - 1;
  return (1 + 0.14 * k + 0.012 * k * k) * map.hpScale;
}

/** Бонус в конце волны */
export function waveBonus(n: number): number {
  return 80 + n * 15;
}

function isBossWave(n: number, total: number): boolean {
  return n === total || (n >= 10 && n % 5 === 0);
}

function baseGroups(tag: WaveTag): WaveGroup[] {
  switch (tag) {
    case 'pistol':
      return [g('eco', 6, 1.4)];
    case 'eco':
      return [g('eco', 9, 1.0), g('smurf', 2, 1.4, 7)];
    case 'force':
      return [g('rusher', 5, 1.0), g('armored', 2, 1.8, 5)];
    case 'rush':
      return [g('rusher', 12, 0.55)];
    case 'smoke':
      return [g('eco', 8, 0.8), g('smoker', 3, 3, 3), g('rusher', 6, 0.7, 10)];
    case 'lag':
      return [g('ping', 6, 1.4), g('smurf', 8, 0.6, 4)];
    case 'ddos':
      return [g('armored', 6, 1.2), g('ddos', 4, 2.2, 3)];
    case 'scream':
      return [g('screamer', 3, 3.5), g('rusher', 14, 0.5, 1)];
    case 'full':
      return [g('armored', 6, 1.1), g('smoker', 2, 3.5, 2), g('smurf', 8, 0.55, 6), g('ping', 3, 1.6, 9)];
    case 'boss':
      return [g('eco', 10, 0.7), g('spinbot', 1, 1, 4), g('armored', 4, 1.4, 8)];
    case 'noobs':
      return [g('noob', 5, 1.5), g('eco', 6, 0.8, 2)];
    case 'afk':
      return [g('afk', 3, 3.0), g('rusher', 10, 0.6, 2)];
    case 'toxic':
      return [g('toxic', 4, 2.2), g('armored', 4, 1.5, 3)];
    case 'flash':
      return [g('flasher', 4, 2.4), g('smurf', 8, 0.6, 2)];
    case 'cheaters':
      return [g('cheater', 4, 2.2), g('lagger', 4, 1.8, 4)];
  }
}

const EARLY: WaveTag[] = ['pistol', 'eco', 'force', 'rush', 'smoke', 'lag', 'ddos', 'scream', 'full'];

/**
 * Цикл поздних волн (n > 9) зависит от сложности карты: новые теги открываются постепенно.
 * Новые теги стоят ближе к началу цикла, чтобы гарантированно выпасть на картах с 12–18 волнами.
 */
function lateCycle(difficulty: number): WaveTag[] {
  if (difficulty <= 1) return ['force', 'afk', 'rush', 'noobs', 'smoke', 'lag', 'ddos', 'scream', 'full'];
  if (difficulty <= 3) return ['force', 'toxic', 'noobs', 'flash', 'afk', 'rush', 'smoke', 'lag', 'ddos', 'scream', 'full'];
  if (difficulty === 4) return ['force', 'cheaters', 'toxic', 'noobs', 'flash', 'afk', 'rush', 'smoke', 'lag', 'ddos', 'scream', 'full'];
  // Развязка: тяжёлые «Фулл-бай» и «Крикуны» чередуются с новыми угрозами
  return ['force', 'cheaters', 'full', 'toxic', 'noobs', 'afk', 'flash', 'scream', 'ddos', 'lag', 'smoke', 'rush'];
}

/** Подмешивание новых врагов в базовые волны 4–9 (фиксированные количества из ТЗ) */
function earlyMixins(n: number, difficulty: number): WaveGroup[] {
  const out: WaveGroup[] = [];
  if (n === 4) out.push(g('noob', 2, 1.5, 4));
  if (n === 8) out.push(g('afk', 2, 3.0, 3));
  if (difficulty >= 2 && n === 7) out.push(g('toxic', 2, 2.2, 4));
  if (difficulty >= 2 && n === 9) out.push(g('flasher', 2, 2.4, 5));
  if (difficulty >= 3 && n === 6) out.push(g('lagger', 3, 1.8, 3));
  return out;
}

export function buildWave(n: number, map: MapDef): WaveDef {
  const boss = isBossWave(n, map.waves);
  const cycle = lateCycle(map.difficulty);
  let tag: WaveTag;
  if (boss) tag = 'boss';
  else if (n <= EARLY.length) tag = EARLY[n - 1];
  else tag = cycle[(n - EARLY.length - 1) % cycle.length];

  const late = Math.max(0, n - 9);
  const countMul = (1 + late * 0.13) * (1 + (map.difficulty - 1) * 0.07);
  const intervalMul = 1 / (1 + late * 0.05);
  const scale = (gr: WaveGroup, k = 1, minCount = 1): WaveGroup => ({
    ...gr,
    count: gr.kind === 'spinbot' ? gr.count : Math.max(minCount, Math.round(gr.count * k * countMul)),
    interval: gr.interval * intervalMul,
  });

  let groups = baseGroups(tag).map((gr) => scale(gr));
  if (n >= 4 && n <= 9) groups = groups.concat(earlyMixins(n, map.difficulty));

  if (n > 10 && !boss) {
    // «Примесь» другого типа из цикла этой карты
    const extra = cycle[(n * 3) % cycle.length];
    groups = groups.concat(baseGroups(extra).slice(0, 1).map((gr) => ({ ...scale(gr, 0.5, 2), delay: gr.delay + 6 })));
    // Старый квартал: Лаггеры подмешиваются в доп. группы
    if (map.difficulty === 3) groups.push(scale(g('lagger', 2, 1.8, 5)));
    // Развязка: усиленные миксы — вторая примесь из новых врагов
    if (map.difficulty >= 5) {
      const pool: WaveTag[] = ['cheaters', 'toxic', 'flash', 'afk', 'noobs'];
      const extra2 = pool[n % pool.length];
      groups = groups.concat(baseGroups(extra2).slice(0, 1).map((gr) => ({ ...scale(gr, 0.5, 2), delay: gr.delay + 11 })));
    }
  }

  // Эскорт финального босса
  if (boss && n === map.waves && n > 10) {
    groups.push(g('screamer', 2, 4, 10), g('ddos', 3, 2.5, 12), g('smoker', 2, 4, 14));
    if (map.difficulty >= 3) groups.push(g('afk', 2, 3, 1), g('flasher', 2, 2.4, 8));
    if (map.difficulty >= 4) groups.push(g('cheater', 2, 2.2, 14), g('toxic', 2, 2.2, 16), g('spinbot', 1, 1, 26));
  }

  return {
    number: n,
    tag,
    name: WAVE_NAMES[tag],
    groups,
    boss,
    hpMul: waveHpMul(n, map),
    bonus: waveBonus(n),
  };
}

export function buildAllWaves(map: MapDef): WaveDef[] {
  const out: WaveDef[] = [];
  for (let i = 1; i <= map.waves; i++) out.push(buildWave(i, map));
  return out;
}

/** Состав волны для превью: тип → количество */
export function waveComposition(w: WaveDef): Map<EnemyKind, number> {
  const m = new Map<EnemyKind, number>();
  for (const gr of w.groups) m.set(gr.kind, (m.get(gr.kind) ?? 0) + gr.count);
  return m;
}

/** Все типы врагов, которые реально встречаются на карте (для превью в меню) */
export function mapEnemyKinds(map: MapDef): Set<EnemyKind> {
  const kinds = new Set<EnemyKind>();
  for (const w of buildAllWaves(map)) for (const gr of w.groups) kinds.add(gr.kind);
  return kinds;
}
