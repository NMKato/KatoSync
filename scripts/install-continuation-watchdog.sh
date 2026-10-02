#!/bin/zsh
set -euo pipefail
APP_SUPPORT="$HOME/Library/Application Support/KatoSync"
BIN="$APP_SUPPORT/bin"
LOGS="$HOME/Library/Logs/KatoSync"
PLIST="$HOME/Library/LaunchAgents/com.nmkato.katosync.continuation-watchdog.plist"
mkdir -p "$BIN" "$LOGS" "$APP_SUPPORT/control/continuation"
cp "$(cd "$(dirname "$0")" && pwd)/katosync-continuation-watchdog.py" "$BIN/katosync-continuation-watchdog.py"
chmod 755 "$BIN/katosync-continuation-watchdog.py"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.nmkato.katosync.continuation-watchdog</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>$BIN/katosync-continuation-watchdog.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/continuation-watchdog.out.log</string>
  <key>StandardErrorPath</key><string>$LOGS/continuation-watchdog.err.log</string>
</dict></plist>
EOF
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/com.nmkato.katosync.continuation-watchdog" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.nmkato.katosync.continuation-watchdog"
echo "Installed: $PLIST"
