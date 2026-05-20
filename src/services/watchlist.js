// =============================================================================
// Watchlist service (user-scoped)
// =============================================================================
// Every operation takes userId. The unique constraint is (user_id, asin) so
// two different users can both save the same product without conflict.
// =============================================================================

import { query } from './db.js';
import { findAmazonCandidates } from './amazon.js';
import { calculateProfit } from './profit.js';

export async function addToWatchlist(userId, product) {
  const sql = `
    INSERT INTO watchlist (
      user_id,
      ebay_title, ebay_url, asin, amazon_url,
      initial_ebay_price, initial_amazon_price, initial_profit, initial_roi,
      latest_ebay_price, latest_amazon_price, latest_profit, latest_roi,
      last_refreshed_at,
      category, match_source, match_confidence, verdict_label, notes
    )
    VALUES (
      $1,
      $2, $3, $4, $5,
      $6, $7, $8, $9,
      $6, $7, $8, $9,
      NOW(),
      $10, $11, $12, $13, $14
    )
    ON CONFLICT (user_id, asin) WHERE asin IS NOT NULL DO NOTHING
    RETURNING *
  `;
  const params = [
    userId,
    product.name,
    product.ebayUrl || null,
    product.asin || null,
    product.amazonUrl || null,
    product.ebayPrice,
    product.amazonPrice || null,
    product.profit || null,
    product.roi || null,
    product.cat || null,
    product.matchSource || null,
    product.matchConfidence || null,
    product.verdictLabel || null,
    product.notes || null,
  ];
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

export async function listWatchlist(userId) {
  const { rows } = await query(
    `SELECT * FROM watchlist WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function removeFromWatchlist(userId, id) {
  const { rowCount } = await query(
    `DELETE FROM watchlist WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rowCount > 0;
}

export async function refreshAllWatchlistPrices(userId) {
  if (!process.env.KEEPA_API_KEY) {
    throw new Error('Refresh requires KEEPA_API_KEY');
  }

  const items = await listWatchlist(userId);
  let refreshed = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item.asin) { skipped += 1; continue; }

    try {
      const candidates = await findAmazonCandidates(item.ebay_title, 5);
      if (!candidates || candidates.length === 0) { skipped += 1; continue; }

      const match = candidates.find((c) => c.asin === item.asin) || candidates[0];
      const newAmazon = match.amazonPrice;
      if (!newAmazon) { skipped += 1; continue; }

      const ebayPrice = Number(item.initial_ebay_price);
      const profit = calculateProfit({
        ebayPrice,
        amazonPrice: newAmazon,
        shipping: 8,
        packaging: 3,
      });

      await query(
        `UPDATE watchlist
         SET latest_amazon_price = $1,
             latest_ebay_price = $2,
             latest_profit = $3,
             latest_roi = $4,
             last_refreshed_at = NOW()
         WHERE id = $5 AND user_id = $6`,
        [newAmazon, ebayPrice, profit.profit, profit.roi, item.id, userId]
      );
      refreshed += 1;
    } catch (err) {
      console.error(`[watchlist] refresh failed for #${item.id}:`, err.message);
      skipped += 1;
    }
  }

  return { refreshed, skipped, total: items.length };
}
