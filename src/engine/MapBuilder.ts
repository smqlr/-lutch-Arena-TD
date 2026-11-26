import * as THREE from 'three';
import type { MapDef, PropDef, RoutePoint, SurfaceKind, TextureKind } from '../types/game';
import { chevronTexture, decalTexture, getTexture, getWaterTexture, glowTexture, windowTexture } from './Textures';
import { PlantCore, buildSpawnGate, stdMat } from './ModelFactory';

/**
 * Строит 3D-арену по описанию MapDef: землю, дорожки маршрутов (с рампами и опорами),
 * все декорации, ворота спавна и ядро плента. Отдаёт список поверхностей для свободной установки бойцов.
 */

export interface BuiltMap {
  group: THREE.Group;
  /** Меши, по которым ищется место установки бойца (земля, крыши, ящики, платформы, дорожки) */
  placeMeshes: THREE.Mesh[];
  /** Тонкие препятствия (пальмы, деревья, фонари), сквозь которые луч проходит, но встать на них нельзя */
  posts: { x: number; y: number; z: number; r: number }[];
  plant: PlantCore;
  plantPos: THREE.Vector3;
  portals: THREE.Mesh[];
  update(dt: number): void;
  dispose(): void;
}

/* ------------------------- Материалы и UV-хелперы ------------------------- */

const texMatCache = new Map<string, THREE.MeshStandardMaterial>();

function texMat(kind: TextureKind, tint = 0xffffff, extra?: { rough?: number; metal?: number }): THREE.MeshStandardMaterial {
  const key = `${kind}|${tint}|${extra?.rough ?? ''}|${extra?.metal ?? ''}`;
  let m = texMatCache.get(key);
  if (!m) {
    const metallic = kind === 'metal' || kind === 'container';
    m = new THREE.MeshStandardMaterial({
      map: getTexture(kind, tint),
      color: kind === 'awning' ? 0xffffff : tint,
      roughness: extra?.rough ?? (metallic ? 0.55 : kind === 'water' ? 0.15 : 0.92),
      metalness: extra?.metal ?? (metallic ? 0.45 : 0),
    });
    texMatCache.set(key, m);
  }
  return m;
}

/** Масштабирует UV коробки под мировые размеры граней (tile — размер тайла в метрах) */
function boxUV(geo: THREE.BufferGeometry, w: number, h: number, d: number, tileU: number, tileV = tileU): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * dims[f][0]) / tileU, (uv.getY(idx) * dims[f][1]) / tileV);
    }
  }
  uv.needsUpdate = true;
}

function texBox(w: number, h: number, d: number, kind: TextureKind, tint = 0xffffff, tile = 4): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  boxUV(geo, w, h, d, tile);
  const m = new THREE.Mesh(geo, texMat(kind, tint));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/* ------------------------------ Сборщик карты ------------------------------ */

/** Декор, сквозь который проходит луч установки: на нём не стоят, но и под ним не прячется земля */
const PASS_THROUGH = new Set(['palm', 'tree', 'lamp', 'cable', 'carpetHang', 'rail', 'decal']);

