// Created by NMKato Solutions
// Read-only native GitHub App inventory. Credentials remain in the OS keychain.
import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {FolderGit2,RefreshCcw,ShieldCheck} from "lucide-react";
import {useT} from "../i18n";

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
export function GithubAppReadOnlyInventory(){
 const {t}=useT();
 const [inventory,setInventory]=useState<Inventory|null>(null);
 const [issues,setIssues]=useState<OpenIssues|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [issueLoading,setIssueLoading]=useState(false);
 const [error,setError]=useState(false);
 const [issueError,setIssueError]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const request=useRef(0);
 const mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;
  return ()=>{mounted.current=false;request.current++;};
 },[]);
 async function load(){
  const rev=++request.current;
  setLoading(true);setError(false);setIssues(null);setSelected(null);
  try{
   const next=await invoke<Inventory>("github_app_repository_inventory");
   if(!mounted.current||rev!==request.current)return;
   if(next.authSource!=="github_app_user_access_token"||next.remoteWritesPerformed!==false||
      !Array.isArray(next.repositories))throw Error("Invalid native read contract");
   setInventory(next);
  }catch{if(mounted.current&&rev===request.current)setError(true);}
  finally{if(mounted.current&&rev===request.current)setLoading(false);}
 }
 async function showIssues(repo:GithubRepo){
  const rev=++request.current;
  setIssueLoading(true);setIssueError(false);setIssues(null);setSelected(repo.fullName);
  try{
   const result=await invoke<OpenIssues>("github_app_repo_issues",{
    fullName:repo.fullName,installationId:repo.installationId
   });
   if(!mounted.current||rev!==request.current)return;
   if(result.fullName!==repo.fullName||result.remoteWritesPerformed!==false||
      !Array.isArray(result.issues))throw Error("Invalid issue read contract");
   setIssues(result);
  }catch{if(mounted.current&&rev===request.current)setIssueError(true);}
  finally{if(mounted.current&&rev===request.current)setIssueLoading(false);}
 }
 const shown=expanded?inventory?.repositories:inventory?.repositories.slice(0,10);
 return <section className="github-app-inventory" aria-label={t("github.inventory.heading")}>
  <div className="github-app-inventory-head">
   <strong><FolderGit2 size={15}/>{t("github.inventory.heading")}</strong>
   <button type="button" className="secondary compact-button"
    disabled={loading||issueLoading} onClick={()=>void load()}>
    <RefreshCcw size={14}/>{loading?t("github.inventory.loading"):t("github.inventory.load")}
   </button>
  </div>
  {error?<p className="tone-warn" role="alert">{t("github.inventory.failed")}</p>:null}
  {inventory?<div className="github-app-inventory-result">
   <small><ShieldCheck size={13}/>{t("github.inventory.source")} · {inventory.repositories.length} {t("github.inventory.repositories")}</small>
   {inventory.truncated?<small className="tone-warn">{t("github.inventory.partial")}</small>:null}
   {!inventory.repositories.length?<small>{t("github.inventory.empty")}</small>:null}
   {shown?.length?<ul className="github-app-inventory-list">
    {shown.map(repo=><li key={repo.fullName}>
     <div className="github-app-repo-label">
      <a href={repo.url} target="_blank" rel="noopener noreferrer">{repo.fullName}</a>
      <small>{repo.private?t("github.inventory.private"):t("github.inventory.public")}{repo.archived?" · "+t("github.inventory.archived"):""}</small>
     </div>
     <button type="button" className="ghost compact-button" disabled={loading||issueLoading}
      onClick={()=>void showIssues(repo)}>{t("github.inventory.issues")}</button>
    </li>)}
   </ul>:null}
   {!expanded&&inventory.repositories.length>10?
    <button type="button" className="ghost compact-button"
     onClick={()=>setExpanded(true)}>{t("github.inventory.showAll")}</button>:null}
   {selected?<div className="github-app-issues">
     <strong>{t("github.inventory.issues")} · {selected}</strong>
     {issueLoading?<small>{t("github.inventory.loading")}</small>:null}
     {issueError?<small role="alert" className="tone-warn">{t("github.inventory.issuesFailed")}</small>:null}
     {issues?.truncated?<small className="tone-warn">{t("github.inventory.partial")}</small>:null}
     {issues&&!issues.issues.length?<small>{t("github.inventory.noIssues")}</small>:null}
     {issues?.issues.length?<ul className="github-app-issue-list">
      {issues.issues.map(issue=><li key={issue.number}>
       <a href={issue.url} target="_blank" rel="noopener noreferrer">#{issue.number} {issue.title}</a>
      </li>)}
     </ul>:null}
   </div>:null}
  </div>:null}
  <small className="github-app-inventory-note">{t("github.inventory.readonly")}</small>
 </section>;
}
