import * as THREE from 'three';
import type { TextureKind } from '../types/game';

/**
 * Генератор процедурных CanvasTexture. Никаких внешних файлов: всё рисуется на canvas
 * один раз и кешируется. Текстуры тайлятся (RepeatWrapping), плотность задаётся через UV.
 */

let maxAnisotropy = 4;
export function setMaxAnisotropy(v: number): void {
  maxAnisotropy = Math.max(1, Math.min(8, v));
}

const cache = new Map<string, THREE.Texture>();

/** Детерминированный ГПСЧ, чтобы текстуры были одинаковыми при каждом запуске */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return [c, ctx];
}

function finalize(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function shade(color: string, amt: number): string {
  const c = new THREE.Color(color);
  if (amt >= 0) c.lerp(new THREE.Color(1, 1, 1), amt);
  else c.lerp(new THREE.Color(0, 0, 0), -amt);
  return '#' + c.getHexString();
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rand: () => number, light: string, dark: string, maxR = 1.6, alpha = 0.35): void {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = rand() * alpha;
    ctx.fillStyle = rand() > 0.5 ? light : dark;
    const r = rand() * maxR + 0.3;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rand: () => number, colors: string[], maxR: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = maxR * (0.3 + rand() * 0.7);
    const col = colors[Math.floor(rand() * colors.length)];
    // Рисуем с переносом через края, чтобы текстура тайлилась без швов
    for (const dx of [-w, 0, w]) {
      for (const dy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alpha * rand();
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function crack(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, rand: () => number, color: string, width = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rand() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (rand() - 0.5) * 1.1;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ------------------------------- Генераторы ------------------------------- */

function sandstone(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(11);
  ctx.fillStyle = '#b8976a';
  ctx.fillRect(0, 0, S, S);
  const rowH = 64;
  for (let row = 0; row < S / rowH; row++) {
    let x = -rand() * 80;
    while (x < S) {
      const w = 90 + rand() * 90;
      const tone = 0.82 + rand() * 0.18;
      const base = new THREE.Color(0.86 * tone, 0.74 * tone, 0.55 * tone);
      const y = row * rowH;
      const grd = ctx.createLinearGradient(0, y, 0, y + rowH);
      grd.addColorStop(0, '#' + base.clone().offsetHSL(0, 0, 0.06).getHexString());
      grd.addColorStop(1, '#' + base.clone().offsetHSL(0, 0, -0.04).getHexString());
      ctx.fillStyle = grd;
      // с переносом по горизонтали для бесшовности
      for (const dx of [0, S, -S]) ctx.fillRect(x + 3 + dx, y + 3, w - 6, rowH - 6);
      // эрозия
      ctx.fillStyle = 'rgba(120,90,50,0.18)';
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.arc(x + rand() * w, y + rand() * rowH, rand() * 5 + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      // светлая верхняя грань
      ctx.fillStyle = 'rgba(255,240,210,0.25)';
      ctx.fillRect(x + 3, y + 3, w - 6, 3);
      x += w;
    }
  }
  speckle(ctx, S, S, 5000, rand, '#f3dfb8', '#7a5c38', 1.4, 0.4);
  return c;
}

function carpet(): HTMLCanvasElement {
  const W = 256;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const rand = mulberry32(7);
  ctx.fillStyle = '#7d1717';
  ctx.fillRect(0, 0, W, H);
  // поле: ромбическая решётка
  const cell = 64;
  for (let y = -cell; y < H + cell; y += cell) {
    for (let x = 0; x <= W; x += cell) {
      const ox = (y / cell) % 2 === 0 ? 0 : cell / 2;
      const cx = x + ox;
      const cy = y;
      ctx.fillStyle = '#9b1c1c';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 28);
      ctx.lineTo(cx + 22, cy);
      ctx.lineTo(cx, cy + 28);
      ctx.lineTo(cx - 22, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d4a017';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx + 9, cy);
      ctx.lineTo(cx, cy + 12);
      ctx.lineTo(cx - 9, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f5e6c8';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // боковые бордюры
  const band = (x: number, w: number) => {
    ctx.fillStyle = '#1e2a5a';
    ctx.fillRect(x, 0, w, H);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(x + 3, 0, 2, H);
    ctx.fillRect(x + w - 5, 0, 2, H);
    for (let y = 0; y < H; y += 24) {
      ctx.fillStyle = '#c2410c';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2 + 7, y + 12);
      ctx.lineTo(x + w / 2, y + 24);
      ctx.lineTo(x + w / 2 - 7, y + 12);
      ctx.closePath();
      ctx.fill();
    }
  };
  band(0, 30);
  band(W - 30, 30);
  speckle(ctx, W, H, 3000, rand, '#ffd7b0', '#2a0505', 1, 0.25);
  return c;
}

function crate(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(21);
  ctx.fillStyle = '#9a6a35';
  ctx.fillRect(0, 0, S, S);
  // доски
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const x = (i * S) / planks;
    const tone = 0.9 + rand() * 0.2;
    ctx.fillStyle = shade('#a8743c', (tone - 1) * 0.8);
    ctx.fillRect(x + 2, 0, S / planks - 4, S);
    ctx.strokeStyle = 'rgba(70,40,15,0.35)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 7; g++) {
      ctx.beginPath();
      const gx = x + 6 + rand() * (S / planks - 12);
      ctx.moveTo(gx, 0);
      for (let y = 0; y <= S; y += 16) ctx.lineTo(gx + Math.sin(y * 0.05 + g) * 3, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,20,5,0.6)';
    ctx.fillRect(x, 0, 2, S);
  }
  // рамка
  ctx.strokeStyle = '#5c3a18';
  ctx.lineWidth = 22;
  ctx.strokeRect(11, 11, S - 22, S - 22);
  ctx.strokeStyle = 'rgba(255,220,170,0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  // диагональная распорка
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#6e4620';
  ctx.fillRect(-S * 0.62, -12, S * 1.24, 24);
  ctx.fillStyle = 'rgba(255,220,170,0.12)';
  ctx.fillRect(-S * 0.62, -12, S * 1.24, 3);
  ctx.restore();
  // гвозди
  ctx.fillStyle = '#c8c8c8';
  for (const [nx, ny] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11], [S / 2, 11], [S / 2, S - 11]]) {
    ctx.beginPath();
    ctx.arc(nx, ny, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // трафаретная маркировка
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = '#1b1208';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CA-07', S / 2, S / 2 - 40);
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('▲ ▲', S / 2, S / 2 + 44);
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText('HANDLE WITH CARE', S / 2, S / 2 + 72);
  ctx.restore();
  speckle(ctx, S, S, 1200, rand, '#e8c08a', '#3a2008', 1.2, 0.3);
  return c;
}

function concrete(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(31);
  ctx.fillStyle = '#a3a9b1';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 40, rand, ['#8a919a', '#b7bcc3', '#949aa3'], 90, 0.5);
  speckle(ctx, S, S, 9000, rand, '#d4d8dd', '#5d636b', 1.1, 0.45);
  // швы плит
  ctx.fillStyle = 'rgba(60,64,70,0.55)';
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.fillRect(0, S / 2, S, 2);
  ctx.fillRect(S / 2, 0, 2, S);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, 3, S, 1);
  for (let i = 0; i < 7; i++) crack(ctx, rand() * S, rand() * S, 6 + Math.floor(rand() * 8), rand, 'rgba(50,52,56,0.45)', 1);
  // потёки
  for (let i = 0; i < 10; i++) {
    const x = rand() * S;
    const g = ctx.createLinearGradient(x, 0, x, 140);
    g.addColorStop(0, 'rgba(70,72,78,0.18)');
    g.addColorStop(1, 'rgba(70,72,78,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, rand() * S, 6 + rand() * 10, 140);
  }
  return c;
}

function metal(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(41);
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#7b8591');
  g.addColorStop(1, '#5f6874');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // рёбра жёсткости
  const rib = 32;
  for (let x = 0; x < S; x += rib) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 4, 0, 4, S);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 8, 0, 3, S);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 11, 0, 12, S);
  }
  // заклёпки
  for (const y of [10, S - 10]) {
    for (let x = 16; x < S; x += rib) {
      ctx.fillStyle = '#3d444d';
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, S, 2);
  ctx.fillRect(0, S - 2, S, 2);
  // царапины
  ctx.strokeStyle = 'rgba(220,230,240,0.18)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = rand() * 1.2;
    ctx.beginPath();
    const x = rand() * S;
    const y = rand() * S;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 12);
    ctx.stroke();
  }
  blotches(ctx, S, S, 10, rand, ['#8b5a2b', '#4b3621'], 30, 0.25);
  return c;
}

function cobble(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(51);
  ctx.fillStyle = '#6b6156';
  ctx.fillRect(0, 0, S, S);
  const rows = 9;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 === 0 ? 0 : -rh * 0.5;
    while (x < S) {
      const w = rh * (0.85 + rand() * 0.5);
      const cx = x + w / 2;
      const cy = r * rh + rh / 2;
      const tone = 0.75 + rand() * 0.3;
      const col = new THREE.Color(0.68 * tone, 0.62 * tone, 0.55 * tone);
      for (const dx of [0, S, -S]) {
        const gx = cx + dx;
        const grd = ctx.createRadialGradient(gx - w * 0.15, cy - rh * 0.2, 2, gx, cy, w * 0.6);
        grd.addColorStop(0, '#' + col.clone().offsetHSL(0, 0, 0.12).getHexString());
        grd.addColorStop(1, '#' + col.clone().offsetHSL(0, 0, -0.08).getHexString());
        ctx.fillStyle = grd;
        ctx.beginPath();
        const pts = 9;
        for (let k = 0; k < pts; k++) {
          const a = (k / pts) * Math.PI * 2;
          const rr = 0.86 + rand() * 0.14;
          const px = gx + Math.cos(a) * (w / 2 - 3) * rr;
          const py = cy + Math.sin(a) * (rh / 2 - 3) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
      x += w;
    }
  }
  speckle(ctx, S, S, 4000, rand, '#cfc4b4', '#231d18', 1, 0.3);
  return c;
}

function sand(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(61);
  ctx.fillStyle = '#e0c491';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 50, rand, ['#d2b07a', '#ecd5a8', '#c9a46c'], 80, 0.45);
  // ветровая рябь
  ctx.strokeStyle = 'rgba(150,110,60,0.13)';
  ctx.lineWidth = 2;
  for (let y = 0; y < S; y += 14) {
    ctx.beginPath();
    for (let x = 0; x <= S; x += 8) {
      const yy = y + Math.sin((x / S) * Math.PI * 4 + y * 0.3) * 4;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  speckle(ctx, S, S, 14000, rand, '#fff1d2', '#8f6a3c', 1, 0.45);
  // камешки
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#9b8366' : '#b8a081';
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, 2 + rand() * 3, 1.5 + rand() * 2, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function plaster(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(71);
  ctx.fillStyle = '#ece2d0';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 30, rand, ['#d8cab2', '#f6efe2', '#cbb99c'], 60, 0.55);
  speckle(ctx, S, S, 3500, rand, '#ffffff', '#8c7a60', 1, 0.3);
  for (let i = 0; i < 4; i++) crack(ctx, rand() * S, rand() * S, 5 + Math.floor(rand() * 6), rand, 'rgba(120,100,80,0.35)', 1);
  return c;
}

function roof(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(81);
  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(0, 0, S, S);
  const rowH = 32;
  const tileW = 32;
  for (let r = 0; r < S / rowH + 1; r++) {
    const off = r % 2 === 0 ? 0 : tileW / 2;
    for (let x = -tileW; x < S + tileW; x += tileW) {
      const tone = 0.85 + rand() * 0.25;
      const base = new THREE.Color(0.72 * tone, 0.33 * tone, 0.17 * tone);
      const cx = x + off + tileW / 2;
      const y = r * rowH;
      const grd = ctx.createLinearGradient(cx - tileW / 2, 0, cx + tileW / 2, 0);
      grd.addColorStop(0, '#' + base.clone().offsetHSL(0, 0, -0.08).getHexString());
      grd.addColorStop(0.45, '#' + base.clone().offsetHSL(0, 0, 0.1).getHexString());
      grd.addColorStop(1, '#' + base.clone().offsetHSL(0, 0, -0.12).getHexString());
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(cx - tileW / 2 + 1, y);
      ctx.lineTo(cx - tileW / 2 + 1, y + rowH - 8);
      ctx.quadraticCurveTo(cx, y + rowH + 6, cx + tileW / 2 - 1, y + rowH - 8);
      ctx.lineTo(cx + tileW / 2 - 1, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,10,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  speckle(ctx, S, S, 1500, rand, '#f5b08a', '#2a0a00', 1, 0.25);
  return c;
}

function brick(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(91);
  ctx.fillStyle = '#b9ab98';
  ctx.fillRect(0, 0, S, S);
  const bh = 21.33;
  const bw = 64;
  for (let r = 0; r < 12; r++) {
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let x = -bw; x < S + bw; x += bw) {
      const tone = 0.8 + rand() * 0.3;
      ctx.fillStyle = '#' + new THREE.Color(0.62 * tone, 0.3 * tone, 0.22 * tone).getHexString();
      ctx.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4);
      ctx.fillStyle = 'rgba(255,200,170,0.12)';
      ctx.fillRect(x + off + 2, r * bh + 2, bw - 4, 2);
    }
  }
  speckle(ctx, S, S, 2500, rand, '#e8b8a0', '#2a0f08', 1, 0.3);
  return c;
}

function water(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(101);
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2a6b78');
  g.addColorStop(1, '#1f5560');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(200,240,245,${0.08 + rand() * 0.22})`;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    const x = rand() * S;
    const y = rand() * S;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 10, y - 8 * rand(), x + 22, y + 8 * rand(), x + 30 + rand() * 20, y);
    ctx.stroke();
  }
  return c;
}

function hazard(): HTMLCanvasElement {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#18181b';
  for (let i = -S; i < S * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 + S, S);
    ctx.lineTo(i + S, S);
    ctx.closePath();
    ctx.fill();
  }
  const rand = mulberry32(111);
  speckle(ctx, S, S, 800, rand, '#ffffff', '#000000', 1, 0.25);
  return c;
}

function asphalt(): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(121);
  ctx.fillStyle = '#5d6268';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 30, rand, ['#4c5056', '#6c7178'], 100, 0.5);
  speckle(ctx, S, S, 16000, rand, '#9aa0a8', '#1f2226', 1.1, 0.5);
  for (let i = 0; i < 6; i++) crack(ctx, rand() * S, rand() * S, 8 + Math.floor(rand() * 10), rand, 'rgba(20,22,25,0.6)', 1.4);
  return c;
}

function tiles(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(131);
  ctx.fillStyle = '#8c8170';
  ctx.fillRect(0, 0, S, S);
  const n = 4;
  const t = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tone = 0.88 + rand() * 0.16;
      ctx.fillStyle = '#' + new THREE.Color(0.9 * tone, 0.86 * tone, 0.78 * tone).getHexString();
      ctx.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x * t + 2, y * t + 2, t - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x * t + 2, y * t + t - 4, t - 4, 2);
    }
  }
  speckle(ctx, S, S, 2500, rand, '#ffffff', '#4a4034', 1, 0.3);
  return c;
}

function container(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(141);
  ctx.fillStyle = '#e5e5e5';
  ctx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, '#9a9a9a');
    g.addColorStop(0.3, '#ffffff');
    g.addColorStop(0.7, '#d0d0d0');
    g.addColorStop(1, '#8a8a8a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, S);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, S, 6);
  ctx.fillRect(0, S - 6, S, 6);
  blotches(ctx, S, S, 14, rand, ['#7c4a1e', '#5a3a1a'], 26, 0.35);
  speckle(ctx, S, S, 1200, rand, '#ffffff', '#333333', 1, 0.25);
  return c;
}

function wood(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(151);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, 0, S, S);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const y = (i * S) / n;
    ctx.fillStyle = shade('#9c6634', (rand() - 0.5) * 0.25);
    ctx.fillRect(0, y + 2, S, S / n - 4);
    ctx.strokeStyle = 'rgba(60,30,10,0.35)';
    for (let g = 0; g < 6; g++) {
      ctx.beginPath();
      const gy = y + 5 + rand() * (S / n - 10);
      ctx.moveTo(0, gy);
      for (let x = 0; x <= S; x += 16) ctx.lineTo(x, gy + Math.sin(x * 0.04 + g * 2) * 2.5);
      ctx.stroke();
    }
  }
  speckle(ctx, S, S, 1200, rand, '#e8c08a', '#2a1408', 1, 0.25);
  return c;
}

function awning(color: number): HTMLCanvasElement {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  const col = hex(color);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? col : '#f3ead8';
    ctx.fillRect((i * S) / 8, 0, S / 8, S);
  }
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

const GENERATORS: Record<Exclude<TextureKind, 'awning'>, () => HTMLCanvasElement> = {
  sandstone,
  carpet,
  crate,
  concrete,
  metal,
  cobble,
  sand,
  plaster,
  roof,
  brick,
  water,
  hazard,
  asphalt,
  tiles,
  container,
  wood,
};

/** Получить (или сгенерировать) текстуру по типу */
export function getTexture(kind: TextureKind, color = 0xb91c1c): THREE.Texture {
  const key = kind === 'awning' ? `awning-${color}` : kind;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = kind === 'awning' ? awning(color) : GENERATORS[kind]();
  const tex = finalize(canvas);
  cache.set(key, tex);
  return tex;
}

/** Уникальная копия текстуры воды (для анимации смещения) */
export function getWaterTexture(): THREE.Texture {
  const key = 'water-anim';
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = finalize(water());
  cache.set(key, tex);
  return tex;
}

/* -------------------------- Спец-текстуры эффектов ------------------------- */

export function glowTexture(): THREE.Texture {
  const key = 'glow';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function fireGroundTexture(): THREE.Texture {
  const key = 'fireGround';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(171);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,220,120,0.95)');
  g.addColorStop(0.35, 'rgba(255,120,30,0.85)');
  g.addColorStop(0.75, 'rgba(160,30,0,0.45)');
  g.addColorStop(1, 'rgba(40,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.7;
    const y = S / 2 + (rand() - 0.5) * S * 0.7;
    const r = 6 + rand() * 18;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, 'rgba(255,240,180,0.6)');
    gg.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function ringTexture(): THREE.Texture {
  const key = 'ring';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

export function smokeTexture(): THREE.Texture {
  const key = 'smoke';
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(181);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (rand() - 0.5) * S * 0.45;
    const y = S / 2 + (rand() - 0.5) * S * 0.45;
    const r = S * (0.15 + rand() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Декаль плента: круг и буква, «спрей» по полу */
export function decalTexture(letter: string, color: number): THREE.Texture {
  const key = `decal-${letter}-${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const rand = mulberry32(letter.charCodeAt(0) * 13);
  const col = hex(color);
  ctx.strokeStyle = col;
  ctx.lineWidth = 14;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 150px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.fillText(letter, S / 2, S / 2 + 8);
  // «напыление»
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1600; i++) {
    ctx.globalAlpha = rand() * 0.5;
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, rand() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = col;
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    const a = rand() * Math.PI * 2;
    const r = S * (0.42 + rand() * 0.06);
    ctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rand() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  cache.set(key, tex);
  return tex;
}

/** Окно: тёмное стекло с рамой и бликом */
export function windowTexture(warmLight: boolean): THREE.Texture {
  const key = `window-${warmLight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 64;
  const [c, ctx] = makeCanvas(S, S * 1.5);
  const H = S * 1.5;
  ctx.fillStyle = '#3b2f25';
  ctx.fillRect(0, 0, S, H);
  const g = ctx.createLinearGradient(0, 0, S, H);
  g.addColorStop(0, warmLight ? '#4a5b6e' : '#3b5068');
  g.addColorStop(1, warmLight ? '#1f2833' : '#142030');
  ctx.fillStyle = g;
  ctx.fillRect(5, 5, S - 10, H - 10);
  ctx.fillStyle = '#3b2f25';
  ctx.fillRect(S / 2 - 2, 5, 4, H - 10);
  ctx.fillRect(5, H / 2 - 2, S - 10, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(22, 8);
  ctx.lineTo(8, 30);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Текстовый спрайт (например «999» над Пинг-врагом) */
export function textTexture(text: string, color: string, bg = 'rgba(0,0,0,0)'): THREE.Texture {
  const key = `text-${text}-${color}-${bg}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(256, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 128);
  ctx.font = 'bold 72px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 128, 66);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Шевроны направления движения по маршруту (смотрят вниз по холсту = к концу сегмента) */
export function chevronTexture(): THREE.Texture {
  const key = 'chevron';
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(64, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 22);
  ctx.lineTo(32, 40);
  ctx.lineTo(50, 22);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/* ------------------------- Текстуры персонажей ---------------------------- */

function cachedCanvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, nearest = false): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = makeCanvas(w, h);
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (nearest) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  cache.set(key, tex);
  return tex;
}

/** «Пиксельный» серый камень Лаггера */
export function pixelTexture(): THREE.Texture {
  return cachedCanvasTex(
    'pixel',
    16,
    16,
    (ctx) => {
      const rand = mulberry32(191);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = 115 + Math.floor(rand() * 70);
          ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.fillStyle = 'rgba(20,20,24,0.8)';
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.floor(rand() * 14), Math.floor(rand() * 14), 2 + Math.floor(rand() * 3), 1);
    },
    true,
  );
}

/** Столбцы зелёного «кода» для Читера */
export function matrixTexture(): THREE.Texture {
  return cachedCanvasTex('matrix', 64, 128, (ctx) => {
    const rand = mulberry32(201);
    ctx.fillStyle = '#021006';
    ctx.fillRect(0, 0, 64, 128);
    ctx.font = 'bold 11px Consolas, monospace';
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 11; row++) {
        const a = 0.25 + rand() * 0.75;
        ctx.fillStyle = `rgba(74,222,128,${a})`;
        ctx.fillText(rand() > 0.5 ? '1' : rand() > 0.5 ? '0' : 'ﾊ', col * 8, 11 + row * 11.5);
      }
    }
  });
}

/** Полосатая пижама АФК-зомби */
export function pajamaTexture(): THREE.Texture {
  return cachedCanvasTex('pajama', 32, 32, (ctx) => {
    ctx.fillStyle = '#a9cbe8';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#7fa8cf';
    for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 3, 32);
  });
}

/** Клавиатура Рейдж-квиттера: ряды светлых клавиш, WASD подсвечены красным */
export function keyboardTexture(): THREE.Texture {
  return cachedCanvasTex('keyboard', 256, 96, (ctx) => {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 256, 96);
    const red = new Set(['1,2', '2,1', '2,2', '2,3']);
    for (let r = 0; r < 5; r++) {
      const off = r * 4;
      for (let c = 0; c < 15; c++) {
        const x = 6 + off + c * 16.4;
        if (x + 13 > 252) break;
        ctx.fillStyle = red.has(`${r},${c}`) ? '#ef4444' : '#cbd5e1';
        ctx.fillRect(x, 5 + r * 18, 13, 14);
      }
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(70, 77, 110, 14);
  });
}

/** Пузырь со значком отключённого штекера над Рейдж-квиттером */
export function unplugTexture(): THREE.Texture {
  return cachedCanvasTex('unplug', 128, 128, (ctx) => {
    ctx.fillStyle = '#b91c1c';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(12, 8, 104, 90, 18);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(52, 96);
    ctx.lineTo(64, 122);
    ctx.lineTo(76, 96);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    // Вилка: корпус, два штыря, провод
    ctx.save();
    ctx.translate(64, 53);
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-14, -12, 28, 26);
    ctx.fillRect(-9, -26, 6, 15);
    ctx.fillRect(3, -26, 6, 15);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, 32);
    ctx.stroke();
    ctx.restore();
    // Перечёркнуто
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(30, 22);
    ctx.lineTo(98, 84);
    ctx.stroke();
  });
}

