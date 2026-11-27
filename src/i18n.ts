import type { Lang, Loc, Passive, Rarity, Role, TargetPriority, WeaponKind } from './types/game';

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

export function loc(l: Loc): string {
  return l[current];
}

const RU = {
  // Меню
  gameTitle: 'Clutch Arena',
  gameSubtitle: 'Тактический Tower Defense',
  play: 'Играть',
  shop: 'Магазин',
  squad: 'Отряд',
  maps: 'Карты',
  settings: 'Настройки',
  credits: 'Кредиты',
  startMatch: 'В бой',
  locked: 'Закрыто',
  unlockFor: 'Открыть за {price}',
  orWin: 'или победите на «{map}»',
  difficulty: 'Сложность',
  waves: 'Волн',
  startMoney: 'Старт',
  baseHp: 'HP плента',
  bestWave: 'Рекорд: волна {n}',
  noRecord: 'Ещё не сыграно',
  wins: 'Побед: {n}',
  owned: 'Куплен',
  buy: 'Купить',
  inSquad: 'В отряде',
  addToSquad: 'В отряд',
  removeFromSquad: 'Убрать',
  squadFull: 'Отряд заполнен (5/5)',
  squadEmpty: 'Нужен хотя бы один юнит в отряде',
  notEnoughCredits: 'Недостаточно кредитов',
  unitUnlocked: '{nick} разблокирован!',
  mapUnlocked: 'Карта «{map}» открыта!',
  allRoles: 'Все',
  deployCost: 'Установка',
  tier: 'Тир',
  damage: 'Урон',
  fireRate: 'Выстр./с',
  range: 'Дальность',
  dps: 'DPS',
  pen: 'Пробитие',
  splash: 'Сплеш',
  passive: 'Пассивка',
  upgrade: 'Апгрейд',
  sell: 'Продать',
  priority: 'Цель',
  maxTier: 'Максимальный тир',
  language: 'Язык',
  sound: 'Звук',
  on: 'Вкл',
  off: 'Выкл',
  fullscreen: 'Полный экран',
  resetProgress: 'Сбросить прогресс',
  resetConfirm: 'Сбросить весь прогресс? Кредиты, юниты и карты вернутся к начальным. Действие нельзя отменить.',
  progressReset: 'Прогресс сброшен',
  confirm: 'Подтвердить',
  cancel: 'Отмена',
  close: 'Закрыть',
  howToPlay: 'Как играть',
  howTo1: 'Соберите отряд из 5 юнитов и выберите карту.',
  howTo2: 'Ставьте юнитов куда угодно: на землю, крыши, ящики и контейнеры — только не на маршрут врагов. Нажмите карточку внизу, затем место — или наоборот. На возвышенности действует бонус карты.',
  howTo3: 'Между волнами улучшайте оружие (Т1 → Т2 → Т3), меняйте цель и копите деньги: банк даёт +5% к остатку.',
  howTo4: 'Support сбивает дым Смокеров флешками и молотовыми, Lurker добивает прорвавшихся, IGL усиливает соседей.',
  controlsTitle: 'Управление',
  controls1: 'Тактика: WASD / стрелки — сдвиг, Space / Shift — выше / ниже, колесо — зум, Q/E и ПКМ — поворот и наклон.',
  controls2: 'Полёт: зажмите мышь для обзора, W/S — лететь туда, куда смотрите, A/D — вбок, Space / Shift — вверх / вниз.',
  controls3: 'Esc — пауза. На телефоне: свайп — сдвиг, щипок — зум.',
  squadHint: 'Выберите до 5 юнитов для матча. Нажмите на юнита в списке, чтобы добавить или убрать.',
  squadSlotEmpty: 'Пусто',
  selectMap: 'Выберите карту',
  yourSquad: 'Ваш отряд',
  editSquad: 'Изменить отряд',
  progress: 'Прогресс',
  unitsOwned: 'Юнитов: {n}/{total}',
  mapsOpen: 'Карт: {n}/{total}',
  preview: 'Превью',
  routes: 'Маршруты',
  enemies: 'Противники',
  // HUD
  balance: 'Баланс',
  hp: 'HP',
  wave: 'Волна',
  waveOf: '{n}/{total}',
  camera: 'Камера',
  tactical: 'Тактика',
  flight: 'Полёт',
  reset: 'Сброс',
  autoWave: 'Автоволна',
  startWave: 'Старт волны',
  nextWave: 'Далее: {name}',
  waveInProgress: 'Волна идёт',
  forceBuy: 'Форс-бай',
  forceBuyDesc: '+25% урона всему отряду на 1 волну',
  forceBuyActive: 'Форс-бай активен',
  forceBuyOnlyPrep: 'Форс-бай покупается между волнами',
  forceBuyBought: 'Форс-бай! +25% урона на эту волну',
  airdrop: 'Эйрдроп',
  airdropDesc: '+$150 за просмотр рекламы',
  airdropGot: 'Эйрдроп: +$150',
  airdropLimit: 'Эйрдропы закончились',
  pause: 'Пауза',
  resume: 'Продолжить',
  restart: 'Заново',
  exitMenu: 'В меню',
  victory: 'Победа!',
  victorySub: 'Плент удержан. Отряд в полном составе празднует клатч.',
  defeat: 'Плент потерян',
  defeatSub: 'Противник прорвался. Перестройте отряд и попробуйте снова.',
  wavesCleared: 'Волн пройдено',
  kills: 'Фрагов',
  creditsEarned: 'Кредиты',
  hpLeft: 'HP плента',
  doubleCredits: 'Удвоить кредиты',
  doubled: 'Награда удвоена!',
  retry: 'Реванш',
  nextMap: 'Следующая карта',
  notEnoughMoney: 'Не хватает денег',
  placed: '{nick} занял позицию «{slot}»',
  upgraded: '{nick}: Тир {tier} — {weapon}',
  sold: 'Продано: +${amount}',
  waveCleared: 'Волна {n} зачищена: +${bonus}',
  interest: 'Банк +{p}%: +${amount}',
  bossIncoming: 'Внимание: Босс Спинбот!',
  baseHit: 'Враг на пленте! −{n} HP',
  adUnavailable: 'Реклама сейчас недоступна',
  adBreak: 'Рекламная пауза',
  adSimDesc: 'Рекламный SDK недоступен — локальная симуляция рекламы.',
  adSkip: 'Награда через {n} с',
  selectSpot: 'Выберите место на карте: любая ровная площадка вне маршрута',
  spot_route: 'Слишком близко к маршруту',
  spot_taken: 'Здесь уже стоит боец',
  spot_surface: 'Сюда не встать',
  spot_bounds: 'За пределами арены',
  spot_base: 'Слишком близко к базе или спавну',
  spot_blocked: 'Мешает препятствие',
  slotTitle: 'Позиция «{slot}»',
  chooseUnit: 'Кого поставить?',
  kills_short: 'Фраги',
  invested: 'Вложено',
  refund: 'Возврат 75%',
  lag: 'LAG',
  blind: 'ОСЛЕП',
  burning: 'ГОРИТ',
  sniped: 'СНЯТ',
  smokeBlocked: 'Цель в дыму',
  speed: 'Скорость',
  mute: 'Звук',
  menu: 'Меню',
  bonusSlot: 'Бонус высоты',
  income: 'Доход',
  enemiesLeft: 'Врагов: {n}',
  prepPhase: 'Подготовка',
  autoIn: 'Автостарт через {n} с',
  matchStart: 'Карта «{map}». Удачи, отряд!',
  priorityChanged: 'Приоритет цели: {p}',
  cancelPlacement: 'Отмена',
  placementMode: 'Установка: {nick} — ${cost}',
  everyRole: 'Роль',
  newRecord: 'Новый рекорд!',
  loading: 'Загрузка арены…',
  gems: 'Гемы',
  notEnoughGems: 'Недостаточно гемов',
  watchAd: 'Реклама',
  watchAdFor: 'Смотреть рекламу: +{n} кредитов',
  adProgress: 'Ещё {n} — и +{gems} гемов',
  adReward: '+{n} кредитов за рекламу',
  gemReward: 'Десятая реклама! +{n} гемов',
  exchange: 'Обмен гемов',
  exchangeHint: '100 гемов = 10 000 кредитов. Гемы дают каждые 10 просмотров рекламы.',
  exchanged: 'Обмен: −{gems} гемов, +{credits} кредитов',
  buyGems: 'За гемы',
  tutSkip: 'Пропустить обучение',
  tutNext: 'Дальше',
  tutDone: 'Играть!',
  tut1: '<b>Защити плент!</b> Враги идут по светящимся дорожкам к бомбе. Расставь бойцов вдоль пути — они стреляют сами.',
  tut2: 'Нажми на <b>карточку бойца</b> внизу.',
  tut3: 'Теперь нажми на <b>место рядом с дорожкой</b>: земля, крыша или ящик. На телефоне — второй тап по тому же месту ставит бойца.',
  tut4: 'Отлично! Поставь <b>ещё одного</b> бойца — вместе они сильнее.',
  tut5: 'Жми <b>«Старт волны»</b>, когда готов.',
  tut6: 'Бойцы стреляют сами. За каждого врага — деньги. Не дай никому дойти до плента!',
  tut7: 'Волна отбита! Нажми на бойца и <b>улучши</b> его — новое оружие бьёт сильнее.',
  tut8: 'Ты готов, командир! Награда: +{credits} кредитов и +{gems} гемов. Гемы можно получать за рекламу в меню и менять на кредиты.',
  tapAgain: 'Тапни ещё раз, чтобы поставить',
  gemsDropped: 'Выпали гемы: +{n}!',
  diffLabel: 'Уровень сложности',
  diffStats: 'HP врагов ×{hp} · кредиты ×{cr} · волн: {w}',
  diffGems: '{p}% шанс на {n} гемов за победу',
  unlockTitle: 'Чтобы открыть «{map}», победи здесь:',
  unlockOr: 'или',
};

