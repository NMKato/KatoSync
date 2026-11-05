#!/usr/bin/env python3
# NMKato Solutions — one-time KATOOS QA Ed25519 issuer provisioning.
# No private key ever reaches Git, stdout, shell arguments or an app bundle.
# This is a security-sensitive ADMIN operation; run once with --apply.
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PROJECT_REF = "xbnnlyyxiilklsygxcof"
ENV_SECRET = "KATOSYNC_APPROVER_ISSUER_PKCS8_B64"
ENV_STAGE = "KATOSYNC_FEATURE_APPROVAL_STAGE"

def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    # Capture output only; never echo a command containing private key data.
    return subprocess.run(args, text=True, capture_output=True, check=True, timeout=60)

def provision(output_path: Path, *, apply: bool) -> dict[str, str]:
    if not apply:
        raise RuntimeError("QA_ISSUER_REQUIRES_EXPLICIT_APPLY")
    # Refuse to overwrite/rotate a previously installed key accidentally.
    current = json.loads(_run([
        "supabase", "secrets", "list",
        "--project-ref", PROJECT_REF, "--output", "json",
    ]).stdout)
    names = {str(row.get("name")) for row in current}
    if ENV_SECRET in names or ENV_STAGE in names:
        raise RuntimeError("QA_ISSUER_ALREADY_CONFIGURED_USE_REVIEWED_ROTATION")
    if output_path.exists():
        raise RuntimeError("QA_ISSUER_OUTPUT_ALREADY_EXISTS")
    # Private key only in process RAM and a restricted transient CLI env file.
    # The CLI v2 supports --env-file, but has no stdin secret API.
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    pkcs8 = private.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_b64 = base64.urlsafe_b64encode(public).decode("ascii").rstrip("=")
    fingerprint = hashlib.sha256(public).hexdigest()
    fd, temp_path = tempfile.mkstemp(
        prefix=".katosync-qa-issuer-", suffix=".env",
        dir=os.environ.get("TMPDIR", tempfile.gettempdir()),
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(ENV_STAGE + "=qa\n")
            f.write(ENV_SECRET + "=" + base64.b64encode(pkcs8).decode("ascii") + "\n")
            f.flush()
            os.fsync(f.fileno())
        result = _run([
            "supabase", "secrets", "set",
            "--project-ref", PROJECT_REF,
            "--env-file", temp_path,
        ])
        if result.returncode != 0:
            raise RuntimeError("QA_ISSUER_SUPABASE_SET_FAILED")
    finally:
        # The key is not retained in the repository or Git history.
        # Filesystem deletion does not guarantee SSD secure erasure.
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
    # Prove the secret names are installed, but never list their values/digests.
    after = json.loads(_run([
        "supabase", "secrets", "list",
        "--project-ref", PROJECT_REF, "--output", "json",
    ]).stdout)
    updated = {str(row.get("name")) for row in after}
    if ENV_SECRET not in updated or ENV_STAGE not in updated:
        raise RuntimeError("QA_ISSUER_SECRET_INSTALL_UNCONFIRMED")
    public_metadata = {
        "protocol": "katosync-qa-issuer-pin/v1",
        "projectRef": PROJECT_REF,
        "publicKeyBase64Url": public_b64,
        "fingerprintSha256": fingerprint,
        "keyAlgorithm": "Ed25519",
        "stage": "qa",
        "status": "issuer_secret_stored_not_owner_authorized",
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(public_metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    # Public metadata only.
    return public_metadata

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--public-output",
        type=Path,
        default=Path("docs/katosync-qa-issuer-public-key-v1.json"),
    )
    args = parser.parse_args()
    try:
        result = provision(args.public_output, apply=args.apply)
        print("QA_ISSUER_PROVISIONED")
        print("PUBLIC_KEY_B64URL=" + result["publicKeyBase64Url"])
        print("PUBLIC_SHA256=" + result["fingerprintSha256"])
        print("PRIVATE_KEY_EXPORTED=false")
    except Exception as exc:
        # No exception object from CLI printed: error may include secrets.
        print("QA_ISSUER_ABORTED_" + (
            str(exc) if str(exc).startswith("QA_ISSUER_") else "CHECK_ENVIRONMENT"
        ), file=sys.stderr)
        sys.exit(1)
