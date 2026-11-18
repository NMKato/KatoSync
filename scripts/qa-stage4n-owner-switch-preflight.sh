#!/bin/bash
# NMKato Solutions — Stage4N owner-switch PRE-FLIGHT ONLY.
# No app quit, launch, Keychain/password reads, Mesh enrollments or job actions.
set -euo pipefail
umask 077
[[ $# == 1 && ( "$1" == M2 || "$1" == M3 ) ]] || { echo "STAGE4N_DEVICE_REQUIRED"; exit 2; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "STAGE4N_MACOS_ARM_REQUIRED"; exit 2; }
if [[ "$1" == M2 ]]; then
 OLD="$HOME/Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA/KatoSync Mesh QA Stage4J Candidate.app"
 NEW="$HOME/Applications/.KatoSync-Mesh-Stage4N-TruthQA/KatoSync Mesh QA Stage4J Candidate.app"
else
 OLD="$HOME/Applications/.KatoSync-Mesh-Stage4J-SingletonFixedQA-Transfer/extracted/KatoSync Mesh QA Stage4J Candidate.app"
 NEW="$HOME/Applications/.KatoSync-Mesh-Stage4N-TruthQA-Transfer/extracted/KatoSync Mesh QA Stage4J Candidate.app"
fi
OLD_BIN="$OLD/Contents/MacOS/katosync"
NEW_BIN="$NEW/Contents/MacOS/katosync"
for app in "$OLD" "$NEW";do
 [[ -d "$app" && ! -L "$app" && -x "$app/Contents/MacOS/katosync" ]] || { echo "STAGE4N_APP_PATH_INVALID";exit 3; }
 [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" == "com.nmkato.katosync.meshqa.stage4j-isolated" ]] || {
   echo "STAGE4N_BUNDLE_ID_MISMATCH";exit 3;
 }
 /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1 || { echo "STAGE4N_BAD_SIGNATURE";exit 3; }
done
/usr/sbin/spctl --assess --type execute "$NEW" >/dev/null 2>&1 || { echo "STAGE4N_GATEKEEPER_DENIED";exit 3; }
/usr/bin/xcrun stapler validate "$NEW" 2>&1 | /usr/bin/grep -q 'validate action worked' || {
  echo "STAGE4N_NOTARY_TICKET_MISSING";exit 3;
}
expected="7ebbf887b9df8dd8143493ec6be6dcd2777e1797f441747ede7c3e79ae5c0958"
actual="$(/usr/bin/shasum -a 256 "$NEW_BIN" | /usr/bin/awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo "STAGE4N_SIGNED_BINARY_SHA_MISMATCH";exit 3; }
echo STAGE4N_SIGNATURE_TICKET_AND_HASH_PASS
/usr/bin/python3 - "$OLD_BIN" "$NEW_BIN" <<'PYPROC'
import os,re,subprocess,sys
old,new=sys.argv[1:]
raw=subprocess.check_output(['/bin/ps','-axww','-o','pid=','-o','uid=','-o','comm=','-o','command='],text=True)
found=[]
for line in raw.splitlines():
    parts=line.strip().split(None,3)
    if len(parts)!=4 or not parts[0].isdigit() or not parts[1].isdigit() or int(parts[1])!=os.getuid():
        continue
    executable,command=parts[2],parts[3].strip()
    # The launch command from remote terminal tooling may itself contain an
    # entire script and the candidate path; its executable remains a shell.
    if not executable.startswith(str(os.path.expanduser('~/'))):
        continue
    if command.startswith('/') and command.endswith('.app/Contents/MacOS/katosync'):
        found.append((int(parts[0]),command))
if len(found)!=1 or found[0][1]!=old:
 print('STAGE4N_RUNNING_PROCESS_NOT_EXACTLY_ONE_EXPECTED_OLD',file=sys.stderr)
 print('OBSERVED_COUNT',len(found),'EXACT_EXPECTED_MATCHES',sum(path==old for _,path in found),file=sys.stderr)
 sys.exit(4)
print('STAGE4N_SINGLE_OLD_APP_VERIFIED')
PYPROC
control="$HOME/Library/Application Support/KatoSync Mesh QA Stage4J/control"
[[ -d "$control" && ! -L "$control" ]] || { echo STAGE4N_CONTROL_ROOT_MISSING;exit 4; }
for name in inbox running;do
  [[ -d "$control/$name" && -z "$(/usr/bin/find "$control/$name" -maxdepth 1 -type f -print -quit)" ]] || {
   echo "STAGE4N_PENDING_OR_RUNNING_JOBS";exit 4;
  }
done
/usr/bin/python3 - "$control" <<'PYSTATE'
import json, pathlib, sys
root=pathlib.Path(sys.argv[1])
lanes=root/'lanes.json'
if lanes.exists():
 try: x=json.loads(lanes.read_text())
 except Exception: sys.exit('STAGE4N_INVALID_LANE_STATE')
 if len(x)!=0:sys.exit('STAGE4N_ACTIVE_LANES')
state=root/'state.json'
if state.exists():
 try: x=json.loads(state.read_text())
 except Exception: sys.exit('STAGE4N_INVALID_CONTROL_STATE')
 if x.get('currentJobId') or x.get('status','idle') not in ('idle','stopped','available'):
  sys.exit('STAGE4N_CONTROL_NOT_IDLE')
print('STAGE4N_JOB_AND_LANE_IDLE_PASS')
PYSTATE
if /usr/sbin/lsof -nP -iTCP:17842 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q LISTEN;then
 echo STAGE4N_LOCAL_BRAIN_ACTIVE_DO_NOT_SWITCH;exit 5
fi
echo STAGE4N_LOCAL_MODEL_IDLE_PASS
echo STAGE4N_READY_FOR_HUMAN_REVIEW_ONLY
echo STAGE4N_AUTH_SESSION_NOT_VERIFIED
echo STAGE4N_SAS_PAIRING_NOT_AUTHORIZED
echo STAGE4N_SWITCH_NOT_EXECUTED
