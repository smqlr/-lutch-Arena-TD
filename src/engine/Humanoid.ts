import * as THREE from 'three';
import type { BeardStyle, BeltProp, GearKind, GlassesStyle, HairStyle, SleeveStyle } from '../types/game';
import { add, boxG, buildWeapon, cachedGeo, cylG, darken, domeG, shared, sphG, stdMat, torusG } from './ModelFactory';
import { getTexture, screenTexture } from './Textures';

/**
 * Процедурный гуманоид: форма (джерси с полосой), рукава, причёски, бороды, очки, головные уборы,
 * балаклава, разгрузка, пропорции тела и аксессуар на поясе. Плюс предметы для поз (планшет, кубок и т. д.).
 *
 * Координаты тела (до масштаба): ступни y=0, бёдра 0.92, плечи 1.46, голова 1.6; лицо смотрит в +Z.
 * Позы и IK в Poses.ts опираются на эти точки — их нельзя двигать.
 */

export type HeadGear = GearKind | 'gasmask' | 'balaclava';

export interface HumanoidOpts {
  skin: number;
  hair: number;
  /** Цвет джерси / рубашки */
  shirt: number;
  /** Акцентная полоса на джерси (если задана) */
  stripe?: number;
  pants: number;
  boots?: number;
  accent: number;
  /** Цвет роли: эполеты и нашивка на спине (только бойцы отряда) */
  roleColor?: number;
  gear: HeadGear;
  gearColor?: number;
  capBackwards?: boolean;
  hairStyle?: HairStyle;
  beard?: BeardStyle;
  glasses?: GlassesStyle;
  shades?: boolean;
  /** Маска на нижнюю часть лица (с капюшоном) */
  mask?: boolean;
  maskColor?: number;
  /** Светящиеся глаза (враги) */
  eyeGlow?: number;
  mouthOpen?: boolean;
  sleeves?: SleeveStyle;
  tattoos?: boolean;
  gloves?: boolean;
  /** Цвет тактического жилета */
  vest?: number;
  bulky?: boolean;
  harness?: boolean;
  kneePads?: boolean;
  /** Обхват тела относительно стандарта */
  girth?: number;
  belly?: boolean;
  prop?: BeltProp;
  shirtMap?: THREE.Texture;
  pantsMap?: THREE.Texture;
  scale?: number;
}

export interface Humanoid {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  fingerR: THREE.Mesh;
  torso: THREE.Group;
  head: THREE.Group;
  weaponMount: THREE.Group;
  /** Положение плеч по X (зависит от обхвата) — нужно IK */
  shoulderX: number;
  beltProp: THREE.Object3D | null;
  /** Передняя поверхность груди на уровне плечевого кармана (z), с учётом жилета и обхвата */
  chestZ: number;
  /** Поверхность спины (z < 0), с учётом жилета, лямок и нашивки */
  backZ: number;
  /** Половина ширины торса по X */
  torsoHalfW: number;
}

/** Стандартные плечи и длины звеньев руки (используются IK) */
export const SHOULDER_X = 0.26;
export const SHOULDER_Y = 1.46;
export const UPPER_ARM = 0.33;
export const FOREARM = 0.35;

const texMats = new Map<string, THREE.MeshStandardMaterial>();
function texturedMat(map: THREE.Texture, color = 0xffffff, rough = 0.85): THREE.MeshStandardMaterial {
  const key = `${map.uuid}|${color}|${rough}`;
  let m = texMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, color, roughness: rough });
    texMats.set(key, m);
  }
  return m;
}

function mix(a: number, b: number, k: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
}

/* --------------------------------- Голова --------------------------------- */

/** Головные уборы, которые закрывают макушку (верх причёски не рисуется) */
const COVERS_TOP = new Set<HeadGear>(['helmet', 'beanie', 'hood', 'balaclava', 'cap', 'gasmask']);
/** Полностью закрывают волосы */
const COVERS_ALL = new Set<HeadGear>(['hood', 'balaclava', 'gasmask']);

/**
 * Полусфера по форме вытянутого черепа, наклонённая назад: спереди край поднят над бровями,
 * сзади опущен к затылку. Используется для волос и мягких головных уборов.
 */
function capDome(head: THREE.Group, r: number, mat: THREE.Material, tilt = -0.4, y = 0.13): THREE.Mesh {
  const m = add(head, domeG(r), mat, 0, y, -0.01, tilt, 0, 0);
  m.scale.set(1, 1.2, 1.04);
  return m;
}

