import * as THREE from 'three';

/**
 * Слой спроецированных HTML-подписей (позиции, тиры башен).
 * Подписи прячутся за камерой, на большой дистанции и под элементами интерфейса,
 * чтобы никогда не перекрывать HUD.
 */

interface LabelItem {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  visible: boolean;
  maxDist: number;
  shown: boolean;
}

export class LabelLayer {
  private root: HTMLElement;
  private items = new Map<string, LabelItem>();
  private blockerFn: (() => DOMRect[]) | null = null;
  private blockers: DOMRect[] = [];
  private blockerAge = 1;
  private v = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Функция, возвращающая прямоугольники HUD, под которыми подписи скрываются */
  setBlockers(fn: (() => DOMRect[]) | null): void {
    this.blockerFn = fn;
    this.blockerAge = 1;
  }

  add(key: string, pos: THREE.Vector3, html: string, className: string, maxDist = 95): void {
    this.remove(key);
    const el = document.createElement('div');
    el.className = `lbl ${className}`;
    el.innerHTML = html;
    el.style.opacity = '0';
    this.root.appendChild(el);
    this.items.set(key, { el, pos, visible: true, maxDist, shown: false });
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  setHtml(key: string, html: string): void {
    const it = this.items.get(key);
    if (it && it.el.innerHTML !== html) it.el.innerHTML = html;
  }

  setClass(key: string, className: string): void {
    const it = this.items.get(key);
    if (it) it.el.className = `lbl ${className}`;
  }

  setVisible(key: string, v: boolean): void {
    const it = this.items.get(key);
    if (it) it.visible = v;
  }

  remove(key: string): void {
    const it = this.items.get(key);
    if (!it) return;
    it.el.remove();
    this.items.delete(key);
  }

  clear(): void {
    for (const it of this.items.values()) it.el.remove();
    this.items.clear();
  }

  update(camera: THREE.PerspectiveCamera, dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.blockerAge += dt;
    if (this.blockerAge > 0.25) {
      this.blockerAge = 0;
      this.blockers = this.blockerFn ? this.blockerFn() : [];
    }
    for (const it of this.items.values()) {
      let show = it.visible;
      let x = 0;
      let y = 0;
      if (show) {
        const dist = camera.position.distanceTo(it.pos);
        if (dist > it.maxDist) show = false;
        else {
          this.v.copy(it.pos).project(camera);
          if (this.v.z > 1 || this.v.z < -1) show = false;
          else {
            x = (this.v.x * 0.5 + 0.5) * w;
            y = (-this.v.y * 0.5 + 0.5) * h;
            if (x < -40 || x > w + 40 || y < -20 || y > h + 20) show = false;
            else {
              for (const r of this.blockers) {
                if (x > r.left - 30 && x < r.right + 30 && y > r.top - 14 && y < r.bottom + 24) {
                  show = false;
                  break;
                }
              }
            }
          }
        }
      }
      if (show) {
        it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
      if (show !== it.shown) {
        it.shown = show;
        it.el.style.opacity = show ? '1' : '0';
      }
    }
  }
}
