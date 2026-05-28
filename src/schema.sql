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
