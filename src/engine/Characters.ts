import * as THREE from 'three';
import type { BeltProp, EnemyKind, GearKind, UnitDef, WeaponKind } from '../types/game';
import { ROLE_COLORS } from '../i18n';
import { HpBar, add, boxG, buildThrowable, buildWeapon, cachedGeo, cylG, darken, shared, sphG, stdMat, torusG } from './ModelFactory';
import type { WeaponModel } from './ModelFactory';
import { FOREARM, SHOULDER_Y, buildHumanoid, buildItem } from './Humanoid';
import type { Humanoid, HumanoidOpts, ItemKind } from './Humanoid';
import {
  armsOnWeapon, basisQuat, combatDir, gripPlacement, hasPose, hipPlacement, poseArms, setArm, shoulderPlacement, solveArm, solvePose, weaponPoint,
} from './Poses';
import type { ArmSolution, HandSpec, SolvedPose, WeaponPlacement } from './Poses';
import {
  alertTexture, blingTexture, keyboardTexture, matrixTexture, pajamaTexture, pixelTexture, ringTexture, textTexture, unplugTexture, wifiTexture,
} from './Textures';
import { getTexture } from './Textures';

/**
 * Модели персонажей: бойцы отряда (внешность, фирменные позы, предметы) и враги
 * по концепт-артам «Юниты и враги» и «Новые противники».
 */

/* ------------------------------ Боец отряда ------------------------------- */

const GEAR_COLORS: Record<GearKind, number> = {
  helmet: 0x3b4636,
  headset: 0x111111,
  visor: 0x111827,
  cap: 0x1f2937,
  beanie: 0x27303f,
  hood: 0x262b36,
  bandana: 0x16a34a,
  none: 0x111111,
};

/** Какой предмет в руках дублирует аксессуар на поясе (его на время позы прячем) */
const BELT_FOR_ITEM: Partial<Record<ItemKind, BeltProp>> = {
  tablet: 'tablet',
  defuseKit: 'defuse',
  smoke: 'smoke',
  flashbang: 'flashes',
  knife: 'knife',
};

const IDENTITY_Q = new THREE.Quaternion();
const ZERO_V = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const POLE_L_GRIP = new THREE.Vector3(-0.5, -1, 0.1);

export class UnitModel {
  readonly root: THREE.Group;
  readonly human: Humanoid;
  private weapon: WeaponModel;
  private def: UnitDef;
  private recoilT = 0;
  private time = Math.random() * 10;
  private yaw = 0;
  private bodyScale: number;
  /** Боевая стойка (из конструктора гуманоида) — к ней возвращаемся из позы */
  private combat: { armR: THREE.Quaternion; foreR: THREE.Quaternion; armL: THREE.Quaternion; foreL: THREE.Quaternion };
  private pose: SolvedPose | null = null;
  private poseW = 0;
  private poseTarget = 0;
  private items: THREE.Group | null = null;
  private hidesBelt = false;
  /** Боевое положение оружия (крепление) в координатах тела */
  private mountPos = new THREE.Vector3();
  private mountQuat = new THREE.Quaternion();
  private mountInv = new THREE.Quaternion();
  /** Направление ствола в боевой стойке (координаты тела) — для отдачи */
  private aimDir = new THREE.Vector3(0, 0, 1);
  /** Разворот корпуса вполоборота в боевой стойке */
  private blade = 0;
  private combatHead: [number, number, number] = [0, 0, 0];
  private tmpQ = new THREE.Quaternion();

  constructor(def: UnitDef, tier: number) {
    this.def = def;
    const look = def.look;
    this.bodyScale = 1.2 * look.height;
    // Кепка козырьком назад — чёрная (как на арте), остальные кепки и шапки — в цвет акцента
    const gearColor = look.capBackwards
      ? 0x111111
      : def.gear === 'cap' || def.gear === 'beanie'
        ? darken(def.accent, 0.35)
        : def.gear === 'hood'
          ? darken(look.jersey, 0.35)
          : GEAR_COLORS[def.gear];
    this.human = buildHumanoid({
      skin: def.skin,
      hair: def.hair,
      shirt: look.jersey,
      stripe: look.stripe,
      pants: 0x1f2430,
      accent: def.accent,
      roleColor: ROLE_COLORS[def.role],
      gear: def.gear,
      gearColor,
      capBackwards: look.capBackwards,
      hairStyle: look.hairStyle,
      beard: look.beard,
      glasses: look.glasses,
      mask: look.mask,
      maskColor: 0x111111,
      sleeves: look.sleeves,
      tattoos: look.tattoos,
      gloves: look.gloves,
      vest: look.tacVest ? 0x1f2937 : undefined,
      harness: look.harness,
      girth: look.girth,
      belly: look.belly,
      prop: look.prop,
      scale: this.bodyScale,
    });
    this.root = this.human.root;
    const h = this.human;
    this.combat = { armR: h.armR.quaternion.clone(), foreR: h.foreR.quaternion.clone(), armL: h.armL.quaternion.clone(), foreL: h.foreL.quaternion.clone() };
    this.weapon = buildWeapon(def.tiers[tier].weapon, tier, def.accent);
    this.human.weaponMount.add(this.weapon.group);
    this.setupCombat();
    this.applyPose();
  }

  /**
   * Боевая стойка под текущее оружие: приклад в плечевом кармане, корпус вполоборота (ствол при этом
   * смотрит на цель), правая кисть на рукояти, левая — на цевье или шахте магазина.
   */
  private setupCombat(): void {
    const h = this.human;
    const w = this.weapon;
    const dir = combatDir(w);
    const pl = shoulderPlacement(h, w, dir);
    this.mountPos.copy(pl.pos);
    this.mountQuat.copy(pl.quat);
    this.mountInv.copy(pl.quat).invert();
    h.weaponMount.position.copy(pl.pos);
    h.weaponMount.quaternion.copy(pl.quat);
    this.aimDir.copy(dir);
    this.blade = w.hold.blade;
    this.combatHead = [0.06, -this.blade * 0.85, 0];
    const held = armsOnWeapon(h, w, pl);
    // Не дотянуться до цевья — вторая кисть ложится вплотную к рукояти
    const armL =
      held.armL ??
      solveArm(new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0), weaponPoint(w, pl, [w.hold.grip[0] - 0.01, w.hold.grip[1] + 0.1]), POLE_L_GRIP);
    this.combat = { armR: held.armR.upper, foreR: held.armR.fore, armL: armL.upper, foreL: armL.fore };
    // Поза зависит от оружия (за спиной, у бедра) — пересчитаем при следующем входе
    this.pose = null;
  }

  setTier(tier: number): void {
    this.human.weaponMount.remove(this.weapon.group);
    this.weapon = buildWeapon(this.def.tiers[tier].weapon, tier, this.def.accent);
    this.human.weaponMount.add(this.weapon.group);
    this.setupCombat();
    this.applyPose();
  }

  /** Насколько боец сейчас в позе (0 — боевая стойка, 1 — поза) */
  get poseWeight(): number {
    return this.poseW;
  }

  /** Включить/выключить фирменную позу; instant — без плавного перехода (превью) */
  setPosing(on: boolean, instant = false): void {
    if (!hasPose(this.def.id)) on = false;
    this.poseTarget = on ? 1 : 0;
    if (instant) {
      this.poseW = this.poseTarget;
      this.applyPose();
    }
  }

  private buildItems(p: SolvedPose): void {
    this.items?.removeFromParent();
    this.items = new THREE.Group();
    for (const it of p.items) {
      const obj = buildItem(it.kind, it.kind === 'smoke' ? 0x9ca3af : this.def.accent);
      obj.position.copy(it.pos);
      obj.rotation.copy(it.rot);
      this.items.add(obj);
    }
    this.items.visible = false;
    this.human.body.add(this.items);
    this.hidesBelt = p.items.some((it) => BELT_FOR_ITEM[it.kind] === this.def.look.prop);
  }

  private applyPose(): void {
    const h = this.human;
    const w = this.poseW;
    const ch = this.combatHead;
    if (w <= 0.0001) {
      h.armR.quaternion.copy(this.combat.armR);
      h.foreR.quaternion.copy(this.combat.foreR);
      h.armL.quaternion.copy(this.combat.armL);
      h.foreL.quaternion.copy(this.combat.foreL);
      h.legL.rotation.set(0, 0, 0);
      h.legR.rotation.set(0, 0, 0);
      h.head.rotation.set(ch[0], ch[1], ch[2]);
      h.body.rotation.x = 0;
      h.body.rotation.z = 0;
      h.body.position.y = 0;
      this.weapon.group.position.set(0, 0, 0);
      this.weapon.group.quaternion.identity();
      h.fingerR.visible = false;
      if (this.items) this.items.visible = false;
      if (h.beltProp) h.beltProp.visible = true;
      this.applyYaw();
      return;
    }
    if (!this.pose) {
      this.pose = solvePose(this.def.id, h, this.weapon);
      this.buildItems(this.pose);
    }
    const p = this.pose;
    if (p.combatArms || !p.armR || !p.armL) {
      h.armR.quaternion.copy(this.combat.armR);
      h.foreR.quaternion.copy(this.combat.foreR);
      h.armL.quaternion.copy(this.combat.armL);
      h.foreL.quaternion.copy(this.combat.foreL);
    } else {
      h.armR.quaternion.slerpQuaternions(this.combat.armR, p.armR.upper, w);
      h.foreR.quaternion.slerpQuaternions(this.combat.foreR, p.armR.fore, w);
      h.armL.quaternion.slerpQuaternions(this.combat.armL, p.armL.upper, w);
      h.foreL.quaternion.slerpQuaternions(this.combat.foreL, p.armL.fore, w);
    }
    if (p.sit) {
      // Сидит: бёдра опущены к земле, ноги вытянуты вперёд
      h.legL.rotation.set(-1.45 * w, 0, -0.32 * w);
      h.legR.rotation.set(-1.45 * w, 0, 0.32 * w);
      h.body.position.y = -0.8 * this.bodyScale * w;
    } else {
      h.legL.rotation.set(p.legL[0] * w, 0, p.legL[1] * w);
      h.legR.rotation.set(p.legR[0] * w, 0, p.legR[1] * w);
      h.body.position.y = 0;
    }
    // Голова: в боевой стойке смотрит на цель (корпус развёрнут), в позе — как задано позой
    const hk = p.weaponCombat ? 1 : 1 - w;
    h.head.rotation.set(ch[0] * hk + p.head[0] * w, ch[1] * hk + p.head[1] * w, ch[2] * hk + p.head[2] * w);
    h.body.rotation.x = p.lean[0] * w;
    h.body.rotation.z = p.lean[1] * w;
    if (p.weaponCombat) {
      this.weapon.group.position.set(0, 0, 0);
      this.weapon.group.quaternion.identity();
    } else {
      // Оружие живёт внутри боевого крепления: переводим позу из координат тела в координаты крепления
      const local = p.weaponPos.clone().sub(this.mountPos).applyQuaternion(this.mountInv);
      const localQ = this.mountInv.clone().multiply(p.weaponQuat);
      this.weapon.group.position.lerpVectors(ZERO_V, local, w);
      this.weapon.group.quaternion.slerpQuaternions(IDENTITY_Q, localQ, w);
    }
    const shown = w > 0.5;
    h.fingerR.visible = p.finger && shown;
    if (this.items) this.items.visible = shown;
    if (h.beltProp) h.beltProp.visible = !(this.hidesBelt && shown);
    this.applyYaw();
  }

  get muzzle(): THREE.Object3D {
    return this.weapon.muzzle;
  }

  recoil(): void {
    this.recoilT = 1;
  }

  /** Плавный поворот корпуса к цели (yaw в радианах) */
  aim(targetYaw: number, dt: number): void {
    let d = targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 12);
    this.applyYaw();
  }

  idle(dt: number): void {
    // В фирменной позе боец стоит спокойно, без «осматривания»
    if (this.poseTarget === 0) this.yaw += Math.sin(this.time * 0.6) * dt * 0.35;
    this.applyYaw();
  }

  /** Корпус вполоборота в боевой стойке: ствол смотрит ровно по yaw */
  private applyYaw(): void {
    const k = this.pose?.weaponCombat ? 1 : 1 - this.poseW;
    this.human.body.rotation.y = this.yaw + this.blade * k;
  }

  update(dt: number): void {
    this.time += dt;
    this.recoilT = Math.max(0, this.recoilT - dt * 9);
    const k = this.recoilT * this.recoilT;
    // Отдача: оружие уходит назад вдоль ствола и чуть задирается
    this.human.weaponMount.position.copy(this.mountPos).addScaledVector(this.aimDir, -k * 0.05);
    this.human.weaponMount.quaternion.copy(this.mountQuat).multiply(this.tmpQ.setFromAxisAngle(AXIS_X, -k * 0.1));
    this.human.torso.scale.y = 1 + Math.sin(this.time * 2.2) * 0.012;
    if (this.poseW !== this.poseTarget) {
      // В позу — спокойно (~0.4 с), обратно в прицел — быстро (~0.15 с)
      const speed = this.poseTarget > this.poseW ? 2.5 : 7;
      this.poseW = this.poseTarget > this.poseW ? Math.min(1, this.poseW + dt * speed) : Math.max(0, this.poseW - dt * speed);
      this.applyPose();
    }
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.weapon.muzzle.getWorldPosition(out);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/* --------------------------------- Враги ---------------------------------- */

const SKIN_TONES = [0xe8b894, 0xc68e62, 0xf1c7a3, 0x8d5a3b, 0xdcae8a, 0xa86f4c];
const HAIR_TONES = [0x2b1d14, 0x4a3222, 0x111111, 0x6b4423, 0x3b2a1e];
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Руки в беге: правая вперёд, левая назад (врагам без оружия в правой руке) */
const RUN_R: HandSpec = { at: [0.27, 1.12, 0.3], pole: [1, -0.5, -1] };
const RUN_L: HandSpec = { at: [-0.3, 1.12, -0.2], pole: [-1, -0.5, 1] };
/** Оружие у бедра двумя руками */
const HIP_R: HandSpec = { at: [0.18, 1.12, 0.26], pole: [1, -0.6, -0.4] };
const HIP_L: HandSpec = { at: [-0.04, 1.15, 0.44], pole: [-1, -0.6, -0.2] };

function sprite(map: THREE.Texture, key: string, w: number, h: number, y: number): THREE.Sprite {
  const s = new THREE.Sprite(shared(key, () => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })));
  s.scale.set(w, h, 1);
  s.position.y = y;
  return s;
}

/** Насколько опускается корпус в стойке на колене (Кемпер со щитом, Вантап при прицеливании) */
const CROUCH = 0.22;
/** Угол ног в стойке: ступни остаются на земле при опущенном на CROUCH тазе */
const kneelAngle = (scale: number) => Math.acos(1 - CROUCH / (0.92 * scale));
/** Высота сиденья игрового кресла Стримера */
const STREAMER_SEAT = 0.6;
const CAMPER_SCALE = 1.05;
/** Высота мини-тиммейта на спине Бустера */
const RIDER_Y = 0.95;
const UP = new THREE.Vector3(0, 1, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const CRATE_GOLD = new THREE.Color(0xfbbf24);
const CRATE_RED = new THREE.Color(0xef4444);

/** Хват оружия: положение в креплении и решения рук (для плавной смены стойки) */
interface Hold {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  rU: THREE.Quaternion;
  rF: THREE.Quaternion;
  lU: THREE.Quaternion;
  lF: THREE.Quaternion;
}

/** Враги с энергощитом: полоска HP со шкалой щита */
const SHIELDED = new Set<EnemyKind>(['spinbot', 'reactor_core', 'overpass_overlord', 'container_mech']);

const ghostMats = new Map<string, THREE.Material>();
/** Полупрозрачный силуэт: материалы гуманоида заменяются прозрачными копиями (кэш на все модели) */
function ghostly(h: Humanoid, opacity: number): void {
  h.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material;
    const key = `${src.uuid}|${opacity}`;
    let g = ghostMats.get(key);
    if (!g) {
      g = src.clone();
      g.transparent = true;
      g.opacity = opacity;
      ghostMats.set(key, g);
    }
    m.material = g;
  });
}

