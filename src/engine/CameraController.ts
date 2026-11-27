import * as THREE from 'three';

export type CameraMode = 'tactical' | 'flight';

/**
 * Управление камерой без «залипания» клавиш:
 *  - клавиши читаются только по e.code;
 *  - состояние сбрасывается на window.blur, visibilitychange, contextmenu;
 *  - после клика по кнопке фокус снимается, чтобы Space не «нажимал» её повторно.
 * Режимы: «Тактика» (панорама/зум/поворот вокруг точки) и «Полёт» (свободный 3D-обзор).
 */

const TRACKED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight',
]);

/** Скорость свободного полёта, ед./с */
const FLIGHT_SPEED = 9;
/** Шаг колеса мыши в полёте (ед. на 100 единиц deltaY) */
const FLIGHT_WHEEL = 3;
/** Почти вертикальный обзор вверх/вниз (lookAt не допускает ровно 90°) */
const PITCH_LIMIT = 1.55;
const ZOOM_MIN = 6;
const ZOOM_MAX = 140;
/** Насколько далеко за арену можно увести камеру */
const TACTICAL_MARGIN = 30;
const FLIGHT_MARGIN = 80;

interface PointerState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  touch: boolean;
}

export class CameraController {
  mode: CameraMode = 'tactical';
  /** Ввод разрешён (в меню камера управляется автоматически) */
  inputEnabled = false;
  autoOrbit = false;
  /** Тап/клик без перетаскивания; touch — касание пальцем (нет наведения мышью) */
  onTap: ((x: number, y: number, touch: boolean) => void) | null = null;
  onHover: ((x: number, y: number) => void) | null = null;
  onModeChange: ((m: CameraMode) => void) | null = null;

  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private keys = new Set<string>();
  private pointers = new Map<number, PointerState>();
  private dragging = false;
  private pinchStart = 0;
  private pinchDist0 = 0;

  private target = new THREE.Vector3();
  private dist = 60;
  private distGoal = 60;
  private yaw = 0;
  private pitch = 0.95;
  private defaults = { target: new THREE.Vector3(), dist: 60, yaw: 0, pitch: 0.95 };
  private bounds = { w: 80, d: 54 };

