-- src/schema.sql
-- KEMPY database schema.
-- Idempotent: safe to run multiple times.

-- ====================================================================
-- Users
-- ====================================================================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  password_hash TEXT,                       -- nullable: OAuth-only users have no password
  email_verified_at TIMESTAMPTZ,            -- null until OTP verified
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

-- ====================================================================
-- Sessions
-- One row per active sign-in. We store SHA-256 of the token, never the
-- token itself — so a DB leak doesn't expose sessions.
-- ====================================================================
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ====================================================================
-- One-time passwords (OTP)
-- Used for signup verification and (later) password resets.
-- Code is stored as SHA-256, not plaintext.
-- ====================================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,                    -- 'signup' | 'login' | 'reset'
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,                  -- null = unused
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_codes_lookup_idx
  ON otp_codes (LOWER(email), purpose)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS otp_codes_expires_idx ON otp_codes (expires_at);

-- ====================================================================
-- Watchlist
-- One row per saved product per user.
-- ====================================================================
CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Product identifiers (both nullable — live eBay items may not have ASIN yet)
  asin TEXT,
  ebay_item_id TEXT,

  -- Display
  name TEXT NOT NULL,
  emoji TEXT,
  cat TEXT,
  image_url TEXT,

  -- Prices at time of last refresh
  ebay_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  amazon_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  roi NUMERIC(8,2) NOT NULL DEFAULT 0,

  -- Prices at time of save (so we can show drift)
  saved_ebay_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  saved_amazon_price NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Links
  ebay_url TEXT,
  amazon_url TEXT,

  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For databases created before image_url existed:
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS watchlist_user_idx ON watchlist (user_id);
CREATE INDEX IF NOT EXISTS watchlist_asin_idx ON watchlist (user_id, asin) WHERE asin IS NOT NULL;
CREATE INDEX IF NOT EXISTS watchlist_ebay_idx ON watchlist (user_id, ebay_item_id) WHERE ebay_item_id IS NOT NULL;

-- ====================================================================
-- User preferences (notification toggles, etc.) — JSON blob per user.
-- ====================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ====================================================================
-- Team members
-- Each row is a teammate belonging to an owner's workspace. The owner is
-- the users row; teammates are tracked here by email + role + status.
-- NOTE: scoped login for invited members needs the multi-tenant auth model
-- (future) — for now this persists the roster and invite state.
-- ====================================================================
CREATE TABLE IF NOT EXISTS team_members (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member',       -- 'admin' | 'member' | 'viewer'
  status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'active'
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_members_owner_email_unique UNIQUE (owner_user_id, email)
);

CREATE INDEX IF NOT EXISTS team_members_owner_idx ON team_members (owner_user_id);

-- ====================================================================
-- eBay seller OAuth connections — one row per user (single eBay store).
-- The access_token is short-lived (~2h) and disposable; the refresh_token
-- is long-lived (~18mo) and MUST be encrypted at rest (AES-256-GCM).
-- Storing user_id as PK enforces one connected store per user.
-- ====================================================================
CREATE TABLE IF NOT EXISTS ebay_connections (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ebay_user_id TEXT,                            -- eBay username, if fetched (nullable)
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
  scopes TEXT,                                  -- space-delimited granted scopes (diagnostics)
  access_token TEXT,                            -- current short-lived token (refreshable)
  access_token_expires_at TIMESTAMPTZ,          -- when access_token dies
  refresh_token_enc TEXT NOT NULL,              -- AES-256-GCM ciphertext "ivB64:tagB64:dataB64"
  refresh_token_expires_at TIMESTAMPTZ,         -- ~18 months out
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT                               -- last refresh/api failure (for status endpoint)
);

-- ====================================================================
-- eBay seller listing prefs — one-time setup per user for publishing:
-- merchant location + the 3 business-policy IDs + cached category tree.
-- ====================================================================
CREATE TABLE IF NOT EXISTS ebay_seller_prefs (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  merchant_location_key TEXT,
  country TEXT,                                 -- ISO alpha-2, e.g. 'US'
  postal_code TEXT,
  address_line1 TEXT,
  city TEXT,
  state_or_province TEXT,
  fulfillment_policy_id TEXT,
  payment_policy_id TEXT,
  return_policy_id TEXT,
  category_tree_id TEXT,
  programs_opted_in BOOLEAN NOT NULL DEFAULT FALSE,
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
  setup_completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- eBay listings created by KEMPY. One row per SKU per user (idempotent retry).
-- ====================================================================
CREATE TABLE IF NOT EXISTS ebay_listings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  offer_id TEXT,
  listing_id TEXT,
  title TEXT,
  price NUMERIC(12,2),
  quantity INT NOT NULL DEFAULT 1,
  category_id TEXT,
  condition TEXT,
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | published | failed | ended
  step TEXT,                                     -- last pipeline step reached
  error TEXT,                                     -- eBay error_description passthrough
  asin TEXT,
  source_ebay_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ebay_listings_user_sku_unique UNIQUE (user_id, sku)
);

CREATE INDEX IF NOT EXISTS ebay_listings_user_idx ON ebay_listings (user_id);
CREATE INDEX IF NOT EXISTS ebay_listings_status_idx ON ebay_listings (user_id, status);

