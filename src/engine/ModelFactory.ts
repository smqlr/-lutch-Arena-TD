import * as THREE from 'three';
import type { WeaponKind } from '../types/game';
import { glowTexture, textTexture } from './Textures';

/**
 * Процедурные 3D-модели: общие кеши геометрий и материалов, многосоставное оружие,
 * HP-бары, гранаты, ядро плента, ворота спавна и пады позиций.
 * Гуманоиды — в Humanoid.ts, модели бойцов и врагов — в Characters.ts.
 * Геометрии и материалы кешируются и переиспользуются между экземплярами.
 */

/* ------------------------------ Кеши ресурсов ------------------------------ */

const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const boxG = (w: number, h: number, d: number) => cachedGeo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cylG = (rt: number, rb: number, h: number, seg = 12) =>
  cachedGeo(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
export const sphG = (r: number, ws = 14, hs = 10) => cachedGeo(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
export const domeG = (r: number) => cachedGeo(`d${r}`, () => new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
export const torusG = (r: number, t: number, arc = Math.PI * 2) =>
  cachedGeo(`t${r}|${t}|${arc}`, () => new THREE.TorusGeometry(r, t, 8, 24, arc));

interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  ei?: number;
  opacity?: number;
  flat?: boolean;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function stdMat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.7}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.ei ?? 0}|${o.opacity ?? 1}|${o.flat ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.7,
      metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 0,
      flatShading: !!o.flat,
    });
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true;
      m.opacity = o.opacity;
      m.depthWrite = false;
    }
    matCache.set(key, m);
  }
  return m;
}

const sharedMisc = new Map<string, THREE.Material>();
export function shared<T extends THREE.Material>(key: string, make: () => T): T {
  let m = sharedMisc.get(key) as T | undefined;
  if (!m) {
    m = make();
    sharedMisc.set(key, m);
  }
  return m;
}

export function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

function darken(color: number, k: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0x000000), k).getHex();
}

function lighten(color: number, k: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), k).getHex();
}

/* -------------------------------- Оружие ---------------------------------- */

interface WeaponMats {
  body: THREE.Material;
  dark: THREE.Material;
  furn: THREE.Material;
  metal: THREE.Material;
  glass: THREE.Material;
  glow: THREE.Material;
}

function weaponMats(kind: WeaponKind, tier: number, accent: number): WeaponMats {
  const sniperFamily = kind === 'sniper' || kind === 'scout';
  const glass = stdMat(0x7dd3fc, { rough: 0.05, metal: 0.3, emissive: 0x0369a1, ei: 0.8 });
  const glow = stdMat(accent, { emissive: accent, ei: 1.6, rough: 0.3 });
  if (tier >= 2) {
    return {
      body: stdMat(darken(accent, 0.35), { rough: 0.3, metal: 0.55, emissive: accent, ei: 0.12 }),
      dark: stdMat(0x111215, { rough: 0.5, metal: 0.3 }),
      furn: stdMat(0xc9a227, { rough: 0.28, metal: 0.9 }),
      metal: stdMat(0xd4af37, { rough: 0.25, metal: 0.95 }),
      glass,
      glow,
    };
  }
  if (tier === 1) {
    return {
      body: stdMat(sniperFamily ? 0x4d5e3a : 0x3a3f47, { rough: 0.5, metal: 0.4 }),
      dark: stdMat(0x1d1f23, { rough: 0.65 }),
      furn: stdMat(0xa38b5d, { rough: 0.7 }),
      metal: stdMat(0x6b7280, { rough: 0.35, metal: 0.85 }),
      glass,
      glow,
    };
  }
  return {
    body: stdMat(sniperFamily ? 0x56693f : 0x2b2e34, { rough: 0.45, metal: 0.5 }),
    dark: stdMat(0x18191c, { rough: 0.7 }),
    furn: stdMat(0x7a4520, { rough: 0.78 }),
    metal: stdMat(0x5b616b, { rough: 0.35, metal: 0.85 }),
    glass,
    glow,
  };
}

/**
 * Как держать оружие. Точки в локальных координатах модели оружия до масштаба: [y, z]
 * (ствол смотрит в +Z, верх — +Y, ось симметрии x = 0).
 */
