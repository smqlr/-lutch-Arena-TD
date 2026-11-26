import * as THREE from 'three';
import type { Vec3T } from '../types/game';
import type { Humanoid, ItemKind } from './Humanoid';
import { FOREARM, SHOULDER_X, SHOULDER_Y, UPPER_ARM } from './Humanoid';
import type { WeaponModel } from './ModelFactory';

/**
 * Фирменные позы бойцов (по концепт-арту «Юниты и враги»): видны в магазине и в бою,
 * пока у бойца нет цели. Поза задаётся точками кистей в координатах тела, «полюсом» локтя,
 * положением оружия и предметами в руках. Углы плеча и предплечья считает IK из двух звеньев.
 *
 * Координаты тела: плечи (±0.26, 1.46, 0), лицо ~(0, 1.78, 0.17), бёдра 0.92, ступни y=0, вперёд +Z.
 */

export type PoseId =
  | 'aim'
  | 'hipFire'
  | 'lowReady'
  | 'binoculars'
  | 'sitKnees'
  | 'fists'
  | 'run'
  | 'pointForward'
  | 'pointSide'
  | 'tablet'
  | 'tabletLow'
  | 'radio'
  | 'trophy'
  | 'grenadesLow'
  | 'throwReady'
  | 'hammer'
  | 'holdGrenade'
  | 'showItem'
  | 'defuseSit'
  | 'cover'
  | 'fistChest'
  | 'knifePistol'
  | 'pistolAim'
  | 'shoulderPistol'
  | 'stride';

export type Stance = 'neutral' | 'wide' | 'step' | 'cross' | 'relaxed' | 'stride';

export interface HandSpec {
  at: Vec3T;
  pole: Vec3T;
}

type WeaponSpec =
  /** Боевая стойка: приклад в плече, корпус вполоборота, руки как в бою */
  | { mode: 'combat' }
  /** Приклад в плечевом кармане, ствол по dir (например, низкая готовность); кисти на оружии */
  | { mode: 'shoulder'; dir: Vec3T }
  /** Приклад зажат локтем у бедра, ствол по dir; кисти на оружии */
  | { mode: 'hip'; dir: Vec3T }
  /** Оружие за рукоять в кисти; dir — куда смотрит ствол */
  | { mode: 'hand'; hand: 'r' | 'l'; dir: Vec3T }
  /** На ремне за спиной: плашмя, по диагонали */
  | { mode: 'back' }
  /** Лежит на боку на земле в точке [x, z] */
  | { mode: 'ground'; at: [number, number]; dir: Vec3T };

interface ItemSpec {
  kind: ItemKind;
  /** Кисть ('r'/'l') или точка в координатах тела */
  at: 'r' | 'l' | Vec3T;
  offset?: Vec3T;
  /** Поворот предмета (Эйлер XYZ, радианы); у предмета «верх» +Y, «вперёд» +Z */
  rot?: Vec3T;
}

interface BasePose {
  /** 'combat' — руки в боевой стойке */
  arms: 'combat' | { r: HandSpec; l: HandSpec };
  weapon: WeaponSpec;
  items?: ItemSpec[];
  finger?: boolean;
  head?: Vec3T;
  stance?: Stance;
  lean?: [number, number];
  /** Сидит на земле, ноги вперёд */
  sit?: boolean;
}

const BACK: WeaponSpec = { mode: 'back' };
const HIP_L: HandSpec = { at: [-0.22, 1.05, 0.02], pole: [-1, 0.2, -0.4] };
const LOW_L: HandSpec = { at: [-0.3, 0.92, 0.08], pole: [-0.3, 0, -1] };
const HANG_L: HandSpec = { at: [-0.32, 0.95, 0.04], pole: [-0.5, 0, -1] };
const ON_SHOULDER_R: HandSpec = { at: [0.24, 1.52, 0.24], pole: [1, -1, 0.3] };

