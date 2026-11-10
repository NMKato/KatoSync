#!/usr/bin/env python3
"""NMKato Solutions — install the *manifest-pinned* official llama.cpp release in Stage4J only.

Not a model launcher. No unverified legacy executable, network call, credential or secret.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile

HOME = Path.home()
PROJECT = HOME / "Projects/.katosync-stage4j-resource-bundle-20261109"
MANIFEST = PROJECT / "src/lib/localBrainManifest.json"
STAGE_ROOT = HOME / "Library/Application Support/com.nmkato.katosync.meshqa.stage4j-isolated/local-brain"
DEST = STAGE_ROOT / "runtime/b11272"
EXPECTED_SERVER_BINARY_SHA = "6a072f8bf308ea28144476441d25760ee01b84ed102f86be4662d21ace8d72a6"


def ensure(condition: bool, msg: str) -> None:
    if not condition:
        raise RuntimeError(msg)


def hash_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def review_archive(file: Path) -> tuple[tarfile.TarFile, list[tarfile.TarInfo]]:
    data = json.loads(MANIFEST.read_text())
    target = data["runtime"]["targets"]["macos-aarch64"]
    ensure(data["runtime"]["version"] == "b11272", "STAGE4J_RUNTIME_VERSION_NOT_PINNED")
    ensure(file.is_file() and not file.is_symlink() and file.stat().st_size < 25_000_000,
           "STAGE4J_RUNTIME_UNEXPECTED_ARCHIVE")
    ensure(hash_file(file) == target["sha256"], "STAGE4J_RUNTIME_ARCHIVE_SHA256_DENIED")
    tar = tarfile.open(file, mode="r:gz")
    members = tar.getmembers()
    names = {member.name for member in members}
    ensure(len(members) == len(names) and 30 <= len(members) <= 120,
           "STAGE4J_RUNTIME_ARCHIVE_MEMBERS_INVALID")
    total_bytes = 0
    links: dict[str, str] = {}
    for m in members:
        path = PurePosixPath(m.name)
        ensure(not path.is_absolute() and path.parts[0] == "llama-b11272"
               and ".." not in path.parts and "\\" not in m.name,
               "STAGE4J_RUNTIME_TAR_PATH_DENIED")
        ensure(m.isdir() or m.isfile() or m.issym(), "STAGE4J_RUNTIME_TAR_MEMBER_TYPE_DENIED")
        if m.isfile():
            ensure(m.size <= 100_000_000, "STAGE4J_RUNTIME_MEMBER_SIZE_DENIED")
            total_bytes += m.size
        if m.issym():
            link = PurePosixPath(m.linkname)
            ensure(not link.is_absolute() and len(link.parts) == 1
                   and link.parts[0] not in ("", ".", "..")
                   and "\\" not in m.linkname,
                   "STAGE4J_RUNTIME_SYMLINK_TARGET_DENIED")
            dest = str(path.parent / link)
            ensure(dest in names, "STAGE4J_RUNTIME_SYMLINK_MISSING_TARGET")
            links[m.name] = dest
    ensure(total_bytes <= 200_000_000, "STAGE4J_RUNTIME_TOTAL_UNCOMPRESSED_DENIED")
    for link in links:
        current, visited = link, set()
        while current in links:
            ensure(current not in visited, "STAGE4J_RUNTIME_SYMLINK_CYCLE")
            visited.add(current)
            current = links[current]
        ensure(current in names, "STAGE4J_RUNTIME_LINK_CHAIN_UNRESOLVED")
    ensure("llama-b11272/llama-server" in names
           and "llama-b11272/LICENSE" in names, "STAGE4J_RUNTIME_SERVER_OR_LICENSE_MISSING")
    return tar, members


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) == 3 else "--preflight"
    ensure(mode in ("--preflight", "--install") and len(sys.argv) == 3,
           "STAGE4J_RUNTIME_ACTION_DENIED")
    pointer = Path(sys.argv[2])
    ensure(pointer.is_file() and not pointer.is_symlink(), "STAGE4J_RUNTIME_ARCHIVE_NOT_PRESENT")
    ensure(STAGE_ROOT.is_dir() and not STAGE_ROOT.is_symlink(), "STAGE4J_MODEL_STAGE_MISSING")
    ensure(not DEST.exists() and not DEST.is_symlink(), "STAGE4J_RUNTIME_DESTINATION_OCCUPIED")
    sock = subprocess.run(
        ["/usr/sbin/lsof", "-nP", "-iTCP:17842", "-sTCP:LISTEN"],
        capture_output=True, check=False
    )
    ensure(sock.returncode != 0 or b"LISTEN" not in sock.stdout,
           "STAGE4J_MODEL_SERVER_ALREADY_RUNNING")
    tar, members = review_archive(pointer)
    print(f"STAGE4J_PINNED_RUNTIME_ARCHIVE_AND_{len(members)}_MEMBERS_PASS", flush=True)
    if mode == "--preflight":
        tar.close()
        print("STAGE4J_RUNTIME_INSTALL_PREFLIGHT_PASS", flush=True)
        return
    with tempfile.TemporaryDirectory(prefix=".runtime-stage-", dir=STAGE_ROOT) as folder:
        stage = Path(folder)
        out = stage / "b11272"
        out.mkdir(mode=0o700)
        # Python 3.13 data filter rejects links outside out; additional checks above are stricter.
        tar.extractall(path=out, members=members, filter="data")
        tar.close()
        binary = out / "llama-b11272/llama-server"
        license = out / "llama-b11272/LICENSE"
        ensure(binary.is_file() and not binary.is_symlink()
               and hash_file(binary) == EXPECTED_SERVER_BINARY_SHA,
               "STAGE4J_RUNTIME_EXTRACTED_BINARY_HASH_DENIED")
        ensure(license.is_file() and not license.is_symlink()
               and 100 <= license.stat().st_size <= 80_000,
               "STAGE4J_RUNTIME_LICENSE_INVALID")
        subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(binary)],
                       check=True, capture_output=True, timeout=12)
        # Launch only in version-mode with no model weights; it cannot start inference.
        result = subprocess.run([str(binary), "--version"],
                                capture_output=True, text=True, timeout=12)
        ensure(result.returncode == 0, "STAGE4J_RUNTIME_VERSION_PROBE_FAILED")
        runtime = STAGE_ROOT / "runtime"
        if runtime.exists():
            ensure(runtime.is_dir() and not runtime.is_symlink(),
                   "STAGE4J_RUNTIME_PARENT_INVALID")
        else:
            runtime.mkdir(mode=0o700)
        ensure(not DEST.exists() and not DEST.is_symlink(),
               "STAGE4J_RUNTIME_TARGET_CHANGED")
        os.rename(out, DEST)
    print("STAGE4J_PINNED_LLAMA_CPP_RUNTIME_INSTALLED", flush=True)
    print("STAGE4J_NO_LOCAL_MODEL_LAUNCHED", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (KeyError, OSError, RuntimeError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f"STAGE4J_PINNED_RUNTIME_DENIED:{error}", file=sys.stderr)
        sys.exit(7)
