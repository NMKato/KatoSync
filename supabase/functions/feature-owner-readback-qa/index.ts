// NMKato Solutions — QA-only owner review readback, verify_jwt=true.
// Do not deploy before security review. No CORS or privilege mutations.
import {handleOwnerReviewReadback} from "./handler.ts";
Deno.serve((req:Request)=>handleOwnerReviewReadback(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_FEATURE_APPROVAL_STAGE:Deno.env.get("KATOSYNC_FEATURE_APPROVAL_STAGE")??"",
}));