export const POSES: Record<PoseId, BasePose> = {
  // Прицеливание: снайперы и стрелки
  aim: { arms: 'combat', weapon: { mode: 'combat' }, stance: 'step', lean: [0.04, 0] },
  // Стрельба от бедра с криком
  hipFire: {
    arms: { r: { at: [0.18, 1.12, 0.26], pole: [1, -0.6, -0.4] }, l: { at: [-0.04, 1.15, 0.44], pole: [-1, -0.6, -0.2] } },
    weapon: { mode: 'hip', dir: [-0.3, -0.05, 1] },
    head: [-0.2, 0, 0],
    stance: 'wide',
    lean: [0.08, 0],
  },
  // Оружие наизготовку перед собой
  lowReady: {
    arms: { r: { at: [0.12, 1.14, 0.24], pole: [1, -0.5, -0.5] }, l: { at: [-0.05, 1.1, 0.38], pole: [-1, -0.6, 0] } },
    weapon: { mode: 'shoulder', dir: [-0.4, -0.62, 0.68] },
    stance: 'relaxed',
  },
  // Бинокль у глаз
  binoculars: {
    arms: { r: { at: [0.07, 1.75, 0.22], pole: [1, -1, 0.2] }, l: { at: [-0.07, 1.75, 0.22], pole: [-1, -1, 0.2] } },
    weapon: BACK,
    items: [{ kind: 'binoculars', at: [0, 1.78, 0.24] }],
    stance: 'relaxed',
  },
  // Сидит, руки на коленях, винтовка рядом на земле
  sitKnees: {
    arms: { r: { at: [0.2, 1.04, 0.36], pole: [1, 0.2, -0.6] }, l: { at: [-0.2, 1.04, 0.36], pole: [-1, 0.2, -0.6] } },
    weapon: { mode: 'ground', at: [0.62, 0.25], dir: [0.1, 0, 1] },
    head: [0.12, 0, 0],
    sit: true,
  },
  // Боксёрская стойка
  fists: {
    arms: { r: { at: [0.1, 1.62, 0.3], pole: [1, -1, -0.2] }, l: { at: [-0.12, 1.55, 0.34], pole: [-1, -1, -0.2] } },
    weapon: BACK,
    head: [0.12, 0, 0],
    stance: 'step',
    lean: [0.05, 0],
  },
  // Бег, кулаки сжаты
  run: {
    arms: { r: { at: [0.27, 1.12, 0.3], pole: [1, -0.5, -1] }, l: { at: [-0.3, 1.14, -0.22], pole: [-1, -0.5, 1] } },
    weapon: BACK,
    stance: 'stride',
    lean: [0.15, 0],
  },
  // Капитан указывает вперёд, оружие в другой руке
  pointForward: {
    arms: { r: { at: [0.22, 1.5, 0.56], pole: [1, -1, 0] }, l: LOW_L },
    weapon: { mode: 'hand', hand: 'l', dir: [0.05, -0.72, 0.7] },
    finger: true,
    head: [-0.1, 0, 0],
    stance: 'step',
  },
  // Указывает в сторону вытянутой рукой
  pointSide: {
    arms: { r: { at: [0.8, 1.6, 0.15], pole: [0, -1, -0.3] }, l: HIP_L },
    weapon: BACK,
    finger: true,
    head: [0, 0.5, 0],
    stance: 'relaxed',
  },
  // Планшет у груди, взгляд в экран
  tablet: {
    arms: { r: { at: [0.13, 1.2, 0.32], pole: [1, -1, -0.3] }, l: { at: [-0.13, 1.2, 0.32], pole: [-1, -1, -0.3] } },
    weapon: BACK,
    items: [{ kind: 'tablet', at: [0, 1.21, 0.33], rot: [-0.7, 0, 0] }],
    head: [0.35, 0, 0],
    stance: 'neutral',
  },
  // Планшет у пояса
  tabletLow: {
    arms: { r: { at: [0.15, 1.08, 0.28], pole: [1, -1, -0.2] }, l: { at: [-0.12, 1.06, 0.27], pole: [-1, -1, -0.2] } },
    weapon: BACK,
    items: [{ kind: 'tablet', at: [0.01, 1.08, 0.29], rot: [-0.4, 0, 0.1] }],
    head: [0.3, 0.05, 0],
    stance: 'relaxed',
  },
  // Рация у рта
  radio: {
    arms: { r: { at: [0.11, 1.66, 0.18], pole: [1, -1, 0] }, l: HIP_L },
    weapon: BACK,
    items: [{ kind: 'radio', at: 'r', offset: [0, 0.02, 0.02], rot: [0.25, 0, -0.3] }],
    head: [-0.1, 0, 0],
    stance: 'wide',
  },
  // Кубок в руке, второй рукой — жест к трибунам
  trophy: {
    arms: { r: { at: [0.72, 1.5, 0.25], pole: [0, -1, -0.5] }, l: { at: [-0.06, 1.22, 0.3], pole: [-1, -1, -0.3] } },
    weapon: BACK,
    items: [{ kind: 'trophy', at: 'l', offset: [0, 0.08, 0] }],
    head: [0, 0.3, 0],
    stance: 'relaxed',
  },
  // Две гранаты в опущенных руках
  grenadesLow: {
    arms: { r: { at: [0.34, 0.96, 0.12], pole: [1, 0, -0.6] }, l: { at: [-0.34, 0.96, 0.12], pole: [-1, 0, -0.6] } },
    weapon: BACK,
    items: [
      { kind: 'smoke', at: 'r', offset: [0, -0.02, 0] },
      { kind: 'smoke', at: 'l', offset: [0, -0.02, 0] },
    ],
    stance: 'wide',
  },
  // Замах флешкой
  throwReady: {
    arms: { r: { at: [0.38, 1.95, -0.05], pole: [1, -0.2, -1] }, l: { at: [-0.12, 1.16, 0.28], pole: [-1, -1, 0] } },
    weapon: BACK,
    items: [
      { kind: 'flashbang', at: 'r', offset: [0, 0.04, 0] },
      { kind: 'grenade', at: 'l' },
    ],
    head: [-0.2, 0, 0],
    stance: 'step',
  },
  // Молот на плече
  hammer: {
    arms: { r: ON_SHOULDER_R, l: HIP_L },
    weapon: BACK,
    items: [{ kind: 'hammer', at: 'r', rot: [-0.9, 0, -0.2] }],
    stance: 'relaxed',
  },
  // Разглядывает гранату
  holdGrenade: {
    arms: { r: { at: [0.12, 1.38, 0.3], pole: [1, -1, 0] }, l: { at: [-0.3, 0.95, 0.1], pole: [-0.3, 0, -1] } },
    weapon: BACK,
    items: [
      { kind: 'grenade', at: 'r', offset: [0, 0.03, 0] },
      { kind: 'grenade', at: 'l' },
    ],
    head: [0.2, -0.1, 0],
    stance: 'neutral',
  },
  // Светящаяся флешка у плеча
  showItem: {
    arms: { r: { at: [0.32, 1.78, 0.18], pole: [1, -0.5, -0.3] }, l: HIP_L },
    weapon: BACK,
    items: [{ kind: 'flashbang', at: 'r', offset: [0, 0.05, 0] }],
    head: [0, 0.25, 0],
    stance: 'relaxed',
  },
  // Сидит над дефуз-китом
  // Наклон корпуса сидя не задаём: он опустил бы ноги и кит под землю — вниз смотрит голова
  defuseSit: {
    arms: { r: { at: [0.08, 1.0, 0.42], pole: [1, 0, -0.6] }, l: { at: [-0.09, 1.0, 0.41], pole: [-1, 0, -0.6] } },
    weapon: BACK,
    items: [{ kind: 'defuseKit', at: [0, 0.8, 0.46], rot: [0, Math.PI / 2, 0] }],
    head: [0.5, 0, 0],
    sit: true,
  },
  // Выглядывает из-за ящика
  cover: {
    arms: { r: { at: [0.06, 1.28, 0.27], pole: [1, -1, 0] }, l: { at: [-0.12, 1.26, 0.27], pole: [-1, -1, 0] } },
    weapon: BACK,
    // Ящик стоит на земле ровно: компенсируем наклон корпуса lean[1]
    items: [{ kind: 'crate', at: [-0.6, 0.665, 0.3], rot: [0, 0, -0.06] }],
    head: [0, -0.35, 0],
    lean: [0, 0.06],
    stance: 'neutral',
  },
  // Кулак у груди
  fistChest: {
    arms: { r: { at: [0.06, 1.35, 0.2], pole: [1, -1, 0] }, l: HANG_L },
    weapon: BACK,
    head: [-0.05, 0, 0],
    stance: 'relaxed',
  },
  // Пистолет у лица, нож в другой руке
  knifePistol: {
    arms: { r: { at: [0.3, 1.72, 0.15], pole: [1, -1, 0] }, l: { at: [-0.33, 0.92, 0.14], pole: [-0.4, 0, -1] } },
    weapon: BACK,
    items: [
      { kind: 'pistol', at: 'r', rot: [-1.57, 0, 0] },
      { kind: 'knife', at: 'l', rot: [0.5, 0, 0] },
    ],
    head: [0, -0.2, 0],
    stance: 'step',
    lean: [0.08, 0],
  },
  // Пистолет на вытянутой руке на бегу
  pistolAim: {
    arms: { r: { at: [0.22, 1.45, 0.56], pole: [1, -1, 0] }, l: { at: [-0.3, 1.12, -0.18], pole: [-1, -0.5, 1] } },
    weapon: BACK,
    items: [{ kind: 'pistol', at: 'r' }],
    stance: 'stride',
    lean: [0.1, 0],
  },
  // Пистолет на плече
  shoulderPistol: {
    arms: { r: ON_SHOULDER_R, l: HANG_L },
    weapon: BACK,
    items: [{ kind: 'pistol', at: 'r', rot: [-2.4, 0, 0] }],
    stance: 'relaxed',
  },
  // Уверенный шаг
  stride: {
    arms: { r: { at: [0.3, 1.0, 0.24], pole: [1, 0, -1] }, l: { at: [-0.3, 1.02, -0.2], pole: [-1, 0, 1] } },
    weapon: BACK,
    head: [-0.05, 0, 0],
    stance: 'stride',
  },
};

