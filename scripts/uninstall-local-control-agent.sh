#!/bin/zsh
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.nmkato.katosync.control.plist"
launchctl bootout "gui/$UID/com.nmkato.katosync.control" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -f "$HOME/Library/Application Support/KatoSync/control/daemon.pid"
echo "KatoSync Local Control removed."
