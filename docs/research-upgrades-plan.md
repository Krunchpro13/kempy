# Product Research Upgrades — Executable Action Plan

**Source:** Kempzonline Product Research Change Request v1.1 (FR-1…FR-4), Fred (Product Owner), 9 Jun 2026.
**Status:** Plan ready for implementation. Grounded in the current codebase + verified against live eBay / Keepa / AliExpress / EchoTik API capabilities (June 2026).

---

## 0. TL;DR — what's buildable, what isn't

| Ref | Requirement | Verdict | Effort | Blocker / decision |
|----|----|----|----|----|
| **FR-1** | Dual-platform display (source + eBay side by side) | ✅ **Build now** | M | None — margin calc already exists; add fields + UI |
| **FR-2** | Cross-platform identifiers (ASIN, source IDs, eBay item #, GTIN) | 🟡 **Mostly now** | M | AliExpress/TikTok have **no GTIN** (impossible); TikTok product URL is best-effort; eBay GTIN/epid cost extra |
| **FR-3** | eBay seller store reverse-scan | ✅ **Buildable now** | L | Operationally constrained: eBay 5,000 calls/day shared quota; `category_ids=0` full-store trick is undocumented; AliExpress/TikTok reverse-match is fuzzy |
| **FR-4a** | Price-band filter (£15–£60), price-point search, adjustable settings | ✅ **Build now** | S–M | None |
| **FR-4b** | Amazon **Prime-only** filter | ✅ **Build now** | M | Keepa token cost rises ~5× when enabled (gate behind toggle) |
| **FR-4c** | **≥30 eBay sales/month** + "consistent sales history" | ❌ **Not possible on current APIs** | L | **DECISION REQUIRED** — needs eBay Marketplace Insights (restricted/partner-gated) or a paid 3rd-party sold-data scraper. See §6. |

**Bottom line:** Phase 1 (FR-1 + FR-2) and most of Phase 2 (FR-4 price band + Prime) are clean builds on the existing engine. The **sales-velocity filter (FR-4c) is the one requirement the platform's data sources cannot satisfy as written** — it must be re-scoped or backed by a new (restricted/paid) data source. FR-3 is buildable but needs guardrails to avoid burning the shared eBay quota.

---

## 1. Decisions needed from the Product Owner (take these back to the boss)

1. **FR-4c "30 sales/month + sustained history" — pick a path (this is the big one):**
   - **(A) Restricted official data** — apply for eBay **Marketplace Insights API** (the only official source of sold-quantity + sold-date over ~90 days). It's a *Limited Release*; non-partner apps are **routinely declined**. If granted, the filter works properly. *Timeline: unknown, approval-gated.*
   - **(B) Paid third-party sold data** — e.g. Apify "eBay Sold Listings" (~$4 / 1,000 results, ebay.co.uk, returns sold price + sold date). Unofficial scraper, ToS-gray, no SLA, breaks on layout changes. Lets us compute a real monthly rate + spike-vs-sustained.
   - **(C) Honest proxy / defer** — ship the price band + Prime now; replace the "30 sales/month" control with a clearly-labelled **"est. total sold"** hint (from eBay `getItem`, a coarse lifetime estimate, *not* monthly) or hide it until (A)/(B) lands. **Do not ship a "30 sales/month" control backed by nothing — it would mislead operators spending real money.**
   - *Recommendation: ship FR-4a + FR-4b now (Path C interim), and in parallel apply for Marketplace Insights (A). Fall back to (B) only if (A) is denied and the boss accepts the ToS/cost trade-off.*

2. **FR-2 GTIN expectation:** GTIN/EAN/UPC is **free from Amazon (Keepa) and obtainable from eBay** (extra call), but **AliExpress and TikTok do not expose barcodes at all**. So "GTIN where available" = Amazon + eBay routes only. Confirm that's acceptable.

3. **FR-3 scan scope & quota:** A deep seller scan is far heavier than a search and shares eBay's **5,000 calls/day** app-wide budget. Recommend: cap to **top ~60 listings/scan**, cache by seller, gate behind subscription + a per-user daily scan budget, and apply for an eBay **Application Growth Check** (free, raises the limit) before promoting it. Confirm the cap is acceptable.

4. **eBay Partner authorisation** (optional, strengthens FR-2/matching): `epid` (eBay catalog product id) is only returned to authorised eBay Partners. Worth applying if we want catalog-grade matching.

---

## 2. FR-1 — Dual-platform product display ✅

**Goal:** every result shows the **source listing** (Amazon/AliExpress/TikTok) and the **matched eBay.co.uk listing** side by side — each with title, image, price, live link — clearly labelled source(cost) vs destination(sale), carrying the existing margin calc; flag **unmatched** instead of guessing.

**What already exists:** the margin pipeline is done end-to-end. `buildProduct()` ([research.js:71](../src/services/research.js#L71)) and `finalizeMock()` ([mock-sources.js:21](../src/services/mock-sources.js#L21)) are the **two chokepoints** that mint every card and already carry `ebayPrice`, `amazonPrice`(=supplier cost), `ebayUrl`, `amazonUrl`, `sourceName`, `profit`, `roi`, `estimated`.

**Gaps to close:**
- Card carries only **one** image (`p.image`) and one title (`p.name`). No separate source-vs-eBay image/title. eBay's listing image is fetched in [ebay.js mapItem:94](../src/services/ebay.js#L94) but dropped; `enrich.js` also drops it.
- Provider routes (AliExpress/TikTok) hard-set `estimated=false` ([enrich.js](../src/services/providers/enrich.js)) even though the eBay match is a fuzzy median search — so they're **never** flagged unmatched. Need an honest unmatched state.

**Steps:**
1. **Backend — add dual fields at the two chokepoints.** In `buildProduct()` and `finalizeMock()` add: `sourceTitle`, `sourceImage`, `sourcePrice`, `sourceUrl` (the supplier side) and `ebayTitle`, `ebayImage`, `ebayPrice`, `ebayUrl` (the destination). Most values already exist locally — stop collapsing them into single `name`/`image`.
2. **Carry the eBay listing image + title through.** In [enrich.js](../src/services/providers/enrich.js) keep the eBay item's `image`/`name` from the nearest-median listing; on the Amazon route ([research.js buildProduct](../src/services/research.js#L71)) keep both the eBay item image and the matched Amazon image.
3. **Honest "unmatched" flag.** Stop hard-coding `estimated=false` in `enrich.js`; set `estimated=true`/`unmatched` when the source match confidence is weak (reuse the `SEARCH.MATCH_CONFIDENCE_MIN` gate). When unmatched, **suppress the fabricated source price** rather than showing `0.72 × eBay`.
4. **Frontend — 2-column card.** Rework the `.rc-pricing` grid ([research.html:1016](../public/app/research.html)) into a **source | eBay** side-by-side layout: each side shows image (reuse `.thumb`), title, price (`window.KEMPY.formatMoney`), and a `↗` live link. Add a clear "SOURCE / cost" vs "eBay / sale" label and an `UNMATCHED` badge branch. Mirror in [watchlist.html](../public/app/watchlist.html) `renderCard()` and the [index.html](../public/index.html) demo.

**Effort:** M. **Depends on:** nothing.

---

## 3. FR-2 — Cross-platform identifiers 🟡

**Goal:** capture + display ASIN (Amazon), product ID (AliExpress, TikTok), eBay item number, and GTIN/EAN/UPC where available; ASIN/source ID copyable.

**Verified availability per identifier:**

| Identifier | Source | Status | Notes |
|----|----|----|----|
| **Amazon ASIN** | Keepa | ✅ already fetched ([amazon.js:61](../src/services/amazon.js#L61)) | Surface on card + copy button + `amazon.co.uk/dp/<asin>` link |
| **Amazon EAN/UPC/GTIN** | Keepa | ✅ **free** — `eanList`/`upcList`/`gtinList` already in the fetched product | Currently dropped in [amazon.js:55](../src/services/amazon.js#L55); just map them |
| **AliExpress product ID** | Affiliate API | ✅ captured but dropped ([aliexpress.js:91](../src/services/providers/aliexpress.js)) | Carry through; build canonical `aliexpress.com/item/<id>.html` |
| **TikTok product ID** | EchoTik | ✅ captured but dropped ([tiktok.js](../src/services/providers/tiktok.js)) | Carry through |
| **TikTok product URL** | — | 🟡 **best-effort** | EchoTik returns no URL; `shop.tiktok.com/view/product/<id>` is an *unverified* constructed pattern, region-sensitive — label "best-effort link" |
| **eBay item number** | Browse | ✅ easy — `legacyItemId` is in the response, just not mapped ([ebay.js:100](../src/services/ebay.js#L100)) | Map it; render as clickable item-number link |
| **eBay GTIN / epid** | Browse `getItem` | 🟡 extra cost | Needs 1 `getItem` call **per item** (cap to top-N); `epid` only for authorised Partners |
| **AliExpress / TikTok GTIN** | — | ❌ **does not exist** | Suppliers don't assign barcodes; impossible for these routes |

**Steps:**
1. **Keepa GTIN (free):** in [amazon.js map:55](../src/services/amazon.js#L55) add `ean: p.eanList?.[0] ?? null`, `upc: p.upcList?.[0] ?? null`, `gtin: p.gtinList?.[0] ?? null` (null-guarded). Carry through `buildProduct`.
2. **Stop dropping source IDs:** in [enrich.js](../src/services/providers/enrich.js) + `finalizeMock` copy `productId` onto the card as `sourceId` (+ `sourcePlatform`). Build the canonical AliExpress URL; set the best-effort TikTok URL (replacing `supplierUrl:null` at [tiktok.js](../src/services/providers/tiktok.js)).
3. **eBay item number:** map `legacyItemId` in [ebay.js mapItem](../src/services/ebay.js#L94); carry to card.
4. **Identifier-based match strengthening:** where both sides have a GTIN/EAN/UPC (Amazon + eBay routes), short-circuit to a confident match in [claude.js](../src/services/claude.js) / [match-local.js](../src/services/match-local.js) before title heuristics.
5. **Frontend:** add an identifiers row to the card ([research.html:1013](../public/app/research.html)) — ASIN / source ID / eBay item # as live links + copy-to-clipboard (reuse `window.KEMPY.icon`).
6. **Persistence:** extend the watchlist so IDs survive a save — add `source_platform`, `source_id`, `gtin` columns (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, [schema.sql](../src/schema.sql)) + update the INSERT in [watchlist.js:71](../src/routes/watchlist.js).
7. **(Optional, P2/P3)** eBay GTIN via a capped `getItem`/`getItems` enrichment for top matches only.

**Effort:** M. **Depends on:** FR-1 field plumbing (same chokepoints).

---

## 4. FR-4 — Quality / eligibility filters (split by feasibility)

### 4a. Price band + price-point search + adjustable settings ✅ (Effort S–M)
- **Server-side price filter:** extend the eBay Browse `filter` param ([ebay.js:80](../src/services/ebay.js#L80)) with `price:[15..60],priceCurrency:GBP`. Today it only sets `buyingOptions:{FIXED_PRICE}`.
- **Query params:** add `priceMin`/`priceMax`/`minMargin` to `/api/search` ([server.js:198](../server.js)) → thread into `searchProducts(q, source, opts)`.
- **Client filter:** add price-band + min-margin selects to the filter bar ([research.html:712](../public/app/research.html)), mirroring the existing Min-ROI client filter (`profit`/`ebayPrice` already on the card).
- **Operator settings:** persist defaults (price band £15–£60, min margin) in `users.preferences` JSONB (existing settings pattern, [settings.js]) and hydrate the filter bar on load.

### 4b. Amazon Prime-only filter ✅ (Effort M)
- Keepa already returns the buy-box Prime signal; we just don't request it. Add `buybox:1` to the Keepa params ([amazon.js:47](../src/services/amazon.js#L47)) and read `p.stats?.buyBoxIsPrimeEligible === true`.
- **Cost:** `buybox` = **+2 tokens/product** (~5× a 20-candidate search). **Gate behind an operator toggle (default OFF)** and a config flag `AMAZON_PRIME_ONLY` / `KEEPA_BUYBOX` ([config.js](../src/config.js)). Consider lowering `CANDIDATE_POOL` when on.
- **Caveats (handle explicitly):** `buyBoxIsPrimeEligible` reflects the *current buy-box winner*, not the whole product, and can be **null** ("unknown") — define the null policy (recommend: exclude when strict). **Include the buybox flag in the Keepa cache key** ([amazon.js:33](../src/services/amazon.js#L33)) so Prime-enriched and plain results aren't cross-served.
- Apply the filter server-side on the Amazon route ([research.js sort:180](../src/services/research.js)); render a "Prime" badge.

### 4c. ≥30 eBay sales/month + sustained sales history ❌ (DECISION REQUIRED — see §1.1 and §6)
- **The eBay Browse API exposes no sales-velocity, units-sold, or sales-history field** (verified against the `ItemSummary` type — no `soldQuantity`/`lastSoldDate`). `getItem`'s `estimatedSoldQuantity` is a coarse **lifetime estimate with no time dimension** — it cannot prove a *monthly* rate or distinguish sustained vs spike. The old Finding/Shopping APIs were decommissioned Feb 2025.
- **Only real options:** eBay **Marketplace Insights API** (restricted/partner-gated) or a **paid third-party sold-listings** dataset. Until one is wired, this control must be **relabelled/hidden** — not faked.

---

## 5. FR-3 — eBay seller store reverse-scan ✅ (constrained) (Effort L)

**Goal:** from a profitable eBay result, "Scan this seller's store" → fetch the seller's active listings → reverse-match each to a source (Amazon/AliExpress/TikTok) → margin calc → ranked list (most profitable first) with FR-1 display + FR-2 IDs; add to Watchlist from results.

**Verified feasible — reuses almost everything:**
- eBay Browse supports `filter=sellers:{username}`; same app token/marketplace as today, **no new OAuth scope**.
- Reverse-match infra is fully reusable: `matchAll()`+`buildProduct()` ([research.js:41](../src/services/research.js#L41)), `matchAmazonBatch` ([claude.js:156](../src/services/claude.js)), local matcher ([match-local.js](../src/services/match-local.js)), provider keyword search ([aliexpress.js]/[tiktok.js]). `finalizeMock` makes scan cards byte-identical to research cards (FR-1/FR-2 come free). Watchlist POST already accepts the card shape.

**Constraints to design around (verified):**
- **`filter=sellers:` alone returns 0** — eBay requires a `q` (empty → error 12001) **or** `category_ids=0`. Whole-store enumeration relies on the **`category_ids=0` trick, which is an undocumented workaround eBay may break.** Fallback: sweep top-level categories, or seed the scan with the operator's keyword.
- **Pagination:** limit ≤200, offset ≤10,000, **10,000-result hard cap** per query → mega-stores can't be fully crawled ("scanned top N", not "complete").
- **Rate limit: 5,000 Browse calls/day, shared app-wide** — the #1 risk. A scan = (pages) + (≥1 source lookup per listing). Must **cap listings/scan (~60), cache by seller, batch the Claude match (one call), concurrency-limit** (reuse `mapLimit` [enrich.js:24](../src/services/providers/enrich.js)), and apply for an **Application Growth Check**.
- **Reverse-match precision** on AliExpress/TikTok is keyword-fuzzy (no image/GTIN) → many listings won't confidently match → **flag unmatched (FR-1), don't fake margins.**

**Steps:**
1. `searchEbaySeller(username, {limit, offset, categoryId, q})` in [ebay.js](../src/services/ebay.js) — same `SEARCH_URL`, `filter: sellers:{username},buyingOptions:{FIXED_PRICE}`, page until cap; reuse `mapItem` unchanged.
2. New `src/services/seller-scan.js` — orchestrate per-route reverse-match (Amazon via `matchAll`/`buildProduct`; AliExpress/TikTok via `provider.fetchSupplierProducts(title)` + local score gate), build cards via `finalizeMock`, sort profit-desc, flag unmatched.
3. New route `GET /api/seller-scan?seller=&source=` ([server.js](../server.js), near `/api/search`), **behind `requireSubscription`** + per-user daily scan budget; cache under `sellerscan:<source>:<username>`; same `{products, meta}` envelope → frontend reuses the card renderer.
4. **Frontend:** carry `seller` onto the card (it's in `mapItem`, just dropped); add a "Scan this seller's store" button to `.rc-verdict` gated on `p.seller`; render results into the existing `#results` grid; reuse the Save-to-Watchlist path.

**Depends on:** FR-1 (card fields) + FR-2 (IDs) shipped first — matches the spec's phasing.

---

## 6. The sales-velocity problem (FR-4c) — detail & recommendation

| Option | Gives | Cost / access | Risk |
|----|----|----|----|
| **eBay Marketplace Insights API** | Real sold qty + sold date (~90 days), EBAY_GB → true monthly rate + sustained/spike | **Restricted Limited Release**; non-partners commonly declined; free if granted | Approval may never come; sandbox ≠ prod |
| **Apify "eBay Sold Listings"** (or similar) | Real completed sales: final price + sold date, ebay.co.uk | ~**$4 / 1,000 results**, pay-per-result | Unofficial scraper, ToS-gray, no SLA, breaks |
| **`getItem` `estimatedSoldQuantity`** | Coarse **lifetime** sold *estimate* | Free-ish (1 extra Browse call/item) | **No monthly rate, no history** — can't satisfy the requirement; only a soft "est. total sold" hint |
| **Scrape eBay "X sold" badge** | Lifetime "X sold", sometimes "N sold/24h" | Proxies + CAPTCHA handling | Highest maintenance, ToS risk |

**Recommendation:** Build FR-4a (price band) + FR-4b (Prime) now. For FR-4c, **apply for Marketplace Insights immediately** and ship the velocity control **disabled/labelled "coming soon"** until access lands; if denied and the boss accepts the trade-off, wire the Apify dataset behind the existing env-gated provider pattern (`isConfigured()` + cache + fail-open). Implement the velocity filter as an **enrichment step** so it degrades gracefully to "velocity unknown".

---

## 7. Phasing & sequencing (matches the CR's suggested phases)

- **Phase 1 — FR-1 + FR-2** (highest fulfilment value): dual-platform card + identifiers. Backend field plumbing at the two card chokepoints; Keepa GTIN (free); source IDs (already captured); eBay `legacyItemId`; watchlist columns; frontend 2-column card + copy buttons. *Effort: M–L combined.*
- **Phase 2 — FR-4a + FR-4b**: price band + price-point search + adjustable settings (easy), Prime-only via Keepa `buybox` (token-gated). **Defer FR-4c** pending the §1.1 decision. *Effort: M.*
- **Phase 3 — FR-3**: seller reverse-scan, building on Phase 1/2 matching + filtering, with the rate-limit guardrails in §5. *Effort: L.*

## 8. New env / settings / schema summary

- **config.js:** `PRICE_BAND_MIN` (15), `PRICE_BAND_MAX` (60), `MIN_MARGIN`, `AMAZON_PRIME_ONLY` (false), `KEEPA_BUYBOX` (false), `SELLER_SCAN_LIMIT` (60), `MIN_MONTHLY_SALES` (30, only active once a velocity source is wired).
- **users.preferences (JSONB):** operator-adjustable price band, min margin, min monthly sales, prime-only.
- **schema.sql (watchlist):** `source_platform TEXT`, `source_id TEXT`, `gtin TEXT` (idempotent ADD COLUMN).
- **New external (decision-gated):** `EBAY_MARKETPLACE_INSIGHTS` scope (if approved) **or** `APIFY_TOKEN` (if 3rd-party path chosen). eBay **Application Growth Check** for FR-3 quota.

## 9. Cross-cutting risks

- **Don't ship misleading metrics** (FR-4c "30 sales/month" with no real data; fabricated source prices on unmatched cards). Flag unmatched/unknown honestly — operators spend real money on this.
- **eBay 5,000 calls/day is shared** — FR-3 scans and FR-2 `getItem` GTIN lookups both draw on it; cap + cache + Growth Check.
- **Keepa tokens** — Prime (`buybox`) and any per-listing reverse-match multiply token cost; gate + cache-key-separate.
- **Constructed URLs** (AliExpress item, TikTok shop) are best-effort — some may 404; label as such.