function buildHair(head: THREE.Group, style: HairStyle, color: number, gear: HeadGear): void {
  if (style === 'bald' || COVERS_ALL.has(gear)) return;
  const hm = stdMat(color, { rough: 0.9 });
  const top = !COVERS_TOP.has(gear);
  switch (style) {
    case 'short':
      if (top) capDome(head, 0.15, hm);
      break;
    case 'fade':
      if (top) capDome(head, 0.146, stdMat(mix(color, 0x000000, 0.15), { rough: 0.95 }), -0.5);
      break;
    case 'spiky': {
      if (!top) break;
      capDome(head, 0.15, hm);
      const cone = cachedGeo('spike', () => new THREE.ConeGeometry(0.035, 0.1, 6));
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 8; i++) {
        const theta = (i / 8) * Math.PI * 2;
        const phi = i % 2 ? 0.35 : 0.65;
        const n = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta) - 0.15).normalize();
        const m = add(head, cone, hm, n.x * 0.15, 0.13 + n.y * 0.15, n.z * 0.15, 0, 0, 0, false);
        m.quaternion.setFromUnitVectors(up, n);
      }
      break;
    }
    case 'mohawk': {
      // выбритые виски
      capDome(head, 0.145, stdMat(mix(color, 0x1a1a1a, 0.65), { rough: 0.95 }), -0.5);
      if (!top) break;
      for (let i = 0; i < 6; i++) {
        const z = 0.11 - i * 0.05;
        const y = 0.13 + Math.sqrt(Math.max(0, 0.15 * 0.15 - z * z)) * 1.1;
        add(head, boxG(0.05, 0.12, 0.055), hm, 0, y + 0.04, z, -0.35 + i * 0.1, 0, 0, false);
      }
      break;
    }
    case 'long':
      if (top) {
        capDome(head, 0.153, hm, -0.35);
        add(head, boxG(0.17, 0.045, 0.06), hm, 0.03, 0.26, 0.1, 0.2, 0, -0.25, false);
      }
      add(head, boxG(0.26, 0.22, 0.05), hm, 0, 0.05, -0.12);
      add(head, boxG(0.035, 0.17, 0.13), hm, 0.135, 0.07, -0.01, 0, 0, 0, false);
      add(head, boxG(0.035, 0.17, 0.13), hm, -0.135, 0.07, -0.01, 0, 0, 0, false);
      break;
    case 'bun':
      if (top) capDome(head, 0.15, hm);
      add(head, sphG(0.068, 10, 8), hm, 0, 0.22, -0.14);
      break;
    case 'dreads': {
      if (top) capDome(head, 0.152, hm);
      const dread = cachedGeo('dread', () => new THREE.CylinderGeometry(0.02, 0.016, 0.3, 5));
      for (let i = 0; i < 13; i++) {
        const a = Math.PI * (0.05 + (i / 12) * 0.9);
        const x = Math.cos(a) * 0.14;
        const z = -Math.sin(a) * 0.12;
        add(head, dread, hm, x, -0.02, z, -z * 1.5, 0, x * 1.5, false);
      }
      break;
    }
  }
}

function buildBeard(head: THREE.Group, style: BeardStyle, hair: number, skin: number): void {
  if (style === 'none') return;
  if (style === 'stubble') {
    const m = stdMat(mix(skin, hair, 0.55), { rough: 0.95 });
    add(head, boxG(0.22, 0.09, 0.05), m, 0, 0.05, 0.115, 0, 0, 0, false);
    add(head, boxG(0.1, 0.05, 0.05), m, 0, 0.01, 0.12, 0, 0, 0, false);
    return;
  }
  const m = stdMat(darken(hair, 0.1), { rough: 0.95 });
  add(head, boxG(0.25, 0.14, 0.09), m, 0, 0.035, 0.095);
  add(head, boxG(0.12, 0.03, 0.035), m, 0, 0.085, 0.145, 0, 0, 0, false);
  add(head, boxG(0.03, 0.11, 0.07), m, 0.125, 0.1, 0.06, 0, 0, 0, false);
  add(head, boxG(0.03, 0.11, 0.07), m, -0.125, 0.1, 0.06, 0, 0, 0, false);
}

function buildGlasses(head: THREE.Group, style: GlassesStyle): void {
  if (style === 'none') return;
  const frame = stdMat(0x111111, { rough: 0.4, metal: 0.4 });
  if (style === 'shades') {
    add(head, boxG(0.25, 0.05, 0.03), stdMat(0x050505, { rough: 0.1, metal: 0.6 }), 0, 0.155, 0.13, 0, 0, 0, false);
    return;
  }
  const lens = stdMat(0xbfe9ff, { rough: 0.05, metal: 0.2, emissive: 0x7dd3fc, ei: 0.25, opacity: 0.45 });
  for (const sx of [-1, 1]) {
    if (style === 'rect') {
      add(head, boxG(0.078, 0.052, 0.012), frame, sx * 0.052, 0.158, 0.148, 0, 0, 0, false);
      add(head, boxG(0.062, 0.036, 0.006), lens, sx * 0.052, 0.158, 0.155, 0, 0, 0, false);
    } else {
      add(head, torusG(0.03, 0.006), frame, sx * 0.05, 0.158, 0.148, 0, 0, 0, false);
      add(head, cylG(0.026, 0.026, 0.004, 12), lens, sx * 0.05, 0.158, 0.148, Math.PI / 2, 0, 0, false);
    }
    add(head, boxG(0.008, 0.01, 0.13), frame, sx * 0.098, 0.16, 0.085, 0, 0, 0, false);
  }
  add(head, boxG(0.03, 0.01, 0.01), frame, 0, 0.165, 0.15, 0, 0, 0, false);
}

