'use strict';
/**
 * Generates build/icon.png and build/tray.png with zero dependencies.
 * Runs automatically before `npm start` and `npm run dist`, so the repo stays
 * text-only and the icons can never drift from the source.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname);

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixel buffer as PNG. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- drawing
function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size || a <= 0) return;
  const i = (y * cv.size + x) * 4;
  const sa = a / 255;
  const da = cv.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  cv.data[i] = Math.round((r * sa + cv.data[i] * da * (1 - sa)) / oa);
  cv.data[i + 1] = Math.round((g * sa + cv.data[i + 1] * da * (1 - sa)) / oa);
  cv.data[i + 2] = Math.round((b * sa + cv.data[i + 2] * da * (1 - sa)) / oa);
  cv.data[i + 3] = Math.round(oa * 255);
}

/** Anti-aliased rounded rect via 4x4 supersampling of the coverage test. */
function roundRect(cv, x0, y0, x1, y1, radius, color) {
  const [r, g, b, a] = color;
  const S = 4;
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (px < x0 || px > x1 || py < y0 || py > y1) continue;
          const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
          const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
          const dx = px - cx, dy = py - cy;
          if (dx * dx + dy * dy <= radius * radius) hits++;
        }
      }
      if (hits) blend(cv, x, y, r, g, b, Math.round((a * hits) / (S * S)));
    }
  }
}

function line(cv, x0, y0, x1, y1, width, color) {
  const [r, g, b, a] = color;
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  const rad = width / 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= rad) blend(cv, x, y, r, g, b, a);
        else if (d <= rad + 1) blend(cv, x, y, r, g, b, Math.round(a * (rad + 1 - d)));
      }
    }
  }
}

function drawIcon(size, withBackground) {
  const cv = makeCanvas(size);
  const S = size;

  if (withBackground) {
    roundRect(cv, 0, 0, S - 1, S - 1, S * 0.22, [11, 15, 23, 255]);
    // soft accent glow, top-right
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      roundRect(cv, S * 0.30 - t * S * 0.1, -S * 0.30 - t * S * 0.1,
        S * 1.30 + t * S * 0.1, S * 0.80 + t * S * 0.1, S * 0.5,
        [79, 140, 255, Math.round(3 + t * 2)]);
    }
  }

  // candlesticks
  const bars = [
    { x: 0.24, top: 0.40, bot: 0.60, up: true },
    { x: 0.41, top: 0.32, bot: 0.56, up: true },
    { x: 0.58, top: 0.36, bot: 0.50, up: false },
    { x: 0.75, top: 0.22, bot: 0.44, up: true },
  ];
  const w = S * 0.075;
  for (const bar of bars) {
    const bx = S * bar.x;
    const y1 = S * bar.top;
    const y2 = S * bar.bot;
    const col = bar.up ? [22, 199, 132, 255] : [234, 57, 67, 255];
    line(cv, bx, y1 - S * 0.05, bx, y2 + S * 0.05, S * 0.018, col);
    roundRect(cv, bx - w / 2, y1, bx + w / 2, y2, w * 0.3, col);
  }

  // trend line
  const pts = [[0.20, 0.72], [0.40, 0.62], [0.57, 0.66], [0.80, 0.34]];
  for (let i = 0; i < pts.length - 1; i++) {
    line(cv, S * pts[i][0], S * pts[i][1], S * pts[i + 1][0], S * pts[i + 1][1],
      S * 0.035, [124, 92, 255, 255]);
  }
  return cv;
}

function write(name, size, withBackground) {
  const cv = drawIcon(size, withBackground);
  fs.writeFileSync(path.join(OUT, name), encodePng(size, size, cv.data));
  console.log(`  ${name}  ${size}x${size}`);
}

console.log('Generating icons…');
write('icon.png', 512, true);
write('icon-256.png', 256, true);
write('tray.png', 32, false);
console.log('Done.');
