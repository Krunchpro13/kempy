// =============================================================================
// Pack-size / unit-quantity normalisation
// =============================================================================
// The matcher pairs an Amazon (COST) product to an eBay (SALE) listing on title
// similarity. When the two sides are DIFFERENT pack sizes (Amazon 5 L tub vs an
// eBay 60 L listing; a single 140 g pouch vs a 16-pack) the profit engine would
// subtract one small cost from a large multi-pack sale and invent a "Premium
// Opportunity" that is really a loss.
//
// This module parses the size / pack quantity out of a title into a structured,
// comparable form, then `reconcile()`s the two sides so callers can:
//   - reject / down-rank a size-mismatched match,
//   - compute the TRUE replenishment cost (cost × pack-multiple), and
//   - flag the pair in the UI (✓ confirmed / ⚠ unverified / ✕ mismatch).
//
// Conservative by design: a false "they differ" hides a card (recoverable via a
// toggle); a false "they match" surfaces a loss-maker as profit (the bug we fix).
// =============================================================================

import { NORMALIZE } from '../config.js';

// Unit → multiplier into a canonical base unit per family.
// volume base = millilitre; weight base = gram.
const VOLUME = {
  ml: 1, milliliter: 1, millilitre: 1, milliliters: 1, millilitres: 1,
  cl: 10, dl: 100,
  l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000, ltr: 1000,
};
const WEIGHT = {
  mg: 0.001,
  g: 1, gr: 1, gram: 1, grams: 1, gm: 1, gms: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
};

// One regex alternation of every unit token, longest-first so "ml" wins over "l".
const UNIT_ALT = Object.keys({ ...VOLUME, ...WEIGHT })
  .sort((a, b) => b.length - a.length)
  .join('|');
const MEASURE_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})\\b`, 'i');

// Pack-count patterns, tried in priority order. Each captures the count.
const PACK_RES = [
  /(\d+)\s*[x×]\s*(?=\d)/i,        // "16 x 140g" — count before an "x" followed by a measure
  /pack\s*of\s*(\d+)/i,           // "pack of 24"
  /case\s*of\s*(\d+)/i,           // "case of 12"
  /set\s*of\s*(\d+)/i,            // "set of 6"
  /box\s*of\s*(\d+)/i,            // "box of 50"
  /(\d+)\s*-?\s*pack\b/i,         // "16-pack", "16 pack"
  /(\d+)\s*x\b/i,                 // "12x" (no following measure)
  /(\d+)\s*(?:count|ct|pcs|pieces|pods|tablets|tabs|sachets|pouches|capsules|wipes)\b/i,
];

const fam = (unit) => (unit in VOLUME ? 'volume' : unit in WEIGHT ? 'weight' : null);
const baseOf = (unit) => (VOLUME[unit] ?? WEIGHT[unit] ?? null);

/**
 * Parse a title's size / pack quantity into a comparable shape, or null when the
 * title carries no quantity signal (e.g. "Logitech C920 Webcam" — nothing to size).
 *
 * @returns {{ family:'volume'|'weight'|'count', packCount:number, unitValue:number,
 *             total:number, label:string } | null}
 *   total is in the family's base unit (ml / g), or = packCount for 'count'.
 */
export function parseQuantity(title) {
  const s = String(title || '').toLowerCase();
  if (!s) return null;

  let packCount = null;
  for (const re of PACK_RES) {
    const m = s.match(re);
    if (m) { packCount = parseInt(m[1], 10); break; }
  }

  const mm = s.match(MEASURE_RE);
  let family = null, unitValue = null, unit = null;
  if (mm) {
    unit = mm[2].toLowerCase();
    family = fam(unit);
    unitValue = parseFloat(mm[1]) * baseOf(unit);   // in base unit (ml / g)
  }

  // Nothing parseable → no quantity dimension.
  if (packCount == null && unitValue == null) return null;
  if (!Number.isFinite(packCount) || packCount <= 0) packCount = 1;

  if (unitValue != null && family) {
    return {
      family,
      packCount,
      unitValue,
      total: packCount * unitValue,
      label: labelFor(packCount, mm[1], unit),
    };
  }
  // Pack count only, no measure → count-based (e.g. "24 pack").
  return {
    family: 'count',
    packCount,
    unitValue: 1,
    total: packCount,
    label: `${packCount}-pack`,
  };
}

function labelFor(packCount, rawVal, unit) {
  const u = unit === 'l' || unit === 'litre' || unit === 'litres' || unit === 'liter' || unit === 'liters' || unit === 'ltr' ? 'L'
    : unit === 'kg' || unit === 'kgs' ? 'kg'
    : unit;
  const measure = `${rawVal}${u}`;
  return packCount > 1 ? `${packCount}×${measure}` : measure;
}

const isClose = (a, b, tol) => Math.abs(a - b) <= b * tol;

/**
 * Compare the source (COST) and eBay (SALE) parsed quantities.
 *
 * @returns {{ quality:'na'|'confirmed'|'unverified'|'mismatch',
 *             multiplier:number, ratio:number|null, reason:string|null }}
 *   - 'na'         : neither side has a size → not a quantity product; don't touch.
 *   - 'confirmed'  : same family, same total (±tolerance) → like-for-like.
 *   - 'unverified' : exactly one side lists a size → can't confirm parity.
 *   - 'mismatch'   : sizes differ. `multiplier` = clean integer pack-multiple to
 *                     fulfil one eBay sale (≥2) when one exists, else 1.
 */
export function reconcile(source, ebay) {
  const tol = NORMALIZE.RATIO_TOLERANCE;

  if (!source && !ebay) return { quality: 'na', multiplier: 1, ratio: null, reason: null };
  if (!source || !ebay) {
    return { quality: 'unverified', multiplier: 1, ratio: null, reason: 'size listed on one side only — verify' };
  }
  if (source.family !== ebay.family) {
    return { quality: 'mismatch', multiplier: 1, ratio: null, reason: `unit mismatch (${ebay.family} vs ${source.family})` };
  }

  const ratio = ebay.total / source.total;   // how many source units fulfil one eBay sale

  if (isClose(ratio, 1, tol)) {
    return { quality: 'confirmed', multiplier: 1, ratio, reason: null };
  }

  // Clean integer multiple within tolerance and within the plausible pack cap →
  // a real replenishment cost can be computed (cost × N). Still a size mismatch.
  const n = Math.round(ratio);
  if (n >= 2 && n <= NORMALIZE.PACK_CAP && isClose(ratio, n, tol)) {
    return { quality: 'mismatch', multiplier: n, ratio, reason: `pack ${n}× — cost ×${n} to fulfil` };
  }

  const human = ratio >= 1 ? `${ratio.toFixed(1)}×` : `${(1 / ratio).toFixed(1)}× smaller`;
  return { quality: 'mismatch', multiplier: 1, ratio, reason: `size ${human} mismatch` };
}

/** Convenience: parse both titles and reconcile in one call. */
export function reconcileTitles(sourceTitle, ebayTitle) {
  return reconcile(parseQuantity(sourceTitle), parseQuantity(ebayTitle));
}
