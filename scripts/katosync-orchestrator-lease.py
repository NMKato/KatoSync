#!/usr/bin/env python3
# Created by NMKato Solutions
"""Heartbeat-/Lease-Vertrag fuer Remote Orchestrator + RDC (KatoSync Local-Control-Root).

Der per Remote Desktop Commander angebundene Orchestrator ruft dieses Skript strukturiert auf
(argv, keine Shell). Es schreibt nur:
  - <control>/remote-orchestrator.json  (Lease/Heartbeat, Schema 1, Modus 0600, atomar)
  - <control>/rdc-fallback/<item>.json  (claim/release eines wartenden Router-Jobs)

`claim` setzt einen wartenden Router-Job auf `orchestrator_active`. Der Provider-Health-Scheduler
nimmt nur `waiting`/`provider_ready` wieder auf - damit gibt es nach der Uebergabe genau einen
Writer. `release` gibt den Job wieder frei (oder schliesst ihn ab). Tokens/Prompts werden nie gelesen.
"""
import argparse
import json
import os
import pathlib
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone

SCHEMA = 1
MIN_LEASE, MAX_LEASE, DEFAULT_LEASE = 30, 1800, 300
HEARTBEAT_FRESH = 300
MAX_TEXT = 160
MAX_FILE = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
OPEN = {"waiting", "provider_ready"}


def now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.isoformat()