function assertNever(x: never): never {
  throw new Error(`Unknown enemy kind: ${String(x)}`);
}

function slerpArm(h: Humanoid, a: ArmSolution, b: ArmSolution, k: number): void {
  h.armR.quaternion.slerpQuaternions(a.upper, b.upper, k);
  h.foreR.quaternion.slerpQuaternions(a.fore, b.fore, k);
}

/** Мини-гуманоид на спине Бустера и Буст-тиммейт: каска, светлая футболка, оливковый жилет */
function allyOpts(skin: number, hair: number, scale: number): HumanoidOpts {
  return {
    skin, hair, shirt: 0xd6c7a1, pants: 0x3b5b8a, vest: 0x4d5b2e, accent: 0xf97316, gear: 'helmet', gearColor: 0x4d5b3a,
    sleeves: 'short', mouthOpen: true, scale,
  };
}

/** Заменяет все материалы гуманоида, кроме светящихся глаз */
function reskin(h: Humanoid, mat: THREE.Material, keep: Set<THREE.Material>): void {
  h.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !keep.has(m.material as THREE.Material)) m.material = mat;
  });
}

export class EnemyModel {
  readonly root = new THREE.Group();
  /** Визуальная часть, которая поворачивается по направлению движения */
  readonly body = new THREE.Group();
  readonly hp: HpBar;
  readonly kind: EnemyKind;
  readonly height: number;
  private human: Humanoid | null = null;
  private time = Math.random() * 10;
  private parts: THREE.Object3D[] = [];
  private shieldMesh: THREE.Mesh | null = null;
  private ringMesh: THREE.Mesh | null = null;
  private ringMax = 3.5;
  private glitchT = 0;
  private stepAmp = 0.6;
  private ownMats: THREE.Material[] = [];
  /** Оружие в руках (дуло — начало лазера Вантап-снайпера) */
  private weapon: WeaponModel | null = null;
  /** 'none' — модель не шагает ногами гуманоида (кресло Стримера) */
  private gait: 'walk' | 'none' = 'walk';
  /** Постоянное смещение гуманоида по высоте (сидит в кресле) */
  private baseY = 0;
  /** Стойка на колене: цель и текущая доля 0..1 */
  private stanceOn = false;
  private stance = 0;
  private kneelA = 0.7;
  private shieldPivot: THREE.Group | null = null;
  private rider: Humanoid | null = null;
  private shards: THREE.Group | null = null;
  private rageWire: THREE.Object3D | null = null;
  private orbit: THREE.Group | null = null;
  private drones: THREE.Group[] = [];
  private crateBox: THREE.Group | null = null;
  private crateFrame: THREE.Group | null = null;
  private crateRing: THREE.Mesh | null = null;
  private crateMat: THREE.MeshBasicMaterial | null = null;
  private crateFrac = 1;
  private pulseT = 0;
  private throwPose: { idle: ArmSolution; wind: ArmSolution; release: ArmSolution } | null = null;
  private bottle: THREE.Group | null = null;
  private throwT = 0;
  private returnT = 0;
  private reloadT = 0;
  private holdLow: Hold | null = null;
  private holdAim: Hold | null = null;
  private laser: THREE.Mesh | null = null;
  private laserDot: THREE.Mesh | null = null;
  private laserMat: THREE.MeshBasicMaterial | null = null;
  /** Ноги/руки механизмов (Бот-ферма, Мини-бот) и мигающие диоды */
  private rigLegs: THREE.Object3D[] = [];
  private rigArms: THREE.Object3D[] = [];
  private blink: THREE.Object3D[] = [];
  private rack: THREE.Group | null = null;
  /** Масштаб щита Кемпера / Штурмовика */
  private shieldK = 1;
  private shieldOpacity: [number, number] = [0.06, 0.22];
  /** Боссы и мини-боссы */
  private sandRing: THREE.Group | null = null;
  private sandMat: THREE.MeshBasicMaterial | null = null;
  private stormOn = false;
  private storm = 0;
  private rage = false;
  private flames: THREE.Object3D[] = [];
  private coreMat: THREE.MeshStandardMaterial | null = null;
  private pulseK = 0;
  private turrets: THREE.Group[] = [];
  private turretMuzzles: THREE.Object3D[] = [];
  private turretAim: THREE.Vector3 | null = null;
  private cape: THREE.Object3D | null = null;

