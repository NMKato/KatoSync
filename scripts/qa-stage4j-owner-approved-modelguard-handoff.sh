#!/bin/bash
# NMKato Solutions — owner-approved Stage4J handoff; never force-kill.
set -euo pipefail
test "$#" -ge 1 || { echo "STAGE4J_HANDOFF_DEVICE_REQUIRED" >&2; exit 2; }
mode="$1"
action="--preflight"
if test "$#" -ge 2; then action="$2"; fi
case "$mode" in
  M2)
    OLD="$HOME/Applications/.KatoSync-Mesh-Stage4J-SingletonFixedQA/KatoSync Mesh QA Stage4J Candidate.app"
    NEW="$HOME/Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA/KatoSync Mesh QA Stage4J Candidate.app"
    ;;
  M3)
    OLD="$HOME/Applications/.KatoSync-Mesh-Stage4J-SingletonFixedQA-Transfer/extracted/KatoSync Mesh QA Stage4J Candidate.app"
    NEW="$HOME/Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA-Transfer/extracted/KatoSync Mesh QA Stage4J Candidate.app"
    ;;
  *) echo "STAGE4J_HANDOFF_DEVICE_DENIED" >&2; exit 2;;
esac
case "$action" in --preflight|--owner-confirmed-handoff) ;; *) echo "STAGE4J_HANDOFF_ACTION_DENIED" >&2; exit 2;; esac
OLD_BIN="$OLD/Contents/MacOS/katosync"
NEW_BIN="$NEW/Contents/MacOS/katosync"
for app in "$OLD" "$NEW"; do
  test -d "$app" && test ! -L "$app" || { echo "STAGE4J_HANDOFF_APP_MISSING_OR_SYMLINK" >&2; exit 3; }
  /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1 || { echo "STAGE4J_HANDOFF_BAD_SIGNATURE" >&2; exit 3; }
  ident="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
  test "$ident" = "com.nmkato.katosync.meshqa.stage4j-isolated" || { echo "STAGE4J_HANDOFF_BAD_BUNDLE" >&2; exit 3; }
  info="$(/usr/bin/codesign -dv --verbose=2 "$app" 2>&1)"
  [[ "$info" == *"TeamIdentifier=T8SB89JPX7"* && "$info" == *"Identifier=$ident"* ]] || { echo "STAGE4J_HANDOFF_BAD_SIGNER" >&2; exit 3; }
done
/usr/sbin/spctl --assess --type execute "$NEW" >/dev/null 2>&1 || { echo "STAGE4J_HANDOFF_GATEKEEPER_DENIED" >&2; exit 3; }
sha="$(/usr/bin/shasum -a 256 "$NEW_BIN" | /usr/bin/awk '{print $1}')"
test "$sha" = "d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22" || { echo "STAGE4J_HANDOFF_HASH_MISMATCH" >&2; exit 3; }
process_check() {
  /usr/bin/python3 - "$OLD_BIN" "$NEW_BIN" "$1" <<'PY'
import os,re,subprocess,sys
old,new,mode=sys.argv[1:]
raw=subprocess.check_output(['/bin/ps','-axww','-o','pid=','-o','uid=','-o','command='],text=True)
found=[]
for line in raw.splitlines():
    m=re.match(r'\s*(\d+)\s+(\d+)\s+(.+)',line)
    if not m or int(m.group(2))!=os.getuid():continue
    exe=m.group(3).strip()
    if exe.startswith('/') and exe.endswith('.app/Contents/MacOS/katosync'):
        found.append((int(m.group(1)),exe))
if mode=='old' and len(found)==1 and found[0][1]==old:
    print(found[0][0]);sys.exit(0)
if mode=='none' and not found:sys.exit(0)
if mode=='new' and len(found)==1 and found[0][1]==new:
    print(found[0][0]);sys.exit(0)
print('STAGE4J_HANDOFF_PROCESS_STATE_DENIED',file=sys.stderr)
sys.exit(9)
PY
}
work_idle() {
  local root="$HOME/Library/Application Support/KatoSync Mesh QA Stage4J/control"
  local d
  for d in inbox running; do
    test -d "$root/$d" || { echo "STAGE4J_HANDOFF_CONTROL_DIR_MISSING" >&2; return 1; }
    test -z "$(/usr/bin/find "$root/$d" -maxdepth 1 -type f -print -quit)" || { echo "STAGE4J_HANDOFF_ACTIVE_JOBS" >&2; return 1; }
  done
  /usr/bin/python3 - "$root" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
for name in ('lanes.json','state.json'):
    f=p/name
    if not f.exists():continue
    try:d=json.loads(f.read_text())
    except (ValueError,OSError):sys.exit(7)
    if name=='lanes.json' and len(d)>0:sys.exit(7)
    if name=='state.json' and (d.get('currentJobId') or d.get('status','idle') not in ('idle','stopped','available')):sys.exit(7)
PY
}
old_pid="$(process_check old)" || exit 4
work_idle || { echo "STAGE4J_HANDOFF_WORK_NOT_IDLE" >&2; exit 4; }
if /usr/sbin/lsof -nP -iTCP:17842 -sTCP:LISTEN 2>/dev/null | /usr/bin/grep -q LISTEN; then
  echo "STAGE4J_HANDOFF_ACTIVE_LOCAL_MODEL" >&2; exit 4
