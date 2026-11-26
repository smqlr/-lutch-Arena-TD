import * as THREE from 'three';
import type { UnitDef } from '../types/game';
import { UnitModel } from '../engine/Characters';
import { ROLE_COLORS } from '../i18n';

/** Небольшой отдельный рендерер для 3D-превью юнита в магазине */
export class UnitPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: UnitModel | null = null;
  private ringMat: THREE.MeshStandardMaterial;
  private key = '';
  private yaw = -0.5;
  private fitDirty = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x2a2f45, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00f0ff, 1.6);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x1c2230, metalness: 0.6, roughness: 0.35 }));
    ped.position.y = -0.1;
    ped.receiveShadow = true;
    this.scene.add(ped);
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 1.8 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.025, 8, 48), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    this.camera.position.set(0, 1.35, 3.7);
    this.camera.lookAt(0, 0.98, 0);
  }

  show(def: UnitDef, tier: number): void {
    const k = `${def.id}-${tier}`;
    if (k === this.key) return;
    this.key = k;
    if (this.model) this.model.dispose();
    this.model = new UnitModel(def, tier);
    // В витрине боец сразу стоит в своей фирменной позе
    this.model.setPosing(true, true);
    this.model.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(this.model.root);
    const c = ROLE_COLORS[def.role];
    this.ringMat.color.setHex(c);
    this.ringMat.emissive.setHex(c);
    this.fitDirty = true;
  }

  /**
   * Подгоняет камеру под габариты модели (вместе с оружием и головным убором),
   * чтобы боец целиком помещался в окно при любых размерах и пропорциях панели.
   */
  private fit(): void {
    if (!this.model) return;
    const body = this.model.human.body;
    const yaw = body.rotation.y;
    body.rotation.y = 0;
    this.model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model.root);
    body.rotation.y = yaw;
    // Модель вращается, поэтому по горизонтали берём радиус описанного цилиндра (не меньше пьедестала)
    const r = Math.max(
      1.05,
      Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z))),
    );
    const minY = Math.min(box.min.y, -0.15);
    const maxY = box.max.y;
    const height = (maxY - minY) * 1.1;
    const cy = (minY + maxY) / 2;
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    // Небольшой отступ на радиус: части модели, повёрнутые к камере, не должны выходить за кадр
    const dist = Math.max(height / 2 / Math.tan(vHalf), (r * 1.08) / Math.tan(hHalf)) + r * 0.3;
    this.camera.position.set(0, cy + height * 0.1, dist);
    this.camera.lookAt(0, cy, 0);
    this.fitDirty = false;
  }

  render(dt: number): void {
    if (!this.canvas.isConnected || !this.model) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.fitDirty = true;
    }
    if (this.fitDirty) this.fit();
    this.yaw += dt * 0.7;
    this.model.human.body.rotation.y = this.yaw;
    this.model.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
