# KatoSync Project Work Hub – First-class local project creation

Date: 20 October 2026. Status: stacked draft, based on Project Work Hub integration PR #69. No release to desktop app and no edits to existing user projects.

## User story
Open Agent Sync > Projekte > Projekt hinzufügen > Neues Projekt erstellen.
Provide project name, safe local folder name, and one of the five starter profiles:
- Blank
- Web / TypeScript
- iOS / SwiftUI
- Android / Kotlin
- Tauri / Rust

Select a Workspace folder using the desktop operating-system folder chooser, review the confirmation, and create.

## Actual effects
- Rust verifies name and ASCII folder slug, parent existence, parent containment in the current user's home, and rejects nesting within an existing Git repository.
- Creates one *previously nonexistent* child directory using exclusive mkdir. An existing directory causes a hard stop with no overwrite.
- Writes README.md, PROJECT_STATUS_FLOW.md, AGENTS.md, MEMORY.md, docs/TECH_STACK.md and .gitignore using exclusive file creation.
- Creates **local Git only** and first commit on main, with fixed arguments, disabled interactive prompts and disabled hook execution. No GitHub repository, external installer, SDK or package manager is run.
- Returns a fresh native Project Registry scanner result; the current canonical TypeScript discovery/registry/verification/capsule pipeline adds that *same* project to persistent Project Registry and renders it in the portfolio.
- Existing project imports and Repo verification stay unchanged. The user may immediately generate a fresh, read-only resume packet and see proposed KUAS profile information in docs/TECH_STACK.md.

## Explicit limit of these templates
These are **project foundations**, NOT buildable apps. In particular, the iOS profile has no Xcode .xcodeproj, Android has no Gradle wrapper, Web has no installed Node/TypeScript toolchain and Tauri has no generated Tauri project. This avoids pinning deprecated framework versions without verification or silently downloading packages. The next slice should use verified official generators, user-selected SDK versions and independent build validation.

## Safety and recovery
- Existing sibling projects/files cannot be overwritten by normal creation requests (exclusive mkdir and create_new).
- Creating a project is an explicit user-confirmed local write; no automated provider writes or production data changes.
- A failed partial creation may leave an **incomplete newly-created project folder**. It is deliberately *not automatically deleted*; inspect and recover via Import after fixing any error.
- The Rust command requires a parent under the user's home directory, not a symlink escape or an existing Git repo. External volumes are future work subject to explicit user approval.
- Registry storage persists through existing Project Registry backend; if saving fails, UI reports a partial result and offers re-import of the existing scaffold.
- This does not implement trusted KUAS organization profile persistence, a writer lease, automatic work.start/checkpoint/complete, direct ChatGPT/Claude MCP API access or cloud sync.
- Git config identity for the bootstrap commit is an explicit local KatoSync marker, not impersonation of the owner. Real commits should use the user's configured identity.

## Verification
- 154/154 Node tests PASS.
- TypeScript typecheck and Vite production build PASS.
- 110 Rust library tests PASS, 3 intentionally ignored, including synthetic create/scan/commit, strict filename validation, exclusive no-overwrite and existing-neighbor preservation.
- cargo fmt --check and git diff --check PASS.
- Rust tests use locally ignored placeholder Poppler/Typst directories because isolated worktrees omit binary resources. No distributable installer was built or tested.

## Follow-up
1. Independent review; reconcile #69 and review this stacked PR before coordinated release, then packaged macOS/Windows GUI testing with actual Poppler/Typst files.
2. Optional genuine starter projects using verified official platform generators under separate explicit approval.
3. Scoped project.create/project.import/project.context.get MCP/CLI, safe authenticated project identity and user-controlled device/root authorization.
4. Durable project checkpoints, provider-agnostic resume with verified KUAS policy digest and single-writer worktree ownership.

Created by NMKato Solutions