  constructor(kind: EnemyKind) {
    this.kind = kind;
    this.root.add(this.body);
    const skin = pick(SKIN_TONES);
    const hair = pick(HAIR_TONES);
    let barW = 0.9;
    let barH = 2.3;
    switch (kind) {
      case 'eco': {
        const h = this.mkHuman({ skin, hair, shirt: 0x6b6a3a, pants: 0x3f4148, accent: 0xb45309, gear: 'none', sleeves: 'short' });
        poseArms(h, { at: [0.24, 1.42, 0.55], pole: [1, -1, 0] }, RUN_L);
        // Пистолет в одной вытянутой руке
        this.equip(h, 'pistol', (w) => gripPlacement(w, new THREE.Vector3(0.24, 1.42, 0.55), [0, 0, 1]), RUN_L, true);
        h.body.rotation.x = 0.12;
        break;
      }
      case 'smurf': {
        const h = this.mkHuman({ skin, hair, shirt: 0x1d4ed8, pants: 0x1e3a8a, accent: 0x38bdf8, gear: 'balaclava', maskColor: 0x2563eb, sleeves: 'long', scale: 0.9 });
        poseArms(h, { at: [-0.06, 1.26, 0.27], pole: [1, -0.4, 0.2] }, { at: [0.06, 1.31, 0.3], pole: [-1, -0.4, 0.2] });
        // Крылья за спиной
        const featherMat = shared('feather', () => new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6, side: THREE.DoubleSide }));
        const feather = cachedGeo('feather', () => new THREE.PlaneGeometry(0.22, 0.5));
        for (const sx of [-1, 1]) {
          const wing = new THREE.Group();
          wing.position.set(sx * 0.1, 1.45, -0.16);
          for (let i = 0; i < 3; i++) {
            const f = new THREE.Mesh(feather, featherMat);
            f.position.set(sx * (0.15 + i * 0.13), 0.12 - i * 0.07, -0.02);
            f.rotation.set(0, sx * 0.5, sx * (-0.9 + i * 0.32));
            wing.add(f);
          }
          h.body.add(wing);
          this.parts.push(wing);
        }
        barH = 2.15;
        break;
      }
      case 'rusher': {
        const h = this.mkHuman({ skin, hair, shirt: 0x7f1d1d, pants: 0x27272a, vest: 0x18181b, accent: 0xef4444, gear: 'balaclava', maskColor: 0x111111, sleeves: 'long', gloves: true });
        poseArms(h, HIP_R, HIP_L);
        // ПП в низкой готовности: приклад в плече, ствол вниз-вперёд
        this.equip(h, 'smg', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.4, -0.4, 0.82)), HIP_L);
        h.body.rotation.x = 0.22;
        break;
      }
      case 'armored': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x27272a, pants: 0x1f1f23, vest: 0x3f3f46, bulky: true, kneePads: true, accent: 0xf97316,
          gear: 'helmet', gearColor: 0x18181b, mask: true, maskColor: 0x111111, sleeves: 'long', gloves: true, scale: 1.1,
        });
        // Винтовка у плеча, ствол чуть опущен
        this.equip(h, 'rifle', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.5, -0.18, 0.85)), HIP_L);
        barW = 1.1;
        barH = 2.6;
        break;
      }
      case 'ping': {
        const h = this.mkHuman({ skin: 0x67e8f9, hair: 0x67e8f9, shirt: 0x67e8f9, pants: 0x67e8f9, accent: 0x22d3ee, gear: 'none', hairStyle: 'bald', eyeGlow: 0xff2d2d, sleeves: 'long' });
        poseArms(h, RUN_R, RUN_L);
        const glitch = shared('pingGlitch', () => new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.3, transparent: true, opacity: 0.42, depthWrite: false }));
        reskin(h, glitch, new Set([stdMat(0xff2d2d, { emissive: 0xff2d2d, ei: 2.5 })]));
        this.root.add(sprite(wifiTexture(), 'wifiSprite', 0.8, 0.8, 2.55));
        this.root.add(sprite(textTexture('999', '#ff4d4d'), 'pingTag', 0.9, 0.45, 2.15));
        barH = 2.95;
        break;
      }
      case 'ddos': {
        this.buildDrone(this.body);
        barH = 0.9;
        break;
      }
      case 'ddos_overlord': {
        // Увеличенный в 1.6 раза дрон: красное ядро снизу, пушки, пульсирующее кольцо ауры
        const g = new THREE.Group();
        g.scale.setScalar(1.6);
        this.body.add(g);
        this.buildDrone(g);
        const red = stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 });
        const dark = stdMat(0x111827, { rough: 0.3, metal: 0.6 });
        add(g, sphG(0.12, 12, 8), red, 0, -0.2, 0, 0, 0, 0, false);
        for (const sx of [-1, 1]) {
          add(g, boxG(0.08, 0.08, 0.32), dark, sx * 0.16, -0.14, 0.08);
          add(g, cylG(0.02, 0.02, 0.3, 6), dark, sx * 0.16, -0.14, 0.32, Math.PI / 2, 0, 0, false);
        }
        for (let i = 0; i < 3; i++) add(g, cylG(0.006, 0.006, 0.3, 4), dark, -0.12 + i * 0.12, 0.27, -0.2, -0.3, 0, 0, false);
        this.addRing(0xf43f5e, 5);
        barW = 1.2;
        barH = 1.4;
        break;
      }
      case 'dune_juggernaut': {
        const sandArmor = stdMat(0xc28e4c, { rough: 0.5, metal: 0.4 });
        const h = this.mkHuman({
          skin, hair, shirt: 0xa47640, pants: 0x9a6f3c, vest: 0xc28e4c, bulky: true, kneePads: true, accent: 0xf59e0b, gear: 'helmet', gearColor: 0xb8854a,
          mask: true, maskColor: 0x5c4326, sleeves: 'long', gloves: true, girth: 1.1, scale: 1.85,
        });
        // Янтарный визор, наплечники, нагрудная плита и пулемётная лента
        add(h.head, boxG(0.27, 0.07, 0.05), stdMat(0xf59e0b, { emissive: 0xf59e0b, ei: 1.8, rough: 0.1 }), 0, 0.165, 0.13, 0, 0, 0, false);
        for (const arm of [h.armL, h.armR]) add(arm, boxG(0.25, 0.16, 0.27), sandArmor, 0, -0.03, 0);
        add(h.body, boxG(0.46, 0.24, 0.06), sandArmor, 0, 1.36, 0.2);
        const brass = stdMat(0xd4a017, { rough: 0.3, metal: 0.8 });
        for (let i = 0; i < 9; i++) add(h.body, boxG(0.05, 0.03, 0.07), brass, -0.2 + i * 0.05, 1.12 + i * 0.045, 0.24, 0, 0, 0.75, false);
        // Тяжёлый пулемёт T3 у бедра
        this.equip(h, 'lmg', (w) => hipPlacement(h, w, new THREE.Vector3(-0.2, -0.1, 1)), HIP_L, false, 2, 0xf59e0b);
        this.buildSandRing();
        this.stepAmp = 0.38;
        barW = 2.0;
        barH = 4.25;
        break;
      }
      case 'alley_pyromancer': {
        const h = this.mkHuman({
          skin, hair, shirt: 0xea580c, pants: 0xc2410c, vest: 0x3f3f46, bulky: true, kneePads: true, accent: 0xfacc15, gear: 'gasmask',
          sleeves: 'long', gloves: true, scale: 1.75,
        });
        add(h.head, boxG(0.24, 0.1, 0.04), stdMat(0x1f2937, { rough: 0.1, metal: 0.5, emissive: 0xf97316, ei: 0.25 }), 0, 0.16, 0.135, 0, 0, 0, false);
        // Два баллона за спиной с жёлтой полосой
        const tank = stdMat(0xf97316, { rough: 0.35, metal: 0.5 });
        const band = stdMat(0xfacc15, { emissive: 0xfacc15, ei: 0.3 });
        const steel = stdMat(0x52525b, { rough: 0.3, metal: 0.8 });
        for (const sx of [-1, 1]) {
          add(h.body, cylG(0.16, 0.16, 0.7, 14), tank, sx * 0.17, 1.3, -0.34);
          add(h.body, sphG(0.16, 12, 8), tank, sx * 0.17, 1.65, -0.34);
          add(h.body, cylG(0.163, 0.163, 0.06, 14), band, sx * 0.17, 1.36, -0.34, 0, 0, 0, false);
          add(h.body, cylG(0.03, 0.03, 0.1, 8), steel, sx * 0.17, 1.83, -0.34);
        }
        // Огнемёт: пулемёт с соплом и пламенем
        this.equip(h, 'lmg', (w) => hipPlacement(h, w, new THREE.Vector3(-0.2, -0.12, 1)), HIP_L, false, 0, 0xf97316);
        if (this.weapon) {
          const m = this.weapon.muzzle;
          add(m, cylG(0.05, 0.07, 0.14, 10), steel, 0, 0, 0.04, Math.PI / 2, 0, 0, false);
          const flame = new THREE.Mesh(
            cachedGeo('pyroFlame', () => new THREE.ConeGeometry(0.07, 0.32, 8)),
            shared('pyroFlameMat', () => new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })),
          );
          flame.rotation.x = Math.PI / 2;
          flame.position.z = 0.27;
          m.add(flame);
          this.flames.push(flame);
        }
        const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0.17, 1.0, -0.34), new THREE.Vector3(0.32, 0.85, -0.1), new THREE.Vector3(0.28, 0.95, 0.2)]);
        add(h.body, cachedGeo('pyroHose', () => new THREE.TubeGeometry(hose, 14, 0.025, 5, false)), stdMat(0x18181b, { rough: 0.6 }), 0, 0, 0, 0, 0, 0, false);
        this.stepAmp = 0.42;
        barW = 1.9;
        barH = 4.0;
        break;
      }
      case 'reactor_core': {
        this.buildReactorCore();
        barW = 2.4;
        barH = 3.9;
        break;
      }
      case 'overpass_overlord': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x111827, pants: 0x0b0f19, vest: 0x1f2937, bulky: true, kneePads: true, accent: 0xef4444, gear: 'helmet', gearColor: 0x0f172a,
          mask: true, maskColor: 0x111111, sleeves: 'long', gloves: true, girth: 1.08, scale: 1.9,
        });
        const graphite = stdMat(0x1f2937, { rough: 0.4, metal: 0.6 });
        const red = stdMat(0xef4444, { emissive: 0xef4444, ei: 2.4, rough: 0.1 });
        add(h.head, boxG(0.27, 0.075, 0.05), red, 0, 0.165, 0.13, 0, 0, 0, false);
        for (const arm of [h.armL, h.armR]) {
          add(arm, boxG(0.25, 0.16, 0.27), graphite, 0, -0.03, 0);
          add(arm, boxG(0.255, 0.03, 0.275), red, 0, -0.1, 0, 0, 0, 0, false);
        }
        add(h.body, boxG(0.46, 0.22, 0.06), graphite, 0, 1.36, 0.2);
        // Мини-турели на плечах: поворачиваются к ближайшей башне
        for (const sx of [-1, 1]) {
          const tur = new THREE.Group();
          tur.position.set(sx * 0.34, 1.66, -0.06);
          add(tur, boxG(0.18, 0.14, 0.22), graphite, 0, 0, 0);
          add(tur, cylG(0.03, 0.03, 0.3, 8), stdMat(0x111827, { metal: 0.7, rough: 0.3 }), 0, 0.02, 0.2, Math.PI / 2, 0, 0, false);
          add(tur, sphG(0.025, 6, 4), red, 0, 0.08, 0.06, 0, 0, 0, false);
          const muzzle = new THREE.Object3D();
          muzzle.position.set(0, 0.02, 0.36);
          tur.add(muzzle);
          h.body.add(tur);
          this.turrets.push(tur);
          this.turretMuzzles.push(muzzle);
        }
        this.equip(h, 'carbine', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.35, -0.2, 0.9)), HIP_L, false, 2, 0xef4444);
        this.addEnergyShield(2.3, 0xef4444, 2.1);
        this.stepAmp = 0.4;
        barW = 2.4;
        barH = 4.4;
        break;
      }
      case 'carpet_ninja': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x1e293b, pants: 0x111827, accent: 0xdc2626, gear: 'hood', gearColor: 0x111827, mask: true, maskColor: 0x0b0b0b,
          sleeves: 'long', gloves: true, scale: 1.25,
        });
        // Красная повязка, шарф и накидка из ковра, нож в правой руке
        add(h.head, cylG(0.158, 0.158, 0.035, 18), stdMat(0xdc2626, { emissive: 0x7f1d1d, ei: 0.4 }), 0, 0.2, 0.01, -0.25, 0, 0, false);
        const carpet = shared('ninjaCarpet', () => new THREE.MeshStandardMaterial({ map: getTexture('carpet'), roughness: 0.9, side: THREE.DoubleSide }));
        add(h.body, torusG(0.14, 0.05), carpet, 0, 1.5, 0.01, Math.PI / 2, 0, 0, false);
        const cape = add(h.body, cachedGeo('ninjaCape', () => new THREE.PlaneGeometry(0.55, 1.05)), carpet, 0, 1.0, -0.19, 0.12, 0, 0, false);
        this.cape = cape;
        poseArms(h, { at: [0.3, 1.02, 0.28], pole: [1, -0.5, -0.6] }, { at: [-0.22, 1.25, 0.28], pole: [-1, -1, 0] });
        const knife = buildItem('knife');
        knife.position.set(0.3, 1.02, 0.28);
        knife.rotation.x = 0.5;
        h.body.add(knife);
        h.body.rotation.x = 0.18;
        ghostly(h, 0.78);
        this.stepAmp = 0.75;
        barH = 2.85;
        break;
      }
      case 'market_baron': {
        const h = this.mkHuman({
          skin, hair: 0x2b1d14, hairStyle: 'short', beard: 'stubble', shirt: 0x3f4a2e, pants: 0x4b5320, vest: 0x7f1d1d, bulky: true,
          accent: 0xf59e0b, gear: 'none', sleeves: 'long', gloves: true, girth: 1.15, belly: true, scale: 1.3,
        });
        const gold = stdMat(0xf59e0b, { rough: 0.25, metal: 0.8, emissive: 0xb45309, ei: 0.3 });
        // Золотой рюкзак со скаткой и лямками
        add(h.body, boxG(0.45, 0.55, 0.3), gold, 0, 1.3, -0.36);
        add(h.body, cylG(0.1, 0.1, 0.5, 12), stdMat(0xca8a04, { rough: 0.4, metal: 0.6 }), 0, 1.64, -0.36, 0, 0, Math.PI / 2);
        for (const sx of [-1, 1]) add(h.body, boxG(0.06, 0.42, 0.02), stdMat(0x3f2a14, { rough: 0.8 }), sx * 0.13, 1.33, 0.2, 0, 0, 0, false);
        add(h.body, boxG(0.12, 0.12, 0.02), stdMat(0xfde047, { emissive: 0xfacc15, ei: 1.2 }), 0, 1.32, -0.515, 0, 0, Math.PI / 4, false);
        this.equip(h, 'smg', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.2, -0.15, 1)), HIP_L, false, 2, 0xf59e0b);
        this.addRing(0xfbbf24, 5);
        barW = 1.2;
        barH = 2.95;
        break;
      }
      case 'long_awper': {
        const h = this.mkHuman({
          skin, hair, shirt: 0xb08d57, pants: 0x8b6d3f, vest: 0x6b5a33, accent: 0xf97316, gear: 'hood', gearColor: 0x9c7b4a, mask: true, maskColor: 0x6b5a33,
          sleeves: 'long', gloves: true, kneePads: true, scale: 1.25,
        });
        // Гилли: свисающие лоскуты на плечах и спине
        const ghillie = [stdMat(0x7c6a3c, { rough: 1 }), stdMat(0x5b5a2e, { rough: 1 }), stdMat(0xa08850, { rough: 1 })];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          add(h.body, boxG(0.05, 0.2 + (i % 3) * 0.06, 0.02), ghillie[i % 3], Math.cos(a) * 0.24, 1.38 + (i % 2) * 0.12, Math.sin(a) * 0.17, (i % 4) * 0.12, a, 0.15, false);
        }
        const w = buildWeapon('sniper', 2, 0xf97316);
        h.weaponMount.position.set(0, 0, 0);
        h.weaponMount.quaternion.identity();
        h.weaponMount.add(w.group);
        this.weapon = w;
        this.holdLow = this.holdFor(h, w, shoulderPlacement(h, w, new THREE.Vector3(-0.35, -0.42, 0.84)), HIP_L);
        this.holdAim = this.holdFor(h, w, shoulderPlacement(h, w, new THREE.Vector3(0, -0.02, 1)), HIP_L);
        this.applyHold(0);
        this.kneelA = kneelAngle(1.25);
        this.buildLaser();
        barH = 2.85;
        break;
      }
      case 'short_breacher': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x1f2937, pants: 0x111827, vest: 0x27303d, bulky: true, kneePads: true, accent: 0xb45309, gear: 'helmet', gearColor: 0x1b2330,
          mask: true, maskColor: 0x0b0b0b, sleeves: 'long', gloves: true, scale: 1.35,
        });
        // Дробовик в правой руке, баллистический щит без неона — в левой
        this.equip(h, 'shotgun', (w) => gripPlacement(w, new THREE.Vector3(0.42, 1.2, 0.3), [0, 0, 1]), { at: [-0.15, 1.2, 0.36], pole: [-1, -1, 0] }, true);
        this.buildRiotShield(null, 1.3);
        this.addRing(0xb45309, 4.5);
        this.stepAmp = 0.45;
        barW = 1.2;
        barH = 3.05;
        break;
      }
      case 'flash_maestro': {
        const h = this.mkHuman({
          skin, hair: 0x4a3222, hairStyle: 'short', shirt: 0x27272a, pants: 0x3f3f46, vest: 0x3f4a2e, accent: 0xfef08a, gear: 'none', sleeves: 'short',
          gloves: true, mouthOpen: true, scale: 1.25,
        });
        // Руки широко разведены — жонглирует флешками
        poseArms(h, { at: [0.5, 1.5, 0.2], pole: [1, -1, 0] }, { at: [-0.5, 1.5, 0.2], pole: [-1, -1, 0] });
        const canMat = stdMat(0xd6d3d1, { metal: 0.4, rough: 0.4 });
        const glow = stdMat(0xffffff, { emissive: 0xfef9c3, ei: 2.2 });
        const can = cachedGeo('flashCan', () => new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10));
        for (const [x, y] of [[-0.14, 1.4], [0, 1.4], [0.14, 1.4], [-0.07, 1.18], [0.07, 1.18]] as [number, number][]) {
          add(h.body, can, canMat, x, y, 0.2, 0, 0, 0, false);
          add(h.body, cylG(0.072, 0.072, 0.03, 10), glow, x, y + 0.04, 0.2, 0, 0, 0, false);
        }
        const orbit = new THREE.Group();
        orbit.position.y = 2.0;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const fb = new THREE.Group();
          fb.position.set(Math.cos(a) * 0.75, Math.sin(a * 2) * 0.18, Math.sin(a) * 0.75);
          fb.rotation.set(a, 0, a * 0.5);
          add(fb, can, canMat, 0, 0, 0, 0, 0, 0, false);
          add(fb, cylG(0.072, 0.072, 0.04, 10), glow, 0, 0.05, 0, 0, 0, 0, false);
          orbit.add(fb);
        }
        this.root.add(orbit);
        this.orbit = orbit;
        barH = 2.9;
        break;
      }
      case 'fountain_tank': {
        const steel = stdMat(0x475569, { rough: 0.35, metal: 0.7 });
        const h = this.mkHuman({
          skin, hair, shirt: 0x334155, pants: 0x1e293b, vest: 0x475569, bulky: true, kneePads: true, accent: 0x94a3b8, gear: 'helmet', gearColor: 0x334155,
          mask: true, maskColor: 0x1e293b, sleeves: 'long', gloves: true, girth: 1.2, scale: 1.45,
        });
        // Забрало со смотровой щелью, массивные наплечники, нагрудная плита
        add(h.head, boxG(0.3, 0.22, 0.06), steel, 0, 0.12, 0.14);
        add(h.head, boxG(0.22, 0.025, 0.02), stdMat(0xef4444, { emissive: 0xef4444, ei: 1.5 }), 0, 0.17, 0.175, 0, 0, 0, false);
        for (const arm of [h.armL, h.armR]) add(arm, boxG(0.28, 0.18, 0.3), steel, 0, -0.03, 0);
        add(h.body, boxG(0.5, 0.3, 0.06), steel, 0, 1.33, 0.21);
        this.equip(h, 'lmg', (w) => hipPlacement(h, w, new THREE.Vector3(-0.2, -0.1, 1)), HIP_L, false, 1, 0x94a3b8);
        this.stepAmp = 0.35;
        barW = 1.4;
        barH = 3.35;
        break;
      }
      case 'yard_sapper': {
        const h = this.mkHuman({
          skin, hair: 0x4a3222, hairStyle: 'short', beard: 'stubble', shirt: 0x556b2f, pants: 0x4d5a2e, accent: 0xef4444, gear: 'bandana', gearColor: 0xb91c1c,
          sleeves: 'none', mouthOpen: true, scale: 1.25,
        });
        const red = stdMat(0xb91c1c, { rough: 0.6 });
        // Связка динамита с таймером на груди, C4 с мигающим диодом на спине, детонатор в руке
        for (let i = 0; i < 6; i++) add(h.body, cylG(0.035, 0.035, 0.26, 8), red, -0.13 + i * 0.052, 1.25, 0.16);
        add(h.body, boxG(0.34, 0.04, 0.09), stdMat(0x18181b), 0, 1.25, 0.16, 0, 0, 0, false);
        add(h.body, boxG(0.15, 0.08, 0.03), stdMat(0x18181b), 0, 1.34, 0.21, 0, 0, 0, false);
        add(h.body, boxG(0.11, 0.045, 0.01), stdMat(0x22c55e, { emissive: 0x22c55e, ei: 2 }), 0, 1.34, 0.227, 0, 0, 0, false);
        add(h.body, boxG(0.3, 0.2, 0.1), stdMat(0x78716c, { rough: 0.7 }), 0, 1.3, -0.19);
        this.blink.push(add(h.body, sphG(0.03, 8, 6), stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 }), 0.08, 1.37, -0.245, 0, 0, 0, false));
        poseArms(h, { at: [0.3, 1.25, 0.32], pole: [1, -1, -0.2] }, RUN_L);
        const det = buildItem('radio');
        det.position.set(0.3, 1.25, 0.32);
        h.body.add(det);
        this.stepAmp = 0.75;
        barH = 2.85;
        break;
      }
      case 'vent_phantom': {
        const h = this.mkHuman({
          skin: 0x0b1220, hair: 0x0b1220, hairStyle: 'bald', shirt: 0x0b1220, pants: 0x0b1220, accent: 0x06b6d4, gear: 'helmet', gearColor: 0x0b1220,
          sleeves: 'long', gloves: true, scale: 1.2,
        });
        // Светящиеся циановые линии костюма и визор
        const cyan = stdMat(0x22d3ee, { emissive: 0x06b6d4, ei: 2.4 });
        add(h.head, boxG(0.27, 0.06, 0.05), cyan, 0, 0.165, 0.13, 0, 0, 0, false);
        for (const [arm, sx] of [[h.armL, -1], [h.armR, 1]] as [THREE.Group, number][]) add(arm, boxG(0.02, 0.32, 0.02), cyan, sx * 0.062, -0.17, 0.05, 0, 0, 0, false);
        for (const [leg, sx] of [[h.legL, -1], [h.legR, 1]] as [THREE.Group, number][]) add(leg, boxG(0.02, 0.8, 0.02), cyan, sx * 0.085, -0.45, 0.09, 0, 0, 0, false);
        for (const sx of [-1, 1]) add(h.body, boxG(0.02, 0.36, 0.02), cyan, sx * 0.08, 1.3, 0.13, 0, 0, -sx * 0.45, false);
        poseArms(h, RUN_R, RUN_L);
        h.body.rotation.x = 0.25;
        ghostly(h, 0.72);
        this.stepAmp = 0.9;
        barH = 2.7;
        break;
      }
      case 'container_mech': {
        this.buildContainerMech();
        barW = 1.4;
        barH = 2.75;
        break;
      }
      case 'canal_amphibian': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x0f172a, stripe: 0x0ea5e9, pants: 0x0f172a, accent: 0x0ea5e9, gear: 'balaclava', maskColor: 0x0f172a, sleeves: 'long',
          gloves: true, boots: 0x111827, scale: 1.3,
        });
        // Светящаяся маска, регулятор и шланг, баллон, ласты
        add(h.head, boxG(0.28, 0.14, 0.04), stdMat(0x111827, { rough: 0.4 }), 0, 0.16, 0.13, 0, 0, 0, false);
        add(h.head, boxG(0.24, 0.1, 0.02), stdMat(0x67e8f9, { emissive: 0x22d3ee, ei: 1.4, rough: 0.05, metal: 0.3 }), 0, 0.16, 0.152, 0, 0, 0, false);
        add(h.head, cylG(0.03, 0.03, 0.06, 8), stdMat(0x18181b), 0, 0.06, 0.15, Math.PI / 2, 0, 0, false);
        add(h.body, cylG(0.11, 0.11, 0.62, 12), stdMat(0x334155, { rough: 0.35, metal: 0.6 }), 0, 1.25, -0.24);
        add(h.body, cylG(0.04, 0.04, 0.08, 8), stdMat(0x18181b), 0, 1.6, -0.24);
        const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.64, -0.24), new THREE.Vector3(0.18, 1.72, -0.05), new THREE.Vector3(0.04, 1.73, 0.17)]);
        add(h.body, cachedGeo('diveHose', () => new THREE.TubeGeometry(hose, 12, 0.02, 5, false)), stdMat(0x18181b, { rough: 0.6 }), 0, 0, 0, 0, 0, 0, false);
        for (const leg of [h.legL, h.legR]) add(leg, boxG(0.2, 0.03, 0.44), stdMat(0x111827, { rough: 0.5 }), 0, -0.9, 0.2);
        this.equip(h, 'rifle', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.45, -0.2, 0.86)), HIP_L, false, 1, 0x0ea5e9);
        barH = 2.95;
        break;
      }
      case 'bridge_rammer': {
        const steel = stdMat(0x52525b, { rough: 0.4, metal: 0.7 });
        const h = this.mkHuman({
          skin, hair, shirt: 0x27272a, pants: 0x1f1f23, vest: 0x3f3f46, bulky: true, kneePads: true, accent: 0xfacc15, gear: 'helmet', gearColor: 0x27272a,
          mask: true, maskColor: 0x111111, sleeves: 'long', gloves: true, girth: 1.15, scale: 1.45,
        });
        add(h.head, boxG(0.3, 0.2, 0.06), steel, 0, 0.12, 0.14);
        add(h.head, boxG(0.22, 0.03, 0.02), stdMat(0x0f172a), 0, 0.17, 0.175, 0, 0, 0, false);
        // Шипастые наплечники
        const spike = cachedGeo('rammerSpike', () => new THREE.ConeGeometry(0.035, 0.12, 6));
        for (const arm of [h.armL, h.armR]) {
          add(arm, boxG(0.27, 0.17, 0.29), steel, 0, -0.03, 0);
          for (let i = 0; i < 3; i++) add(arm, spike, stdMat(0xa1a1aa, { metal: 0.8, rough: 0.3 }), 0, 0.1, -0.09 + i * 0.09, 0, 0, 0, false);
        }
        // Таранный щит-клин спереди с hazard-полосой
        const hazard = shared('hazardMat', () => new THREE.MeshStandardMaterial({ map: getTexture('hazard'), roughness: 0.6 }));
        const wedge = new THREE.Group();
        wedge.position.set(0, 0, 0.7);
        this.body.add(wedge);
        for (const sx of [-1, 1]) {
          const plate = new THREE.Group();
          plate.position.set(sx * 0.3, 0, -0.18);
          plate.rotation.y = sx * 0.55;
          add(plate, boxG(0.8, 1.75, 0.12), steel, 0, 0.98, 0);
          add(plate, boxG(0.81, 0.18, 0.02), hazard, 0, 1.45, 0.07, 0, 0, 0, false);
          add(plate, boxG(0.81, 0.18, 0.02), hazard, 0, 0.45, 0.07, 0, 0, 0, false);
          wedge.add(plate);
        }
        poseArms(h, { at: [0.25, 1.3, 0.38], pole: [1, -1, 0] }, { at: [-0.25, 1.3, 0.38], pole: [-1, -1, 0] });
        h.body.rotation.x = 0.12;
        this.stepAmp = 0.4;
        barW = 1.5;
        barH = 3.4;
        break;
      }
      case 'hill_jammer': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x3f4a2e, pants: 0x3f4a2e, vest: 0x2f3a24, harness: true, kneePads: true, accent: 0xa855f7, gear: 'balaclava', maskColor: 0x27272a,
          sleeves: 'long', gloves: true, scale: 1.25,
        });
        // Рюкзак с мачтой, тарелкой и вращающимся кольцом помех
        const purple = stdMat(0xa855f7, { emissive: 0xa855f7, ei: 1.6, rough: 0.3 });
        add(h.body, boxG(0.42, 0.55, 0.26), stdMat(0x3f4a2e, { rough: 0.8 }), 0, 1.25, -0.3);
        add(h.body, cylG(0.02, 0.02, 0.8, 6), stdMat(0x52525b, { metal: 0.7, rough: 0.3 }), 0.12, 1.85, -0.32);
        add(h.body, cachedGeo('jamDish', () => new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3)), stdMat(0x7e22ce, { metal: 0.5, rough: 0.3, emissive: 0x581c87, ei: 0.5 }), 0.12, 2.12, -0.32, Math.PI * 0.8, 0, 0);
        const ring = add(h.body, torusG(0.3, 0.025), purple, 0.12, 2.3, -0.32, Math.PI / 2, 0, 0, false);
        this.parts.push(ring);
        poseArms(h, HIP_R, HIP_L);
        this.addRing(0xa855f7, 6);
        barH = 3.05;
        break;
      }
      case 'smoker': {
        const h = this.mkHuman({
          skin, hair, shirt: 0xb91c1c, pants: 0x1f1f23, accent: 0xef4444, gear: 'balaclava', maskColor: 0x111111,
          eyeGlow: 0xff3b3b, sleeves: 'long', gloves: true, prop: 'smoke',
        });
        poseArms(h, { at: [0.3, 1.05, 0.25], pole: [1, 0, -1] }, RUN_L);
        const can = buildItem('smoke', 0xdc2626);
        can.position.set(0.3, 1.05, 0.25);
        h.body.add(can);
        break;
      }
      case 'screamer': {
        const h = this.mkHuman({ skin, hair: 0x5c3b24, shirt: 0xdc2626, pants: 0x1f2937, accent: 0xef4444, gear: 'none', sleeves: 'short', mouthOpen: true });
        poseArms(h, { at: [0.2, 1.8, 0.04], pole: [1, -0.3, 0.4] }, { at: [-0.2, 1.8, 0.04], pole: [-1, -0.3, 0.4] });
        this.addRing(0xef4444, 3.2);
        break;
      }
      case 'spinbot': {
        this.buildMech();
        barW = 2.6;
        barH = 4.7;
        break;
      }
      case 'lagger': {
        const h = this.mkHuman({ skin: 0x9ca3af, hair: 0x6b7280, shirt: 0x9ca3af, pants: 0x6b7280, accent: 0xff2d2d, gear: 'none', hairStyle: 'bald', sleeves: 'long' });
        poseArms(h, { at: [0.3, 0.98, 0.06], pole: [1, 0, -1] }, { at: [-0.3, 1.62, 0.18], pole: [-1, -1, 0] });
        const pix = shared('pixelMat', () => new THREE.MeshStandardMaterial({ map: pixelTexture(), color: 0xe5e7eb, roughness: 0.9, flatShading: true }));
        reskin(h, pix, new Set());
        // Блочная «пиксельная» голова с красными глазами
        add(h.head, boxG(0.33, 0.35, 0.33), pix, 0, 0.14, 0);
        for (const sx of [-1, 1]) add(h.head, boxG(0.06, 0.04, 0.02), stdMat(0xff2d2d, { emissive: 0xff2d2d, ei: 3 }), sx * 0.07, 0.17, 0.17, 0, 0, 0, false);
        // Красный провод-«хвост» от головы
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.95, -0.12), new THREE.Vector3(0.12, 1.6, -0.35), new THREE.Vector3(0.3, 0.9, -0.25), new THREE.Vector3(0.28, 0.55, -0.05)]);
        add(h.body, cachedGeo('laggerCable', () => new THREE.TubeGeometry(curve, 20, 0.022, 5, false)), stdMat(0xb91c1c, { rough: 0.5 }), 0, 0, 0, 0, 0, 0, false);
        this.root.add(sprite(alertTexture(), 'alertSprite', 0.55, 0.55, 2.6));
        barH = 2.35;
        break;
      }
      case 'cheater': {
        const h = this.mkHuman({
          skin: 0x8b9a90, hair: 0x111111, shirt: 0x1c2620, pants: 0x111827, accent: 0x4ade80, gear: 'hood', gearColor: 0x1f2a24,
          mask: true, maskColor: 0x0b1a10, eyeGlow: 0x4ade80, sleeves: 'long',
        });
        poseArms(h, { at: [0.13, 1.22, 0.3], pole: [1, -1, -0.3] }, { at: [-0.13, 1.22, 0.3], pole: [-1, -1, -0.3] });
        const laptop = buildItem('laptop');
        laptop.position.set(0, 1.2, 0.33);
        laptop.rotation.x = -0.25;
        h.body.add(laptop);
        // Вращающиеся панели «кода»
        const orbit = new THREE.Group();
        const codeMat = shared('codeMat', () => new THREE.MeshBasicMaterial({ map: matrixTexture(), color: 0x4ade80, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        const panel = cachedGeo('codePanel', () => new THREE.PlaneGeometry(0.2, 0.3));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const p = new THREE.Mesh(panel, codeMat);
          p.position.set(Math.cos(a) * 0.62, 0.9 + (i % 2) * 0.55, Math.sin(a) * 0.62);
          p.rotation.y = -a + Math.PI / 2;
          orbit.add(p);
        }
        this.root.add(orbit);
        this.parts.push(orbit);
        barH = 2.4;
        break;
      }
      case 'flasher': {
        const h = this.mkHuman({ skin, hair: 0x4a3222, shirt: 0x3f4a2e, pants: 0x27272a, vest: 0x2f3a24, accent: 0xfacc15, gear: 'none', sleeves: 'long', mouthOpen: true });
        poseArms(h, { at: [0.24, 1.2, 0.3], pole: [1, -1, -0.2] }, { at: [-0.24, 1.2, 0.3], pole: [-1, -1, -0.2] });
        const canMat = stdMat(0xd6c9a0, { metal: 0.3, rough: 0.5 });
        const band = stdMat(0xffffff, { emissive: 0xffffff, ei: 1.6 });
        const can = cachedGeo('flashCan', () => new THREE.CylinderGeometry(0.07, 0.07, 0.2, 10));
        const big = cachedGeo('flashCanBig', () => new THREE.CylinderGeometry(0.085, 0.085, 0.26, 10));
        const front: [number, number][] = [[-0.12, 1.42], [0.0, 1.42], [0.12, 1.42], [-0.07, 1.2], [0.07, 1.2]];
        for (const [x, y] of front) {
          add(h.body, can, canMat, x, y, 0.24, 0, 0, 0, false);
          add(h.body, cylG(0.072, 0.072, 0.03, 10), band, x, y + 0.04, 0.24, 0, 0, 0, false);
        }
        for (let i = 0; i < 6; i++) {
          const x = -0.18 + (i % 3) * 0.18;
          const y = 1.25 + Math.floor(i / 3) * 0.27;
          add(h.body, big, canMat, x, y, -0.27, 0, 0, (i - 2.5) * 0.08);
          add(h.body, cylG(0.087, 0.087, 0.035, 10), band, x, y + 0.05, -0.27, 0, 0, 0, false);
        }
        break;
      }
      case 'toxic': {
        const h = this.mkHuman({ skin: 0x8fbf4a, hair: 0x2f4a12, shirt: 0x65a30d, pants: 0x1f2937, accent: 0x84cc16, gear: 'hood', gearColor: 0x4d7c0f, sleeves: 'long', mouthOpen: true });
        poseArms(h, { at: [0.08, 1.68, 0.22], pole: [1, -1, 0] }, { at: [-0.05, 1.35, 0.22], pole: [-1, -1, 0] });
        const mic = buildItem('mic');
        mic.position.set(0.08, 1.68, 0.22);
        mic.rotation.set(0.3, 0, -0.2);
        h.body.add(mic);
        this.addRing(0x84cc16, 4.5);
        break;
      }
      case 'afk': {
        const h = this.mkHuman({
          skin: 0x9fb3c4, hair: 0x6b7280, shirt: 0xffffff, pants: 0xffffff, shirtMap: pajamaTexture(), pantsMap: pajamaTexture(),
          boots: 0x64748b, accent: 0x94a3b8, gear: 'none', hairStyle: 'bald', sleeves: 'long',
        });
        poseArms(h, { at: [0.28, 0.98, 0.22], pole: [1, 0, -1] }, { at: [-0.28, 0.96, 0.18], pole: [-1, 0, -1] });
        h.head.rotation.set(0.15, 0, 0.35);
        h.body.rotation.x = 0.15;
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, 2.0, -0.05), new THREE.Vector3(0.1, 2.35, -0.25), new THREE.Vector3(0.35, 2.2, -0.55)]);
        add(h.body, cachedGeo('afkCable', () => new THREE.TubeGeometry(curve, 16, 0.02, 5, false)), stdMat(0x111111, { rough: 0.5 }), 0, 0, 0, 0, 0, 0, false);
        add(h.head, cylG(0.03, 0.03, 0.03, 8), stdMat(0xb91c1c, { emissive: 0xb91c1c, ei: 1 }), 0, 0.28, -0.02, 0, 0, 0, false);
        this.root.add(sprite(textTexture('AFK', '#e5e7eb'), 'afkTag', 0.9, 0.45, 2.7));
        this.stepAmp = 0.3;
        barH = 2.35;
        break;
      }
      case 'noob': {
        const h = this.mkHuman({ skin, hair: 0x5c3b24, beard: 'full', shirt: 0x7c5a3a, pants: 0x2b4a7a, vest: 0x4d5a2e, accent: 0xf97316, gear: 'none', sleeves: 'long' });
        poseArms(h, HIP_R, HIP_L);
        // Винтовка у бедра: приклад зажат локтем
        this.equip(h, 'rifle', (w) => hipPlacement(h, w, new THREE.Vector3(-0.3, -0.05, 1)), HIP_L);
        this.weaponFan(h, [['sniper', -0.8, 0xf97316], ['shotgun', -0.28, 0xf97316], ['smg', 0.28, 0xf97316], ['rifle', 0.8, 0xf97316]], 0);
        barH = 2.45;
        break;
      }
      case 'camper': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x1f2937, pants: 0x111827, vest: 0x2a3441, bulky: true, kneePads: true, accent: 0x38bdf8,
          gear: 'helmet', gearColor: 0x1b2330, mask: true, maskColor: 0x0b0b0b, sleeves: 'long', gloves: true, scale: CAMPER_SCALE,
        });
        // Пистолет у правого края щита, левая рука держит щит за рукоять
        this.equip(h, 'pistol', (w) => gripPlacement(w, new THREE.Vector3(0.44, 1.36, 0.3), [0, 0, 1]), { at: [-0.15, 1.2, 0.36], pole: [-1, -1, 0] }, true);
        this.buildRiotShield(0x38bdf8, 1);
        this.kneelA = kneelAngle(CAMPER_SCALE);
        barW = 1.1;
        barH = 2.45;
        break;
      }
      case 'booster': {
        const h = this.mkHuman({
          skin: pick([0x6b4430, 0x8d5a3b, 0xc68e62]), hair: 0x111111, hairStyle: 'bald', shirt: 0x1e3a8a, pants: 0x1f2937, vest: 0x6b7280,
          bulky: true, kneePads: true, accent: 0xfbbf24, gear: 'none', sleeves: 'long', gloves: true, girth: 1.12, scale: 1.2,
        });
        poseArms(h, { at: [0.44, 0.98, 0.14], pole: [1, 0, -1] }, { at: [-0.44, 0.98, 0.14], pole: [-1, 0, -1] });
        const steel = stdMat(0x71717a, { rough: 0.35, metal: 0.7 });
        const gold = stdMat(0xfbbf24, { rough: 0.3, metal: 0.8, emissive: 0xb45309, ei: 0.3 });
        // Броня: наплечники, нагрудная плита с золотой полосой, пряжка
        for (const arm of [h.armL, h.armR]) add(arm, boxG(0.24, 0.15, 0.26), steel, 0, -0.03, 0);
        add(h.body, boxG(0.44, 0.22, 0.05), steel, 0, 1.36, 0.2);
        add(h.body, boxG(0.44, 0.035, 0.012), gold, 0, 1.3, 0.228, 0, 0, 0, false);
        add(h.body, boxG(0.1, 0.07, 0.02), gold, 0, 1.04, 0.14, 0, 0, 0, false);
        // Мини-тиммейт на спине: обхватил ногами, винтовка над левым плечом
        const r = buildHumanoid(allyOpts(pick(SKIN_TONES), pick(HAIR_TONES), 0.62));
        r.root.position.set(-0.24, RIDER_Y, -0.4);
        r.legL.rotation.set(-1.15, 0, -0.55);
        r.legR.rotation.set(-1.15, 0, 0.55);
        r.body.rotation.x = 0.12;
        r.head.rotation.set(0.05, 0.4, 0);
        this.equip(r, 'rifle', (w) => shoulderPlacement(r, w, new THREE.Vector3(-0.1, -0.12, 1)), HIP_L);
        this.body.add(r.root);
        this.rider = r;
        this.stepAmp = 0.42;
        barW = 1.2;
        barH = 2.85;
        break;
      }
      case 'boosted_ally': {
        const h = this.mkHuman(allyOpts(skin, hair, 0.72));
        poseArms(h, HIP_R, HIP_L);
        this.equip(h, 'smg', (w) => shoulderPlacement(h, w, new THREE.Vector3(-0.3, -0.3, 0.9)), HIP_L);
        h.body.rotation.x = 0.32;
        this.stepAmp = 0.8;
        barW = 0.75;
        barH = 1.8;
        break;
      }
      case 'ragequitter': {
        const h = this.mkHuman({
          skin: 0xe39a7c, hair: 0x3b2a1e, hairStyle: 'spiky', shirt: 0x18181b, stripe: 0xdc2626, pants: 0x27272a, accent: 0xef4444,
          gear: 'none', sleeves: 'short', mouthOpen: true, eyeGlow: 0xff3b3b,
        });
        // Правый кулак сжат, в левой поднятой руке — клавиатура, которой он сейчас грохнет
        poseArms(h, { at: [0.26, 1.24, 0.32], pole: [1, -1, -0.3] }, { at: [-0.34, 1.84, 0.14], pole: [-1, -0.2, -0.6] });
        // Клавиатура в поднятой руке: клавишами вперёд, длинной стороной вверх-наружу
        const kb = new THREE.Group();
        kb.position.set(-0.34, 1.84, 0.14);
        kb.rotation.set(0, 0.3, 2.2);
        const board = new THREE.Group();
        board.position.x = 0.19;
        board.rotation.x = Math.PI / 2;
        add(board, boxG(0.45, 0.06, 0.18), stdMat(0x1f2937, { rough: 0.5 }), 0, 0, 0);
        const keysMat = shared('kbKeysMat', () => new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6, emissive: 0xffffff, emissiveMap: keyboardTexture(), emissiveIntensity: 0.2 }));
        add(board, cachedGeo('kbKeys', () => new THREE.PlaneGeometry(0.43, 0.16)), keysMat, 0, 0.031, 0, -Math.PI / 2, 0, 0, false);
        kb.add(board);
        h.body.add(kb);
        this.parts.push(kb);
        // Красные «пиксели» глитча и полупрозрачный контур
        const shardMat = shared('rageShard', () => new THREE.MeshBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        const shards = new THREE.Group();
        for (let i = 0; i < 12; i++) shards.add(new THREE.Mesh(boxG(0.07, 0.07, 0.07), shardMat));
        this.root.add(shards);
        this.shards = shards;
        this.scatterShards();
        const wire = new THREE.Mesh(
          cachedGeo('rageWire', () => new THREE.IcosahedronGeometry(0.5, 1)),
          shared('rageWireMat', () => new THREE.MeshBasicMaterial({ color: 0xff3b3b, wireframe: true, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending })),
        );
        wire.scale.set(0.85, 2.0, 0.68);
        wire.position.y = 1.08;
        this.body.add(wire);
        this.rageWire = wire;
        this.root.add(sprite(unplugTexture(), 'unplugSprite', 0.62, 0.62, 2.78));
        this.stepAmp = 0.75;
        barH = 2.45;
        break;
      }
      case 'streamer': {
        const h = this.mkHuman({ skin, hair: 0x6b4423, hairStyle: 'short', shirt: 0x9333ea, pants: 0x3b5b8a, accent: 0xc084fc, gear: 'headset', sleeves: 'long' });
        // Едет в игровом кресле: таз на сиденье, ноги вытянуты вперёд, руки на подлокотниках
        this.gait = 'none';
        this.baseY = STREAMER_SEAT - 0.92;
        h.root.position.y = this.baseY;
        h.legL.rotation.set(-1.15, 0, -0.06);
        h.legR.rotation.set(-1.15, 0, 0.06);
        poseArms(h, { at: [0.31, 1.1, 0.12], pole: [1, -0.2, -1] }, { at: [-0.31, 1.1, 0.12], pole: [-1, -0.2, -1] });
        this.buildGamingChair();
        this.buildDroneOrbit();
        barH = 2.4;
        break;
      }
      case 'collector': {
        const h = this.mkHuman({
          skin, hair: 0xfacc15, hairStyle: 'spiky', shirt: 0xffffff, shirtMap: blingTexture(), stripe: 0xf59e0b, pants: 0xb8a6e8, pantsMap: blingTexture(),
          accent: 0xf59e0b, gear: 'none', shades: true, sleeves: 'long',
        });
        const gold = stdMat(0xf59e0b, { rough: 0.25, metal: 0.8, emissive: 0xb45309, ei: 0.35 });
        // Розовые очки, золотая цепь с кулоном
        add(h.head, boxG(0.26, 0.055, 0.012), stdMat(0xf472b6, { rough: 0.1, metal: 0.4, emissive: 0xec4899, ei: 0.9 }), 0, 0.157, 0.148, 0, 0, 0, false);
        add(h.body, torusG(0.13, 0.016), gold, 0, 1.47, 0.05, 1.15, 0, 0, false);
        add(h.body, boxG(0.07, 0.07, 0.02), gold, 0, 1.36, 0.135, 0, 0, Math.PI / 4, false);
        // Золотой пистолет в правой руке, кейс — в левой, веер скинов за спиной
        this.equip(h, 'deagle', (w) => gripPlacement(w, new THREE.Vector3(0.3, 1.32, 0.38), [0, 0.15, 1]), { at: [-0.36, 0.98, 0.06], pole: [-1, 0, -1] }, true, 2, 0xf59e0b);
        const caseG = this.goldCase(0.42);
        caseG.position.set(-0.36, 0.98, 0.06);
        h.body.add(caseG);
        this.weaponFan(h, [['rifle', -0.8, 0xf59e0b], ['sniper', -0.28, 0xa855f7], ['smg', 0.28, 0x22c55e], ['rifle', 0.8, 0xec4899]], 2);
        barH = 2.5;
        break;
      }
      case 'loot_crate': {
        this.gait = 'none';
        this.buildLootCrate();
        barW = 0.9;
        barH = 1.45;
        break;
      }
      case 'troll': {
        const h = this.mkHuman({ skin, hair, shirt: 0x1c1c1f, pants: 0x34507a, accent: 0xeab308, gear: 'balaclava', maskColor: 0x0c0c0c, sleeves: 'long', scale: 0.96 });
        // Правая рука занесена с горящим молотовым, левая вытянута вперёд для баланса
        const sR = new THREE.Vector3(h.shoulderX, SHOULDER_Y, 0);
        this.throwPose = {
          idle: solveArm(sR, new THREE.Vector3(0.3, 1.74, -0.12), new THREE.Vector3(1, -0.4, -0.4)),
          wind: solveArm(sR, new THREE.Vector3(0.3, 1.78, -0.34), new THREE.Vector3(1, -0.6, -0.2)),
          release: solveArm(sR, new THREE.Vector3(0.22, 1.92, 0.38), new THREE.Vector3(1, -0.6, 0.3)),
        };
        poseArms(h, { at: [0.3, 1.74, -0.12], pole: [1, -0.4, -0.4] }, { at: [-0.3, 1.28, 0.32], pole: [-1, -1, 0] });
        const bottle = buildThrowable('molotov');
        bottle.position.set(0, -FOREARM - 0.04, 0.02);
        bottle.rotation.x = Math.PI;
        h.foreR.add(bottle);
        this.bottle = bottle;
        // Капюшон за шеей, карман-кенгуру, кислотно-жёлтые шнурки и полосы на рукавах
        const acid = stdMat(0xeab308, { emissive: 0xeab308, ei: 0.35 });
        add(h.body, boxG(0.34, 0.14, 0.14), stdMat(0x141416, { rough: 0.9 }), 0, 1.55, -0.13);
        add(h.body, boxG(0.26, 0.12, 0.02), stdMat(0x27272a, { rough: 0.9 }), 0, 1.14, 0.125);
        for (const sx of [-1, 1]) add(h.body, cylG(0.008, 0.008, 0.18, 5), acid, sx * 0.05, 1.45, 0.128, 0, 0, 0, false);
        for (const arm of [h.armL, h.armR]) add(arm, boxG(0.126, 0.04, 0.136), acid, 0, -0.2, 0, 0, 0, 0, false);
        this.stepAmp = 0.8;
        barH = 2.35;
        break;
      }
      case 'botfarm': {
        this.buildServerRack();
        barW = 1.3;
        barH = 3.0;
        break;
      }
      case 'mini_bot': {
        this.gait = 'none';
        const b = this.buildMiniBot(this.body, 0.7);
        this.rigLegs = b.legs;
        this.rigArms = b.arms;
        barW = 0.6;
        barH = 1.2;
        break;
      }
      case 'onetap': {
        const h = this.mkHuman({
          skin, hair, shirt: 0x111827, pants: 0x0b1220, vest: 0x1f2937, harness: true, kneePads: true, accent: 0xef4444, gear: 'helmet', gearColor: 0x111318,
          mask: true, maskColor: 0x0a0a0a, sleeves: 'long', gloves: true,
        });
        // Светящийся визор шлема
        add(h.head, boxG(0.27, 0.075, 0.05), stdMat(0x22d3ee, { emissive: 0x22d3ee, ei: 2.2, rough: 0.1 }), 0, 0.165, 0.13, 0, 0, 0, false);
        // Снайперская винтовка T3: на ходу стволом вниз, при прицеливании — в плечо
        const w = buildWeapon('sniper', 2, 0xef4444);
        h.weaponMount.position.set(0, 0, 0);
        h.weaponMount.quaternion.identity();
        h.weaponMount.add(w.group);
        this.weapon = w;
        this.holdLow = this.holdFor(h, w, shoulderPlacement(h, w, new THREE.Vector3(-0.35, -0.42, 0.84)), HIP_L);
        this.holdAim = this.holdFor(h, w, shoulderPlacement(h, w, new THREE.Vector3(0, -0.02, 1)), HIP_L);
        this.applyHold(0);
        this.kneelA = kneelAngle(1);
        this.buildLaser();
        barH = 2.4;
        break;
      }
      default:
        assertNever(kind);
    }
    this.height = barH;
    this.hp = new HpBar(barW, barH, SHIELDED.has(kind));
    this.root.add(this.hp.group);
  }

  private mkHuman(o: HumanoidOpts): Humanoid {
    const h = buildHumanoid(o);
    this.human = h;
    this.body.add(h.root);
    return h;
  }

  /**
   * Вручает оружие: place задаёт его положение в координатах тела, правая кисть ложится на рукоять,
   * левая — на цевьё/шахту магазина (если не дотягивается или oneHand — в позу leftFallback).
   */
  private equip(
    h: Humanoid,
    kind: WeaponKind,
    place: (w: WeaponModel) => WeaponPlacement,
    leftFallback: HandSpec,
    oneHand = false,
    tier = 0,
    accent = 0xef4444,
  ): void {
    const w = buildWeapon(kind, tier, accent);
    if (h === this.human) this.weapon = w;
    h.weaponMount.position.set(0, 0, 0);
    h.weaponMount.quaternion.identity();
    h.weaponMount.add(w.group);
    const pl = place(w);
    w.group.position.copy(pl.pos);
    w.group.quaternion.copy(pl.quat);
    const held = armsOnWeapon(h, w, pl);
    setArm(h, 'r', held.armR);
    const sL = new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0);
    const fb = leftFallback;
    setArm(h, 'l', held.armL && !oneHand ? held.armL : solveArm(sL, new THREE.Vector3(...fb.at), new THREE.Vector3(...fb.pole)));
  }

  /** DDoS-дрон: корпус, 4 ротора, красные огни (parts: [0..3] роторы, [4] мигающий диод) */
  private buildDrone(parent: THREE.Group): void {
    const dark = stdMat(0x1f2937, { rough: 0.4, metal: 0.5 });
    add(parent, boxG(0.62, 0.18, 0.62), dark, 0, 0, 0);
    add(parent, boxG(0.64, 0.04, 0.2), stdMat(0xf43f5e, { emissive: 0xf43f5e, ei: 0.8 }), 0, 0.06, 0);
    add(parent, cachedGeo('ddosPod', () => new THREE.SphereGeometry(0.13, 12, 8)), stdMat(0x111827, { rough: 0.2, metal: 0.6 }), 0, -0.15, 0.12);
    add(parent, cylG(0.008, 0.008, 0.35, 6), dark, 0.18, 0.25, -0.15);
    const rotorMat = shared('rotorRed', () => new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.35, depthWrite: false }));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const x = Math.cos(a) * 0.55;
      const z = Math.sin(a) * 0.55;
      add(parent, boxG(0.5, 0.05, 0.06), dark, x / 2, 0.02, z / 2, 0, -a, 0);
      add(parent, cylG(0.05, 0.05, 0.1, 8), dark, x, 0.06, z);
      const rotor = new THREE.Mesh(cylG(0.26, 0.26, 0.01, 18), rotorMat);
      rotor.position.set(x, 0.12, z);
      parent.add(rotor);
      this.parts.push(add(rotor, boxG(0.5, 0.008, 0.04), stdMat(0x7f1d1d), 0, 0, 0, 0, 0, 0, false));
    }
    for (const sx of [-1, 1]) add(parent, boxG(0.05, 0.03, 0.02), stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 }), sx * 0.1, 0.0, 0.32, 0, 0, 0, false);
    this.parts.push(add(parent, cachedGeo('ddosLed', () => new THREE.SphereGeometry(0.05, 8, 6)), stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 }), 0, 0.12, 0.3, 0, 0, 0, false));
  }

  private addRing(color: number, radius: number): void {
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ownMats.push(ringMat);
    this.ringMesh = new THREE.Mesh(cachedGeo('ringPlane', () => new THREE.PlaneGeometry(2, 2)), ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.ringMesh.position.y = 0.08;
    this.ringMax = radius;
    this.root.add(this.ringMesh);
  }

  /** Босс Спинбот: красно-чёрный мех с двумя миниганами */
  private buildMech(): void {
    const red = stdMat(0xb91c1c, { rough: 0.45, metal: 0.4 });
    const black = stdMat(0x111827, { rough: 0.5, metal: 0.5 });
    const steel = stdMat(0x4b5563, { rough: 0.35, metal: 0.8 });
    const glow = stdMat(0xff2d2d, { emissive: 0xff2d2d, ei: 3 });
    const mech = new THREE.Group();
    this.body.add(mech);
    // Ноги (качаются при ходьбе)
    const legs: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.45, 1.45, 0);
      add(leg, boxG(0.42, 0.72, 0.48), red, 0, -0.36, 0);
      add(leg, boxG(0.46, 0.2, 0.5), black, 0, -0.75, 0.05);
      add(leg, boxG(0.36, 0.62, 0.42), black, 0, -1.05, 0);
      add(leg, boxG(0.48, 0.18, 0.7), red, 0, -1.36, 0.1);
      mech.add(leg);
      legs.push(leg);
    }
    add(mech, boxG(0.95, 0.3, 0.6), black, 0, 1.5, 0);
    // Корпус — вращается (спинбот)
    const upper = new THREE.Group();
    upper.position.y = 1.6;
    mech.add(upper);
    add(upper, boxG(1.3, 1.0, 0.85), red, 0, 0.55, 0);
    add(upper, boxG(0.95, 0.55, 0.05), black, 0, 0.6, 0.44);
    for (let i = 0; i < 3; i++) add(upper, boxG(0.7, 0.05, 0.06), glow, 0, 0.42 + i * 0.13, 0.47, 0, 0, 0, false);
    add(upper, boxG(0.55, 0.45, 0.5), black, 0, 1.3, 0.02);
    add(upper, boxG(0.42, 0.14, 0.05), glow, 0, 1.33, 0.28, 0, 0, 0, false);
    add(upper, boxG(0.14, 0.14, 0.05), glow, 0, 1.33, 0.3, 0, 0, Math.PI / 4, false);
    add(upper, cylG(0.02, 0.02, 0.35, 6), black, 0.2, 1.65, -0.05);
    add(upper, cachedGeo('mechAntTip', () => new THREE.SphereGeometry(0.04, 8, 6)), glow, 0.2, 1.84, -0.05, 0, 0, 0, false);
    // Плечи и миниганы
    const barrelsList: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      add(upper, boxG(0.5, 0.42, 0.62), red, sx * 0.88, 0.92, 0);
      add(upper, boxG(0.32, 0.55, 0.36), black, sx * 0.92, 0.45, 0.05);
      const gun = new THREE.Group();
      gun.position.set(sx * 0.95, 0.25, 0.35);
      add(gun, cylG(0.22, 0.22, 0.42, 14), black, 0, 0, 0, Math.PI / 2, 0, 0);
      const barrels = new THREE.Group();
      barrels.position.z = 0.55;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(barrels, cylG(0.05, 0.05, 0.85, 8), steel, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0, Math.PI / 2, 0, 0);
      }
      add(barrels, cylG(0.17, 0.17, 0.06, 12), black, 0, 0, 0.35, Math.PI / 2, 0, 0);
      gun.add(barrels);
      upper.add(gun);
      barrelsList.push(barrels);
    }
    // Глитч-кольца вокруг
    const ringA = add(this.root, torusG(2.3, 0.05), stdMat(0xff2bd6, { emissive: 0xff2bd6, ei: 2 }), 0, 1.4, 0, Math.PI / 2, 0, 0, false);
    const ringB = add(this.root, torusG(2.45, 0.035), stdMat(0x22d3ee, { emissive: 0x22d3ee, ei: 2 }), 0, 1.6, 0, Math.PI / 2, 0, 0, false);
    // Щит
    const shieldMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ownMats.push(shieldMat);
    this.shieldMesh = new THREE.Mesh(cachedGeo('shieldIcoMech', () => new THREE.IcosahedronGeometry(2.5, 2)), shieldMat);
    this.shieldMesh.position.y = 2.0;
    this.shieldMesh.add(
      new THREE.Mesh(
        cachedGeo('shieldIcoMechW', () => new THREE.IcosahedronGeometry(2.53, 1)),
        shared('shieldWire', () => new THREE.MeshBasicMaterial({ color: 0xa5f3fc, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false })),
      ),
    );
    this.root.add(this.shieldMesh);
    // parts: [0] корпус, [1..2] стволы, [3..4] ноги, [5..6] кольца
    this.parts.push(upper, barrelsList[0], barrelsList[1], legs[0], legs[1], ringA, ringB);
  }

  /** Решение рук и положение оружия для заданной стойки */
  private holdFor(h: Humanoid, w: WeaponModel, pl: WeaponPlacement, leftFallback: HandSpec): Hold {
    const held = armsOnWeapon(h, w, pl);
    const sL = new THREE.Vector3(-h.shoulderX, SHOULDER_Y, 0);
    const l = held.armL ?? solveArm(sL, new THREE.Vector3(...leftFallback.at), new THREE.Vector3(...leftFallback.pole));
    return {
      pos: pl.pos.clone(), quat: pl.quat.clone(), rU: held.armR.upper.clone(), rF: held.armR.fore.clone(), lU: l.upper.clone(), lF: l.fore.clone(),
    };
  }

  /** Смешивает стойки «на ходу» (0) и «в прицеле» (1) */
  private applyHold(k: number): void {
    const h = this.human;
    const a = this.holdLow;
    const b = this.holdAim;
    if (!h || !a || !b || !this.weapon) return;
    this.weapon.group.position.lerpVectors(a.pos, b.pos, k);
    this.weapon.group.quaternion.slerpQuaternions(a.quat, b.quat, k);
    h.armR.quaternion.slerpQuaternions(a.rU, b.rU, k);
    h.foreR.quaternion.slerpQuaternions(a.rF, b.rF, k);
    h.armL.quaternion.slerpQuaternions(a.lU, b.lU, k);
    h.foreL.quaternion.slerpQuaternions(a.lF, b.lF, k);
  }

  /** Веер стволов за спиной: каждый лежит плашмя, прикладами к пояснице, слоями позади головы */
  private weaponFan(h: Humanoid, fan: [WeaponKind, number, number][], tier: number): void {
    const behind = Math.min(h.backZ, -0.25) - 0.012;
    fan.forEach(([wk, ang, accent], i) => {
      const gun = buildWeapon(wk, tier, accent);
      const q = basisQuat(new THREE.Vector3(0, 0, -1), new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0));
      const b = gun.bounds;
      const sc = gun.scale;
      const buttEnd = new THREE.Vector3(0, ((b.min.y + b.max.y) / 2) * sc, b.min.z * sc).applyQuaternion(q);
      gun.group.position.set(Math.sin(ang) * 0.08 - buttEnd.x, 1.12 - buttEnd.y, behind + b.min.x * sc - i * 0.03);
      gun.group.quaternion.copy(q);
      h.body.add(gun.group);
    });
  }

  /** Баллистический щит Кемпера: тёмный металл, неоновая рамка и V-полосы, смотровая прорезь */
  /** Баллистический щит: neon — цвет неоновой рамки (null — простой стальной), k — масштаб под рост бойца */
  private buildRiotShield(neon: number | null, k: number): void {
    const pivot = new THREE.Group();
    this.body.add(pivot);
    this.shieldPivot = pivot;
    this.shieldK = k;
    pivot.scale.setScalar(k);
    const metal = stdMat(neon === null ? 0x4b5563 : 0x1f2933, { rough: 0.35, metal: 0.7 });
    const cy = 0.95;
    const fz = 0.056;
    add(pivot, boxG(1.1, 1.4, 0.1), metal, 0, cy, 0);
    if (neon !== null) {
      const glow = stdMat(neon, { emissive: neon, ei: 2.2 });
      for (const sy of [-1, 1]) add(pivot, boxG(1.1, 0.04, 0.012), glow, 0, cy + sy * 0.68, fz, 0, 0, 0, false);
      for (const sx of [-1, 1]) add(pivot, boxG(0.04, 1.4, 0.012), glow, sx * 0.53, cy, fz, 0, 0, 0, false);
      for (const sx of [-1, 1]) add(pivot, boxG(0.04, 0.62, 0.012), glow, sx * 0.12, cy - 0.12, fz, 0, 0, -sx * 0.42, false);
    }
    add(pivot, boxG(0.44, 0.1, 0.02), stdMat(0x7dd3fc, { rough: 0.05, metal: 0.3, emissive: 0x0ea5e9, ei: 0.7, opacity: 0.8 }), 0, cy + 0.5, fz, 0, 0, 0, false);
    add(pivot, boxG(0.06, 0.22, 0.06), stdMat(0x111111, { rough: 0.6 }), -0.02, cy + 0.15, -0.08);
    this.updateShieldPivot();
  }

  private updateShieldPivot(): void {
    const p = this.shieldPivot;
    if (!p) return;
    const k = this.stance;
    const sk = this.shieldK;
    p.position.set((-0.14 + 0.04 * k) * sk, -0.18 * k * sk, (0.46 + 0.14 * k) * sk);
    p.rotation.y = 0.12 * (1 - k);
  }

  private scatterShards(): void {
    if (!this.shards) return;
    for (const m of this.shards.children) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.32 + Math.random() * 0.3;
      m.position.set(Math.cos(a) * r, 0.3 + Math.random() * 1.8, Math.sin(a) * r);
      m.scale.setScalar(0.5 + Math.random() * 0.9);
      m.visible = Math.random() > 0.25;
    }
  }

  /** Игровое кресло Стримера: крестовина на колёсах, сиденье, высокая спинка, подлокотники и кольцевая лампа */
  private buildGamingChair(): void {
    const chair = new THREE.Group();
    this.body.add(chair);
    const black = stdMat(0x18181b, { rough: 0.55 });
    const purple = stdMat(0x7e22ce, { rough: 0.5, emissive: 0x7e22ce, ei: 0.25 });
    const metal = stdMat(0x52525b, { rough: 0.3, metal: 0.8 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(chair, boxG(0.05, 0.04, 0.34), black, Math.sin(a) * 0.17, 0.09, Math.cos(a) * 0.17, 0, a, 0);
      add(chair, sphG(0.045, 8, 6), black, Math.sin(a) * 0.33, 0.045, Math.cos(a) * 0.33);
    }
    add(chair, cylG(0.035, 0.035, 0.36, 10), metal, 0, 0.27, -0.03);
    add(chair, boxG(0.56, 0.1, 0.44), black, 0, 0.48, -0.05);
    add(chair, boxG(0.5, 0.03, 0.4), purple, 0, 0.545, -0.05, 0, 0, 0, false);
    // Спинка с фиолетовыми «крыльями» и подушкой под голову
    const back = new THREE.Group();
    back.position.set(0, 0.55, -0.22);
    back.rotation.x = -0.1;
    chair.add(back);
    add(back, boxG(0.54, 1.05, 0.1), black, 0, 0.52, 0);
    for (const sx of [-1, 1]) add(back, boxG(0.08, 1.0, 0.12), purple, sx * 0.25, 0.5, 0.01);
    add(back, boxG(0.3, 0.13, 0.08), purple, 0, 0.98, 0.08);
    for (const sx of [-1, 1]) {
      add(chair, boxG(0.07, 0.04, 0.34), black, sx * 0.31, 0.7, -0.02);
      add(chair, boxG(0.04, 0.16, 0.04), metal, sx * 0.31, 0.6, -0.08);
    }
    // Кольцевая лампа на стойке за головой
    add(chair, cylG(0.014, 0.014, 1.2, 6), metal, -0.34, 1.12, -0.32);
    add(chair, boxG(0.04, 0.04, 0.06), metal, -0.34, 1.72, -0.3);
    add(chair, torusG(0.32, 0.025), stdMat(0xffffff, { emissive: 0xffffff, ei: 2.5 }), -0.34, 1.9, -0.3, 0, 0, 0, false);
    this.rack = chair;
  }

  /** Три дрона-зрителя на орбите вокруг Стримера */
  private buildDroneOrbit(): void {
    const orbit = new THREE.Group();
    orbit.position.y = 1.65;
    this.root.add(orbit);
    this.orbit = orbit;
    const shell = stdMat(0x7e22ce, { rough: 0.4, metal: 0.4 });
    const glow = stdMat(0xc084fc, { emissive: 0xc084fc, ei: 1.8 });
    const led = stdMat(0x22c55e, { emissive: 0x22c55e, ei: 2.5 });
    const dark = stdMat(0x1f1f23, { rough: 0.5 });
    const rotorMat = shared('rotorPurple', () => new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.35, depthWrite: false }));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const d = new THREE.Group();
      d.position.set(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95);
      d.rotation.y = Math.PI / 2 - a;
      add(d, boxG(0.22, 0.22, 0.22), shell, 0, 0, 0, 0, 0, 0, false);
      add(d, boxG(0.13, 0.04, 0.012), glow, 0, 0.03, 0.115, 0, 0, 0, false);
      add(d, sphG(0.045, 8, 6), led, 0, -0.13, 0, 0, 0, 0, false);
      for (const [x, z] of [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17]]) {
        add(d, boxG(0.03, 0.02, 0.2), dark, x * 0.55, 0.11, z * 0.55, 0, Math.atan2(x, z), 0, false);
        const rotor = new THREE.Mesh(cylG(0.08, 0.08, 0.008, 12), rotorMat);
        rotor.position.set(x, 0.13, z);
        d.add(rotor);
      }
      orbit.add(d);
      this.drones.push(d);
    }
  }

  /** Золотой кейс Коллекционера (начало координат — ручка) */
  private goldCase(s: number): THREE.Group {
    const g = new THREE.Group();
    const gold = stdMat(0xf59e0b, { rough: 0.3, metal: 0.75, emissive: 0x92400e, ei: 0.3 });
    const trim = stdMat(0xfde047, { rough: 0.25, metal: 0.8, emissive: 0xfacc15, ei: 0.8 });
    const h = s * 0.75;
    const d = s * 0.6;
    const cy = -0.07 - h / 2;
    add(g, boxG(s, h, d), gold, 0, cy, 0);
    for (const sx of [-1, 1]) add(g, boxG(0.03, h + 0.01, d + 0.01), trim, sx * (s / 2), cy, 0, 0, 0, 0, false);
    add(g, boxG(s + 0.01, 0.03, d + 0.01), trim, 0, cy + h / 2, 0, 0, 0, 0, false);
    add(g, boxG(s * 0.4, 0.03, 0.03), trim, 0, -0.015, 0, 0, 0, 0, false);
    for (const sx of [-1, 1]) add(g, boxG(0.03, 0.06, 0.03), trim, sx * s * 0.19, -0.045, 0, 0, 0, 0, false);
    add(g, boxG(0.09, 0.09, 0.01), stdMat(0xfff7d6, { emissive: 0xfde047, ei: 2 }), 0, cy, d / 2 + 0.006, 0, 0, Math.PI / 4, false);
    return g;
  }

  /** Лутбокс на земле: золотой куб, рамка, перекрестие замка, светящееся кольцо и вращающаяся рамка */
  private buildLootCrate(): void {
    const S = 0.85;
    const hs = S / 2;
    const cy = hs + 0.02;
    const box = new THREE.Group();
    box.position.y = cy;
    this.body.add(box);
    this.crateBox = box;
    const gold = stdMat(0xf59e0b, { rough: 0.3, metal: 0.7, emissive: 0x92400e, ei: 0.3 });
    const trim = stdMat(0xfde047, { rough: 0.2, metal: 0.8, emissive: 0xfacc15, ei: 1.0 });
    const lock = stdMat(0x78350f, { rough: 0.4, metal: 0.6 });
    const e = 0.07;
    add(box, boxG(S, S, S), gold, 0, 0, 0);
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        add(box, boxG(e, S + 0.02, e), trim, a * hs, 0, b * hs, 0, 0, 0, false);
        add(box, boxG(S + 0.02, e, e), trim, 0, a * hs, b * hs, 0, 0, 0, false);
        add(box, boxG(e, e, S + 0.02), trim, a * hs, b * hs, 0, 0, 0, 0, false);
      }
    }
    for (let i = 0; i < 4; i++) {
      const face = new THREE.Group();
      face.rotation.y = (i * Math.PI) / 2;
      box.add(face);
      add(face, boxG(0.5, 0.05, 0.02), lock, 0, 0, hs + 0.01, 0, 0, 0, false);
      add(face, boxG(0.05, 0.5, 0.02), lock, 0, 0, hs + 0.01, 0, 0, 0, false);
      add(face, cylG(0.09, 0.09, 0.03, 16), trim, 0, 0, hs + 0.02, Math.PI / 2, 0, 0, false);
    }
    // Кольцо у основания: свой материал (цвет уходит в красный к моменту открытия)
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xfbbf24, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ownMats.push(ringMat);
    this.crateMat = ringMat;
    const ring = new THREE.Mesh(cachedGeo('ringPlane', () => new THREE.PlaneGeometry(2, 2)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.scale.setScalar(0.95);
    this.root.add(ring);
    this.crateRing = ring;
    // Светящаяся рамка вокруг кейса
    const frame = new THREE.Group();
    frame.position.y = cy;
    this.root.add(frame);
    this.crateFrame = frame;
    const fm = shared('crateFrame', () => new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    const R = 0.7;
    for (const sz of [-1, 1]) add(frame, boxG(R * 2, 0.03, 0.03), fm, 0, 0, sz * R, 0, 0, 0, false);
    for (const sx of [-1, 1]) add(frame, boxG(0.03, 0.03, R * 2), fm, sx * R, 0, 0, 0, 0, 0, false);
    frame.rotation.z = 0.22;
    // Столб света
    const beamMat = shared('crateBeam', () => new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    add(this.root, cylG(0.25, 0.45, 2.6, 14), beamMat, 0, 1.3, 0, 0, 0, 0, false);
  }

  /** Шагающая серверная стойка: корпус, сервера с LED-полосами, антенны, кабели, 4 механические ноги */
  private buildServerRack(): void {
    this.gait = 'none';
    const rack = new THREE.Group();
    this.body.add(rack);
    this.rack = rack;
    const shell = stdMat(0x1e293b, { rough: 0.4, metal: 0.7 });
    const panel = stdMat(0x0f172a, { rough: 0.5, metal: 0.4 });
    const steel = stdMat(0x475569, { rough: 0.35, metal: 0.8 });
    const green = stdMat(0x22c55e, { emissive: 0x22c55e, ei: 2.2 });
    const cyan = stdMat(0x38bdf8, { emissive: 0x38bdf8, ei: 2.2 });
    const red = stdMat(0xef4444, { emissive: 0xef4444, ei: 2.5 });
    const H = 1.75;
    const base = 0.55;
    add(rack, boxG(1.1, H, 0.8), shell, 0, base + H / 2, 0);
    add(rack, boxG(1.16, 0.07, 0.86), steel, 0, base + H + 0.035, 0);
    add(rack, boxG(1.16, 0.07, 0.86), steel, 0, base - 0.02, 0);
    for (let i = 0; i < 5; i++) {
      const y = base + 0.22 + i * 0.32;
      add(rack, boxG(0.98, 0.25, 0.03), panel, 0, y, 0.41, 0, 0, 0, false);
      add(rack, boxG(0.46, 0.035, 0.012), i % 2 ? cyan : green, -0.2, y + 0.05, 0.43, 0, 0, 0, false);
      add(rack, boxG(0.3, 0.02, 0.012), i % 2 ? green : cyan, -0.28, y - 0.05, 0.43, 0, 0, 0, false);
      for (let j = 0; j < 3; j++) this.blink.push(add(rack, sphG(0.022, 6, 4), j === 2 ? red : green, 0.2 + j * 0.08, y, 0.43, 0, 0, 0, false));
    }
    for (const sx of [-1, 1]) {
      add(rack, cylG(0.012, 0.012, 0.6, 6), steel, sx * 0.36, base + H + 0.37, -0.2);
      this.blink.push(add(rack, sphG(0.035, 8, 6), sx < 0 ? red : green, sx * 0.36, base + H + 0.69, -0.2, 0, 0, 0, false));
    }
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const c1 = new THREE.CatmullRomCurve3([v(-0.5, 2.1, 0.3), v(-0.66, 1.7, 0.36), v(-0.62, 1.1, 0.2), v(-0.56, 0.75, 0.32)]);
    const c2 = new THREE.CatmullRomCurve3([v(0.5, 2.0, -0.3), v(0.64, 1.5, -0.38), v(0.6, 0.9, -0.2), v(0.55, 0.62, -0.3)]);
    add(rack, cachedGeo('farmCable1', () => new THREE.TubeGeometry(c1, 20, 0.025, 5, false)), stdMat(0x16a34a, { rough: 0.5 }), 0, 0, 0, 0, 0, 0, false);
    add(rack, cachedGeo('farmCable2', () => new THREE.TubeGeometry(c2, 20, 0.022, 5, false)), stdMat(0x111827, { rough: 0.5 }), 0, 0, 0, 0, 0, 0, false);
    // Мини-боты, вцепившиеся в бока стойки
    for (const sx of [-1, 1]) {
      const b = this.buildMiniBot(rack, 0.42);
      b.group.position.set(sx * 0.6, 1.0 + (sx > 0 ? 0.35 : 0), 0.08);
      b.group.rotation.set(0, sx * Math.PI * 0.5, -sx * 0.25);
      for (const a of b.arms) a.rotation.x = -1.2;
    }
    for (const [x, z] of [[-0.4, 0.26], [0.4, 0.26], [-0.4, -0.26], [0.4, -0.26]]) {
      const leg = new THREE.Group();
      leg.position.set(x, base, z);
      add(leg, sphG(0.09, 10, 8), steel, 0, 0, 0);
      add(leg, boxG(0.14, 0.3, 0.14), shell, 0, -0.17, 0);
      add(leg, boxG(0.1, 0.2, 0.1), steel, 0, -0.38, 0.03);
      add(leg, boxG(0.22, 0.07, 0.3), shell, 0, -0.51, 0.05);
      this.body.add(leg);
      this.rigLegs.push(leg);
    }
  }

  /** Угловатый мини-робот: кубическая голова с зелёным экраном-глазами, тонкие конечности */
  private buildMiniBot(parent: THREE.Object3D, scale: number): { group: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[] } {
    const g = new THREE.Group();
    g.scale.setScalar(scale);
    parent.add(g);
    const metal = stdMat(0x94a3b8, { rough: 0.35, metal: 0.65 });
    const dark = stdMat(0x334155, { rough: 0.5, metal: 0.4 });
    const eye = stdMat(0x4ade80, { emissive: 0x22c55e, ei: 2.6 });
    const screen = stdMat(0x052e16, { rough: 0.2, metal: 0.2, emissive: 0x052e16, ei: 0.4 });
    const legs: THREE.Group[] = [];
    const arms: THREE.Group[] = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.09, 0.44, 0);
      add(leg, cylG(0.035, 0.035, 0.38, 6), dark, 0, -0.19, 0);
      add(leg, boxG(0.11, 0.05, 0.16), metal, 0, -0.41, 0.03);
      g.add(leg);
      legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(sx * 0.21, 0.72, 0);
      arm.rotation.z = sx * 0.25;
      add(arm, cylG(0.028, 0.028, 0.3, 6), dark, 0, -0.15, 0);
      add(arm, boxG(0.07, 0.07, 0.07), metal, 0, -0.32, 0);
      g.add(arm);
      arms.push(arm);
    }
    add(g, boxG(0.36, 0.32, 0.26), metal, 0, 0.6, 0);
    add(g, boxG(0.1, 0.06, 0.01), eye, 0, 0.66, 0.135, 0, 0, 0, false);
    add(g, boxG(0.08, 0.06, 0.08), dark, 0, 0.79, 0);
    add(g, boxG(0.32, 0.26, 0.28), metal, 0, 0.94, 0);
    add(g, boxG(0.25, 0.15, 0.01), screen, 0, 0.94, 0.145, 0, 0, 0, false);
    for (const sx of [-1, 1]) add(g, boxG(0.055, 0.045, 0.01), eye, sx * 0.06, 0.95, 0.152, 0, 0, 0, false);
    add(g, cylG(0.01, 0.01, 0.16, 5), dark, 0.08, 1.15, 0, 0, 0, 0, false);
    add(g, sphG(0.03, 6, 4), eye, 0.08, 1.24, 0, 0, 0, 0, false);
    return { group: g, legs, arms };
  }

  /** Красный лазерный прицел Вантап-снайпера (скрыт, пока нет цели) */
  private buildLaser(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ownMats.push(mat);
    this.laserMat = mat;
    const beam = new THREE.Mesh(cachedGeo('laserBeam', () => new THREE.CylinderGeometry(0.014, 0.014, 1, 6)), mat);
    beam.visible = false;
    beam.renderOrder = 5;
    this.root.add(beam);
    this.laser = beam;
    const dot = new THREE.Mesh(sphG(0.07, 10, 8), mat);
    dot.visible = false;
    this.root.add(dot);
    this.laserDot = dot;
  }

  /** Стойка на колене (щит Кемпера, прицеливание Вантапа) */
  setStance(on: boolean): void {
    this.stanceOn = on;
  }

  /** Рейдж-квиттер «вышел из игры» */
  setVanished(v: boolean): void {
    this.root.visible = !v;
  }

  /** Доля времени до открытия кейса: 1 — только упал, 0 — открывается */
  setCrateTimer(frac: number): void {
    this.crateFrac = frac;
  }

  /** Бросок молотова Троллем */
  playThrow(): void {
    if (this.throwPose) this.throwT = 1;
  }

  /** Лазер от точки from до to (мировые координаты); null — выключить */
  setLaser(from: THREE.Vector3 | null, to?: THREE.Vector3): void {
    if (!this.laser || !this.laserDot) return;
    if (!from || !to) {
      this.laser.visible = false;
      this.laserDot.visible = false;
      return;
    }
    this.root.updateWorldMatrix(true, false);
    const a = this.root.worldToLocal(TMP_A.copy(from));
    const b = this.root.worldToLocal(TMP_B.copy(to));
    const len = Math.max(0.01, a.distanceTo(b));
    this.laser.position.addVectors(a, b).multiplyScalar(0.5);
    this.laser.scale.set(1, len, 1);
    this.laser.quaternion.setFromUnitVectors(UP, TMP_C.subVectors(b, a).normalize());
    this.laser.visible = true;
    this.laserDot.position.copy(b);
    this.laserDot.visible = true;
  }

  /** Дуло оружия в мировых координатах (без оружия — точка над головой) */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.weapon) return this.weapon.muzzle.getWorldPosition(out);
    return this.root.getWorldPosition(out).setY(out.y + 1.4);
  }

  setShield(frac: number): void {
    if (!this.shieldMesh) return;
    this.shieldMesh.visible = frac > 0.01;
    (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = this.shieldOpacity[0] + frac * this.shieldOpacity[1];
  }

  /** Энергощит-сфера вокруг босса (как у Спинбота) */
  private addEnergyShield(radius: number, color: number, y: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ownMats.push(mat);
    const mesh = new THREE.Mesh(cachedGeo(`shieldIco${radius}`, () => new THREE.IcosahedronGeometry(radius, 2)), mat);
    mesh.position.y = y;
    mesh.add(
      new THREE.Mesh(
        cachedGeo(`shieldIcoW${radius}`, () => new THREE.IcosahedronGeometry(radius * 1.012, 1)),
        shared(`shieldWire${color}`, () => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.3, depthWrite: false })),
      ),
    );
    this.root.add(mesh);
    this.shieldMesh = mesh;
  }

  /** Кольцо песчаной пыли у ног Джаггернаута (расширяется и ускоряется в бурю) */
  private buildSandRing(): void {
    const g = new THREE.Group();
    g.position.y = 0.2;
    this.root.add(g);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ownMats.push(mat);
    this.sandMat = mat;
    add(g, cachedGeo('sandRing', () => new THREE.RingGeometry(1.0, 1.7, 48, 1)), mat, 0, 0, 0, -Math.PI / 2, 0, 0, false);
    add(g, torusG(1.35, 0.05), mat, 0, 0.15, 0, Math.PI / 2, 0, 0, false);
    const clump = stdMat(0xd6a565, { rough: 1 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(g, sphG(0.07 + (i % 3) * 0.03, 6, 4), clump, Math.cos(a) * (1.2 + (i % 2) * 0.35), 0.1 + (i % 3) * 0.12, Math.sin(a) * (1.2 + (i % 2) * 0.35), 0, 0, 0, false);
    }
    this.sandRing = g;
  }

  /** Ядро Реактора: парящая светящаяся сфера, два стальных кольца, бронещитки, руки, сопла и энергощит */
  private buildReactorCore(): void {
    this.gait = 'none';
    const core = new THREE.Group();
    core.position.y = 1.6;
    this.body.add(core);
    this.rack = core;
    const glow = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.5, roughness: 0.3 });
    this.ownMats.push(glow);
    this.coreMat = glow;
    const steel = stdMat(0x64748b, { rough: 0.3, metal: 0.8 });
    const dark = stdMat(0x1f2937, { rough: 0.45, metal: 0.6 });
    add(core, sphG(0.65, 24, 16), glow, 0, 0, 0, 0, 0, 0, false);
    const ringA = add(core, torusG(0.95, 0.08), steel, 0, 0, 0, Math.PI / 2, 0, 0);
    const ringB = add(core, torusG(1.15, 0.06), steel, 0, 0, 0, 0, Math.PI / 2, 0);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      add(core, boxG(0.62, 1.0, 0.16), dark, Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02, 0, Math.PI / 2 - a, 0);
      add(core, boxG(0.5, 0.06, 0.17), glow, Math.cos(a) * 1.03, 0.3, Math.sin(a) * 1.03, 0, Math.PI / 2 - a, 0, false);
    }
    for (const sx of [-1, 1]) {
      add(core, sphG(0.22, 12, 8), steel, sx * 1.35, 0.15, 0);
      add(core, boxG(0.3, 0.6, 0.3), dark, sx * 1.45, -0.3, 0.05);
      add(core, boxG(0.36, 0.32, 0.38), steel, sx * 1.45, -0.72, 0.1);
    }
    const flameMat = shared('thrusterFlame', () => new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const sx of [-1, 1]) {
      add(core, cylG(0.12, 0.18, 0.25, 12), dark, sx * 0.35, -0.82, 0);
      const f = new THREE.Mesh(cachedGeo('thrusterCone', () => new THREE.ConeGeometry(0.14, 0.5, 10)), flameMat);
      f.position.set(sx * 0.35, -1.18, 0);
      f.rotation.x = Math.PI;
      core.add(f);
      this.flames.push(f);
    }
    this.parts.push(ringA, ringB);
    this.addEnergyShield(2.0, 0x38bdf8, 1.6);
  }

  /** Контейнерный Мех: двуногий, корпус-контейнер с hazard-полосой, гатлинг и фронтальный энергощит */
  private buildContainerMech(): void {
    this.gait = 'none';
    const mech = new THREE.Group();
    this.body.add(mech);
    this.rack = mech;
    const blue = stdMat(0x2563eb, { rough: 0.45, metal: 0.5 });
    const dark = stdMat(0x1e293b, { rough: 0.4, metal: 0.6 });
    const hazard = shared('hazardMat', () => new THREE.MeshStandardMaterial({ map: getTexture('hazard'), roughness: 0.6 }));
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.32, 0.78, 0);
      add(leg, boxG(0.2, 0.42, 0.24), dark, 0, -0.2, 0);
      add(leg, sphG(0.1, 8, 6), blue, 0, -0.42, 0.02);
      add(leg, boxG(0.18, 0.34, 0.22), dark, 0, -0.6, 0.02);
      add(leg, boxG(0.3, 0.08, 0.42), blue, 0, -0.74, 0.06);
      this.body.add(leg);
      this.rigLegs.push(leg);
    }
    add(mech, boxG(1.1, 1.3, 1.0), blue, 0, 1.42, 0);
    for (let i = -4; i <= 4; i++) {
      for (const sz of [-1, 1]) add(mech, boxG(0.05, 1.2, 0.02), dark, i * 0.12, 1.42, sz * 0.505, 0, 0, 0, false);
    }
    add(mech, boxG(1.12, 0.14, 1.02), hazard, 0, 1.0, 0, 0, 0, 0, false);
    add(mech, boxG(0.3, 0.08, 0.02), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), 0, 1.86, 0.515, 0, 0, 0, false);
    // Левая рука — гатлинг, правая — фронтальный щит
    add(mech, boxG(0.3, 0.3, 0.4), dark, -0.72, 1.45, 0.1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(mech, cylG(0.035, 0.035, 0.6, 6), dark, -0.72 + Math.cos(a) * 0.07, 1.4 + Math.sin(a) * 0.07, 0.55, Math.PI / 2, 0, 0, false);
    }
    add(mech, boxG(0.26, 0.3, 0.36), dark, 0.72, 1.45, 0.05);
    const mat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ownMats.push(mat);
    const arc = new THREE.Mesh(cachedGeo('mechShieldArc', () => new THREE.CylinderGeometry(0.9, 0.9, 1.5, 18, 1, true, -0.65, 1.3)), mat);
    arc.position.set(0.55, 1.35, -0.15);
    mech.add(arc);
    this.shieldMesh = arc;
    this.shieldOpacity = [0.12, 0.45];
  }

  /** Песчаная буря Джаггернаута */
  setStorm(on: boolean): void {
    this.stormOn = on;
  }

  /** Ярость: Пиромант ниже 50% HP, Подрывник ниже 40% */
  setRage(on: boolean): void {
    this.rage = on;
  }

  /** Вспышка ядра при ЭМИ-импульсе */
  pulse(): void {
    this.pulseK = 1;
  }

  /** Цель плечевых турелей Оверлорда (мировые координаты), null — смотрят вперёд */
  setTurretTarget(target: THREE.Vector3 | null): void {
    if (!target) {
      this.turretAim = null;
      return;
    }
    this.turretAim = (this.turretAim ?? new THREE.Vector3()).copy(target);
  }

  /** Дуло плечевой турели (для трассеров залпа) */
  turretWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.turretMuzzles[i];
    if (m) return m.getWorldPosition(out);
    return this.root.getWorldPosition(out).setY(out.y + 3);
  }

  /** speedK — текущая скорость относительно базовой (для анимации шага) */
  update(dt: number, speedK: number, stunned: boolean, camera: THREE.Camera): void {
    this.time += dt * (stunned ? 0.15 : 1);
    const t = this.time;
    const h = this.human;
    const stanceTarget = this.stanceOn ? 1 : 0;
    if (this.stance !== stanceTarget) {
      this.stance = stanceTarget > this.stance ? Math.min(1, this.stance + dt * 5) : Math.max(0, this.stance - dt * 5);
    }
    if (h) {
      if (this.gait === 'walk') {
        // В стойке ноги расходятся (одна вперёд, другая назад), таз опускается на CROUCH
        const k = this.stance;
        const sw = Math.sin(t * 9 * speedK) * this.stepAmp * Math.min(1, speedK) * (1 - k);
        h.legL.rotation.x = sw - this.kneelA * k;
        h.legR.rotation.x = -sw + this.kneelA * k;
        h.root.position.y = this.baseY + Math.abs(Math.cos(t * 9 * speedK)) * 0.05 * (1 - k) - CROUCH * k;
      } else h.root.position.y = this.baseY;
    }
    switch (this.kind) {
      case 'ping':
      case 'lagger': {
        if (!h) break;
        this.glitchT -= dt;
        if (this.glitchT <= 0) {
          this.glitchT = 0.06 + Math.random() * 0.25;
          h.root.position.x = (Math.random() - 0.5) * 0.25;
          h.root.position.z = (Math.random() - 0.5) * 0.2;
          h.root.scale.set(1 + (Math.random() - 0.5) * 0.25, 1, 1);
          h.root.visible = Math.random() > 0.12;
        }
        break;
      }
      case 'smurf': {
        const flap = Math.sin(t * 6) * 0.25;
        this.parts[0].rotation.y = flap;
        this.parts[1].rotation.y = -flap;
        break;
      }
      case 'ddos':
      case 'ddos_overlord': {
        for (let i = 0; i < 4; i++) this.parts[i].rotation.y += dt * 40;
        this.parts[4].visible = Math.sin(t * 10) > 0;
        this.body.position.y = Math.sin(t * 2.5) * 0.15;
        this.body.rotation.z = Math.sin(t * 1.7) * 0.08;
        break;
      }
      case 'cheater':
        this.parts[0].rotation.y += dt * 1.6;
        break;
      case 'afk':
        if (h) h.body.rotation.z = Math.sin(t * 1.4) * 0.08;
        break;
      case 'camper':
        this.updateShieldPivot();
        break;
      case 'booster':
        // Мини-тиммейт подпрыгивает в такт тяжёлым шагам
        if (this.rider) {
          this.rider.root.position.y = RIDER_Y + Math.abs(Math.sin(t * 9 * speedK)) * 0.06 * Math.min(1, speedK);
          this.rider.head.rotation.y = 0.4 + Math.sin(t * 3.1) * 0.25;
        }
        break;
      case 'ragequitter': {
        // Дёрганая походка, дрожащая клавиатура и мерцающие «пиксели»
        this.glitchT -= dt;
        if (this.glitchT <= 0) {
          this.glitchT = 0.05 + Math.random() * 0.18;
          if (h) {
            h.root.position.x = (Math.random() - 0.5) * 0.14;
            h.root.rotation.y = (Math.random() - 0.5) * 0.25;
          }
          this.scatterShards();
          if (this.rageWire) {
            this.rageWire.visible = Math.random() > 0.2;
            this.rageWire.scale.set(0.85 + Math.random() * 0.1, 2.0, 0.68 + Math.random() * 0.08);
          }
        }
        const kb = this.parts[0];
        if (kb) kb.rotation.y = 0.3 + Math.sin(t * 31) * 0.08;
        break;
      }
      case 'streamer': {
        if (this.orbit) this.orbit.rotation.y += dt * 2.2;
        this.drones.forEach((d, i) => {
          d.position.y = Math.sin(t * 3 + i * 2.1) * 0.08;
        });
        // Кресло катится и слегка покачивается
        if (this.rack) this.rack.rotation.z = Math.sin(t * 2.3) * 0.025;
        if (h) h.body.rotation.z = Math.sin(t * 2.3) * 0.025;
        break;
      }
      case 'loot_crate': {
        // Чем меньше времени до открытия, тем быстрее пульсация и вращение рамки, кольцо краснеет
        const left = 1 - this.crateFrac;
        this.pulseT += dt * (4 + left * 18);
        if (this.crateBox) this.crateBox.scale.setScalar(1 + Math.sin(this.pulseT) * (0.035 + left * 0.05));
        if (this.crateFrame) {
          this.crateFrame.rotation.y += dt * (1.5 + left * 6);
          this.crateFrame.position.y = 0.445 + Math.sin(t * 2) * 0.08;
        }
        if (this.crateMat && this.crateRing) {
          this.crateMat.color.copy(CRATE_GOLD).lerp(CRATE_RED, left);
          this.crateMat.opacity = 0.45 + 0.45 * Math.abs(Math.sin(this.pulseT));
          this.crateRing.scale.setScalar(0.9 + 0.15 * Math.abs(Math.sin(this.pulseT)));
        }
        break;
      }
      case 'troll': {
        if (!h || !this.throwPose || !this.bottle) break;
        const tp = this.throwPose;
        h.body.rotation.z = Math.sin(t * 9 * speedK) * 0.06 * Math.min(1, speedK);
        if (this.throwT > 0) {
          // Замах назад, затем бросок вперёд-вверх; бутылка исчезает в момент броска
          this.throwT = Math.max(0, this.throwT - dt / 0.45);
          const k = 1 - this.throwT;
          if (k < 0.35) slerpArm(h, tp.idle, tp.wind, k / 0.35);
          else slerpArm(h, tp.wind, tp.release, (k - 0.35) / 0.65);
          if (k > 0.65 && this.bottle.visible) {
            this.bottle.visible = false;
            this.reloadT = 1.3;
          }
          if (this.throwT === 0) this.returnT = 1;
        } else if (this.returnT > 0) {
          this.returnT = Math.max(0, this.returnT - dt / 0.35);
          slerpArm(h, tp.idle, tp.release, this.returnT);
        }
        if (this.reloadT > 0) {
          this.reloadT -= dt;
          if (this.reloadT <= 0) this.bottle.visible = true;
        }
        const flame = this.bottle.children[2];
        if (flame) flame.scale.setScalar(0.8 + Math.random() * 0.6);
        break;
      }
      case 'botfarm': {
        // Ноги шагают по диагональным парам, корпус покачивается, диоды мигают
        const sw = Math.sin(t * 6 * speedK) * 0.38 * Math.min(1, speedK);
        this.rigLegs.forEach((leg, i) => {
          leg.rotation.x = i === 0 || i === 3 ? sw : -sw;
        });
        if (this.rack) this.rack.position.y = Math.abs(Math.sin(t * 6 * speedK)) * 0.05;
        for (const b of this.blink) if (Math.random() < dt * 4) b.visible = !b.visible;
        break;
      }
      case 'mini_bot': {
        const sw = Math.sin(t * 12 * speedK) * 0.6 * Math.min(1, speedK);
        this.rigLegs.forEach((leg, i) => {
          leg.rotation.x = i === 0 ? sw : -sw;
        });
        this.rigArms.forEach((arm, i) => {
          arm.rotation.x = i === 0 ? -sw * 0.7 : sw * 0.7;
        });
        this.body.position.y = Math.abs(Math.cos(t * 12 * speedK)) * 0.04;
        break;
      }
      case 'dune_juggernaut': {
        this.storm += ((this.stormOn ? 1 : 0) - this.storm) * Math.min(1, dt * 3);
        if (this.sandRing) {
          this.sandRing.rotation.y += dt * (1.2 + this.storm * 5);
          this.sandRing.scale.setScalar(1 + this.storm * 0.9);
        }
        if (this.sandMat) this.sandMat.opacity = 0.3 + this.storm * 0.35;
        break;
      }
      case 'alley_pyromancer':
        for (const f of this.flames) f.scale.set(1, (this.rage ? 1.6 : 1) * (0.75 + Math.random() * 0.5), 1);
        break;
      case 'reactor_core': {
        const [ringA, ringB] = this.parts;
        this.pulseK = Math.max(0, this.pulseK - dt * 1.6);
        ringA.rotation.y += dt * (1.4 + this.pulseK * 6);
        ringB.rotation.x += dt * (1.9 + this.pulseK * 6);
        if (this.rack) {
          this.rack.position.y = 1.6 + Math.sin(t * 1.6) * 0.12;
          this.rack.rotation.y += dt * 0.3;
        }
        if (this.coreMat) this.coreMat.emissiveIntensity = 2.5 + this.pulseK * 4 + Math.sin(t * 6) * 0.3;
        for (const f of this.flames) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
        if (this.shieldMesh) this.shieldMesh.rotation.y += dt * 0.5;
        break;
      }
      case 'overpass_overlord': {
        // Турели плавно поворачиваются к цели
        for (const tur of this.turrets) {
          let yaw = 0;
          if (this.turretAim && tur.parent) {
            const local = tur.parent.worldToLocal(TMP_A.copy(this.turretAim)).sub(tur.position);
            yaw = Math.atan2(local.x, local.z);
          }
          tur.rotation.y += (yaw - tur.rotation.y) * Math.min(1, dt * 6);
        }
        if (this.shieldMesh) this.shieldMesh.rotation.y += dt * 0.4;
        break;
      }
      case 'carpet_ninja':
        if (this.cape) this.cape.rotation.x = 0.12 + Math.abs(Math.sin(t * 9 * speedK)) * 0.25 * Math.min(1, speedK);
        break;
      case 'flash_maestro':
        if (this.orbit) {
          this.orbit.rotation.y += dt * 2.6;
          for (const c of this.orbit.children) c.rotation.x += dt * 5;
        }
        break;
      case 'yard_sapper':
        for (const b of this.blink) b.visible = Math.sin(t * (this.rage ? 26 : 8)) > 0;
        break;
      case 'container_mech': {
        const sw = Math.sin(t * 5 * speedK) * 0.4 * Math.min(1, speedK);
        this.rigLegs.forEach((leg, i) => {
          leg.rotation.x = i === 0 ? sw : -sw;
        });
        if (this.rack) this.rack.position.y = Math.abs(Math.sin(t * 5 * speedK)) * 0.05;
        break;
      }
      case 'hill_jammer':
        if (this.parts[0]) this.parts[0].rotation.z += dt * 4;
        break;
      case 'onetap':
      case 'long_awper':
        this.applyHold(this.stance);
        if (this.laserMat) this.laserMat.opacity = 0.55 + Math.random() * 0.35;
        break;
      case 'spinbot': {
        const [upper, b1, b2, legL, legR, ringA, ringB] = this.parts;
        upper.rotation.y += dt * (stunned ? 2 : 12);
        b1.rotation.z += dt * 25;
        b2.rotation.z -= dt * 25;
        const sw = Math.sin(t * 5) * 0.35;
        legL.rotation.x = sw;
        legR.rotation.x = -sw;
        ringA.rotation.z += dt * 1.5;
        ringB.rotation.z -= dt * 2.2;
        ringA.visible = Math.random() > 0.05;
        if (this.shieldMesh) this.shieldMesh.rotation.y += dt * 0.6;
        break;
      }
      default:
        break;
    }
    if (this.ringMesh) {
      const k = (t * 0.8) % 1;
      const r = 0.5 + k * this.ringMax;
      this.ringMesh.scale.set(r, r, r);
      (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
    this.hp.face(camera);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.hp.dispose();
    for (const m of this.ownMats) m.dispose();
  }
}
