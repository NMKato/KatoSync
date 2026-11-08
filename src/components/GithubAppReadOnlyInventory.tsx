// Created by NMKato Solutions
// Read-only GitHub App discovery and explicit operator-reviewed issue-to-chat draft.
// No token access, remote writes, automatic chat sends or autonomous task starts.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Check,ClipboardCopy,FolderGit2,MessageSquareText,RefreshCcw,Search,ShieldCheck,X} from "lucide-react";
import {useT} from "../i18n";
import {githubIssueChatDraft,githubRepoOwner,githubRepoTitle} from "../lib/githubInventoryPresentation";
import type {GithubIssueHandoff} from "../lib/githubChatHandoff";
import {classifyGithubInventoryFailure,type InventoryFailure} from "../lib/githubInventoryFailure";
import type {TKey} from "../i18n";

type GithubRepo = {
  fullName:string;url:string;private:boolean;archived:boolean;installationId:number;
};
type Inventory = {
  repositories:GithubRepo[];installationCount:number;truncated:boolean;
  authSource:"github_app_user_access_token";remoteWritesPerformed:false;
};
type Issue = {number:number;title:string;url:string};
type OpenIssues = {
  fullName:string;issues:Issue[];truncated:boolean;remoteWritesPerformed:false;
};
type Draft = {issue:Issue;note:string};