function buildGear(head: THREE.Group, o: HumanoidOpts): void {
  const color = o.gearColor ?? 0x374151;
  const gm = stdMat(color, { rough: 0.6, metal: o.gear === 'helmet' ? 0.25 : 0 });
  const accent = o.accent;
  switch (o.gear) {
    case 'helmet': {
      const d = capDome(head, 0.172, gm, -0.25, 0.13);
      d.scale.set(1, 1.15, 1.04);
      add(head, cylG(0.178, 0.184, 0.035, 18), gm, 0, 0.14, -0.01, -0.25, 0, 0);
      add(head, boxG(0.24, 0.045, 0.06), stdMat(0x1f2937), 0, 0.22, 0.13);
      break;
    }
    case 'headset':
      // Дуга от уха до уха над макушкой
      add(head, torusG(0.17, 0.016, Math.PI), stdMat(0x111111, { rough: 0.4 }), 0, 0.13, -0.01);
      for (const sx of [-1, 1]) {
        add(head, cylG(0.065, 0.065, 0.05, 14), stdMat(0x18181b, { rough: 0.5 }), sx * 0.15, 0.11, 0, 0, 0, Math.PI / 2);
        add(head, cylG(0.045, 0.045, 0.052, 14), stdMat(accent, { emissive: accent, ei: 0.8 }), sx * 0.152, 0.11, 0, 0, 0, Math.PI / 2, false);
      }
      add(head, boxG(0.015, 0.015, 0.16), stdMat(0x111111), 0.12, 0.05, 0.08, 0, -0.5, 0, false);
      add(head, sphG(0.022, 8, 6), stdMat(accent, { emissive: accent, ei: 1.2 }), 0.075, 0.04, 0.15, 0, 0, 0, false);
      break;
    case 'visor':
      add(head, cylG(0.152, 0.152, 0.04, 18), stdMat(0x111827), 0, 0.15, 0);
      add(head, boxG(0.27, 0.07, 0.05), stdMat(accent, { emissive: accent, ei: 0.9, rough: 0.15, metal: 0.3, opacity: 0.85 }), 0, 0.155, 0.13, 0, 0, 0, false);
      break;
    case 'cap': {
      capDome(head, 0.155, gm, -0.35);
      const back = o.capBackwards ? -1 : 1;
      // Козырёк: спереди над бровями или развёрнут назад
      add(head, boxG(0.2, 0.018, 0.15), gm, 0, back > 0 ? 0.2 : 0.12, back * 0.17, back * -0.12);
      if (o.capBackwards) add(head, boxG(0.08, 0.035, 0.02), stdMat(0x111111), 0, 0.22, 0.135, 0, 0, 0, false);
      add(head, sphG(0.02, 6, 4), stdMat(accent), 0, 0.31, -0.03, 0, 0, 0, false);
      break;
    }
    case 'beanie':
      capDome(head, 0.16, gm, -0.35, 0.125);
      add(head, cylG(0.164, 0.164, 0.06, 18), stdMat(darken(color, 0.25)), 0, 0.16, -0.01, -0.35, 0, 0);
      add(head, boxG(0.05, 0.03, 0.01), stdMat(accent, { emissive: accent, ei: 0.5 }), 0, 0.19, 0.155, -0.35, 0, 0, false);
      break;
    case 'hood': {
      const hood = add(head, cachedGeo('hood', () => new THREE.SphereGeometry(0.2, 16, 12, Math.PI * 0.22, Math.PI * 1.56)), stdMat(color, { rough: 0.85 }), 0, 0.12, -0.02);
      hood.rotation.y = Math.PI / 2;
      hood.scale.set(1, 1.08, 1.1);
      break;
    }
    case 'bandana':
      add(head, cylG(0.155, 0.155, 0.045, 18), gm, 0, 0.2, 0);
      add(head, boxG(0.05, 0.08, 0.1), gm, 0, 0.17, -0.18, 0.5);
      break;
    case 'balaclava': {
      const mm = stdMat(o.maskColor ?? 0x111111, { rough: 0.95 });
      const s = add(head, sphG(0.153, 16, 12), mm, 0, 0.13, 0);
      s.scale.set(0.96, 1.1, 1.02);
      break;
    }
    case 'gasmask':
      add(head, domeG(0.15), stdMat(0x27272a, { rough: 0.9 }), 0, 0.12, -0.005);
      add(head, boxG(0.2, 0.1, 0.06), stdMat(0x1f2937), 0, 0.07, 0.12);
      add(head, cylG(0.05, 0.06, 0.09, 12), stdMat(0x3f3f46, { metal: 0.4 }), 0, 0.04, 0.17, Math.PI / 2);
      break;
    case 'none':
      break;
  }
}