export interface WeaponHold {
  /** Центр затыльника приклада (null — пистолет, держится на вытянутых руках) */
  butt: [number, number] | null;
  /** Пистолетная рукоять — сюда ложится правая кисть */
  grip: [number, number];
  /** Точки для второй руки от самой дальней к ближней (цевьё → шахта магазина) */
  support: [number, number][];
  /** Разворот корпуса вполоборота в боевой стойке, рад */
  blade: number;
}

export const WEAPON_HOLD: Record<WeaponKind, WeaponHold> = {
  pistol: { butt: null, grip: [-0.06, -0.05], support: [[-0.075, -0.03]], blade: 0.2 },
  deagle: { butt: null, grip: [-0.07, -0.06], support: [[-0.085, -0.04]], blade: 0.2 },
  smg: { butt: [-0.02, -0.225], grip: [-0.09, -0.06], support: [[-0.1, 0.12], [-0.1, 0.08], [-0.095, 0.02]], blade: 0.6 },
  shotgun: { butt: [-0.047, -0.44], grip: [-0.075, -0.17], support: [[-0.06, 0.22], [-0.06, 0.14], [-0.065, 0.06]], blade: 0.6 },
  rifle: { butt: [-0.04, -0.435], grip: [-0.1, -0.085], support: [[-0.08, 0.3], [-0.08, 0.22], [-0.06, 0.025]], blade: 0.6 },
  carbine: { butt: [-0.015, -0.395], grip: [-0.1, -0.09], support: [[-0.07, 0.34], [-0.07, 0.24], [-0.07, 0.17], [-0.06, 0.015]], blade: 0.6 },
  lmg: { butt: [-0.03, -0.43], grip: [-0.095, -0.12], support: [[-0.05, 0.36], [-0.05, 0.28], [-0.05, 0.2]], blade: 0.6 },
  scout: { butt: [-0.02, -0.48], grip: [-0.06, -0.19], support: [[-0.06, 0.2], [-0.065, 0.13]], blade: 0.6 },
  sniper: { butt: [-0.025, -0.595], grip: [-0.015, -0.3], support: [[-0.1, 0.2], [-0.1, 0.15]], blade: 0.6 },
  autoSniper: { butt: [-0.01, -0.51], grip: [-0.1, -0.13], support: [[-0.06, 0.32], [-0.1, 0.19], [-0.1, 0.15]], blade: 0.6 },
};

/** Масштаб моделей оружия: крупнее реального ради читаемости сверху, но так, чтобы руки дотягивались */
export const WEAPON_SCALE = 1.15;

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  kind: WeaponKind;
  hold: WeaponHold;
  scale: number;
  /** Габариты модели в локальных координатах до масштаба */
  bounds: THREE.Box3;
}

function scope(g: THREE.Group, m: WeaponMats, y: number, z: number, len: number, r: number): void {
  add(g, cylG(r, r, len, 14), m.dark, 0, y, z, Math.PI / 2, 0, 0, false);
  add(g, cylG(r * 1.35, r, len * 0.22, 14), m.dark, 0, y, z + len * 0.55, Math.PI / 2, 0, 0, false);
  add(g, cylG(r, r * 1.2, len * 0.18, 14), m.dark, 0, y, z - len * 0.52, Math.PI / 2, 0, 0, false);
  add(g, cylG(r * 1.25, r * 1.25, 0.006, 14), m.glass, 0, y, z + len * 0.66, Math.PI / 2, 0, 0, false);
  add(g, cylG(r * 0.45, r * 0.45, 0.05, 8), m.metal, 0, y + r * 1.1, z, 0, 0, 0, false);
  add(g, cylG(r * 0.45, r * 0.45, 0.05, 8), m.metal, r * 1.1, y, z, 0, 0, Math.PI / 2, false);
  add(g, boxG(0.025, y - 0.02, 0.03), m.metal, 0, (y - 0.02) / 2 + 0.01, z + len * 0.25, 0, 0, 0, false);
  add(g, boxG(0.025, y - 0.02, 0.03), m.metal, 0, (y - 0.02) / 2 + 0.01, z - len * 0.25, 0, 0, 0, false);
}

