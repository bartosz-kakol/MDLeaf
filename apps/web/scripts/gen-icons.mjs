// Generates the PWA icons (public/icons/*.png) without extra dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GREEN = [31, 111, 80];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x supersampling
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
          for (let i = 0; i < 4; i++) acc[i] += p[i];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 4; i++) raw[o + i] = Math.round(acc[i] / 16);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Leaf: intersection of two circles, rotated 45°, plus a stem/vein.
function leaf(u, v, scale) {
  const x0 = (u - 0.5) / scale;
  const y0 = (v - 0.5) / scale;
  const a = Math.PI / 4;
  const x = x0 * Math.cos(a) - y0 * Math.sin(a);
  const y = x0 * Math.sin(a) + y0 * Math.cos(a);
  const r = 0.5;
  const d = 0.28;
  const inLeaf = (x - d) ** 2 + y ** 2 < r * r && (x + d) ** 2 + y ** 2 < r * r;
  const vein = Math.abs(x) < 0.012 && Math.abs(y) < 0.4;
  return inLeaf && !vein;
}

function icon(size, { maskable }) {
  return png(size, (u, v) => {
    const scale = maskable ? 0.62 : 0.8;
    if (!maskable) {
      const rr = 0.2;
      const dx = Math.max(Math.abs(u - 0.5) - (0.5 - rr), 0);
      const dy = Math.max(Math.abs(v - 0.5) - (0.5 - rr), 0);
      if (dx * dx + dy * dy > rr * rr) return [0, 0, 0, 0];
    }
    return leaf(u, v, scale) ? [...WHITE, 255] : [...GREEN, 255];
  });
}

writeFileSync(new URL('../public/icons/icon-192.png', import.meta.url), icon(192, { maskable: false }));
writeFileSync(new URL('../public/icons/icon-512.png', import.meta.url), icon(512, { maskable: false }));
writeFileSync(new URL('../public/icons/icon-maskable-512.png', import.meta.url), icon(512, { maskable: true }));
console.log('icons written');
