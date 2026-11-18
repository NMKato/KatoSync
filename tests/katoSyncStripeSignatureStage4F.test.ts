import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyKatoSyncStripeWebhook} from "../src/lib/katoSyncStripeSignature.ts";
const encoder=new TextEncoder();
const secret="whsec_local_qa_only_no_real_secret";
const now=1793710000;
async function signed(raw:Uint8Array,ts=now){
 const head=encoder.encode(ts+".");
 const combined=new Uint8Array(head.length+raw.length);
 combined.set(head);combined.set(raw,head.length);
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,combined));
 return "t="+ts+",v1="+Array.from(signature).map(x=>x.toString(16).padStart(2,"0")).join("");
}
test("valid Stripe signature over the exact webhook raw body succeeds",async()=>{
 const raw=encoder.encode('{"id":"evt_TEST1234","type":"customer.subscription.updated"}');
 assert.equal(await verifyKatoSyncStripeWebhook({
  rawBody:raw,signatureHeader:await signed(raw),signingSecret:secret,nowSeconds:now
 }),true);
});
test("changed body, wrong secret, expired timestamp or malformed header are rejected",async()=>{
 const body=encoder.encode('{"hello":"stripe"}');
 const header=await signed(body);
 const verify=(patch:Record<string,unknown>={})=>verifyKatoSyncStripeWebhook({
  rawBody:body,signatureHeader:header,signingSecret:secret,nowSeconds:now,...patch});
 assert.equal(await verify({rawBody:encoder.encode('{"hello":"hacker"}')}),false);
 assert.equal(await verify({signingSecret:"whsec_wrong"}),false);
 assert.equal(await verify({nowSeconds:now+301}),false);
 assert.equal(await verify({signatureHeader:"t="+now+",v1=INVALID"}),false);
 assert.equal(await verify({signatureHeader:null}),false);
 assert.equal(await verify({signatureHeader:header+",t="+now}),false);
});
test("a future-dated event cannot bypass the replay window",async()=>{
 const body=encoder.encode("{}");
 const header=await signed(body,now+500);
 assert.equal(await verifyKatoSyncStripeWebhook({
  rawBody:body,signatureHeader:header,signingSecret:secret,nowSeconds:now
 }),false);
});
