#!/usr/bin/env python3
import json, pathlib, subprocess, tempfile
from datetime import datetime

SCRIPT = pathlib.Path(__file__).with_name("katosync-continuation-watchdog.py")

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")

with tempfile.TemporaryDirectory() as td:
    root = pathlib.Path(td) / "control"
    for n in ("inbox","running","outbox","continuation"):
        (root/n).mkdir(parents=True)
    write(root/"state.json", {"status":"idle","heartbeatAt":datetime.now().astimezone().isoformat()})
    write(root/"continuation"/"plan.json", {
        "planId":"test-night",
        "enabled":True,
        "stopOnFailure":True,
        "waves":[
            {"name":"one","cwd":td,"command":"python3","args":["-c","print(1)"]},
            {"name":"two","cwd":td,"command":"python3","args":["-c","print(2)"]}
        ]
    })
    def run_once():
        subprocess.run(["python3", str(SCRIPT), "--control-root", str(root), "--once"], check=True)
    run_once()
    first = next((root/"inbox").glob("*.json"))
    job1 = json.loads(first.read_text())
    first.unlink()
    write(root/"outbox"/f"{job1['id']}.json", {"status":"completed","finishedAt":datetime.now().astimezone().isoformat()})
    run_once()
    second = next((root/"inbox").glob("*.json"))
    job2 = json.loads(second.read_text())
    assert job2["continuationWaveIndex"] == 1
    second.unlink()
    write(root/"outbox"/f"{job2['id']}.json", {"status":"completed","finishedAt":datetime.now().astimezone().isoformat()})
    run_once()
    state = json.loads((root/"continuation"/"state.json").read_text())
    assert state["status"] == "completed" and state["cursor"] == 2
    print("CONTINUATION_WATCHDOG_HAPPY_PATH=PASS")

with tempfile.TemporaryDirectory() as td:
    root = pathlib.Path(td) / "control"
    for n in ("inbox","running","outbox","continuation"):
        (root/n).mkdir(parents=True)
    write(root/"state.json", {"status":"idle","heartbeatAt":datetime.now().astimezone().isoformat()})
    write(root/"continuation"/"plan.json", {
        "planId":"test-failure", "enabled":True, "stopOnFailure":True,
        "waves":[
            {"name":"bad","cwd":td,"command":"python3","args":["-c","raise SystemExit(2)"]},
            {"name":"must-not-run","cwd":td,"command":"python3","args":["-c","print(2)"]}
        ]
    })
    subprocess.run(["python3", str(SCRIPT), "--control-root", str(root), "--once"], check=True)
    first = next((root/"inbox").glob("*.json"))
    job = json.loads(first.read_text()); first.unlink()
    write(root/"outbox"/f"{job['id']}.json", {"status":"failed","finishedAt":datetime.now().astimezone().isoformat(),"error":"test"})
    subprocess.run(["python3", str(SCRIPT), "--control-root", str(root), "--once"], check=True)
    state = json.loads((root/"continuation"/"state.json").read_text())
    assert state["status"] == "failed"
    assert not list((root/"inbox").glob("*.json"))
    print("CONTINUATION_WATCHDOG_FAILURE_STOP=PASS")
