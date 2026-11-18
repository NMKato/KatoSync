import {test} from "node:test";
import assert from "node:assert/strict";
import {
 buildKatoSyncCheckoutDraft,decideKatoSyncBillingEntitlement,KATOSYNC_STRIPE_ACCOUNT_ID,
 KATOSYNC_STRIPE_PRICE_ID,KATOSYNC_STRIPE_PRODUCT_ID,KATOSYNC_PRICE_EUR_CENTS
} from "../src/lib/katoSyncBillingContract.ts";
const owner="11111111-1111-4111-8111-111111111111";
const now=Date.parse("2026-11-03T18:00:00Z");
const trialEnd=Math.floor((now+14*86400_000)/1000);
const props={expectedStripeAccountId:KATOSYNC_STRIPE_ACCOUNT_ID,signatureVerified:true,subscriptionFreshlyRetrieved:true,nowMs:now};
const subscription=(override:Record<string,unknown>={})=>({
 id:"sub_TEST1234",customer:"cus_TEST1234",status:"trialing",trial_end:trialEnd,
 cancel_at_period_end:false,
 metadata:{product_key:"katosync",owner_user_id:owner},
 items:{data:[{price:{id:KATOSYNC_STRIPE_PRICE_ID,product:KATOSYNC_STRIPE_PRODUCT_ID}}]},
 ...override
});

test("KatoSync card-required 14-day trial has only one exact Stripe Price",()=>{
 const config=buildKatoSyncCheckoutDraft({
  verifiedUserId:owner,serverVerifiedIdentity:true,serverVerifiedTrialUnused:true,salesApproved:true,
  successUrl:"https://katoos.de/katosync/billing/success",
  cancelUrl:"https://katoos.de/katosync/billing/cancel"
 });
 assert.equal(config.mode,"subscription");
 assert.equal(config.payment_method_collection,"always");
 assert.deepEqual(config.line_items,[{price:KATOSYNC_STRIPE_PRICE_ID,quantity:1}]);
 assert.equal(config.subscription_data.trial_period_days,14);
 assert.equal(config.subscription_data.trial_settings.end_behavior.missing_payment_method,"cancel");
 assert.deepEqual(config.subscription_data.metadata,{product_key:"katosync",owner_user_id:owner});
 assert.equal(KATOSYNC_PRICE_EUR_CENTS,990);
 assert.equal(JSON.stringify(config).includes("TableRocket"),false);
});

test("trial cannot be repeated, prelaunch is blocked",()=>{
 const base={verifiedUserId:owner,serverVerifiedIdentity:true,salesApproved:true,
  successUrl:"https://katoos.de/return",cancelUrl:"https://katoos.de/cancel"};
 const config=buildKatoSyncCheckoutDraft({...base,serverVerifiedTrialUnused:false});
 assert.equal("trial_period_days" in config.subscription_data,false);
 assert.throws(()=>buildKatoSyncCheckoutDraft({...base,serverVerifiedTrialUnused:true,salesApproved:false}));
 assert.throws(()=>buildKatoSyncCheckoutDraft({...base,serverVerifiedTrialUnused:true,serverVerifiedIdentity:false}));
 assert.throws(()=>buildKatoSyncCheckoutDraft({...base,serverVerifiedTrialUnused:true,successUrl:"http://untrusted.example"}));
 assert.throws(()=>buildKatoSyncCheckoutDraft({...base,serverVerifiedTrialUnused:true,successUrl:"https://evil.example/redirect"}));

});

test("new signed trial with verified KatoSync subscription grants 10 Mesh devices",()=>{
 const result=decideKatoSyncBillingEntitlement({...props,subscription:subscription()});
 assert.deepEqual(result,{kind:"granted",ownerUserId:owner,subscriptionId:"sub_TEST1234",
  allowedDevices:10,phase:"trial",validUntilMs:trialEnd*1000,cancellationScheduled:false});
});

test("trial cancellation retains access through trial end; no first payment",()=>{
 const result=decideKatoSyncBillingEntitlement({...props,subscription:subscription({cancel_at_period_end:true})});
 assert.equal(result.kind,"granted");
 if(result.kind==="granted")assert.equal(result.cancellationScheduled,true);
 assert.equal(decideKatoSyncBillingEntitlement({...props,nowMs:trialEnd*1000,subscription:subscription({cancel_at_period_end:true})}).kind,"denied");
});

test("paid active subscription remains until paid period ends, even if canceled",()=>{
 const current=Math.floor((now+30*86400_000)/1000);
 const paid=subscription({status:"active",trial_end:null,current_period_end:current,cancel_at_period_end:true});
 const result=decideKatoSyncBillingEntitlement({...props,subscription:paid});
 assert.equal(result.kind,"granted");
 if(result.kind==="granted"){assert.equal(result.phase,"paid");assert.equal(result.validUntilMs,current*1000);}
});

test("no Mesh grant for KatoOS, Picnic, TableRocket, unknown price, multiple items or forged event",()=>{
 const cases=[
  subscription({metadata:{product_key:"katoos",owner_user_id:owner}}),
  subscription({metadata:{product_key:"picnic",owner_user_id:owner}}),
  subscription({metadata:{product_key:"tablerocket",owner_user_id:owner}}),
  subscription({items:{data:[{price:{id:"price_OTHER",product:"prod_OTHER"}}]}}),
  subscription({items:{data:[{price:{id:KATOSYNC_STRIPE_PRICE_ID,product:KATOSYNC_STRIPE_PRODUCT_ID}},{price:{id:"price_OTHER",product:"prod_OTHER"}}]}}),
 ];
 for(const s of cases)assert.equal(decideKatoSyncBillingEntitlement({...props,subscription:s}).kind,"ignored");
 assert.equal(decideKatoSyncBillingEntitlement({...props,signatureVerified:false,subscription:subscription()}).kind,"ignored");
 assert.equal(decideKatoSyncBillingEntitlement({...props,subscriptionFreshlyRetrieved:false,subscription:subscription()}).kind,"ignored");
 assert.equal(decideKatoSyncBillingEntitlement({...props,expectedStripeAccountId:"acct_WRONG",subscription:subscription()}).kind,"ignored");
});

test("failed payments, cancelled, expired subscriptions and missing ownership never grant Mesh",()=>{
 for(const status of ["past_due","unpaid","canceled","incomplete","paused","incomplete_expired"]){
  assert.equal(decideKatoSyncBillingEntitlement({...props,subscription:subscription({status})}).kind,"denied");
 }
 assert.equal(decideKatoSyncBillingEntitlement({...props,subscription:subscription({trial_end:Math.floor(now/1000)})}).kind,"denied");
 assert.equal(decideKatoSyncBillingEntitlement({...props,subscription:subscription({metadata:{product_key:"katosync"}})}).kind,"ignored");
});
