// NMKato Solutions — isolated QA endpoint; existing Enrollment v4 unchanged.
import {handleSignedMeshHeartbeat} from "./heartbeat.ts";
Deno.serve(req=>handleSignedMeshHeartbeat(req,{
  SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
  SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
  KATOSYNC_MESH_ENROLLMENT_STAGE:Deno.env.get("KATOSYNC_MESH_ENROLLMENT_STAGE")??""
}));
