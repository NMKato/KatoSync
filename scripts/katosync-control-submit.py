#!/usr/bin/env python3
import argparse, json, os, pathlib, sys, time, uuid

def main():
    parser = argparse.ArgumentParser(description="Submit a local-only KatoSync Control job.")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--mode", choices=["read_only", "workspace_write"], default="read_only")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--require-clean-git", action="store_true")
    parser.add_argument("--lane", default="default")
    parser.add_argument("--project")
    parser.add_argument("--resource-lock", action="append", default=[])
    parser.add_argument("--dedupe-key")
    parser.add_argument("--wait", action="store_true")
    parser.add_argument("--wait-timeout", type=int, default=960)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("command required after options")

    root = pathlib.Path.home() / "Library" / "Application Support" / "KatoSync" / "control"
    inbox = root / "inbox"
    outbox = root / "outbox"
    inbox.mkdir(parents=True, exist_ok=True)
    outbox.mkdir(parents=True, exist_ok=True)
    job_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:10]
    job = {
        "id": job_id,
        "cwd": str(pathlib.Path(args.cwd).expanduser().resolve()),
        "command": args.command[0],
        "args": args.command[1:],
        "mode": args.mode,
        "timeoutSeconds": args.timeout,
        "requireCleanGit": args.require_clean_git,
        "laneId": args.lane,
        "projectId": args.project,
        "resourceLocks": args.resource_lock,
        "dedupeKey": args.dedupe_key,
    }
    tmp = inbox / (job_id + ".tmp")
    dst = inbox / (job_id + ".json")
    tmp.write_text(json.dumps(job, indent=2) + "\n")
    os.replace(tmp, dst)
    print(job_id)
    if not args.wait:
        return 0

    result_path = outbox / (job_id + ".json")
    deadline = time.time() + args.wait_timeout
    while time.time() < deadline:
        if result_path.exists():
            data = json.loads(result_path.read_text())
            print(json.dumps(data, indent=2))
            return 0 if data.get("status") == "completed" else 1
        time.sleep(0.25)
    print(f"timeout waiting for {job_id}", file=sys.stderr)
    return 124

if __name__ == "__main__":
    raise SystemExit(main())