interface UnitPose {
  base: PoseId;
  head?: Vec3T;
  stance?: Stance;
  lean?: [number, number];
}

/** Поза каждого юнита по концепт-арту. Повторы основы различаются стойкой, наклоном и головой. */
const UNIT_POSES: Record<string, UnitPose> = {
  // AWPer
  s1mply: { base: 'aim' },
  nightowl: { base: 'aim', stance: 'relaxed', head: [0.05, 0, 0.04] },
  kestrel: { base: 'binoculars' },
  grimsight: { base: 'sitKnees' },
  'volt-aw': { base: 'aim', stance: 'wide', lean: [0.02, 0] },
  ex1le: { base: 'aim', stance: 'cross', lean: [0.07, 0], head: [0.08, 0, 0] },
  // Entry Fragger
  'd0nk-2k': { base: 'hipFire' },
  rampage: { base: 'hipFire', stance: 'step', head: [0, 0.1, 0], lean: [0.05, 0] },
  torrent: { base: 'lowReady' },
  spark1e: { base: 'fists' },
  'breach-r': { base: 'run' },
  'viper-k': { base: 'aim', stance: 'stride', lean: [0.1, 0] },
  // IGL
  maestro: { base: 'pointForward' },
  chessmind: { base: 'tablet' },
  overseer: { base: 'pointSide' },
  tactix: { base: 'radio' },
  'capt-nova': { base: 'tabletLow' },
  archon: { base: 'trophy' },
  // Support
  'zyw0w-core': { base: 'grenadesLow' },
  ember: { base: 'throwReady' },
  bulwark: { base: 'hammer' },
  'medic-9': { base: 'holdGrenade' },
  flashpoint: { base: 'showItem' },
  lumen: { base: 'defuseSit' },
  // Lurker
  ghostwalk: { base: 'shoulderPistol' },
  slyfox: { base: 'cover' },
  shade: { base: 'fistChest' },
  ph4ntom: { base: 'knifePistol' },
  nomad: { base: 'pistolAim' },
  wraith: { base: 'stride', head: [-0.1, -0.15, 0] },
};

