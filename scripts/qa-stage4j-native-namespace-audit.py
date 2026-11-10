#!/usr/bin/env python3
"""NMKato Solutions — read-only check that compiled Stage4J is not Stage35."""
from pathlib import Path
import sys

STAGE4J_IDENTIFIER = b"com.nmkato.katosync.meshqa.stage4j-isolated"
STAGE4J_KEYCHAIN = b"com.nmkato.katosync.katoos.stage4j.qa"
STAGE4J_LAUNCH_AGENT = b"com.nmkato.katosync.meshqa.stage4j.sync"
FORBIDDEN_STAGE35_KEYCHAIN = b"com.nmkato.katosync.katoos.stage35.qa"
FORBIDDEN_STAGE35_LAUNCH_AGENT = b"com.nmkato.katosync.meshqa.stage35.sync"


def verify(path: Path) -> bool:
    if not path.is_file() or path.is_symlink() or not (1_000_000 <= path.stat().st_size <= 300_000_000):
        return False
    data = path.read_bytes()
    return all(x in data for x in (
        STAGE4J_IDENTIFIER, STAGE4J_KEYCHAIN, STAGE4J_LAUNCH_AGENT,
    )) and all(x not in data for x in (
        FORBIDDEN_STAGE35_KEYCHAIN, FORBIDDEN_STAGE35_LAUNCH_AGENT,
    ))


if __name__ == "__main__":
    if len(sys.argv) != 2 or not verify(Path(sys.argv[1])):
        print("STAGE4J_NATIVE_NAMESPACE_DENIED", file=sys.stderr)
        sys.exit(5)
    print("STAGE4J_NATIVE_NAMESPACE_AUDIT_PASS")
