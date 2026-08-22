PRAGMA foreign_keys = ON;

CREATE TABLE managed_service_subscription (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
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
  last_event_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO managed_service_subscription (singleton, status, updated_at)
VALUES (1, 'none', datetime('now'));

CREATE TABLE stripe_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX stripe_webhook_events_processed_idx
ON stripe_webhook_events(processed_at DESC);
