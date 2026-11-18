#!/usr/bin/env python3
"""Check a prebuilt receipt and Mach-O bytes without executing the binary.

The caller must separately verify the GitHub run/artifact download. This JSON
receipt is not a cryptographic build attestation. Only the binary's SHA-256 is
written to stdout for the existing local staging/signing helper to pin.
"""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import struct
import subprocess
import sys

BUNDLE_ID = "com.nmkato.katosync.meshqa.stage4j-isolated"
MIN_BINARY = 1_000_000
MAX_BINARY = 300_000_000
MAX_MANIFEST = 16_384
INPUTS = {
    "cargoLockSha256": "src-tauri/Cargo.lock",
    "npmLockSha256": "package-lock.json",
    "tauriConfigSha256": "src-tauri/tauri.conf.json",
    "betaConfigSha256": "src-tauri/tauri.beta4.conf.json",
}
FIELDS = set(INPUTS) | {
    "schemaVersion", "sourceCommit", "buildProfile", "target", "features",
    "bundleIdentifier", "binaryFile", "binarySha256", "sourceTreeClean", "resourceOverride",
}


class Blocked(ValueError):
    pass


def need(condition, reason):
    if not condition:
        raise Blocked(reason)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "Duplicate JSON field")
        result[key] = value
    return result


def canonical(path, directory=False):
    path = Path(path)
    need(path.is_absolute() and not any(ord(c) < 32 or ord(c) == 127 for c in str(path)),
         "Expected an absolute path without control characters")
    need(path.resolve(strict=True) == path, "Path traverses a symlink or noncanonical component")
    if directory:
        need(path.is_dir(), "Expected an existing directory")
    return path


def overlaps(left, right):
    return left == right or left in right.parents or right in left.parents


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@contextmanager
def artifact_file(path, minimum, maximum, executable=False):
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
         "Artifact entry must be a regular file with no links")
    need(before.st_uid == os.geteuid() and before.st_mode & stat.S_IRUSR and not before.st_mode & 0o7022,
         "Artifact ownership or writable/special permission bits are unsafe")
    need(minimum <= before.st_size <= maximum, "Artifact file size outside the allowed range")
    need(not executable or before.st_mode & stat.S_IXUSR, "Binary is not executable")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        need(identity(os.fstat(handle.fileno())) == identity(before), "Artifact changed while opening")
        yield handle
        need(identity(os.fstat(handle.fileno())) == identity(before) and
             identity(path.lstat()) == identity(before), "Artifact changed during verification")


def sha256_stream(handle):
    handle.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def git(root, *args):
    # Local source metadata only. Ambient Git redirects cannot change the root.
    environment = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        env=environment, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=15,
    ).stdout