def parse(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def fail(message, code=2):
    print(f"KATOSYNC_ORCHESTRATOR_LEASE_ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def ident(value, label):
    if value is None:
        return None
    if not ID.match(value):
        fail(f"invalid {label}")
    return value


def text(value):
    if value is None:
        return None
    cleaned = " ".join(str(value).split())
    home = str(pathlib.Path.home())
    if len(home) > 1:
        cleaned = cleaned.replace(home, "~")
    return cleaned[:MAX_TEXT] or None


def read_json(path):
    try:
        if path.stat().st_size > MAX_FILE:
            return None
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(json.dumps(data, indent=2) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def control_root(args):
    root = pathlib.Path(args.control_root).expanduser() if args.control_root else (
        pathlib.Path.home() / "Library" / "Application Support" / "KatoSync" / "control"
    )
    if not root.is_dir():
        fail("control root does not exist")
    return root.resolve()


def lease_state(lease, at):
    if not isinstance(lease, dict) or lease.get("schemaVersion") != SCHEMA:
        return "unavailable"
    if lease.get("state") == "detached":
        return "detached"
    heartbeat = parse(lease.get("heartbeatAt"))
    seconds = max(MIN_LEASE, min(MAX_LEASE, int(lease.get("leaseSeconds") or DEFAULT_LEASE)))
    if not heartbeat or at >= heartbeat + timedelta(seconds=seconds) or (at - heartbeat).total_seconds() > HEARTBEAT_FRESH:
        return "stale"
    return "working" if lease.get("state") == "working" else "attached"


def find_item(root, item_id):
    queue = (root / "rdc-fallback").resolve()
    for path in sorted(queue.glob("*.json")):
        if not path.resolve().is_relative_to(queue):
            continue
        data = read_json(path)
        if isinstance(data, dict) and item_id in (data.get("id"), data.get("name")):
            return path, data
    fail("fallback item not found", 3)


def resume_in_flight(root, name):
    """RESUME name=X ohne spaeteres RESUME_DONE im Provider-Health-Log."""
    log = root / "provider-health.log"
    try:
        with log.open("rb") as handle:
            handle.seek(max(0, log.stat().st_size - MAX_FILE))
            lines = handle.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return False
    open_name = None
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        found = next((part[5:] for part in parts[2:] if part.startswith("name=")), None)
        if parts[1] == "RESUME" and found:
            open_name = found
        elif parts[1] == "RESUME_DONE" and found == open_name:
            open_name = None
    return open_name == name


def heartbeat(args, root, state=None, job=None):
    path = root / "remote-orchestrator.json"
    current = read_json(path) or {}
    at = now()
    lease = max(MIN_LEASE, min(MAX_LEASE, args.lease_seconds))
    same_session = current.get("sessionId") == args.session
    data = {
        "schemaVersion": SCHEMA,
        "sessionId": args.session,
        "state": state or args.state,
        "attachedAt": current.get("attachedAt") if same_session and current.get("attachedAt") else iso(at),
        "heartbeatAt": iso(at),
        "leaseSeconds": lease,
        "transport": {"kind": "rdc", "heartbeatAt": iso(at)},
        "jobId": job if job is not None else ident(getattr(args, "job", None), "job"),
        "device": text(getattr(args, "device", None)) or (current.get("device") if same_session else None),
        "model": text(getattr(args, "model", None)) or (current.get("model") if same_session else None),
        "activity": text(getattr(args, "activity", None)),
        "nextStep": text(getattr(args, "next_step", None)),
    }
    write_json(path, {key: value for key, value in data.items() if value is not None})
    return data


def cmd_heartbeat(args, root):
    data = heartbeat(args, root)
    print(json.dumps({"state": data["state"], "heartbeatAt": data["heartbeatAt"], "leaseSeconds": data["leaseSeconds"]}))


def cmd_detach(args, root):
    path = root / "remote-orchestrator.json"
    current = read_json(path)
    if not isinstance(current, dict) or current.get("sessionId") != args.session:
        fail("no lease for this session", 4)
    current.update({"state": "detached", "heartbeatAt": iso(now()), "jobId": None})
    write_json(path, {key: value for key, value in current.items() if value is not None})
    print("detached")


def cmd_claim(args, root):
    path, item = find_item(root, args.item)
    lease = read_json(root / "remote-orchestrator.json")
    at = now()
    if item.get("status") not in OPEN:
        fail(f"item is not waiting (status={item.get('status')})", 5)
    if resume_in_flight(root, item.get("name")):
        fail("provider health scheduler is already resuming this item", 6)
    if lease_state(lease, at) in ("attached", "working") and lease.get("sessionId") != args.session and lease.get("jobId"):
        fail("another orchestrator session holds an active lease", 7)
    seconds = max(MIN_LEASE, min(MAX_LEASE, args.lease_seconds))
    item.update({
        "status": "orchestrator_active",
        "leaseOwner": args.session,
        "leaseExpiresAt": iso(at + timedelta(seconds=seconds)),
        "updatedAt": iso(at),
    })
    write_json(path, item)
    heartbeat(args, root, state="working", job=item.get("id"))
    print(f"claimed {item.get('id')}")


def cmd_release(args, root):
    path, item = find_item(root, args.item)
    at = now()
    expires = parse(item.get("leaseExpiresAt"))
    owned = item.get("leaseOwner") == args.session
    expired = args.if_expired and (expires is None or at >= expires)
    if item.get("status") != "orchestrator_active" or not (owned or expired):
        fail("item is not claimed by this session (use --if-expired for stale leases)", 8)
    item.pop("leaseOwner", None)
    item.pop("leaseExpiresAt", None)
    item.update({"status": args.status, "updatedAt": iso(at)})
    if args.status == "completed":
        item["completedAt"] = iso(at)
    elif args.status == "failed":
        item["failedAt"] = iso(at)
    if args.reason:
        item["reason"] = ident(args.reason, "reason")
    write_json(path, item)
    lease = read_json(root / "remote-orchestrator.json")
    if isinstance(lease, dict) and lease.get("sessionId") == args.session and lease.get("jobId") in (item.get("id"), item.get("name")):
        heartbeat(args, root, state="attached", job=None)
    print(f"released {item.get('id')} -> {args.status}")


def cmd_status(args, root):
    state = lease_state(read_json(root / "remote-orchestrator.json"), now())
    print(state)
    raise SystemExit(0 if state in ("attached", "working") else 1)


def main(argv=None):
    parser = argparse.ArgumentParser(description="KatoSync Remote Orchestrator + RDC lease")
    parser.add_argument("--control-root")
    sub = parser.add_subparsers(dest="command", required=True)

    def session_args(command):
        command.add_argument("--session", required=True)
        command.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE)
        command.add_argument("--device")
        command.add_argument("--model")
        command.add_argument("--activity")
        command.add_argument("--next-step")

    beat = sub.add_parser("heartbeat")
    session_args(beat)
    beat.add_argument("--state", choices=["attached", "working"], default="attached")
    beat.add_argument("--job")
    detach = sub.add_parser("detach")
    detach.add_argument("--session", required=True)
    claim = sub.add_parser("claim")
    session_args(claim)
    claim.add_argument("--item", required=True)
    release = sub.add_parser("release")
    session_args(release)
    release.add_argument("--item", required=True)
    release.add_argument("--status", choices=["waiting", "completed", "failed"], default="waiting")
    release.add_argument("--reason")
    release.add_argument("--if-expired", action="store_true")
    sub.add_parser("status")

    args = parser.parse_args(argv)
    if hasattr(args, "session"):
        ident(args.session, "session")
    if hasattr(args, "item"):
        ident(args.item, "item")
    root = control_root(args)
    {
        "heartbeat": cmd_heartbeat,
        "detach": cmd_detach,
        "claim": cmd_claim,
        "release": cmd_release,
        "status": cmd_status,
    }[args.command](args, root)


if __name__ == "__main__":
    main()
