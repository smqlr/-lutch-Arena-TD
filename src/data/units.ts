import type { GearKind, Loc, Passive, PassiveKind, Rarity, Role, UnitDef, UnitLook, WeaponKind, WeaponTier } from '../types/game';

/**
 * Базовые характеристики тиров по ролям.
 * T1.cost — стоимость установки, T2/T3.cost — стоимость апгрейда.
 */
const ROLE_BASE: Record<Role, [Omit<WeaponTier, 'weapon'>, Omit<WeaponTier, 'weapon'>, Omit<WeaponTier, 'weapon'>]> = {
  awper: [
    { damage: 90, fireRate: 0.58, range: 12.5, pen: 0.85, splash: 0, cost: 185 },
    { damage: 175, fireRate: 0.64, range: 13.5, pen: 0.9, splash: 0, cost: 210 },
    { damage: 330, fireRate: 0.72, range: 15, pen: 0.95, splash: 0, cost: 420 },
  ],
  entry: [
    { damage: 13, fireRate: 4.2, range: 7, pen: 0.25, splash: 0, cost: 125 },
    { damage: 23, fireRate: 5.2, range: 7.6, pen: 0.45, splash: 0, cost: 170 },
    { damage: 37, fireRate: 6.6, range: 8.2, pen: 0.6, splash: 0, cost: 340 },
  ],
  igl: [
    { damage: 17, fireRate: 2.0, range: 8, pen: 0.4, splash: 0, cost: 150 },
    { damage: 29, fireRate: 2.4, range: 8.8, pen: 0.5, splash: 0, cost: 190 },
    { damage: 45, fireRate: 2.9, range: 9.6, pen: 0.6, splash: 0, cost: 370 },
  ],
  support: [
    { damage: 12, fireRate: 2.6, range: 7.5, pen: 0.3, splash: 0, cost: 140 },
    { damage: 21, fireRate: 3.0, range: 8.3, pen: 0.4, splash: 0, cost: 180 },
    { damage: 33, fireRate: 3.5, range: 9.2, pen: 0.5, splash: 0, cost: 360 },
  ],
  lurker: [
    { damage: 27, fireRate: 1.6, range: 8, pen: 0.5, splash: 0, cost: 140 },
    { damage: 47, fireRate: 1.9, range: 8.6, pen: 0.6, splash: 0, cost: 190 },
    { damage: 75, fireRate: 2.2, range: 9.5, pen: 0.7, splash: 0, cost: 380 },
  ],
};

interface StatMods {
  dmg?: number;
  rate?: number;
  range?: number;
  cost?: number;
  splash?: number;
}

function buildTiers(role: Role, weapons: [WeaponKind, WeaponKind, WeaponKind], m: StatMods = {}): [WeaponTier, WeaponTier, WeaponTier] {
  const base = ROLE_BASE[role];
  const out = base.map((b, i) => {
    const w = weapons[i];
    // Модификаторы класса оружия поверх роли
    let dmg = b.damage * (m.dmg ?? 1);
    let rate = b.fireRate * (m.rate ?? 1);
    let range = b.range * (m.range ?? 1);
    let splash = b.splash + (m.splash ?? 0);
    let pen = b.pen;
    if (w === 'autoSniper') {
      dmg *= 0.55;
      rate *= 1.85;
    } else if (w === 'lmg') {
      dmg *= 0.8;
      rate *= 1.3;
      pen = Math.min(0.9, pen + 0.1);
    } else if (w === 'shotgun') {
      dmg *= 2.4;
      rate *= 0.42;
      range *= 0.85;
      splash = Math.max(splash, 1.4);
    } else if (w === 'deagle') {
      dmg *= 1.7;
      rate *= 0.6;
      pen = Math.min(0.9, pen + 0.2);
    } else if (w === 'scout') {
      rate *= 1.05;
    }
    return {
      weapon: w,
      damage: Math.round(dmg),
      fireRate: Math.round(rate * 100) / 100,
      range: Math.round(range * 10) / 10,
      pen: Math.round(pen * 100) / 100,
      splash: Math.round(splash * 10) / 10,
      cost: Math.round((b.cost * (m.cost ?? 1)) / 5) * 5,
    } as WeaponTier;
  });
  return [out[0], out[1], out[2]];
}

