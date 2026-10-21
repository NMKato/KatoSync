// KatoSync #76: REVIEW-ONLY backend approval policy, no HTTP route or live adapter.
// NEVER import from a frontend bundle. Trusted ports must verify user sessions,
// account/project rights, device enrollment, one-time challenges and DB writes.
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";

export type Session = { userId:string; sessionId:string; expiresAtMs:number; anonymous:boolean };
export type Device = { accountId:string; deviceId:string; publicKeyPem:string; trusted:boolean; revoked:boolean };
export type Task = { accountId:string; projectId:string; taskId:string; executorDeviceId:string; approverDeviceId:string; expectedHead:string; scope:"edit_worktree" };
export type PublicChallenge = Task & { challengeId:string; nonce:string; expiresAtMs:number };
export type Challenge = PublicChallenge & { userId:string; sessionId:string };
export type Grant = { approvalId:string; approvedBy:string; accountId:string; projectId:string; deviceId:string; taskId:string; expectedHead:string; capabilities:["edit_worktree"]; proofDigestSha256:string; expiresAtMs:number };
export type Ports = {
  auth: { verifyUserAccessToken(token:string):Promise<Session|null> };
  policy: {
    canApprove(userId:string,accountId:string,projectId:string):Promise<boolean>;
    // Explicit signer-to-user binding: account membership alone is insufficient.
    canUseApproverDevice(userId:string,accountId:string,deviceId:string):Promise<boolean>;
    registeredDevice(accountId:string,deviceId:string):Promise<Device|null>;
  };
  challenges: {
    store(value:Challenge):Promise<void>;
    // MUST be an atomic consume-once operation in persistent backend storage.
    consume(id:string,userId:string,sessionId:string):Promise<Challenge|null>;
  };
  approvals: {
    // Private DB adapter: NEVER client-accessible; requires independent audit
    // and membership/authorization recheck inside the real DB transaction.
    create(value:Grant):Promise<void>;
  };
  now?:()=>number;
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PROJECT=/^[A-Za-z0-9_.:-]{1,160}$/;
const SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export class ApprovalDenied extends Error {
  constructor(){super("Aufgabenfreigabe verweigert."); this.name="ApprovalDenied";}
}
function deny():never{throw new ApprovalDenied();}
function valid(t:Task):boolean{
  return t!==null && typeof t==="object" &&
    Object.keys(t).sort().join(",")==="accountId,approverDeviceId,executorDeviceId,expectedHead,projectId,scope,taskId" &&
    UUID.test(t.accountId) && UUID.test(t.taskId) &&
    UUID.test(t.executorDeviceId) && UUID.test(t.approverDeviceId) &&
    PROJECT.test(t.projectId) && SHA.test(t.expectedHead) && t.scope==="edit_worktree";
}
function same(a:Task,b:Task):boolean{
  return a.accountId===b.accountId && a.projectId===b.projectId &&
    a.taskId===b.taskId && a.executorDeviceId===b.executorDeviceId &&
    a.approverDeviceId===b.approverDeviceId && a.expectedHead===b.expectedHead &&
    a.scope===b.scope;
}
export function signedApprovalPayload(c:PublicChallenge):Uint8Array{
  return Buffer.from(JSON.stringify(["KATOSYNC_APPROVAL_V1",c.challengeId,c.nonce,
    c.accountId,c.projectId,c.taskId,c.executorDeviceId,
    c.approverDeviceId,c.expectedHead,c.scope,String(c.expiresAtMs)]),"utf8");
}
export class TrustedApprovalBroker {
  readonly ports:Ports;
  constructor(ports:Ports){this.ports=ports;}
  private now():number{return this.ports.now?.()??Date.now();}
  private async authenticated(token:string):Promise<Session>{
    if(typeof token!=="string" || token.length<16 || token.length>8192)deny();
    const s=await this.ports.auth.verifyUserAccessToken(token);
    if(!s || s.anonymous || !UUID.test(s.userId) || !UUID.test(s.sessionId) ||
      !Number.isSafeInteger(s.expiresAtMs) || s.expiresAtMs<=this.now())deny();
    return s;
  }
  private async authorized(s:Session,t:Task):Promise<Device>{
    if(!valid(t))deny();
    if(!await this.ports.policy.canApprove(s.userId,t.accountId,t.projectId))deny();
    if(!await this.ports.policy.canUseApproverDevice(s.userId,t.accountId,t.approverDeviceId))deny();
    const signer=await this.ports.policy.registeredDevice(t.accountId,t.approverDeviceId);
    const worker=await this.ports.policy.registeredDevice(t.accountId,t.executorDeviceId);
    if(!signer || !worker || !signer.trusted || signer.revoked || !worker.trusted ||
       worker.revoked || signer.accountId!==t.accountId || worker.accountId!==t.accountId ||
       signer.deviceId!==t.approverDeviceId || worker.deviceId!==t.executorDeviceId)deny();
    try{
      if(createPublicKey(signer.publicKeyPem).asymmetricKeyType!=="ed25519")deny();
    }catch{deny();}
    return signer;
  }
  async issueChallenge(token:string,t:Task):Promise<PublicChallenge>{
    const s=await this.authenticated(token);
    await this.authorized(s,t);
    const challenge:Challenge={...t,challengeId:randomUUID(),
      nonce:randomBytes(32).toString("base64url"),userId:s.userId,
      sessionId:s.sessionId,expiresAtMs:Math.min(this.now()+90_000,s.expiresAtMs)};
    if(challenge.expiresAtMs<=this.now())deny();
    await this.ports.challenges.store(challenge);
    // Public response omits internal actor/session bindings. Server retains them.
    const {userId: _userId, sessionId: _sessionId, ...publicChallenge}=challenge;
    return publicChallenge;
  }
  async approve(token:string,t:Task,confirmation:unknown,id:string,signature:string):Promise<Grant>{
    // GUI must collect an explicit human action. This literal is NOT by itself
    // trusted proof of user presence; OS-protected signing needs UX review.
    if(confirmation!=="APPROVE_THIS_TASK" || !UUID.test(id) ||
      typeof signature!=="string" || signature.length<60 || signature.length>200 ||
      !/^[A-Za-z0-9_-]+$/.test(signature))deny();
    const s=await this.authenticated(token);
    const signer=await this.authorized(s,t);
    const c=await this.ports.challenges.consume(id,s.userId,s.sessionId);
    if(!c || c.challengeId!==id || c.userId!==s.userId ||
      c.sessionId!==s.sessionId || c.expiresAtMs<=this.now() || !same(c,t))deny();
    const message=signedApprovalPayload(c);
    const bytes=Buffer.from(signature,"base64url");
    if(bytes.length!==64 || !verify(null,message,createPublicKey(signer.publicKeyPem),bytes))deny();
    // Recheck online membership/device status before touching private ledger.
    await this.authorized(s,t);
    if(s.expiresAtMs<=this.now())deny();
    const grant:Grant={
      approvalId:randomUUID(),approvedBy:s.userId,accountId:t.accountId,
      projectId:t.projectId,deviceId:t.executorDeviceId,taskId:t.taskId,
      expectedHead:t.expectedHead,capabilities:["edit_worktree"],
      proofDigestSha256:createHash("sha256").update(message).update(bytes).digest("hex"),
      expiresAtMs:Math.min(this.now()+20*60_000,s.expiresAtMs),
    };
    if(grant.expiresAtMs<=this.now())deny();
    await this.ports.approvals.create(grant);
    return grant;
  }
}