/** Наклон ног [x, z]: левая и правая */
const STANCES: Record<Stance, [[number, number], [number, number]]> = {
  neutral: [[0, 0], [0, 0]],
  wide: [[0, -0.13], [0, 0.13]],
  step: [[0.18, -0.04], [-0.25, 0.05]],
  cross: [[0.05, 0.17], [-0.02, -0.03]],
  relaxed: [[0, -0.05], [-0.12, 0.1]],
  stride: [[0.35, -0.03], [-0.45, 0.03]],
};

/* ---------------------------------- IK ------------------------------------ */

export interface ArmSolution {
  upper: THREE.Quaternion;
  fore: THREE.Quaternion;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
/** Досягаемость кисти от плеча (с небольшим запасом, чтобы рука не была «в струну») */
export const REACH = UPPER_ARM + FOREARM - 0.03;
/** Полюса локтей при хвате оружия: правый — наружу и вниз, левый — вниз под цевьё */
const POLE_R = new THREE.Vector3(1, -0.9, -0.3);
const POLE_L = new THREE.Vector3(-0.5, -1, 0.1);

const v3 = (t: Vec3T) => new THREE.Vector3(t[0], t[1], t[2]);

/** IK из двух звеньев: плечо → локоть → кисть, локоть отводится в сторону полюса */
export function solveArm(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): ArmSolution {
  const st = target.clone().sub(shoulder);
  const dir = st.lengthSq() > 1e-8 ? st.clone().normalize() : DOWN.clone();
  const d = THREE.MathUtils.clamp(st.length(), Math.abs(UPPER_ARM - FOREARM) + 0.02, UPPER_ARM + FOREARM - 0.002);
  const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
  const p = pole.clone().normalize();
  p.sub(dir.clone().multiplyScalar(p.dot(dir)));
  // Полюс совпал с направлением руки — берём любой перпендикуляр
  if (p.lengthSq() < 1e-6) p.crossVectors(dir, Math.abs(dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : FORWARD);
  p.normalize();
  const elbow = shoulder.clone().addScaledVector(dir, along).addScaledVector(p, h);
  const hand = shoulder.clone().addScaledVector(dir, d);
  const upperDir = elbow.clone().sub(shoulder).normalize();
  const foreDir = hand.clone().sub(elbow).normalize();
  const upper = new THREE.Quaternion().setFromUnitVectors(DOWN, upperDir);
  const local = foreDir.applyQuaternion(upper.clone().invert());
  const fore = new THREE.Quaternion().setFromUnitVectors(DOWN, local);
  return { upper, fore };
}

/** Ориентация по осям: x — «бок» предмета, z — «вперёд» (y = z × x) */
export function basisQuat(x: THREE.Vector3, z: THREE.Vector3): THREE.Quaternion {
  const zz = z.clone().normalize();
  const xx = x.clone().sub(zz.clone().multiplyScalar(x.dot(zz))).normalize();
  const yy = new THREE.Vector3().crossVectors(zz, xx);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zz));
}

