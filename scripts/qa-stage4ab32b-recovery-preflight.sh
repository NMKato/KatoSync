#!/bin/sh
# Created by NMKato Solutions
# Stage4AB.3.2B: read-only local recovery-readiness inventory.
# IMPORTANT: this tool can NEVER approve a physical network/sleep fault.
# The independent owner-confirmed recovery route cannot be proved remotely.
# No interfaces, routing tables, VPN, sleep timers or keys are modified.

set -u

emit() { printf '%s\n' "$1"; }
blocked() { emit "MESH_STAGE4AB32B_HARDWARE_FAULT_NOT_AUTHORIZED"; exit "$1"; }

# Only local built-in diagnostics. No sudo, no network requests.
for tool in route ifconfig networksetup awk lsof; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        emit "MESH_STAGE4AB32B_DIAGNOSTIC_UNAVAILABLE"
        blocked 3
    fi
done

default_if="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }')"
if [ -z "$default_if" ]; then
    emit "MESH_STAGE4AB32B_DEFAULT_ROUTE_NOT_VERIFIED"
    blocked 3
fi
link="$(ifconfig "$default_if" 2>/dev/null | awk '/status:/ {print $2; exit}')"
emit "MESH_STAGE4AB32B_DEFAULT_LINK_STATUS=${link:-unknown}"
if [ "$link" != "active" ]; then
    emit "MESH_STAGE4AB32B_DEFAULT_LINK_UNAVAILABLE"
    blocked 6
fi

# Never print hardware MACs, IPs, routes, SSIDs, hostnames or peer identities.
# Exclude the default interface and software bridge/loopback/vpn interfaces.
# Merely seeing an active second interface is NOT proof of a tested recovery path.
alternates=0
devices="$(networksetup -listallhardwareports 2>/dev/null | awk '/^Device: / {print $2}')"
if [ -z "$devices" ]; then
    emit "MESH_STAGE4AB32B_HARDWARE_INVENTORY_UNAVAILABLE"
    blocked 3
fi
for interface in $devices; do
    case "$interface" in
        en[0-9]*)
            if [ "$interface" != "$default_if" ]; then
                status="$(ifconfig "$interface" 2>/dev/null | awk '/status:/ {print $2; exit}')"
                if [ "$status" = "active" ]; then
                    alternates=$((alternates + 1))
                fi
            fi
            ;;
    esac
done

emit "MESH_STAGE4AB32B_ALTERNATE_ACTIVE_PHYSICAL_COUNT=$alternates"

# A still-open earlier QA socket means this is not a clean hardware baseline.
if lsof -nP -iTCP:39402 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit !found }'; then
    emit "MESH_STAGE4AB32B_EXISTING_QA_CHANNEL"
    blocked 7
fi
emit "MESH_STAGE4AB32B_QA_SOCKET_CLEAR"

# Explicit denial is the intended, safety-preserving output in ALL cases:
# even two live interfaces could share one upstream router, battery or tunnel.
emit "MESH_STAGE4AB32B_INDEPENDENT_RECOVERY_NOT_ATTESTED"
if [ "$alternates" -eq 0 ]; then
    blocked 4
else
    blocked 5
fi
