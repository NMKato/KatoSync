// NEW KatoSync Stage4E QA-only owner cancellation. NOT DEPLOYED.
// A future deployment MUST retain platform verify_jwt=true and pass security
// review for Auth session lifecycle, owner consent and SQL provenance.
// No CORS/wildcard access, never enable on the production KATOOS origin.
import {handleInboxTerminalOwnerQA} from "./handler.ts";
Deno.serve(req=>handleInboxTerminalOwnerQA(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:
  Deno.env.get("KATOSYNC_INBOX_TERMINAL_OWNER_STAGE")??"",
 KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:
  Deno.env.get("KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF")??""
}));