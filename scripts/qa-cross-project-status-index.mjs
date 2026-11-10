// NMKato Solutions — Stage4K cross-project status pointer index, QA only.
// This is an in-memory READ projection, not a SQLite writer or a security authority.
import {verifyProjectionIntegrity} from "./qa-project-memory-rolling.mjs";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const SHA = /^[a-f0-9]{40,64}$/;

export function buildCrossProjectStatusIndex(projections, {permittedProjectIds}={}) {
  if (!Array.isArray(projections) || projections.length>200 ||
      !Array.isArray(permittedProjectIds) || permittedProjectIds.length>200 ||
      permittedProjectIds.some(id=>typeof id!=="string"||!ID.test(id))) {
    throw Error("STAGE4K_DIRECTORY_SCOPE_REQUIRED");
  }
  const allowed=new Set(permittedProjectIds);
  if (allowed.size!==permittedProjectIds.length)
    throw Error("STAGE4K_DIRECTORY_DUPLICATE_PERMISSIONS");
  const seen=new Set();
  const records=[];
  for(const projection of projections) {
    if(!projection || typeof projection!=="object" || !ID.test(projection.projectId) ||
       seen.has(projection.projectId)) throw Error("STAGE4K_DIRECTORY_DUPLICATE_OR_INVALID_PROJECT");
    seen.add(projection.projectId);
    if(!allowed.has(projection.projectId)) continue;
    if(!verifyProjectionIntegrity(projection) ||
       projection.authoritative!==false ||
       projection.writerAuthorized!==false ||
       projection.automaticMergeAllowed!==false ||
       projection.remoteJobsEnabled!==false ||
       !SHA.test(projection.checkpoint?.commitSha??"")) {
      throw Error("STAGE4K_DIRECTORY_PROJECTION_INTEGRITY_DENIED");
    }
    records.push(Object.freeze({
      projectId:projection.projectId,
      latestSequence:projection.latestSequence,
      headCandidate:projection.checkpoint.commitSha,
      // Only owner-scoped sanitized checkpoint summary, not raw agent note contents.
      statusSummaryCandidate:projection.checkpoint.summary,
      latestArchiveDigest:projection.archives.at(-1)?.digest??null,
      archiveCount:projection.archives.length,
      recentEventCount:projection.index.filter(e=>e.archivePath===null).length,
      // Summary text and agent notes belong behind the PROJECT-scoped reader.
      detailReference:projection.projectId + "/PROJECT_STATUS_FLOW.md",
      trust:"projection-only-not-verified",
      readOnly:true
    }));
  }
  records.sort((a,b)=>a.projectId.localeCompare(b.projectId));
  return Object.freeze({
    schema:"katosync.cross-project-status-index/qa-v1",
    records:Object.freeze(records),
    canonical:false,
    writerAuthorized:false,
    automaticMergeAllowed:false,
    remoteJobsEnabled:false,
    requiresProjectReaderAuthorization:true,
    requiresCanonicalJournalAndLeaseValidation:true
  });
}