def clean_source(root, expected):
    need(git(root, "rev-parse", "--show-toplevel").decode().strip() == str(root),
         "Source root differs from the Git worktree")
    need(git(root, "rev-parse", "--verify", "HEAD").decode().strip() == expected,
         "Source commit differs from the reviewed commit")
    need(not git(root, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none"),
         "Source worktree is not clean")


def load_receipt(raw, expected):
    manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    need(isinstance(manifest, dict) and set(manifest) == FIELDS, "Unexpected receipt fields")
    need(type(manifest["schemaVersion"]) is int and manifest["schemaVersion"] == 1,
         "Unsupported receipt version")
    exact = {
        "sourceCommit": expected, "buildProfile": "debug", "target": "aarch64-apple-darwin",
        "features": ["stage4j-qa"], "bundleIdentifier": BUNDLE_ID, "binaryFile": "katosync",
        "resourceOverride": {"bundle": {"resources": []}},
    }
    need(all(manifest[key] == value for key, value in exact.items()),
         "Receipt source, profile, architecture, identity, path or build inputs differ")
    need(manifest["sourceTreeClean"] is True, "Receipt does not report a clean source tree")
    need(all(isinstance(manifest[key], str) and re.fullmatch(r"[0-9a-f]{64}", manifest[key])
             for key in ["binarySha256", *INPUTS]), "Invalid receipt SHA-256")
    return manifest


def system_path(value):
    need(re.fullmatch(r"/[A-Za-z0-9_+./-]+", value) is not None and
         all(part not in ("", ".", "..") for part in value.split("/")[1:]) and
         value.startswith(("/System/Library/", "/usr/lib/")),
         "Binary links outside Apple system locations")


def command_string(command, minimum):
    need(len(command) >= minimum, "Truncated Mach-O string command")
    offset = struct.unpack_from("<I", command, 8)[0]
    need(minimum <= offset < len(command), "Invalid Mach-O string offset")
    end = command.find(b"\0", offset)
    need(end != -1, "Unterminated Mach-O string")
    return command[offset:end].decode("ascii")


def verify_macho(handle):
    handle.seek(0)
    header = handle.read(32)
    need(len(header) == 32, "Truncated Mach-O header")
    magic, cpu, subtype, kind, count, size, flags, reserved = struct.unpack("<IiiIIIII", header)
    need(magic == 0xFEEDFACF and cpu == 0x0100000C and subtype == 0 and kind == 2,
         "Expected a thin arm64 Mach-O executable")
    need(0 < count <= 4096 and 8 * count <= size <= 1024 * 1024 and reserved == 0,
         "Invalid Mach-O load command bounds")
    commands = handle.read(size)
    need(len(commands) == size, "Truncated Mach-O load commands")
    offset, minimums, libraries = 0, [], []
    dylib_commands = {0xC, 0x80000018, 0x8000001F, 0x20, 0x80000023}
    for _ in range(count):
        need(offset + 8 <= size, "Missing Mach-O command")
        code, length = struct.unpack_from("<II", commands, offset)
        need(length >= 8 and length % 8 == 0 and offset + length <= size,
             "Invalid Mach-O command size")
        command = commands[offset:offset + length]
        if code == 0x32:  # LC_BUILD_VERSION
            need(length >= 24, "Truncated build version")
            platform, minimum, sdk, tools = struct.unpack_from("<IIII", command, 8)
            need(platform == 1 and tools <= 64 and length == 24 + tools * 8,
                 "Expected a bounded macOS build version")
            minimums.append(minimum)
        elif code == 0x24:  # LC_VERSION_MIN_MACOSX
            need(length == 16, "Invalid legacy macOS version command")
            minimums.append(struct.unpack_from("<I", command, 8)[0])
        elif code in {0x25, 0x2F, 0x30, 0x27, 0xD}:
            raise Blocked("Unexpected platform, dyld environment or dylib identity")
        elif code in dylib_commands:
            library = command_string(command, 24)
            system_path(library)
            libraries.append(library)
        elif code == 0x8000001C:  # LC_RPATH
            system_path(command_string(command, 12))
        elif code == 0xE:  # LC_LOAD_DYLINKER
            need(command_string(command, 12) == "/usr/lib/dyld", "Unexpected dynamic linker")
        offset += length
    need(offset == size and minimums == [12 << 16], "Binary must target exactly macOS 12.0.0")
    need(bool(libraries), "No Apple system linkage recorded")


def verify(root, expected, directory, base_app, output_app):
    need(re.fullmatch(r"[0-9a-f]{40}", expected) is not None, "Invalid reviewed commit")
    root, directory = canonical(root, True), canonical(directory, True)
    base_app = canonical(base_app, True)
    output_app = Path(output_app)
    need(output_app.is_absolute() and output_app.parent.resolve(strict=True) == output_app.parent,
         "Invalid output parent")
    need(not output_app.exists() and not output_app.is_symlink(), "Output already exists")
    need(all(not overlaps(directory, protected) for protected in (root, base_app, output_app)),
         "Artifact directory overlaps source, fallback or output")
    directory_stat = directory.stat()
    need(directory_stat.st_uid == os.geteuid() and not directory_stat.st_mode & 0o022,
         "Artifact directory must be owned and not group/world writable")
    need({p.name for p in directory.iterdir()} == {"katosync", "build-provenance.json"},
         "Artifact directory must contain exactly the binary and receipt")
    clean_source(root, expected)
    with artifact_file(directory / "build-provenance.json", 1, MAX_MANIFEST) as receipt:
        manifest = load_receipt(receipt.read(MAX_MANIFEST + 1), expected)
    for field, relative in INPUTS.items():
        path = canonical(root / relative)
        need(path.is_file() and path.stat().st_size <= 16 * 1024 * 1024, "Invalid source input")
        local = hashlib.sha256(path.read_bytes()).hexdigest()
        committed = hashlib.sha256(git(root, "show", "HEAD:" + relative)).hexdigest()
        need(local == committed == manifest[field], "Receipt lockfile/config differs from clean HEAD")
    with artifact_file(directory / "katosync", MIN_BINARY, MAX_BINARY, executable=True) as binary:
        verify_macho(binary)
        digest = sha256_stream(binary)
        need(digest == manifest["binarySha256"], "Binary differs from the receipt hash")
    clean_source(root, expected)
    return digest


def main():
    try:
        need(len(sys.argv) == 6, "Expected source-root, reviewed-commit, artifact-directory, fallback-app, output-app")
        digest = verify(*sys.argv[1:])
    except (Blocked, OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        print("BETA4_PREBUILT_BLOCKED: receipt, source, paths or Mach-O validation failed", file=sys.stderr)
        return 2
    print("BETA4_PREBUILT_RECEIPT_AND_MACHO_VERIFIED", file=sys.stderr)
    print(digest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