const P = (kind: PassiveKind, a: number, b = 0, c = 0): Passive => ({ kind, a, b, c });

interface UnitSpec {
  id: string;
  nick: string;
  role: Role;
  rarity: Rarity;
  price: number;
  starter?: boolean;
  gear: GearKind;
  skin: number;
  hair: number;
  accent: number;
  weapons: [WeaponKind, WeaponKind, WeaponKind];
  mods?: StatMods;
  passive: Passive;
  bio: Loc;
}

const SPECS: UnitSpec[] = [
  /* ------------------------------- AWPer ------------------------------- */
  {
    id: 's1mply', nick: 'S1mply', role: 'awper', rarity: 'common', price: 0, starter: true,
    gear: 'headset', skin: 0xe8b894, hair: 0x2b1d14, accent: 0x22c55e,
    weapons: ['scout', 'sniper', 'sniper'],
    passive: P('crit', 0.25, 2.5),
    bio: { ru: 'Флики быстрее, чем враги успевают моргнуть. Любит длинные прострелы.', en: 'Flicks faster than enemies can blink. Loves long sightlines.' },
  },
  {
    id: 'nightowl', nick: 'M0n3sy', role: 'awper', rarity: 'rare', price: 650,
    gear: 'visor', skin: 0xc68e62, hair: 0x111111, accent: 0x14b8a6,
    weapons: ['scout', 'sniper', 'sniper'],
    passive: P('headshot', 0.12),
    bio: { ru: 'Тренируется по ночам. Каждый двенадцатый выстрел — точно в голову.', en: 'Trains at night. Every twelfth shot lands right between the eyes.' },
  },
  {
    id: 'kestrel', nick: 'Br0kky', role: 'awper', rarity: 'rare', price: 800,
    gear: 'cap', skin: 0xf1c7a3, hair: 0x9a6b3d, accent: 0x84cc16,
    weapons: ['scout', 'sniper', 'sniper'], mods: { dmg: 0.95 },
    passive: P('pierce', 2, 0.6),
    bio: { ru: 'Мастер прострелов: одна пуля — несколько фрагов в узких коридорах.', en: 'Wallbang specialist: one bullet, several frags in tight corridors.' },
  },
  {
    id: 'grimsight', nick: 'Sh1r0-K', role: 'awper', rarity: 'epic', price: 1400,
    gear: 'hood', skin: 0xdcae8a, hair: 0x3a2a1f, accent: 0x10b981,
    weapons: ['scout', 'sniper', 'sniper'], mods: { range: 1.05 },
    passive: P('crit', 0.35, 3),
    bio: { ru: 'Холодный расчёт и тяжёлые криты. Не промахивается по боссам.', en: 'Cold calculation and heavy crits. Never misses a boss.' },
  },
  {
    id: 'volt-aw', nick: 'W0nderfool', role: 'awper', rarity: 'epic', price: 1700,
    gear: 'helmet', skin: 0xa86f4c, hair: 0x1b1b1b, accent: 0x06b6d4,
    weapons: ['scout', 'autoSniper', 'autoSniper'],
    passive: P('rampUp', 0.06, 0.6),
    bio: { ru: 'Полуавтоматический снайпер: заливает плент свинцом в темпе рифлера.', en: 'Semi-auto sniper: floods the site with lead at a rifler pace.' },
  },
  {
    id: 'ex1le', nick: 'Dev1ze', role: 'awper', rarity: 'legendary', price: 2600,
    gear: 'beanie', skin: 0xe9c09a, hair: 0xd6c08a, accent: 0x4ade80,
    weapons: ['scout', 'sniper', 'sniper'], mods: { dmg: 1.15, range: 1.08 },
    passive: P('headshot', 0.2),
    bio: { ru: 'Легенда сцены: каждый пятый выстрел заканчивает раунд для врага.', en: 'A scene legend: every fifth shot ends the round for someone.' },
  },

  /* -------------------------- Entry Fragger --------------------------- */
  {
    id: 'd0nk-2k', nick: 'D0nk-2K', role: 'entry', rarity: 'common', price: 0, starter: true,
    gear: 'cap', skin: 0xf0c8a8, hair: 0x4a3426, accent: 0xef4444,
    weapons: ['smg', 'rifle', 'rifle'],
    passive: P('killStreak', 0.08, 6, 4),
    bio: { ru: 'Заходит первым и разгоняется с каждым фрагом. Остановить сложно.', en: 'First through the door, faster with every frag. Hard to stop.' },
  },
  {
    id: 'rampage', nick: 'B1t-Z', role: 'entry', rarity: 'common', price: 350,
    gear: 'helmet', skin: 0xc28a63, hair: 0x1a1a1a, accent: 0xf97316,
    weapons: ['smg', 'rifle', 'rifle'],
    passive: P('openingDuel', 0.7),
    bio: { ru: 'Выигрывает первые дуэли: свежие цели получают огромный урон.', en: 'Wins opening duels: fresh targets take massive damage.' },
  },
  {
    id: 'torrent', nick: 'Ropzik', role: 'entry', rarity: 'rare', price: 700,
    gear: 'headset', skin: 0x8d5a3b, hair: 0x0f0f0f, accent: 0xfb7185,
    weapons: ['smg', 'carbine', 'lmg'],
    passive: P('rampUp', 0.04, 0.4),
    bio: { ru: 'Контроль спрея: чем дольше держит цель, тем больнее бьёт.', en: 'Spray control: the longer the target, the harder the hits.' },
  },
  {
    id: 'spark1e', nick: 'Twistzzy', role: 'entry', rarity: 'rare', price: 900,
    gear: 'visor', skin: 0xf2d0b5, hair: 0xb45309, accent: 0xfacc15,
    weapons: ['shotgun', 'shotgun', 'shotgun'],
    passive: P('shrapnel', 0.4, 1.8),
    bio: { ru: 'Дробовик в узких местах: каждый выстрел задевает толпу.', en: 'Shotgun in tight spots: every blast clips the whole crowd.' },
  },
  {
    id: 'breach-r', nick: 'Elektrik', role: 'entry', rarity: 'epic', price: 1500,
    gear: 'helmet', skin: 0xd9a47e, hair: 0x2d2d2d, accent: 0xdc2626,
    weapons: ['smg', 'rifle', 'lmg'],
    passive: P('killStreak', 0.1, 8, 5),
    bio: { ru: 'Штурмовой пулемётчик. На серии фрагов превращается в турель.', en: 'Breach gunner. On a kill streak he turns into a turret.' },
  },
  {
    id: 'viper-k', nick: 'NiKoTin', role: 'entry', rarity: 'legendary', price: 2400,
    gear: 'hood', skin: 0xeab896, hair: 0x111827, accent: 0xf43f5e,
    weapons: ['smg', 'carbine', 'rifle'], mods: { dmg: 1.12, rate: 1.05 },
    passive: P('crit', 0.22, 2.2),
    bio: { ru: 'Ядовитые тапы в голову и бешеный темп. Звезда хайлайтов.', en: 'Venomous head taps and a wild pace. A highlight-reel star.' },
  },

  /* -------------------------------- IGL -------------------------------- */
  {
    id: 'maestro', nick: 'Karrigun', role: 'igl', rarity: 'common', price: 300,
    gear: 'cap', skin: 0xe0b08c, hair: 0x6b4f3a, accent: 0xf59e0b,
    weapons: ['pistol', 'rifle', 'carbine'],
    passive: P('auraSpeed', 0.15, 6),
    bio: { ru: 'Дирижёр раунда: задаёт темп всем, кто стоит рядом.', en: 'Round conductor: sets the tempo for everyone nearby.' },
  },
  {
    id: 'chessmind', nick: 'Aleksyb', role: 'igl', rarity: 'rare', price: 750,
    gear: 'headset', skin: 0xb07a55, hair: 0x2a1e16, accent: 0xeab308,
    weapons: ['pistol', 'carbine', 'rifle'],
    passive: P('auraDamage', 0.15, 6),
    bio: { ru: 'Думает на три раунда вперёд. Союзники бьют точнее.', en: 'Thinks three rounds ahead. Allies hit harder.' },
  },
  {
    id: 'overseer', nick: 'Ch0ppa', role: 'igl', rarity: 'rare', price: 850,
    gear: 'visor', skin: 0xf3cfb0, hair: 0x8b8b8b, accent: 0xfbbf24,
    weapons: ['pistol', 'rifle', 'rifle'],
    passive: P('auraRange', 0.15, 6.5),
    bio: { ru: 'Собирает инфу с каждой позиции — союзники видят дальше.', en: 'Gathers info from every spot — allies see further.' },
  },
  {
    id: 'tactix', nick: 'ApeXX', role: 'igl', rarity: 'epic', price: 1300,
    gear: 'beanie', skin: 0x9c6644, hair: 0x101010, accent: 0xf97316,
    weapons: ['deagle', 'rifle', 'carbine'],
    passive: P('auraEcon', 3, 6.5),
    bio: { ru: 'Экономист: каждый фраг рядом с ним приносит лишние деньги.', en: 'The economist: every frag next to him brings extra cash.' },
  },
  {
    id: 'capt-nova', nick: 'Gla1ve-9', role: 'igl', rarity: 'epic', price: 1600,
    gear: 'helmet', skin: 0xe4b38f, hair: 0x5c4033, accent: 0xfde047,
    weapons: ['pistol', 'carbine', 'carbine'],
    passive: P('auraDiscount', 0.2, 7),
    bio: { ru: 'Тайм-менеджмент: соседи апгрейдятся дешевле.', en: 'Time management: neighbours upgrade for less.' },
  },
  {
    id: 'archon', nick: 'Zeusik', role: 'igl', rarity: 'legendary', price: 2500,
    gear: 'headset', skin: 0xcf9b74, hair: 0x3b2f2f, accent: 0xf59e0b,
    weapons: ['deagle', 'rifle', 'rifle'], mods: { dmg: 1.1 },
    passive: P('auraDamage', 0.25, 7.5),
    bio: { ru: 'Капитан-чемпион. Его колл превращает отряд в машину.', en: 'Champion captain. His call turns the squad into a machine.' },
  },

  /* ------------------------------ Support ------------------------------ */
  {
    id: 'zyw0w-core', nick: 'Zyw0w-Core', role: 'support', rarity: 'common', price: 0, starter: true,
    gear: 'helmet', skin: 0xd8a27a, hair: 0x1f1f1f, accent: 0x3b82f6,
    weapons: ['pistol', 'smg', 'rifle'],
    passive: P('flash', 8, 1.5, 3.2),
    bio: { ru: 'Ядро отряда: флешки ослепляют толпу и разгоняют дым.', en: 'Core of the squad: flashes blind the crowd and clear smoke.' },
  },
  {
    id: 'ember', nick: 'Magixxx', role: 'support', rarity: 'common', price: 380,
    gear: 'beanie', skin: 0xf5d2b8, hair: 0xc2410c, accent: 0xf97316,
    weapons: ['pistol', 'smg', 'carbine'],
    passive: P('molotov', 9, 26, 4),
    bio: { ru: 'Молотов в каждый узкий проход. Выжигает дым и толпы.', en: 'A molotov for every choke. Burns smoke and crowds alike.' },
  },
  {
    id: 'bulwark', nick: 'Rain-0', role: 'support', rarity: 'rare', price: 800,
    gear: 'helmet', skin: 0xa0694a, hair: 0x2b2b2b, accent: 0x60a5fa,
    weapons: ['pistol', 'smg', 'rifle'],
    passive: P('heGrenade', 7, 90, 2.6),
    bio: { ru: 'Осколочные гранаты по скоплениям врагов. Сдувают дым.', en: 'HE grenades into enemy stacks. Blows smoke away.' },
  },
  {
    id: 'medic-9', nick: 'Hobb1t', role: 'support', rarity: 'rare', price: 950,
    gear: 'cap', skin: 0xe6b897, hair: 0x7c5a3c, accent: 0x38bdf8,
    weapons: ['pistol', 'carbine', 'carbine'],
    passive: P('slowZone', 8, 0.45, 4),
    bio: { ru: 'Ставит ловушки: враги вязнут, а дым рассеивается.', en: 'Sets traps: enemies bog down and smoke disperses.' },
  },
  {
    id: 'flashpoint', nick: 'Sp1nx', role: 'support', rarity: 'epic', price: 1500,
    gear: 'visor', skin: 0xf0c4a0, hair: 0xe5e7eb, accent: 0x93c5fd,
    weapons: ['smg', 'rifle', 'carbine'],
    passive: P('flash', 5, 2.2, 4),
    bio: { ru: 'Поп-флешки идеального тайминга — враги стоят как вкопанные.', en: 'Perfectly timed pop-flashes — enemies freeze in place.' },
  },
  {
    id: 'lumen', nick: 'Xyp9z', role: 'support', rarity: 'legendary', price: 2300,
    gear: 'headset', skin: 0xc9926b, hair: 0x18181b, accent: 0x818cf8,
    weapons: ['smg', 'carbine', 'rifle'], mods: { dmg: 1.1 },
    passive: P('molotov', 6, 48, 5),
    bio: { ru: 'Утилити-гений: огненные лужи накрывают целые маршруты.', en: 'Utility genius: fire pools blanket entire routes.' },
  },

  /* ------------------------------- Lurker ------------------------------ */
  {
    id: 'ghostwalk', nick: 'Fr0zenn', role: 'lurker', rarity: 'common', price: 320,
    gear: 'hood', skin: 0xe2b592, hair: 0x2e2e2e, accent: 0xa855f7,
    weapons: ['pistol', 'smg', 'carbine'],
    passive: P('cleanup', 0.6, 0.55),
    bio: { ru: 'Ждёт у плента и добивает всех, кто прорвался.', en: 'Waits near the site and finishes everyone who slips through.' },
  },
  {
    id: 'slyfox', nick: 'NAFF', role: 'lurker', rarity: 'common', price: 450,
    gear: 'cap', skin: 0xf3cba8, hair: 0xb45309, accent: 0xc084fc,
    weapons: ['pistol', 'carbine', 'carbine'],
    passive: P('saver', 0.08, 80),
    bio: { ru: 'Сейвер: бережёт деньги команды — банк приносит 8%.', en: 'The saver: protects team money — the bank pays 8%.' },
  },
  {
    id: 'shade', nick: 'KSKerato', role: 'lurker', rarity: 'rare', price: 750,
    gear: 'beanie', skin: 0x8a5a3c, hair: 0x0a0a0a, accent: 0x9333ea,
    weapons: ['deagle', 'carbine', 'rifle'],
    passive: P('execute', 0.15),
    bio: { ru: 'Тень за спиной: раненые враги не уходят живыми.', en: 'A shadow behind you: wounded enemies never escape.' },
  },
  {
    id: 'ph4ntom', nick: 'Stewie3K', role: 'lurker', rarity: 'rare', price: 1000,
    gear: 'hood', skin: 0xdfb08b, hair: 0x262626, accent: 0xd946ef,
    weapons: ['smg', 'carbine', 'carbine'],
    passive: P('backstab', 0.8),
    bio: { ru: 'Пропускает врагов мимо и стреляет в спину.', en: 'Lets enemies pass and shoots them in the back.' },
  },
  {
    id: 'nomad', nick: 'Ax1ee', role: 'lurker', rarity: 'epic', price: 1450,
    gear: 'visor', skin: 0xb98462, hair: 0x3f3f46, accent: 0x7c3aed,
    weapons: ['deagle', 'rifle', 'lmg'],
    passive: P('smokeSight', 0.5),
    bio: { ru: 'Читает дым как книгу: стреляет сквозь смоки Смокеров.', en: 'Reads smoke like a book: shoots right through Smoker clouds.' },
  },
  {
    id: 'wraith', nick: 'Olofmaster', role: 'lurker', rarity: 'legendary', price: 2700,
    gear: 'helmet', skin: 0xeec3a0, hair: 0x111111, accent: 0xa21caf,
    weapons: ['deagle', 'carbine', 'rifle'], mods: { dmg: 1.12 },
    passive: P('execute', 0.22),
    bio: { ru: 'Призрак клатчей: казнит всё, что опустилось ниже 22% HP.', en: 'Clutch phantom: executes anything below 22% HP.' },
  },
];

