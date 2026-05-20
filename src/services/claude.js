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
      minimum: 0,
      maximum: 1,
      description: 'Confidence in the decision (0=guess, 1=certain)',
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
