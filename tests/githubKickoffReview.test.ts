// Created by NMKato Solutions
import assert from "node:assert/strict";
import {test} from "node:test";
import {buildGithubKickoffReview,type ReadonlyGithubInventory} from "../src/lib/githubKickoffReview.ts";
const tickets=[{featureId:"MVP-1",title:"Booking"},{featureId:"MVP-2",title:"Review"}];
function fixture():ReadonlyGithubInventory{
 return {
  projectId:"alpha",repository:{fullName:"NMKato/KatoSync",visibility:"private",archived:false,hasIssues:true},
  observedGitHead:"a".repeat(40),projectsStatus:"read",projectsScanComplete:true,
  issuesScanComplete:true,issuesScanned:125,
  boards:[{number:7,title:"Existing product",closed:false,public:false,
   possibleRepoMatch:true,url:"https://github.com/users/NMKato/projects/7",providerId:"PVT_7"}],
  issueCandidates:[{featureId:"MVP-1",number:88,title:"Existing",url:"https://github.com/NMKato/KatoSync/issues/88",state:"open"}],
  remoteWritesPerformed:false,automaticCreationAllowed:false
 };
}
test("existing boards and issues are reviewed, not recreated",()=>{
 const review=buildGithubKickoffReview(tickets,fixture());
 assert.equal(review.proposedBoardAction,"review_existing_board");
 assert.deepEqual(review.boardCandidates,[7]);
 assert.deepEqual(review.issueReview.map(row=>row.decision),["reuse_candidate","propose_after_review"]);
 assert.deepEqual(review.issueReview[0].matches,[88]);
 assert.equal(review.requiresHumanApproval,true);
 assert.equal(review.writesAuthorized,false);
 assert.equal(review.remoteWritesPerformed,false);
 assert.equal(review.appAuthorizationState,"not_connected");
});
test("missing scope or truncated issue list never unlocks duplicate creation",()=>{
 const value=fixture();
 value.projectsStatus="unavailable";
 value.projectsScanComplete=false;
 value.issuesScanComplete=false;
 value.boards=[];
 value.issueCandidates=[];
 const review=buildGithubKickoffReview(tickets,value);
 assert.equal(review.proposedBoardAction,"inventory_incomplete");
 assert.deepEqual(review.issueReview.map(row=>row.decision),["incomplete_scan","incomplete_scan"]);
 assert.ok(review.blockers.includes("projects_inventory_incomplete"));
 assert.ok(review.blockers.includes("issues_inventory_incomplete"));
 assert.equal(review.writesAuthorized,false);
});
test("more than one matching issue is ambiguous, not arbitrarily picked",()=>{
 const input=fixture();
 input.issueCandidates.push({featureId:"MVP-1",number:99,title:"Duplicate",url:"https://github.com/NMKato/KatoSync/issues/99",state:"closed"});
 const review=buildGithubKickoffReview(tickets,input);
 assert.equal(review.issueReview[0].decision,"ambiguous_candidates");
 assert.deepEqual(review.issueReview[0].matches,[88,99]);
});
test("public, archived, issues-disabled repo remains blocked",()=>{
 const input=fixture();
 input.repository.visibility="public";
 input.repository.archived=true;
 input.repository.hasIssues=false;
 const out=buildGithubKickoffReview(tickets,input);
 assert.deepEqual(out.blockers.filter(x=>x!=="existing_board_candidate_requires_review"&&x!=="existing_issue_candidate_requires_review"),
 ["archived_repository","issues_disabled","public_repository_privacy_review"]);
});
test("false provider write flags are mandatory and no ticket exceeds reviewed limit",()=>{
 const input=fixture();
 assert.throws(()=>buildGithubKickoffReview(tickets,{
  ...input,automaticCreationAllowed:true as false
 }),/github_snapshot_not_readonly/);
 assert.throws(()=>buildGithubKickoffReview(tickets,{
  ...input,remoteWritesPerformed:true as false
 }),/github_snapshot_not_readonly/);
 const many=Array.from({length:24},(_,i)=>({featureId:"F-"+i,title:"Task "+i}));
 assert.equal(buildGithubKickoffReview(many,input).issueReview.length,12);
});