fi
echo "STAGE4J_HANDOFF_PREFLIGHT_PASS_OLD_PID=$old_pid"
if test "$action" = "--preflight"; then exit 0; fi
echo "STAGE4J_HANDOFF_OWNER_CONFIRMATION_REQUIRED"
approval="$(/usr/bin/osascript -e 'display dialog "KatoSync 4J: Keine lokalen Auftraege gefunden. Ungespeicherte Texte im alten Fenster sind dennoch moeglich. Bitte zuerst speichern. Danach die alte Version regulär beenden und ModelGuard starten?" buttons {"Abbrechen", "Alte Version beenden"} default button "Abbrechen" with icon caution giving up after 45' 2>/dev/null)" || {
  echo "STAGE4J_HANDOFF_OWNER_CANCELLED"; exit 5;
}
[[ "$approval" == *"button returned:Alte Version beenden"* && "$approval" != *"gave up:true"* ]] || { echo "STAGE4J_HANDOFF_OWNER_CANCELLED"; exit 5; }
test "$(process_check old)" = "$old_pid" || { echo "STAGE4J_HANDOFF_PROCESS_CHANGED" >&2; exit 6; }
work_idle || { echo "STAGE4J_HANDOFF_WORK_CHANGED" >&2; exit 6; }
# Exact signed GUI is the only running katosync process. No ambiguous bundle-ID AppleEvent.
echo "STAGE4J_HANDOFF_GRACEFUL_MENU_QUIT"
/usr/bin/osascript -e 'tell application "System Events" to tell process "katosync" to click menu item "Quit KatoSync 4J Single Instance Fixed QA" of menu 1 of menu bar item "KatoSync Mesh QA" of menu bar 1' || {
  echo "STAGE4J_HANDOFF_MENU_QUIT_FAILED" >&2; exit 6;
}
for i in $(/usr/bin/seq 1 60); do
  if ! /bin/kill -0 "$old_pid" 2>/dev/null; then break; fi
  /bin/sleep 0.25
done
if /bin/kill -0 "$old_pid" 2>/dev/null; then echo "STAGE4J_HANDOFF_OLD_STILL_RUNNING" >&2; exit 7; fi
process_check none || exit 7
echo "STAGE4J_HANDOFF_ONE_SHOT_NEW_LAUNCH"
/usr/bin/open -n "$NEW"
for i in $(/usr/bin/seq 1 40); do
  if process_check new >/dev/null 2>&1; then
    echo "STAGE4J_HANDOFF_ONE_MODEL_GUARD_INSTANCE_RUNNING"
    process_check new
    exit 0
  fi
  /bin/sleep 0.25
done
echo "STAGE4J_HANDOFF_NEW_LAUNCH_UNCONFIRMED" >&2
exit 8
