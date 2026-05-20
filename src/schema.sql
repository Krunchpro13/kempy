-- =============================================================================
-- KEMPY schema v1
-- =============================================================================
-- Single-user-per-instance for now (no auth scaffolding). Add a users table
-- and a user_id column on watchlist when auth lands.
-- =============================================================================

CREATE TABLE IF NOT EXISTS watchlist (
  id              SERIAL PRIMARY KEY,
  -- Identity / matching
  ebay_title      TEXT        NOT NULL,
  ebay_url        TEXT,
  asin            TEXT,
  amazon_url      TEXT,

  -- Prices captured at save time (so we can detect drift later)
  initial_ebay_price     NUMERIC(10,2) NOT NULL,
  initial_amazon_price   NUMERIC(10,2),
  initial_profit         NUMERIC(10,2),
  initial_roi            NUMERIC(6,2),

  -- Latest refresh
  latest_ebay_price      NUMERIC(10,2),
  latest_amazon_price    NUMERIC(10,2),
  latest_profit          NUMERIC(10,2),
  latest_roi             NUMERIC(6,2),
  last_refreshed_at      TIMESTAMPTZ,

  -- Metadata at time of save
  category               TEXT,
  match_source           TEXT,
  match_confidence       NUMERIC(4,3),
  verdict_label          TEXT,
  notes                  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate ASIN entries (same product saved twice)
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_asin_unique
  ON watchlist (asin) WHERE asin IS NOT NULL;

-- For listing ordering
CREATE INDEX IF NOT EXISTS watchlist_created_idx
  ON watchlist (created_at DESC);

-- Auto-update updated_at on every update
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS watchlist_updated_at ON watchlist;
CREATE TRIGGER watchlist_updated_at
  BEFORE UPDATE ON watchlist
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
