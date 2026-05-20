// =============================================================================
// Fallback / mock data
// =============================================================================
// Used when API keys aren't configured, so the server still works end-to-end.
// Same product set as the original front-end demo.
// =============================================================================

export const FALLBACK_PRODUCTS = [
  { name: 'Sony WH-1000XM5 Wireless Headphones', cat: 'Electronics > Headphones', emoji: '🎧',
    ebayPrice: 349.99, amazonPrice: 278.00, shipping: 15, packaging: 3, vol: 1247, comp: 'Medium', trend: 'Stable',
    keywords: ['headphones', 'sony', 'wireless', 'audio'] },
  { name: 'Apple AirPods Pro (2nd Gen)', cat: 'Electronics > Audio', emoji: '🎧',
    ebayPrice: 249.99, amazonPrice: 189.00, shipping: 10, packaging: 3, vol: 2156, comp: 'Very High', trend: 'Stable',
    keywords: ['airpods', 'headphones', 'apple', 'earbuds', 'wireless'] },
  { name: 'Anker Soundcore Liberty Earbuds', cat: 'Electronics > Audio', emoji: '🎧',
    ebayPrice: 79.99, amazonPrice: 49.00, shipping: 8, packaging: 2, vol: 342, comp: 'Low', trend: 'Growing',
    keywords: ['earbuds', 'anker', 'headphones', 'wireless', 'audio'] },
  { name: 'USB-C Charging Cable (6ft)', cat: 'Electronics > Cables', emoji: '🔌',
    ebayPrice: 12.99, amazonPrice: 3.50, shipping: 2, packaging: 1, vol: 5000, comp: 'High', trend: 'Stable',
    keywords: ['cable', 'usb', 'usb-c', 'charger', 'accessory'] },
  { name: 'Vintage Collectible Watch', cat: 'Collectibles > Watches', emoji: '⌚',
    ebayPrice: 249.99, amazonPrice: 89.00, shipping: 10, packaging: 5, vol: 8, comp: 'Low', trend: 'Stable',
    keywords: ['watch', 'vintage', 'collectible', 'jewelry'] },
  { name: 'Designer Handbag', cat: 'Fashion > Bags', emoji: '👜',
    ebayPrice: 199.99, amazonPrice: 89.00, shipping: 12, packaging: 4, vol: 25, comp: 'Medium', trend: 'Growing',
    keywords: ['handbag', 'designer', 'fashion', 'bag', 'purse'] },
  { name: 'Samsung 65" QLED 4K TV', cat: 'Electronics > TVs', emoji: '📺',
    ebayPrice: 899.99, amazonPrice: 699.00, shipping: 50, packaging: 10, vol: 3, comp: 'High', trend: 'Stable',
    keywords: ['tv', 'samsung', 'television', 'qled'] },
  { name: '20W Phone Charger Brick', cat: 'Electronics > Chargers', emoji: '🔋',
    ebayPrice: 19.99, amazonPrice: 7.50, shipping: 3, packaging: 1, vol: 2100, comp: 'Medium', trend: 'Stable',
    keywords: ['charger', 'phone', 'brick', 'adapter'] },
  { name: 'USB Hub 7-Port Adapter', cat: 'Electronics > Adapters', emoji: '🔌',
    ebayPrice: 34.99, amazonPrice: 16.00, shipping: 4, packaging: 1, vol: 1800, comp: 'Medium', trend: 'Growing',
    keywords: ['adapter', 'usb', 'hub'] },
  { name: 'iPhone 15 Pro Phone Case', cat: 'Electronics > Cases', emoji: '📱',
    ebayPrice: 24.99, amazonPrice: 8.00, shipping: 3, packaging: 1, vol: 3200, comp: 'High', trend: 'Growing',
    keywords: ['case', 'phone', 'iphone'] },
  { name: '1080p HD Webcam with Mic', cat: 'Electronics > Webcams', emoji: '📷',
    ebayPrice: 49.99, amazonPrice: 22.00, shipping: 5, packaging: 2, vol: 580, comp: 'Medium', trend: 'Growing',
    keywords: ['webcam', 'camera', 'video', 'streaming'] },
  { name: 'Mechanical Gaming Keyboard RGB', cat: 'Electronics > Keyboards', emoji: '⌨️',
    ebayPrice: 89.99, amazonPrice: 52.00, shipping: 8, packaging: 2, vol: 410, comp: 'Medium', trend: 'Growing',
    keywords: ['keyboard', 'mechanical', 'gaming', 'rgb'] },
  { name: 'Adjustable Aluminum Laptop Stand', cat: 'Electronics > Accessories', emoji: '💻',
    ebayPrice: 39.99, amazonPrice: 18.00, shipping: 6, packaging: 2, vol: 720, comp: 'Low', trend: 'Growing',
    keywords: ['laptop', 'stand', 'desk', 'accessory'] },
  { name: 'Wireless Gaming Mouse', cat: 'Electronics > Mice', emoji: '🖱️',
    ebayPrice: 54.99, amazonPrice: 29.00, shipping: 4, packaging: 2, vol: 890, comp: 'Medium', trend: 'Stable',
    keywords: ['mouse', 'gaming', 'wireless'] },
  { name: 'LED Desk Lamp with USB Port', cat: 'Home > Lighting', emoji: '💡',
    ebayPrice: 32.99, amazonPrice: 14.00, shipping: 6, packaging: 2, vol: 530, comp: 'Low', trend: 'Stable',
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
