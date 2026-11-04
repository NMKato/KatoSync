import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261103164548_katosync_billing_product_scoped.sql",import.meta.url),"utf8");
test("new billing state has independent schema and exact KatoSync price binding",()=>{
 assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS katosync.billing_subscriptions"));
 assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS katosync.billing_webhook_events"));
 assert.ok(sql.includes("prod_VYsQNVBDeJ3TaO"));
 assert.ok(sql.includes("price_1UXkfiRlRREUhJSrNo3taV4L"));
 assert.ok(sql.includes("CHECK (product_key = 'katosync')"));
 assert.ok(sql.includes("PRIMARY KEY"));
 assert.ok(sql.includes("ENABLE ROW LEVEL SECURITY"));
 assert.ok(sql.includes("owner_user_id=(SELECT auth.uid())"));
 assert.ok(sql.includes("REVOKE ALL ON katosync.billing_subscriptions FROM PUBLIC, anon, authenticated"));
 assert.ok(!/CREATE TABLE IF NOT EXISTS public\.katoos_|UPDATE public\.katoos_|INSERT INTO public\.katoos_|DELETE FROM public\.katoos_/i.test(sql));
});
test("no direct client mutation of KatoSync billing or webhook event ledger",()=>{
 assert.ok(!/GRANT (INSERT|UPDATE|DELETE) ON katosync.billing_subscriptions TO authenticated/i.test(sql));
 assert.ok(!/GRANT (INSERT|UPDATE|DELETE) ON katosync.billing_webhook_events TO authenticated/i.test(sql));
 assert.ok(!/GRANT (SELECT|INSERT|UPDATE|DELETE) ON katosync.billing_webhook_events TO anon/i.test(sql));
});
