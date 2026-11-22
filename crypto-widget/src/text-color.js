'use strict';
/**
 * Text colour: derivation, contrast measurement, and the "is this readable?"
 * answer — pure, no DOM, no Electron.
 *
 * ---------------------------------------------------------------------------
 * What was wrong with the old colour picker
 *
 * It set `--text` and stopped there. Everything else that draws text kept its
 * own hard-coded colour:
 *
 *   .hint            #93a3bd   (a blue-grey, whatever the user chose)
 *   input::placeholder #55647d
 *   .seg-btn.is-active #d5e4ff
 *   .calc            #b9cdf0
 *
 * and `--muted` was a fixed #9aabc6 on every dark theme. So picking a dark
 * text colour on a dark background left the labels, hints, placeholders and
 * the whole secondary layer in a light blue that no longer belonged to the
 * palette — and picking a light colour on the light theme left them dark.
 * The picker changed one thing and the widget looked half-converted.
 *
 * The fix is to derive the secondary tones FROM the chosen colour, and to
 * measure the result instead of hoping. Both live here so they can be tested
 * without a browser.
 * ---------------------------------------------------------------------------
 */

/** The surface each theme paints behind the text, for contrast measurement. */
const THEME_SURFACE = Object.freeze({
  solid: '#0b0f17',
  midnight: '#000000',
  glass: '#101622',
  clear: '#0a0e16',
  aurora: '#080c14',
  light: '#f4f7fc',
  // 'bare' has no surface at all: the wallpaper shows through, so there is
  // nothing to measure against. Handled explicitly, never guessed.
  bare: null,
});

const DEFAULT_TEXT = '#e8eefc';

/** Parse "#rgb" or "#rrggbb" into [r,g,b] 0-255, or null. */
function parseHex(hex) {
  const s = String(hex || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    return [
      parseInt(m[1].slice(0, 2), 16),
      parseInt(m[1].slice(2, 4), 16),
      parseInt(m[1].slice(4, 6), 16),
    ];
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    return [
      parseInt(m[1][0] + m[1][0], 16),
      parseInt(m[1][1] + m[1][1], 16),
      parseInt(m[1][2] + m[1][2], 16),
    ];
  }
  return null;
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Is this a colour the widget can actually paint? */
function isValidHex(hex) {
  return parseHex(hex) !== null;
}

/** Normalise any accepted form to lowercase #rrggbb, or null. */
function normalizeHex(hex) {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : null;
}

/** WCAG relative luminance. */
function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0.5;
  const ch = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two colours, 1..21. */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear blend: t=0 gives `a`, t=1 gives `b`. */
function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return toHex(ca.map((v, i) => v + (cb[i] - v) * k));
}

/**
 * The secondary ("muted") tone for a text colour on a given theme.
 *
 * Derived by mixing the text colour toward the surface, then checked: if the
 * result falls below 3:1 against that surface it is pulled back toward the
 * text until it clears it. 3:1 is the WCAG threshold for large text and for
 * UI boundaries; the muted layer is small text, so the target is 4.5:1 and the
 * loop aims there, with 3:1 as the floor it will not go under.
 *
 * On 'bare' there is no surface, so the mix target is the halo colour instead
 * — that is what the text is actually sitting on.
 */
function mutedFor(textColor, theme, haloColor) {
  const text = normalizeHex(textColor) || DEFAULT_TEXT;
  const surface = THEME_SURFACE[theme] === undefined ? THEME_SURFACE.solid : THEME_SURFACE[theme];

  // No surface: mix toward the halo, which is the thing behind the glyphs.
  if (surface === null) {
    const halo = normalizeHex(haloColor) || '#000000';
    return mix(text, halo, 0.22);
  }

  let t = 0.38;
  let out = mix(text, surface, t);
  // Pull back toward the text until it is readable. Bounded loop: 0.38 -> 0
  // in 0.02 steps is 19 iterations, and t=0 is the text colour itself, which
  // is by definition the most contrast available.
  while (contrast(out, surface) < 4.5 && t > 0) {
    t = Math.max(0, t - 0.02);
    out = mix(text, surface, t);
  }
  return out;
}

/**
 * A dimmer tone for placeholders and disabled text.
 *
 * Same idea, one step further toward the surface, and it is allowed to sit at
 * 3:1 rather than 4.5:1 because placeholder text is not content the user has
 * to read — it is a hint that disappears the moment they type.
 */
function faintFor(textColor, theme, haloColor) {
  const text = normalizeHex(textColor) || DEFAULT_TEXT;
  const surface = THEME_SURFACE[theme] === undefined ? THEME_SURFACE.solid : THEME_SURFACE[theme];
  if (surface === null) {
    const halo = normalizeHex(haloColor) || '#000000';
    return mix(text, halo, 0.42);
  }
  let t = 0.55;
  let out = mix(text, surface, t);
  while (contrast(out, surface) < 3 && t > 0) {
    t = Math.max(0, t - 0.02);
    out = mix(text, surface, t);
  }
  return out;
}

