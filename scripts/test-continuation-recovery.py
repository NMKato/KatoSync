#!/usr/bin/env python3
# Created by NMKato Solutions
import json, os, pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).parent
SCRIPT = HERE / "katosync-continuation-recovery.py"
WATCHDOG = HERE / "katosync-continuation-watchdog.py"
NOW = "2026-10-08T10:00:00+00:00"
NOW_EPOCH = 1791453600  # NOW als Unix-Zeit (mtime-Basis der running-Records)

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")

def run(root, *args, now=NOW):
    p = subprocess.run([sys.executable, str(SCRIPT), "--control-root", str(root), "--now", now, *args],
                       capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def status(root, **kw):
    code, out, _ = run(root, "status", "--json", **kw)
    return code, json.loads(out)

def codes(report):
    return [f["code"] for f in report["findings"]]

def snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}

def control(td, daemon_status="idle", heartbeat=NOW, current=None):
    root = pathlib.Path(td) / "control"
    for n in ("inbox", "running", "outbox", "archive", "continuation"):
        (root / n).mkdir(parents=True, exist_ok=True)
    write(root / "state.json", {"daemonPid": 1, "status": daemon_status, "currentJobId": current,
                                "heartbeatAt": heartbeat})
    return root

def failed_plan(root, td):
    write(root / "continuation" / "plan.json", {
        "planId": "overnight-test-v1", "enabled": True, "stopOnFailure": True,
        "waves": [
            {"name": "inventory", "cwd": td, "command": "git", "args": ["status"], "mode": "read_only"},
            {"name": "navigation", "cwd": td, "command": "npm", "args": ["run", "build"], "mode": "workspace_write"},
            {"name": "report", "cwd": td, "command": "git", "args": ["log"], "mode": "read_only"},
        ]})
    write(root / "continuation" / "state.json", {
        "planId": "overnight-test-v1", "status": "failed", "cursor": 1, "activeJobId": None,
        "activeWaveName": None, "updatedAt": "2026-10-02T23:10:00+02:00",
        "lastResult": {"jobId": "job-nav", "waveName": "navigation", "status": "failed",
                       "finishedAt": "2026-10-02T23:10:00+02:00", "error": "exit=1"}})

def orphan(root, job_id="20261006-031500-orphan", age=2 * 86400):
    path = root / "running" / f"{job_id}.json"
    write(path, {"id": job_id, "cwd": "/tmp", "command": "git", "mode": "workspace_write",
                 "continuationPlanId": "other-plan", "continuationWaveName": "w1"})
    os.utime(path, (NOW_EPOCH - age, NOW_EPOCH - age))
    return path

# 1) Fehlgeschlagener Plan wird sichtbar gemeldet; status ist strikt read-only.
with tempfile.TemporaryDirectory() as td:
    root = control(td); failed_plan(root, td)
    before = snapshot(root)
    code, rep = status(root)
    assert code == 2 and rep["verdict"] == "blocked", rep
    f = next(f for f in rep["findings"] if f["code"] == "PLAN_FAILED")
    assert f["waveName"] == "navigation" and f["waveMode"] == "workspace_write" and f["gate"] == "review_failed_wave"
    assert rep["humanGates"] == ["review_failed_wave"]
    code, out, _ = run(root, "status")
    assert code == 2 and "PLAN_FAILED" in out and "review_failed_wave" in out
    assert snapshot(root) == before, "status must not write anything"
    print("RECOVERY_FAILED_PLAN_VISIBLE=PASS")

# 2) Verwaister running-Record -> outcome_unknown + Gate; Quarantaene nur mit Bestaetigung, ohne Ergebnis.
with tempfile.TemporaryDirectory() as td:
    root = control(td); src = orphan(root)
    code, rep = status(root)
    assert code == 2 and "RUNNING_OUTCOME_UNKNOWN" in codes(rep) and "QUEUE_OCCUPIED" in codes(rep)
    assert rep["queue"]["running"][0]["classification"] == "outcome_unknown"
    assert "confirm_outcome_unknown" in rep["humanGates"]
    before = snapshot(root)
    code, _, err = run(root, "quarantine-running", "--job-id", "20261006-031500-orphan")
    assert code == 3 and "confirm_outcome_unknown" in err
    code, _, _ = run(root, "quarantine-running", "--job-id", "20261006-031500-orphan", "--confirm-outcome-unknown")
    assert code == 0 and snapshot(root) == before, "dry-run must not write"
    code, _, _ = run(root, "quarantine-running", "--job-id", "20261006-031500-orphan",
                     "--confirm-outcome-unknown", "--note", "operator review", "--write")
    assert code == 0 and not src.exists()
    assert (root / "quarantine" / src.name).read_bytes() == before[f"running/{src.name}"]
    note = json.loads((root / "quarantine" / "20261006-031500-orphan.quarantine.json").read_text())
    assert note["outcome"] == "unknown"
    assert not list((root / "outbox").glob("*")), "no success/failure may be invented"
    code, rep = status(root)
    assert code == 0 and rep["verdict"] == "ok", rep
    print("RECOVERY_ORPHAN_OUTCOME_UNKNOWN=PASS")