export function buildWeapon(kind: WeaponKind, tier: number, accent: number): WeaponModel {
  const g = new THREE.Group();
  const m = weaponMats(kind, tier, accent);
  let muzzleZ = 0.6;
  let topY = 0.05;
  switch (kind) {
    case 'pistol': {
      add(g, boxG(0.04, 0.05, 0.2), m.body, 0, 0.03, 0.02, 0, 0, 0, false);
      add(g, boxG(0.036, 0.035, 0.15), m.dark, 0, -0.005, 0.01, 0, 0, 0, false);
      add(g, boxG(0.036, 0.11, 0.05), m.furn, 0, -0.06, -0.05, 0.3, 0, 0, false);
      muzzleZ = 0.13;
      topY = 0.06;
      break;
    }
    case 'deagle': {
      add(g, boxG(0.05, 0.065, 0.28), m.body, 0, 0.035, 0.04, 0, 0, 0, false);
      add(g, boxG(0.02, 0.015, 0.26), m.metal, 0, 0.075, 0.04, 0, 0, 0, false);
      add(g, boxG(0.042, 0.04, 0.18), m.dark, 0, -0.01, 0.02, 0, 0, 0, false);
      add(g, boxG(0.045, 0.13, 0.06), m.furn, 0, -0.07, -0.06, 0.28, 0, 0, false);
      muzzleZ = 0.19;
      topY = 0.08;
      break;
    }
    case 'smg': {
      add(g, boxG(0.075, 0.11, 0.44), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.065, 0.028, 0.32), stdMat(0xf59e0b, { rough: 0.2, opacity: 0.75, emissive: 0x92400e, ei: 0.4 }), 0, 0.068, 0.02, 0, 0, 0, false);
      add(g, boxG(0.06, 0.07, 0.07), m.dark, 0, -0.08, 0.1, 0.2, 0, 0, false);
      add(g, boxG(0.075, 0.06, 0.06), m.dark, 0, -0.06, -0.17, 0, 0, 0, false);
      add(g, cylG(0.014, 0.014, 0.1, 8), m.metal, 0, 0.0, 0.27, Math.PI / 2, 0, 0, false);
      muzzleZ = 0.32;
      topY = 0.09;
      break;
    }
    case 'shotgun': {
      add(g, cylG(0.02, 0.02, 0.58, 10), m.metal, 0, 0.035, 0.22, Math.PI / 2, 0, 0, false);
      add(g, cylG(0.018, 0.018, 0.46, 10), m.dark, 0, -0.005, 0.18, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.055, 0.085, 0.22), m.body, 0, 0.01, -0.06, 0, 0, 0, false);
      add(g, boxG(0.065, 0.055, 0.16), m.furn, 0, -0.005, 0.2, 0, 0, 0, false);
      add(g, boxG(0.045, 0.1, 0.28), m.furn, 0, -0.03, -0.3, 0.12, 0, 0, false);
      muzzleZ = 0.52;
      topY = 0.07;
      break;
    }
    case 'rifle': {
      add(g, boxG(0.055, 0.085, 0.34), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, cylG(0.028, 0.028, 0.32, 10), m.body, 0, 0.035, 0, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.048, 0.095, 0.27), m.furn, 0, -0.02, -0.3, 0.12, 0, 0, false);
      add(g, boxG(0.06, 0.065, 0.19), m.furn, 0, -0.005, 0.26, 0, 0, 0, false);
      add(g, boxG(0.03, 0.03, 0.19), m.metal, 0, 0.055, 0.26, 0, 0, 0, false);
      add(g, cylG(0.013, 0.013, 0.22, 8), m.metal, 0, 0.005, 0.46, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.012, 0.045, 0.012), m.metal, 0, 0.04, 0.53, 0, 0, 0, false);
      add(g, cylG(0.019, 0.019, 0.05, 8), m.dark, 0, 0.005, 0.58, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.042, 0.075, 0.065), m.dark, 0, -0.075, 0.08, 0.15, 0, 0, false);
      add(g, boxG(0.042, 0.075, 0.065), m.dark, 0, -0.135, 0.105, 0.38, 0, 0, false);
      add(g, boxG(0.042, 0.07, 0.065), m.dark, 0, -0.19, 0.145, 0.6, 0, 0, false);
      add(g, boxG(0.038, 0.095, 0.045), m.dark, 0, -0.075, -0.075, 0.3, 0, 0, false);
      muzzleZ = 0.61;
      topY = 0.06;
      break;
    }
    case 'carbine': {
      add(g, boxG(0.055, 0.08, 0.3), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.032, 0.016, 0.34), m.dark, 0, 0.048, 0.04, 0, 0, 0, false);
      add(g, boxG(0.062, 0.062, 0.23), m.body, 0, 0.005, 0.26, 0, 0, 0, false);
      add(g, cylG(0.024, 0.024, 0.3, 12), m.dark, 0, 0.005, 0.52, Math.PI / 2, 0, 0, false);
      add(g, cylG(0.016, 0.016, 0.2, 8), m.dark, 0, 0.01, -0.24, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.05, 0.11, 0.09), m.furn, 0, -0.015, -0.35, 0, 0, 0, false);
      add(g, boxG(0.04, 0.14, 0.06), m.dark, 0, -0.11, 0.07, 0.12, 0, 0, false);
      add(g, boxG(0.036, 0.09, 0.045), m.dark, 0, -0.075, -0.08, 0.3, 0, 0, false);
      add(g, boxG(0.035, 0.045, 0.07), m.dark, 0, 0.078, 0.0, 0, 0, 0, false);
      add(g, boxG(0.03, 0.03, 0.006), m.glass, 0, 0.08, 0.037, 0, 0, 0, false);
      muzzleZ = 0.68;
      topY = 0.1;
      break;
    }
    case 'lmg': {
      add(g, boxG(0.08, 0.1, 0.4), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.085, 0.03, 0.3), m.dark, 0, 0.065, 0.02, 0, 0, 0, false);
      add(g, boxG(0.11, 0.13, 0.13), m.furn, 0.03, -0.11, 0.04, 0, 0, 0, false);
      add(g, cylG(0.028, 0.028, 0.36, 12), m.dark, 0, 0.01, 0.36, Math.PI / 2, 0, 0, false);
      add(g, cylG(0.013, 0.013, 0.16, 8), m.metal, 0, 0.01, 0.6, Math.PI / 2, 0, 0, false);
      add(g, cylG(0.006, 0.006, 0.22, 6), m.metal, 0.04, -0.07, 0.45, 0.5, 0, 0.2, false);
      add(g, cylG(0.006, 0.006, 0.22, 6), m.metal, -0.04, -0.07, 0.45, 0.5, 0, -0.2, false);
      add(g, boxG(0.055, 0.11, 0.24), m.body, 0, -0.02, -0.31, 0.08, 0, 0, false);
      add(g, boxG(0.02, 0.05, 0.12), m.metal, 0, 0.1, 0.1, 0, 0, 0, false);
      muzzleZ = 0.69;
      topY = 0.08;
      break;
    }
    case 'scout': {
      add(g, boxG(0.045, 0.065, 0.32), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.04, 0.03, 0.3), m.body, 0, 0.015, -0.31, 0, 0, 0, false);
      add(g, boxG(0.045, 0.04, 0.26), m.body, 0, -0.06, -0.31, 0, 0, 0, false);
      add(g, boxG(0.05, 0.13, 0.04), m.dark, 0, -0.02, -0.46, 0, 0, 0, false);
      add(g, cylG(0.012, 0.012, 0.52, 8), m.metal, 0, 0.012, 0.42, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.04, 0.05, 0.05), m.dark, 0, -0.06, 0.05, 0, 0, 0, false);
      scope(g, m, 0.075, 0.02, 0.24, 0.022);
      muzzleZ = 0.69;
      topY = 0.1;
      break;
    }
    case 'sniper': {
      add(g, boxG(0.07, 0.1, 0.5), m.body, 0, 0, 0, 0, 0, 0, false);
      // стойка «thumbhole»
      add(g, boxG(0.055, 0.035, 0.3), m.body, 0, 0.035, -0.39, 0, 0, 0, false);
      add(g, boxG(0.065, 0.045, 0.32), m.body, 0, -0.085, -0.39, 0, 0, 0, false);
      add(g, boxG(0.065, 0.16, 0.05), m.body, 0, -0.025, -0.55, 0, 0, 0, false);
      add(g, boxG(0.068, 0.17, 0.02), m.dark, 0, -0.025, -0.585, 0, 0, 0, false);
      add(g, cylG(0.017, 0.019, 0.62, 10), m.metal, 0, 0.02, 0.56, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.05, 0.04, 0.08), m.dark, 0, 0.02, 0.9, 0, 0, 0, false);
      add(g, boxG(0.055, 0.065, 0.09), m.dark, 0, -0.075, 0.06, 0, 0, 0, false);
      add(g, cylG(0.008, 0.008, 0.07, 6), m.metal, 0.06, 0.03, -0.13, 0, 0, Math.PI / 2, false);
      add(g, sphG(0.016, 8, 6), m.metal, 0.095, 0.03, -0.13, 0, 0, 0, false);
      add(g, cylG(0.006, 0.006, 0.24, 6), m.metal, 0.02, -0.03, 0.42, Math.PI / 2 - 0.1, 0, 0, false);
      add(g, cylG(0.006, 0.006, 0.24, 6), m.metal, -0.02, -0.03, 0.42, Math.PI / 2 - 0.1, 0, 0, false);
      scope(g, m, 0.105, 0.02, 0.34, 0.032);
      muzzleZ = 0.95;
      topY = 0.15;
      break;
    }
    case 'autoSniper': {
      add(g, boxG(0.07, 0.11, 0.46), m.body, 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.06, 0.12, 0.3), m.dark, 0, -0.01, -0.36, 0.05, 0, 0, false);
      add(g, cylG(0.03, 0.03, 0.34, 12), m.dark, 0, 0.015, 0.4, Math.PI / 2, 0, 0, false);
      add(g, cylG(0.015, 0.015, 0.2, 8), m.metal, 0, 0.015, 0.66, Math.PI / 2, 0, 0, false);
      add(g, boxG(0.05, 0.12, 0.09), m.dark, 0, -0.11, 0.06, 0.15, 0, 0, false);
      add(g, boxG(0.04, 0.09, 0.045), m.dark, 0, -0.08, -0.12, 0.3, 0, 0, false);
      scope(g, m, 0.105, 0.0, 0.3, 0.03);
      muzzleZ = 0.78;
      topY = 0.15;
      break;
    }
  }

  const rifleLike = kind !== 'sniper' && kind !== 'scout' && kind !== 'autoSniper';
  if (tier >= 1 && rifleLike) {
    // T2: коллиматор и ЛЦУ
    add(g, boxG(0.035, 0.04, 0.06), m.dark, 0, topY + 0.015, 0.02, 0, 0, 0, false);
    add(g, boxG(0.028, 0.028, 0.004), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), 0, topY + 0.02, 0.052, 0, 0, 0, false);
    add(g, boxG(0.025, 0.025, 0.06), m.dark, 0.04, 0, muzzleZ * 0.55, 0, 0, 0, false);
    add(g, sphG(0.008, 6, 4), stdMat(0xff2d2d, { emissive: 0xff2d2d, ei: 3 }), 0.04, 0, muzzleZ * 0.55 + 0.032, 0, 0, 0, false);
  }
  if (tier >= 2) {
    // T3: светящиеся полосы скина
    add(g, boxG(0.004, 0.012, muzzleZ * 0.7), m.glow, 0.042, 0.0, muzzleZ * 0.15, 0, 0, 0, false);
    add(g, boxG(0.004, 0.012, muzzleZ * 0.7), m.glow, -0.042, 0.0, muzzleZ * 0.15, 0, 0, 0, false);
  }

  g.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, muzzleZ);
  g.add(muzzle);
  g.scale.setScalar(WEAPON_SCALE);
  return { group: g, muzzle, kind, hold: WEAPON_HOLD[kind], scale: WEAPON_SCALE, bounds };
}

