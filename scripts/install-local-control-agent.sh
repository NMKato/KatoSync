#!/bin/zsh
set -euo pipefail

APP_PATH="${1:-/Applications/KatoSync.app}"
if [[ -x "$APP_PATH/Contents/MacOS/katosync" ]]; then
  BIN="$APP_PATH/Contents/MacOS/katosync"
else
  BIN="$APP_PATH/Contents/MacOS/KatoSync"
fi
PLIST="$HOME/Library/LaunchAgents/com.nmkato.katosync.control.plist"
LOG_DIR="$HOME/Library/Logs/KatoSync"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTROL_BIN="$HOME/Library/Application Support/KatoSync/control/bin"

if [[ ! -x "$BIN" ]]; then
  echo "KatoSync binary not found: $BIN" >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$CONTROL_BIN"
install -m 700 "$SCRIPT_DIR/katosync-agent-router.py" "$CONTROL_BIN/katosync-agent-router.py"
install -m 700 "$SCRIPT_DIR/katosync-orchestrator-lease.py" "$CONTROL_BIN/katosync-orchestrator-lease.py"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nmkato.katosync.control</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>--local-control-daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/control-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/control-launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID/com.nmkato.katosync.control" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.nmkato.katosync.control"
echo "KatoSync Local Control installed: $PLIST"
