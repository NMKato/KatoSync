// NMKato Solutions – staged-only Mesh cryptographic relay.
// Never enable in the shared project before isolated DB/Edge QA and approval.
import {handleMeshPairingRelay} from "./relay.ts";

Deno.serve(req=>handleMeshPairingRelay(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_MESH_PAIRING_RELAY_STAGE:Deno.env.get("KATOSYNC_MESH_PAIRING_RELAY_STAGE")??"",
 KATOSYNC_MESH_RELAY_QA_MODE:Deno.env.get("KATOSYNC_MESH_RELAY_QA_MODE")??"",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:Deno.env.get("KATOSYNC_MESH_RELAY_QA_PROJECT_REF")??"",
 DENO_DEPLOYMENT_ID:Deno.env.get("DENO_DEPLOYMENT_ID")??""
}));