/** Ствол по dir без крена: верх оружия смотрит как можно ближе к вертикали */
export function aimQuat(dir: Vec3T | THREE.Vector3): THREE.Quaternion {
  const z = Array.isArray(dir) ? v3(dir) : dir.clone();
  const x = new THREE.Vector3().crossVectors(UP, z.normalize());
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  return basisQuat(x, z);
}

/** Оставлено для совместимости: поворот «вперёд → dir» */
export function weaponQuat(dir: Vec3T): THREE.Quaternion {
  return aimQuat(dir);
}

/** Положение и ориентация модели оружия в координатах тела */
export interface WeaponPlacement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** Локальная точка оружия [y, z] с учётом масштаба модели */
function localPt(w: WeaponModel, yz: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(0, yz[0] * w.scale, yz[1] * w.scale);
}

/** Где окажется локальная точка оружия в координатах тела */
export function weaponPoint(w: WeaponModel, pl: WeaponPlacement, yz: [number, number]): THREE.Vector3 {
  return localPt(w, yz).applyQuaternion(pl.quat).add(pl.pos);
}

/** Ставит оружие так, чтобы его точка yz совпала с target */
function pinAt(w: WeaponModel, yz: [number, number], target: THREE.Vector3, quat: THREE.Quaternion): WeaponPlacement {
  return { pos: target.clone().sub(localPt(w, yz).applyQuaternion(quat)), quat };
}

/** Направление ствола в боевой стойке: корпус развёрнут вполоборота, ствол смотрит на цель */
export function combatDir(w: WeaponModel): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(w.hold.blade), 0, Math.cos(w.hold.blade));
}

/**
 * Приклад в плечевом кармане перед грудью (у пистолетов — рукоять на вытянутых руках перед лицом).
 * Затыльник чуть отодвинут от груди: при развороте его дальний угол уходит назад.
 */
