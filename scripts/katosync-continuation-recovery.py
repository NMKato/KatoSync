#!/usr/bin/env python3
"""KatoSync continuation recovery: read-only status plus gated, dry-run-first recovery steps.

Never reruns, retries, skips or deletes anything on its own. Every mutating subcommand is a
dry-run unless --write is given, and each one refuses (exit 3) when a human gate is missing.

Created by NMKato Solutions
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import sys
from datetime import datetime, timezone

SCHEMA = "katosync.continuation.recovery-status/v1"
DEFAULT_HEARTBEAT_MAX_AGE = 120
DEFAULT_ORPHAN_GRACE = 120
EXIT_OK, EXIT_ATTENTION, EXIT_BLOCKED, EXIT_REFUSED = 0, 1, 2, 3

sys.dont_write_bytecode = True  # kein __pycache__ neben installierten/Repo-Skripten
_WATCHDOG = pathlib.Path(__file__).with_name("katosync-continuation-watchdog.py")
_spec = importlib.util.spec_from_file_location("katosync_continuation_watchdog", _WATCHDOG)
watchdog = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(watchdog)


class Refused(Exception):
    pass


def parse_ts(raw):
    if not isinstance(raw, str) or not raw:
        return None
    try:
        ts = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def read_json(path):
    """Returns (data, error). Missing file -> (None, None)."""
    try:
        return json.loads(path.read_text()), None
    except FileNotFoundError:
        return None, None
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def wave_name(wave, index):
    return wave.get("name", f"wave-{index+1}") if isinstance(wave, dict) else f"wave-{index+1}"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".recovery.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)


class Ctx:
    def __init__(self, args):
        self.root = pathlib.Path(args.control_root).expanduser() if args.control_root else (
            pathlib.Path.home() / "Library" / "Application Support" / "KatoSync" / "control")
        self.cont = self.root / "continuation"
        self.plan_path = self.cont / "plan.json"
        self.state_path = self.cont / "state.json"
        self.candidate_path = self.cont / "plan.candidate.json"
        self.recovery_log = self.cont / "recovery.log"
        self.now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
        if self.now is None:
            raise Refused(f"--now is not an ISO timestamp: {args.now}")
        self.heartbeat_max_age = args.heartbeat_max_age
        self.orphan_grace = args.orphan_grace

    def stamp(self):
        return self.now.strftime("%Y%m%d-%H%M%S")

    def log(self, message):
        self.cont.mkdir(parents=True, exist_ok=True)
        with self.recovery_log.open("a") as f:
            f.write(f"{self.now.isoformat()} {message}\n")


# ---------------------------------------------------------------------------------------------
# status (read-only)
# ---------------------------------------------------------------------------------------------

def inspect_plan(ctx):
    plan, err = read_json(ctx.plan_path)
    info = {"present": ctx.plan_path.exists(), "valid": False, "error": err, "planId": None,
            "enabled": None, "stopOnFailure": None, "waveCount": 0}
    if plan is None:
        return info, None
    if not isinstance(plan, dict) or not isinstance(plan.get("planId"), str) or not plan["planId"]:
        info["error"] = "planId is required"
        return info, None
    if not isinstance(plan.get("waves"), list):
        info["error"] = "waves must be a list"
        return info, None
    info.update(planId=plan["planId"], enabled=bool(plan.get("enabled", False)),
                stopOnFailure=bool(plan.get("stopOnFailure", True)), waveCount=len(plan["waves"]))
    try:
        for i, wave in enumerate(plan["waves"]):
            watchdog.validate_job(wave, i)
    except (ValueError, AttributeError) as exc:
        info["error"] = str(exc)
        return info, None
    info["valid"] = True
    return info, plan


def inspect_daemon(ctx):
    state, err = read_json(ctx.root / "state.json")
    if not isinstance(state, dict):
        return {"status": "missing", "error": err, "heartbeatAt": None, "heartbeatAgeSeconds": None,
                "heartbeatFresh": False, "currentJobId": None}
    hb = parse_ts(state.get("heartbeatAt"))
    age = None if hb is None else round((ctx.now - hb).total_seconds(), 1)
    # Zukunfts-Heartbeats (Uhr-/Schreibfehler) gelten nicht als frisch.
    fresh = age is not None and -ctx.heartbeat_max_age <= age <= ctx.heartbeat_max_age
    return {"status": state.get("status", "unknown"), "error": err, "heartbeatAt": state.get("heartbeatAt"),
            "heartbeatAgeSeconds": age, "heartbeatFresh": fresh, "currentJobId": state.get("currentJobId")}


def classify_running(ctx, daemon, path):
    record, err = read_json(path)
    job_id = record.get("id") if isinstance(record, dict) and isinstance(record.get("id"), str) else path.stem
    record = record if isinstance(record, dict) else {}
    age = round(ctx.now.timestamp() - path.stat().st_mtime, 1)
    if (root_outbox := ctx.root / "outbox" / f"{job_id}.json").exists():
        cls = "finished_not_archived"
    elif daemon["heartbeatFresh"] and daemon["status"] == "busy" and daemon["currentJobId"] == job_id:
        cls = "active"
    elif daemon["heartbeatFresh"] and age < ctx.orphan_grace:
        cls = "pending_claim"
    else:
        cls = "outcome_unknown"
    return {"jobId": job_id, "file": path.name, "classification": cls, "ageSeconds": age,
            "parseError": err, "mode": record.get("mode"), "continuationPlanId": record.get("continuationPlanId"),
            "waveName": record.get("continuationWaveName"), "resultPath": str(root_outbox) if cls == "finished_not_archived" else None}


def build_status(ctx):
    plan_info, plan = inspect_plan(ctx)
    daemon = inspect_daemon(ctx)
    state, state_err = read_json(ctx.state_path)
    state = state if isinstance(state, dict) else None
    inbox = sorted(p.stem for p in (ctx.root / "inbox").glob("*.json"))
    running = [classify_running(ctx, daemon, p) for p in sorted((ctx.root / "running").glob("*.json"))]
    findings = []

    def add(code, severity, message, gate=None, **detail):
        findings.append({"code": code, "severity": severity, "message": message, "gate": gate, **detail})

    if daemon["status"] == "missing":
        add("DAEMON_STATE_MISSING", "error", "Local-Control state.json fehlt/unlesbar; Laufzustand nicht belegbar.")
    elif not daemon["heartbeatFresh"]:
        add("DAEMON_HEARTBEAT_STALE", "error",
            f"Daemon-Heartbeat nicht frisch (Alter {daemon['heartbeatAgeSeconds']}s, max {ctx.heartbeat_max_age}s).")

    if not plan_info["present"]:
        add("PLAN_MISSING", "info", "Kein continuation/plan.json vorhanden.")
    elif not plan_info["valid"]:
        add("PLAN_INVALID", "error", f"plan.json ungueltig: {plan_info['error']}")
    elif not plan_info["enabled"]:
        add("PLAN_DISABLED", "info", f"Plan {plan_info['planId']} ist deaktiviert.")

    cont = None
    if state is not None:
        same = plan is not None and state.get("planId") == plan["planId"]
        cursor = int(state.get("cursor", 0) or 0)
        cont = {"planId": state.get("planId"), "statePlanMatches": same, "status": state.get("status"),
                "cursor": cursor, "activeJobId": state.get("activeJobId"),
                "activeWaveName": state.get("activeWaveName"), "lastResult": state.get("lastResult"),
                "updatedAt": state.get("updatedAt")}
        if plan is not None and not same:
            add("PLAN_STATE_MISMATCH", "info",
                f"state.json gehoert zu {state.get('planId')}, plan.json zu {plan['planId']}; "
                "der Watchdog initialisiert beim naechsten aktiven Tick neu.")
        if same and state.get("status") == "failed":
            wave = plan["waves"][cursor] if cursor < len(plan["waves"]) else {}
            last = state.get("lastResult") or {}
            add("PLAN_FAILED", "error",
                f"Plan {plan['planId']} ist seit {state.get('updatedAt')} fehlgeschlagen bei Welle "
                f"{cursor+1}/{len(plan['waves'])} '{wave_name(wave, cursor)}' (status={last.get('status')}). "
                "Kein automatischer Retry; menschliche Pruefung erforderlich.",
                gate="review_failed_wave", waveIndex=cursor, waveName=wave_name(wave, cursor),
                waveMode=wave.get("mode", "read_only"), failedJobId=last.get("jobId"),
                resultStatus=last.get("status"), resultError=last.get("error"), finishedAt=last.get("finishedAt"))
        elif same and state.get("status") == "completed":
            add("PLAN_COMPLETED", "info", f"Plan {plan['planId']} abgeschlossen.")
        elif same and state.get("status") == "daemon_unavailable":
            add("WATCHDOG_DAEMON_UNAVAILABLE", "warning", "Watchdog hat den Daemon zuletzt als nicht verfuegbar markiert.")
        active = state.get("activeJobId")
        if same and active and not (ctx.root / "outbox" / f"{active}.json").exists() \
                and active not in inbox and not any(r["jobId"] == active for r in running):
            add("CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN", "error",
                f"Watchdog wartet auf Job {active}, der weder in Inbox/Running liegt noch ein Ergebnis hat; "
                "Ergebnis unbekannt, der Plan steht still.",
                gate="confirm_outcome_unknown", jobId=active, waveName=state.get("activeWaveName"), waveIndex=cursor)
    elif state_err:
        add("CONTINUATION_STATE_INVALID", "error", f"continuation/state.json unlesbar: {state_err}")

    for rec in running:
        if rec["classification"] == "outcome_unknown":
            add("RUNNING_OUTCOME_UNKNOWN", "error",
                f"running/{rec['file']} hat keinen lebenden Daemon-Besitzer und kein Ergebnis "
                f"(Alter {rec['ageSeconds']}s). Ausgang unbekannt; blockiert die Queue.",
                gate="confirm_outcome_unknown", jobId=rec["jobId"])
        elif rec["classification"] == "finished_not_archived":
            add("RUNNING_RESULT_NOT_ARCHIVED", "warning",
                f"running/{rec['file']} hat bereits ein Outbox-Ergebnis, wurde aber nicht archiviert.", jobId=rec["jobId"])
    if inbox or running:
        add("QUEUE_OCCUPIED", "info", f"Queue belegt (inbox={len(inbox)}, running={len(running)}); "
            "Watchdog stellt keine neue Welle ein, Swap ist gesperrt.")

    severities = {f["severity"] for f in findings}
    verdict = "blocked" if "error" in severities else "attention" if "warning" in severities else "ok"
    gates = sorted({f["gate"] for f in findings if f["gate"]})
    return {"schema": SCHEMA, "checkedAt": ctx.now.isoformat(), "controlRoot": str(ctx.root), "verdict": verdict,
            "daemon": daemon, "plan": plan_info, "continuation": cont,
            "queue": {"inbox": inbox, "running": running, "occupied": bool(inbox or running)},
            "findings": findings, "humanGates": gates}


def print_status(report):
    print(f"KatoSync continuation: {report['verdict'].upper()}  ({report['checkedAt']})")
    d = report["daemon"]
    print(f"  daemon: status={d['status']} heartbeatAge={d['heartbeatAgeSeconds']}s fresh={d['heartbeatFresh']}")
    p = report["plan"]
    print(f"  plan:   id={p['planId']} enabled={p['enabled']} waves={p['waveCount']} valid={p['valid']}")
    c = report["continuation"] or {}
    print(f"  state:  status={c.get('status')} cursor={c.get('cursor')} activeJob={c.get('activeJobId')}")
    q = report["queue"]
    print(f"  queue:  inbox={len(q['inbox'])} running={len(q['running'])}")
    for f in report["findings"]:
        gate = f"  [gate: {f['gate']}]" if f["gate"] else ""
        print(f"  - {f['severity'].upper():7} {f['code']}: {f['message']}{gate}")
    if report["humanGates"]:
        print("  Human gates required: " + ", ".join(report["humanGates"]))


def cmd_status(ctx, args):
    report = build_status(ctx)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_status(report)
    return {"ok": EXIT_OK, "attention": EXIT_ATTENTION, "blocked": EXIT_BLOCKED}[report["verdict"]]


# ---------------------------------------------------------------------------------------------
# gated recovery steps (dry-run unless --write)
# ---------------------------------------------------------------------------------------------

def emit(action, write, **detail):
    print(json.dumps({"action": action, "dryRun": not write, **detail}, indent=2))


def write_candidate(ctx, args, candidate, action):
    if ctx.candidate_path.exists():
        raise Refused(f"{ctx.candidate_path.name} existiert bereits; erst pruefen und bewusst entfernen/swappen.")
    if args.write:
        atomic_write(ctx.candidate_path, candidate)
        ctx.log(f"{action.upper()} candidate={candidate['planId']} enabled=false")
    emit(action, args.write, candidatePath=str(ctx.candidate_path), candidate=candidate)
    return EXIT_OK


def cmd_prepare_resume(ctx, args):
    report = build_status(ctx)
    plan_info, plan = inspect_plan(ctx)
    if plan is None:
        raise Refused(f"Kein gueltiger aktueller Plan: {plan_info['error'] or 'fehlt'}")
    stopped = {f["code"]: f for f in report["findings"]
               if f["code"] in ("PLAN_FAILED", "CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN")}
    if not stopped:
        raise Refused("Plan ist weder fehlgeschlagen noch mit unbekanntem Ausgang blockiert; kein Resume noetig.")
    source = stopped.get("PLAN_FAILED") or stopped["CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN"]
    index = source["waveIndex"]
    if index >= len(plan["waves"]):
        raise Refused(f"Cursor {index} liegt ausserhalb der {len(plan['waves'])} Wellen.")
    wave = plan["waves"][index]
    name = wave_name(wave, index)
    if args.acknowledge_failed_wave != name:
        raise Refused(f"Gate review_failed_wave: --acknowledge-failed-wave muss exakt '{name}' sein.")
    last = (report["continuation"] or {}).get("lastResult") or {}
    if source["code"] == "PLAN_FAILED" and last.get("waveName") not in (None, name):
        raise Refused(f"lastResult gehoert zu Welle '{last['waveName']}', Cursor zeigt auf '{name}'; manuell klaeren.")
    unknown_job = None
    if source["code"] == "CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN":
        unknown_job = source["jobId"]
        if args.acknowledge_outcome_unknown_job != unknown_job:
            raise Refused(f"Gate confirm_outcome_unknown: --acknowledge-outcome-unknown-job muss '{unknown_job}' sein.")
    mutating = wave.get("mode", "read_only") != "read_only"
    if mutating and not args.acknowledge_mutating_rerun:
        raise Refused(f"Welle '{name}' ist mutierend ({wave.get('mode')}); erneute Ausfuehrung nur mit "
                      "--acknowledge-mutating-rerun nach Pruefung des Arbeitsstands.")
    new_id = args.new_plan_id or f"{plan['planId']}-resume-{ctx.stamp()}"
    if new_id == plan["planId"]:
        raise Refused("Resume braucht eine neue planId.")
    candidate = dict(plan, planId=new_id, enabled=False, stopOnFailure=True, waves=plan["waves"][index:])
    candidate["resume"] = {"resumeOf": plan["planId"], "resumeFromWaveIndex": index, "resumeFromWaveName": name,
                           "originalWaveCount": len(plan["waves"]), "reason": source["code"],
                           "previousJobId": source.get("failedJobId") or unknown_job,
                           "acknowledgedMutatingRerun": bool(mutating), "preparedAt": ctx.now.isoformat()}
    return write_candidate(ctx, args, candidate, "prepare-resume")


def cmd_prepare_plan(ctx, args):
    src = pathlib.Path(args.source).expanduser()
    plan, err = read_json(src)
    if not isinstance(plan, dict):
        raise Refused(f"Neuer Plan nicht lesbar: {err or 'fehlt'}")
    if not isinstance(plan.get("planId"), str) or not plan["planId"] or not isinstance(plan.get("waves"), list):
        raise Refused("Neuer Plan braucht planId und waves-Liste.")
    if plan.get("stopOnFailure", True) is not True:
        raise Refused("stopOnFailure=false wuerde fehlgeschlagene Wellen ueberspringen; nicht erlaubt.")
    try:
        for i, wave in enumerate(plan["waves"]):
            watchdog.validate_job(wave, i)
    except (ValueError, AttributeError) as exc:
        raise Refused(f"Neuer Plan ungueltig: {exc}")
    _, current = inspect_plan(ctx)
    if current is not None and current["planId"] == plan["planId"]:
        raise Refused("Neuer Plan braucht eine andere planId als der aktuelle.")
    return write_candidate(ctx, args, dict(plan, enabled=False, stopOnFailure=True), "prepare-plan")


def cmd_quarantine_running(ctx, args):
    if not args.confirm_outcome_unknown:
        raise Refused("Gate confirm_outcome_unknown: --confirm-outcome-unknown fehlt.")
    report = build_status(ctx)
    rec = next((r for r in report["queue"]["running"] if r["jobId"] == args.job_id), None)
    if rec is None:
        raise Refused(f"Kein running-Eintrag mit jobId {args.job_id}.")
    if rec["classification"] != "outcome_unknown":
        raise Refused(f"running/{rec['file']} ist '{rec['classification']}', nicht outcome_unknown.")
    qdir = ctx.root / "quarantine"
    dst = qdir / rec["file"]
    note_path = qdir / f"{rec['jobId']}.quarantine.json"
    if dst.exists() or note_path.exists():
        raise Refused(f"Quarantaene-Ziel existiert bereits: {dst}")
    note = {"jobId": rec["jobId"], "outcome": "unknown", "quarantinedAt": ctx.now.isoformat(),
            "sourceFile": f"running/{rec['file']}", "record": rec, "daemon": report["daemon"],
            "operatorNote": args.note,
            "policy": "Kein Outbox-Ergebnis erzeugt; Ausgang bleibt unbekannt bis zur menschlichen Klaerung."}
    if args.write:
        atomic_write(note_path, note)
        os.replace(ctx.root / "running" / rec["file"], dst)
        ctx.log(f"QUARANTINE job={rec['jobId']} outcome=unknown dst={dst}")
    emit("quarantine-running", args.write, source=str(ctx.root / "running" / rec["file"]),
         destination=str(dst), note=note)
    return EXIT_OK


def cmd_swap(ctx, args):
    cand, err = read_json(ctx.candidate_path)
    if not isinstance(cand, dict):
        raise Refused(f"Kein Kandidat {ctx.candidate_path.name}: {err or 'fehlt'}")
    if cand.get("stopOnFailure", True) is not True:
        raise Refused("Kandidat mit stopOnFailure=false ist nicht erlaubt.")
    try:
        for i, wave in enumerate(cand.get("waves") or []):
            watchdog.validate_job(wave, i)
    except (ValueError, AttributeError) as exc:
        raise Refused(f"Kandidat ungueltig: {exc}")
    if not cand.get("waves"):
        raise Refused("Kandidat hat keine Wellen.")
    plan_info, _ = inspect_plan(ctx)
    current_id = plan_info["planId"] or "none"
    if args.confirm_current_plan_id != current_id:
        raise Refused(f"--confirm-current-plan-id muss '{current_id}' sein.")
    if cand.get("planId") == plan_info["planId"]:
        raise Refused("Kandidat hat dieselbe planId wie der aktuelle Plan.")

    report = build_status(ctx)
    d = report["daemon"]
    if not d["heartbeatFresh"] or d["status"] != "idle":
        raise Refused(f"Daemon muss frisch und idle sein (status={d['status']}, fresh={d['heartbeatFresh']}).")
    if report["queue"]["occupied"]:
        raise Refused("Queue belegt (inbox/running); Swap gesperrt bis sie leer ist.")
    cont = report["continuation"] or {}
    if cont.get("statePlanMatches") and cont.get("activeJobId"):
        acked = (cand.get("resume") or {}).get("previousJobId")
        unknown = any(f["code"] == "CONTINUATION_ACTIVE_JOB_OUTCOME_UNKNOWN" for f in report["findings"])
        if not (unknown and acked == cont["activeJobId"]):
            raise Refused(f"Continuation hat aktiven Job {cont['activeJobId']}; Swap gesperrt.")

    backup = ctx.cont / "backups" / f"{ctx.stamp()}-{plan_info['planId'] or 'none'}"
    if backup.exists():
        raise Refused(f"Backup-Ziel existiert bereits: {backup}")
    new_plan = dict(cand, enabled=bool(args.enable), swappedAt=ctx.now.isoformat())
    files = [p for p in (ctx.plan_path, ctx.state_path) if p.exists()]
    manifest = {"swappedAt": ctx.now.isoformat(), "previousPlanId": plan_info["planId"], "newPlanId": cand["planId"],
                "enabled": new_plan["enabled"],
                "files": {p.name: sha256(p) for p in files + [ctx.candidate_path]},
                "note": "state.json bleibt unveraendert; der Watchdog initialisiert ihn fuer die neue planId."}
    if args.write:
        backup.mkdir(parents=True)
        for p in files:
            shutil.copy2(p, backup / p.name)
        if any(sha256(backup / p.name) != manifest["files"][p.name] for p in files):
            raise Refused("Backup-Pruefsumme stimmt nicht; Swap abgebrochen, nichts ersetzt.")
        atomic_write(backup / "manifest.json", manifest)
        atomic_write(ctx.plan_path, new_plan)
        os.replace(ctx.candidate_path, backup / ctx.candidate_path.name)
        ctx.log(f"SWAP old={plan_info['planId']} new={cand['planId']} enabled={new_plan['enabled']} backup={backup}")
    emit("swap", args.write, backup=str(backup), manifest=manifest, newPlan=new_plan)
    return EXIT_OK


def main(argv=None):
    parser = argparse.ArgumentParser(description="KatoSync continuation recovery (status + gated recovery).")
    parser.add_argument("--control-root")
    parser.add_argument("--now", help="ISO timestamp for deterministic evaluation (tests/audits)")
    parser.add_argument("--heartbeat-max-age", type=int, default=DEFAULT_HEARTBEAT_MAX_AGE)
    parser.add_argument("--orphan-grace", type=int, default=DEFAULT_ORPHAN_GRACE)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("status", help="read-only report; exit 0 ok, 1 attention, 2 blocked")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("prepare-resume", help="draft a disabled resume plan from the stopped wave")
    p.add_argument("--acknowledge-failed-wave", required=True, metavar="WAVE_NAME")
    p.add_argument("--acknowledge-outcome-unknown-job", metavar="JOB_ID")
    p.add_argument("--acknowledge-mutating-rerun", action="store_true")
    p.add_argument("--new-plan-id")
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_prepare_resume)

    p = sub.add_parser("prepare-plan", help="validate a new plan and stage it as a disabled candidate")
    p.add_argument("--from", dest="source", required=True)
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_prepare_plan)

    p = sub.add_parser("quarantine-running", help="move an outcome_unknown running record to quarantine/")
    p.add_argument("--job-id", required=True)
    p.add_argument("--confirm-outcome-unknown", action="store_true")
    p.add_argument("--note")
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_quarantine_running)

    p = sub.add_parser("swap", help="back up plan/state and atomically activate the candidate")
    p.add_argument("--confirm-current-plan-id", required=True)
    p.add_argument("--enable", action="store_true")
    p.add_argument("--write", action="store_true")
    p.set_defaults(fn=cmd_swap)

    args = parser.parse_args(argv)
    try:
        return args.fn(Ctx(args), args)
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return EXIT_REFUSED


if __name__ == "__main__":
    raise SystemExit(main())