/* ------------------------------- HP-бар ----------------------------------- */

const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false });
const hpPlane = new THREE.PlaneGeometry(1, 1);

export class HpBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private shield: THREE.Mesh | null = null;
  private width: number;
  private lastHp = -1;
  private lastShield = -1;

  constructor(width: number, height: number, withShield: boolean) {
    this.width = width;
    const bg = new THREE.Mesh(hpPlane, hpBgMat);
    bg.scale.set(width + 0.06, 0.14, 1);
    bg.renderOrder = 20;
    this.group.add(bg);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false, depthWrite: false, transparent: true });
    this.fill = new THREE.Mesh(hpPlane, this.fillMat);
    this.fill.scale.set(width, 0.09, 1);
    this.fill.renderOrder = 21;
    this.group.add(this.fill);
    if (withShield) {
      const sm = new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false, depthWrite: false, transparent: true });
      this.shield = new THREE.Mesh(hpPlane, sm);
      this.shield.scale.set(width, 0.06, 1);
      this.shield.position.y = 0.11;
      this.shield.renderOrder = 21;
      this.group.add(this.shield);
    }
    this.group.position.y = height;
  }

  set(hpFrac: number, shieldFrac = 0): void {
    hpFrac = Math.max(0, Math.min(1, hpFrac));
    if (Math.abs(hpFrac - this.lastHp) > 0.001) {
      this.lastHp = hpFrac;
      this.fill.scale.x = Math.max(0.0001, this.width * hpFrac);
      this.fill.position.x = -(this.width * (1 - hpFrac)) / 2;
      const c = hpFrac > 0.6 ? 0x22c55e : hpFrac > 0.3 ? 0xf59e0b : 0xef4444;
      this.fillMat.color.setHex(c);
    }
    if (this.shield && Math.abs(shieldFrac - this.lastShield) > 0.001) {
      this.lastShield = shieldFrac;
      this.shield.visible = shieldFrac > 0.001;
      this.shield.scale.x = Math.max(0.0001, this.width * shieldFrac);
      this.shield.position.x = -(this.width * (1 - shieldFrac)) / 2;
    }
  }

  face(camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.fillMat.dispose();
    if (this.shield) (this.shield.material as THREE.Material).dispose();
  }
}

