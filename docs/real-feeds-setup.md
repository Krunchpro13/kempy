# Real AliExpress & TikTok feeds — setup

The **AliExpress → eBay.co.uk** and **TikTok UK → eBay.co.uk** research modes can run
on **live data** instead of the built-in sample feed. The code is already deployed;
each mode flips from mock to live the moment its API keys are present in Railway
(no redeploy needed beyond the env change). Until then it silently uses the sample
feed, so nothing breaks.

How a live card is built: the provider returns **supplier-side** products (cost,
title, image, sales volume); KEMPY then looks up what each one **sells for on
eBay.co.uk** via the existing eBay Browse search, and computes fees/profit/ROI.
So both modes also depend on the existing `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`.

---

## AliExpress (Dropshipping / DS API — via OAuth)

Verified live 2026-06-11. The account is registered for the **DS (Dropshipping)
API**, not the Affiliate API. The DS API has **no keyword product search**, so
KEMPY pulls AliExpress's best-seller **feeds** as a live catalog and
keyword-filters them client-side (empty search box = trending). The DS API also
requires **OAuth** (a one-time owner authorization), not just a key.

**1. Railway → Variables:**

   | Variable | Value |
   |---|---|
   | `ALIEXPRESS_APP_KEY` | your app key **(required)** |
   | `ALIEXPRESS_APP_SECRET` | your app secret **(required)** *(secret — never commit)* |
   | `ALIEXPRESS_FEEDS` | *(optional)* comma-separated DS feed names (default: `AEB_Droplo_BestsellersItems_20241016,AEB_CETagItems_20241017`) |
   | `ALIEXPRESS_REDIRECT_URI` | *(optional)* defaults to `${APP_URL}/api/aliexpress/callback` |
   | `ADMIN_EMAIL` | *(optional)* restrict who can connect AliExpress to this email |

   `ENCRYPTION_KEY` (already set for eBay) encrypts the refresh token at rest.

**2. Register the callback URL** on the AliExpress app:
   `https://kempzonline.com/api/aliexpress/callback`

**3. Connect (one-time, owner):** while logged into kempzonline.com, go to
   **Settings → Connected stores → AliExpress → Connect** (or visit
   `/api/aliexpress/connect`). Consent on AliExpress → redirected back. The
   shared app-level token is stored (single `aliexpress_oauth` row) and
   auto-refreshes.

Prices come back already in **GBP**. Methods used: `aliexpress.ds.feedname.get`
(discover feed names) + `aliexpress.ds.recommend.feed.get` (feed products; array
nested under `products.traffic_product_d_t_o`).

**Known limitation:** keyword search filters the trending/best-seller feed
catalog (~100 products/query), not the whole AliExpress catalog — a long-tail
keyword that isn't currently trending may fall back to the trending set. Full
free-text catalog search would need the Affiliate API (different app
registration) or a paid third-party search service.

## TikTok (EchoTik — paid third-party; no official TikTok trending API exists)

Verified live 2026-06-07 against the real API — field mapping is done.

1. Sign up at **https://echotik.live** and choose a plan that includes **API access**
   (they offer ~100 free test calls). API docs: https://opendoc.echotik.live.
2. Copy your **API key**.
3. Set in **Railway → Variables**:

   | Variable | Value |
   |---|---|
   | `TIKTOK_API_KEY` | your EchoTik API key *(secret)* — sent as HTTP Basic-auth username |
   | `TIKTOK_REGION` | `GB` (default) — prices come back in the region currency (GB → GBP) |
   | `TIKTOK_PRICE_GBP_RATE` | `1` default (GB returns GBP already). Set only if you use a non-GBP region and want conversion. |
   | `TIKTOK_API_URL` | *(optional)* override the product-list endpoint |

Implementation notes: uses EchoTik `/api/v2/product/list` with `is_hot=1` for the
trending list (or `keyword=` when the user searches). `page_size` caps at 10, so
it pages up to 3× and ranks client-side by `total_sale_cnt`. `cover_url` is a
JSON-array-encoded string — parsed for the first image.

---

## Verifying it went live

- `GET /api/search?source=aliexpress&q=led` → the JSON includes `"live": true` and
  `"source": "aliexpress"` once keys are set (it's `false` while on mock).
- Same for `?source=tiktok`.
- Server logs print `"[research] <source> provider failed, using mock"` if a live
  call errored — check there if a mode unexpectedly stays on sample data.
