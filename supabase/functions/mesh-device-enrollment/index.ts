import {completeMeshDeviceDiscovery} from "./complete.ts";
import {handleMeshEnrollmentChallenge} from "./handler.ts";
Deno.serve((req)=>{
  const handler=new URL(req.url).pathname.endsWith("/complete")?completeMeshDeviceDiscovery:handleMeshEnrollmentChallenge;
  return handler(req,{
  SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
  SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
  KATOSYNC_MESH_ENROLLMENT_STAGE:Deno.env.get("KATOSYNC_MESH_ENROLLMENT_STAGE")??""
});
});
