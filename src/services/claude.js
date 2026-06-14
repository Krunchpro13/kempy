// =============================================================================
// Claude API matcher
// =============================================================================
// Given an eBay listing and N Amazon candidates, asks Claude Haiku 4.5 which
// candidate is the same SKU. Uses structured outputs so the response is
// guaranteed to be valid JSON matching our schema.
//
// Model: claude-haiku-4-5-20251001 (cheapest production model, ~$1/$5 per MTok)
// Cost per match: ~500 tokens in + ~80 tokens out ≈ $0.0009
// At 8 eBay listings × 1 match each = ~$0.007 per search query.
//
// Docs:
//   Messages API:        https://docs.claude.com/en/api/messages
//   Structured outputs:  https://docs.claude.com/en/build-with-claude/structured-outputs
// =============================================================================

import axios from 'axios';
import { getCachedMatch, setCachedMatch } from './cache.js';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const MATCH_SCHEMA = {
  type: 'object',
  properties: {
    match_index: {
      type: ['integer', 'null'],
      description: 'Zero-based index of the matching Amazon candidate, or null if none match',
    },
    confidence: {
      type: 'number',
      description: 'Confidence in the decision from 0 (guess) to 1 (certain)',
    },
    reasoning: {
      type: 'string',
      description: 'One sentence explaining the choice or rejection',
    },
  },
  required: ['match_index', 'confidence', 'reasoning'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You match eBay listings to Amazon products for a dropshipping research tool. \
A correct match is the SAME product — same model number, same SKU, same configuration. \
Color and size variants of the same model are acceptable matches. \
Different model numbers, different generations, or "compatible with X" accessories are NOT matches. \
Be strict: a wrong match leads to wrong supplier prices and bad business decisions. \
When in doubt, return null and let the human investigate.`;

/**
 * Match an eBay listing to one of N Amazon candidates using Claude.
 *
 * @param {{ title: string }} ebayListing
 * @param {Array<{ title: string, asin: string, brand?: string, amazonPrice: number }>} candidates
 * @returns {Promise<{ match_index: number|null, confidence: number, reasoning: string } | null>}
 */
export async function matchAmazonProduct(ebayListing, candidates) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!candidates || candidates.length === 0) return null;

  // Cache check — decision is deterministic for a given (title, candidate set)
  const cached = await getCachedMatch(ebayListing.title, candidates);
  if (cached) return cached;

  const candidateList = candidates
    .map((c, i) => {
      const brand = c.brand ? `[${c.brand}] ` : '';
      const price = c.amazonPrice ? `$${c.amazonPrice.toFixed(2)}` : 'no price';
      return `${i}: ${brand}"${c.title}" — ASIN ${c.asin}, ${price}`;
    })
    .join('\n');

  const userPrompt = `eBay listing:
"${ebayListing.title}"

Amazon candidates:
${candidateList}

Which candidate is the SAME product? Return the index, or null if none match.`;

  try {
    const { data } = await axios.post(
      CLAUDE_API,
      {
        model: MODEL,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: MATCH_SCHEMA,
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 20_000,
      }
    );

    const text = data?.content?.[0]?.text;
    if (!text) return null;

    // Structured outputs guarantees valid JSON, but defensive parsing anyway
    const decision = JSON.parse(text);
    await setCachedMatch(ebayListing.title, candidates, decision);
    return decision;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[claude.match] error:', msg);
    return null;
  }
}

const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      description: 'One entry per eBay listing, in the same order as given',
      items: {
        type: 'object',
        properties: {
          ebay_index: { type: 'integer', description: 'Index of the eBay listing' },
          match_index: {
            type: ['integer', 'null'],
            description: 'Index of the matching Amazon candidate, or null if none match',
          },
          confidence: { type: 'number', description: 'Confidence 0 (guess) to 1 (certain)' },
        },
        required: ['ebay_index', 'match_index', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

/**
 * Match MANY eBay listings to a shared Amazon candidate pool in ONE Claude call.
 * Far cheaper/faster than calling matchAmazonProduct per listing, and avoids the
 * per-account concurrent-connection limit.
 *
 * @param {Array<{ title: string }>} ebayListings
 * @param {Array<{ title: string, asin: string, brand?: string, amazonPrice: number }>} candidates
 * @returns {Promise<Array<{ match_index: number|null, confidence: number } | null>>}
 *          Array aligned to ebayListings (null where Claude gave no entry). Returns
 *          null entirely if the key is missing, there are no candidates, or it errors.
 */
export async function matchAmazonBatch(ebayListings, candidates) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!candidates || candidates.length === 0) return null;
  if (!ebayListings || ebayListings.length === 0) return [];

  const candidateList = candidates
    .map((c, i) => {
      const brand = c.brand ? `[${c.brand}] ` : '';
      const price = c.amazonPrice ? `$${c.amazonPrice.toFixed(2)}` : 'no price';
      return `${i}: ${brand}"${c.title}" — ASIN ${c.asin}, ${price}`;
    })
    .join('\n');

  const ebayList = ebayListings
    .map((e, i) => `${i}: "${e.title}"`)
    .join('\n');

  const userPrompt = `Amazon candidates:
${candidateList}

eBay listings:
${ebayList}

For EACH eBay listing, return the index of the Amazon candidate that is the SAME product, or null if none match. Return one entry per eBay listing.`;

  try {
    const { data } = await axios.post(
      CLAUDE_API,
      {
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: BATCH_SCHEMA } },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30_000,
      }
    );

    const text = data?.content?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    const out = new Array(ebayListings.length).fill(null);
    for (const m of parsed.matches || []) {
      if (m.ebay_index >= 0 && m.ebay_index < out.length) {
        out[m.ebay_index] = { match_index: m.match_index, confidence: m.confidence ?? 0 };
      }
    }
    return out;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[claude.batch] error:', msg);
    return null;
  }
}

// =============================================================================
// Source → eBay matcher (source-primary direction)
// =============================================================================
// The reverse of matchAmazonBatch: given SOURCE products (Amazon/AliExpress/
// TikTok) and, for EACH one, its own list of candidate eBay resale listings,
// pick which candidate(s) are genuinely the same product. This both (a) prices
// from confirmed comparables instead of a blind median over loosely-related
// results, and (b) turns "no match" into a trustworthy "no eBay comparable
// exists" signal (a real market gap) rather than a search/keyword miss.

const SOURCE_SYSTEM_PROMPT = `You match a SOURCE product (sold on Amazon/AliExpress/TikTok) to its resale \
listings on eBay for a dropshipping research tool. A correct match is the SAME product — same model number, \
same SKU, same configuration. Colour variants of the same model are acceptable matches. Different \
models, different generations, or "compatible with X" accessories are NOT matches. \
CRUCIALLY, pay attention to PACK SIZE and UNIT QUANTITY: a single unit is NOT the same as a multipack, and \
different volumes/weights are NOT the same product (e.g. "5L" vs "60L", "1 x 140g" vs "16 x 140g", \
"pack of 6" vs a single). A different pack size is NOT a match — it sells for a totally different price and \
costs a different amount to fulfil. Be strict: a wrong match produces a wrong resale price and a bad business \
decision. When no eBay listing is genuinely the same product (same model AND same pack size), returning an \
empty match list is the correct, expected answer.`;

const SOURCE_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      description: 'One entry per source product, in the same order as given',
      items: {
        type: 'object',
        properties: {
          product_index: { type: 'integer', description: 'Index of the source product' },
          match_indices: {
            type: 'array',
            items: { type: 'integer' },
            description: "Indices (within THIS product's own candidate list) of eBay listings that are the SAME product; empty if none match",
          },
          confidence: { type: 'number', description: 'Confidence 0 (guess) to 1 (certain)' },
        },
        required: ['product_index', 'match_indices', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

const trimTitle = (s, words = 14) => String(s || '').split(/\s+/).slice(0, words).join(' ');

/**
 * Match MANY source products to their OWN candidate eBay listings in ONE call.
 *
 * @param {Array<{ title: string, candidates: Array<{ title: string, price?: number }> }>} products
 * @returns {Promise<Array<{ match_indices: number[], confidence: number } | null>>}
 *          Array aligned to `products` (null where Claude gave no entry).
 *          Returns null entirely if the key is missing or the call errors —
 *          callers should fall back to a heuristic in that case.
 */
export async function matchEbayBatch(products) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!products || products.length === 0) return [];

  const block = products
    .map((p, i) => {
      const cands = (p.candidates || [])
        .map((c, j) => `    ${j}: "${trimTitle(c.title)}" — £${Number(c.price || 0).toFixed(2)}`)
        .join('\n');
      return `Product ${i}: "${trimTitle(p.title)}"\n  eBay candidates:\n${cands || '    (none)'}`;
    })
    .join('\n\n');

  const userPrompt = `For EACH source product below, identify which of ITS OWN eBay candidate listings are \
the SAME product. Return the matching candidate indices (relative to that product's own list), or an empty \
array when none of its candidates are genuinely the same product.

${block}`;

  try {
    const { data } = await axios.post(
      CLAUDE_API,
      {
        model: MODEL,
        max_tokens: 2048,
        system: SOURCE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: SOURCE_MATCH_SCHEMA } },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30_000,
      }
    );

    const text = data?.content?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    const out = new Array(products.length).fill(null);
    for (const m of parsed.matches || []) {
      if (m.product_index >= 0 && m.product_index < out.length) {
        out[m.product_index] = {
          match_indices: Array.isArray(m.match_indices) ? m.match_indices : [],
          confidence: m.confidence ?? 0,
        };
      }
    }
    return out;
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[claude.ebay-batch] error:', msg);
    return null;
  }
}