export function shoulderPlacement(h: Humanoid, w: WeaponModel, dir: THREE.Vector3): WeaponPlacement {
  const q = aimQuat(dir);
  if (!w.hold.butt) {
    const grip = new THREE.Vector3(0, 1.42, 0).addScaledVector(dir.clone().normalize(), 0.5);
    return pinAt(w, w.hold.grip, grip, q);
  }
  const halfW = (w.bounds.max.x - w.bounds.min.x) * 0.5 * w.scale;
  const tilt = Math.abs(dir.x) / Math.hypot(dir.x, dir.z || 1e-6);
  const pocket = new THREE.Vector3(0.12 + (h.shoulderX - SHOULDER_X) * 0.5, 1.4, h.chestZ + 0.015 + halfW * tilt);
  return pinAt(w, w.hold.butt, pocket, q);
}

/** Приклад зажат локтем сбоку у бедра, снаружи торса */
export function hipPlacement(h: Humanoid, w: WeaponModel, dir: THREE.Vector3): WeaponPlacement {
  const q = aimQuat(dir);
  const halfW = (w.bounds.max.x - w.bounds.min.x) * 0.5 * w.scale;
  const butt = new THREE.Vector3(h.torsoHalfW + halfW + 0.045, 1.14, -0.02);
  return pinAt(w, w.hold.butt ?? w.hold.grip, butt, q);
}

/**
 * На ремне за спиной: оружие лежит боком к спине, по диагонали (ствол вверх над правым плечом).
 * sit — сидя: ремень ниже и почти горизонтально, чтобы приклад не уходил в землю.
 */
export function backPlacement(h: Humanoid, w: WeaponModel, sit = false): WeaponPlacement {
  const ang = sit ? 1.0 : 0.72;
  const along = new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0);
  const q = basisQuat(new THREE.Vector3(0, 0, -1), along);
  const b = w.bounds;
  const center = new THREE.Vector3(0, ((b.min.y + b.max.y) / 2) * w.scale, ((b.min.z + b.max.z) / 2) * w.scale).applyQuaternion(q);
  // Ближайшая к спине сторона модели (локальный -X) ложится на спину с зазором
  const z = h.backZ - 0.012 + b.min.x * w.scale;
  return { pos: new THREE.Vector3(-center.x, (sit ? 1.3 : 1.15) - center.y, z), quat: q };
}

/** Лежит на земле на боку (groundY — уровень земли в координатах тела) */
export function groundPlacement(w: WeaponModel, at: [number, number], dir: Vec3T, groundY: number): WeaponPlacement {
  const fwd = v3(dir).setY(0).normalize();
  const q = basisQuat(new THREE.Vector3(0, 1, 0), fwd);
  return { pos: new THREE.Vector3(at[0], groundY - w.bounds.min.x * w.scale + 0.004, at[1]), quat: q };
}

/** Рукоять в заданной точке (оружие в одной руке) */
export function gripPlacement(w: WeaponModel, hand: THREE.Vector3, dir: Vec3T | THREE.Vector3): WeaponPlacement {
  return pinAt(w, w.hold.grip, hand, aimQuat(dir));
}

/** Точка для второй руки: самая дальняя досягаемая из точек хвата; если не дотянуться — ближе к рукояти */
export function supportTarget(w: WeaponModel, pl: WeaponPlacement, shoulder: THREE.Vector3): THREE.Vector3 | null {
  for (const s of w.hold.support) {
    const p = weaponPoint(w, pl, s);
    if (p.distanceTo(shoulder) <= REACH) return p;
  }
  return null;
}

export interface HeldArms {
  armR: ArmSolution;
  /** null — вторая рука не дотягивается до оружия */
  armL: ArmSolution | null;
}

/** Кисти на оружии: правая — на рукояти, левая — на цевье/шахте магазина, если дотягивается */
export function armsOnWeapon(h: Humanoid, w: WeaponModel, pl: WeaponPlacement): HeldArms {
  const sR = new THREE.Vector3(h.shoulderX, SHOULDER_Y, 0);
  const sL = new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0);
  const armR = solveArm(sR, weaponPoint(w, pl, w.hold.grip), POLE_R);
  const sup = supportTarget(w, pl, sL);
  return { armR, armL: sup ? solveArm(sL, sup, POLE_L) : null };
}

