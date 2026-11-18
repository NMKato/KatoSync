// QA-only Edge entrypoint. No cloud deployment, no discovery writes.
import {handleEnrollmentPreviewV2} from "./handler.ts";
Deno.serve(req=>handleEnrollmentPreviewV2(req,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_MESH_RELAY_QA_MODE:Deno.env.get("KATOSYNC_MESH_RELAY_QA_MODE")??"",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:Deno.env.get("KATOSYNC_MESH_RELAY_QA_PROJECT_REF")??"",
 DENO_DEPLOYMENT_ID:Deno.env.get("DENO_DEPLOYMENT_ID")??"",
 KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE:Deno.env.get("KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE")??""
}));
