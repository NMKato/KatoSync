// NMKato Solutions – Stage-only challenge endpoint. Requires verify_jwt=true.
// Every caller is independently validated against canonical KATOOS auth.
import {handleOwnerChallenge} from "./handler.ts";
Deno.serve(req=>handleOwnerChallenge(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_FEATURE_APPROVAL_STAGE:Deno.env.get("KATOSYNC_FEATURE_APPROVAL_STAGE")??"",
}));
