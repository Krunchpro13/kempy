// =============================================================================
// Regression tests for the pack-size match anomalies (CR: Amazon→eBay mismatches)
// =============================================================================
// Pure-function tests — no eBay/Keepa/Claude needed. Run:  node test-normalize.js
//
// Uses the two captured examples from the change request as the canonical
// regression cases, plus controls proving genuine like-for-like pairs are
// unaffected.
// =============================================================================

import { parseQuantity, reconcile } from './src/services/unit-normalize.js';
import { finalizeMock } from './src/services/mock-sources.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? '  → ' + detail : ''}`); }
}
const flagged = (c) => c.matchQuality === 'mismatch' || c.matchQuality === 'unverified';

console.log('\n🧪 Pack-size normalisation\n');

// ---- parseQuantity ----
check('parse "5 L" → 5000ml', parseQuantity('Catsan Hygiene Cat Litter 5 L')?.total === 5000);
check('parse "60 L" → 60000ml', parseQuantity('Catsan Hygiene Cat Litter 60 L')?.total === 60000);
check('parse "16 x 140g" → 2240g, pack 16', (() => { const q = parseQuantity('Pedigree Tasty Bites 16 x 140g'); return q?.total === 2240 && q.packCount === 16; })());
check('parse "1 x 140 g" → 140g', parseQuantity('Pedigree Tasty Bites 1 x 140 g')?.total === 140);
check('parse "1.5kg" → 1500g', parseQuantity('Protein 1.5kg')?.total === 1500);
check('parse "pack of 24" → count 24', (() => { const q = parseQuantity('AA Batteries pack of 24'); return q?.family === 'count' && q.packCount === 24; })());
check('no size → null', parseQuantity('Logitech C920 HD Webcam') === null);

// ---- reconcile ----
check('reconcile 5L vs 60L → mismatch ×12', (() => { const r = reconcile(parseQuantity('x 5L'), parseQuantity('x 60L')); return r.quality === 'mismatch' && r.multiplier === 12; })());
check('reconcile 140g vs 16x140g → mismatch ×16', (() => { const r = reconcile(parseQuantity('x 140g'), parseQuantity('x 16 x 140g')); return r.quality === 'mismatch' && r.multiplier === 16; })());
check('reconcile same size → confirmed', reconcile(parseQuantity('x 500ml'), parseQuantity('x 500ml')).quality === 'confirmed');
check('reconcile volume vs weight → mismatch', reconcile(parseQuantity('x 500ml'), parseQuantity('x 500g')).quality === 'mismatch');
check('reconcile one side sized → unverified', reconcile(parseQuantity('x 1kg'), parseQuantity('no size here')).quality === 'unverified');
check('reconcile neither sized → na', reconcile(parseQuantity('webcam'), parseQuantity('webcam')).quality === 'na');

console.log('\n🧪 Profit engine (finalizeMock)\n');

// ---- Example A: Catsan 60 L (eBay) vs 5 L (Amazon) ----
const catsan = finalizeMock({
  name: 'Catsan Hygiene Cat Litter 5 L',
  sourceTitle: 'Catsan Hygiene Cat Litter 5 L',
  ebayTitle: 'Catsan Hygiene Cat Litter 60 L',
  supplierPrice: 4.24, ebayPrice: 44.99,
}, { sourceName: 'Amazon.co.uk' });
check('Catsan → mismatch flagged', catsan.matchQuality === 'mismatch', catsan.matchQuality);
check('Catsan → 12× multiplier', catsan.packMultiplier === 12, String(catsan.packMultiplier));
check('Catsan → true cost £50.88', catsan.effectiveCost === 50.88, String(catsan.effectiveCost));
check('Catsan → recomputed to a LOSS', catsan.profit < 0, '£' + catsan.profit);
check('Catsan → hidden from opportunities', flagged(catsan));

// ---- Example B: Pedigree 16×140g (eBay) vs 1×140g (Amazon) ----
const pedigree = finalizeMock({
  name: 'Pedigree Tasty Bites Minis 1 x 140 g',
  sourceTitle: 'Pedigree Tasty Bites Minis 1 x 140 g',
  ebayTitle: 'Pedigree Tasty Bites Minis 16 x 140 g',
  supplierPrice: 1.25, ebayPrice: 20.39,
}, { sourceName: 'Amazon.co.uk' });
check('Pedigree → mismatch flagged', pedigree.matchQuality === 'mismatch', pedigree.matchQuality);
check('Pedigree → 16× multiplier', pedigree.packMultiplier === 16, String(pedigree.packMultiplier));
check('Pedigree → true cost £20.00', pedigree.effectiveCost === 20, String(pedigree.effectiveCost));
check('Pedigree → recomputed to a LOSS', pedigree.profit < 0, '£' + pedigree.profit);

// ---- Control 1: genuine like-for-like pair is UNAFFECTED ----
const genuine = finalizeMock({
  name: 'Acme Shampoo 500 ml',
  sourceTitle: 'Acme Shampoo 500 ml',
  ebayTitle: 'Acme Shampoo 500 ml',
  supplierPrice: 3.00, ebayPrice: 25.00,
}, { sourceName: 'Amazon.co.uk' });
check('Genuine (same 500ml) → confirmed', genuine.matchQuality === 'confirmed', genuine.matchQuality);
check('Genuine → cost NOT scaled', genuine.packMultiplier === 1);
check('Genuine → profit positive, not flagged', genuine.profit > 0 && !flagged(genuine));

// ---- Control 2: no size on either side (most products) → unaffected ----
const noSize = finalizeMock({
  name: 'Logitech C920 Webcam',
  sourceTitle: 'Logitech C920 Webcam',
  ebayTitle: 'Logitech C920 HD Pro Webcam',
  supplierPrice: 40.00, ebayPrice: 70.00,
}, { sourceName: 'Amazon.co.uk' });
check('No-size product → na, not flagged', noSize.matchQuality === 'na' && !flagged(noSize));

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