type DictKey = keyof typeof RU;

const EN: Record<DictKey, string> = {
  gameTitle: 'Clutch Arena',
  gameSubtitle: 'Tactical Tower Defense',
  play: 'Play',
  shop: 'Shop',
  squad: 'Squad',
  maps: 'Maps',
  settings: 'Settings',
  credits: 'Credits',
  startMatch: 'Deploy',
  locked: 'Locked',
  unlockFor: 'Unlock for {price}',
  orWin: 'or win on “{map}”',
  difficulty: 'Difficulty',
  waves: 'Waves',
  startMoney: 'Start',
  baseHp: 'Site HP',
  bestWave: 'Best: wave {n}',
  noRecord: 'Not played yet',
  wins: 'Wins: {n}',
  owned: 'Owned',
  buy: 'Buy',
  inSquad: 'In squad',
  addToSquad: 'Add',
  removeFromSquad: 'Remove',
  squadFull: 'Squad is full (5/5)',
  squadEmpty: 'Your squad needs at least one unit',
  notEnoughCredits: 'Not enough credits',
  unitUnlocked: '{nick} unlocked!',
  mapUnlocked: 'Map “{map}” unlocked!',
  allRoles: 'All',
  deployCost: 'Deploy',
  tier: 'Tier',
  damage: 'Damage',
  fireRate: 'Shots/s',
  range: 'Range',
  dps: 'DPS',
  pen: 'Armor pen',
  splash: 'Splash',
  passive: 'Passive',
  upgrade: 'Upgrade',
  sell: 'Sell',
  priority: 'Target',
  maxTier: 'Max tier',
  language: 'Language',
  sound: 'Sound',
  on: 'On',
  off: 'Off',
  fullscreen: 'Fullscreen',
  resetProgress: 'Reset progress',
  resetConfirm: 'Reset all progress? Credits, units and maps return to the starting state. This cannot be undone.',
  progressReset: 'Progress reset',
  confirm: 'Confirm',
  cancel: 'Cancel',
  close: 'Close',
  howToPlay: 'How to play',
  howTo1: 'Build a squad of 5 units and pick a map.',
  howTo2: 'Place units anywhere: ground, rooftops, crates and containers — just not on the enemy route. Tap a card at the bottom, then a spot — or the other way round. High ground grants the map bonus.',
  howTo3: 'Between waves upgrade weapons (T1 → T2 → T3), change targeting and save money: the bank pays +5% interest.',
  howTo4: 'Support clears Smoker clouds with flashes and molotovs, Lurker finishes leakers, IGL buffs neighbours.',
  controlsTitle: 'Controls',
  controls1: 'Tactical: WASD / arrows — pan, Space / Shift — raise / lower, wheel — zoom, Q/E and RMB — rotate and tilt.',
  controls2: 'Flight: hold the mouse to look, W/S — fly where you look, A/D — strafe, Space / Shift — up / down.',
  controls3: 'Esc — pause. On phones: swipe — pan, pinch — zoom.',
  squadHint: 'Pick up to 5 units for the match. Tap a unit in the list to add or remove it.',
  squadSlotEmpty: 'Empty',
  selectMap: 'Choose a map',
  yourSquad: 'Your squad',
  editSquad: 'Edit squad',
  progress: 'Progress',
  unitsOwned: 'Units: {n}/{total}',
  mapsOpen: 'Maps: {n}/{total}',
  preview: 'Preview',
  routes: 'Routes',
  enemies: 'Enemies',
  balance: 'Balance',
  hp: 'HP',
  wave: 'Wave',
  waveOf: '{n}/{total}',
  camera: 'Camera',
  tactical: 'Tactical',
  flight: 'Flight',
  reset: 'Reset',
  autoWave: 'Auto wave',
  startWave: 'Start wave',
  nextWave: 'Next: {name}',
  waveInProgress: 'Wave in progress',
  forceBuy: 'Force buy',
  forceBuyDesc: '+25% damage to the whole squad for 1 wave',
  forceBuyActive: 'Force buy active',
  forceBuyOnlyPrep: 'Force buy is bought between waves',
  forceBuyBought: 'Force buy! +25% damage this wave',
  airdrop: 'Airdrop',
  airdropDesc: '+$150 for watching an ad',
  airdropGot: 'Airdrop: +$150',
  airdropLimit: 'No airdrops left',
  pause: 'Paused',
  resume: 'Resume',
  restart: 'Restart',
  exitMenu: 'Main menu',
  victory: 'Victory!',
  victorySub: 'The site holds. The whole squad celebrates the clutch.',
  defeat: 'Site lost',
  defeatSub: 'The enemy broke through. Rebuild your squad and try again.',
  wavesCleared: 'Waves cleared',
  kills: 'Kills',
  creditsEarned: 'Credits',
  hpLeft: 'Site HP',
  doubleCredits: 'Double credits',
  doubled: 'Reward doubled!',
  retry: 'Rematch',
  nextMap: 'Next map',
  notEnoughMoney: 'Not enough money',
  placed: '{nick} took position “{slot}”',
  upgraded: '{nick}: Tier {tier} — {weapon}',
  sold: 'Sold: +${amount}',
  waveCleared: 'Wave {n} cleared: +${bonus}',
  interest: 'Bank +{p}%: +${amount}',
  bossIncoming: 'Warning: Spinbot boss!',
  baseHit: 'Enemy on site! −{n} HP',
  adUnavailable: 'Ads are unavailable right now',
  adBreak: 'Ad break',
  adSimDesc: 'Ad SDK is unavailable — local ad simulation.',
  adSkip: 'Reward in {n}s',
  selectSpot: 'Pick a spot: any flat place off the enemy route',
  spot_route: 'Too close to the route',
  spot_taken: 'A unit already stands here',
  spot_surface: 'Can’t stand here',
  spot_bounds: 'Outside the arena',
  spot_base: 'Too close to the base or spawn',
  spot_blocked: 'Something is in the way',
  slotTitle: 'Spot “{slot}”',
  chooseUnit: 'Who goes here?',
  kills_short: 'Kills',
  invested: 'Invested',
  refund: 'Refund 75%',
  lag: 'LAG',
  blind: 'BLIND',
  burning: 'BURN',
  sniped: 'SNIPED',
  smokeBlocked: 'Target in smoke',
  speed: 'Speed',
  mute: 'Sound',
  menu: 'Menu',
  bonusSlot: 'High ground bonus',
  income: 'Income',
  enemiesLeft: 'Enemies: {n}',
  prepPhase: 'Buy time',
  autoIn: 'Auto start in {n}s',
  matchStart: 'Map “{map}”. Good luck, squad!',
  priorityChanged: 'Targeting: {p}',
  cancelPlacement: 'Cancel',
  placementMode: 'Deploy: {nick} — ${cost}',
  everyRole: 'Role',
  newRecord: 'New record!',
  loading: 'Loading arena…',
  gems: 'Gems',
  notEnoughGems: 'Not enough gems',
  watchAd: 'Watch ad',
  watchAdFor: 'Watch an ad: +{n} credits',
  adProgress: '{n} more for +{gems} gems',
  adReward: '+{n} credits for watching',
  gemReward: 'Tenth ad! +{n} gems',
  exchange: 'Gem exchange',
  exchangeHint: '100 gems = 10,000 credits. Every 10 ads watched give gems.',
  exchanged: 'Exchanged: −{gems} gems, +{credits} credits',
  buyGems: 'With gems',
  tutSkip: 'Skip tutorial',
  tutNext: 'Next',
  tutDone: 'Let’s go!',
  tut1: '<b>Defend the site!</b> Enemies walk the glowing paths to the bomb. Place fighters along the way — they shoot on their own.',
  tut2: 'Tap a <b>fighter card</b> at the bottom.',
  tut3: 'Now tap a <b>spot next to the path</b>: ground, rooftop or crate. On a phone, tap the same spot again to place.',
  tut4: 'Nice! Place <b>one more</b> fighter — they are stronger together.',
  tut5: 'Hit <b>Start wave</b> when you are ready.',
  tut6: 'Fighters shoot automatically and every kill pays. Don’t let anyone reach the site!',
  tut7: 'Wave cleared! Tap a fighter and <b>upgrade</b> it — the new weapon hits harder.',
  tut8: 'You’re ready, commander! Reward: +{credits} credits and +{gems} gems. Earn gems by watching ads in the menu and trade them for credits.',
  tapAgain: 'Tap again to place',
  gemsDropped: 'Gems dropped: +{n}!',
  diffLabel: 'Difficulty level',
  diffStats: 'Enemy HP ×{hp} · credits ×{cr} · waves: {w}',
  diffGems: '{p}% chance of {n} gems on victory',
  unlockTitle: 'To unlock {map}, win here:',
  unlockOr: 'or',
};

