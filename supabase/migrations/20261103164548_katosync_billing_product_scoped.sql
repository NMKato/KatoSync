-- NMKato Solutions / Stage 4F. LOCAL MIGRATION ONLY; do NOT deploy before webhook gates.
-- This table is separate from public.katoos_subscription and all Picnic/TableRocket products.
-- Stripe event retrieval and signature checks happen exclusively on the server.
CREATE TABLE IF NOT EXISTS katosync.billing_subscriptions (
  stripe_subscription_id text PRIMARY KEY CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL DEFAULT 'acct_1T8FaBRlRREUhJSr'
    CHECK (stripe_account_id = 'acct_1T8FaBRlRREUhJSr'),
  stripe_customer_id text NOT NULL CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  product_key text NOT NULL DEFAULT 'katosync' CHECK (product_key = 'katosync'),
  stripe_product_id text NOT NULL CHECK (stripe_product_id = 'prod_VYsQNVBDeJ3TaO'),
  stripe_price_id text NOT NULL CHECK (stripe_price_id = 'price_1UXkfiRlRREUhJSrNo3taV4L'),
  status text NOT NULL CHECK (status IN
    ('trialing','active','incomplete','incomplete_expired','past_due','unpaid','canceled','paused')),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  entitlement_expires_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  last_stripe_event_created_at timestamptz,
  last_stripe_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT katosync_billing_trial_valid CHECK (
    trial_ends_at IS NULL OR trial_ends_at > '2020-01-01T00:00:00Z'::timestamptz
  ),
  CONSTRAINT katosync_billing_period_valid CHECK (
    current_period_ends_at IS NULL OR current_period_ends_at > '2020-01-01T00:00:00Z'::timestamptz
  )
);
CREATE INDEX IF NOT EXISTS katosync_billing_subscriptions_owner_idx
  ON katosync.billing_subscriptions(owner_user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS katosync_billing_subscriptions_customer_idx
  ON katosync.billing_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS katosync.billing_webhook_events (
  stripe_event_id text PRIMARY KEY CHECK (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  stripe_account_id text NOT NULL CHECK (stripe_account_id = 'acct_1T8FaBRlRREUhJSr'),
  stripe_subscription_id text NOT NULL CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
  event_created_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('ignored','granted','revoked','no_change'))
);
CREATE INDEX IF NOT EXISTS katosync_billing_events_subscription_idx
  ON katosync.billing_webhook_events(stripe_subscription_id,event_created_at DESC);

ALTER TABLE katosync.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE katosync.billing_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON katosync.billing_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON katosync.billing_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON katosync.billing_subscriptions TO authenticated;
CREATE POLICY katosync_billing_owner_read ON katosync.billing_subscriptions
  FOR SELECT TO authenticated USING (owner_user_id=(SELECT auth.uid()));
GRANT SELECT,INSERT,UPDATE ON katosync.billing_subscriptions TO service_role;
GRANT SELECT,INSERT ON katosync.billing_webhook_events TO service_role;
-- Critical: no customer-accessible INSERT/UPDATE/DELETE, no service_role credentials in apps.
-- Webhook must verify Stripe-Signature, fetch the current subscription from Stripe, check
-- exact KatoSync price/product/account, and apply an idempotent transaction to ONLY
-- katosync.billing_* and katosync.mesh_owner_policy. No public.katoos_* DML.