/**
 * The halo colour for a text colour: whichever of black/white contrasts more.
 *
 * This is the same rule the renderer used inline; it lives here now so the
 * settings sheet can show the user the number it is based on.
 */
function haloFor(textColor) {
  const text = normalizeHex(textColor) || DEFAULT_TEXT;
  return contrast(text, '#000000') >= contrast(text, '#ffffff')
    ? 'rgba(0, 0, 0, .92)'
    : 'rgba(255, 255, 255, .92)';
}

/**
 * Judge a text colour against a theme.
 *
 * @param {string} textColor
 * @param {string} theme
 * @param {number} [bgAlpha] the theme's own opacity, 0..1
 * @returns {{ratio: number|null, level: 'good'|'ok'|'poor'|'unknown', message: string}}
 *
 * `ratio` is null on 'bare', where the background is the user's wallpaper and
 * no honest number can be produced. Saying "unknown" is the correct answer
 * there; inventing a ratio against a guessed wallpaper would be worse than
 * useless, because the user would trust it.
 *
 * ---------------------------------------------------------------------------
 * The same is true of a see-through theme at low opacity
 *
 * 'clear' and 'glass' paint a translucent fill, and the opacity slider goes
 * down to 0. At 0.35 the surface behind the text is mostly the wallpaper, not
 * `#0a0e16` — so measuring against the theme's nominal colour produced a
 * confident "16.5:1" for text that might be sitting on a white photo. That is
 * the exact failure this readout exists to prevent, and it was reachable by
 * dragging one slider.
 *
 * Below SEE_THROUGH_ALPHA the answer becomes "unknown", with a message that
 * says why and what to do about it. Above it the theme's own colour dominates
 * enough that the number is meaningful, and it is reported as before.
 * ---------------------------------------------------------------------------
 */
const SEE_THROUGH_ALPHA = 0.6;

/** Themes whose fill is translucent, so the wallpaper shows through. */
const SEE_THROUGH_THEMES = Object.freeze(['clear', 'glass']);

function judge(textColor, theme, bgAlpha) {
  const text = normalizeHex(textColor) || DEFAULT_TEXT;
  const surface = THEME_SURFACE[theme] === undefined ? THEME_SURFACE.solid : THEME_SURFACE[theme];

  if (surface === null) {
    return {
      ratio: null,
      level: 'unknown',
      message: 'Nền trong suốt — không đo được tương phản. Dùng “Quầng chữ” nếu chữ bị chìm.',
    };
  }

  /**
   * A translucent theme at low opacity is the same situation as 'bare': the
   * thing behind the glyphs is the wallpaper, and no number can be honest
   * about it. Only checked when an alpha is supplied, so a caller that does
   * not know the opacity (the unit tests, an older payload) keeps the old
   * behaviour instead of silently losing its readout.
   */
  const alpha = Number(bgAlpha);
  if (SEE_THROUGH_THEMES.includes(theme) && Number.isFinite(alpha) && alpha < SEE_THROUGH_ALPHA) {
    return {
      ratio: null,
      level: 'unknown',
      message: `Nền đang trong suốt ${Math.round(alpha * 100)}% — hình nền lộ qua nên không đo được tương phản. Tăng độ đục hoặc dùng “Quầng chữ”.`,
    };
  }

  const ratio = contrast(text, surface);
  const r = Math.round(ratio * 10) / 10;
  /*
   * The message states the VERDICT, not the number.
   *
   * The chip next to it already prints "16.5:1", so a message that began
   * "Tương phản 16.5:1 —" repeated the same figure twice in one row and read
   * as a rendering glitch. The number belongs to the chip; the sentence says
   * what it means and what to do about it.
   */
  if (ratio >= 7) return { ratio: r, level: 'good', message: 'Rất tốt — đọc thoải mái ở mọi cỡ chữ.' };
  if (ratio >= 4.5) return { ratio: r, level: 'good', message: 'Đủ đọc — đạt chuẩn WCAG AA cho chữ thường.' };
  if (ratio >= 3) return { ratio: r, level: 'ok', message: 'Hơi thấp — chữ nhỏ (số dư, ghi chú) sẽ khó đọc.' };
  return { ratio: r, level: 'poor', message: 'Quá thấp — gần như không đọc được. Chọn màu khác.' };
}

/**
 * A readable text colour for a theme, used by "Về mặc định".
 *
 * Not simply the default: on the light theme the default light text would be
 * invisible, so the reset has to know which way the surface goes.
 */
function defaultTextFor(theme) {
  const surface = THEME_SURFACE[theme] === undefined ? THEME_SURFACE.solid : THEME_SURFACE[theme];
  if (surface === null) return DEFAULT_TEXT;
  return luminance(surface) > 0.5 ? '#1f2937' : DEFAULT_TEXT;
}

module.exports = {
  THEME_SURFACE,
  DEFAULT_TEXT,
  parseHex,
  toHex,
  isValidHex,
  normalizeHex,
  luminance,
  contrast,
  mix,
  mutedFor,
  faintFor,
  haloFor,
  judge,
  defaultTextFor,
};