function buildHead(body: THREE.Group, o: HumanoidOpts): THREE.Group {
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  body.add(head);
  const skin = stdMat(o.skin, { rough: 0.75 });
  const skull = add(head, sphG(0.14, 16, 12), skin, 0, 0.13, 0);
  skull.scale.set(0.95, 1.1, 1);
  add(head, boxG(0.03, 0.05, 0.03), skin, 0, 0.11, 0.14, 0, 0, 0, false);

  const full = o.gear === 'balaclava';
  if (full) {
    // прорезь для глаз
    add(head, boxG(0.2, 0.05, 0.02), skin, 0, 0.16, 0.14, 0, 0, 0, false);
  }
  const eyesHidden = o.gear === 'visor' || o.gear === 'gasmask' || o.shades;
  if (!eyesHidden) {
    const eyeMat = o.eyeGlow !== undefined ? stdMat(o.eyeGlow, { emissive: o.eyeGlow, ei: 2.5 }) : stdMat(0x18181b, { rough: 0.7 });
    const ew = o.eyeGlow !== undefined ? 0.045 : 0.035;
    add(head, boxG(ew, 0.02, 0.012), eyeMat, -0.05, 0.16, full ? 0.152 : 0.136, 0, 0, 0, false);
    add(head, boxG(ew, 0.02, 0.012), eyeMat, 0.05, 0.16, full ? 0.152 : 0.136, 0, 0, 0, false);
  }
  if (o.mouthOpen && !full && !o.mask) add(head, boxG(0.065, 0.045, 0.01), stdMat(0x3b0d0d), 0, 0.06, 0.142, 0, 0, 0, false);

  buildHair(head, o.hairStyle ?? 'short', o.hair, o.gear);
  if (!full && !o.mask) buildBeard(head, o.beard ?? 'none', o.hair, o.skin);
  if (o.mask && !full) add(head, boxG(0.25, 0.13, 0.08), stdMat(o.maskColor ?? 0x111111, { rough: 0.95 }), 0, 0.06, 0.1);
  buildGlasses(head, o.shades ? 'shades' : (o.glasses ?? 'none'));
  buildGear(head, o);
  head.scale.setScalar(1.15);
  return head;
}

/* --------------------------------- Торс ----------------------------------- */

function buildTorso(body: THREE.Group, o: HumanoidOpts, shirt: THREE.Material): THREE.Group {
  const girth = o.girth ?? 1;
  const torso = new THREE.Group();
  torso.position.set(0, 1.04, 0);
  torso.scale.set(girth, 1, 0.9 + girth * 0.1);
  body.add(torso);
  add(torso, boxG(0.42, 0.5, 0.24), shirt, 0, 0.24, 0);
  if (o.belly) {
    const b = add(torso, sphG(0.2, 14, 10), shirt, 0, 0.16, 0.08);
    b.scale.set(1.05, 0.85, 0.75);
  }
  if (o.stripe !== undefined && o.vest === undefined) {
    const sm = stdMat(o.stripe, { rough: 0.7 });
    add(torso, boxG(0.425, 0.055, 0.245), sm, 0, 0.36, 0, 0, 0, 0, false);
    add(torso, boxG(0.012, 0.42, 0.13), sm, 0.212, 0.24, 0, 0, 0, 0, false);
    add(torso, boxG(0.012, 0.42, 0.13), sm, -0.212, 0.24, 0, 0, 0, 0, false);
    add(torso, boxG(0.17, 0.035, 0.05), sm, 0, 0.495, 0.1, 0, 0, 0, false);
    // эмблема на груди
    add(torso, boxG(0.06, 0.06, 0.012), stdMat(o.accent, { emissive: o.accent, ei: 0.4 }), -0.1, 0.42, 0.123, 0, 0, 0, false);
  }
  if (o.vest !== undefined) {
    const vm = stdMat(o.vest, { rough: 0.65 });
    const vd = stdMat(darken(o.vest, 0.3), { rough: 0.7 });
    if (o.bulky) {
      add(torso, boxG(0.54, 0.46, 0.36), vm, 0, 0.27, 0);
      add(torso, boxG(0.17, 0.1, 0.3), vd, 0.27, 0.46, 0, 0, 0, -0.3);
      add(torso, boxG(0.17, 0.1, 0.3), vd, -0.27, 0.46, 0, 0, 0, 0.3);
    } else {
      add(torso, boxG(0.46, 0.38, 0.3), vm, 0, 0.27, 0);
    }
    for (const px of [-0.13, 0, 0.13]) add(torso, boxG(0.1, 0.09, 0.06), vd, px, 0.14, o.bulky ? 0.2 : 0.17);
  }
  if (o.harness) {
    const st = stdMat(0x1f2420, { rough: 0.8 });
    for (const sx of [-1, 1]) {
      add(torso, boxG(0.05, 0.5, 0.015), st, sx * 0.1, 0.25, 0.125, 0, 0, sx * 0.06, false);
      add(torso, boxG(0.05, 0.5, 0.015), st, sx * 0.1, 0.25, -0.125, 0, 0, -sx * 0.06, false);
    }
  }
  if (o.roleColor !== undefined) {
    add(torso, boxG(0.15, 0.11, 0.015), stdMat(o.roleColor, { emissive: o.roleColor, ei: 0.9 }), 0, 0.32, o.vest !== undefined ? -0.16 : -0.125, 0, 0, 0, false);
  }
  return torso;
}