/* ------------------------------ Гранаты ----------------------------------- */

export type ThrowableKind = 'flash' | 'molotov' | 'he' | 'trap';

export function buildThrowable(kind: ThrowableKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'flash':
      add(g, cylG(0.06, 0.06, 0.18, 10), stdMat(0x9ca3af, { metal: 0.6, rough: 0.3 }), 0, 0, 0, 0, 0, 0, false);
      add(g, cylG(0.062, 0.062, 0.04, 10), stdMat(0xffffff, { emissive: 0xffffff, ei: 0.6 }), 0, 0.1, 0, 0, 0, 0, false);
      break;
    case 'molotov':
      add(g, cylG(0.07, 0.08, 0.2, 10), stdMat(0x166534, { rough: 0.1, metal: 0.1, opacity: 0.85 }), 0, 0, 0, 0, 0, 0, false);
      add(g, cylG(0.025, 0.04, 0.1, 8), stdMat(0x166534, { rough: 0.1, opacity: 0.85 }), 0, 0.14, 0, 0, 0, 0, false);
      add(g, sphG(0.04, 8, 6), stdMat(0xff7a1a, { emissive: 0xff5500, ei: 3 }), 0, 0.2, 0, 0, 0, 0, false);
      break;
    case 'he':
      add(g, sphG(0.09, 12, 10), stdMat(0x3f6212, { rough: 0.6 }), 0, 0, 0, 0, 0, 0, false);
      add(g, boxG(0.03, 0.06, 0.1), stdMat(0x9ca3af, { metal: 0.7 }), 0, 0.1, 0.02, 0, 0, 0, false);
      break;
    case 'trap':
      add(g, boxG(0.18, 0.08, 0.18), stdMat(0x1f2937, { metal: 0.5 }), 0, 0, 0, 0, 0, 0, false);
      add(g, sphG(0.035, 8, 6), stdMat(0x38bdf8, { emissive: 0x38bdf8, ei: 3 }), 0, 0.06, 0, 0, 0, 0, false);
      break;
  }
  g.scale.setScalar(1.6);
  return g;
}

