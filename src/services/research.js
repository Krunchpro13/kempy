// =============================================================================
// Research orchestrator
// =============================================================================
// Pipeline: eBay search → Amazon candidate search → Claude semantic match →
//           profit calculation → ROI ranking.
//
// Each stage degrades gracefully: missing keys → mock fallback. Missing
// Claude key → "first result" matching (legacy behavior, less accurate).
// =============================================================================

import { searchEbay } from './ebay.js';
import { findAmazonCandidates } from './amazon.js';
import { matchAmazonProduct } from './claude.js';
import { calculateProfit } from './profit.js';
import { searchFallback } from './fallback-data.js';
import { getCachedSearch, setCachedSearch } from './cache.js';

const MIN_MATCH_CONFIDENCE = 0.7;

/**
 * Top-level search. Returns ranked product opportunities for a query.
 *
 * @param {string} query
 * @returns {Promise<{ products: Array, cached: boolean }>}
 */
export async function searchProducts(query) {
  // Cache check — short-circuits everything below
  const cached = await getCachedSearch(query);
  if (cached) return { products: cached, cached: true };

  const products = await runPipeline(query);

  // Only cache live results — caching mock data is pointless and would
  // mask a config issue if someone added keys mid-session
  if (products.length > 0 && products[0].source !== 'mock') {
    await setCachedSearch(query, products);
  }

  return { products, cached: false };
}

async function runPipeline(query) {
  // -------- Live path: both data APIs configured --------
  if (process.env.EBAY_CLIENT_ID && process.env.KEEPA_API_KEY) {
    return await liveSearch(query);
  }

  // -------- Partial-live: eBay only (no Amazon supplier price) --------
  if (process.env.EBAY_CLIENT_ID && !process.env.KEEPA_API_KEY) {
    const listings = await searchEbay(query);
    return (listings || []).map((l) => ({
      name: l.title,
      cat: 'eBay (live)',
      ebayPrice: l.ebayPrice,
      amazonPrice: null,
      profit: null,
      roi: null,
      verdictLabel: '⚠ Add Keepa key for Amazon supplier prices',
      verdictClass: 'medium',
      ebayUrl: l.url,
      image: l.image,
      vol: l.watchCount,
      comp: 'Unknown',
      trend: 'Unknown',
      source: 'live-ebay-only',
    }));
  }

  // -------- Fallback: mock data --------
  return mockSearch(query);
}

// ---- Implementation: full live ----

async function liveSearch(query) {
  const ebayListings = await searchEbay(query, 8);
  if (!ebayListings || ebayListings.length === 0) return [];

  const useClaude = !!process.env.ANTHROPIC_API_KEY;
  const results = [];

  // Sequential to respect Keepa/Anthropic rate limits.
  // For production: parallel with Promise.allSettled + concurrency limit.
  for (const listing of ebayListings) {
    const cleanedTitle = cleanTitle(listing.title);

    let candidates = null;
    try {
      candidates = await findAmazonCandidates(cleanedTitle, 5);
    } catch (err) {
      console.error(`[liveSearch] Keepa lookup failed for "${cleanedTitle}":`, err.message);
      continue;
    }

    if (!candidates || candidates.length === 0) continue;

    // ---- Match selection: Claude if available, else first result ----
    let amazonMatch = null;
    let matchInfo = { source: 'first-result', confidence: null };

    if (useClaude) {
      try {
        const decision = await matchAmazonProduct(listing, candidates);

        if (decision) {
          if (decision.match_index === null) {
            // Claude says no candidate matches — skip this listing entirely
            // (better than showing wrong supplier price)
            continue;
          }
          if (decision.confidence >= MIN_MATCH_CONFIDENCE
              && decision.match_index >= 0
              && decision.match_index < candidates.length) {
            amazonMatch = candidates[decision.match_index];
            matchInfo = {
              source: 'claude',
              confidence: decision.confidence,
              reasoning: decision.reasoning,
            };
          } else {
            // Low confidence — also skip
            continue;
          }
        }
      } catch (err) {
        console.error('[liveSearch] Claude match failed:', err.message);
        // Fall through to first-result fallback below
      }
    }

    if (!amazonMatch) {
      amazonMatch = candidates[0];
    }

    const profit = calculateProfit({
      ebayPrice: listing.ebayPrice,
      amazonPrice: amazonMatch.amazonPrice,
      shipping: listing.shippingCost || 8,
      packaging: 3,
    });

    results.push({
      name: listing.title,
      cat: amazonMatch.brand || 'Live match',
      emoji: '📦',
      ebayPrice: listing.ebayPrice,
      amazonPrice: amazonMatch.amazonPrice,
      ...profit,
      ebayUrl: listing.url,
      amazonUrl: amazonMatch.url,
      ebayImage: listing.image,
      amazonImage: amazonMatch.image,
      asin: amazonMatch.asin,
      matchSource: matchInfo.source,
      matchConfidence: matchInfo.confidence,
      matchReasoning: matchInfo.reasoning,
      vol: listing.watchCount,
      comp: comprehensiveCompetition(listing.watchCount),
      trend: 'Live',
      source: 'live',
    });
  }

  results.sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
  return results;
}

// ---- Implementation: mock ----

function mockSearch(query) {
  const matches = searchFallback(query);

  return matches
    .map((p) => {
      const profit = calculateProfit({
        ebayPrice: p.ebayPrice,
        amazonPrice: p.amazonPrice,
        shipping: p.shipping,
        packaging: p.packaging,
      });
      return {
        name: p.name,
        cat: p.cat,
        emoji: p.emoji,
        ebayPrice: p.ebayPrice,
        amazonPrice: p.amazonPrice,
        ...profit,
        vol: p.vol,
        comp: p.comp,
        trend: p.trend,
        source: 'mock',
      };
    })
    .sort((a, b) => b.roi - a.roi);
}

// ---- Helpers ----

function cleanTitle(title) {
  return title
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(new|sealed|brand new|free shipping|fast ship|us seller|authentic)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function comprehensiveCompetition(watchCount) {
  if (watchCount > 50) return 'Very High';
  if (watchCount > 20) return 'High';
  if (watchCount > 5) return 'Medium';
  return 'Low';
}

