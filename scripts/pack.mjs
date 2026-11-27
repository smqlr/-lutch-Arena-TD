// Упаковка сборок для порталов в release/*.zip: index.html в корне архива, пути через «/».
// Без зависимостей (zlib из Node), работает одинаково в Windows, macOS и Linux.
// Запуск: npm run release (собирает CrazyGames и Poki и упаковывает), или node scripts/pack.mjs [crazygames|poki ...]
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const TARGETS = {
  crazygames: { dir: 'dist-crazygames', zip: 'release/clutch-arena-td-crazygames.zip' },
  poki: { dir: 'dist-poki', zip: 'release/clutch-arena-td-poki.zip' },
};

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function zip(srcDir, outFile) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // Время в формате DOS: 2020-01-01 00:00 (одинаковое — архив воспроизводим)
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const file of listFiles(srcDir)) {
    const name = Buffer.from(relative(srcDir, file).split(sep).join('/'), 'utf8');
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
  return centrals.length / 2;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
mkdirSync('release', { recursive: true });
for (const n of names) {
  const t = TARGETS[n];
  if (!t) throw new Error(`Unknown target: ${n}`);
  const count = zip(t.dir, t.zip);
  console.log(`${t.zip}: ${count} files`);
}
