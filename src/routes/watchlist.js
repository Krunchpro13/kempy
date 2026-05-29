// src/routes/watchlist.js
//
// Watchlist endpoints — require auth + database.
//
//   GET    /api/watchlist          — list saved items for current user
//   POST   /api/watchlist          — save a product
//   DELETE /api/watchlist/:id      — remove an item
//   POST   /api/watchlist/refresh  — re-fetch prices for all saved items

import express from 'express';
import { query, isEnabled as dbEnabled } from '../services/db.js';
import { searchProducts } from '../services/research.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to use your watchlist.' });
  next();
}

function requireDb(req, res, next) {
  if (!dbEnabled()) return res.status(503).json({ error: 'Database not configured.' });
  next();
}

// GET /api/watchlist
router.get('/', requireDb, requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, asin, ebay_item_id, name, emoji, cat,
              ebay_price, amazon_price,
              saved_ebay_price, saved_amazon_price,
              fees, shipping, packaging, profit, roi,
              ebay_url, amazon_url, added_at
       FROM watchlist
       WHERE user_id = $1
       ORDER BY added_at DESC`,
      [req.user.user_id],
    );

    const items = result.rows.map(r => ({
      id: r.id,
      asin: r.asin,
      ebayItemId: r.ebay_item_id,
      name: r.name,
      emoji: r.emoji,
      cat: r.cat,
      ebayPrice: Number(r.ebay_price),
      amazonPrice: Number(r.amazon_price),
      savedEbayPrice: Number(r.saved_ebay_price),
      savedAmazonPrice: Number(r.saved_amazon_price),
      fees: Number(r.fees),
      shipping: Number(r.shipping),
      packaging: Number(r.packaging),
      profit: Number(r.profit),
      roi: Number(r.roi),
      ebayUrl: r.ebay_url,
      amazonUrl: r.amazon_url,
      addedAt: r.added_at,
    }));

    return res.json({ items, count: items.length });
  } catch (err) {
    console.error('[watchlist] GET error:', err.message);
    return res.status(500).json({ error: 'Failed to load watchlist.' });
  }
});

// POST /api/watchlist
router.post('/', requireDb, requireAuth, async (req, res) => {
  const { product } = req.body || {};
  if (!product || !product.name) return res.status(400).json({ error: 'Product data required.' });

  try {
    // Check for duplicate by asin or ebayItemId
    if (product.asin || product.ebayItemId) {
      const dup = await query(
        `SELECT id FROM watchlist
         WHERE user_id = $1 AND (asin = $2 OR ebay_item_id = $3)`,
        [req.user.user_id, product.asin || null, product.ebayItemId || null],
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: 'Already in your watchlist.' });
      }
    }

    const result = await query(
      `INSERT INTO watchlist
         (user_id, asin, ebay_item_id, name, emoji, cat,
          ebay_price, amazon_price, saved_ebay_price, saved_amazon_price,
          fees, shipping, packaging, profit, roi, ebay_url, amazon_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        req.user.user_id,
        product.asin || null,
        product.ebayItemId || null,
        product.name,
        product.emoji || '📦',
        product.cat || null,
        product.ebayPrice || 0,
        product.amazonPrice || 0,
        product.ebayPrice || 0,      // saved price = current price at time of save
        product.amazonPrice || 0,
        product.fees || 0,
        product.shipping || 0,
        product.packaging || 0,
        product.profit || 0,
        product.roi || 0,
        product.ebayUrl || null,
        product.amazonUrl || null,
      ],
    );

    return res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[watchlist] POST error:', err.message);
    return res.status(500).json({ error: 'Failed to save product.' });
  }
});

// DELETE /api/watchlist/:id
router.delete('/:id', requireDb, requireAuth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM watchlist WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.user_id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[watchlist] DELETE error:', err.message);
    return res.status(500).json({ error: 'Failed to remove item.' });
  }
});

// POST /api/watchlist/refresh
router.post('/refresh', requireDb, requireAuth, async (req, res) => {
  try {
    const items = await query(
      'SELECT id, name, asin FROM watchlist WHERE user_id = $1',
      [req.user.user_id],
    );

    let updated = 0;
    for (const item of items.rows) {
      try {
        const q = (item.name || '').split(' ').slice(0, 3).join(' ');
        const { products } = await searchProducts(q);
        const match = products.find(p => p.asin && p.asin === item.asin) || products[0];
        if (!match) continue;

        await query(
          `UPDATE watchlist SET
             ebay_price = $1, amazon_price = $2,
             fees = $3, shipping = $4, packaging = $5,
             profit = $6, roi = $7, updated_at = now()
           WHERE id = $8 AND user_id = $9`,
          [
            match.ebayPrice, match.amazonPrice,
            match.fees, match.shipping, match.packaging,
            match.profit, match.roi,
            item.id, req.user.user_id,
          ],
        );
        updated++;
      } catch (_) { /* skip failed items */ }
    }

    return res.json({ ok: true, updated, total: items.rows.length });
  } catch (err) {
    console.error('[watchlist] refresh error:', err.message);
    return res.status(500).json({ error: 'Refresh failed.' });
  }
});

export default router;