# 3) Frischer Heartbeat: gesunder Lauf ist ok; lebender busy-Job ist active, nicht verwaist.
with tempfile.TemporaryDirectory() as td:
    root = control(td)
    write(root / "continuation" / "plan.json", {"planId": "p", "enabled": True, "stopOnFailure": True,
          "waves": [{"name": "a", "cwd": td, "command": "git"}]})
    write(root / "continuation" / "state.json", {"planId": "p", "status": "running", "cursor": 0})
    code, rep = status(root)
    assert code == 0 and rep["verdict"] == "ok" and rep["daemon"]["heartbeatFresh"], rep
    root = control(td, daemon_status="busy", current="job-live")
    orphan(root, "job-live")
    code, rep = status(root)
    assert rep["queue"]["running"][0]["classification"] == "active" and "RUNNING_OUTCOME_UNKNOWN" not in codes(rep)
    # Frisch geclaimter Record innerhalb der Grace-Zeit ist kein Waisenkind.
    (root / "running" / "job-live.json").unlink()
    root = control(td); orphan(root, "job-new", age=5)
    code, rep = status(root)
    assert rep["queue"]["running"][0]["classification"] == "pending_claim"
    # Stale Heartbeat: derselbe Record ist outcome_unknown, Daemon blockiert.
    code, rep = status(root, now="2026-10-08T10:30:00+00:00")
    assert "DAEMON_HEARTBEAT_STALE" in codes(rep) and rep["queue"]["running"][0]["classification"] == "outcome_unknown"
    print("RECOVERY_FRESH_HEARTBEAT=PASS")

# 4) Reviewter Resume: Gates, Dry-run, Kandidat deaktiviert, Backup + atomarer Swap, kein Auto-Rerun.
with tempfile.TemporaryDirectory() as td:
    root = control(td); failed_plan(root, td)
    cont = root / "continuation"
    plan_bytes, state_bytes = (cont / "plan.json").read_bytes(), (cont / "state.json").read_bytes()
    assert run(root, "prepare-resume", "--acknowledge-failed-wave", "inventory")[0] == 3
    code, _, err = run(root, "prepare-resume", "--acknowledge-failed-wave", "navigation")
    assert code == 3 and "mutierend" in err
    code, out, _ = run(root, "prepare-resume", "--acknowledge-failed-wave", "navigation", "--acknowledge-mutating-rerun")
    assert code == 0 and not (cont / "plan.candidate.json").exists()
    code, _, _ = run(root, "prepare-resume", "--acknowledge-failed-wave", "navigation",
                     "--acknowledge-mutating-rerun", "--write")
    cand = json.loads((cont / "plan.candidate.json").read_text())
    assert code == 0 and cand["enabled"] is False and cand["stopOnFailure"] is True
    assert [w["name"] for w in cand["waves"]] == ["navigation", "report"], "failed wave must not be skipped"
    assert cand["resume"]["resumeOf"] == "overnight-test-v1" and cand["resume"]["previousJobId"] == "job-nav"
    assert (cont / "plan.json").read_bytes() == plan_bytes, "prepare must not touch the active plan"
    code, _, err = run(root, "swap", "--confirm-current-plan-id", "wrong")
    assert code == 3 and "overnight-test-v1" in err
    code, _, _ = run(root, "swap", "--confirm-current-plan-id", "overnight-test-v1")
    assert code == 0 and (cont / "plan.json").read_bytes() == plan_bytes and not (cont / "backups").exists()
    code, out, _ = run(root, "swap", "--confirm-current-plan-id", "overnight-test-v1", "--write")
    assert code == 0, out
    backup = next((cont / "backups").iterdir())
    assert (backup / "plan.json").read_bytes() == plan_bytes and (backup / "state.json").read_bytes() == state_bytes
    assert (backup / "plan.candidate.json").exists() and not (cont / "plan.candidate.json").exists()
    manifest = json.loads((backup / "manifest.json").read_text())
    assert manifest["previousPlanId"] == "overnight-test-v1" and set(manifest["files"]) == {"plan.json", "state.json", "plan.candidate.json"}
    new_plan = json.loads((cont / "plan.json").read_text())
    assert new_plan["planId"] == cand["planId"] and new_plan["enabled"] is False
    assert (cont / "state.json").read_bytes() == state_bytes, "runtime state is left to the watchdog"
    # Swapped plan bleibt deaktiviert: der Watchdog stellt nichts ein.
    subprocess.run([sys.executable, str(WATCHDOG), "--control-root", str(root), "--once"], check=True)
    assert not list((root / "inbox").glob("*.json"))
    print("RECOVERY_RESUME_BACKUP_SWAP=PASS")

