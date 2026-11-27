// Общие типы игры: юниты, оружие, враги, волны, карты, слоты, мета-прогрессия.

export type Lang = 'ru' | 'en';
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'veryhard' | 'nightmare';
export interface Loc {
  ru: string;
  en: string;
}

export type Vec3T = [number, number, number];

/* ---------------------------------- Юниты ---------------------------------- */

export type Role = 'awper' | 'entry' | 'igl' | 'support' | 'lurker';
export const ROLES: Role[] = ['awper', 'entry', 'igl', 'support', 'lurker'];

export type WeaponKind =
  | 'pistol'
  | 'deagle'
  | 'smg'
  | 'shotgun'
  | 'rifle'
  | 'carbine'
  | 'lmg'
  | 'scout'
  | 'sniper'
  | 'autoSniper';

export type GearKind = 'helmet' | 'headset' | 'visor' | 'cap' | 'beanie' | 'hood' | 'bandana' | 'none';
export type HairStyle = 'short' | 'long' | 'spiky' | 'mohawk' | 'fade' | 'bun' | 'dreads' | 'bald';
export type BeardStyle = 'none' | 'stubble' | 'full';
export type GlassesStyle = 'none' | 'round' | 'rect' | 'shades';
/** 'none' — майка без рукавов */
export type SleeveStyle = 'short' | 'long' | 'none';
/** Мелкий аксессуар на поясе */
export type BeltProp = 'none' | 'tablet' | 'defuse' | 'smoke' | 'flashes' | 'knife';

/** Внешность бойца: форма, причёска, лицо, пропорции */
export interface UnitLook {
  /** Основной цвет джерси */
  jersey: number;
  /** Акцентный цвет: полоса на груди, манжеты, воротник */
  stripe: number;
  hairStyle: HairStyle;
  beard: BeardStyle;
  glasses: GlassesStyle;
  capBackwards: boolean;
  sleeves: SleeveStyle;
  tattoos: boolean;
  prop: BeltProp;
  gloves: boolean;
  /** Балаклава */
  mask: boolean;
  /** Тактический жилет поверх формы */
  tacVest: boolean;
  /** Плечевые ремни (разгрузка) */
  harness: boolean;
  /** Рост и обхват относительно стандартного бойца */
  height: number;
  girth: number;
  /** Живот (крупное телосложение) */
  belly: boolean;
}
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type TargetPriority = 'first' | 'last' | 'strong' | 'close';
export const PRIORITIES: TargetPriority[] = ['first', 'last', 'strong', 'close'];
export type TierIndex = 0 | 1 | 2;

export interface WeaponTier {
  weapon: WeaponKind;
  /** Урон за выстрел */
  damage: number;
  /** Выстрелов в секунду */
  fireRate: number;
  /** Дальность в мировых единицах */
  range: number;
  /** Бронепробитие 0..1 */
  pen: number;
  /** Радиус сплеша (0 — нет) */
  splash: number;
  /** T1 — стоимость установки в бою, T2/T3 — стоимость апгрейда */
  cost: number;
}

export type PassiveKind =
  | 'crit'
  | 'headshot'
  | 'pierce'
  | 'killStreak'
  | 'openingDuel'
  | 'rampUp'
  | 'shrapnel'
  | 'auraSpeed'
  | 'auraDamage'
  | 'auraRange'
  | 'auraEcon'
  | 'auraDiscount'
  | 'flash'
  | 'molotov'
  | 'heGrenade'
  | 'slowZone'
  | 'cleanup'
  | 'execute'
  | 'saver'
  | 'backstab'
  | 'smokeSight';

/** Пассивка: смысл параметров a/b/c зависит от kind (см. описание в i18n). */
export interface Passive {
  kind: PassiveKind;
  a: number;
  b: number;
  c: number;
}

