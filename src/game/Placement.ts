import * as THREE from 'three';
import type { Loc, MapDef } from '../types/game';
import type { BuiltMap } from '../engine/MapBuilder';

/**
 * Свободная установка бойцов: место ищется лучом по поверхностям карты (земля, крыши, ящики,
 * контейнеры, платформы) и проверяется по набору правил — не на маршруте, есть опора под ногами,
 * над головой свободно, не вплотную к другому бойцу, базе или воротам спавна.
 */

export type SpotFail = 'route' | 'taken' | 'surface' | 'bounds' | 'base' | 'blocked';

export interface SpotProbe {
  /** Точка, куда встанет боец (на поверхности) */
  pos: THREE.Vector3;
  ok: boolean;
  reason: SpotFail | null;
  /** Имя ближайшего места арены («Балкон», «Арка»…) */
  name: Loc;
  /** Стоит на возвышенности — действует бонус высоты карты */
  elevated: boolean;
}

/** Горизонтальный зазор от оси маршрута (полуширина дорожки 1.3 + плечи бойца) */
const ROUTE_CLEAR = 2.0;
/** Минимальная дистанция между бойцами (чтобы не задевали друг друга оружием) */
export const TOWER_GAP = 2.0;
/** Радиус «пятна» под ногами, которое должно опираться на ровную поверхность */
const FOOT = 0.42;
const HEADROOM = 2.2;
const BASE_CLEAR = 2.8;
const GATE_CLEAR = 3.4;
/** С этой высоты над землёй действует бонус возвышенности */
export const HIGH_GROUND_Y = 1.0;
const CORNERS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

interface RouteSeg {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
}

