---
name: kempy-operational-gotchas
description: KEMPY webapp — non-obvious operational facts (Resend sandbox, Keepa tokens, missing keys, next levers)
metadata:
  type: project
---

Operational facts about the KEMPY app (d:\Fred\Kempy) that are NOT obvious from the code:

- **Resend is in SANDBOX mode.** `RESEND_FROM=onboarding@resend.dev` only delivers OTP/welcome
  emails to the **Resend account owner's own verified email**. Signing up with any other address
  silently drops the email. To send to real users, the owner must verify a domain in Resend and
  change `RESEND_FROM`. This is the #1 cause of "OTP never arrived".

- **No Redis (`REDIS_URL` unset) → no caching.** Every `/api/search` therefore hits Keepa live.
  Each search costs ~10 Keepa tokens; balance was ~1190, refill 20/min. Heavy testing burns the
  budget. Setting `REDIS_URL` would cache search/keepa/claude results and cut cost 60-90%.

- **No `ANTHROPIC_API_KEY` → matcher uses the local heuristic** (`src/services/match-local.js`),
  not Claude. The local matcher is conservative: confident matches show real Amazon prices,
  unsure ones fall back to a flagged `estimated` ROI (×0.72). Adding the Anthropic key is the
  main lever to raise match rate/quality (esp. for commodity items like cables that currently
  fall to estimate). Wiring already exists in `research.js` (`matchOne`).

- As of 2026-05-29: eBay, Keepa, Postgres (Neon), Resend keys are all live and working. The
  search pipeline produces REAL Amazon prices/ROI after the fix described in
  [[kempy-amazon-pipeline-fixed]]. Auth (signup→OTP→verify→login→session) and DB-backed
  watchlist were verified working end-to-end.

- `.env` is gitignored (not tracked) — credentials safe from GitHub, but they were exposed in a
  Claude Code transcript on 2026-05-29, so rotating them is advisable if that transcript leaves
  the owner's control.
