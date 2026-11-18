// NMKato Solutions — prepared QA Gate10 NATIVE readback facade.
// Existing KATOOS JWT, refresh token, public project API key and identity
// check stay in Rust. WebView never receives or stores ANY KATOOS token.
// Not mounted in App.tsx. A response can NEVER grant role/Mesh/job access.
export type OwnerReviewReadbackStatus =
  "disconnected" | "unavailable" | "loading" |
  "unauthorized" | "server_attested_unverified";

export interface NativeGate10Readback {
  protocol: "katosync.native-owner-review-readback-qa/v1";
  status: "server_attested_unverified";
  ownerAuthenticated: true;
  serverAttestationReceived: true;
  independentReviewerVerified: false;
  grantsRights: false;
  verifiedPercent: null;
  remoteJobsEnabled: false;
}

export interface OwnerReviewReadbackSnapshot {
  readonly status: OwnerReviewReadbackStatus;
  /** An untrusted readback exists, NOT proof of an independent authorization. */
  readonly serverEvidencePresent: boolean;
  readonly grantsRights: false;
  readonly verifiedPercent: null;
}

export interface ExistingKatoosOwnerSession {
  /** Opaque epoch from the EXISTING native KATOOS session, not an email/ID. */
  sessionKey: string;
  /** Claimed active owner; Rust MUST verify against live /auth/v1/user. */
  expectedOwnerUid: string;
}
export interface NativeReadbackArguments {
  decisionId: string;
  grantId: string;
  expectedOwnerUid: string;
}
export interface OwnerReviewReadbackConfig {
  /** For test fixtures only. Default invokes the native Tauri command. */
  invokeNative?: (args: NativeReadbackArguments) => Promise<unknown>;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const empty=(status:OwnerReviewReadbackStatus):OwnerReviewReadbackSnapshot=>
  Object.freeze({status,serverEvidencePresent:false,grantsRights:false,verifiedPercent:null});
const isObject=(v:unknown):v is Record<string,unknown>=>!!
  v&&typeof v==="object"&&!Array.isArray(v);
const EXPECTED=["protocol","status","ownerAuthenticated","serverAttestationReceived",
  "independentReviewerVerified","grantsRights","verifiedPercent","remoteJobsEnabled"];
function isSafeNativeResult(v:unknown):v is NativeGate10Readback{
  return isObject(v)&&Object.keys(v).length===EXPECTED.length&&
    Object.keys(v).every(k=>EXPECTED.includes(k))&&
    v.protocol==="katosync.native-owner-review-readback-qa/v1"&&
    v.status==="server_attested_unverified"&&
    v.ownerAuthenticated===true&&v.serverAttestationReceived===true&&
    v.independentReviewerVerified===false&&v.grantsRights===false&&
    v.verifiedPercent===null&&v.remoteJobsEnabled===false;
}
/**
 * An explicitly-called QA adapter. No WebView HTTP request or Authorization header,
 * localStorage, password, API key or Token provider exists in this module.
 * Only Rust may access the native protected issuer session.
 */
export function createOwnerReviewReadbackSessionClient(config:OwnerReviewReadbackConfig={}){
  const native=config.invokeNative??(async(args:NativeReadbackArguments)=>{
    const {invoke}=await import("@tauri-apps/api/core");
    return invoke<unknown>("mesh_owner_review_readback_qa",{decisionId:args.decisionId,grantId:args.grantId,expectedOwnerUid:args.expectedOwnerUid});
  });
  if(typeof native!=="function")throw new TypeError("INVALID_NATIVE_READBACK");
  let active:ExistingKatoosOwnerSession|null=null;
  let generation=0;
  let state:OwnerReviewReadbackSnapshot=empty("disconnected");
  const observers=new Set<(v:OwnerReviewReadbackSnapshot)=>void>();
  function publish(next:OwnerReviewReadbackSnapshot){
    state=next;
    for(const callback of observers)try{callback(state);}catch{
      // UI cannot alter security outcomes.
    }
  }
  function attach(session:ExistingKatoosOwnerSession){
    if(!session||typeof session.sessionKey!=="string"||
      session.sessionKey.length<8||session.sessionKey.length>256||
      typeof session.expectedOwnerUid!=="string"||!UUID.test(session.expectedOwnerUid)){
      throw new TypeError("INVALID_EXISTING_KATOOS_SESSION");
    }
    generation++;
    active={sessionKey:session.sessionKey,expectedOwnerUid:session.expectedOwnerUid};
    publish(empty("unavailable"));
  }
  function disconnect(){
    generation++;
    active=null;
    publish(empty("disconnected"));
  }
  async function readback(decisionId:string,grantId:string):Promise<OwnerReviewReadbackSnapshot>{
    if(!active)return state;
    if(typeof decisionId!=="string"||!UUID.test(decisionId)||
       typeof grantId!=="string"||!UUID.test(grantId)){
      throw new TypeError("INVALID_REVIEW_REFERENCE");
    }
    generation++;
    const ownGeneration=generation;
    const current=active;
    publish(empty("loading"));
    try{
      const result=await native({decisionId,grantId,
        expectedOwnerUid:current.expectedOwnerUid});
      if(ownGeneration!==generation||active!==current)return state;
      if(!isSafeNativeResult(result)){
        publish(empty("unavailable"));return state;
      }
      publish(Object.freeze({status:"server_attested_unverified",
        serverEvidencePresent:true,grantsRights:false,verifiedPercent:null}));
      return state;
    }catch(error){
      if(ownGeneration!==generation||active!==current)return state;
      // Errors from native are allowlisted to avoid showing server/identity data.
      const code=typeof error==="string"?error:
        error instanceof Error?error.message:"";
      publish(empty(["GATE10_NATIVE_LOGIN_REQUIRED",
        "GATE10_NATIVE_OWNER_CHANGED"].includes(code)?"unauthorized":"unavailable"));
      return state;
    }
  }
  function subscribe(callback:(v:OwnerReviewReadbackSnapshot)=>void){
    if(typeof callback!=="function")throw new TypeError("INVALID_OBSERVER");
    observers.add(callback);
    try{callback(state);}catch{}
    return ()=>{observers.delete(callback);};
  }
  return Object.freeze({attach,disconnect,readback,subscribe,
    snapshot:():OwnerReviewReadbackSnapshot=>state});
}
