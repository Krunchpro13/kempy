// =============================================================================
// CLI test for the Claude matcher
// =============================================================================
// Usage:  ANTHROPIC_API_KEY=sk-... node test-matcher.js
//
// Tests the matcher in isolation (no eBay/Keepa needed) with three scenarios:
// a clear match, a tricky near-miss, and a no-match.
// =============================================================================

import 'dotenv/config';
import { matchAmazonProduct } from './src/services/claude.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('✗ ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

const TESTS = [
  {
    name: 'Clear match — same SKU, same model',
    listing: { title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones — Black' },
    candidates: [
      { asin: 'B09Y2KC2D2', title: 'Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones, Black', brand: 'Sony', amazonPrice: 278.00 },
      { asin: 'B07G4MNFS1', title: 'Sony WH-1000XM4 Wireless Premium Noise Canceling Overhead Headphones', brand: 'Sony', amazonPrice: 248.00 },
      { asin: 'B0CF8VWWR1', title: 'Sony WH-CH720N Wireless Noise Cancelling Headphone', brand: 'Sony', amazonPrice: 99.00 },
      { asin: 'B0BX1234XY', title: 'Replacement Earpads for Sony WH-1000XM5 Headphones', brand: 'Generic', amazonPrice: 14.99 },
    ],
    expectedIndex: 0,
  },
  {
    name: 'Tricky near-miss — different generation should NOT match',
    listing: { title: 'Apple AirPods Pro 2nd Generation with USB-C Charging Case' },
    candidates: [
      { asin: 'B0BDHB9Y8H', title: 'Apple AirPods Pro (1st Generation) with MagSafe Charging Case', brand: 'Apple', amazonPrice: 189.00 },
      { asin: 'B0CHWRXH8B', title: 'Apple AirPods Pro 2 with USB-C Charging Case (Latest Model)', brand: 'Apple', amazonPrice: 199.00 },
      { asin: 'B0BX9876ZZ', title: 'Silicone Case for AirPods Pro 2 with Carabiner', brand: 'Generic', amazonPrice: 8.99 },
    ],
    expectedIndex: 1, // The 2nd gen, not the 1st gen
  },
  {
    name: 'No match — accessory listed, real product not present',
    listing: { title: 'Genuine Apple iPhone 15 Pro Max 256GB Natural Titanium Unlocked' },
    candidates: [
      { asin: 'B0CHX1F5Q9', title: 'iPhone 15 Pro Max Case Clear Slim Bumper', brand: 'Generic', amazonPrice: 12.99 },
      { asin: 'B0CHX2A8X3', title: 'Tempered Glass Screen Protector for iPhone 15 Pro Max', brand: 'Generic', amazonPrice: 9.99 },
      { asin: 'B0CHX9F8P1', title: 'USB-C to Lightning Cable 6ft for iPhone', brand: 'Anker', amazonPrice: 14.99 },
    ],
    expectedIndex: null, // No actual phone in candidates
  },
];

async function run() {
  console.log('\n🤖 Testing Claude matcher with claude-haiku-4-5-20251001\n');

  let passed = 0;
  for (const test of TESTS) {
    process.stdout.write(`  ${test.name.padEnd(50)} `);
    const t = Date.now();
    const result = await matchAmazonProduct(test.listing, test.candidates);
    const ms = Date.now() - t;

    if (!result) {
      console.log('✗ API call failed');
      continue;
    }

    const expected = test.expectedIndex;
    const actual = result.match_index;
    const ok = expected === actual;

    console.log(`${ok ? '✓' : '✗'} ${ms}ms`);
    console.log(`      → match_index: ${actual} (expected ${expected})`);
    console.log(`      → confidence:  ${result.confidence}`);
    console.log(`      → reasoning:   ${result.reasoning}`);
    console.log('');

    if (ok) passed++;
  }

  console.log(`\nResult: ${passed}/${TESTS.length} passed\n`);
  process.exit(passed === TESTS.length ? 0 : 1);
}

run();
