// Created by NMKato Solutions
// Only known native status labels. No OS exceptions, tokens, IDs, key material.
export type MeshIdentityFailure =
  "account"|"session"|"refresh"|"network"|"invalid"|"changed"|"storeInit"|"storeRead"|"storeWrite"|
  "readback"|"mismatch"|"corrupt"|"unknown";
export function classifyMeshIdentityFailure(error:unknown):MeshIdentityFailure{
 const raw=typeof error==="string"?error:error instanceof Error?error.message:"";
 const fixed:Record<string,MeshIdentityFailure>={
  MESH_IDENTITY_ACCOUNT_UNVERIFIED:"account",
  MESH_IDENTITY_ACCOUNT_SESSION:"session",
  MESH_IDENTITY_ACCOUNT_REFRESH:"refresh",
  MESH_IDENTITY_ACCOUNT_NETWORK:"network",
  MESH_IDENTITY_ACCOUNT_INVALID:"invalid",
  MESH_IDENTITY_ACCOUNT_CHANGED:"changed",
  MESH_IDENTITY_STORE_INIT:"storeInit",
  MESH_IDENTITY_STORE_READ:"storeRead",
  MESH_IDENTITY_STORE_WRITE:"storeWrite",
  MESH_IDENTITY_STORE_READBACK:"readback",
  MESH_IDENTITY_STORE_MISMATCH:"mismatch",
  MESH_IDENTITY_STORE_CORRUPT:"corrupt"
 };
 return fixed[raw]??"unknown";
}
