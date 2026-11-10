#!/usr/bin/env python3
"""NMKato Solutions: owner-controlled, disk-sparing Gemma carryover for Stage4J QA on M2.

Only weight and projector files are carried over. Never copy old executable runtime,
never read credentials, never activate a model, never modify the original package.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

HOME = Path.home()
PROJECT = HOME / "Projects/.katosync-stage4j-resource-bundle-20261109"
SOURCE = HOME / "Library/Application Support/com.nmkato.katosync.meshqa/local-brain"
NEW_PARENT = HOME / "Library/Application Support/com.nmkato.katosync.meshqa.stage4j-isolated"
NEW_ROOT = NEW_PARENT / "local-brain"
MANIFEST = PROJECT / "src/lib/localBrainManifest.json"
PACKAGE_ID = "kato-local-brain-gemma-4-e4b"
MODEL_ID = "gemma-4-e4b-it-q4_0"
TARGET_EXE = HOME / (
    "Applications/.KatoSync-Mesh-Stage4J-ModelGuardQA/"
    "KatoSync Mesh QA Stage4J Candidate.app/Contents/MacOS/katosync"
)
TARGET_EXE_SHA = "d7cc147c2a0613957f3924ef3bd8c5b449168c975cf8bf3f82bbdb7605fb5a22"


def fail(message: str) -> None:
    raise RuntimeError(message)


def regular_file(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink():
        fail("STAGE4J_SOURCE_NOT_PLAIN_FILE")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as file:
        for data in iter(lambda: file.read(8 * 1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


def verified_file(path: Path, expect_sha: str, expect_size: int) -> None:
    regular_file(path)
    if path.stat().st_size != expect_size or sha256(path).lower() != expect_sha.lower():
        fail("STAGE4J_PACKAGE_HASH_OR_SIZE_MISMATCH")


def file_bytes(path: Path) -> bytes:
    regular_file(path)
    return path.read_bytes()


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def source_manifest() -> tuple[dict, dict, Path, Path, Path]:
    data = json.loads(file_bytes(MANIFEST))
    candidates = [m for m in data["models"] if m["id"] == MODEL_ID]
    if len(candidates) != 1:
        fail("STAGE4J_MODEL_MANIFEST_MISSING")
    model = candidates[0]
    package = model["package"]
    if package["packageId"] != PACKAGE_ID or model["sizeBytes"] != 4590807392:
        fail("STAGE4J_PACKAGE_ID_OR_SIZE_UNEXPECTED")
    weight = SOURCE / "packages" / PACKAGE_ID / package["version"] / model["fileName"]
    projector = SOURCE / "models" / model["mmproj"]["fileName"]
    ledger = SOURCE / "packages" / PACKAGE_ID / "ledger.json"
    ld = json.loads(file_bytes(ledger))
    if ld["schemaVersion"] != 1 or ld["packageId"] != PACKAGE_ID or ld["active"] != package["version"]:
        fail("STAGE4J_ORIGINAL_LEDGER_INVALID")
    installed = [entry for entry in ld["installed"] if entry["version"] == package["version"]]
    if len(installed) != 1:
        fail("STAGE4J_ORIGINAL_LEDGER_VERSION_MISSING")
    entry = installed[0]
    for key, expected in (
        ("fileName", model["fileName"]),
        ("sha256", model["sha256"]),
        ("sizeBytes", model["sizeBytes"]),
    ):
        if entry.get(key) != expected:
            fail("STAGE4J_ORIGINAL_LEDGER_MANIFEST_MISMATCH")
    return model, ld, weight, projector, ledger


def active_qa_verified() -> None:
    regular_file(TARGET_EXE)
    if sha256(TARGET_EXE) != TARGET_EXE_SHA:
        fail("STAGE4J_ACTIVE_APP_BINARY_MISMATCH")
    # Read only: no model server must be active while this package is staged.
    listener = subprocess.run(
        ["/usr/sbin/lsof", "-nP", "-iTCP:17842", "-sTCP:LISTEN"],
        capture_output=True, check=False
    )
    if listener.returncode == 0 and b"LISTEN" in listener.stdout:
        fail("STAGE4J_LOCAL_BRAIN_SERVER_RUNNING")
    if not NEW_PARENT.is_dir() or NEW_PARENT.is_symlink() or NEW_ROOT.exists() or NEW_ROOT.is_symlink():
        fail("STAGE4J_TARGET_NOT_EMPTY")
    if SOURCE.stat().st_dev != NEW_PARENT.stat().st_dev:
        fail("STAGE4J_APFS_CLONE_REQUIRES_SAME_VOLUME")


def clone_file(src: Path, dst: Path) -> None:
    run("/bin/cp", "-c", str(src), str(dst))
    regular_file(dst)
    if src.stat().st_ino == dst.stat().st_ino:
        fail("STAGE4J_COPIED_FILE_IS_HARDLINK")
    dst.chmod(0o600)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) == 2 else "--preflight"
    if action not in ("--preflight", "--adopt-clone"):
        fail("STAGE4J_ACTION_NOT_ALLOWED")
    active_qa_verified()
    model, ledger, weight, projector, src_ledger = source_manifest()
    verified_file(weight, model["sha256"], model["sizeBytes"])
    verified_file(projector, model["mmproj"]["sha256"], model["mmproj"]["sizeBytes"])
    print("STAGE4J_GEMMA_SOURCE_AND_LEDGER_VERIFIED", flush=True)
    if action == "--preflight":
        print("STAGE4J_GEMMA_APFS_CLONE_PREFLIGHT_PASS", flush=True)
        return

    # Restrict writes to newly created staging subtree. No destructive operations.
    with tempfile.TemporaryDirectory(prefix=".local-brain-adopt-", dir=NEW_PARENT) as tmp:
        stage = Path(tmp)
        (stage / "models").mkdir(mode=0o700)
        model_folder = stage / "packages" / PACKAGE_ID
        final_dir = model_folder / model["package"]["version"]
        final_dir.mkdir(parents=True, mode=0o700)
        staged_weight = final_dir / model["fileName"]
        staged_projector = stage / "models" / model["mmproj"]["fileName"]
        clone_file(weight, staged_weight)
        clone_file(projector, staged_projector)
        # Ledger is just verified package metadata. No credentials or runtime.
        ledger_dest = model_folder / "ledger.json"
        shutil.copyfile(src_ledger, ledger_dest)
        ledger_dest.chmod(0o600)
        verified_file(staged_weight, model["sha256"], model["sizeBytes"])
        verified_file(staged_projector, model["mmproj"]["sha256"], model["mmproj"]["sizeBytes"])
        if json.loads(file_bytes(ledger_dest)) != ledger:
            fail("STAGE4J_LEDGER_COPY_DIFFERS")
        # Stage4J receives no unsigned/ad-hoc executable from the old sandbox.
        if (stage / "runtime").exists():
            fail("STAGE4J_UNTRUSTED_RUNTIME_CARRYOVER_DENIED")
        if NEW_ROOT.exists() or NEW_ROOT.is_symlink():
            fail("STAGE4J_TARGET_BECAME_OCCUPIED")
        os.rename(stage, NEW_ROOT)
    print("STAGE4J_GEMMA_APFS_CLONE_ADOPTED", flush=True)
    print("STAGE4J_NO_RUNTIME_COPIED_NO_MODEL_STARTED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"STAGE4J_GEMMA_ADOPTION_DENIED:{error}", file=sys.stderr)
        sys.exit(7)