/** Куртка Скин-коллекционера: фиолетовая ткань с золотыми завитками */
export function blingTexture(): THREE.Texture {
  return cachedCanvasTex('bling', 128, 128, (ctx) => {
    ctx.fillStyle = '#6d28d9';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = (i % 3) * 44 + 18;
      const y = Math.floor(i / 3) * 64 + 24;
      ctx.beginPath();
      ctx.arc(x, y, 12, Math.PI * 0.2, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 14, y + 16, 7, Math.PI, Math.PI * 2.6);
      ctx.stroke();
    }
    ctx.fillStyle = '#f472b6';
    for (let i = 0; i < 10; i++) ctx.fillRect((i * 37) % 124, (i * 53) % 124, 4, 4);
  });
}

/** Значок Wi-Fi над Пингом 999 */
export function wifiTexture(): THREE.Texture {
  return cachedCanvasTex('wifi', 128, 128, (ctx) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 0 ? '#22d3ee' : `rgba(34,211,238,${0.9 - i * 0.2})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(64, 98, 22 + i * 22, Math.PI * 1.22, Math.PI * 1.78);
      ctx.stroke();
    }
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(64, 98, 8, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Красный пузырь с «!» над Лаггером */
export function alertTexture(): THREE.Texture {
  return cachedCanvasTex('alert', 128, 128, (ctx) => {
    ctx.fillStyle = '#b91c1c';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(14, 10, 100, 86, 18);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(40, 92);
    ctx.lineTo(30, 120);
    ctx.lineTo(60, 94);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 64, 56);
  });
}

/** Экран планшета: светится логотипом */
export function screenTexture(color: string): THREE.Texture {
  return cachedCanvasTex(`screen-${color}`, 64, 48, (ctx) => {
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, 64, 48);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 26, 10, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 26, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(8, 38, 48, 3);
  });
}

/** Небо: вертикальный градиент */
export function skyTexture(top: number, horizon: number): THREE.Texture {
  const [c, ctx] = makeCanvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, hex(top));
  g.addColorStop(0.62, hex(new THREE.Color(top).lerp(new THREE.Color(horizon), 0.75).getHex()));
  g.addColorStop(0.82, hex(horizon));
  g.addColorStop(1, hex(new THREE.Color(horizon).lerp(new THREE.Color(0x000000), 0.15).getHex()));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
