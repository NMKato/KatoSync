#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import time
import uuid
from datetime import datetime, timezone

DEFAULT_POLL_SECONDS = 1.0
DEFAULT_HEARTBEAT_MAX_AGE = 120

def now_iso():
    return datetime.now().astimezone().isoformat()

def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)

def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default
    except Exception:
        return default

def append_log(path, message):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(f"{now_iso()} {message}\n")

def heartbeat_fresh(control_state, max_age):
    raw = (control_state or {}).get("heartbeatAt")
    if not raw:
        return False
    try:
        ts = datetime.fromisoformat(raw)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - ts.astimezone(timezone.utc)
        return age.total_seconds() <= max_age
    except Exception:
        return False

def validate_job(job, index):
    required = ("cwd", "command")
    for key in required:
        if not isinstance(job.get(key), str) or not job[key].strip():
            raise ValueError(f"wave {index}: missing {key}")
    mode = job.get("mode", "read_only")
    if mode not in ("read_only", "workspace_write"):
        raise ValueError(f"wave {index}: invalid mode {mode}")
    args = job.get("args", [])
    if not isinstance(args, list) or not all(isinstance(x, str) for x in args):
        raise ValueError(f"wave {index}: args must be a string list")

def make_job(plan, index, wave):
    validate_job(wave, index)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    plan_slug = "".join(c if c.isalnum() or c in "-_." else "-" for c in plan["planId"])[:32]
    job_id = f"{stamp}-{plan_slug}-w{index+1}-{uuid.uuid4().hex[:8]}"
    return {
        "id": job_id,
        "cwd": str(pathlib.Path(wave["cwd"]).expanduser().resolve()),
        "command": wave["command"],
        "args": wave.get("args", []),
        "mode": wave.get("mode", "read_only"),
        "timeoutSeconds": int(wave.get("timeoutSeconds", 900)),
        "requireCleanGit": bool(wave.get("requireCleanGit", False)),
        "laneId": wave.get("laneId", "default"),
        "projectId": wave.get("projectId"),
        "resourceLocks": wave.get("resourceLocks", []),
        "dedupeKey": wave.get("dedupeKey"),
        "continuationPlanId": plan["planId"],
        "continuationWaveIndex": index,
        "continuationWaveName": wave.get("name", f"wave-{index+1}"),
    }

def initialize_state(plan):
    return {
        "planId": plan["planId"],
        "status": "running",
        "cursor": 0,
        "activeJobId": None,
        "activeWaveName": None,
        "lastResult": None,
        "updatedAt": now_iso(),
    }

def tick(root, plan_path, state_path, log_path, heartbeat_max_age):
    plan = load_json(plan_path)
    if not isinstance(plan, dict):
        return "no_plan"
    plan_id = plan.get("planId")
    waves = plan.get("waves")
    if not isinstance(plan_id, str) or not plan_id:
        raise ValueError("planId is required")
    if not isinstance(waves, list):
        raise ValueError("waves must be a list")
    if not plan.get("enabled", False):
        state = load_json(state_path, initialize_state(plan))
        state["status"] = "disabled"
        state["updatedAt"] = now_iso()
        atomic_json(state_path, state)
        return "disabled"

    state = load_json(state_path)
    if not isinstance(state, dict) or state.get("planId") != plan_id:
        state = initialize_state(plan)
        atomic_json(state_path, state)
        append_log(log_path, f"PLAN_START id={plan_id} waves={len(waves)}")

    if state.get("status") in ("failed", "completed"):
        return state["status"]

    active = state.get("activeJobId")
    if active:
        result_path = root / "outbox" / f"{active}.json"
        result = load_json(result_path)
        if isinstance(result, dict):
            status = result.get("status", "failed")
            state["lastResult"] = {
                "jobId": active,
                "waveName": state.get("activeWaveName"),
                "status": status,
                "finishedAt": result.get("finishedAt"),
                "error": result.get("error"),
            }
            state["activeJobId"] = None
            state["activeWaveName"] = None
            if status == "completed":
                state["cursor"] = int(state.get("cursor", 0)) + 1
                state["status"] = "running"
                append_log(log_path, f"WAVE_DONE job={active} status=completed")
            elif plan.get("stopOnFailure", True):
                state["status"] = "failed"
                append_log(log_path, f"PLAN_STOP job={active} status={status}")
            else:
                state["cursor"] = int(state.get("cursor", 0)) + 1
                state["status"] = "running"
                append_log(log_path, f"WAVE_SKIP job={active} status={status}")
            state["updatedAt"] = now_iso()
            atomic_json(state_path, state)
        else:
            return "waiting_active"

    if state.get("status") == "failed":
        return "failed"

    cursor = int(state.get("cursor", 0))
    if cursor >= len(waves):
        state["status"] = "completed"
        state["updatedAt"] = now_iso()
        atomic_json(state_path, state)
        append_log(log_path, f"PLAN_DONE id={plan_id}")
        return "completed"

    control_state = load_json(root / "state.json", {})
    if control_state.get("status") != "idle":
        return "daemon_busy"
    if not heartbeat_fresh(control_state, heartbeat_max_age):
        state["status"] = "daemon_unavailable"
        state["updatedAt"] = now_iso()
        atomic_json(state_path, state)
        return "daemon_stale"

    inbox = root / "inbox"
    running = root / "running"
    if any(inbox.glob("*.json")) or any(running.glob("*.json")):
        return "queue_busy"

    wave = waves[cursor]
    job = make_job(plan, cursor, wave)
    tmp = inbox / f"{job['id']}.tmp"
    dst = inbox / f"{job['id']}.json"
    atomic_json(tmp, job)
    os.replace(tmp, dst)
    state["status"] = "running"
    state["activeJobId"] = job["id"]
    state["activeWaveName"] = job["continuationWaveName"]
    state["updatedAt"] = now_iso()
    atomic_json(state_path, state)
    append_log(log_path, f"WAVE_START index={cursor+1}/{len(waves)} name={job['continuationWaveName']} job={job['id']}")
    return "submitted"

def main():
    parser = argparse.ArgumentParser(description="KatoSync local continuation watchdog")
    parser.add_argument("--control-root")
    parser.add_argument("--plan")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll", type=float, default=DEFAULT_POLL_SECONDS)
    parser.add_argument("--heartbeat-max-age", type=int, default=DEFAULT_HEARTBEAT_MAX_AGE)
    args = parser.parse_args()

    root = pathlib.Path(args.control_root).expanduser() if args.control_root else pathlib.Path.home() / "Library" / "Application Support" / "KatoSync" / "control"
    continuation = root / "continuation"
    plan_path = pathlib.Path(args.plan).expanduser() if args.plan else continuation / "plan.json"
    state_path = continuation / "state.json"
    log_path = continuation / "watchdog.log"
    for name in ("inbox", "running", "outbox", "continuation"):
        (root / name).mkdir(parents=True, exist_ok=True)

    append_log(log_path, f"WATCHDOG_START pid={os.getpid()}")
    while True:
        try:
            tick(root, plan_path, state_path, log_path, args.heartbeat_max_age)
        except Exception as exc:
            append_log(log_path, f"ERROR {type(exc).__name__}: {exc}")
        if args.once:
            return 0
        time.sleep(max(0.25, args.poll))

if __name__ == "__main__":
    raise SystemExit(main())
