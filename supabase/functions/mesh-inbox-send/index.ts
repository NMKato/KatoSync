// NMKato Solutions — dormant until explicitly deployed, send-only.
import {submitSignedMeshInvite} from "./send.ts";
Deno.serve(req=>submitSignedMeshInvite(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_MESH_INBOX_STAGE:Deno.env.get("KATOSYNC_MESH_INBOX_STAGE")??""
}));
