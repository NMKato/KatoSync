"""Security regression for opt-in llama.cpp runtime bundling; no downloads."""
import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / "scripts/prepare-bundled-runtime-v40.py"
spec = importlib.util.spec_from_file_location("bundler", FILE)
bundler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundler)

class RuntimePackageGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="katosync-bundle-contract-")
        self.root = pathlib.Path(self.tmp.name)
        self.archive = self.root / "llama-release.tar.gz"
        self.manifest = self.root / "manifest.json"
        self.out = self.root / "target"
        self.entries = [
            ("llama-b11272/llama-server",bytes.fromhex("cffaedfe")+b"\x00"*40),
            ("llama-b11272/libllama.dylib",b"local dummy dylib"),
            ("llama-b11272/LICENSE",b"MIT license"),
        ]
        self.make_archive(self.entries)
    def tearDown(self):
        self.tmp.cleanup()
    def make_archive(self, entries,symlink=None):
        with tarfile.open(self.archive,"w:gz") as target:
            for name,data in entries:
                item=tarfile.TarInfo(name)
                item.size=len(data)
                item.mode=0o755 if name.endswith("llama-server") else 0o644
                target.addfile(item,io.BytesIO(data))
            if symlink:
                entry=tarfile.TarInfo("llama-b11272/link")
                entry.type=tarfile.SYMTYPE
                entry.linkname="../../outside"
                target.addfile(entry)
        digest=hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.manifest.write_text(json.dumps({"runtime":{"version":"b11272","targets":{
            "macos-aarch64":{"archive":"tar.gz","sha256":digest,"executable":"llama-server"}
        }}}))
    def call(self,approved=True):
        return bundler.prepare(self.manifest,self.archive,"macos-aarch64",self.out,approved)
    def test_manifest_hash_and_license_checked_before_bundle_is_staged(self):
        output=self.call()
        self.assertTrue((output/"llama-b11272/llama-server").is_file())
        lock=json.loads((output/"runtime-lock.json").read_text())
        self.assertEqual(lock["target"],"macos-aarch64")
        self.assertEqual(lock["runtimeVersion"],"b11272")
        self.assertEqual(lock["binarySha256"],bundler.sha256(output/"llama-b11272/llama-server"))
    def test_explicit_release_review_required(self):
        with self.assertRaisesRegex(ValueError,"REDISTRIBUTION_REVIEW_REQUIRED"):
            self.call(False)
        self.assertFalse(self.out.exists())
    def test_modified_archive_is_rejected(self):
        with self.archive.open("ab") as output:
            output.write(b"unauthorized")
        with self.assertRaisesRegex(ValueError,"UPSTREAM_ARCHIVE_SHA256_MISMATCH"):
            self.call()
    def test_symlinks_are_rejected_before_archive_promotion(self):
        self.make_archive(self.entries,symlink=True)
        with self.assertRaisesRegex(ValueError,"LINK_OR_SPECIAL_ENTRY_FORBIDDEN"):
            self.call()
    def test_missing_library_or_license_fails_closed(self):
        self.make_archive(self.entries[:1])
        with self.assertRaisesRegex(ValueError,"LICENSE_MISSING"):
            self.call()
    def test_double_destination_promotion_fails(self):
        self.call()
        with self.assertRaisesRegex(ValueError,"DESTINATION_ALREADY_EXISTS"):
            self.call()

if __name__=="__main__":
    unittest.main()