/* ---------------------------- Ядро плента --------------------------------- */

export class PlantCore {
  readonly group = new THREE.Group();
  private ringMat: THREE.MeshStandardMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private holo: THREE.Sprite;
  private inner: THREE.Mesh;
  private time = 0;
  private hitT = 0;

  constructor(letter: string, accent: number) {
    const metal = stdMat(0x2a3140, { metal: 0.7, rough: 0.35 });
    add(this.group, cylG(1.9, 2.1, 0.28, 6), metal, 0, 0.14, 0);
    add(this.group, cylG(1.5, 1.6, 0.16, 6), stdMat(0x1a1f2a, { metal: 0.6, rough: 0.4 }), 0, 0.36, 0);
    this.ringMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2, roughness: 0.3 });
    const ring = new THREE.Mesh(torusG(1.55, 0.06), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    this.group.add(ring);
    // пилон
    add(this.group, boxG(0.7, 1.4, 0.7), metal, 0, 1.1, 0);
    add(this.group, boxG(0.74, 0.12, 0.74), stdMat(accent, { emissive: accent, ei: 1.2 }), 0, 1.5, 0, 0, 0, 0, false);
    this.inner = add(this.group, cachedGeo('octaCore', () => new THREE.OctahedronGeometry(0.32)), stdMat(0xffffff, { emissive: accent, ei: 2.5, flat: true }), 0, 2.25, 0, 0, 0, 0, false);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(this.group, boxG(0.12, 0.9, 0.12), metal, Math.cos(a) * 1.25, 0.85, Math.sin(a) * 1.25, 0, -a, 0.18 * (i % 2 ? 1 : -1));
    }
    this.beamMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(cylG(0.5, 1.3, 6, 18), this.beamMat);
    beam.position.y = 3.2;
    this.group.add(beam);
    this.holo = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(letter, '#ffffff'), color: accent, transparent: true, depthWrite: false }));
    this.holo.scale.set(2.4, 1.2, 1);
    this.holo.position.y = 3.3;
    this.group.add(this.holo);
  }

  setHealth(frac: number): void {
    const c = new THREE.Color(0xef4444).lerp(new THREE.Color(0x22c55e), Math.max(0, Math.min(1, frac)));
    this.ringMat.color.copy(c);
    this.ringMat.emissive.copy(c);
  }

  hit(): void {
    this.hitT = 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.hitT = Math.max(0, this.hitT - dt * 2.5);
    this.inner.rotation.y += dt * 1.5;
    this.inner.position.y = 2.25 + Math.sin(this.time * 2) * 0.12;
    this.holo.position.y = 3.3 + Math.sin(this.time * 1.4) * 0.1;
    this.beamMat.opacity = 0.14 + Math.sin(this.time * 3) * 0.04 + this.hitT * 0.4;
    this.ringMat.emissiveIntensity = 1.6 + this.hitT * 4;
  }
}

