import * as THREE from 'three';
import type { RouteDef } from '../types/game';

/** Ломаная маршрута с параметризацией по пройденной дистанции */
export class RoutePath {
  readonly def: RouteDef;
  readonly pts: THREE.Vector3[];
  readonly cum: number[];
  readonly length: number;

  constructor(def: RouteDef) {
    this.def = def;
    this.pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  private segAt(d: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  sample(d: number, out: THREE.Vector3): THREE.Vector3 {
    const dd = THREE.MathUtils.clamp(d, 0, this.length);
    const i = this.segAt(dd);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 0 ? (dd - this.cum[i]) / segLen : 0;
    return out.copy(this.pts[i]).lerp(this.pts[i + 1], t);
  }

  /** Покрытие сегмента под точкой d (вода канала и т. п.) */
  surfaceAt(d: number): string {
    const i = this.segAt(THREE.MathUtils.clamp(d, 0, this.length - 0.001));
    return this.def.points[i][3] ?? 'cobble';
  }

  /** Направление движения в горизонтальной плоскости */
  direction(d: number, out: THREE.Vector3): THREE.Vector3 {
    const i = this.segAt(THREE.MathUtils.clamp(d, 0, this.length - 0.001));
    out.subVectors(this.pts[i + 1], this.pts[i]);
    out.y = 0;
    return out.lengthSq() > 0 ? out.normalize() : out.set(0, 0, 1);
  }
}