/* --------------------------------- Руки ----------------------------------- */

interface ArmMats {
  shirt: THREE.Material;
  skin: THREE.Material;
  hand: THREE.Material;
  cuff: THREE.Material | null;
  ink: THREE.Material;
}

function buildArm(body: THREE.Group, x: number, rx: number, rz: number, frx: number, o: HumanoidOpts, m: ArmMats, thick: number, side: number) {
  const arm = new THREE.Group();
  arm.position.set(x, SHOULDER_Y, 0);
  arm.rotation.set(rx, 0, rz);
  const sleeves = o.sleeves ?? 'long';
  const t = thick;
  const upperH = UPPER_ARM + 0.02;
  if (sleeves === 'long') add(arm, boxG(0.12 * t, upperH, 0.13 * t), m.shirt, 0, 0.01 - upperH / 2, 0);
  else if (sleeves === 'short') {
    add(arm, boxG(0.13 * t, 0.15, 0.14 * t), m.shirt, 0, -0.07, 0);
    const skinH = UPPER_ARM + 0.01 - 0.135;
    add(arm, boxG(0.105 * t, skinH, 0.115 * t), m.skin, 0, -0.135 - skinH / 2, 0);
  } else add(arm, boxG(0.11 * t, upperH, 0.12 * t), m.skin, 0, 0.01 - upperH / 2, 0);
  if (o.roleColor !== undefined) add(arm, boxG(0.14 * t, 0.035, 0.15 * t), stdMat(o.roleColor, { emissive: o.roleColor, ei: 0.5 }), 0, 0.01, 0, 0, 0, 0, false);

  const fore = new THREE.Group();
  fore.position.set(0, -UPPER_ARM, 0);
  fore.rotation.x = frx;
  arm.add(fore);
  // Предплечье до запястья, кисть — в точке FOREARM (туда целится IK)
  const foreH = FOREARM - 0.035;
  if (sleeves === 'long') {
    add(fore, boxG(0.105 * t, foreH, 0.115 * t), m.shirt, 0, 0.01 - foreH / 2, 0);
    if (m.cuff) add(fore, boxG(0.112 * t, 0.03, 0.122 * t), m.cuff, 0, -(FOREARM - 0.055), 0, 0, 0, 0, false);
  } else {
    add(fore, boxG(0.095 * t, foreH, 0.105 * t), m.skin, 0, 0.01 - foreH / 2, 0);
    if (o.tattoos) {
      add(fore, boxG(0.012, 0.2, 0.06), m.ink, side * 0.049 * t, -FOREARM * 0.42, 0, 0, 0, 0, false);
      add(fore, boxG(0.05, 0.07, 0.012), m.ink, 0, -FOREARM * 0.28, 0.054 * t, 0, 0, 0, false);
    }
  }
  add(fore, boxG(0.1, 0.09, 0.11), m.hand, 0, -FOREARM, 0);
  body.add(arm);
  return { arm, fore };
}

/* ------------------------------ Аксессуары -------------------------------- */