const DICT: Record<Lang, Record<DictKey, string>> = { ru: RU, en: EN };

export type { DictKey };

export function t(key: DictKey, vars?: Record<string, string | number>): string {
  let s = DICT[current][key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}

const ROLE_NAMES: Record<Role, Loc> = {
  awper: { ru: 'AWPer', en: 'AWPer' },
  entry: { ru: 'Entry Fragger', en: 'Entry Fragger' },
  igl: { ru: 'IGL', en: 'IGL' },
  support: { ru: 'Support', en: 'Support' },
  lurker: { ru: 'Lurker', en: 'Lurker' },
};

const ROLE_DESC: Record<Role, Loc> = {
  awper: { ru: 'Снайпер: огромный урон, большая дальность, медленный темп.', en: 'Sniper: huge damage, long range, slow pace.' },
  entry: { ru: 'Штурмовик: высокий темп стрельбы, разгоняется за фраги.', en: 'Assaulter: high fire rate, speeds up on kills.' },
  igl: { ru: 'Капитан: ауры скорости, урона, дальности и экономии.', en: 'Captain: speed, damage, range and economy auras.' },
  support: { ru: 'Утилита: флешки, молотовы, гранаты, рассеивает дым.', en: 'Utility: flashes, molotovs, grenades, clears smoke.' },
  lurker: { ru: 'Одиночка: добивает прорвавшихся, казнит раненых.', en: 'Solo player: finishes leakers, executes the wounded.' },
};

export const ROLE_COLORS: Record<Role, number> = {
  awper: 0x22c55e,
  entry: 0xef4444,
  igl: 0xf59e0b,
  support: 0x3b82f6,
  lurker: 0xa855f7,
};

export const ROLE_ICONS: Record<Role, string> = {
  awper: '◎',
  entry: '➤',
  igl: '★',
  support: '✚',
  lurker: '◐',
};

export function roleName(r: Role): string {
  return loc(ROLE_NAMES[r]);
}

export function roleDesc(r: Role): string {
  return loc(ROLE_DESC[r]);
}

export function roleColorCss(r: Role): string {
  return '#' + ROLE_COLORS[r].toString(16).padStart(6, '0');
}

const WEAPON_NAMES: Record<WeaponKind, Loc> = {
  pistol: { ru: 'Пистолет', en: 'Pistol' },
  deagle: { ru: 'Тяжёлый пистолет', en: 'Hand cannon' },
  smg: { ru: 'ПП-буллпап', en: 'Bullpup SMG' },
  shotgun: { ru: 'Помповый дробовик', en: 'Pump shotgun' },
  rifle: { ru: 'Штурмовая винтовка', en: 'Assault rifle' },
  carbine: { ru: 'Карабин с глушителем', en: 'Suppressed carbine' },
  lmg: { ru: 'Ручной пулемёт', en: 'Light machine gun' },
  scout: { ru: 'Лёгкая снайперка', en: 'Scout rifle' },
  sniper: { ru: 'Снайперская винтовка', en: 'Sniper rifle' },
  autoSniper: { ru: 'Полуавтомат. снайперка', en: 'Auto-sniper' },
};

export function weaponName(w: WeaponKind): string {
  return loc(WEAPON_NAMES[w]);
}

const PRIORITY_NAMES: Record<TargetPriority, Loc> = {
  first: { ru: 'Первый', en: 'First' },
  last: { ru: 'Последний', en: 'Last' },
  strong: { ru: 'Сильный', en: 'Strong' },
  close: { ru: 'Ближний', en: 'Close' },
};

export function priorityName(p: TargetPriority): string {
  return loc(PRIORITY_NAMES[p]);
}

const RARITY_NAMES: Record<Rarity, Loc> = {
  common: { ru: 'Обычный', en: 'Common' },
  rare: { ru: 'Редкий', en: 'Rare' },
  epic: { ru: 'Эпический', en: 'Epic' },
  legendary: { ru: 'Легендарный', en: 'Legendary' },
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9CA3AF',
  rare: '#38BDF8',
  epic: '#C084FC',
  legendary: '#F59E0B',
};

export function rarityName(r: Rarity): string {
  return loc(RARITY_NAMES[r]);
}

const pct = (v: number) => Math.round(v * 100);

export function passiveName(p: Passive): string {
  const names: Record<Passive['kind'], Loc> = {
    crit: { ru: 'Крит', en: 'Critical' },
    headshot: { ru: 'Хедшот', en: 'Headshot' },
    pierce: { ru: 'Прострел', en: 'Wallbang' },
    killStreak: { ru: 'Разгон', en: 'Kill streak' },
    openingDuel: { ru: 'Первый контакт', en: 'Opening duel' },
    rampUp: { ru: 'Контроль спрея', en: 'Spray control' },
    shrapnel: { ru: 'Шрапнель', en: 'Shrapnel' },
    auraSpeed: { ru: 'Аура темпа', en: 'Tempo aura' },
    auraDamage: { ru: 'Аура тактики', en: 'Tactics aura' },
    auraRange: { ru: 'Аура инфо', en: 'Intel aura' },
    auraEcon: { ru: 'Экономия', en: 'Economy' },
    auraDiscount: { ru: 'Тайм-менеджмент', en: 'Time management' },
    flash: { ru: 'Флешка', en: 'Flashbang' },
    molotov: { ru: 'Молотов', en: 'Molotov' },
    heGrenade: { ru: 'Осколочная', en: 'HE grenade' },
    slowZone: { ru: 'Ловушка', en: 'Trap' },
    cleanup: { ru: 'Добивание', en: 'Cleanup' },
    execute: { ru: 'Казнь', en: 'Execute' },
    saver: { ru: 'Сейвер', en: 'Saver' },
    backstab: { ru: 'Удар в спину', en: 'Backstab' },
    smokeSight: { ru: 'Чтение дыма', en: 'Smoke read' },
  };
  return loc(names[p.kind]);
}

export function passiveDesc(p: Passive): string {
  const { a, b, c } = p;
  const ru = current === 'ru';
  switch (p.kind) {
    case 'crit':
      return ru ? `${pct(a)}% шанс нанести x${b} урона` : `${pct(a)}% chance to deal x${b} damage`;
    case 'headshot':
      return ru ? `${pct(a)}% шанс мгновенно убить (боссу — x3 урона)` : `${pct(a)}% chance to kill instantly (x3 vs boss)`;
    case 'pierce':
      return ru ? `Пуля пробивает до ${a} целей за основной (${pct(b)}% урона)` : `Bullet pierces up to ${a} extra targets (${pct(b)}% damage)`;
    case 'killStreak':
      return ru ? `+${pct(a)}% темпа за фраг, до ${b} стаков на ${c} с` : `+${pct(a)}% fire rate per kill, up to ${b} stacks for ${c}s`;
    case 'openingDuel':
      return ru ? `+${pct(a)}% урона по врагам с полным HP` : `+${pct(a)}% damage to full-HP enemies`;
    case 'rampUp':
      return ru ? `+${pct(a)}% урона за выстрел по одной цели (до +${pct(b)}%)` : `+${pct(a)}% damage per shot on the same target (up to +${pct(b)}%)`;
    case 'shrapnel':
      return ru ? `${pct(a)}% урона задевает врагов в радиусе ${b}` : `${pct(a)}% damage splashes enemies within ${b}`;
    case 'auraSpeed':
      return ru ? `+${pct(a)}% темпа союзникам в радиусе ${b}` : `+${pct(a)}% fire rate to allies within ${b}`;
    case 'auraDamage':
      return ru ? `+${pct(a)}% урона союзникам в радиусе ${b}` : `+${pct(a)}% damage to allies within ${b}`;
    case 'auraRange':
      return ru ? `+${pct(a)}% дальности союзникам в радиусе ${b}` : `+${pct(a)}% range to allies within ${b}`;
    case 'auraEcon':
      return ru ? `+$${a} за каждый фраг союзников в радиусе ${b}` : `+$${a} per kill of allies within ${b}`;
    case 'auraDiscount':
      return ru ? `Апгрейды союзников в радиусе ${b} дешевле на ${pct(a)}%` : `Upgrades of allies within ${b} cost ${pct(a)}% less`;
    case 'flash':
      return ru ? `Каждые ${a} с ослепляет врагов в радиусе ${c} на ${b} с и рассеивает дым` : `Every ${a}s blinds enemies within ${c} for ${b}s and clears smoke`;
    case 'molotov':
      return ru ? `Каждые ${a} с — горящая лужа: ${b} урона/с на ${c} с, выжигает дым` : `Every ${a}s — fire pool: ${b} dmg/s for ${c}s, burns smoke`;
    case 'heGrenade':
      return ru ? `Каждые ${a} с — взрыв на ${b} урона в радиусе ${c}, сдувает дым` : `Every ${a}s — blast for ${b} dmg within ${c}, blows smoke away`;
    case 'slowZone':
      return ru ? `Каждые ${a} с — зона замедления −${pct(b)}% на ${c} с, рассеивает дым` : `Every ${a}s — slow zone −${pct(b)}% for ${c}s, clears smoke`;
    case 'cleanup':
      return ru ? `+${pct(a)}% урона по врагам, прошедшим ${pct(b)}% пути` : `+${pct(a)}% damage to enemies past ${pct(b)}% of the route`;
    case 'execute':
      return ru ? `Мгновенно добивает врагов с HP ниже ${pct(a)}% (кроме босса)` : `Instantly finishes enemies below ${pct(a)}% HP (not boss)`;
    case 'saver':
      return ru ? `Банковский процент ${pct(a)}% вместо 5% (кап $${b})` : `Bank interest ${pct(a)}% instead of 5% (cap $${b})`;
    case 'backstab':
      return ru ? `+${pct(a)}% урона по врагам, которые уже прошли мимо` : `+${pct(a)}% damage to enemies that already passed by`;
    case 'smokeSight':
      return ru ? `Видит цели в дыму, +${pct(a)}% урона по ним` : `Sees targets in smoke, +${pct(a)}% damage to them`;
  }
}

export function fmtMoney(n: number): string {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

export function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}
