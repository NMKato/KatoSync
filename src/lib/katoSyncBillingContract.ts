// NMKato Solutions — KatoSync-only SaaS billing contract.
// Server-side only: before calling Stripe, authenticate the shared KATOOS user.
// Neither a browser nor the Tauri app may choose product/price/account IDs.
export const KATOSYNC_STRIPE_ACCOUNT_ID = "acct_1T8FaBRlRREUhJSr";
export const KATOSYNC_STRIPE_PRODUCT_ID = "prod_VYsQNVBDeJ3TaO";
export const KATOSYNC_STRIPE_PRICE_ID = "price_1UXkfiRlRREUhJSrNo3taV4L";
export const KATOSYNC_PRODUCT_KEY = "katosync";
export const KATOSYNC_PRICE_EUR_CENTS = 990;
export const KATOSYNC_TRIAL_DAYS = 14;
export const KATOSYNC_PRO_MESH_AGENTS = 10;
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface KatoSyncCheckoutInput {
  verifiedUserId: string;
  serverVerifiedIdentity: boolean;
  serverVerifiedTrialUnused: boolean;
  salesApproved: boolean;
  existingStripeCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}
function assertTrustedRedirect(url: string): void {
  const result = new URL(url);
  const host=result.hostname.toLowerCase();
  const permitted=host==="katoos.de"||host.endsWith(".katoos.de");
  if (result.protocol !== "https:" || result.username || result.password ||
      !permitted || result.port) {
    throw new Error("KATOSYNC_UNTRUSTED_REDIRECT");
  }
}
/** A configuration draft for a PRIVATE Stripe Checkout endpoint. This does not call Stripe. */
export function buildKatoSyncCheckoutDraft(input: KatoSyncCheckoutInput) {
  if (!input.salesApproved || !input.serverVerifiedIdentity || !USER_UUID.test(input.verifiedUserId)) {
    throw new Error("KATOSYNC_CHECKOUT_NOT_AUTHORIZED");
  }
  assertTrustedRedirect(input.successUrl);
  assertTrustedRedirect(input.cancelUrl);
  if (input.existingStripeCustomerId && !/^cus_[A-Za-z0-9]+$/.test(input.existingStripeCustomerId)) {
    throw new Error("KATOSYNC_INVALID_CUSTOMER");
  }
  const metadata = { product_key: KATOSYNC_PRODUCT_KEY, owner_user_id: input.verifiedUserId };
  return {
    mode: "subscription" as const,
    // Card is required before the free trial starts. Post-trial charge is automatic unless cancelled.
    payment_method_collection: "always" as const,
    billing_address_collection: "required" as const,
    client_reference_id: input.verifiedUserId,
    ...(input.existingStripeCustomerId ? {customer: input.existingStripeCustomerId} : {}),
    line_items: [{ price: KATOSYNC_STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: {
      metadata,
      ...(input.serverVerifiedTrialUnused ? {
        trial_period_days: KATOSYNC_TRIAL_DAYS,
        // Fail safely should the payment method become unavailable at trial end.
        trial_settings: {end_behavior: {missing_payment_method: "cancel" as const}}
      } : {})
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl
  };
}

export interface StripeSubscriptionEvidence {
  id: string;
  customer: string | {id: string} | null;
  status: string;
  metadata?: Record<string,string>;
  items?: {data?: Array<{price?: {id?:string;product?:string|{id:string}}; current_period_end?:number|null}>};
  trial_end?: number|null;
  current_period_end?: number|null;
  cancel_at_period_end?: boolean;
}
export type KatoSyncBillingDecision =
  | {kind:"ignored"; reason:"wrong_product"|"unverified"|"invalid"}
  | {kind:"denied"; ownerUserId:string; subscriptionId:string; reason:"inactive"|"expired"}
  | {kind:"granted"; ownerUserId:string; subscriptionId:string; allowedDevices:10; phase:"trial"|"paid"; validUntilMs:number; cancellationScheduled:boolean};

/** Only signed Stripe events + fresh Stripe API lookup can authorize billing.
 * Cross-product events MUST never modify a KatoSync policy or another product's tables. */
export function decideKatoSyncBillingEntitlement(input:{
  expectedStripeAccountId:string;
  signatureVerified:boolean;
  subscriptionFreshlyRetrieved:boolean;
  subscription:StripeSubscriptionEvidence;
  nowMs:number;
}):KatoSyncBillingDecision {
  const {expectedStripeAccountId, signatureVerified, subscriptionFreshlyRetrieved, subscription:s, nowMs}=input;
  if (expectedStripeAccountId!==KATOSYNC_STRIPE_ACCOUNT_ID ||
      !signatureVerified || !subscriptionFreshlyRetrieved) {
    return {kind:"ignored",reason:"unverified"};
  }
  if(!Number.isFinite(nowMs)||!s||typeof s.id!=="string"||
     !/^sub_[A-Za-z0-9]+$/.test(s.id))return {kind:"ignored",reason:"invalid"};
  const lines=s.items?.data;
  if (lines?.length!==1) return {kind:"ignored",reason:"wrong_product"};
  const price=lines[0]?.price;
  const product=typeof price?.product==="string"?price.product:price?.product?.id;
  if (price?.id!==KATOSYNC_STRIPE_PRICE_ID || product!==KATOSYNC_STRIPE_PRODUCT_ID ||
      s.metadata?.product_key!==KATOSYNC_PRODUCT_KEY) {
    return {kind:"ignored",reason:"wrong_product"};
  }
  const owner=s.metadata?.owner_user_id;
  if(!owner||!USER_UUID.test(owner)||(!s.customer))return {kind:"ignored",reason:"invalid"};
  if (s.status!=="trialing" && s.status!=="active") {
    return {kind:"denied",ownerUserId:owner,subscriptionId:s.id,reason:"inactive"};
  }
  const periodEnd=s.status==="trialing"?s.trial_end:
    (s.current_period_end ?? lines[0]?.current_period_end ?? null);
  if(typeof periodEnd!=="number"||!Number.isSafeInteger(periodEnd)||periodEnd*1000<=nowMs) {
    return {kind:"denied",ownerUserId:owner,subscriptionId:s.id,reason:"expired"};
  }
  return {
    kind:"granted",ownerUserId:owner,subscriptionId:s.id,
    allowedDevices:KATOSYNC_PRO_MESH_AGENTS,
    phase:s.status==="trialing"?"trial":"paid",
    validUntilMs:periodEnd*1000,
    // Cancellation during trial does NOT revoke Mesh until the scheduled end.
    cancellationScheduled:s.cancel_at_period_end===true
  };
}
