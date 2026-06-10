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

## AliExpress (official Open Platform — free)

1. Go to **https://open.aliexpress.com** → register as a developer.
2. Join the **AliExpress Affiliate** program (Portals) to get a **tracking ID**.
3. Create an app → you get an **App Key** and **App Secret**. Approval is usually
   1–2 days.
4. Set in **Railway → Variables**:

   | Variable | Value |
   |---|---|
   | `ALIEXPRESS_APP_KEY` | your app key **(required)** |
   | `ALIEXPRESS_APP_SECRET` | your app secret **(required)** *(secret — never commit)* |
   | `ALIEXPRESS_TRACKING_ID` | *(optional)* affiliate tracking id — only needed to **earn commission** on links; product search works without it |
   | `ALIEXPRESS_SESSION` | *(optional)* access token, only if your app requires one |

The feed goes live on just the **App Key + App Secret** — the tracking ID is
optional. Without it there is no affiliate `promotion_link`, so cards link to
the plain AliExpress product page instead (no commission attribution). Add the
tracking ID later (from the Affiliate/Portals dashboard) once you want commission.

Prices come back already in **GBP** (`target_currency=GBP`, `ship_to_country=UK`).
Methods used: `aliexpress.affiliate.product.query` (keyword search) and
`aliexpress.affiliate.hotproduct.query` (trending, empty search box).

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
