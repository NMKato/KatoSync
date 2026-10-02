#!/usr/bin/env python3
import argparse, json, os, pathlib, re, signal, subprocess, sys, time
from datetime import datetime

LIMIT_PATTERNS = [
    r"usage limit", r"rate limit", r"quota", r"limit reached",
    r"you.?ve hit.*limit", r"too many requests", r"\b429\b",
    r"resets? (?:at|in)", r"5[- ]hour", r"five[- ]hour",
]
AUTH_PATTERNS = [
    r"failed to authenticate", r"oauth session expired",
    r"could not be refreshed", r"not logged in", r"login required",
    r"unauthorized", r"authentication required",
]
CAPACITY_PATTERNS = [
    r"temporarily unavailable", r"overloaded", r"capacity", r"\b529\b",
]
def now_iso():
    return datetime.now().astimezone().isoformat()

def classify_provider_failure(text):
    value = (text or "").lower()
    for pattern in AUTH_PATTERNS:
        if re.search(pattern, value):
            return "auth_unavailable"
    for pattern in LIMIT_PATTERNS:
        if re.search(pattern, value):
            return "quota_limited"
    for pattern in CAPACITY_PATTERNS:
        if re.search(pattern, value):
            return "capacity_unavailable"
    return "job_failed"

def fail(message, code=2):
    print("KATOSYNC_AGENT_ROUTER_ERROR:", message, flush=True)
    raise SystemExit(code)

def under(path, roots):
    try:
        resolved = path.resolve()
        return any(resolved.is_relative_to(root.resolve()) for root in roots)
    except Exception:
        return False
def git(repo, *args):
    return subprocess.run(
        ["git", *args], cwd=repo, text=True,
        capture_output=True, check=False
    )

