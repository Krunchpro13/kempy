// src/services/research.js
import { searchEbay } from './ebay.js';
import { getProductData } from './keepa.js';
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

// Try to get real Amazon data from Keepa using an ASIN
async function enrichWithKeepa(item) {
  if (!item.asin) return null;           // No ASIN → can't use Keepa yet

  const keepaData = await getProductData(item.asin);
  if (!keepaData) return null;

  // Keepa returns prices as integers (e.g. 1999 = \$19.99)
  const amazonPrice = keepaData.stats?.current?.[0]
    ? keepaData.stats.current[0] / 100
    : null;

  const volume = keepaData.stats?.avg30?.[0] || null; // 30-day average sales rank

  return {
    amazonPrice,
    volume,
    amazonUrl: `https://www.amazon.com/dp/${item.asin}`
  };
}

function buildProduct(item, keepaData = null) {
  const ebayPrice = item.ebayPrice;
  const shipping = item.ebayShipping != null ? item.ebayShipping : 6;

  // Use real Amazon price if Keepa gave us one, otherwise use the old estimate
  const amazonPrice = keepaData?.amazonPrice ?? round2(ebayPrice * 0.72);

  const fees = round2(ebayPrice * FEE_RATE);
  const packaging = PACKAGING;
  const profit = round2(ebayPrice - amazonPrice - fees - shipping - packaging);
  const roi = amazonPrice > 0 ? round2((profit / amazonPrice) * 100) : 0;

  return {
    name: item.name,
    emoji: emojiFor(item.name),
    cat: item.categories?.[0] || 'Marketplace',
    vol: keepaData?.volume ? Math.round(keepaData.volume) : '—',
    comp: 'live',
    trend: '—',
    ebayPrice,
    amazonPrice,
    ebayUrl: item.ebayUrl,
    amazonUrl: keepaData?.amazonUrl || null,
    fees,
    shipping,
    packaging,
    profit,
    roi,
    asin: item.asin || null,
    matchSource: keepaData ? 'ebay+keepa' : 'ebay',
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
        // Try to enrich each item with Keepa data
        const enriched = await Promise.all(
          items.map(async (item) => {
            const keepa = await enrichWithKeepa(item);
            return buildProduct(item, keepa);
          })
        );

        const products = enriched
          .filter(p => p.amazonPrice > 0.5)
          .sort((a, b) => (b.roi || 0) - (a.roi || 0));

        return { products, cached: false, source: 'ebay+keepa' };
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