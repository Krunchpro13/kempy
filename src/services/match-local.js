// =============================================================================
// Local (no-AI) product matcher
// =============================================================================
// Fallback for when ANTHROPIC_API_KEY is not set, so we can't use the Claude
// matcher in claude.js. Given an eBay listing title and a pool of Amazon
// candidates (from Keepa), pick the candidate that is most likely the SAME
// product — but only commit when we're reasonably confident.
//
// Philosophy: a wrong "confident" match produces a confidently-wrong ROI, which
// is worse than admitting "we estimated this". So the threshold is deliberately
// conservative — when unsure, return null and let the caller fall back to an
// (honestly-labelled) estimate.
// =============================================================================

// Filler words that carry no identity signal on a marketplace listing.
const STOPWORDS = new Set([
  'new', 'sealed', 'brand', 'genuine', 'authentic', 'official', 'oem', 'open',
  'box', 'with', 'and', 'for', 'the', 'a', 'an', 'of', 'in', 'by', 'to',
  'free', 'fast', 'shipping', 'ship', 'us', 'usa', 'lot', 'set', 'pack',
  'edition', 'version', 'model', 'color', 'black', 'white', 'blue', 'red',
  'silver', 'gray', 'grey', 'gold', 'pink', 'green', 'wireless', 'bluetooth',
  'condition', 'excellent', 'good', 'great', 'warranty', 'unlocked',
]);

function normalize(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(s = '') {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// A "model-like" token is a strong identity signal: it mixes letters+digits
// (e.g. "wh1000xm5", "a158wa", "c920") or is a longish pure number ("510bt").
function isModelLike(t) {
  if (t.length < 3) return false;
  const hasDigit = /\d/.test(t);
  const hasAlpha = /[a-z]/.test(t);
  if (hasDigit && hasAlpha) return true;
  if (/^\d{4,}$/.test(t)) return true;
  return false;
}

/**
 * Score how well a candidate matches the eBay title. Higher is better.
 * @returns {number} 0..~1.4
 */
export function scoreCandidate(ebayTitle, candidate) {
  const eTokens = tokenize(ebayTitle);
  if (eTokens.length === 0) return 0;

  const cTokenSet = new Set(tokenize(`${candidate.title || ''} ${candidate.brand || ''}`));
  if (cTokenSet.size === 0) return 0;

  let shared = 0;
  let modelMatch = false;
  for (const t of eTokens) {
    if (cTokenSet.has(t)) {
      shared++;
      if (isModelLike(t)) modelMatch = true;
    }
  }

  const overlap = shared / eTokens.length;        // 0..1
  return overlap + (modelMatch ? 0.4 : 0);        // model-number agreement is a big boost
}

/**
 * Pick the best matching candidate for an eBay listing.
 * Returns { candidate, score, confident } or null if no candidates.
 *
 * `confident` gates whether the caller should trust the Amazon price as REAL.
 */
export function bestMatch(ebayTitle, candidates = []) {
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const s = scoreCandidate(ebayTitle, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best) return null;

  // Confident if a model number agreed (score >= ~0.4 from the bonus alone, plus
  // some overlap) or there's strong overall token overlap.
  const confident = bestScore >= 0.55;
  return { candidate: best, score: Number(bestScore.toFixed(3)), confident };
}