def run_capture(cmd, cwd, timeout):
    proc = subprocess.Popen(
        cmd, cwd=cwd, text=True, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        output, _ = proc.communicate(timeout=timeout)
        return proc.returncode, output or ""
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            output, _ = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            output, _ = proc.communicate()
        return 124, (output or "") + "\nPROVIDER_TIMEOUT"
def codex_command(home, repo, prompt, result_file):
    codex = home / ".local/bin/codex"
    if not codex.exists():
        return None, "binary_missing"
    auth = subprocess.run(
        [str(codex), "login", "status"],
        text=True, capture_output=True, check=False
    )
    auth_text = (auth.stdout or "") + (auth.stderr or "")
    if auth.returncode != 0 or "logged in" not in auth_text.lower():
        return None, "auth_unavailable"
    return [
        str(codex), "exec", prompt,
        "--cd", str(repo),
        "--sandbox", "workspace-write",
        "--color", "never",
        "-o", str(result_file),
        "-c", 'approval_policy="never"',
        "-c", "sandbox_workspace_write.network_access=true",
    ], None
def claude_command(home, repo, prompt):
    claude = home / ".local/bin/claude"
    if not claude.exists():
        return None, "binary_missing"
    auth = subprocess.run(
        [str(claude), "auth", "status"],
        text=True, capture_output=True, check=False
    )
    auth_text = (auth.stdout or "") + (auth.stderr or "")
    if '"loggedIn": true' not in auth_text and '"loggedIn":true' not in auth_text:
        return None, "auth_unavailable"
    return [
        str(claude), "-p", prompt,
        "--permission-mode", "auto",
        "--output-format", "text",
        "--model", "opus",
        "--effort", "high",
    ], None
def enqueue_rdc(root, args, repo, branch, provider_states):
    queue = root / "rdc-fallback"
    queue.mkdir(parents=True, exist_ok=True)
    item = {
        "id": f"{int(time.time())}-{args.name}",
        "createdAt": now_iso(),
        "status": "waiting",
        "reason": "all_local_providers_unavailable_or_limited",
        "repo": str(repo),
        "branch": branch,
        "promptFile": str(pathlib.Path(args.prompt_file).expanduser()),
        "name": args.name,
        "providerStates": provider_states,
    }
    path = queue / f"{item['id']}.json"
    path.write_text(json.dumps(item, indent=2) + "\n")
    print("KATOSYNC_RDC_FALLBACK_QUEUED", path, flush=True)
    return path

def self_test():
    cases = {
        "You've hit your usage limit. Resets in 2h": "quota_limited",
        "HTTP 429 Too Many Requests": "quota_limited",
        "OAuth session expired and could not be refreshed": "auth_unavailable",
        "Service temporarily unavailable": "capacity_unavailable",
        "cargo test failed: assertion left != right": "job_failed",
    }
    for text, expected in cases.items():
        actual = classify_provider_failure(text)
        assert actual == expected, (text, actual, expected)
    print("AGENT_ROUTER_CLASSIFIER_TEST=PASS")
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo")
    ap.add_argument("--prompt-file")
    ap.add_argument("--name")
    ap.add_argument("--timeout", type=int, default=5400)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not all([args.repo, args.prompt_file, args.name]):
        fail("--repo, --prompt-file and --name are required")

    home = pathlib.Path.home()
    control = home / "Library/Application Support/KatoSync/control"
    prompt_root = control / "prompts"
    result_root = control / "agent-results"
    result_root.mkdir(parents=True, exist_ok=True)
    repo = pathlib.Path(args.repo).expanduser()
    prompt_file = pathlib.Path(args.prompt_file).expanduser()
    roots = [home/"Projects", home/"Dokumente_lokal", pathlib.Path("/Volumes/DevSSD/Projects")]

    if not repo.is_dir() or not under(repo, roots):
        fail(f"repo outside approved project roots: {repo}")
    if not prompt_file.is_file() or not under(prompt_file, [prompt_root]):
        fail(f"prompt outside fixed prompt root: {prompt_file}")
    if git(repo, "rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
        fail("repo is not a git worktree")
    branch = git(repo, "branch", "--show-current").stdout.strip()
    if not branch or branch in {"main", "master"}:
        fail(f"refusing autonomous run on protected branch: {branch!r}")
    if git(repo, "status", "--porcelain").stdout:
        fail("worktree is dirty before run")

    prompt = prompt_file.read_text()
    providers = ["codex", "claude"]
    provider_states = []
    for provider in providers:
        result_file = result_root / f"{args.name}-{provider}-{int(time.time())}.txt"
        if provider == "codex":
            cmd, preflight = codex_command(home, repo, prompt, result_file)
        else:
            cmd, preflight = claude_command(home, repo, prompt)

        if preflight:
            provider_states.append({"provider": provider, "state": preflight})
            print("KATOSYNC_PROVIDER_SKIP", provider, preflight, flush=True)
            continue

        print("KATOSYNC_PROVIDER_START", provider, args.name, flush=True)
        rc, output = run_capture(cmd, repo, args.timeout)
        if output:
            print(output, flush=True)
        if rc == 0:
            if git(repo, "branch", "--show-current").stdout.strip() != branch:
                fail(f"branch changed unexpectedly after {provider}")
            if git(repo, "status", "--porcelain").stdout:
                fail(f"worktree dirty after successful {provider} run", 22)
            provider_states.append({"provider": provider, "state": "completed"})
            print("KATOSYNC_PROVIDER_DONE", provider, args.name, flush=True)
            return 0

        state = classify_provider_failure(output)
        provider_states.append({"provider": provider, "state": state, "exitCode": rc})
        print("KATOSYNC_PROVIDER_FAIL", provider, state, f"exit={rc}", flush=True)
        if state == "job_failed":
            fail(f"{provider} failed for a job reason; no provider hopping", rc or 1)

    enqueue_rdc(control, args, repo, branch, provider_states)
    return 75

if __name__ == "__main__":
    raise SystemExit(main())