function buildBeltProp(body: THREE.Group, prop: BeltProp): THREE.Object3D | null {
  if (prop === 'none') return null;
  const g = new THREE.Group();
  const dark = stdMat(0x1f2937, { rough: 0.6 });
  switch (prop) {
    case 'tablet': {
      add(g, boxG(0.02, 0.2, 0.15), dark, 0, 0, 0);
      const scr = new THREE.Mesh(
        cachedGeo('tabScr', () => new THREE.PlaneGeometry(0.13, 0.17)),
        shared('screenBlue', () => new THREE.MeshBasicMaterial({ map: screenTexture('#38bdf8') })),
      );
      scr.rotation.y = -Math.PI / 2;
      scr.position.x = -0.012;
      g.add(scr);
      g.position.set(-0.25, 0.98, 0.03);
      break;
    }
    case 'defuse':
      add(g, boxG(0.13, 0.08, 0.06), stdMat(0xfacc15, { rough: 0.5 }), 0, 0, 0);
      add(g, boxG(0.135, 0.02, 0.062), stdMat(0x111111), 0, 0, 0, 0, 0, 0, false);
      add(g, sphG(0.012, 6, 4), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), 0.04, 0.04, 0.03, 0, 0, 0, false);
      g.position.set(0.22, 0.98, 0.11);
      break;
    case 'smoke':
      for (const [px, pz] of [[0, 0], [0.07, -0.06]] as [number, number][]) {
        add(g, cylG(0.035, 0.035, 0.13, 10), stdMat(0x9ca3af, { metal: 0.4 }), px, 0, pz);
        add(g, cylG(0.036, 0.036, 0.025, 10), stdMat(0xe5e7eb), px, 0.07, pz, 0, 0, 0, false);
      }
      g.position.set(0.22, 1.0, 0.1);
      break;
    case 'flashes':
      for (const px of [-0.1, 0, 0.1]) {
        add(g, cylG(0.03, 0.03, 0.11, 8), stdMat(0xd1d5db, { metal: 0.5 }), px, 0, 0);
        add(g, cylG(0.031, 0.031, 0.02, 8), stdMat(0xffffff, { emissive: 0xffffff, ei: 1 }), px, 0.04, 0, 0, 0, 0, false);
      }
      g.position.set(0, 1.0, 0.14);
      break;
    case 'knife':
      add(g, boxG(0.04, 0.22, 0.03), dark, 0, 0, 0);
      add(g, boxG(0.035, 0.08, 0.035), stdMat(0x111111), 0, 0.14, 0, 0, 0, 0, false);
      g.position.set(0.22, 0.78, 0.04);
      break;
  }
  body.add(g);
  return g;
}

/* ------------------------------- Сборка ----------------------------------- */

export function buildHumanoid(o: HumanoidOpts): Humanoid {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(o.scale ?? 1);
  // Наклон тела задаётся в его собственной системе координат (после поворота по Y)
  body.rotation.order = 'YXZ';

  const girth = o.girth ?? 1;
  const skin = stdMat(o.skin, { rough: 0.75 });
  const shirt = o.shirtMap ? texturedMat(o.shirtMap, o.shirt) : stdMat(o.shirt, { rough: 0.85 });
  const pants = o.pantsMap ? texturedMat(o.pantsMap, o.pants) : stdMat(o.pants, { rough: 0.9 });
  const boots = stdMat(o.boots ?? 0x1c1917, { rough: 0.6 });
  const dark = stdMat(0x18181b, { rough: 0.7 });

  // Ноги
  const legW = girth > 1.05 ? 1 + (girth - 1) * 0.5 : 1;
  const mkLeg = (x: number) => {
    const leg = new THREE.Group();
    leg.position.set(x * Math.max(1, legW), 0.92, 0);
    add(leg, boxG(0.165 * legW, 0.47, 0.19 * legW), pants, 0, -0.23, 0);
    add(leg, boxG(0.15 * legW, 0.42, 0.17 * legW), pants, 0, -0.64, 0.01);
    add(leg, boxG(0.17, 0.13, 0.28), boots, 0, -0.86, 0.04);
    if (o.kneePads) add(leg, boxG(0.16, 0.13, 0.07), dark, 0, -0.46, 0.1);
    body.add(leg);
    return leg;
  };
  const legL = mkLeg(-0.115);
  const legR = mkLeg(0.115);
  add(body, boxG(0.38 * legW, 0.17, 0.24), pants, 0, 0.96, 0);
  add(body, boxG(0.4 * legW, 0.05, 0.26), dark, 0, 1.04, 0);

  const torso = buildTorso(body, o, shirt);
  add(body, cylG(0.055, 0.065, 0.1, 10), skin, 0, 1.58, 0);
  const head = buildHead(body, o);

  // Руки: плечи раздвигаются у крупных бойцов
  const shoulderX = SHOULDER_X * (girth > 1 ? 1 + (girth - 1) * 0.55 : 1);
  const thick = girth > 1.05 ? 1 + (girth - 1) * 0.8 : 1;
  const mats: ArmMats = {
    shirt,
    skin,
    hand: o.gloves ? stdMat(0x27272a, { rough: 0.6 }) : skin,
    cuff: o.stripe !== undefined ? stdMat(o.stripe, { rough: 0.7 }) : null,
    ink: stdMat(0x1e293b, { rough: 0.9 }),
  };
  // rz < 0 у правой и rz > 0 у левой руки сводят кисти к оружию по центру
  const r = buildArm(body, shoulderX, -0.45, -0.15, -1.05, o, mats, thick, 1);
  const l = buildArm(body, -shoulderX, -0.95, 0.42, -0.6, o, mats, thick, -1);
  // Указательный палец правой руки — для жестов, в обычной стойке скрыт
  const fingerR = add(r.fore, boxG(0.032, 0.11, 0.035), mats.hand, 0.02, -(FOREARM + 0.09), 0.02, 0, 0, 0, false);
  fingerR.visible = false;

  const beltProp = buildBeltProp(body, o.prop ?? 'none');

  const weaponMount = new THREE.Group();
  weaponMount.position.set(0.05, 1.27, 0.2);
  body.add(weaponMount);

  // Габариты торса для размещения оружия (у плеча и за спиной); глубина торса масштабируется как в buildTorso
  const depth = 0.9 + girth * 0.1;
  const front = o.vest !== undefined ? (o.bulky ? 0.18 : 0.15) : o.harness ? 0.133 : 0.125;
  const back = o.vest !== undefined ? (o.bulky ? 0.18 : 0.168) : 0.133;
  const torsoHalfW = (o.vest !== undefined ? (o.bulky ? 0.27 : 0.23) : 0.213) * girth;
  let chestZ = front * depth;
  if (o.belly) {
    // Живот (эллипсоид из buildTorso): его передняя поверхность там, где упирается низ приклада (x≈0.14, y≈1.3)
    const rx = 0.21 * girth;
    const ry = 0.17;
    const rz = 0.15 * depth;
    const k = 1 - (0.14 / rx) ** 2 - ((1.3 - 1.2) / ry) ** 2;
    if (k > 0) chestZ = Math.max(chestZ, 0.08 * depth + rz * Math.sqrt(k));
  }
  return {
    root, body, legL, legR, armL: l.arm, armR: r.arm, foreL: l.fore, foreR: r.fore, fingerR, torso, head, weaponMount, shoulderX, beltProp,
    chestZ, backZ: -back * depth, torsoHalfW,
  };
}

