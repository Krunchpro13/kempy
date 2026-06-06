// =============================================================================
// Fallback / mock data — Amazon.co.uk → eBay.co.uk (UK, GBP)
// =============================================================================
// Used when API keys aren't configured, so the server still works end-to-end.
// Prices are GBP (the app's base currency). `amazonPrice` = Amazon.co.uk supplier
// cost; these are run through finalizeMock() in research.js so each card gets real
// fees/profit/ROI. Icons (not emoji) are rendered by the frontend.
// =============================================================================

export const FALLBACK_PRODUCTS = [
  { name: 'Sony WH-1000XM5 Wireless Headphones', cat: 'Electronics > Headphones',
    ebayPrice: 279.99, amazonPrice: 219.00, shipping: 4, packaging: 1.5, vol: 1247, comp: 'Medium', trend: 'Stable',
    keywords: ['headphones', 'sony', 'wireless', 'audio'] },
  { name: 'Apple AirPods Pro (2nd Gen)', cat: 'Electronics > Audio',
    ebayPrice: 199.99, amazonPrice: 159.00, shipping: 3, packaging: 1.5, vol: 2156, comp: 'Very High', trend: 'Stable',
    keywords: ['airpods', 'headphones', 'apple', 'earbuds', 'wireless'] },
  { name: 'Anker Soundcore Liberty 4 Earbuds', cat: 'Electronics > Audio',
    ebayPrice: 69.99, amazonPrice: 42.00, shipping: 2.5, packaging: 1, vol: 342, comp: 'Low', trend: 'Growing',
    keywords: ['earbuds', 'anker', 'headphones', 'wireless', 'audio'] },
  { name: 'USB-C Charging Cable (2m, braided)', cat: 'Electronics > Cables',
    ebayPrice: 10.99, amazonPrice: 3.20, shipping: 1.2, packaging: 0.5, vol: 5000, comp: 'High', trend: 'Stable',
    keywords: ['cable', 'usb', 'usb-c', 'charger', 'accessory'] },
  { name: 'Vintage Collectible Watch', cat: 'Collectibles > Watches',
    ebayPrice: 189.99, amazonPrice: 79.00, shipping: 3.5, packaging: 2, vol: 8, comp: 'Low', trend: 'Stable',
    keywords: ['watch', 'vintage', 'collectible', 'jewellery'] },
  { name: 'Designer Tote Handbag', cat: 'Fashion > Bags',
    ebayPrice: 159.99, amazonPrice: 72.00, shipping: 3.5, packaging: 1.5, vol: 25, comp: 'Medium', trend: 'Growing',
    keywords: ['handbag', 'designer', 'fashion', 'bag', 'purse', 'tote'] },
  { name: 'Samsung 65" QLED 4K Smart TV', cat: 'Electronics > TVs',
    ebayPrice: 749.99, amazonPrice: 599.00, shipping: 12, packaging: 4, vol: 3, comp: 'High', trend: 'Stable',
    keywords: ['tv', 'samsung', 'television', 'qled'] },
  { name: '20W USB-C Phone Charger', cat: 'Electronics > Chargers',
    ebayPrice: 15.99, amazonPrice: 6.20, shipping: 1.5, packaging: 0.5, vol: 2100, comp: 'Medium', trend: 'Stable',
    keywords: ['charger', 'phone', 'brick', 'adapter'] },
  { name: '7-Port USB Hub Adapter', cat: 'Electronics > Adapters',
    ebayPrice: 28.99, amazonPrice: 13.00, shipping: 2, packaging: 0.8, vol: 1800, comp: 'Medium', trend: 'Growing',
    keywords: ['adapter', 'usb', 'hub'] },
  { name: 'iPhone 15 Pro Protective Case', cat: 'Electronics > Cases',
    ebayPrice: 19.99, amazonPrice: 6.50, shipping: 1.2, packaging: 0.5, vol: 3200, comp: 'High', trend: 'Growing',
    keywords: ['case', 'phone', 'iphone'] },
  { name: '1080p HD Webcam with Mic', cat: 'Electronics > Webcams',
    ebayPrice: 39.99, amazonPrice: 18.00, shipping: 2.5, packaging: 1, vol: 580, comp: 'Medium', trend: 'Growing',
    keywords: ['webcam', 'camera', 'video', 'streaming'] },
  { name: 'RGB Mechanical Gaming Keyboard', cat: 'Electronics > Keyboards',
    ebayPrice: 74.99, amazonPrice: 44.00, shipping: 3, packaging: 1, vol: 410, comp: 'Medium', trend: 'Growing',
    keywords: ['keyboard', 'mechanical', 'gaming', 'rgb'] },
  { name: 'Aluminium Adjustable Laptop Stand', cat: 'Electronics > Accessories',
    ebayPrice: 32.99, amazonPrice: 15.00, shipping: 2.5, packaging: 1, vol: 720, comp: 'Low', trend: 'Growing',
    keywords: ['laptop', 'stand', 'desk', 'accessory'] },
  { name: 'Wireless Gaming Mouse', cat: 'Electronics > Mice',
    ebayPrice: 44.99, amazonPrice: 24.00, shipping: 2, packaging: 1, vol: 890, comp: 'Medium', trend: 'Stable',
    keywords: ['mouse', 'gaming', 'wireless'] },
  { name: 'LED Desk Lamp with USB Port', cat: 'Home > Lighting',
    ebayPrice: 27.99, amazonPrice: 11.50, shipping: 2.5, packaging: 1, vol: 530, comp: 'Low', trend: 'Stable',
    keywords: ['lamp', 'desk', 'light', 'led'] },
];

export function searchFallback(q) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  if (query === 'all' || query === '*') return [...FALLBACK_PRODUCTS];
  return FALLBACK_PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(query) ||
    p.cat.toLowerCase().includes(query) ||
    p.keywords.some((k) => k.includes(query) || query.includes(k))
  );
}
