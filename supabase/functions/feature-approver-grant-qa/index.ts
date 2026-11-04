// KatoSync QA: no CORS, no mutations, no implicit project authorization.
// Deployment requires verify_jwt=true. This handler also verifies the issuer.
import {issueFeatureApprovalGrant} from "./issue.ts";
Deno.serve((request:Request)=>issueFeatureApprovalGrant(request,{
 SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
 SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
 KATOSYNC_FEATURE_APPROVAL_STAGE:Deno.env.get("KATOSYNC_FEATURE_APPROVAL_STAGE")??"",
 KATOSYNC_APPROVER_ISSUER_PKCS8_B64:Deno.env.get("KATOSYNC_APPROVER_ISSUER_PKCS8_B64")??""
}));
