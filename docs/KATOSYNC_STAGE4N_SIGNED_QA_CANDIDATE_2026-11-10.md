# Stage4N: isolated signing candidate gate – no install

Goal: prepare a **separate signed but NOT automatically launched**
KatoSync candidate containing Stage4K branches/memory, Stage4L agent read-only
admission and Stage4M truthful Local Brain status.

### Resource provenance

The Stage4J macOS resource audit succeeded with 29 independently hashed
Poppler dylibs, Typst, four license files, STT helper signature and resource
lock SHA256. The source resource worktree is intentionally untracked
(not copied into Git or the PR).

Before any build, recheck the resource hash and stage the binaries with APFS
clones only into the isolated Stage4N worktree. Never place
.test-only placeholders in a signed artifact and never symlink runtime
resources into the delivered app. The dependency directory may be
temporarily symlinked from the existing locally checked-out Stage4J QA
source; that symlink is local build infrastructure, not a bundled resource.

### Guardrails

- Exact source HEAD must be explicitly pinned to KATOSYNC_STAGE4J_EXPECT_SHA.
- Explicit stage4j local QA env gate and new STAGE4N_SIGNED_20261110
  slot are required; pre-existing destination aborts without overwrite.
- Developer ID signature verified on all nested executables and the app.
- The script does not perform notarization, launch an application, install
  a LaunchAgent, touch Keychain or authorize a remote/Mesh job.
- **Stage4N still uses Stage4J data, Keychain, launch-agent and singleton
  namespace. DO NOT launch it concurrently with Stage4J or call it an
  independent isolated identity.** A distinct namespace must be designed and
  reviewed prior to installing or running this candidate.
- No auto-merge of Draft PRs, production database mutations or /mcp publish.

Owner review needed before active macOS QA launch and before any Gate9/SAS
Mesh activation.

Created by NMKato Solutions
