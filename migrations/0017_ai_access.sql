PRAGMA foreign_keys = OFF;

ALTER TABLE managed_service_subscription RENAME TO managed_service_subscription_legacy;

CREATE TABLE ai_subscription (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  plan_id TEXT NOT NULL DEFAULT 'starter' CHECK (plan_id IN ('starter', 'pro')),
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN (
    'none',
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused'
  )),
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  current_period_end TEXT,
  monthly_credit_allowance INTEGER NOT NULL DEFAULT 0 CHECK (monthly_credit_allowance >= 0),
  last_event_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO ai_subscription (
  singleton,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_product_id,
  stripe_price_id,
  plan_id,
  status,
  cancel_at_period_end,
  current_period_end,
  monthly_credit_allowance,
  last_event_created,
  updated_at
)
SELECT
  singleton,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_product_id,
  stripe_price_id,
  'starter',
  status,
  cancel_at_period_end,
  current_period_end,
  0,
  last_event_created,
  updated_at
FROM managed_service_subscription_legacy;

DROP TABLE managed_service_subscription_legacy;

CREATE TABLE ai_credit_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount != 0),
  reason TEXT NOT NULL CHECK (reason IN (
    'subscription_grant',
    'top_up',
    'ai_usage',
    'refund',
    'adjustment'
  )),
  reference_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX ai_credit_ledger_created_idx
ON ai_credit_ledger(created_at DESC);

CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN ('summarize', 'draft_reply', 'extract_tasks')),
  model TEXT NOT NULL CHECK (model IN ('fast', 'quality')),
  input_units INTEGER NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units INTEGER NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX ai_usage_events_created_idx
ON ai_usage_events(created_at DESC);

PRAGMA foreign_keys = ON;
