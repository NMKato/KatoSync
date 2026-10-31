// NMKato Solutions — stage 3F: deterministic local expiry handling.
// A UI timestamp never authorizes acceptance: native Rust/Edge checks remain
// authoritative at the actual moment of the signed decision.
export type ExpiringMeshItem = {expiresAt:string};

export function activeMeshInvitations<T extends ExpiringMeshItem>(
  invitations:readonly T[],
  now=Date.now(),
):T[] {
  return invitations.filter(item=>{
    const expiresAt=Date.parse(item.expiresAt);
    return Number.isFinite(expiresAt)&&expiresAt>now;
  });
}

// Single UI-only wake-up. No implicit network poll, no renewal, no approval.
export function nextMeshInboxExpiryDelay(
  invitations:readonly ExpiringMeshItem[],
  now=Date.now(),
):number|null {
  const active=activeMeshInvitations(invitations,now);
  if(active.length===0)return null;
  const nearest=Math.min(...active.map(item=>Date.parse(item.expiresAt)));
  return Math.min(2_147_483_000,Math.max(0,nearest-now+10));
}
