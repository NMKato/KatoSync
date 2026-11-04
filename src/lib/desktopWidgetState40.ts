// NMKato Solutions · 4.0 Desktop-Widget — read-only projection from verified app state.
// The UI must never infer a running job from stale or unverified cloud presence.
import type {AgentSyncState} from "../types.ts";

export interface DesktopWidgetReport {
  signedIn:boolean;
  activeJobs:number;
  queuedJobs:number;
  needsAttention:number;
  taskTitle:string|null;
  localModelRunning:boolean;
}
export interface DesktopWidgetSnapshot extends DesktopWidgetReport {
  updatedAtMs:number;
  stale:boolean;
}
export const WIDGET_STALE_MS=90_000;
export function safeWidgetTaskTitle(value:string|null|undefined):string|null {
  if(!value)return null;
  const normalized=value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim();
  if(!normalized || normalized.length>90 ||
     /(?:\/Users\/|[A-Za-z]:\\|bearer\s|api.?key|secret|token=|password|@)/i.test(normalized))
    return null;
  return normalized;
}
export function projectDesktopWidget(
  state:Pick<AgentSyncState,"jobs">,
  signedIn:boolean,
  localModelRunning:boolean
):DesktopWidgetReport {
  if(!signedIn)return {signedIn:false,activeJobs:0,queuedJobs:0,needsAttention:0,taskTitle:null,localModelRunning:false};
  const running=state.jobs.filter(j=>j.status==="running");
  return {
    signedIn:true,
    activeJobs:running.length,
    queuedJobs:state.jobs.filter(j=>j.status==="queued").length,
    needsAttention:state.jobs.filter(j=>j.status==="blocked"||j.status==="failed").length,
    taskTitle:safeWidgetTaskTitle(running[0]?.task),
    localModelRunning:Boolean(localModelRunning)
  };
}
export function widgetSnapshotFresh(snapshot:DesktopWidgetSnapshot|null,nowMs:number):boolean {
  return Boolean(snapshot&&snapshot.signedIn&&!snapshot.stale&&
    Number.isSafeInteger(snapshot.updatedAtMs)&&nowMs>=snapshot.updatedAtMs &&
    nowMs-snapshot.updatedAtMs<=WIDGET_STALE_MS);
}
