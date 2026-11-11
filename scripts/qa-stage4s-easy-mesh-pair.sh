#!/usr/bin/env bash
# Created by NMKato Solutions — isolated non-network Stage4S safety contract.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --experimental-strip-types --test \
 "$ROOT/tests/meshStage4SEasyPairing.test.ts" \
 "$ROOT/tests/meshStage4SEasyUiContract.test.ts" \
 "$ROOT/tests/meshStage4SReleaseGate.test.ts" \
 "$ROOT/tests/meshRelayLocalApproval35F.test.ts" \
 "$ROOT/tests/meshStage4QHonestPairingUx.test.ts" \
 "$ROOT/tests/meshConnectionGuideStage3E.test.ts" \
 "$ROOT/tests/meshDirectoryPresentation35.test.ts"