/* ---------------------------- Ворота спавна ------------------------------- */

export function buildSpawnGate(): { group: THREE.Group; portal: THREE.Mesh } {
  const g = new THREE.Group();
  const metal = stdMat(0x27272a, { metal: 0.7, rough: 0.35 });
  add(g, boxG(0.5, 4, 0.6), metal, -2, 2, 0);
  add(g, boxG(0.5, 4, 0.6), metal, 2, 2, 0);
  add(g, boxG(4.6, 0.5, 0.6), metal, 0, 4.1, 0);
  add(g, boxG(4.4, 0.08, 0.62), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), 0, 3.82, 0, 0, 0, 0, false);
  add(g, boxG(0.08, 3.6, 0.62), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), -1.72, 1.9, 0, 0, 0, 0, false);
  add(g, boxG(0.08, 3.6, 0.62), stdMat(0xef4444, { emissive: 0xef4444, ei: 2 }), 1.72, 1.9, 0, 0, 0, 0, false);
  const portalMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff3344, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const portal = new THREE.Mesh(cachedGeo('portalPlane', () => new THREE.PlaneGeometry(3.4, 3.6)), portalMat);
  portal.position.y = 1.9;
  g.add(portal);
  return { group: g, portal };
}

/* ---------------------- Метка бойца и курсор установки ---------------------- */

