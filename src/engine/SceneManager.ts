import * as THREE from 'three';
import type { MapTheme } from '../types/game';
import { fireGroundTexture, glowTexture, ringTexture, setMaxAnisotropy, skyTexture } from './Textures';

/**
 * Three.js сцена: рендерер (ACES + PCFSoft-тени 2048), освещение под тему карты, небо,
 * частицы, трассеры, вспышки, ударные волны, зоны Молотова и облака дыма.
 */

/* ------------------------------ Частицы ----------------------------------- */

export interface ParticleOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size0: number;
  size1?: number;
  color: THREE.Color | number;
  color1?: THREE.Color | number;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const PARTICLE_VS = /* glsl */ `
attribute float psize;
attribute vec4 pcolor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

class ParticleSystem {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private max: number;
  private cursor = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private active = 0;

  constructor(max: number, blending: THREE.Blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uMap: { value: glowTexture() }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(o: ParticleOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = o.pos.x;
    this.pos[i * 3 + 1] = o.pos.y;
    this.pos[i * 3 + 2] = o.pos.z;
    this.vel[i * 3] = o.vel?.x ?? 0;
    this.vel[i * 3 + 1] = o.vel?.y ?? 0;
    this.vel[i * 3 + 2] = o.vel?.z ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1 ?? o.size0;
    const c0 = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color);
    const c1 = o.color1 === undefined ? c0 : o.color1 instanceof THREE.Color ? o.color1 : new THREE.Color(o.color1);
    this.c0[i * 3] = c0.r;
    this.c0[i * 3 + 1] = c0.g;
    this.c0[i * 3 + 2] = c0.b;
    this.c1[i * 3] = c1.r;
    this.c1[i * 3 + 1] = c1.g;
    this.c1[i * 3 + 2] = c1.b;
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.active = Math.min(this.max, this.active + 1);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0;
          this.col[i * 4 + 3] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const t = 1 - k;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      this.col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      this.col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, k * 1.6);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.active = 0;
  }
}

/* --------------------------- Огонь и дым ---------------------------------- */

export interface FireZoneVis {
  pos: THREE.Vector3;
  radius: number;
  life: number;
  readonly maxLife: number;
  alive: boolean;
}

interface FireInternal extends FireZoneVis {
  decal: THREE.Mesh;
  light: THREE.PointLight | null;
  emitAcc: number;
}

export interface SmokeVis {
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
  /** Видимый и блокирующий обзор (не в фазе рассеивания) */
  solid: boolean;
  dissipate(): void;
}

interface SmokeInternal extends SmokeVis {
  group: THREE.Group;
  mat: THREE.MeshLambertMaterial;
  life: number;
  age: number;
  fade: number;
  puffs: { m: THREE.Mesh; base: THREE.Vector3; ph: number }[];
}

interface Tracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

interface Shock {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  radius: number;
}

/* ----------------------------- SceneManager ------------------------------- */

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world = new THREE.Group();
  readonly fx = new THREE.Group();

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.MeshBasicMaterial;
  private sunGlow: THREE.Sprite;
  private additive = new ParticleSystem(2600, THREE.AdditiveBlending);
  private soft = new ParticleSystem(900, THREE.NormalBlending);
  private dust: THREE.Points;
  private dustBase: Float32Array;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private shocks: Shock[] = [];
  private fires: FireInternal[] = [];
  private smokes: SmokeInternal[] = [];
  private fireLights: THREE.PointLight[] = [];
  private rangeGroup = new THREE.Group();
  private rangeRingMat: THREE.MeshBasicMaterial;
  private rangeDiscMat: THREE.MeshBasicMaterial;
  private shake = 0;
  private time = 0;
  private tmpV = new THREE.Vector3();
  private smokeGeo = new THREE.IcosahedronGeometry(1, 1);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
    this.camera.position.set(0, 45, 40);
    this.camera.lookAt(0, 0, 0);

    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0xc9a06c, 1);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -52;
    sc.right = 52;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 10, 1.6);
      l.position.set(0, -50, 0);
      this.scene.add(l);
      this.fireLights.push(l);
    }

    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1d0, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.sunGlow.scale.set(90, 90, 1);
    this.scene.add(this.sunGlow);

    this.scene.add(this.world);
    this.scene.add(this.fx);
    this.fx.add(this.additive.points);
    this.fx.add(this.soft.points);

    // Пыль в воздухе
    const dustN = 320;
    this.dustBase = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      this.dustBase[i * 3] = (Math.random() - 0.5) * 84;
      this.dustBase[i * 3 + 1] = Math.random() * 12 + 0.5;
      this.dustBase[i * 3 + 2] = (Math.random() - 0.5) * 56;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustBase.slice(), 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.12, color: 0xf5deb3, transparent: true, opacity: 0.55, depthWrite: false, map: glowTexture() }));
    this.dust.frustumCulled = false;
    this.fx.add(this.dust);

    // Пулы трассеров, вспышек и ударных волн
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 140; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.fx.add(mesh);
      this.tracers.push({ mesh, mat, life: 0, max: 1 });
    }
    for (let i = 0; i < 50; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sprite.visible = false;
      this.fx.add(sprite);
      this.flashes.push({ sprite, life: 0, max: 1, size: 1 });
    }
    const shockGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(shockGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.fx.add(mesh);
      this.shocks.push({ mesh, mat, life: 0, max: 1, radius: 1 });
    }

    // Индикатор дальности
    this.rangeRingMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.rangeDiscMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 96), this.rangeRingMat);
    ring.rotation.x = -Math.PI / 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), this.rangeDiscMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.01;
    this.rangeGroup.add(ring, disc);
    this.rangeGroup.visible = false;
    this.rangeGroup.renderOrder = 3;
    this.fx.add(this.rangeGroup);

    this.resize();
  }

  applyTheme(t: MapTheme): void {
    const old = this.skyMat.map;
    this.skyMat.map = skyTexture(t.skyTop, t.skyHorizon);
    this.skyMat.needsUpdate = true;
    old?.dispose();
    this.scene.fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
    this.hemi.color.setHex(t.hemiSky);
    this.hemi.groundColor.setHex(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.ambient.color.setHex(t.ambient);
    this.ambient.intensity = t.ambientIntensity;
    this.sun.color.setHex(t.sun);
    this.sun.intensity = t.sunIntensity;
    const dir = new THREE.Vector3(...t.sunDir).normalize();
    this.sun.position.copy(dir).multiplyScalar(110);
    this.sun.target.position.set(0, 0, 0);
    this.sunGlow.position.copy(dir).multiplyScalar(420);
    (this.sunGlow.material as THREE.SpriteMaterial).color.setHex(t.sun);
    this.renderer.toneMappingExposure = t.exposure;
    (this.dust.material as THREE.PointsMaterial).color.setHex(t.dust);
    for (const l of this.fireLights) l.color.setHex(t.warm ? 0xff8a3a : 0xff6a20);
  }

  /** Заменяет содержимое мира (карту) */
  setWorld(obj: THREE.Object3D | null): void {
    for (const c of [...this.world.children]) this.world.remove(c);
    if (obj) this.world.add(obj);
  }

  /** Очистка всех эффектов (между матчами) */
  clearFx(): void {
    this.additive.clear();
    this.soft.clear();
    for (const t of this.tracers) {
      t.life = 0;
      t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.life = 0;
      f.sprite.visible = false;
    }
    for (const s of this.shocks) {
      s.life = 0;
      s.mesh.visible = false;
    }
    for (const f of this.fires) this.removeFire(f);
    this.fires = [];
    for (const s of this.smokes) this.removeSmoke(s);
    this.smokes = [];
    this.hideRange();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // На узких экранах шире угол обзора, чтобы арена влезала
    this.camera.fov = w / h < 0.8 ? 62 : 50;
    this.camera.updateProjectionMatrix();
    const scale = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.additive.material.uniforms.uScale.value = scale;
    this.soft.material.uniforms.uScale.value = scale;
  }

  /* ------------------------------ Эффекты -------------------------------- */

  particle(o: ParticleOpts, additive = true): void {
    (additive ? this.additive : this.soft).emit(o);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe08a, width = 0.05, life = 0.09): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    t.mat.color.setHex(color);
    t.mat.opacity = 1;
    t.life = life;
    t.max = life;
    t.mesh.visible = true;
  }

  muzzleFlash(pos: THREE.Vector3, color = 0xffc35a, size = 0.9): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(pos);
    (f.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    f.size = size;
    f.sprite.scale.setScalar(size);
    f.life = 0.07;
    f.max = 0.07;
    f.sprite.visible = true;
  }

  bigFlash(pos: THREE.Vector3, color: number, size: number, life: number): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.sprite.position.copy(pos);
    (f.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    f.size = size;
    f.sprite.scale.setScalar(size);
    f.life = life;
    f.max = life;
    f.sprite.visible = true;
  }

  shockwave(pos: THREE.Vector3, radius: number, color = 0xffffff, life = 0.5): void {
    const s = this.shocks.find((x) => x.life <= 0) ?? this.shocks[0];
    s.mesh.position.set(pos.x, pos.y + 0.15, pos.z);
    s.mat.color.setHex(color);
    s.radius = radius;
    s.life = life;
    s.max = life;
    s.mesh.visible = true;
  }

  sparks(pos: THREE.Vector3, color = 0xffd27a, count = 6, speed = 4): void {
    for (let i = 0; i < count; i++) {
      this.additive.emit({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed),
        life: 0.25 + Math.random() * 0.2,
        size0: 0.18,
        size1: 0.02,
        color,
        color1: 0x7a1a00,
        gravity: 9,
        drag: 1.5,
      });
    }
  }

  explosion(pos: THREE.Vector3, radius: number): void {
    this.bigFlash(pos.clone().setY(pos.y + 0.6), 0xffb347, radius * 2.6, 0.25);
    this.shockwave(pos, radius * 1.1, 0xffa040, 0.45);
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.additive.emit({
        pos: pos.clone().setY(pos.y + 0.4),
        vel: new THREE.Vector3(Math.cos(a) * sp, 1.5 + Math.random() * 4, Math.sin(a) * sp),
        life: 0.4 + Math.random() * 0.4,
        size0: 0.9,
        size1: 0.1,
        color: 0xffd27a,
        color1: 0x8a1c00,
        gravity: 6,
        drag: 2,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.soft.emit({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius, 0.5, (Math.random() - 0.5) * radius)),
        vel: new THREE.Vector3(0, 0.8 + Math.random(), 0),
        life: 1.2 + Math.random() * 0.6,
        size0: 1.2,
        size1: 2.6,
        color: 0x3f3f46,
        color1: 0x71717a,
        alpha: 0.55,
        drag: 0.5,
      });
    }
    this.addShake(0.25);
  }

  flashBang(pos: THREE.Vector3, radius: number): void {
    this.bigFlash(pos.clone().setY(pos.y + 1), 0xffffff, radius * 3.2, 0.35);
    this.shockwave(pos, radius, 0xe0f2fe, 0.4);
    this.sparks(pos.clone().setY(pos.y + 1), 0xffffff, 14, 7);
  }

  addShake(v: number): void {
    this.shake = Math.min(0.6, this.shake + v);
  }

  showRange(pos: THREE.Vector3, radius: number, color = 0x00f0ff): void {
    this.rangeGroup.visible = true;
    this.rangeGroup.position.set(pos.x, pos.y + 0.22, pos.z);
    this.rangeGroup.scale.set(radius, 1, radius);
    this.rangeRingMat.color.setHex(color);
    this.rangeDiscMat.color.setHex(color);
  }

  hideRange(): void {
    this.rangeGroup.visible = false;
  }

  addFire(pos: THREE.Vector3, radius: number, duration: number): FireZoneVis {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2.3, radius * 2.3),
      new THREE.MeshBasicMaterial({ map: fireGroundTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(pos.x, pos.y + 0.12, pos.z);
    decal.renderOrder = 4;
    this.fx.add(decal);
    const light = this.fireLights.find((l) => l.intensity === 0) ?? null;
    if (light) {
      light.position.set(pos.x, pos.y + 1.2, pos.z);
      light.intensity = 0.01;
    }
    const f: FireInternal = { pos: pos.clone(), radius, life: duration, maxLife: duration, alive: true, decal, light, emitAcc: 0 };
    this.fires.push(f);
    return f;
  }

  addSmoke(pos: THREE.Vector3, radius: number, duration: number): SmokeVis {
    const group = new THREE.Group();
    group.position.copy(pos);
    const mat = new THREE.MeshLambertMaterial({ color: 0xd4d4d8, transparent: true, opacity: 0.9, depthWrite: false });
    const puffs: SmokeInternal['puffs'] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = (i < 6 ? 0.3 : 0.75) * radius * (0.6 + Math.random() * 0.4);
      const base = new THREE.Vector3(Math.cos(a) * r, 0.5 + Math.random() * radius * 0.7, Math.sin(a) * r);
      const m = new THREE.Mesh(this.smokeGeo, mat);
      const sc = radius * (0.38 + Math.random() * 0.22);
      m.scale.setScalar(sc);
      m.position.copy(base);
      m.renderOrder = 6;
      group.add(m);
      puffs.push({ m, base, ph: Math.random() * 6 });
    }
    group.scale.setScalar(0.2);
    this.fx.add(group);
    const s: SmokeInternal = {
      pos: pos.clone(),
      radius,
      alive: true,
      solid: true,
      group,
      mat,
      life: duration,
      age: 0,
      fade: 0,
      puffs,
      dissipate: () => {
        if (s.fade === 0) s.fade = 0.0001;
        s.solid = false;
      },
    };
    this.smokes.push(s);
    return s;
  }

  private removeFire(f: FireInternal): void {
    f.alive = false;
    f.decal.removeFromParent();
    f.decal.geometry.dispose();
    (f.decal.material as THREE.Material).dispose();
    if (f.light) {
      f.light.intensity = 0;
      f.light.position.set(0, -50, 0);
    }
  }

  private removeSmoke(s: SmokeInternal): void {
    s.alive = false;
    s.solid = false;
    s.group.removeFromParent();
    s.mat.dispose();
  }

  /* ------------------------------- Цикл ---------------------------------- */

  update(dt: number): void {
    this.time += dt;
    this.additive.update(dt);
    this.soft.update(dt);

    // Пыль
    const dpos = (this.dust.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < dpos.length / 3; i++) {
      dpos[i * 3] = this.dustBase[i * 3] + Math.sin(this.time * 0.15 + i) * 1.5;
      dpos[i * 3 + 1] = this.dustBase[i * 3 + 1] + Math.sin(this.time * 0.3 + i * 1.7) * 0.6;
      dpos[i * 3 + 2] = this.dustBase[i * 3 + 2] + Math.cos(this.time * 0.12 + i * 0.7) * 1.5;
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.sprite.scale.setScalar(f.size * (0.6 + (1 - k) * 0.6));
      (f.sprite.material as THREE.SpriteMaterial).opacity = k;
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const s of this.shocks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      const r = s.radius * (0.15 + (1 - k) * 0.95);
      s.mesh.scale.set(r, r, r);
      s.mat.opacity = k * 0.9;
      if (s.life <= 0) s.mesh.visible = false;
    }

    // Огонь
    for (const f of this.fires) {
      f.life -= dt;
      const fadeIn = Math.min(1, (f.maxLife - f.life) * 4);
      const fadeOut = Math.min(1, Math.max(0, f.life) * 1.5);
      const k = fadeIn * fadeOut;
      (f.decal.material as THREE.MeshBasicMaterial).opacity = k * (0.75 + Math.sin(this.time * 17 + f.pos.x) * 0.12);
      if (f.light) f.light.intensity = k * (22 + Math.sin(this.time * 23 + f.pos.z) * 6 + Math.sin(this.time * 9) * 4);
      f.emitAcc += dt * 70 * f.radius * k;
      while (f.emitAcc > 1) {
        f.emitAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * f.radius;
        const p = this.tmpV.set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.15, f.pos.z + Math.sin(a) * r);
        this.additive.emit({
          pos: p,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6 + Math.random() * 1.8, (Math.random() - 0.5) * 0.4),
          life: 0.45 + Math.random() * 0.4,
          size0: 0.55 + Math.random() * 0.4,
          size1: 0.08,
          color: 0xffd27a,
          color1: 0xb02000,
          alpha: 0.9,
          drag: 0.6,
        });
        if (Math.random() < 0.12) {
          this.soft.emit({
            pos: p.clone().setY(p.y + 1.2),
            vel: new THREE.Vector3(0, 1.2, 0),
            life: 1.4,
            size0: 0.6,
            size1: 1.8,
            color: 0x27272a,
            color1: 0x52525b,
            alpha: 0.35,
          });
        }
      }
      if (f.life <= 0) this.removeFire(f);
    }
    this.fires = this.fires.filter((f) => f.alive);

    // Дым
    for (const s of this.smokes) {
      s.age += dt;
      s.life -= dt;
      if (s.life <= 0 && s.fade === 0) s.dissipate();
      const grow = Math.min(1, s.age / 0.6);
      s.group.scale.setScalar(0.2 + grow * 0.8 * (1 + Math.min(1, s.fade) * 0.35));
      if (s.fade > 0) {
        s.fade += dt / 0.8;
        s.mat.opacity = Math.max(0, 0.9 * (1 - s.fade));
      }
      for (const p of s.puffs) {
        p.m.position.set(p.base.x + Math.sin(this.time * 0.7 + p.ph) * 0.15, p.base.y + Math.sin(this.time * 0.9 + p.ph) * 0.12, p.base.z + Math.cos(this.time * 0.6 + p.ph) * 0.15);
        p.m.rotation.y += dt * 0.2;
      }
      if (s.fade >= 1) this.removeSmoke(s);
    }
    this.smokes = this.smokes.filter((s) => s.alive);

    if (this.rangeGroup.visible) this.rangeRingMat.opacity = 0.7 + Math.sin(this.time * 5) * 0.15;
  }

  render(): void {
    if (this.shake > 0.001) {
      const ox = (Math.random() - 0.5) * this.shake;
      const oy = (Math.random() - 0.5) * this.shake;
      this.camera.position.x += ox;
      this.camera.position.y += oy;
      this.renderer.render(this.scene, this.camera);
      this.camera.position.x -= ox;
      this.camera.position.y -= oy;
      this.shake *= 0.86;
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