export class Placement {
  private readonly map: MapDef;
  private readonly built: BuiltMap;
  private readonly segs: RouteSeg[] = [];
  private readonly gates: THREE.Vector3[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly o = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly halfW: number;
  private readonly halfD: number;

  constructor(map: MapDef, built: BuiltMap) {
    this.map = map;
    this.built = built;
    this.halfW = map.size[0] / 2 - 1;
    this.halfD = map.size[1] / 2 - 1;
    for (const r of map.routes) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i];
        const b = r.points[i + 1];
        this.segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
      }
      const s = r.points[0];
      if (!this.gates.some((g) => g.x === s[0] && g.z === s[2])) this.gates.push(new THREE.Vector3(s[0], s[1], s[2]));
    }
  }

  /** Место под лучом камеры. null — луч ушёл в небо */
  probeRay(raycaster: THREE.Raycaster, towers: Iterable<THREE.Vector3>): SpotProbe | null {
    const hits = raycaster.intersectObjects(this.built.placeMeshes, false);
    if (!hits.length) return null;
    return this.evaluate(hits[0], towers);
  }

  /** Место строго над точкой (x, z): луч сверху вниз от высоты y + 1.5 (для бота и проверок) */
  probeAt(x: number, y: number, z: number, towers: Iterable<THREE.Vector3>): SpotProbe | null {
    this.ray.set(this.o.set(x, y + 1.5, z), this.down);
    this.ray.near = 0;
    this.ray.far = y + 3;
    const hits = this.ray.intersectObjects(this.built.placeMeshes, false);
    if (!hits.length) return null;
    return this.evaluate(hits[0], towers);
  }

  private evaluate(hit: THREE.Intersection, towers: Iterable<THREE.Vector3>): SpotProbe {
    const pos = hit.point.clone();
    pos.y += 0.02;
    const probe: SpotProbe = { pos, ok: false, reason: null, name: this.nameAt(pos), elevated: pos.y >= HIGH_GROUND_Y };
    probe.reason = this.check(hit, pos, towers);
    probe.ok = probe.reason === null;
    return probe;
  }

  private check(hit: THREE.Intersection, pos: THREE.Vector3, towers: Iterable<THREE.Vector3>): SpotFail | null {
    const obj = hit.object as THREE.Mesh;
    if (Math.abs(pos.x) > this.halfW || Math.abs(pos.z) > this.halfD) return 'bounds';
    if (obj.userData.route || this.routeDist(pos) < ROUTE_CLEAR) return 'route';
    const prop = obj.userData.prop as string | undefined;
    if (prop === 'plant' || prop === 'gate') return 'base';
    if (pos.distanceTo(this.built.plantPos) < BASE_CLEAR) return 'base';
    for (const g of this.gates) if (Math.hypot(g.x - pos.x, g.z - pos.z) < GATE_CLEAR) return 'base';
    if ((obj.material as THREE.Material).transparent) return 'surface';
    // Ровная, смотрящая вверх поверхность
    if (!hit.face) return 'surface';
    this.n.copy(hit.face.normal).transformDirection(obj.matrixWorld);
    if (this.n.y < 0.82) return 'surface';
    // Опора под всем «пятном» ног: четыре луча сверху вниз по диагоналям. Первым должен попасться
    // тот же уровень — иначе край крыши/ящика (обрыв) или рядом торчит невысокий декор
    for (const [dx, dz] of CORNERS) {
      this.ray.set(this.o.set(pos.x + dx * FOOT, pos.y + HEADROOM, pos.z + dz * FOOT), this.down);
      this.ray.near = 0;
      this.ray.far = HEADROOM + 0.4;
      const h = this.ray.intersectObjects(this.built.placeMeshes, false)[0];
      if (!h) return 'surface';
      if (h.point.y > pos.y + 0.3) return 'blocked';
      if (h.point.y < pos.y - 0.3 || (h.object as THREE.Mesh).userData.route) return 'surface';
    }
    // Над головой свободно (нельзя встать под низкий навес)
    this.ray.set(this.o.set(pos.x, pos.y + 0.12, pos.z), this.up);
    this.ray.near = 0;
    this.ray.far = HEADROOM;
    if (this.ray.intersectObjects(this.built.placeMeshes, false).length) return 'blocked';
    // Вплотную к стене или зданию: горизонтальные лучи на уровне груди
    for (const [dx, dz] of SIDES) {
      this.ray.set(this.o.set(pos.x, pos.y + 1.0, pos.z), this.n.set(dx, 0, dz).normalize());
      this.ray.near = 0;
      this.ray.far = FOOT + 0.08;
      if (this.ray.intersectObjects(this.built.placeMeshes, false).length) return 'blocked';
    }
    for (const p of this.built.posts) {
      if (pos.y > p.y - 0.5 && pos.y < p.y + 2 && Math.hypot(p.x - pos.x, p.z - pos.z) < p.r + 0.45) return 'blocked';
    }
    for (const t of towers) {
      if (Math.hypot(t.x - pos.x, t.z - pos.z) < TOWER_GAP && Math.abs(t.y - pos.y) < 2.2) return 'taken';
    }
    return null;
  }

  /** Горизонтальное расстояние до ближайшей оси маршрута (сегменты сильно выше/ниже не мешают) */
  private routeDist(p: THREE.Vector3): number {
    let best = Infinity;
    for (const s of this.segs) {
      const abx = s.bx - s.ax;
      const abz = s.bz - s.az;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 1e-6 ? THREE.MathUtils.clamp(((p.x - s.ax) * abx + (p.z - s.az) * abz) / len2, 0, 1) : 0;
      const y = s.ay + (s.by - s.ay) * t;
      if (Math.abs(p.y - y) > 2.4) continue;
      const d = Math.hypot(s.ax + abx * t - p.x, s.az + abz * t - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** Имя места: ближайшая именованная точка или коллаут арены (перепад высоты весит больше) */
  nameAt(p: THREE.Vector3): Loc {
    let best: Loc = this.map.name;
    let bestD = Infinity;
    const consider = (q: readonly number[], name: Loc) => {
      const d = Math.hypot(q[0] - p.x, q[2] - p.z) + Math.abs(q[1] - p.y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    };
    for (const s of this.map.spots) consider(s.pos, s.name);
    for (const c of this.map.callouts) consider(c.p, c.name);
    return best;
  }
}
