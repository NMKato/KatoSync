"""Fast format/receipt negatives. Fixtures are not executable app artifacts."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "beta4_prebuilt", Path(__file__).resolve().parents[1] / "scripts/verify-beta4-prebuilt.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def string_command(code, name, fixed=24):
    text = name.encode() + b"\0"
    size = (fixed + len(text) + 7) // 8 * 8
    return struct.pack("<III", code, size, fixed).ljust(fixed, b"\0") + text.ljust(size-fixed, b"\0")


def macho(cpu=0x0100000C, minimum=12 << 16, platform=1, library="/usr/lib/libSystem.B.dylib", extras=()):
    commands = [struct.pack("<IIIIII", 0x32, 24, platform, minimum, 15 << 16, 0),
                string_command(0xC, library), *extras]
    payload = b"".join(commands)
    header = struct.pack("<IiiIIIII", 0xFEEDFACF, cpu, 0, 2, len(commands), len(payload), 0x200085, 0)
    return (header + payload).ljust(verifier.MIN_BINARY, b"\0")


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="katosync-prebuilt-format-")
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name).resolve()
        self.root = self.workspace / "source"
        self.root.mkdir()
        for relative in verifier.INPUTS.values():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Synthetic committed format fixture\n")
        (self.root / "source-marker.txt").write_text("Synthetic code marker\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()
        self.artifact = self.workspace / "artifact"
        self.artifact.mkdir(mode=0o700)
        self.base = self.workspace / "fallback.app"
        self.base.mkdir()
        self.output = self.workspace / "candidate.app"
        self.manifest = {
            "schemaVersion": 1, "sourceCommit": self.commit, "buildProfile": "debug",
            "target": "aarch64-apple-darwin", "features": ["stage4j-qa"],
            "bundleIdentifier": verifier.BUNDLE_ID, "binaryFile": "katosync",
            "binarySha256": "0" * 64, "sourceTreeClean": True,
            "resourceOverride": {"bundle": {"resources": []}},
            **{key: hashlib.sha256((self.root / path).read_bytes()).hexdigest()
               for key, path in verifier.INPUTS.items()},
        }
        self.set_binary(macho())

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def write_manifest(self):
        (self.artifact / "build-provenance.json").write_text(json.dumps(self.manifest))

    def set_binary(self, contents):
        path = self.artifact / "katosync"
        path.write_bytes(contents)
        path.chmod(0o755)
        self.manifest["binarySha256"] = hashlib.sha256(contents).hexdigest()
        self.write_manifest()

    def check(self, **changes):
        args = dict(root=self.root, expected=self.commit, directory=self.artifact,
                    base_app=self.base, output_app=self.output)
        return verifier.verify(**(args | changes))

    def test_matching_static_format_receipt_is_read_only(self):
        self.assertEqual(self.check(), self.manifest["binarySha256"])
        self.assertEqual(self.git("status", "--porcelain"), b"")
        self.assertFalse(self.output.exists())

    def test_wrong_identity_profile_source_and_inputs_deny(self):
        baseline = self.manifest.copy()
        variants = {
            "schemaVersion": True, "sourceCommit": "a" * 40, "buildProfile": "release",
            "target": "x86_64-apple-darwin", "features": ["stage35-qa"],
            "bundleIdentifier": "com.nmkato.katosync", "binaryFile": "../katosync",
            "binarySha256": "a" * 64, "cargoLockSha256": "b" * 64,
            "sourceTreeClean": 1, "resourceOverride": {"bundle": {"active": False, "resources": []}},
        }
        for key, value in variants.items():
            with self.subTest(key=key):
                self.manifest = baseline | {key: value}
                self.write_manifest()
                with self.assertRaises(verifier.Blocked): self.check()

    def test_unknown_duplicate_and_oversized_receipt_deny(self):
        path = self.artifact / "build-provenance.json"
        for raw in [json.dumps(self.manifest | {"unexpected": True}),
                    json.dumps(self.manifest)[:-1] + ',"schemaVersion":1}',
                    " " * (verifier.MAX_MANIFEST + 1)]:
            path.write_text(raw)
            with self.assertRaises(verifier.Blocked): self.check()

    def test_dirty_source_and_changed_head_deny(self):
        with self.assertRaises(verifier.Blocked): self.check(expected="a" * 40)
        marker = self.root / "source-marker.txt"
        marker.write_text("Changed tracked source\n")
        with self.assertRaises(verifier.Blocked): self.check()
        self.git("checkout", "--", "source-marker.txt")
        (self.root / "unreviewed.txt").write_text("Untracked source\n")
        with self.assertRaises(verifier.Blocked): self.check()

    def test_extra_entry_and_source_or_fallback_overlap_deny(self):
        for path in [self.root, self.base, self.output.parent]:
            with self.assertRaises(verifier.Blocked): self.check(directory=path)
        (self.artifact / "extra").mkdir()
        with self.assertRaises(verifier.Blocked): self.check()

    def test_symlink_and_hardlink_binary_deny(self):
        binary = self.artifact / "katosync"
        outside = self.workspace / "outside"
        binary.rename(outside)
        binary.symlink_to(outside)
        with self.assertRaises(verifier.Blocked): self.check()
        binary.unlink()
        os.link(outside, binary)
        with self.assertRaises(verifier.Blocked): self.check()

    def test_size_and_writable_permissions_deny(self):
        binary = self.artifact / "katosync"
        for length in [verifier.MIN_BINARY - 1, verifier.MAX_BINARY + 1]:
            with binary.open("r+b") as handle: handle.truncate(length)
            with self.assertRaises(verifier.Blocked): self.check()
        self.set_binary(macho())
        binary.chmod(0o777)
        with self.assertRaises(verifier.Blocked): self.check()

    def test_wrong_cpu_platform_minimum_and_external_linkage_deny(self):
        variants = [macho(cpu=0x01000007), macho(platform=2),
                    macho(minimum=11 << 16), macho(minimum=13 << 16),
                    macho(library="/opt/homebrew/lib/libcustom.dylib"),
                    macho(library="@rpath/libcustom.dylib"),
                    macho(library="/usr/lib/../../tmp/libcustom.dylib"),
                    macho(extras=[string_command(0x8000001C, "@executable_path/../Frameworks", 12)]),
                    macho(extras=[string_command(0x27, "DYLD_INSERT_LIBRARIES=/tmp/x", 12)])]
        for index, contents in enumerate(variants):
            with self.subTest(case=index):
                self.set_binary(contents)
                with self.assertRaises(verifier.Blocked): self.check()

    def test_malformed_macho_command_bounds_deny(self):
        data = bytearray(macho())
        struct.pack_into("<I", data, 36, 7)
        self.set_binary(bytes(data))
        with self.assertRaises(verifier.Blocked): self.check()


if __name__ == "__main__":
    unittest.main()
