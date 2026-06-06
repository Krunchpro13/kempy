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
   | `ALIEXPRESS_APP_KEY` | your app key |
   | `ALIEXPRESS_APP_SECRET` | your app secret *(secret — never commit)* |
   | `ALIEXPRESS_TRACKING_ID` | your affiliate tracking id |
   | `ALIEXPRESS_SESSION` | *(optional)* access token, only if your app requires one |

Prices come back already in **GBP** (`target_currency=GBP`, `ship_to_country=UK`).
Methods used: `aliexpress.affiliate.product.query` (keyword search) and
`aliexpress.affiliate.hotproduct.query` (trending, empty search box).

## TikTok (EchoTik — paid third-party; no official TikTok trending API exists)

1. Sign up at **https://echotik.live** and choose a plan that includes **API access**
   (they offer ~100 free test calls). API docs: https://opendoc.echotik.live.
2. Copy your **API token**.
3. Set in **Railway → Variables**:

   | Variable | Value |
   |---|---|
   | `TIKTOK_API_KEY` | your EchoTik API token *(secret)* |
   | `TIKTOK_REGION` | `GB` (default) |
   | `TIKTOK_PRICE_GBP_RATE` | `0.79` default — EchoTik prices are USD; this converts to GBP. Set `1` if your plan returns GBP. |
   | `TIKTOK_API_URL` | *(optional)* override the product-list endpoint |

> **One-time check for TikTok:** EchoTik's exact response field names can vary by
> plan. After you add the key, run a search in the TikTok mode and eyeball one card.
> If titles/prices look wrong, the field mapping in
> `src/services/providers/tiktok.js` (`normalize()` / `pick()` calls) needs a small
> tweak against a real sample response — send me one and it's a 2-minute fix.

---

## Verifying it went live

- `GET /api/search?source=aliexpress&q=led` → the JSON includes `"live": true` and
  `"source": "aliexpress"` once keys are set (it's `false` while on mock).
- Same for `?source=tiktok`.
- Server logs print `"[research] <source> provider failed, using mock"` if a live
  call errored — check there if a mode unexpectedly stays on sample data.
