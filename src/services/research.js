// src/services/research.js
import { searchEbay } from './ebay.js';
import { findAmazonCandidates } from './amazon.js';
import { bestMatch } from './match-local.js';
import { matchAmazonBatch } from './claude.js';
import { FALLBACK_PRODUCTS } from './fallback-data.js';

const FEE_RATE = 0.129;
const PACKAGING = 1.50;

function emojiFor(name = '') {
  const n = name.toLowerCase();
  if (/headphone|earbud|airpod|earphone/.test(n)) return '🎧';
  if (/watch|smartwatch/.test(n)) return '⌚';
  if (/cable|cord/.test(n)) return '🔌';
  if (/charger|adapter|power/.test(n)) return '🔌';
  if (/webcam|camera/.test(n)) return '📷';
  if (/bag|handbag|purse|tote/.test(n)) return '👜';
  if (/phone|iphone|galaxy/.test(n)) return '📱';
  if (/laptop|macbook/.test(n)) return '💻';
  if (/keyboard/.test(n)) return '⌨️';
  if (/mouse/.test(n)) return '🖱️';
  if (/lamp|light/.test(n)) return '💡';
  return '📦';
}

function round2(n) { return Math.round(n * 100) / 100; }

// Decide the Amazon match for every eBay item against the shared candidate pool.
// Strategy:
//   - With ANTHROPIC_API_KEY: ONE batch Claude call for all items (fast, cheap,
//     no per-connection rate-limit issues). Falls back to local if it errors.
//   - Without a key (or on Claude error): the local heuristic matcher per item.
// Returns an array (aligned to items) of { candidate, confident, via } | null.
async function matchAll(items, candidates) {
  if (!candidates || !candidates.length) return items.map(() => null);

  let claudeMatches = null;
  if (process.env.ANTHROPIC_API_KEY) {
    claudeMatches = await matchAmazonBatch(items.map(i => ({ title: i.name })), candidates);
  }

  return items.map((item, idx) => {
    if (claudeMatches) {
      const cm = claudeMatches[idx];
      if (cm && cm.match_index != null && candidates[cm.match_index]) {
        return {
          candidate: candidates[cm.match_index],
          confident: (cm.confidence ?? 0) >= 0.6,
          via: 'claude',
        };
      }
      return null; // Claude ran but found no match for this item → estimate
    }
    // No Claude (no key, or batch failed) → local heuristic
    const local = bestMatch(item.name, candidates);
    return local ? { candidate: local.candidate, confident: local.confident, via: 'local' } : null;
  });
}

// Build a product card. If `match` is a confident match with a real Amazon
// price, use it (real ROI). Otherwise fall back to a clearly-flagged estimate
// rather than presenting a fabricated price as if it were real.
function buildProduct(item, match = null) {
  const ebayPrice = item.ebayPrice;
  const shipping = item.ebayShipping != null ? item.ebayShipping : 6;

  const hasReal = !!(match && match.confident && match.candidate?.amazonPrice > 0);
  const amazonPrice = hasReal ? match.candidate.amazonPrice : round2(ebayPrice * 0.72);

  const fees = round2(ebayPrice * FEE_RATE);
  const packaging = PACKAGING;
  const profit = round2(ebayPrice - amazonPrice - fees - shipping - packaging);
  const roi = amazonPrice > 0 ? round2((profit / amazonPrice) * 100) : 0;

  return {
    name: item.name,
    emoji: emojiFor(item.name),
    cat: item.categories?.[0] || 'Marketplace',
    vol: '—',
    comp: 'live',
    trend: '—',
    ebayPrice,
    amazonPrice,
    ebayUrl: item.ebayUrl,
    amazonUrl: hasReal ? match.candidate.url : null,
    fees,
    shipping,
    packaging,
    profit,
    roi,
    asin: hasReal ? match.candidate.asin : null,
    estimated: !hasReal,                                  // honest flag for the UI
    matchSource: hasReal ? `ebay+keepa(${match.via})` : 'estimate',
    image: item.image,
    condition: item.condition,
    ebayItemId: item.ebayItemId,
  };
}

export async function searchProducts(query) {
  const q = (query || '').toLowerCase().trim();

  const hasEbay = !!process.env.EBAY_CLIENT_ID;
  if (hasEbay && q && q !== 'all') {
    try {
      const items = await searchEbay(query, { limit: 24 });
      if (items.length) {
        // One Keepa search for the query → shared pool of real Amazon candidates
        // (titles + prices). ~10 tokens regardless of how many eBay items we map.
        let candidates = [];
        try {
          candidates = (await findAmazonCandidates(query, 20)) || [];
        } catch (err) {
          console.error('[research] Keepa candidate search failed:', err.message);
        }

        // Match all eBay listings against the shared pool (one batch Claude call
        // when the key is set, else the local matcher), then build cards.
        const matches = await matchAll(items, candidates);
        const enriched = items.map((item, idx) => buildProduct(item, matches[idx]));

        // Real (confident) matches first, then estimates; each block by ROI.
        const products = enriched
          .filter(p => p.amazonPrice > 0.5)
          .sort((a, b) => {
            if (a.estimated !== b.estimated) return a.estimated ? 1 : -1;
            return (b.roi || 0) - (a.roi || 0);
          });

        const realCount = products.filter(p => !p.estimated).length;
        return { products, cached: false, source: 'ebay+keepa', realCount };
      }
    } catch (err) {
      console.error('[research] eBay/Keepa failed, falling back:', err.message);
    }
  }

  // Fallback to mock data
  let products = FALLBACK_PRODUCTS.slice();
  if (q && q !== 'all') {
    products = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.cat.toLowerCase().includes(q) ||
      (p.keywords || []).some(k => k.toLowerCase().includes(q))
    );
  }
  products.sort((a, b) => (b.roi || 0) - (a.roi || 0));
  return { products, cached: false, source: 'mock' };
}