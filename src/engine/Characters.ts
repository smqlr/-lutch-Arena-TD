import * as THREE from 'three';
import type { BeltProp, EnemyKind, GearKind, UnitDef, WeaponKind } from '../types/game';
import { ROLE_COLORS } from '../i18n';
import { HpBar, add, boxG, buildWeapon, cachedGeo, cylG, darken, shared, stdMat, torusG } from './ModelFactory';
import type { WeaponModel } from './ModelFactory';
import { SHOULDER_Y, buildHumanoid, buildItem } from './Humanoid';
import type { Humanoid, HumanoidOpts, ItemKind } from './Humanoid';
import {
  armsOnWeapon, basisQuat, combatDir, gripPlacement, hasPose, hipPlacement, poseArms, setArm, shoulderPlacement, solveArm, solvePose, weaponPoint,
} from './Poses';
import type { HandSpec, SolvedPose, WeaponPlacement } from './Poses';
import { alertTexture, matrixTexture, pajamaTexture, pixelTexture, ringTexture, textTexture, wifiTexture } from './Textures';

/**
 * Модели персонажей: бойцы отряда (внешность, фирменные позы, предметы) и 15 типов врагов
 * по концепт-арту «Юниты и враги».
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
        const dark = stdMat(0x1f2937, { rough: 0.4, metal: 0.5 });
        add(this.body, boxG(0.62, 0.18, 0.62), dark, 0, 0, 0);
        add(this.body, boxG(0.64, 0.04, 0.2), stdMat(0xf43f5e, { emissive: 0xf43f5e, ei: 0.8 }), 0, 0.06, 0);
        add(this.body, cachedGeo('ddosPod', () => new THREE.SphereGeometry(0.13, 12, 8)), stdMat(0x111827, { rough: 0.2, metal: 0.6 }), 0, -0.15, 0.12);
        add(this.body, cylG(0.008, 0.008, 0.35, 6), dark, 0.18, 0.25, -0.15);
        const rotorMat = shared('rotorRed', () => new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.35, depthWrite: false }));
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          const x = Math.cos(a) * 0.55;
          const z = Math.sin(a) * 0.55;
          add(this.body, boxG(0.5, 0.05, 0.06), dark, x / 2, 0.02, z / 2, 0, -a, 0);
          add(this.body, cylG(0.05, 0.05, 0.1, 8), dark, x, 0.06, z);
          const rotor = new THREE.Mesh(cylG(0.26, 0.26, 0.01, 18), rotorMat);
          rotor.position.set(x, 0.12, z);
          this.body.add(rotor);
          this.parts.push(add(rotor, boxG(0.5, 0.008, 0.04), stdMat(0x7f1d1d), 0, 0, 0, 0, 0, 0, false));
        }
        for (const sx of [-1, 1]) add(this.body, boxG(0.05, 0.03, 0.02), stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 }), sx * 0.1, 0.0, 0.32, 0, 0, 0, false);
        this.parts.push(add(this.body, cachedGeo('ddosLed', () => new THREE.SphereGeometry(0.05, 8, 6)), stdMat(0xff1f3d, { emissive: 0xff1f3d, ei: 3 }), 0, 0.12, 0.3, 0, 0, 0, false));
        barH = 0.9;
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
        // Веер стволов за спиной: каждый лежит плашмя, прикладами к пояснице, слоями позади головы
        const fan: [WeaponKind, number][] = [['sniper', -0.8], ['shotgun', -0.28], ['smg', 0.28], ['rifle', 0.8]];
        const behind = Math.min(h.backZ, -0.25) - 0.012;
        fan.forEach(([wk, ang], i) => {
          const gun = buildWeapon(wk, 0, 0xf97316);
          const q = basisQuat(new THREE.Vector3(0, 0, -1), new THREE.Vector3(Math.sin(ang), Math.cos(ang), 0));
          const b = gun.bounds;
          const sc = gun.scale;
          const buttEnd = new THREE.Vector3(0, ((b.min.y + b.max.y) / 2) * sc, b.min.z * sc).applyQuaternion(q);
          gun.group.position.set(Math.sin(ang) * 0.08 - buttEnd.x, 1.12 - buttEnd.y, behind + b.min.x * sc - i * 0.03);
          gun.group.quaternion.copy(q);
          h.body.add(gun.group);
        });
        barH = 2.45;
        break;
      }
    }
    this.height = barH;
    this.hp = new HpBar(barW, barH, kind === 'spinbot');
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
  private equip(h: Humanoid, kind: WeaponKind, place: (w: WeaponModel) => WeaponPlacement, leftFallback: HandSpec, oneHand = false): void {
    const w = buildWeapon(kind, 0, 0xef4444);
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

  setShield(frac: number): void {
    if (!this.shieldMesh) return;
    this.shieldMesh.visible = frac > 0.01;
    (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.06 + frac * 0.22;
  }

  /** speedK — текущая скорость относительно базовой (для анимации шага) */
  update(dt: number, speedK: number, stunned: boolean, camera: THREE.Camera): void {
    this.time += dt * (stunned ? 0.15 : 1);
    const t = this.time;
    const h = this.human;
    if (h) {
      const sw = Math.sin(t * 9 * speedK) * this.stepAmp * Math.min(1, speedK);
      h.legL.rotation.x = sw;
      h.legR.rotation.x = -sw;
      h.root.position.y = Math.abs(Math.cos(t * 9 * speedK)) * 0.05;
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
      case 'ddos': {
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
