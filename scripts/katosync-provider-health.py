#!/usr/bin/env python3
import json, pathlib, subprocess, time
from datetime import datetime

home=pathlib.Path.home()
control=home/"Library/Application Support/KatoSync/control"
queue=control/"rdc-fallback"
router=control/"bin/katosync-agent-router.py"
state_path=control/"provider-health.json"
log_path=control/"provider-health.log"
queue.mkdir(parents=True,exist_ok=True)

def now_iso():
    return datetime.now().astimezone().isoformat()

def log(message):
    line=f"{now_iso()} {message}"
    with log_path.open("a") as f: f.write(line+"\n")
    print(line,flush=True)

def run(cmd,timeout=12):
    try:
        p=subprocess.run(cmd,text=True,capture_output=True,timeout=timeout,check=False)
        return p.returncode,(p.stdout or "")+(p.stderr or "")
    except Exception as exc:
        return 99,str(exc)
def provider_status():
    status={}
    codex=home/".local/bin/codex"
    if codex.exists():
        rc,out=run([str(codex),"login","status"])
        status["codex"]={"installed":True,"authenticated":rc==0 and "logged in" in out.lower()}
    else:
        status["codex"]={"installed":False,"authenticated":False}

    claude=home/".local/bin/claude"
    if claude.exists():
        rc,out=run([str(claude),"auth","status"])
        authenticated='"loggedIn": true' in out or '"loggedIn":true' in out
        status["claude"]={"installed":True,"authenticated":authenticated}
    else:
        status["claude"]={"installed":False,"authenticated":False}
    return status

def control_idle():
    p=control/"state.json"
    if not p.exists(): return False
    try:
        data=json.loads(p.read_text())
        return data.get("status")=="idle" and not data.get("currentJobId")
    except Exception:
        return False
def waiting_items():
    items=[]
    for p in sorted(queue.glob("*.json")):
        try:
            data=json.loads(p.read_text())
        except Exception:
            continue
        if data.get("status") in {"waiting","provider_ready"}:
            items.append((p,data))
    return items

def write_health(providers,waiting,busy_reason=None):
    payload={
        "checkedAt":now_iso(),
        "providers":providers,
        "waitingFallbackJobs":len(waiting),
        "controlIdle":control_idle(),
        "note":busy_reason,
    }
    state_path.write_text(json.dumps(payload,indent=2)+"\n")

providers=provider_status()
waiting=waiting_items()
if not waiting:
    write_health(providers,waiting)
    log(f"HEALTH codex={providers['codex']['authenticated']} claude={providers['claude']['authenticated']} queue=0")
    raise SystemExit(0)
if not control_idle():
    write_health(providers,waiting,"control_busy")
    log(f"SKIP control_busy queue={len(waiting)}")
    raise SystemExit(0)

if not any(p["authenticated"] for p in providers.values()):
    write_health(providers,waiting,"no_authenticated_provider")
    log(f"SKIP no_authenticated_provider queue={len(waiting)}")
    raise SystemExit(0)

path,item=waiting[0]
repo=item.get("repo")
prompt=item.get("promptFile")
name=item.get("name")
branch=item.get("branch")
timeout=int(item.get("timeout") or 7200)
if not all([repo,prompt,name,branch]):
    item["status"]="failed"
    item["reason"]="invalid_fallback_item"
    item["failedAt"]=now_iso()
    path.write_text(json.dumps(item,indent=2)+"\n")
    log(f"FAIL invalid_item path={path}")
    raise SystemExit(2)
log(f"RESUME name={name} branch={branch}")
cmd=[
    "python3",str(router),
    "--repo",repo,
    "--prompt-file",prompt,
    "--name",name,
    "--timeout",str(timeout),
    "--resume-from-queue",str(path),
]
try:
    result=subprocess.run(cmd,text=True,timeout=timeout+60,check=False)
    rc=result.returncode
except subprocess.TimeoutExpired:
    rc=124

if rc not in {0,75}:
    try:
        latest=json.loads(path.read_text())
        latest["status"]="failed"
        latest["reason"]="provider_resume_failed"
        latest["failedAt"]=now_iso()
        latest["exitCode"]=rc
        path.write_text(json.dumps(latest,indent=2)+"\n")
    except Exception:
        pass
log(f"RESUME_DONE name={name} exit={rc}")
write_health(provider_status(),waiting_items())
raise SystemExit(0 if rc in {0,75} else rc)
