'use strict';
/**
 * Regenerates src/coin-data.js from the vendored source sets.
 *
 * Run offline, once. The output is committed; nothing here runs at app start.
 *
 *   node build/make-coin-data.js
 *
 * Sources (all permit redistribution):
 *   - spothq/cryptocurrency-icons, CC0-1.0  -> SVG, circular, 32x32 viewBox
 *   - cryptologos.cc                        -> SVG, circular
 *   - coincap.io asset icons                -> PNG, circular, 64x64
 *
 * Why SVG for most coins and PNG for a few: the eleven in PNG_ONLY are the ones
 * no source publishes as SVG. All three sets draw a circular disc, so the two
 * formats mix without looking ragged.
 */
const fs = require('fs');
const path = require('path');

const SVG_DIR = process.argv[2] || '/workspace/svgdl';
const PNG_DIR = process.argv[3] || '/workspace/pngdl';
const OUT = path.join(__dirname, '..', 'src', 'coin-data.js');

/**
 * Coins that only CoinCap has.
 *
 * Everything else is vector. These eleven are the ones no source publishes as
 * SVG: spothq predates them, and cryptologos.cc has no entry for them.
 */
const PNG_ONLY = [
  'BERA', 'FET', 'HYPE', 'JUP', 'PENGU', 'POL', 'RENDER', 'RNDR', 'SEI', 'VIRTUAL', 'WLD',
];

/**
 * Squeeze an SVG without changing what it draws.
 *
 * Only whitespace between tags, the XML prolog and comments are removed. The
 * `viewBox` is left alone: it is what makes the icon scale, and rewriting it
 * would crop the logo.
 */
function minifySvg(src) {
  return src
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const out = {};
const report = { svg: [], png: [] };

for (const file of fs.readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).sort()) {
  const ticker = path.basename(file, '.svg').toUpperCase();
  const svg = minifySvg(fs.readFileSync(path.join(SVG_DIR, file), 'utf8'));
  if (!/^<svg[\s>]/.test(svg)) throw new Error(`${file}: not an svg after minify`);
  if (!/viewBox=/.test(svg)) throw new Error(`${file}: no viewBox, will not scale`);
  out[ticker] = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  report.svg.push(ticker);
}

for (const ticker of PNG_ONLY) {
  const file = path.join(PNG_DIR, `${ticker.toLowerCase()}.png`);
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a png`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  // 64 is the largest CoinCap publishes. Anything smaller would be upscaled on
  // screen, which is the exact defect this regeneration exists to fix.
  if (w < 64 || h < 64) throw new Error(`${file}: ${w}x${h} is too small`);
  out[ticker] = `data:image/png;base64,${buf.toString('base64')}`;
  report.png.push(`${ticker}(${w}x${h})`);
}

const keys = Object.keys(out).sort();
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(out[k])},`).join('\n');

const file = `'use strict';
/**
 * Coin logos, vendored as data URIs. GENERATED — do not edit by hand.
 *
 * Regenerate with: node build/make-coin-data.js
 *
 * ${keys.length} coins: ${report.svg.length} as SVG (vector, sharp at any size) and
 * ${report.png.length} as 64x64 PNG (the largest CoinCap publishes).
 *
 * A data URI rather than a file per coin because the renderer is sandboxed and
 * cannot read the disk, and because the page's CSP allows \`img-src 'self' data:\`
 * and nothing else — so this is the only kind of image the widget can paint, and
 * it can never point off the machine.
 *
 * Provenance and licences: renderer/assets/coins/CREDITS.md
 */
module.exports = {
${body}
};
`;

fs.writeFileSync(OUT, file);
console.log(`wrote ${OUT}`);
console.log(`  ${keys.length} coins — ${report.svg.length} svg, ${report.png.length} png`);
console.log(`  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
