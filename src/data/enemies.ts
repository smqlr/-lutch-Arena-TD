import type { EnemyDef, EnemyKind } from '../types/game';

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  eco: {
    kind: 'eco',
    name: { ru: 'Эко-игрок', en: 'Eco player' },
    desc: { ru: 'Пистолет и надежда. Базовая пехота.', en: 'A pistol and hope. Basic infantry.' },
    hp: 50, speed: 2.5, reward: 7, armor: 0, baseDamage: 1, flying: false, fast: false, radius: 0.45, shield: 0, color: 0x9ca3af,
  },
  smurf: {
    kind: 'smurf',
    name: { ru: 'Смурф', en: 'Smurf' },
    desc: { ru: 'Про на чужом аккаунте: очень быстрый, срезает путь.', en: 'A pro on an alt account: very fast, takes shortcuts.' },
    hp: 42, speed: 4.2, reward: 7, armor: 0, baseDamage: 1, flying: false, fast: true, radius: 0.4, shield: 0, color: 0x38bdf8,
  },
  rusher: {
    kind: 'rusher',
    name: { ru: 'Раш-Б', en: 'Rush B' },
    desc: { ru: 'Бежит толпой без остановки. Быстрый.', en: 'Runs in a pack and never stops. Fast.' },
    hp: 80, speed: 3.4, reward: 8, armor: 0.1, baseDamage: 1, flying: false, fast: true, radius: 0.45, shield: 0, color: 0xef4444,
  },
  armored: {
    kind: 'armored',
    name: { ru: 'Форс-байщик', en: 'Force buyer' },
    desc: { ru: 'Бронежилет и каска: поглощает 40% урона.', en: 'Vest and helmet: absorbs 40% of damage.' },
    hp: 165, speed: 2.0, reward: 15, armor: 0.4, baseDamage: 2, flying: false, fast: false, radius: 0.55, shield: 0, color: 0x64748b,
  },
  ping: {
    kind: 'ping',
    name: { ru: 'Пинг 999', en: 'Ping 999' },
    desc: { ru: 'Лагает и телепортируется вперёд по маршруту.', en: 'Lags and teleports forward along the route.' },
    hp: 120, speed: 2.2, reward: 12, armor: 0, baseDamage: 1, flying: false, fast: true, radius: 0.5, shield: 0, color: 0x22ff88,
  },
  smoker: {
    kind: 'smoker',
    name: { ru: 'Смокер', en: 'Smoker' },
    desc: { ru: 'Бросает дым: враги в смоке невидимы для башен.', en: 'Throws smoke: enemies inside are invisible to towers.' },
    hp: 140, speed: 2.3, reward: 14, armor: 0.15, baseDamage: 1, flying: false, fast: false, radius: 0.5, shield: 0, color: 0xa1a1aa,
  },
  ddos: {
    kind: 'ddos',
    name: { ru: 'DDoS-дрон', en: 'DDoS drone' },
    desc: { ru: 'Летает над маршрутом и вызывает лаг у ближайших башен.', en: 'Flies over the route and lags nearby towers.' },
    hp: 110, speed: 3.0, reward: 16, armor: 0, baseDamage: 1, flying: true, fast: false, radius: 0.6, shield: 0, color: 0xf43f5e,
  },
  screamer: {
    kind: 'screamer',
    name: { ru: 'Крикун', en: 'Screamer' },
    desc: { ru: 'Орёт в войс: ускоряет всех врагов вокруг на 35%.', en: 'Yells in voice chat: speeds up nearby enemies by 35%.' },
    hp: 160, speed: 2.4, reward: 14, armor: 0.1, baseDamage: 1, flying: false, fast: false, radius: 0.5, shield: 0, color: 0xfacc15,
  },
  lagger: {
    kind: 'lagger',
    name: { ru: 'Лаггер', en: 'Lagger' },
    desc: { ru: 'Откатывается назад, сбрасывает прицел башен и рывком прыгает вперёд.', en: 'Rubberbands back, resets tower targeting and lunges forward.' },
    hp: 110, speed: 2.6, reward: 13, armor: 0.1, baseDamage: 1, flying: false, fast: true, radius: 0.45, shield: 0, color: 0xa855f7,
  },
  cheater: {
    kind: 'cheater',
    name: { ru: 'Читер', en: 'Cheater' },
    desc: { ru: 'Видит сквозь стены и уклоняется от 25% обычных выстрелов.', en: 'Sees through walls and dodges 25% of regular shots.' },
    hp: 150, speed: 2.8, reward: 18, armor: 0.15, baseDamage: 1, flying: false, fast: true, radius: 0.48, shield: 0, color: 0x22c55e,
  },
  flasher: {
    kind: 'flasher',
    name: { ru: 'Флешер-тролль', en: 'Flasher troll' },
    desc: { ru: 'Взрывает флешки рядом с позициями и ослепляет ближайшие башни.', en: 'Pops flashbangs near positions, blinding nearby towers.' },
    hp: 130, speed: 2.5, reward: 15, armor: 0.1, baseDamage: 1, flying: false, fast: false, radius: 0.5, shield: 0, color: 0xfacc15,
  },
  toxic: {
    kind: 'toxic',
    name: { ru: 'Токсик', en: 'Toxic' },
    desc: { ru: 'Ядовитая аура снижает темп стрельбы ближайших башен на 25%.', en: 'Toxic aura reduces fire rate of nearby towers by 25%.' },
    hp: 180, speed: 2.1, reward: 16, armor: 0.2, baseDamage: 1, flying: false, fast: false, radius: 0.5, shield: 0, color: 0x84cc16,
  },
  afk: {
    kind: 'afk',
    name: { ru: 'АФК-зомби', en: 'AFK zombie' },
    desc: { ru: 'Медленный танк с иммунитетом к замедлению и слабой реакцией на флешки.', en: 'Slow tank immune to slows and resistant to flashes.' },
    hp: 420, speed: 1.15, reward: 22, armor: 0.35, baseDamage: 3, flying: false, fast: false, radius: 0.6, shield: 0, color: 0x64748b,
  },
  noob: {
    kind: 'noob',
    name: { ru: 'Баер-нуб', en: 'Buyer noob' },
    desc: { ru: 'Тащит кучу пушек: при смерти либо даёт +$20, либо роняет дым.', en: 'Carries way too many guns: on death either drops +$20 or pops smoke.' },
    hp: 140, speed: 2.4, reward: 16, armor: 0.15, baseDamage: 1, flying: false, fast: false, radius: 0.5, shield: 0, color: 0xf97316,
  },
  spinbot: {
    kind: 'spinbot',
    name: { ru: 'Босс Спинбот', en: 'Spinbot boss' },
    desc: { ru: 'Крутится, режет лезвиями и прячется за регенерирующим щитом.', en: 'Spins, slices with blades and hides behind a regenerating shield.' },
    hp: 2300, speed: 1.25, reward: 300, armor: 0.3, baseDamage: 6, flying: false, fast: false, radius: 1.3, shield: 750, color: 0xdc2626,
  },
};