  private fpos = new THREE.Vector3();
  private fyaw = 0;
  private fpitch = -0.6;

  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions | boolean | undefined][] = [];

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    this.on(window, 'keydown', (e) => this.handleKeyDown(e as KeyboardEvent));
    this.on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.on(window, 'blur', () => this.resetInput());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
    this.on(window, 'contextmenu', (e) => {
      this.resetInput();
      if (e.target === this.dom) e.preventDefault();
    });
    // Снимаем фокус с кнопок после клика: Space/Enter не будут повторно их нажимать
    this.on(document, 'pointerup', (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, [role="button"]');
      if (el) window.setTimeout(() => (el as HTMLElement).blur(), 0);
    });
    this.on(dom, 'pointerdown', (e) => this.handlePointerDown(e as PointerEvent));
    this.on(dom, 'pointermove', (e) => this.handlePointerMove(e as PointerEvent));
    this.on(dom, 'pointerup', (e) => this.handlePointerUp(e as PointerEvent));
    this.on(dom, 'pointercancel', (e) => this.pointers.delete((e as PointerEvent).pointerId));
    this.on(dom, 'pointerleave', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse' && !this.pointers.size) this.onHover?.(-1, -1);
    });
    this.on(dom, 'wheel', (e) => this.handleWheel(e as WheelEvent), { passive: false });
  }

  private on(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  dispose(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
  }

  resetInput(): void {
    this.keys.clear();
    this.pointers.clear();
    this.dragging = false;
  }

  setDefaults(target: [number, number], dist: number, yaw: number, pitch: number, bounds: [number, number]): void {
    this.defaults = { target: new THREE.Vector3(target[0], 0, target[1]), dist, yaw, pitch };
    this.bounds = { w: bounds[0], d: bounds[1] };
  }

  reset(): void {
    this.target.copy(this.defaults.target);
    this.dist = this.distGoal = this.defaults.dist;
    this.yaw = this.defaults.yaw;
    this.pitch = this.defaults.pitch;
    if (this.mode !== 'tactical') this.setMode('tactical');
    this.resetInput();
    this.apply();
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    if (mode === 'flight') {
      this.fpos.copy(this.camera.position);
      this.fyaw = this.yaw;
      this.fpitch = -this.pitch * 0.85;
    } else {
      // Возвращаемся в тактику над точкой, куда смотрели
      const dir = this.flightDir(new THREE.Vector3());
      const tHit = dir.y < -0.05 ? -this.fpos.y / dir.y : 30;
      const p = this.fpos.clone().addScaledVector(dir, Math.min(80, tHit));
      this.target.set(p.x, 0, p.z);
      this.clampTarget();
      this.yaw = this.fyaw;
    }
    this.mode = mode;
    this.resetInput();
    this.onModeChange?.(mode);
  }

  toggleMode(): CameraMode {
    this.setMode(this.mode === 'tactical' ? 'flight' : 'tactical');
    return this.mode;
  }

  private flightDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.fyaw) * Math.cos(this.fpitch), Math.sin(this.fpitch), -Math.cos(this.fyaw) * Math.cos(this.fpitch));
  }

  /* -------------------------------- Ввод --------------------------------- */

  private handleKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!TRACKED.has(e.code)) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) {
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.blur();
    }
    if (!this.inputEnabled) return;
    this.keys.add(e.code);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.inputEnabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, touch: e.pointerType !== 'mouse' });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStart = this.distGoal;
      this.dragging = true;
    } else {
      this.dragging = false;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && this.inputEnabled) this.onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist0 > 10) {
        if (this.mode === 'tactical') this.distGoal = THREE.MathUtils.clamp((this.pinchStart * this.pinchDist0) / Math.max(10, d), ZOOM_MIN, ZOOM_MAX);
        else this.fpos.addScaledVector(this.flightDir(new THREE.Vector3()), (d - this.pinchDist0) * 0.0012);
      }
      return;
    }
    if (!this.dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) this.dragging = true;
    if (!this.dragging) return;
    if (this.mode === 'flight') {
      this.fyaw -= dx * 0.0042;
      this.fpitch = THREE.MathUtils.clamp(this.fpitch - dy * 0.0042, -PITCH_LIMIT, PITCH_LIMIT);
      return;
    }
    const rotate = !p.touch && (p.button === 2 || p.button === 1);
    if (rotate) {
      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.08, PITCH_LIMIT);
    } else {
      const k = this.dist * 0.0017;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      this.target.x += -rx * dx * k + fx * dy * k;
      this.target.z += -rz * dx * k + fz * dy * k;
      this.clampTarget();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.dom.releasePointerCapture?.(e.pointerId);
    if (!p || !this.inputEnabled) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (!this.dragging && moved < 8 && (p.touch || p.button === 0) && this.pointers.size === 0) this.onTap?.(e.clientX, e.clientY, p.touch);
    if (this.pointers.size === 0) this.dragging = false;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.inputEnabled) return;
    e.preventDefault();
    const delta = THREE.MathUtils.clamp(e.deltaY, -120, 120);
    if (this.mode === 'tactical') {
      this.distGoal = THREE.MathUtils.clamp(this.distGoal * (1 + delta * 0.0012), ZOOM_MIN, ZOOM_MAX);
    } else {
      this.fpos.addScaledVector(this.flightDir(new THREE.Vector3()), (-delta / 100) * FLIGHT_WHEEL);
      this.clampFlight();
    }
  }

  private clampTarget(): void {
    const mx = this.bounds.w / 2 + TACTICAL_MARGIN;
    const mz = this.bounds.d / 2 + TACTICAL_MARGIN;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -mx, mx);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -mz, mz);
    this.target.y = THREE.MathUtils.clamp(this.target.y, 0, 30);
  }

  /** Свободный полёт: широкие границы, снизу — только чтобы не провалиться под землю */
  private clampFlight(): void {
    const mx = this.bounds.w / 2 + FLIGHT_MARGIN;
    const mz = this.bounds.d / 2 + FLIGHT_MARGIN;
    this.fpos.x = THREE.MathUtils.clamp(this.fpos.x, -mx, mx);
    this.fpos.z = THREE.MathUtils.clamp(this.fpos.z, -mz, mz);
    this.fpos.y = THREE.MathUtils.clamp(this.fpos.y, 0.4, 150);
  }

  /* -------------------------------- Цикл --------------------------------- */

  update(dt: number): void {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    if (this.mode === 'tactical') {
      if (this.autoOrbit) this.yaw += dt * 0.05;
      const sp = this.dist * 0.85 * dt;
      if (fwd || right) {
        this.target.x += (-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * right) * sp;
        this.target.z += (-Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * right) * sp;
        this.clampTarget();
      }
      // Ось Y в тактике: Space / Shift поднимают и опускают точку обзора
      const vert = (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0);
      if (vert) {
        this.target.y += vert * Math.max(3, this.dist * 0.15) * dt;
        this.clampTarget();
      }
      if (k.has('KeyQ')) this.yaw += dt * 1.5;
      if (k.has('KeyE')) this.yaw -= dt * 1.5;
      this.dist += (this.distGoal - this.dist) * Math.min(1, dt * 10);
      this.apply();
    } else {
      const sp = FLIGHT_SPEED * dt;
      const dir = this.flightDir(new THREE.Vector3());
      // Вбок — горизонтально, чтобы камера не заваливалась при взгляде вверх/вниз
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (side.lengthSq() < 1e-6) side.set(Math.cos(this.fyaw), 0, -Math.sin(this.fyaw));
      side.normalize();
      // W/S — точно по направлению взгляда, включая высоту: полная свобода по XYZ
      this.fpos.addScaledVector(dir, fwd * sp);
      this.fpos.addScaledVector(side, right * sp);
      if (k.has('Space')) this.fpos.y += sp;
      if (k.has('ShiftLeft') || k.has('ShiftRight')) this.fpos.y -= sp;
      if (k.has('KeyQ')) this.fyaw += dt * 1.5;
      if (k.has('KeyE')) this.fyaw -= dt * 1.5;
      this.clampFlight();
      this.camera.position.copy(this.fpos);
      this.camera.lookAt(this.fpos.clone().add(dir));
    }
  }

  private apply(): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }
}