export function GithubAppReadOnlyInventory({onChatHandoff}:{onChatHandoff?:(handoff:Omit<GithubIssueHandoff,"revision">)=>void}){
 const {t}=useT();
 const [inventory,setInventory]=useState<Inventory|null>(null);
 const [issues,setIssues]=useState<OpenIssues|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [issueLoading,setIssueLoading]=useState(false);
 const [error,setError]=useState<InventoryFailure|null>(null);
 const [issueError,setIssueError]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [filter,setFilter]=useState("");
 const [page,setPage]=useState(1);
 const [draft,setDraft]=useState<Draft|null>(null);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState(false);
 const request=useRef(0);
 const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;
  return ()=>{mounted.current=false;request.current++;};
 },[]);
 async function load(){
  const rev=++request.current;
  setLoading(true);setError(null);setIssues(null);setSelected(null);setDraft(null);
  setExpanded(false);setPage(1);setCopied(false);
  try{
   const next=await invoke<Inventory>("github_app_repository_inventory");
   if(!mounted.current||rev!==request.current)return;
   if(next.authSource!=="github_app_user_access_token"||next.remoteWritesPerformed!==false||
      !Array.isArray(next.repositories))throw Error("Invalid native read contract");
   setInventory(next);
   }catch(e:unknown){
    if(mounted.current&&rev===request.current)setError(classifyGithubInventoryFailure(e));
   }
  finally{if(mounted.current&&rev===request.current)setLoading(false);}
 }
 async function showIssues(repo:GithubRepo){
  const rev=++request.current;
  setIssueLoading(true);setIssueError(false);setIssues(null);setSelected(repo.fullName);
  setPage(1);setDraft(null);setCopied(false);
  try{
   const result=await invoke<OpenIssues>("github_app_repo_issues",{
    fullName:repo.fullName,installationId:repo.installationId,page:1
   });
   if(!mounted.current||rev!==request.current)return;
   if(result.fullName!==repo.fullName||result.remoteWritesPerformed!==false||
      !Array.isArray(result.issues))throw Error("Invalid issue read contract");
   setIssues(result);
  }catch{if(mounted.current&&rev===request.current)setIssueError(true);}
  finally{if(mounted.current&&rev===request.current)setIssueLoading(false);}
 }
 async function loadMoreIssues(){
  if(!selected||!issues?.truncated||issueLoading||page>=10)return;
  const repo=inventory?.repositories.find(r=>r.fullName===selected);
  if(!repo)return;
  const rev=++request.current;
  const nextPage=page+1;
  setIssueLoading(true);setIssueError(false);
  try{
   const result=await invoke<OpenIssues>("github_app_repo_issues",{
    fullName:repo.fullName,installationId:repo.installationId,page:nextPage
   });
   if(!mounted.current||rev!==request.current)return;
   if(result.fullName!==repo.fullName||result.remoteWritesPerformed!==false||
      !Array.isArray(result.issues))throw Error("Invalid issue read contract");
   setIssues(prev=>{
    if(!prev||prev.fullName!==repo.fullName)return prev;
    const numbers=new Set(prev.issues.map(issue=>issue.number));
    return {...result,issues:[...prev.issues,...result.issues.filter(issue=>!numbers.has(issue.number))]};
   });
   setPage(nextPage);
  }catch{if(mounted.current&&rev===request.current)setIssueError(true);}
  finally{if(mounted.current&&rev===request.current)setIssueLoading(false);}
 }
 async function copyDraft(){
  if(!draft||!selected)return;
  setCopied(false);setCopyError(false);
  try{
   await navigator.clipboard.writeText(githubIssueChatDraft({
    fullName:selected,...draft.issue,note:draft.note
   }));
   setCopied(true);
  }catch{setCopyError(true);}
 }
 const normalized=filter.trim().toLocaleLowerCase();
 const filtered=inventory?.repositories.filter(repo=>
  !normalized||githubRepoTitle(repo.fullName).toLocaleLowerCase().includes(normalized)||
  repo.fullName.toLocaleLowerCase().includes(normalized))??[];
 const shown=expanded?filtered:filtered.slice(0,8);
 const selectedTitle=selected?githubRepoTitle(selected):"";
 return <section className="github-app-inventory" aria-label={t("github.inventory.heading")}>
  <div className="github-app-inventory-head">
   <strong><FolderGit2 size={15}/>{t("github.inventory.heading")}</strong>
   <button type="button" className="secondary compact-button"
    disabled={loading||issueLoading} onClick={()=>void load()}>
    <RefreshCcw size={14}/>{loading?t("github.inventory.loading"):t("github.inventory.load")}
   </button>
  </div>
  {error?<p className="tone-warn" role="alert">
   {t("github.inventory.failed")} {t(("github.inventory.reason."+error) as TKey)}
  </p>:null}
  {inventory?<div className="github-app-inventory-result">
   <small><ShieldCheck size={13}/>{t("github.inventory.source")} · {inventory.repositories.length} {t("github.inventory.repositories")}</small>
   {inventory.truncated?<small className="tone-warn">{t("github.inventory.partial")}</small>:null}
   {inventory.repositories.length>8?<label className="github-app-repo-search">
    <Search size={15}/>
    <input type="search" value={filter} placeholder={t("github.inventory.search")}
     aria-label={t("github.inventory.search")} onChange={e=>setFilter(e.target.value)}/>
   </label>:null}
   {!filtered.length?<small>{inventory.repositories.length?t("github.inventory.noMatch"):t("github.inventory.empty")}</small>:null}
   {shown.length?<ul className="github-app-inventory-list">
    {shown.map(repo=><li className="github-app-repo-card" key={repo.fullName}>
     <div className="github-app-repo-heading">
      <FolderGit2 size={18} aria-hidden="true"/>
      <a href={repo.url} target="_blank" rel="noopener noreferrer" title={repo.fullName}
       aria-label={repo.fullName}>{githubRepoTitle(repo.fullName)}</a>
     </div>
     <div className="github-app-repo-meta">
      <small>{githubRepoOwner(repo.fullName)}</small>
      <small className="github-app-visibility">{repo.private?t("github.inventory.private"):t("github.inventory.public")}</small>
      {repo.archived?<small>{t("github.inventory.archived")}</small>:null}
     </div>
     <button type="button" className="secondary compact-button" disabled={loading||issueLoading}
      onClick={()=>void showIssues(repo)}>{t("github.inventory.issues")}</button>
    </li>)}
   </ul>:null}
   {!expanded&&filtered.length>8?
    <button type="button" className="ghost compact-button"
     onClick={()=>setExpanded(true)}>{t("github.inventory.showAll")} ({filtered.length})</button>:null}
   {selected?<div className="github-app-issues">
     <div className="github-app-issues-heading">
      <strong>{t("github.inventory.issues")} · {selectedTitle}</strong>
      <small title={selected}>{githubRepoOwner(selected)}</small>
     </div>
     {issueLoading?<small>{t("github.inventory.loading")}</small>:null}
     {issueError?<small role="alert" className="tone-warn">{t("github.inventory.issuesFailed")}</small>:null}
     {issues?.truncated?<small className="tone-warn">{t("github.inventory.partial")}</small>:null}
     {issues&&!issues.issues.length&&!issueLoading?<small>{t("github.inventory.noIssues")}</small>:null}
     {issues?.issues.length?<ul className="github-app-issue-list">
      {issues.issues.map(issue=><li key={issue.number}>
       <div className="github-app-issue-main">
        <span className="github-app-issue-number">#{issue.number}</span>
        <a href={issue.url} target="_blank" rel="noopener noreferrer">{issue.title}</a>
       </div>
       <button type="button" className="ghost compact-button"
        onClick={()=>{setDraft({issue,note:""});setCopied(false);setCopyError(false);}}>
        <MessageSquareText size={13}/>{t("github.inventory.chatDraft")}
       </button>
      </li>)}
     </ul>:null}
     {issues?.truncated&&page<10?<button type="button" className="secondary compact-button"
      disabled={issueLoading||loading} onClick={()=>void loadMoreIssues()}>
      <RefreshCcw size={13}/>{t("github.inventory.moreIssues")}
     </button>:null}
     {issues?.truncated&&page>=10?<small className="tone-warn">{t("github.inventory.pageLimit")}</small>:null}
     {draft?<div className="github-app-handoff" role="region" aria-label={t("github.inventory.chatDraft")}>
      <div className="github-app-handoff-heading">
       <strong>{t("github.inventory.chatDraft")} · #{draft.issue.number}</strong>
       <button type="button" className="ghost compact-button"
        aria-label={t("github.inventory.cancelDraft")}
        onClick={()=>setDraft(null)}><X size={14}/></button>
      </div>
      <p>{draft.issue.title}</p>
      <label>{t("github.inventory.addNote")}
       <textarea rows={3} maxLength={800} value={draft.note}
        onChange={e=>{setDraft({...draft,note:e.target.value});setCopied(false);}}/>
      </label>
      <div className="github-app-handoff-actions">
       <button className="secondary compact-button" type="button"
        onClick={()=>void copyDraft()}>{copied?<Check size={14}/>:<ClipboardCopy size={14}/>}
        {copied?t("github.inventory.copied"):t("github.inventory.copyDraft")}
       </button>
       {onChatHandoff&&selected?<button type="button" className="secondary compact-button"
        onClick={()=>onChatHandoff({fullName:selected,number:draft.issue.number,
         title:draft.issue.title,note:draft.note})}>
        <MessageSquareText size={14}/>{t("masterChat.openWithDraft")}
       </button>:null}
       <button type="button" className="ghost compact-button" disabled title={t("github.inventory.noAutostart")}>
        {t("github.inventory.autostart")}
       </button>
      </div>
      {copyError?<small className="tone-warn" role="alert">{t("github.inventory.copyError")}</small>:null}
      <small>{t("github.inventory.draftNotice")}</small>
     </div>:null}
   </div>:null}
  </div>:null}
  <small className="github-app-inventory-note">{t("github.inventory.readonly")}</small>
 </section>;
}
