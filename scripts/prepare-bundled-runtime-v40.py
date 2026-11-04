#!/usr/bin/env python3
"""KatoSync 4.0: offline SHA-verified, security-gated llama.cpp bundle staging.

Never download an unknown binary or infer redistribution approval from a hash.
The accepted upstream archive is supplied by the authorized release operator.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import stat
import tarfile
import tempfile
import zipfile

MAX_FILES = 400
MAX_BYTES = 300 * 1024 * 1024
APPROVAL = "REVIEWED_LLAMA_CPP_LICENSE_AND_NOTICE"

def fail(reason: str) -> None:
    raise ValueError("RUNTIME_BUNDLE_" + reason)

def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def relative(name: str) -> pathlib.PurePosixPath:
    path = pathlib.PurePosixPath(name)
    if not name or path.is_absolute() or any(p in ("", ".", "..") for p in path.parts) or "\\" in name:
        fail("INVALID_ARCHIVE_PATH")
    return path

def unpack_verified(archive: pathlib.Path, fmt: str, destination: pathlib.Path) -> None:
    total = 0
    count = 0
    if fmt == "tar.gz":
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar:
                path = relative(member.name)
                if member.isdir():
                    (destination / path).mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile() or member.issym() or member.islnk():
                    fail("LINK_OR_SPECIAL_ENTRY_FORBIDDEN")
                count += 1
                total += member.size
                if count > MAX_FILES or total > MAX_BYTES:
                    fail("ARCHIVE_LIMIT_EXCEEDED")
                target = destination / path
                target.parent.mkdir(parents=True, exist_ok=True)
                payload = tar.extractfile(member)
                if payload is None:
                    fail("EXTRACTION_FAILED")
                with target.open("xb") as output:
                    shutil.copyfileobj(payload, output)
                if member.mode & 0o111:
                    target.chmod(0o755)
    elif fmt == "zip":
        with zipfile.ZipFile(archive) as zipped:
            for entry in zipped.infolist():
                path = relative(entry.filename.rstrip("/"))
                file_kind = stat.S_IFMT(entry.external_attr >> 16)
                if file_kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                    fail("LINK_OR_SPECIAL_ENTRY_FORBIDDEN")
                if entry.is_dir():
                    (destination / path).mkdir(parents=True, exist_ok=True)
                    continue
                count += 1
                total += entry.file_size
                if count > MAX_FILES or total > MAX_BYTES:
                    fail("ARCHIVE_LIMIT_EXCEEDED")
                target = destination / path
                target.parent.mkdir(parents=True, exist_ok=True)
                with zipped.open(entry) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
                if (entry.external_attr >> 16) & 0o111:
                    target.chmod(0o755)
    else:
        fail("UNSUPPORTED_ARCHIVE")
    if not count:
        fail("EMPTY_ARCHIVE")

def prepare(manifest: pathlib.Path, archive: pathlib.Path, target: str, dest: pathlib.Path, approved: bool) -> pathlib.Path:
    if not approved:
        fail("REDISTRIBUTION_REVIEW_REQUIRED")
    m = json.loads(manifest.read_text())
    runtime = m["runtime"]
    pinned = runtime["targets"].get(target)
    if not pinned:
        fail("UNSUPPORTED_TARGET")
    if pinned["archive"] not in ("tar.gz", "zip"):
        fail("UNSUPPORTED_ARCHIVE")
    if not archive.is_file() or archive.is_symlink() or sha256(archive) != pinned["sha256"]:
        fail("UPSTREAM_ARCHIVE_SHA256_MISMATCH")
    version = runtime["version"]
    if not version or "/" in version or "\\" in version:
        fail("INVALID_VERSION")
    out = dest / version
    if out.exists() or out.is_symlink():
        fail("DESTINATION_ALREADY_EXISTS")
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="katosync-llama-bundle-") as tmp:
        stage = pathlib.Path(tmp)
        unpack_verified(archive, pinned["archive"], stage)
        binaries = [p for p in stage.rglob(pinned["executable"]) if p.is_file() and not p.is_symlink()]
        if len(binaries) != 1:
            fail("EXECUTABLE_COUNT_INVALID")
        binary = binaries[0]
        if not (binary.parent / "LICENSE").is_file():
            fail("LICENSE_MISSING")
        all_files = [p for p in stage.rglob("*") if p.is_file()]
        if any(p.is_symlink() for p in stage.rglob("*")):
            fail("SYMLINK_FORBIDDEN")
        if target.startswith("macos-"):
            if not any(p.suffix == ".dylib" for p in all_files):
                fail("DYLIB_DEPENDENCIES_MISSING")
            if binary.read_bytes()[:4] not in (bytes.fromhex("cffaedfe"),bytes.fromhex("feedfacf"),bytes.fromhex("cafebabe"),bytes.fromhex("bebafeca")):
                fail("NOT_MACHO")
        if target.startswith("windows-") and binary.read_bytes()[:2] != b"MZ":
            fail("NOT_PE")
        lock = {
            "schemaVersion": 1,
            "runtimeVersion": version,
            "target": target,
            "upstreamArchiveSha256": pinned["sha256"],
            "binarySha256": sha256(binary),
        }
        (stage / "runtime-lock.json").write_text(json.dumps(lock, indent=2) + "\n")
        shutil.move(str(stage), str(out))
    return out

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=pathlib.Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--manifest", type=pathlib.Path,
                        default=pathlib.Path(__file__).resolve().parents[1] / "src/lib/localBrainManifest.json")
    parser.add_argument("--output", type=pathlib.Path,
                        default=pathlib.Path(__file__).resolve().parents[1] / "src-tauri/resources/local-brain-runtime")
    args = parser.parse_args()
    try:
        out = prepare(args.manifest, args.archive, args.target, args.output,
          os.environ.get("KATOSYNC_LLAMA_RUNTIME_REDISTRIBUTION_REVIEW") == APPROVAL)
    except (ValueError, OSError, KeyError, tarfile.TarError, zipfile.BadZipFile) as error:
        raise SystemExit(f"Runtime bundle blocked: {error}") from None
    print(f"VERIFIED_RUNTIME_BUNDLE_STAGED: {out}")

if __name__ == "__main__":
    main()
