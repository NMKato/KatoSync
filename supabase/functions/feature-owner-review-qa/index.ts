// NMKato Solutions – QA reviewer attestation only; verify_jwt=true.
// No reviewer enrollment, no project ownership mutation, no CORS.
import {handleReviewerReview} from "./handler.ts";
Deno.serve((request:Request)=>handleReviewerReview(request,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_FEATURE_APPROVAL_STAGE:Deno.env.get("KATOSYNC_FEATURE_APPROVAL_STAGE")??"",
}));
