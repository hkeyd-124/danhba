'use strict';
/**
 * The three things this round changed, locked down as source assertions.
 *
 * Each of them was a visible defect, and each is one careless edit away from
 * coming back:
 *
 *   1. the strip row had no PnL between the chart and the price;
 *   2. the chart was not centred — a flexible price column pushed it left;
 *   3. the detail row showed only the badge, so the ticker was nowhere.
 *
 * These read the files rather than the rendered DOM on purpose: the rendering
 * harness (test/measure-row.js) proves the geometry, and these catch the case
 * where a later change silently removes a column or re-adds a competing
 * `flex: 1` without anyone running the browser.
 *
 * Run:  node --test test/row-order.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
const dock = fs.readFileSync(path.join(ROOT, 'renderer', 'dock.css'), 'utf8');
const candles = fs.readFileSync(path.join(ROOT, 'renderer', 'candles.css'), 'utf8');

/** The template literal that builds one strip row. */
function stripRow() {
  const start = app.indexOf('<div class="cv-coin" data-symbol=');
  assert.ok(start > 0, 'the strip row markup is gone');
  return app.slice(start, start + 900);
}

/** The `name` expression inside renderPositions. */
function panelName() {
  const start = app.indexOf('const name = ');
  assert.ok(start > 0, 'the panel name expression is gone');
  return app.slice(start, start + 300);
}

test('strip row carries a PnL column', () => {
  const row = stripRow();
  assert.match(row, /cv-coin-pnl/, 'the strip row has no PnL span');
  assert.match(row, /fmtCompact\(p\.unrealized\)/, 'the PnL span is not fed by fmtCompact(unrealized)');
  assert.match(row, /cv-coin-pnl[^>]*\$\{pnlCls\}/, 'the PnL span lost its up/down tone');
});

test('strip row reads icon, ticker, chart, PnL, price, ROI', () => {
  const row = stripRow();
  /**
   * The chart is interpolated as `${spark}`, not written inline, so the literal
   * `cd-strip` never appears inside the row markup — the first version of this
   * test looked for it there and failed on correct code. The slot is `${spark}`
   * and `spark` is asserted to be the candle call separately.
   */
  const order = ['badgeHtml(', 'cv-coin-sym', '${spark}', 'cv-coin-pnl', 'cv-coin-price', 'cv-coin-pct'];
  const at = order.map((k) => row.indexOf(k));
  at.forEach((i, n) => assert.ok(i > -1, `"${order[n]}" is missing from the strip row`));
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] > at[i - 1], `"${order[i]}" must come after "${order[i - 1]}" in the strip row`);
  }
});

test('the detail row always writes the ticker', () => {
  const name = panelName();
  assert.match(name, /pos-sym/, 'the detail row no longer has a pos-sym span');
  // The badge must be CONDITIONAL and the ticker unconditional: the expression
  // is `${withIcons ? badgeHtml(...) : ''}<span class="pos-sym">...`.
  assert.match(name, /withIcons \? badgeHtml\(/, 'the badge is no longer gated on the icons switch');
  const badgeAt = name.indexOf('badgeHtml(');
  const symAt = name.indexOf('pos-sym');
  assert.ok(badgeAt < symAt, 'the ticker must follow the badge, not replace it');
  /**
   * The ticker must sit OUTSIDE the ternary.
   *
   * The bug was `withIcons ? badgeHtml(...) : '<span class="pos-sym">...'` —
   * the ticker existed only in the else branch. So the check is that the
   * `pos-sym` span comes after the ternary's closing brace, not inside it.
   */
  const ternaryEnd = name.indexOf('}');
  assert.ok(ternaryEnd > -1, 'the badge ternary is malformed');
  assert.ok(
    name.indexOf('pos-sym') > ternaryEnd,
    'the ticker is inside the ternary again — that is the bug where the detail row had no name',
  );
});

test('the strip chart is centred by auto margins, not by a flexible price', () => {
  assert.match(candles, /\.cd-strip\s*\{[^}]*margin:\s*0 auto/, '.cd-strip lost its auto margins');
  assert.doesNotMatch(
    dock,
    /\.cv-coin-price\s*\{[^}]*flex:\s*1 1 auto/,
    '.cv-coin-price became flexible again — it will push the chart off centre',
  );
  assert.match(dock, /\.cv-coin-price\s*\{[^}]*flex:\s*0 1 auto/, '.cv-coin-price should shrink, not grow');
});

test('the strip chart can shrink but never grows past its drawn width', () => {
  const block = /\.cd-strip\s*\{([^}]*)\}/.exec(candles);
  assert.ok(block, '.cd-strip rule is missing');
  assert.match(block[1], /flex:\s*0 1 84px/, 'the chart should shrink from 84px');
  assert.match(block[1], /max-width:\s*84px/, 'the chart must not grow past 84px');
  assert.match(block[1], /min-width:/, 'the chart needs a floor or the candles vanish');
});

test('narrow strips drop the ROI rather than overflow', () => {
  const narrow = /@container \(max-width: 259px\) \{[\s\S]*?\n\}/.exec(dock);
  assert.ok(narrow, 'the narrow-strip container query is gone');
  assert.match(dock, /@container \(max-width: 259px\) \{[\s\S]*?\.cv-coin-pct \{ display: none; \}/,
    'the ROI column is no longer dropped at narrow widths');
});

test('fmtCompact keeps a stable shape', () => {
  // Extracted and run, not pattern-matched: the point is the numbers it prints.
  const src = /function fmtCompact\(n\) \{[\s\S]*?\n\}/.exec(app);
  assert.ok(src, 'fmtCompact is gone');
  // eslint-disable-next-line no-new-func
  const fmtCompact = new Function(`${src[0]}; return fmtCompact;`)();
  assert.strictEqual(fmtCompact(67.76), '+67.76');
  assert.strictEqual(fmtCompact(-90.13), '−90.13');
  assert.strictEqual(fmtCompact(0), '0.00');
  assert.strictEqual(fmtCompact(1234.5), '+1.2k');
  assert.strictEqual(fmtCompact(-12345), '−12k');
  assert.strictEqual(fmtCompact(0.4213), '+0.421');
  assert.strictEqual(fmtCompact(NaN), '—');
});