export interface UnitDef {
  id: string;
  nick: string;
  role: Role;
  rarity: Rarity;
  /** Цена разблокировки в главном меню (мета-кредиты) */
  price: number;
  starter: boolean;
  gear: GearKind;
  skin: number;
  hair: number;
  /** Цвет акцента (нашивки, детали формы) */
  accent: number;
  look: UnitLook;
  tiers: [WeaponTier, WeaponTier, WeaponTier];
  passive: Passive;
  bio: Loc;
}

/* --------------------------------- Враги ---------------------------------- */

export type EnemyKind =
  | 'eco'
  | 'smurf'
  | 'rusher'
  | 'armored'
  | 'ping'
  | 'smoker'
  | 'ddos'
  | 'screamer'
  | 'spinbot'
  | 'lagger'
  | 'cheater'
  | 'flasher'
  | 'toxic'
  | 'afk'
  | 'noob'
  | 'camper'
  | 'booster'
  | 'ragequitter'
  | 'streamer'
  | 'collector'
  | 'troll'
  | 'botfarm'
  | 'onetap'
  | 'boosted_ally'
  | 'loot_crate'
  | 'mini_bot';

export interface EnemyDef {
  kind: EnemyKind;
  name: Loc;
  desc: Loc;
  hp: number;
  speed: number;
  reward: number;
  /** Доля поглощаемого урона 0..1 */
  armor: number;
  baseDamage: number;
  flying: boolean;
  /** Быстрые враги могут срезать путь (маршруты fastOnly) */
  fast: boolean;
  /** Радиус для попаданий/сплеша */
  radius: number;
  /** Щит (поглощает урон, регенерирует) */
  shield: number;
  color: number;
  /**
   * Появляется только от способностей других врагов (не в волнах, не в превью меню).
   * Награда фиксированная: без бонуса номера волны и экономической ауры.
   */
  summon?: boolean;
}

/* --------------------------------- Волны ---------------------------------- */

export type WaveTag =
  | 'pistol'
  | 'eco'
  | 'force'
  | 'rush'
  | 'smoke'
  | 'lag'
  | 'ddos'
  | 'scream'
  | 'full'
  | 'boss'
  | 'noobs'
  | 'afk'
  | 'toxic'
  | 'flash'
  | 'cheaters'
  | 'shield'
  | 'content'
  | 'chaos'
  | 'servers';

export interface WaveGroup {
  kind: EnemyKind;
  count: number;
  /** Интервал между спавнами в группе, с */
  interval: number;
  /** Задержка начала группы от старта волны, с */
  delay: number;
}

export interface WaveDef {
  number: number;
  tag: WaveTag;
  name: Loc;
  groups: WaveGroup[];
  boss: boolean;
  hpMul: number;
  /** Бонус в конце волны: $80 + номер * $15 */
  bonus: number;
}

/* ---------------------------------- Карты --------------------------------- */

export type MapId = 'bazaar' | 'dune' | 'quarter' | 'reactor' | 'interchange';
export const MAP_ORDER: MapId[] = ['bazaar', 'dune', 'quarter', 'reactor', 'interchange'];

export type TextureKind =
  | 'sandstone'
  | 'carpet'
  | 'crate'
  | 'concrete'
  | 'metal'
  | 'cobble'
  | 'sand'
  | 'plaster'
  | 'roof'
  | 'brick'
  | 'water'
  | 'hazard'
  | 'asphalt'
  | 'tiles'
  | 'container'
  | 'awning'
  | 'wood';

export type SurfaceKind = 'cobble' | 'sandstone' | 'carpet' | 'concrete' | 'metal' | 'water' | 'sand' | 'tiles' | 'asphalt';

/** Точка маршрута: x, y, z и опционально покрытие сегмента, начинающегося в этой точке */
export type RoutePoint = [number, number, number] | [number, number, number, SurfaceKind];

export interface RouteDef {
  id: string;
  name: Loc;
  points: RoutePoint[];
  /** Относительная вероятность выбора маршрута */
  weight: number;
  /** Только быстрые враги срезают через этот путь */
  fastOnly?: boolean;
  /** Опоры приподнятых сегментов: сплошные или колонны */
  support?: 'solid' | 'pillars';
  width?: number;
}

