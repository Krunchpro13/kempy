---
name: kempy-amazon-pipeline-fixed
description: KEMPY — how the eBay→Amazon→ROI search pipeline works after the 2026-05-29 fix
metadata:
  type: project
---

On 2026-05-29 the KEMPY search pipeline was fixed so it produces REAL Amazon prices/ROI instead
of a fake `ebayPrice × 0.72` estimate.

**Before:** `research.js` only enriched eBay items via Keepa *by ASIN*, but eBay Browse listings
carry no ASIN, so Keepa was never called → all "Amazon" prices were the ×0.72 estimate and every
ROI was fictional (~+20% mechanically). Separately, `findAmazonCandidates` in `amazon.js` read a
nonexistent `asinList` field (Keepa `/search` returns `products`), so it always returned [].

**After (current design):**
1. `searchEbay(query)` → up to 24 real eBay listings.
2. `findAmazonCandidates(query, 20)` → ONE Keepa `/search?stats=1` call (~10 tokens) returns ~20
   real Amazon products with titles + prices. (Fixed to read `products`, single call.)
3. Each eBay listing is matched against that shared candidate pool via `matchOne()`:
   Claude (`claude.js`) if `ANTHROPIC_API_KEY` set, else local heuristic (`match-local.js`).
4. Confident match → real Amazon price/ASIN, `matchSource: 'ebay+keepa(...)'`, `estimated:false`.
   No confident match → flagged `estimated:true`, `matchSource:'estimate'`, ×0.72 fallback.
5. Real matches sort before estimates. `research.html` shows an amber "(est.)" badge + "Estimated
   ROI" label for estimated cards.

Cost: ~10 Keepa tokens per unique query (one pool fetch, not per-item). See [[kempy-operational-gotchas]].

Files changed: `src/services/amazon.js`, `src/services/research.js`, new
`src/services/match-local.js`, `public/app/research.html`. Changes were left UNCOMMITTED for owner
review.