/* ------------------------- Предметы для поз ------------------------------- */

export type ItemKind =
  | 'binoculars'
  | 'tablet'
  | 'radio'
  | 'trophy'
  | 'hammer'
  | 'smoke'
  | 'flashbang'
  | 'grenade'
  | 'defuseKit'
  | 'pistol'
  | 'knife'
  | 'crate'
  | 'mic'
  | 'laptop';

/**
 * Предмет строится с точкой хвата в начале координат.
 * «Верх» предмета — +Y, «вперёд» (ствол, лезвие, окуляры) — +Z.
 */
export function buildItem(kind: ItemKind, accent = 0x38bdf8): THREE.Group {
  const g = new THREE.Group();
  const black = stdMat(0x111111, { rough: 0.5 });
  const metal = stdMat(0x9ca3af, { metal: 0.7, rough: 0.3 });
  switch (kind) {
    case 'binoculars':
      for (const sx of [-1, 1]) {
        add(g, cylG(0.038, 0.042, 0.15, 12), black, sx * 0.045, 0, 0.02, Math.PI / 2, 0, 0, false);
        add(g, cylG(0.033, 0.033, 0.005, 12), stdMat(0x60a5fa, { emissive: 0x1d4ed8, ei: 0.6, rough: 0.1 }), sx * 0.045, 0, 0.097, Math.PI / 2, 0, 0, false);
      }
      add(g, boxG(0.05, 0.03, 0.06), black, 0, 0.01, 0.02, 0, 0, 0, false);
      break;
    case 'tablet': {
      add(g, boxG(0.28, 0.016, 0.2), stdMat(0x1f2937, { rough: 0.4 }), 0, 0, 0, 0, 0, 0, false);
      const scr = new THREE.Mesh(cachedGeo('tabScrBig', () => new THREE.PlaneGeometry(0.25, 0.17)), shared('screenBlue', () => new THREE.MeshBasicMaterial({ map: screenTexture('#38bdf8') })));
      scr.rotation.x = -Math.PI / 2;
      scr.position.y = 0.009;
      g.add(scr);
      break;
    }
    case 'laptop': {
      add(g, boxG(0.3, 0.016, 0.21), stdMat(0x27272a, { rough: 0.4 }), 0, 0, 0, 0, 0, 0, false);
      const lid = new THREE.Group();
      lid.position.set(0, 0, -0.1);
      lid.rotation.x = -1.15;
      add(lid, boxG(0.3, 0.012, 0.21), stdMat(0x27272a, { rough: 0.4 }), 0, 0, 0.105, 0, 0, 0, false);
      const scr = new THREE.Mesh(cachedGeo('lapScr', () => new THREE.PlaneGeometry(0.27, 0.18)), shared('screenGreen', () => new THREE.MeshBasicMaterial({ map: screenTexture('#4ade80') })));
      scr.rotation.x = -Math.PI / 2;
      scr.position.set(0, 0.008, 0.105);
      lid.add(scr);
      g.add(lid);
      break;
    }
    case 'radio':
      add(g, boxG(0.065, 0.14, 0.04), black, 0, 0.04, 0, 0, 0, 0, false);
      add(g, cylG(0.008, 0.008, 0.11, 6), black, 0.02, 0.16, 0, 0, 0, 0, false);
      add(g, sphG(0.01, 6, 4), stdMat(0x22c55e, { emissive: 0x22c55e, ei: 2 }), -0.018, 0.1, 0.021, 0, 0, 0, false);
      break;
    case 'trophy': {
      const gold = stdMat(0xd4a017, { metal: 0.9, rough: 0.25, emissive: 0x6b4f05, ei: 0.4 });
      add(g, boxG(0.12, 0.04, 0.12), stdMat(0x3f2a14, { rough: 0.6 }), 0, -0.08, 0, 0, 0, 0, false);
      add(g, cylG(0.016, 0.028, 0.08, 10), gold, 0, -0.02, 0, 0, 0, 0, false);
      add(g, cylG(0.08, 0.035, 0.12, 16), gold, 0, 0.08, 0, 0, 0, 0, false);
      for (const sx of [-1, 1]) add(g, torusG(0.035, 0.008, Math.PI), gold, sx * 0.08, 0.09, 0, 0, 0, sx * -Math.PI / 2, false);
      break;
    }
    case 'hammer':
      add(g, cylG(0.02, 0.022, 0.8, 8), stdMat(0x7a4a24, { rough: 0.8 }), 0, 0.28, 0, 0, 0, 0, false);
      add(g, boxG(0.12, 0.11, 0.28), stdMat(0x52525b, { metal: 0.8, rough: 0.35 }), 0, 0.7, 0);
      break;
    case 'smoke':
      add(g, cylG(0.04, 0.04, 0.14, 10), stdMat(accent, { metal: 0.3, rough: 0.5 }), 0, 0.03, 0, 0, 0, 0, false);
      add(g, cylG(0.041, 0.041, 0.03, 10), stdMat(0xe5e7eb), 0, 0.11, 0, 0, 0, 0, false);
      break;
    case 'flashbang':
      add(g, cylG(0.036, 0.036, 0.13, 10), metal, 0, 0.03, 0, 0, 0, 0, false);
      add(g, cylG(0.038, 0.038, 0.04, 10), stdMat(0xffffff, { emissive: 0xffffff, ei: 2.5 }), 0, 0.06, 0, 0, 0, 0, false);
      break;
    case 'grenade':
      add(g, sphG(0.055, 10, 8), stdMat(0x3f6212, { rough: 0.6 }), 0, 0.03, 0, 0, 0, 0, false);
      add(g, boxG(0.02, 0.05, 0.06), metal, 0, 0.085, 0.01, 0, 0, 0, false);
      break;
    case 'defuseKit':
      add(g, boxG(0.32, 0.12, 0.22), stdMat(0x4d5a2e, { rough: 0.7 }), 0, 0.06, 0);
      add(g, boxG(0.16, 0.06, 0.1), stdMat(0xd6c38a, { rough: 0.7 }), 0.04, 0.15, 0, 0, 0, 0, false);
      add(g, sphG(0.014, 6, 4), stdMat(0xef4444, { emissive: 0xef4444, ei: 3 }), 0.09, 0.19, 0.03, 0, 0, 0, false);
      for (const [c, z] of [[0xef4444, -0.04], [0x3b82f6, 0], [0xfacc15, 0.04]] as [number, number][]) {
        add(g, cylG(0.006, 0.006, 0.2, 5), stdMat(c), -0.06, 0.13, z, 0, 0, Math.PI / 2 - 0.3, false);
      }
      break;
    case 'pistol': {
      const p = buildWeapon('pistol', 0, accent).group;
      g.add(p);
      break;
    }
    case 'knife':
      add(g, boxG(0.03, 0.035, 0.11), black, 0, 0, -0.02, 0, 0, 0, false);
      add(g, boxG(0.012, 0.035, 0.2), stdMat(0xe5e7eb, { metal: 0.95, rough: 0.15 }), 0, 0.005, 0.13, 0, 0, 0, false);
      break;
    case 'crate': {
      const b = new THREE.Mesh(
        cachedGeo('coverCrate', () => new THREE.BoxGeometry(0.5, 1.25, 0.9)),
        shared('coverCrateMat', () => new THREE.MeshStandardMaterial({ map: getTexture('crate'), roughness: 0.85 })),
      );
      b.castShadow = true;
      b.receiveShadow = true;
      g.add(b);
      break;
    }
    case 'mic':
      add(g, cylG(0.018, 0.014, 0.15, 8), black, 0, 0.02, 0, 0, 0, 0, false);
      add(g, sphG(0.038, 10, 8), stdMat(0x52525b, { metal: 0.6, rough: 0.4 }), 0, 0.12, 0, 0, 0, 0, false);
      break;
  }
  return g;
}