export interface SpotBonus {
  range?: number;
  damage?: number;
  fireRate?: number;
  /** Бонус действует только для этой роли */
  role?: Role;
}

/**
 * Именованная точка арены. Юнитов можно ставить куда угодно; эти точки лишь дают имя месту,
 * где стоит боец («Балкон», «Арка»…), и служат опорными позициями для бота-тестера баланса.
 */
export interface SpotDef {
  id: string;
  pos: Vec3T;
  name: Loc;
}

export type PropKind =
  | 'box'
  | 'building'
  | 'roofHouse'
  | 'crate'
  | 'barrel'
  | 'column'
  | 'arch'
  | 'palm'
  | 'tree'
  | 'stall'
  | 'container'
  | 'reactor'
  | 'tank'
  | 'pipe'
  | 'fountain'
  | 'pillar'
  | 'water'
  | 'wall'
  | 'rail'
  | 'sandbags'
  | 'lamp'
  | 'vent'
  | 'stairs'
  | 'platform'
  | 'carpetHang'
  | 'vase'
  | 'car'
  | 'barrier'
  | 'floor'
  | 'decal'
  | 'chimney'
  | 'cable';

export interface PropDef {
  k: PropKind;
  /** Позиция: центр основания */
  p: Vec3T;
  /** Размер (w, h, d) */
  s?: Vec3T;
  /** Поворот по Y в градусах */
  r?: number;
  /** Цвет */
  c?: number;
  /** Текстура */
  t?: TextureKind;
  /** Вариант/доп. параметр */
  v?: number;
  /** Текст (для декалей) */
  txt?: string;
}

export interface CalloutDef {
  p: Vec3T;
  name: Loc;
}

export interface MapTheme {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  sunDir: Vec3T;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  ambientIntensity: number;
  exposure: number;
  /** Цвет пыли/частиц в воздухе */
  dust: number;
  warm: boolean;
}

export interface MapDef {
  id: MapId;
  name: Loc;
  tagline: Loc;
  desc: Loc;
  difficulty: number;
  startMoney: number;
  baseHp: number;
  waves: number;
  hpScale: number;
  unlockPrice: number;
  theme: MapTheme;
  ground: TextureKind;
  groundTint: number;
  /** Размер арены (ширина по X, глубина по Z) */
  size: [number, number];
  routes: RouteDef[];
  /** Именованные точки (имена мест и опорные позиции бота) */
  spots: SpotDef[];
  /** Бонус бойцам, стоящим на возвышенности (крыши, балконы, ящики, контейнеры) */
  highGround: SpotBonus[];
  props: PropDef[];
  callouts: CalloutDef[];
  plantLetter: 'A' | 'B';
  camera: { target: [number, number]; dist: number; yaw: number; pitch: number };
  accent: number;
}

/* --------------------------- Мета-прогрессия ------------------------------- */

export interface SaveData {
  version: 1;
  credits: number;
  /** Премиальная валюта: 1 гем = 100 кредитов */
  gems: number;
  /** Всего просмотрено рекламы за награду (каждые 10 — гемы) */
  adsWatched: number;
  /** Обучение пройдено или пропущено */
  tutorialDone: boolean;
  difficulty: DifficultyId;
  /** Победы на картах по сложностям (индекс — DIFFICULTY_ORDER) */
  winsBy: Partial<Record<MapId, number[]>>;
  owned: string[];
  squad: string[];
  unlockedMaps: MapId[];
  best: Partial<Record<MapId, number>>;
  wins: Partial<Record<MapId, number>>;
  muted: boolean;
  lang: Lang | null;
  selectedMap: MapId;
  totalKills: number;
  matches: number;
  updatedAt: number;
}

export interface MatchResult {
  mapId: MapId;
  victory: boolean;
  wavesCleared: number;
  totalWaves: number;
  kills: number;
  credits: number;
  hpLeft: number;
  difficulty: DifficultyId;
  gems: number;
}
