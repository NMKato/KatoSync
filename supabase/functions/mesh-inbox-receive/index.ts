// NMKato Solutions / Stage 2O. Inactive until explicitly deployed and gated.
import {handleMeshInboxReceive} from "./receive.ts";
Deno.serve(req=>handleMeshInboxReceive(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_MESH_INBOX_RECEIVE_STAGE:Deno.env.get("KATOSYNC_MESH_INBOX_RECEIVE_STAGE")??""
}));