/* ------------------------------- Внешность ------------------------------- */

const DEFAULT_LOOK: UnitLook = {
  jersey: 0x2b3345,
  stripe: 0x111827,
  hairStyle: 'short',
  beard: 'none',
  glasses: 'none',
  capBackwards: false,
  sleeves: 'short',
  tattoos: false,
  prop: 'none',
  gloves: false,
  mask: false,
  tacVest: false,
  harness: false,
  height: 1,
  girth: 1,
  belly: false,
};

interface LookSpec extends Partial<UnitLook> {
  gear?: GearKind;
  hair?: number;
  accent?: number;
}

/**
 * Внешность юнитов: цвета джерси и акцента — по ТЗ, причёска, борода, очки,
 * головной убор и рукава — по концепт-арту «Юниты и враги».
 */
const LOOKS: Record<string, LookSpec> = {
  // AWPer
  s1mply: { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hair: 0xa0784a },
  nightowl: { jersey: 0x18181b, stripe: 0xf8fafc, gear: 'headset', hair: 0xd9b778, height: 1.05, girth: 0.92 },
  kestrel: { jersey: 0xdc2626, stripe: 0x111827, gear: 'headset', hair: 0x4a3222, sleeves: 'long' },
  grimsight: { jersey: 0xe5e7eb, stripe: 0x111827, gear: 'headset', hair: 0x5c3b24 },
  'volt-aw': { jersey: 0x1e3a8a, stripe: 0x38bdf8, gear: 'headset', hair: 0x2b1d14 },
  ex1le: { jersey: 0xb91c1c, stripe: 0x111827, gear: 'headset', hair: 0x2b1d14, beard: 'full', gloves: true },
  // Entry Fragger
  'd0nk-2k': { jersey: 0xf3f4f6, stripe: 0x111827, gear: 'headset', hair: 0x2b1d14, hairStyle: 'spiky', height: 1.03, girth: 0.95 },
  rampage: { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hair: 0x1f1712, hairStyle: 'fade' },
  torrent: { jersey: 0x18181b, stripe: 0xdc2626, gear: 'headset', hair: 0x3b2a1e, sleeves: 'long' },
  spark1e: { jersey: 0x1e293b, stripe: 0xa855f7, gear: 'none', hair: 0xec4899, hairStyle: 'mohawk', tattoos: true },
  'breach-r': { jersey: 0x1d4ed8, stripe: 0xf8fafc, gear: 'headset', hair: 0x2b1d14, girth: 1.12 },
  'viper-k': { jersey: 0xdc2626, stripe: 0x111827, gear: 'headset', hair: 0xa67c45, beard: 'full', tattoos: true },
  // IGL
  maestro: { jersey: 0xdc2626, stripe: 0x111827, gear: 'headset', hair: 0x2b1d14, glasses: 'rect' },
  chessmind: { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hair: 0x1c1410, hairStyle: 'bun' },
  overseer: { jersey: 0xe2e8f0, stripe: 0x334155, gear: 'headset', hair: 0xe3c77e, hairStyle: 'long' },
  tactix: { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hair: 0x1f1712, hairStyle: 'fade', sleeves: 'long', tacVest: true },
  'capt-nova': { jersey: 0x1e3a8a, stripe: 0x0f172a, gear: 'headset', hair: 0x2b1d14, prop: 'tablet' },
  archon: { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hair: 0x8a6a3a, beard: 'full', accent: 0xd4a017 },
  // Support
  'zyw0w-core': { jersey: 0xfacc15, stripe: 0x111827, gear: 'headset', hairStyle: 'bald', girth: 1.3, belly: true, prop: 'smoke' },
  ember: { jersey: 0xf8fafc, stripe: 0x18181b, gear: 'headset', hair: 0x6b4423, hairStyle: 'spiky', accent: 0xf97316 },
  bulwark: { jersey: 0xdc2626, stripe: 0x111827, gear: 'none', hair: 0x5c4033, hairStyle: 'fade', beard: 'stubble', sleeves: 'none', harness: true, girth: 1.15 },
  'medic-9': { jersey: 0x1d4ed8, stripe: 0xf8fafc, gear: 'none', hair: 0x4a3222, beard: 'full', sleeves: 'long' },
  flashpoint: { jersey: 0x18181b, stripe: 0xfacc15, gear: 'headset', hair: 0x8a6a45, glasses: 'round', tattoos: true, prop: 'flashes' },
  lumen: { jersey: 0xb91c1c, stripe: 0x111827, gear: 'headset', hairStyle: 'bald', sleeves: 'long', prop: 'defuse' },
  // Lurker
  ghostwalk: { jersey: 0xdc2626, stripe: 0x111827, gear: 'hood', mask: true, gloves: true, sleeves: 'long' },
  slyfox: { jersey: 0x1e40af, stripe: 0x0f172a, gear: 'headset', hair: 0x8a6a45, sleeves: 'long' },
  shade: { jersey: 0x18181b, stripe: 0xf8fafc, gear: 'bandana', hair: 0x111111, hairStyle: 'dreads', beard: 'full', sleeves: 'none' },
  ph4ntom: { jersey: 0x1f2937, stripe: 0x38bdf8, gear: 'cap', capBackwards: true, hair: 0x2b1d14, harness: true, prop: 'knife' },
  nomad: { jersey: 0x1e3a8a, stripe: 0x38bdf8, gear: 'headset', hair: 0x1f1712, sleeves: 'long' },
  wraith: { jersey: 0x18181b, stripe: 0xdc2626, gear: 'headset', hair: 0xb7773b, beard: 'full', accent: 0xd4a017 },
};

export const UNITS: UnitDef[] = SPECS.map((s) => {
  const l = LOOKS[s.id] ?? {};
  const { gear, hair, accent, ...look } = l;
  return {
    id: s.id,
    nick: s.nick,
    role: s.role,
    rarity: s.rarity,
    price: s.price,
    starter: !!s.starter,
    gear: gear ?? s.gear,
    skin: s.skin,
    hair: hair ?? s.hair,
    accent: accent ?? s.accent,
    look: { ...DEFAULT_LOOK, ...look },
    tiers: buildTiers(s.role, s.weapons, s.mods),
    passive: s.passive,
    bio: s.bio,
  };
});

const UNIT_MAP = new Map(UNITS.map((u) => [u.id, u]));

export function getUnit(id: string): UnitDef | undefined {
  return UNIT_MAP.get(id);
}

export const STARTER_UNITS = UNITS.filter((u) => u.starter).map((u) => u.id);

/** Возвращает стоимость установки юнита в бою */
export function deployCost(u: UnitDef): number {
  return u.tiers[0].cost;
}

/** Итоговый DPS тира без бонусов */
export function tierDps(t: WeaponTier): number {
  return t.damage * t.fireRate;
}
