// Backend-only PostgreSQL adapters for KatoSync #76.
// No HTTP endpoint, deployment, credentials, or client-accessible SQL.
// A TRUSTED backend must verify the live session and approve an operator
// interaction BEFORE calling these adapters.
import type { Challenge, Device, Ports } from "./trustedApprovalBroker.ts";

export interface PrivateSql {
  // MUST use server-side parameter binding, never string substitution.
  query<T extends Record<string, unknown>>(
    sql: string, parameters: readonly (string | boolean)[]
  ): Promise<readonly T[]>;
}
export function createDurableAuthorizationPorts(db: PrivateSql): Pick<Ports,"policy"|"challenges"> {
  return {
    policy: {
      async canApprove(userId,accountId,projectId) {
        const rows=await db.query<{allowed:boolean}>(`
          SELECT EXISTS(
            SELECT 1 FROM katosync_private.project_memberships m
            WHERE m.user_id=$1::uuid AND m.account_id=$2::uuid
              AND m.project_id=$3::text
              AND m.revoked_at IS NULL
              AND m.role IN ('owner','approver')
          ) AS allowed
        `,[userId,accountId,projectId]);
        return rows.length===1 && rows[0]?.allowed===true;
      },
      async canUseApproverDevice(userId,accountId,deviceId) {
        const rows=await db.query<{allowed:boolean}>(`
          SELECT EXISTS(
            SELECT 1 FROM katosync_private.trusted_devices d
            WHERE d.owner_user_id=$1::uuid AND d.account_id=$2::uuid
              AND d.device_id=$3::uuid
              AND d.trusted=true AND d.revoked_at IS NULL
          ) AS allowed
        `,[userId,accountId,deviceId]);
        return rows.length===1 && rows[0]?.allowed===true;
      },
      async registeredDevice(accountId,deviceId):Promise<Device|null> {
        const rows=await db.query<{
          account_id:string; device_id:string; signing_public_key_pem:string;
          trusted:boolean; revoked:boolean;
        }>(`
          SELECT d.account_id,d.device_id,d.signing_public_key_pem,d.trusted,
                 (d.revoked_at IS NOT NULL) AS revoked
          FROM katosync_private.trusted_devices d
          WHERE d.account_id=$1::uuid AND d.device_id=$2::uuid
        `,[accountId,deviceId]);
        if(rows.length!==1 || !rows[0])return null;
        const d=rows[0];
        if(d.account_id!==accountId || d.device_id!==deviceId ||
           typeof d.signing_public_key_pem!=="string" ||
           typeof d.trusted!=="boolean" || typeof d.revoked!=="boolean")return null;
        return {accountId:d.account_id,deviceId:d.device_id,
          publicKeyPem:d.signing_public_key_pem,
          trusted:d.trusted,revoked:d.revoked};
      },
    },
    challenges: {
      async store(c:Challenge):Promise<void> {
        const rows=await db.query<{challenge_id:string}>(`
          INSERT INTO katosync_private.approval_challenges
            (challenge_id,nonce,account_id,project_id,task_id,
             executor_device_id,approver_device_id,expected_head,
             scope,user_id,session_id,expires_at)
          SELECT $1::uuid,$2::text,$3::uuid,$4::text,$5::uuid,
                 $6::uuid,$7::uuid,$8::text,$9::text,$10::uuid,$11::uuid,
                 $12::timestamptz
          WHERE EXISTS (
            SELECT 1 FROM katosync_private.project_memberships m
             WHERE m.user_id=$10::uuid AND m.account_id=$3::uuid
               AND m.project_id=$4::text AND m.revoked_at IS NULL
               AND m.role IN ('owner','approver')
          ) AND EXISTS (
            SELECT 1 FROM katosync_private.trusted_devices d
             WHERE d.account_id=$3::uuid AND d.device_id=$7::uuid
               AND d.owner_user_id=$10::uuid
               AND d.trusted AND d.revoked_at IS NULL
          ) AND EXISTS (
            SELECT 1 FROM katosync_private.trusted_devices w
             WHERE w.account_id=$3::uuid AND w.device_id=$6::uuid
               AND w.trusted AND w.revoked_at IS NULL
          ) AND EXISTS (
            SELECT 1 FROM auth.sessions s
             WHERE s.id=$11::uuid AND s.user_id=$10::uuid
          )
          RETURNING challenge_id
        `,[
          c.challengeId,c.nonce,c.accountId,c.projectId,c.taskId,
          c.executorDeviceId,c.approverDeviceId,c.expectedHead,c.scope,
          c.userId,c.sessionId,new Date(c.expiresAtMs).toISOString(),
        ]);
        // A stale session, revoked signer or insufficient role denies issue.
        if(rows.length!==1 || rows[0]?.challenge_id!==c.challengeId)
          throw new Error("Challenge was not authorized at DB boundary");
      },
      async consume(challengeId,userId,sessionId):Promise<Challenge|null> {
        const rows=await db.query<{
          challenge_id:string;nonce:string;account_id:string;project_id:string;
          task_id:string;executor_device_id:string;approver_device_id:string;
          expected_head:string;scope:string;user_id:string;session_id:string;
          expires_at:Date|string;
        }>(`
          SELECT * FROM katosync_private.consume_approval_challenge(
            $1::uuid,$2::uuid,$3::uuid
          )
        `,[challengeId,userId,sessionId]);
        if(rows.length!==1 || !rows[0])return null;
        const v=rows[0];
        const expiresAtMs=new Date(v.expires_at).getTime();
        if(!Number.isFinite(expiresAtMs) || v.challenge_id!==challengeId ||
          v.user_id!==userId || v.session_id!==sessionId ||
          v.scope!=="edit_worktree")return null;
        return {
          challengeId:v.challenge_id,nonce:v.nonce,accountId:v.account_id,
          projectId:v.project_id,taskId:v.task_id,
          executorDeviceId:v.executor_device_id,
          approverDeviceId:v.approver_device_id,
          expectedHead:v.expected_head,scope:"edit_worktree",
          userId:v.user_id,sessionId:v.session_id,expiresAtMs,
        };
      },
    },
  };
}
