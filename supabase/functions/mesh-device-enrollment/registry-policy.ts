// Created by NMKato Solutions
// Pure server-side discovery policy. Not an authorization for Mesh trust.
type Membership = "discovered" | "pending" | "trusted" | "revoked";
type DeviceRecord = {
  signing_public_key: string;
  membership_state: Membership;
  revoked_at: string | null;
};

type Inspection =
  | {kind:"new"; count:number}
  | {kind:"known"; count:number}
  | {kind:"revoked"}
  | {kind:"invalid"};

const states:readonly string[]=["discovered","pending","trusted","revoked"];

/** Untrusted PostgREST JSON must not be able to revive revoked identities. */
export function inspectEnrollmentRegistry(raw:unknown, publicKey:string):Inspection {
  if(!Array.isArray(raw)||raw.length>10)return {kind:"invalid"};
  const records:DeviceRecord[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))return {kind:"invalid"};
    const row=value as Record<string,unknown>;
    if(typeof row.signing_public_key!=="string"||
        !states.includes(String(row.membership_state))||
        !(row.revoked_at===null||
          (typeof row.revoked_at==="string"&&Number.isFinite(Date.parse(row.revoked_at))))||
        (row.membership_state==="revoked")!==(row.revoked_at!==null))
      return {kind:"invalid"};
    records.push(row as DeviceRecord);
  }
  const matching=records.filter(row=>row.signing_public_key===publicKey);
  if(matching.length>1)return {kind:"invalid"};
  if(matching[0]?.membership_state==="revoked")return {kind:"revoked"};
  return {kind:matching.length?"known":"new",count:records.length};
}