export function buildMap(map: MapDef): BuiltMap {
  const group = new THREE.Group();
  group.name = `map-${map.id}`;
  const disposables: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const windows: THREE.Matrix4[] = [];
  const supportKind: TextureKind = map.theme.warm ? 'sandstone' : 'concrete';

  /* Земля */
  const [W, D] = map.size;
  const gw = W + 70;
  const gd = D + 60;
  const groundGeo = track(new THREE.PlaneGeometry(gw, gd));
  const guv = groundGeo.attributes.uv as THREE.BufferAttribute;
  const gTile = map.ground === 'cobble' ? 4 : 8;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, (guv.getX(i) * gw) / gTile, (guv.getY(i) * gd) / gTile);
  const ground = mesh(groundGeo, texMat(map.ground, map.groundTint), false);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.prop = 'ground';
  group.add(ground);

  /* Дорожки маршрутов (с дедупликацией общих сегментов) */
  interface Seg {
    a: THREE.Vector3;
    b: THREE.Vector3;
    surface: SurfaceKind;
    width: number;
    support: 'solid' | 'pillars';
  }
  const segs = new Map<string, Seg>();
  const keyOf = (p: RoutePoint) => `${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}`;
  for (const r of map.routes) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const pa = r.points[i];
      const pb = r.points[i + 1];
      const key = `${keyOf(pa)}>${keyOf(pb)}`;
      const width = r.width ?? 2.6;
      const exist = segs.get(key);
      if (exist) {
        exist.width = Math.max(exist.width, width);
        continue;
      }
      segs.set(key, {
        a: new THREE.Vector3(pa[0], pa[1], pa[2]),
        b: new THREE.Vector3(pb[0], pb[1], pb[2]),
        surface: (pa[3] as SurfaceKind | undefined) ?? 'cobble',
        width,
        support: r.support ?? 'solid',
      });
    }
  }

  const chevTex = chevronTexture();
  const chevMat = new THREE.MeshBasicMaterial({
    map: chevTex,
    color: map.accent,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const curbMat = stdMat(0x2a2620, { rough: 0.9 });

  // Сколько плоских сегментов сходится в точке — на углах плиты удлиняются, чтобы не было щелей
  const vkey = (v: THREE.Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
  const flatJoints = new Map<string, number>();
  for (const s of segs.values()) {
    if (Math.abs(s.b.y - s.a.y) > 0.01) continue;
    for (const v of [s.a, s.b]) flatJoints.set(vkey(v), (flatJoints.get(vkey(v)) ?? 0) + 1);
  }

  const routeStart = group.children.length;
  let segIndex = 0;
  for (const s of segs.values()) {
    segIndex++;
    const eps = segIndex * 0.0025;
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dz);
    const L3 = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(dx, dz);
    const mid = s.a.clone().add(s.b).multiplyScalar(0.5);
    const w = s.width;
    const elevated = s.a.y > 0.01 || s.b.y > 0.01;
    const flat = Math.abs(dy) < 0.01;
    const extA = flat && (flatJoints.get(vkey(s.a)) ?? 0) >= 2 ? w / 2 : 0;
    const extB = flat && (flatJoints.get(vkey(s.b)) ?? 0) >= 2 ? w / 2 : 0;
    const shift = (extB - extA) / 2;

    // Опоры
    if (elevated) {
      if (s.support === 'solid') {
        const total = L + extA + extB;
        const sg = track(new THREE.BoxGeometry(w + 0.3, 1, total));
        const pos = sg.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getZ(i);
          if (pos.getY(i) > 0) {
            const t = L > 0 ? THREE.MathUtils.clamp((z + total / 2 - extA) / L, 0, 1) : 0;
            pos.setY(i, s.a.y + dy * t - 0.02);
          } else pos.setY(i, 0);
        }
        pos.needsUpdate = true;
        sg.computeVertexNormals();
        boxUV(sg, w + 0.3, Math.max(s.a.y, s.b.y), total, 4);
        const sup = mesh(sg, texMat(supportKind, map.theme.warm ? 0xe2c79b : 0x9aa3ad));
        sup.position.set(mid.x + Math.sin(yaw) * shift, 0, mid.z + Math.cos(yaw) * shift);
        sup.rotation.y = yaw;
        group.add(sup);
      } else {
        // настил моста + колонны
        const deck = mesh(track(new THREE.BoxGeometry(w + 0.6, 0.5, L3 + 0.2)), texMat('concrete', 0xa7adb5));
        deck.position.copy(mid);
        deck.position.y -= 0.27;
        deck.lookAt(new THREE.Vector3(s.b.x, s.b.y - 0.27, s.b.z));
        group.add(deck);
        const n = Math.max(1, Math.floor(L / 5));
        for (let i = 0; i <= n; i++) {
          const t = n === 0 ? 0.5 : i / n;
          const p = s.a.clone().lerp(s.b, t);
          if (p.y < 0.9) continue;
          const pil = texBox(1.0, p.y - 0.5, 1.0, 'concrete', 0x98a0a9, 3);
          pil.position.set(p.x, (p.y - 0.5) / 2, p.z);
          pil.rotation.y = yaw;
          group.add(pil);
          const cap = texBox(w + 0.4, 0.3, 1.2, 'concrete', 0x8e959e, 3);
          cap.position.set(p.x, p.y - 0.62, p.z);
          cap.rotation.y = yaw;
          group.add(cap);
        }
      }
    }

    if (s.surface === 'water') continue;

    // Плита дорожки
    const frame = new THREE.Object3D();
    frame.position.copy(mid);
    frame.lookAt(s.b);
    group.add(frame);
    const len = flat ? L3 + extA + extB : L3 + 0.3;
    const sg = track(new THREE.BoxGeometry(w, 0.12, len));
    if (s.surface === 'carpet') boxUV(sg, w, 0.12, len, w, w * 2);
    else boxUV(sg, w, 0.12, len, 3);
    const tint = s.surface === 'carpet' ? 0xffffff : s.surface === 'sand' ? 0xe6cfa1 : 0xf2ece2;
    const slab = mesh(sg, texMat(s.surface, tint));
    slab.position.set(0, -0.02 + eps, flat ? shift : 0);
    frame.add(slab);
    // бордюры
    for (const side of [-1, 1]) {
      const curb = mesh(track(new THREE.BoxGeometry(0.12, 0.16, len)), curbMat);
      curb.position.set(side * (w / 2 + 0.02), 0.0 + eps, flat ? shift : 0);
      frame.add(curb);
    }
    // шевроны направления
    const cg = track(new THREE.PlaneGeometry(w * 0.42, L3));
    const cuv = cg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < cuv.count; i++) cuv.setY(i, (cuv.getY(i) * L3) / 2.4);
    const chev = new THREE.Mesh(cg, chevMat);
    chev.rotation.x = -Math.PI / 2;
    chev.position.y = 0.05 + eps;
    chev.renderOrder = 2;
    frame.add(chev);
  }

  for (let i = routeStart; i < group.children.length; i++) group.children[i].traverse((o) => (o.userData.route = true));

  /* Ворота спавна и ядро плента */
  const portals: THREE.Mesh[] = [];
  const starts = new Map<string, { p: THREE.Vector3; yaw: number }>();
  for (const r of map.routes) {
    const a = r.points[0];
    const b = r.points[1];
    const k = keyOf(a);
    if (!starts.has(k)) starts.set(k, { p: new THREE.Vector3(a[0], a[1], a[2]), yaw: Math.atan2(b[0] - a[0], b[2] - a[2]) });
  }
  for (const st of starts.values()) {
    const gate = buildSpawnGate();
    gate.group.position.copy(st.p);
    gate.group.rotation.y = st.yaw;
    gate.group.traverse((o) => (o.userData.prop = 'gate'));
    group.add(gate.group);
    portals.push(gate.portal);
  }
  const lastRoute = map.routes[0].points;
  const end = lastRoute[lastRoute.length - 1];
  const prev = lastRoute[lastRoute.length - 2];
  const dirEnd = new THREE.Vector3(end[0] - prev[0], 0, end[2] - prev[2]).normalize();
  const plantPos = new THREE.Vector3(end[0], end[1], end[2]).addScaledVector(dirEnd, 1.6);
  const plant = new PlantCore(map.plantLetter, map.accent);
  plant.group.position.copy(plantPos);
  plant.group.traverse((o) => (o.userData.prop = 'plant'));
  group.add(plant.group);

  /* Декорации */
  const waterMats: THREE.Texture[] = [];
  const lampGlows: THREE.Sprite[] = [];
  const fountains: THREE.Mesh[] = [];
  const posts: BuiltMap['posts'] = [];
  for (const p of map.props) {
    const n = group.children.length;
    buildProp(p);
    for (let i = n; i < group.children.length; i++) group.children[i].traverse((o) => (o.userData.prop = p.k));
    const postR = p.k === 'tree' ? 0.75 : p.k === 'palm' ? 0.55 : p.k === 'lamp' ? 0.35 : 0;
    if (postR) posts.push({ x: p.p[0], y: p.p[1], z: p.p[2], r: postR });
  }

  function addWindows(cx: number, cz: number, w: number, h: number, d: number, rot: number, y0: number): void {
    const floors = h >= 6 ? 2 : h >= 3.4 ? 1 : 0;
    if (floors === 0) return;
    const rotM = new THREE.Matrix4().makeRotationY(rot);
    const faces: { nx: number; nz: number; len: number; off: number }[] = [
      { nx: 0, nz: 1, len: w, off: d / 2 },
      { nx: 0, nz: -1, len: w, off: d / 2 },
      { nx: 1, nz: 0, len: d, off: w / 2 },
      { nx: -1, nz: 0, len: d, off: w / 2 },
    ];
    for (const f of faces) {
      const count = Math.floor((f.len - 1.5) / 3);
      if (count <= 0) continue;
      const start = -((count - 1) * 3) / 2;
      for (let fl = 0; fl < floors; fl++) {
        const y = y0 + 1.9 + fl * 3;
        if (y + 0.8 > y0 + h - 0.3) continue;
        for (let i = 0; i < count; i++) {
          const along = start + i * 3;
          const lx = f.nx !== 0 ? f.nx * (f.off + 0.03) : along;
          const lz = f.nz !== 0 ? f.nz * (f.off + 0.03) : along;
          const local = new THREE.Vector3(lx, y, lz).applyMatrix4(rotM);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + Math.atan2(f.nx, f.nz));
          m.compose(new THREE.Vector3(cx + local.x, local.y, cz + local.z), q, new THREE.Vector3(1, 1, 1));
          windows.push(m);
        }
      }
    }
  }

  function buildProp(p: PropDef): void {
    const [x, y, z] = p.p;
    const s = p.s ?? [1, 1, 1];
    const rot = THREE.MathUtils.degToRad(p.r ?? 0);
    switch (p.k) {
      case 'box':
      case 'wall':
      case 'pillar': {
        const b = texBox(s[0], s[1], s[2], p.t ?? 'concrete', p.c ?? 0xffffff, p.k === 'wall' ? 4 : 3);
        b.position.set(x, y + s[1] / 2, z);
        b.rotation.y = rot;
        group.add(b);
        break;
      }
      case 'platform': {
        const b = texBox(s[0], s[1], s[2], p.t ?? 'concrete', p.c ?? 0xffffff, 3);
        b.position.set(x, y + s[1] / 2, z);
        b.rotation.y = rot;
        group.add(b);
        // Тонкая окантовка чуть ниже верхней грани: видна только по периметру
        const trim = mesh(track(new THREE.BoxGeometry(s[0] + 0.12, 0.12, s[2] + 0.12)), stdMat(0x3a3530, { rough: 0.8 }));
        trim.position.set(x, y + s[1] - 0.1, z);
        trim.rotation.y = rot;
        group.add(trim);
        break;
      }
      case 'building': {
        const b = texBox(s[0], s[1], s[2], p.t ?? 'plaster', p.c ?? 0xffffff, 4);
        b.position.set(x, y + s[1] / 2, z);
        b.rotation.y = rot;
        group.add(b);
        const rimH = p.v === 1 ? 0.22 : 0.5;
        const rimMat = texMat(p.t ?? 'plaster', new THREE.Color(p.c ?? 0xffffff).multiplyScalar(0.85).getHex());
        const rims: [number, number, number, number][] = [
          [0, s[2] / 2 - 0.12, s[0], 0.24],
          [0, -s[2] / 2 + 0.12, s[0], 0.24],
          [s[0] / 2 - 0.12, 0, 0.24, s[2]],
          [-s[0] / 2 + 0.12, 0, 0.24, s[2]],
        ];
        const rimG = new THREE.Group();
        for (const [ox, oz, rw, rd] of rims) {
          const r = mesh(track(new THREE.BoxGeometry(rw, rimH, rd)), rimMat);
          r.position.set(ox, s[1] + rimH / 2, oz);
          rimG.add(r);
        }
        if (p.v !== 1 && s[0] > 6 && s[2] > 4) {
          const ac = texBox(1.4, 0.9, 1.0, 'metal', 0xc5ccd4, 2);
          ac.position.set(s[0] * 0.2, s[1] + 0.45, 0);
          rimG.add(ac);
          const tank = mesh(track(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 14)), stdMat(0x9ca3af, { metal: 0.5, rough: 0.4 }));
          tank.position.set(-s[0] * 0.25, s[1] + 0.65, 0);
          rimG.add(tank);
        }
        rimG.position.set(x, y, z);
        rimG.rotation.y = rot;
        group.add(rimG);
        addWindows(x, z, s[0], s[1], s[2], rot, y);
        break;
      }
      case 'roofHouse': {
        const g = new THREE.Group();
        const walls = texBox(s[0], s[1], s[2], p.t ?? 'plaster', p.c ?? 0xffffff, 4);
        walls.position.y = s[1] / 2;
        g.add(walls);
        const alongX = s[0] >= s[2];
        const span = alongX ? s[2] : s[0];
        const ridge = alongX ? s[0] : s[2];
        const rh = span * 0.38;
        const shape = new THREE.Shape();
        shape.moveTo(-span / 2 - 0.05, 0);
        shape.lineTo(span / 2 + 0.05, 0);
        shape.lineTo(0, rh);
        shape.closePath();
        const gable = track(new THREE.ExtrudeGeometry(shape, { depth: ridge - 0.1, bevelEnabled: false }));
        const guv2 = gable.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < guv2.count; i++) guv2.setXY(i, guv2.getX(i) / 4, guv2.getY(i) / 4);
        const gm = mesh(gable, texMat(p.t ?? 'plaster', p.c ?? 0xffffff));
        gm.position.set(0, s[1], 0);
        if (alongX) {
          gm.rotation.y = Math.PI / 2;
          gm.position.x = -(ridge - 0.1) / 2;
        } else {
          gm.position.z = -(ridge - 0.1) / 2;
        }
        g.add(gm);
        const slope = Math.hypot(span / 2, rh) + 0.5;
        const ang = Math.atan2(rh, span / 2);
        for (const side of [-1, 1]) {
          const rg = track(new THREE.BoxGeometry(ridge + 0.7, 0.14, slope));
          boxUV(rg, ridge + 0.7, 0.14, slope, 2.5);
          const roofM = mesh(rg, texMat('roof', 0xffffff));
          const holder = new THREE.Object3D();
          holder.position.set(0, s[1] + rh / 2, 0);
          if (!alongX) holder.rotation.y = Math.PI / 2;
          roofM.position.set(0, 0.02, side * (span / 4 + 0.12));
          roofM.rotation.x = side * ang;
          holder.add(roofM);
          g.add(holder);
        }
        if (p.v === 1) {
          const ch = texBox(0.7, 1.6, 0.7, 'brick', 0xffffff, 2);
          ch.position.set(alongX ? ridge * 0.25 : span * 0.15, s[1] + rh * 0.7, alongX ? span * 0.15 : ridge * 0.25);
          g.add(ch);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        addWindows(x, z, s[0], s[1], s[2], rot, y);
        break;
      }
      case 'crate': {
        const v = p.v ?? 1.2;
        const c = texBox(v, v, v, 'crate', p.c ?? 0xffffff, v);
        c.position.set(x, y + v / 2, z);
        c.rotation.y = rot;
        group.add(c);
        break;
      }
      case 'barrel': {
        const g = new THREE.Group();
        const col = p.c ?? 0x1d4ed8;
        const drum = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.25, 16), stdMat(col, { rough: 0.5, metal: 0.4 }));
        drum.position.y = 0.625;
        g.add(drum);
        for (const ry of [0.25, 0.65, 1.05]) {
          const ringM = mesh(new THREE.TorusGeometry(0.425, 0.025, 6, 20), stdMat(new THREE.Color(col).multiplyScalar(0.6).getHex(), { metal: 0.5, rough: 0.4 }), false);
          ringM.rotation.x = Math.PI / 2;
          ringM.position.y = ry;
          g.add(ringM);
        }
        const lid = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 16), stdMat(0x3f3f46, { metal: 0.5 }), false);
        lid.position.y = 1.26;
        g.add(lid);
        g.position.set(x, y, z);
        group.add(g);
        break;
      }
      case 'column': {
        const h = s[1];
        const r = s[0] / 2;
        const g = new THREE.Group();
        const base = texBox(r * 2.6, 0.3, r * 2.6, 'sandstone', 0xf0d8b0, 2);
        base.position.y = 0.15;
        g.add(base);
        const shaft = mesh(track(new THREE.CylinderGeometry(r, r * 1.08, h - 0.6, 14)), texMat('sandstone', 0xf2dcb4));
        shaft.position.y = 0.3 + (h - 0.6) / 2;
        g.add(shaft);
        const cap = texBox(r * 2.8, 0.3, r * 2.8, 'sandstone', 0xf0d8b0, 2);
        cap.position.y = h - 0.15;
        g.add(cap);
        g.position.set(x, y, z);
        group.add(g);
        break;
      }
      case 'arch': {
        const span = s[0];
        const h = s[1];
        const th = s[2];
        const t = p.t ?? 'sandstone';
        const tint = p.c ?? 0xf0d6ac;
        const g = new THREE.Group();
        for (const side of [-1, 1]) {
          const pil = texBox(0.9, h, th, t, tint, 3);
          pil.position.set(side * (span / 2), h / 2, 0);
          g.add(pil);
        }
        const lintel = texBox(span + 0.9, 0.9, th + 0.1, t, tint, 3);
        lintel.position.y = h - 0.45;
        g.add(lintel);
        const R = span / 2 - 0.45;
        const ring = mesh(track(new THREE.TorusGeometry(R, 0.28, 8, 20, Math.PI)), texMat(t, tint));
        ring.position.y = h - 0.9 - R + 0.1;
        ring.scale.z = th / 0.56;
        g.add(ring);
        for (const side of [-1, 1]) {
          const sp = texBox(0.9, 1.0, th, t, tint, 3);
          sp.position.set(side * (R - 0.15), h - 1.35, 0);
          g.add(sp);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'palm': {
        const h = p.v ?? 6;
        const g = new THREE.Group();
        const trunkMat = stdMat(0x8b6b4a, { rough: 0.95, flat: true });
        const segs = 7;
        let px = 0;
        for (let i = 0; i < segs; i++) {
          const seg = mesh(new THREE.CylinderGeometry(0.17 - i * 0.012, 0.21 - i * 0.012, h / segs + 0.05, 8), trunkMat);
          px += 0.05 + i * 0.012;
          seg.position.set(px, (i + 0.5) * (h / segs), 0);
          seg.rotation.z = -0.06 - i * 0.012;
          g.add(seg);
        }
        const top = new THREE.Vector3(px + 0.1, h, 0);
        const leafMat = stdMat(0x3f7d2c, { rough: 0.8, flat: true });
        const leafMat2 = stdMat(0x2f6b22, { rough: 0.8, flat: true });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const holder = new THREE.Object3D();
          holder.position.copy(top);
          holder.rotation.y = a;
          const leaf = mesh(new THREE.BoxGeometry(0.55, 0.04, 2.6), i % 2 ? leafMat : leafMat2);
          leaf.position.set(0, -0.35, 1.15);
          leaf.rotation.x = 0.45 + (i % 3) * 0.12;
          holder.add(leaf);
          g.add(holder);
        }
        for (let i = 0; i < 3; i++) {
          const coco = mesh(new THREE.SphereGeometry(0.13, 8, 6), stdMat(0x5b3a1e), false);
          coco.position.set(top.x + Math.cos(i * 2.1) * 0.22, h - 0.25, Math.sin(i * 2.1) * 0.22);
          g.add(coco);
        }
        g.position.set(x, y, z);
        g.rotation.y = (x * 13.37 + z * 7.1) % (Math.PI * 2);
        group.add(g);
        break;
      }
      case 'tree': {
        const h = p.v ?? 4.5;
        const g = new THREE.Group();
        const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.28, h * 0.55, 8), stdMat(0x5c4030, { rough: 0.95 }));
        trunk.position.y = h * 0.275;
        g.add(trunk);
        const fol = [0x4d7c2f, 0x3f6b26, 0x5a8a35];
        const blobs: [number, number, number, number][] = [
          [0, h * 0.72, 0, 1.5],
          [0.7, h * 0.62, 0.4, 1.1],
          [-0.6, h * 0.66, -0.3, 1.15],
          [0.1, h * 0.92, -0.2, 1.0],
        ];
        blobs.forEach(([bx, by, bz, br], i) => {
          const b = mesh(new THREE.IcosahedronGeometry(br, 1), stdMat(fol[i % 3], { rough: 0.85, flat: true }));
          b.position.set(bx, by, bz);
          g.add(b);
        });
        g.position.set(x, y, z);
        group.add(g);
        break;
      }
      case 'stall': {
        const g = new THREE.Group();
        const [sw, sh, sd] = s;
        const wood = stdMat(0x7a5232, { rough: 0.9 });
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
          const post = mesh(new THREE.CylinderGeometry(0.06, 0.06, sh, 6), wood);
          post.position.set((ox * sw) / 2, sh / 2, (oz * sd) / 2);
          g.add(post);
        }
        const counter = texBox(sw, 0.9, sd * 0.45, 'wood', 0xffffff, 2);
        counter.position.set(0, 0.45, sd * 0.25);
        g.add(counter);
        const aw = mesh(track(new THREE.BoxGeometry(sw + 0.5, 0.05, sd + 0.6)), texMat('awning', p.c ?? 0xb91c1c));
        aw.position.set(0, sh + 0.1, 0);
        aw.rotation.x = 0.18;
        g.add(aw);
        const goods = [0xf59e0b, 0xef4444, 0x84cc16, 0xfde68a];
        for (let i = 0; i < 5; i++) {
          const gd2 = mesh(new THREE.SphereGeometry(0.16, 8, 6), stdMat(goods[i % 4], { rough: 0.6 }), false);
          gd2.position.set(-sw / 2 + 0.4 + i * ((sw - 0.8) / 4), 1.0, sd * 0.25);
          g.add(gd2);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'container': {
        const g = new THREE.Group();
        const col = p.c ?? 0xb45309;
        const body = texBox(6, 2.6, 2.4, 'container', col, 2.4);
        body.position.y = 1.3;
        g.add(body);
        const frameMat = stdMat(new THREE.Color(col).multiplyScalar(0.55).getHex(), { metal: 0.5, rough: 0.5 });
        for (const ex of [-3, 3]) {
          const fr = mesh(new THREE.BoxGeometry(0.12, 2.64, 2.44), frameMat);
          fr.position.set(ex, 1.3, 0);
          g.add(fr);
        }
        for (const bz of [-0.6, 0.6]) {
          const bar = mesh(new THREE.BoxGeometry(0.06, 2.3, 0.06), frameMat, false);
          bar.position.set(3.05, 1.3, bz);
          g.add(bar);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'reactor': {
        const g = new THREE.Group();
        const R = s[0] / 2;
        const H = s[1];
        const body = mesh(track(new THREE.CylinderGeometry(R * 0.85, R, H * 0.62, 32)), texMat('concrete', 0xb4bcc6));
        body.position.y = (H * 0.62) / 2;
        g.add(body);
        const dome = mesh(track(new THREE.SphereGeometry(R * 0.85, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)), texMat('concrete', 0xc2c9d1));
        dome.position.y = H * 0.62;
        g.add(dome);
        const glowMat = stdMat(0x38bdf8, { emissive: 0x0ea5e9, ei: 2.2, rough: 0.3 });
        for (const ry of [H * 0.2, H * 0.45]) {
          const band = mesh(track(new THREE.TorusGeometry(R * 0.93 - ry * 0.02, 0.1, 8, 40)), glowMat, false);
          band.rotation.x = Math.PI / 2;
          band.position.y = ry;
          g.add(band);
        }
        const stack = mesh(track(new THREE.CylinderGeometry(0.7, 0.9, H * 0.5, 16)), texMat('metal', 0xcbd5e1));
        stack.position.set(R * 0.5, H * 0.62 + H * 0.25, -R * 0.2);
        g.add(stack);
        const stripe = mesh(track(new THREE.CylinderGeometry(0.72, 0.72, 0.5, 16)), texMat('hazard'), false);
        stripe.position.set(R * 0.5, H * 0.62 + H * 0.45, -R * 0.2);
        g.add(stripe);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const pipe = mesh(new THREE.CylinderGeometry(0.25, 0.25, H * 0.5, 10), stdMat(0x94a3b8, { metal: 0.6, rough: 0.35 }));
          pipe.position.set(Math.cos(a) * (R + 0.35), H * 0.25, Math.sin(a) * (R + 0.35));
          g.add(pipe);
        }
        g.position.set(x, y, z);
        group.add(g);
        break;
      }
      case 'tank': {
        const g = new THREE.Group();
        const len = s[0];
        const r = s[1] / 2;
        const body = mesh(track(new THREE.CylinderGeometry(r, r, len, 20)), stdMat(p.c ?? 0xcbd5e1, { metal: 0.5, rough: 0.4 }));
        body.rotation.z = Math.PI / 2;
        body.position.y = r + 0.4;
        g.add(body);
        for (const e of [-1, 1]) {
          const cap = mesh(track(new THREE.SphereGeometry(r, 20, 10)), stdMat(p.c ?? 0xcbd5e1, { metal: 0.5, rough: 0.4 }));
          cap.scale.set(0.35, 1, 1);
          cap.position.set((e * len) / 2, r + 0.4, 0);
          g.add(cap);
          const leg = texBox(0.4, r + 0.4, r * 1.6, 'concrete', 0x9ca3af, 2);
          leg.position.set(e * len * 0.32, (r + 0.4) / 2, 0);
          g.add(leg);
        }
        const band = mesh(track(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.4, 20)), texMat('hazard'), false);
        band.rotation.z = Math.PI / 2;
        band.position.y = r + 0.4;
        g.add(band);
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'pipe': {
        const pm = mesh(track(new THREE.CylinderGeometry(s[1] / 2, s[1] / 2, s[0], 12)), stdMat(p.c ?? 0x94a3b8, { metal: 0.6, rough: 0.35 }));
        pm.rotation.z = Math.PI / 2;
        const holder = new THREE.Object3D();
        holder.position.set(x, y, z);
        holder.rotation.y = rot;
        holder.add(pm);
        for (let i = -1; i <= 1; i++) {
          const br = mesh(new THREE.BoxGeometry(0.15, s[1] + 0.2, s[1] + 0.2), stdMat(0x475569, { metal: 0.5 }), false);
          br.position.set((i * s[0]) / 3, 0, 0);
          holder.add(br);
        }
        group.add(holder);
        break;
      }
      case 'fountain': {
        const R = p.v ?? 2.2;
        const g = new THREE.Group();
        const stone = texMat('sandstone', 0xe7dccb);
        const basin = mesh(track(new THREE.CylinderGeometry(R, R + 0.15, 0.7, 28)), stone);
        basin.position.y = 0.35;
        g.add(basin);
        const wtex = getWaterTexture();
        waterMats.push(wtex);
        const water = mesh(track(new THREE.CircleGeometry(R - 0.2, 28)), new THREE.MeshStandardMaterial({ map: wtex, color: 0x9be7ff, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.9 }), false);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.6;
        water.receiveShadow = true;
        g.add(water);
        const col = mesh(track(new THREE.CylinderGeometry(0.28, 0.38, 1.8, 14)), stone);
        col.position.y = 1.2;
        g.add(col);
        const bowl = mesh(track(new THREE.CylinderGeometry(0.95, 0.5, 0.3, 20)), stone);
        bowl.position.y = 2.15;
        g.add(bowl);
        const spray = mesh(
          track(new THREE.ConeGeometry(0.85, 1.2, 18, 1, true)),
          new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
          false,
        );
        spray.position.y = 2.75;
        spray.rotation.x = Math.PI;
        g.add(spray);
        fountains.push(spray);
        g.position.set(x, y, z);
        group.add(g);
        break;
      }
      case 'water': {
        const wtex = getWaterTexture();
        waterMats.push(wtex);
        const geo = track(new THREE.PlaneGeometry(s[0], s[2]));
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * s[0]) / 5, (uv.getY(i) * s[2]) / 5);
        const wm = mesh(geo, new THREE.MeshStandardMaterial({ map: wtex, color: 0x8fdcef, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.88 }), false);
        wm.receiveShadow = true;
        wm.rotation.x = -Math.PI / 2;
        wm.position.set(x, y, z);
        group.add(wm);
        // дно канала
        const bed = mesh(track(new THREE.PlaneGeometry(s[0], s[2])), stdMat(0x2b3a3f, { rough: 1 }), false);
        bed.rotation.x = -Math.PI / 2;
        bed.position.set(x, 0.012, z);
        group.add(bed);
        break;
      }
      case 'rail': {
        const holder = new THREE.Object3D();
        holder.position.set(x, y, z);
        holder.rotation.y = rot;
        const railMat = stdMat(p.c ?? 0x9ca3af, { metal: 0.6, rough: 0.35 });
        const len = s[0];
        const h = s[1];
        const top = mesh(new THREE.BoxGeometry(len, 0.07, 0.07), railMat);
        top.position.y = h;
        holder.add(top);
        const midR = mesh(new THREE.BoxGeometry(len, 0.04, 0.04), railMat, false);
        midR.position.y = h * 0.5;
        holder.add(midR);
        const n = Math.max(1, Math.round(len / 1.5));
        for (let i = 0; i <= n; i++) {
          const post = mesh(new THREE.BoxGeometry(0.06, h, 0.06), railMat, false);
          post.position.set(-len / 2 + (i * len) / n, h / 2, 0);
          holder.add(post);
        }
        group.add(holder);
        break;
      }
      case 'sandbags': {
        const g = new THREE.Group();
        const bagMat = stdMat(0xb59b6a, { rough: 0.95 });
        const len = s[0];
        const n = Math.max(2, Math.round(len / 0.6));
        for (let row = 0; row < 2; row++) {
          for (let i = 0; i < n - row; i++) {
            const bag = mesh(new THREE.SphereGeometry(0.34, 10, 6), bagMat);
            bag.scale.set(1, 0.5, 0.7);
            bag.position.set(-len / 2 + 0.3 + i * (len / n) + row * 0.3, 0.17 + row * 0.32, 0);
            g.add(bag);
          }
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'lamp': {
        const h = p.v ?? 3.6;
        const g = new THREE.Group();
        const poleMat = stdMat(0x27272a, { metal: 0.6, rough: 0.4 });
        const pole = mesh(new THREE.CylinderGeometry(0.06, 0.09, h, 8), poleMat);
        pole.position.y = h / 2;
        g.add(pole);
        const arm = mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), poleMat, false);
        arm.position.set(0.32, h - 0.05, 0);
        g.add(arm);
        const headM = mesh(new THREE.BoxGeometry(0.35, 0.15, 0.25), poleMat, false);
        headM.position.set(0.62, h - 0.1, 0);
        g.add(headM);
        const lc = p.c ?? 0xffd28a;
        const bulb = mesh(new THREE.BoxGeometry(0.28, 0.04, 0.2), stdMat(lc, { emissive: lc, ei: 3 }), false);
        bulb.position.set(0.62, h - 0.19, 0);
        g.add(bulb);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: lc, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.scale.set(1.8, 1.8, 1);
        glow.position.set(0.62, h - 0.25, 0);
        g.add(glow);
        lampGlows.push(glow);
        g.position.set(x, y, z);
        g.rotation.y = (x * 3.3 + z) % (Math.PI * 2);
        group.add(g);
        break;
      }
      case 'vent': {
        const g = new THREE.Group();
        const b = texBox(s[0], s[1], s[2], 'metal', p.c ?? 0xb0bac6, 2);
        b.position.y = s[1] / 2;
        g.add(b);
        const grill = stdMat(0x1f2937, { rough: 0.6 });
        for (let i = 0; i < 5; i++) {
          const slat = mesh(new THREE.BoxGeometry(s[0] * 0.8, 0.05, 0.04), grill, false);
          slat.position.set(0, s[1] * 0.2 + i * (s[1] * 0.14), s[2] / 2 + 0.02);
          g.add(slat);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'stairs': {
        const [sw, sh, sl] = s;
        const g = new THREE.Group();
        const n = Math.max(3, Math.round(sh / 0.28));
        for (let i = 0; i < n; i++) {
          const stepH = ((i + 1) * sh) / n;
          const st = texBox(sl / n + 0.02, stepH, sw, p.t ?? 'concrete', p.c ?? 0xffffff, 2);
          st.position.set(-sl / 2 + (i + 0.5) * (sl / n), stepH / 2, 0);
          g.add(st);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'carpetHang': {
        const geo = track(new THREE.BoxGeometry(s[0], s[1], s[2]));
        boxUV(geo, s[0], s[1], s[2], s[0], s[1]);
        const tint = new THREE.Color(p.c ?? 0xb91c1c).lerp(new THREE.Color(0xffffff), 0.55).getHex();
        const cm = mesh(geo, texMat('carpet', tint));
        cm.position.set(x, y, z);
        cm.rotation.y = rot;
        group.add(cm);
        const rod = mesh(new THREE.CylinderGeometry(0.04, 0.04, s[0] + 0.4, 6), stdMat(0x6b4423), false);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(x, y + s[1] / 2 + 0.05, z + 0.03);
        group.add(rod);
        break;
      }
      case 'vase': {
        const k = p.v ?? 1;
        const pts: THREE.Vector2[] = [
          new THREE.Vector2(0.0, 0),
          new THREE.Vector2(0.18, 0),
          new THREE.Vector2(0.3, 0.2),
          new THREE.Vector2(0.34, 0.45),
          new THREE.Vector2(0.24, 0.72),
          new THREE.Vector2(0.14, 0.85),
          new THREE.Vector2(0.18, 0.95),
          new THREE.Vector2(0.16, 0.97),
        ];
        const vm = mesh(new THREE.LatheGeometry(pts, 14), stdMat(p.c ?? 0xb45309, { rough: 0.75 }));
        vm.scale.setScalar(k * 1.2);
        vm.position.set(x, y, z);
        group.add(vm);
        break;
      }
      case 'car': {
        const g = new THREE.Group();
        const col = p.c ?? 0xe5e7eb;
        const paint = stdMat(col, { rough: 0.35, metal: 0.5 });
        const body = mesh(new THREE.BoxGeometry(4.2, 1.0, 1.9), paint);
        body.position.y = 0.85;
        g.add(body);
        const cabin = mesh(new THREE.BoxGeometry(2.6, 1.0, 1.8), paint);
        cabin.position.set(-0.5, 1.8, 0);
        g.add(cabin);
        const glass = stdMat(0x1e293b, { rough: 0.1, metal: 0.6 });
        const ws = mesh(new THREE.BoxGeometry(0.05, 0.75, 1.6), glass, false);
        ws.position.set(0.82, 1.8, 0);
        g.add(ws);
        for (const side of [-1, 1]) {
          const sw2 = mesh(new THREE.BoxGeometry(2.2, 0.6, 0.05), glass, false);
          sw2.position.set(-0.5, 1.85, side * 0.91);
          g.add(sw2);
        }
        const tire = stdMat(0x111111, { rough: 0.9 });
        for (const [wx, wz] of [[1.35, 0.9], [1.35, -0.9], [-1.35, 0.9], [-1.35, -0.9]] as [number, number][]) {
          const wh = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), tire);
          wh.rotation.x = Math.PI / 2;
          wh.position.set(wx, 0.42, wz);
          g.add(wh);
        }
        for (const side of [-0.6, 0.6]) {
          const hl = mesh(new THREE.BoxGeometry(0.05, 0.2, 0.35), stdMat(0xfff7d6, { emissive: 0xfff2c0, ei: 1.5 }), false);
          hl.position.set(2.11, 0.95, side);
          g.add(hl);
          const tl = mesh(new THREE.BoxGeometry(0.05, 0.2, 0.3), stdMat(0xff2a2a, { emissive: 0xff0000, ei: 1.2 }), false);
          tl.position.set(-2.11, 0.95, side);
          g.add(tl);
        }
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'barrier': {
        const g = new THREE.Group();
        const len = s[0];
        const base = texBox(len, 0.35, 0.7, 'concrete', 0xc9ced4, 2);
        base.position.y = 0.175;
        g.add(base);
        const top = texBox(len, 0.55, 0.3, 'concrete', 0xc9ced4, 2);
        top.position.y = 0.62;
        g.add(top);
        const stripe = texBox(len, 0.12, 0.31, 'hazard', 0xffffff, 1);
        stripe.position.y = 0.75;
        g.add(stripe);
        g.position.set(x, y, z);
        g.rotation.y = rot;
        group.add(g);
        break;
      }
      case 'floor': {
        const geo = track(new THREE.PlaneGeometry(s[0], s[2]));
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const tile = p.t === 'hazard' ? 1.5 : 3;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * s[0]) / tile, (uv.getY(i) * s[2]) / tile);
        const fm = mesh(geo, texMat(p.t ?? 'tiles', p.c ?? 0xffffff), false);
        fm.receiveShadow = true;
        fm.rotation.x = -Math.PI / 2;
        fm.rotation.z = rot;
        fm.position.set(x, y + 0.015, z);
        group.add(fm);
        break;
      }
      case 'decal': {
        const dm = mesh(
          track(new THREE.PlaneGeometry(s[0], s[2])),
          new THREE.MeshBasicMaterial({ map: decalTexture(p.txt ?? 'A', p.c ?? 0xdc2626), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
          false,
        );
        dm.rotation.x = -Math.PI / 2;
        dm.rotation.z = rot;
        dm.position.set(x, y + 0.03, z);
        dm.renderOrder = 1;
        group.add(dm);
        break;
      }
      case 'chimney': {
        const ch = texBox(s[0], s[1], s[2], 'brick', 0xffffff, 2);
        ch.position.set(x, y + s[1] / 2, z);
        group.add(ch);
        break;
      }
      case 'cable': {
        const len = s[0];
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-len / 2, 0, 0),
          new THREE.Vector3(0, -0.9, 0),
          new THREE.Vector3(len / 2, 0, 0),
        ]);
        const cm = mesh(track(new THREE.TubeGeometry(curve, 20, Math.max(0.03, s[1]), 5, false)), stdMat(0x111111), false);
        cm.position.set(x, y, z);
        cm.rotation.y = rot;
        group.add(cm);
        break;
      }
    }
  }

  /* Окна — один InstancedMesh на всю карту */
  if (windows.length) {
    const wg = track(new THREE.PlaneGeometry(0.95, 1.35));
    const wm = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ map: windowTexture(map.theme.warm), roughness: 0.25, metalness: 0.3 }), windows.length);
    windows.forEach((m, i) => wm.setMatrixAt(i, m));
    wm.instanceMatrix.needsUpdate = true;
    wm.receiveShadow = true;
    group.add(wm);
  }

  /* Поверхности для установки: всё непрозрачное, кроме листвы, фонарей, проводов и декалей
     (вода и прочие прозрачные поверхности остаются в списке, чтобы на них нельзя было встать) */
  const placeMeshes: THREE.Mesh[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) return;
    const prop = m.userData.prop as string | undefined;
    if (prop && PASS_THROUGH.has(prop)) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent && prop !== 'water' && prop !== 'fountain') return;
    placeMeshes.push(m);
  });

  let time = 0;
  return {
    group,
    placeMeshes,
    posts,
    plant,
    plantPos,
    portals,
    update(dt: number) {
      time += dt;
      chevTex.offset.y += dt * 0.55;
      for (const wt of waterMats) {
        wt.offset.x += dt * 0.03;
        wt.offset.y += dt * 0.015;
      }
      for (const f of fountains) {
        const k = 1 + Math.sin(time * 6) * 0.05;
        f.scale.set(k, 1 + Math.sin(time * 4) * 0.08, k);
      }
      for (let i = 0; i < portals.length; i++) {
        (portals[i].material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time * 3 + i) * 0.15;
      }
      for (let i = 0; i < lampGlows.length; i++) lampGlows[i].material.opacity = 0.5 + Math.sin(time * 9 + i * 3) * 0.04;
      plant.update(dt);
    },
    dispose() {
      group.removeFromParent();
      for (const g of disposables) g.dispose();
      chevMat.dispose();
    },
  };
}