/** Ставит руки гуманоида в позу (используется для врагов) */
export function poseArms(h: Humanoid, r: HandSpec, l: HandSpec): void {
  const sr = solveArm(new THREE.Vector3(h.shoulderX, SHOULDER_Y, 0), v3(r.at), v3(r.pole));
  const sl = solveArm(new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0), v3(l.at), v3(l.pole));
  h.armR.quaternion.copy(sr.upper);
  h.foreR.quaternion.copy(sr.fore);
  h.armL.quaternion.copy(sl.upper);
  h.foreL.quaternion.copy(sl.fore);
}

/** Применяет решение IK к руке гуманоида */
export function setArm(h: Humanoid, side: 'r' | 'l', a: ArmSolution): void {
  (side === 'r' ? h.armR : h.armL).quaternion.copy(a.upper);
  (side === 'r' ? h.foreR : h.foreL).quaternion.copy(a.fore);
}

/* ------------------------------- Решение позы ------------------------------ */

export interface SolvedItem {
  kind: ItemKind;
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

export interface SolvedPose {
  /** Руки в боевой стойке (armR/armL не используются) */
  combatArms: boolean;
  armR: ArmSolution | null;
  armL: ArmSolution | null;
  legL: [number, number];
  legR: [number, number];
  head: Vec3T;
  lean: [number, number];
  sit: boolean;
  /** Оружие остаётся в боевом креплении */
  weaponCombat: boolean;
  /** Положение и ориентация оружия в координатах тела */
  weaponPos: THREE.Vector3;
  weaponQuat: THREE.Quaternion;
  finger: boolean;
  items: SolvedItem[];
}

export function hasPose(unitId: string): boolean {
  return unitId in UNIT_POSES;
}

export function solvePose(unitId: string, h: Humanoid, w: WeaponModel): SolvedPose {
  const up = UNIT_POSES[unitId] ?? { base: 'lowReady' as PoseId };
  const base = POSES[up.base];
  const stance = STANCES[up.stance ?? base.stance ?? 'neutral'];
  const shoulderR = new THREE.Vector3(h.shoulderX, SHOULDER_Y, 0);
  const shoulderL = new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0);

  let armR: ArmSolution | null = null;
  let armL: ArmSolution | null = null;
  let handR = new THREE.Vector3(0.2, 1.1, 0.2);
  let handL = new THREE.Vector3(-0.2, 1.1, 0.2);
  if (base.arms !== 'combat') {
    handR = v3(base.arms.r.at);
    handL = v3(base.arms.l.at);
    armR = solveArm(shoulderR, handR, v3(base.arms.r.pole));
    armL = solveArm(shoulderL, handL, v3(base.arms.l.pole));
  }

  const wspec = base.weapon;
  let pl: WeaponPlacement = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  switch (wspec.mode) {
    case 'combat':
      break;
    case 'shoulder':
    case 'hip': {
      pl = wspec.mode === 'shoulder' ? shoulderPlacement(h, w, v3(wspec.dir)) : hipPlacement(h, w, v3(wspec.dir));
      // Кисти переезжают на оружие; вторая рука остаётся в позе, если не дотягивается
      const held = armsOnWeapon(h, w, pl);
      armR = held.armR;
      if (held.armL) armL = held.armL;
      break;
    }
    case 'hand':
      pl = gripPlacement(w, wspec.hand === 'r' ? handR : handL, wspec.dir);
      break;
    case 'back':
      pl = backPlacement(h, w, !!base.sit);
      break;
    case 'ground':
      pl = groundPlacement(w, wspec.at, wspec.dir, base.sit ? 0.8 : 0);
      break;
  }

  const items: SolvedItem[] = (base.items ?? []).map((it) => {
    const anchor = it.at === 'r' ? handR : it.at === 'l' ? handL : v3(it.at);
    const pos = anchor.clone().add(it.offset ? v3(it.offset) : new THREE.Vector3());
    const r = it.rot ?? [0, 0, 0];
    return { kind: it.kind, pos, rot: new THREE.Euler(r[0], r[1], r[2]) };
  });

  return {
    combatArms: base.arms === 'combat',
    armR,
    armL,
    legL: stance[0],
    legR: stance[1],
    head: up.head ?? base.head ?? [0, 0, 0],
    lean: up.lean ?? base.lean ?? [0, 0],
    sit: !!base.sit,
    weaponCombat: wspec.mode === 'combat',
    weaponPos: pl.pos,
    weaponQuat: pl.quat,
    finger: !!base.finger,
    items,
  };
}