# 5) Bereits belegte Queue / stale Daemon sperren den Swap.
with tempfile.TemporaryDirectory() as td:
    root = control(td); failed_plan(root, td)
    run(root, "prepare-resume", "--acknowledge-failed-wave", "navigation", "--acknowledge-mutating-rerun", "--write")
    write(root / "inbox" / "foreign-job.json", {"id": "foreign-job", "cwd": td, "command": "git"})
    before = snapshot(root)
    code, _, err = run(root, "swap", "--confirm-current-plan-id", "overnight-test-v1", "--write")
    assert code == 3 and "Queue belegt" in err and snapshot(root) == before
    (root / "inbox" / "foreign-job.json").unlink()
    code, _, err = run(root, "swap", "--confirm-current-plan-id", "overnight-test-v1", "--write",
                       now="2026-10-08T11:00:00+00:00")
    assert code == 3 and "Daemon" in err
    # Zweiter Kandidat ueberschreibt keinen bereits vorbereiteten.
    assert run(root, "prepare-resume", "--acknowledge-failed-wave", "navigation", "--acknowledge-mutating-rerun")[0] == 3
    print("RECOVERY_OCCUPIED_QUEUE_BLOCKS=PASS")

# 6) Watchdog wartet auf einen verschwundenen aktiven Job: Stillstand sichtbar, Resume nur mit Job-Bestaetigung.
with tempfile.TemporaryDirectory() as td:
    root = control(td); failed_plan(root, td)
    write(root / "continuation" / "state.json", {"planId": "overnight-test-v1", "status": "running", "cursor": 2,
          "activeJobId": "job-gone", "activeWaveName": "report", "updatedAt": "2026-10-06T03:00:00+02:00"})
    code, rep = status(root)
    assert code == 2 and "CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN" in codes(rep)
    assert run(root, "prepare-resume", "--acknowledge-failed-wave", "report")[0] == 3
    code, _, _ = run(root, "prepare-resume", "--acknowledge-failed-wave", "report",
                     "--acknowledge-outcome-unknown-job", "job-gone", "--write")
    assert code == 0
    code, out, _ = run(root, "swap", "--confirm-current-plan-id", "overnight-test-v1")
    assert code == 0, out
    print("RECOVERY_ACTIVE_JOB_STALL_VISIBLE=PASS")

# 7) Neuer Plan: stopOnFailure=false und gleiche planId werden abgelehnt.
with tempfile.TemporaryDirectory() as td:
    root = control(td); failed_plan(root, td)
    src = pathlib.Path(td) / "new.json"
    write(src, {"planId": "next", "enabled": True, "stopOnFailure": False, "waves": [{"cwd": td, "command": "git"}]})
    assert run(root, "prepare-plan", "--from", str(src))[0] == 3
    write(src, {"planId": "overnight-test-v1", "waves": [{"cwd": td, "command": "git"}]})
    assert run(root, "prepare-plan", "--from", str(src))[0] == 3
    write(src, {"planId": "next", "enabled": True, "waves": [{"cwd": td, "command": "git"}]})
    code, _, _ = run(root, "prepare-plan", "--from", str(src), "--write")
    assert code == 0 and json.loads((root / "continuation" / "plan.candidate.json").read_text())["enabled"] is False
    print("RECOVERY_NEW_PLAN_GATED=PASS")
