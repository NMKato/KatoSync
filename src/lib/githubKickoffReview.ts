// Created by NMKato Solutions
// Pure, local preview only. Never interpret missing data as a provisioning grant.
import type {KickoffTicket} from "./projectKickoff.ts";

export interface ReadonlyGithubInventory {
  projectId:string;
  repoBoardLinks?:{
    status:"verified"|"partial"|"unavailable";
    linkedBoards:Array<{number:number;providerId:string;title:string;url:string;repositoryLinkVerified:boolean}>;
    providerTotal:number|null;pagesScanned:number;providerSource:string;remoteWritesPerformed:false;
  };
  repository:{fullName:string;visibility:"private"|"public";archived:boolean;hasIssues:boolean};
  observedGitHead:string;
  projectsStatus:"read"|"unavailable";
  projectsScanComplete:boolean;
  issuesScanComplete:boolean;
  issuesScanned:number;
  boards:Array<{number:number;title:string;possibleRepoMatch:boolean;closed:boolean;public:boolean;url:string;providerId:string}>;
  issueCandidates:Array<{featureId:string;number:number;title:string;url:string;state:string}>;
  remoteWritesPerformed:false;automaticCreationAllowed:false;
}

export type IssueReviewDecision="reuse_candidate"|"ambiguous_candidates"|"propose_after_review"|"incomplete_scan";
export interface IssueReviewRow{
 featureId:string;title:string;decision:IssueReviewDecision;matches:number[];
}
export interface GithubKickoffReview {
 schema:"katosync.github-kickoff-review/v1";
 repository:string;headSha:string;
 repoPrivacy:"public"|"private";
 proposedBoardAction:"reuse_verified_linked_board"|"review_existing_board"|"inventory_incomplete"|"review_new_board_request";
 verifiedLinkedBoards:number[];
 repoLinkageStatus:"verified"|"partial"|"unavailable";
 boardCandidates:number[];
 issueReview:IssueReviewRow[];
 issuesScanned:number;
 issuesComplete:boolean;boardsComplete:boolean;
 requiresHumanApproval:true;
 writesAuthorized:false;
 remoteWritesPerformed:false;
 appAuthorizationState:"not_connected";
 blockers:string[];
}
export function buildGithubKickoffReview(
  tickets:readonly Pick<KickoffTicket,"featureId"|"title">[],
  snapshot:ReadonlyGithubInventory
):GithubKickoffReview {
  if(snapshot.remoteWritesPerformed!==false||snapshot.automaticCreationAllowed!==false){
    throw new Error("github_snapshot_not_readonly");
  }
  const blockers:string[]=[];
  if(snapshot.repository.archived) blockers.push("archived_repository");
  if(!snapshot.repository.hasIssues) blockers.push("issues_disabled");
  if(snapshot.repository.visibility==="public")blockers.push("public_repository_privacy_review");
  const boardsComplete=snapshot.projectsStatus==="read"&&snapshot.projectsScanComplete;
  if(!boardsComplete) blockers.push("projects_inventory_incomplete");
  if(!snapshot.issuesScanComplete)blockers.push("issues_inventory_incomplete");
  const linked=snapshot.repoBoardLinks;
  // Confirmed individual links stay valid even if additional pages were
  // unavailable; only claims about complete inventory need full pagination.
  const linkedConfirmed=linked?.status!=="unavailable" ?
    (linked?.linkedBoards.filter(b=>b.repositoryLinkVerified)??[]):[];
  const linkageStatus=linked?.status??"unavailable";
  if(linkageStatus!=="verified")blockers.push("repository_board_linkage_unavailable");
  if(linkedConfirmed.length>0)blockers.push("verified_linked_board_requires_review");
  const candidates=snapshot.boards.filter(b=>b.possibleRepoMatch);
  if(candidates.length)blockers.push("existing_board_candidate_requires_review");
  const issueReview=tickets.slice(0,12).map(ticket=>{
    const matches=snapshot.issueCandidates.filter(x=>x.featureId===ticket.featureId).map(x=>x.number);
    if(matches.length)blockers.push("existing_issue_candidate_requires_review");
    const decision:IssueReviewDecision=matches.length>1?"ambiguous_candidates":
      matches.length===1?"reuse_candidate":
      snapshot.issuesScanComplete?"propose_after_review":"incomplete_scan";
    return {featureId:ticket.featureId,title:ticket.title,decision,matches};
  });
  return {
    schema:"katosync.github-kickoff-review/v1",
    repository:snapshot.repository.fullName,headSha:snapshot.observedGitHead,
    repoPrivacy:snapshot.repository.visibility,
    proposedBoardAction:linkedConfirmed.length?"reuse_verified_linked_board":
      candidates.length?"review_existing_board":
      boardsComplete?"review_new_board_request":"inventory_incomplete",
    verifiedLinkedBoards:linkedConfirmed.map(c=>c.number),
    repoLinkageStatus:linkageStatus,
    boardCandidates:candidates.map(c=>c.number),
    issueReview,issuesScanned:snapshot.issuesScanned,
    issuesComplete:snapshot.issuesScanComplete,boardsComplete,
    requiresHumanApproval:true,writesAuthorized:false,
    remoteWritesPerformed:false,appAuthorizationState:"not_connected",
    blockers:[...new Set(blockers)]
  };
}