const ringGeo = (r0: number, r1: number) => cachedGeo(`ring${r0}|${r1}`, () => new THREE.RingGeometry(r0, r1, 40).rotateX(-Math.PI / 2));
const discGeo = (r: number) => cachedGeo(`disc${r}`, () => new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2));
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });

function decalMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    // Обычное смешивание: на светлом песке аддитивное кольцо выцветает до белого
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

/** Метка под бойцом: тонкое кольцо цвета роли и невидимый хит-бокс для выбора бойца кликом */
export class TowerMarker {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private color: number;
  private state: 'idle' | 'hover' | 'selected' = 'idle';
  private time = Math.random() * 6;

  constructor(color: number) {
    this.color = color;
    this.ringMat = decalMat(color, 0.5);
    const ring = new THREE.Mesh(ringGeo(0.62, 0.72), this.ringMat);
    ring.position.y = 0.03;
    ring.renderOrder = 3;
    this.group.add(ring);
    this.glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Mesh(cachedGeo('markerGlow', () => new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2)), this.glowMat);
    glow.position.y = 0.04;
    glow.renderOrder = 3;
    this.group.add(glow);
    this.hit = new THREE.Mesh(cylG(0.8, 0.8, 2.6, 10), HIT_MAT);
    this.hit.position.y = 1.3;
    this.group.add(this.hit);
  }

  setState(s: TowerMarker['state']): void {
    this.state = s;
  }

  update(dt: number): void {
    this.time += dt;
    const sel = this.state === 'selected';
    const hover = this.state === 'hover';
    const c = sel ? 0xf59e0b : hover ? 0xffffff : this.color;
    this.ringMat.color.setHex(c);
    this.ringMat.opacity = sel ? 0.95 : hover ? 0.85 : 0.6;
    this.glowMat.color.setHex(c);
    this.glowMat.opacity = sel ? 0.34 + Math.sin(this.time * 5) * 0.08 : hover ? 0.24 : 0.07;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ringMat.dispose();
    this.glowMat.dispose();
  }
}

/** Курсор свободной установки: цвет роли на допустимом месте, красный крест — на недопустимом */
export class PlacementCursor {
  readonly group = new THREE.Group();
  private ringMat = decalMat(0x00f0ff, 0.9);
  private discMat = decalMat(0x00f0ff, 0.16);
  private crossMat = decalMat(0xef4444, 0.9);
  private cross = new THREE.Group();
  private time = 0;

  constructor() {
    const ring = new THREE.Mesh(ringGeo(0.7, 0.82), this.ringMat);
    ring.position.y = 0.05;
    ring.renderOrder = 4;
    this.group.add(ring);
    const disc = new THREE.Mesh(discGeo(0.7), this.discMat);
    disc.position.y = 0.045;
    disc.renderOrder = 4;
    this.group.add(disc);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(cachedGeo('cursorBar', () => new THREE.PlaneGeometry(0.16, 1.1).rotateX(-Math.PI / 2)), this.crossMat);
      bar.rotation.y = a;
      bar.position.y = 0.055;
      bar.renderOrder = 4;
      this.cross.add(bar);
    }
    this.group.add(this.cross);
    this.group.visible = false;
  }

  show(pos: THREE.Vector3, ok: boolean, color: number): void {
    this.group.visible = true;
    this.group.position.copy(pos);
    const c = ok ? color : 0xef4444;
    this.ringMat.color.setHex(c);
    this.discMat.color.setHex(c);
    this.cross.visible = !ok;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    const k = 1 + Math.sin(this.time * 6) * 0.05;
    this.group.scale.set(k, 1, k);
    this.discMat.opacity = 0.22 + Math.sin(this.time * 6) * 0.06;
  }
}

export { lighten, darken };
