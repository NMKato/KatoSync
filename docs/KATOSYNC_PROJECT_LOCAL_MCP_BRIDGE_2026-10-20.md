# KatoSync Project Work Hub — local, read-only CLI and MCP bridge v1

Date: 20 October 2026. Status: stacked draft on project creation PR #70 / Project Work Hub integration #69. No installed desktop app, provider connector, public port, remote server or production deployment is changed by this patch.

## Intent
A connected user-authorized ChatGPT session via Remote Desktop Commander, Claude Code MCP client, or a local agent can use exactly ONE canonical Project Registry to resume work. First implementation deliberately exposes only:
- project_list: list explicitly approved local Project Registry IDs and redacted names.
- project_context_get: return a FRESH local Git HEAD/branch/dirty check for a registered project, previous Registry Git SHA, safe relative document references, the generic KUAS v1 instructions and exact SHA-256, explicit read-only permissions and a stale/dirty warning.

The personal/project engineering profile, full Memory contents and roadmap are **not** automatically exported. References are not proof of their contents. A model must not confuse these with verified project decisions.

## Official protocols and dependencies
Uses @modelcontextprotocol/server v2.3.1, @modelcontextprotocol/client v2.3.1 for validation, and zod 4.6.7 with exact dependency locks. The official SDK serves local stdio, including newer and legacy MCP client negotiation. No HTTP listener and no new cloud dependency at runtime. Node.js 22+ required for this sidecar in the current development setup.

## Security boundaries
- **Deny by default:** The user must explicitly supply one or more --allow-project-id flags when configuring the local host; an unconfigured bridge exits with a clear error. The LLM cannot change this launch-time allowlist through tool arguments.
- Reads the canonical Registry from the current user's platform data directory (Mac: Library/Application Support/KatoSync; Windows: AppData/Roaming/KatoSync; Linux: XDG_DATA_HOME/KatoSync). --registry is for owner-selected custom install/testing paths only, never a tool argument.
- Verifies schemaVersion, size bounds, unique project IDs, absolute/non-symlink registered Git root matching git rev-parse --show-toplevel. Unknown/duplicate/foreign IDs fail closed.
- Git is invoked with execFileSync and **fixed arguments**, without shell or user-provided commands, within a 4-second timeout, capped output and disabled filesystem monitor/hooks. No git fetch/pull/push and no file writes.
- Only five static document *reference paths* may be returned; no content read. Excludes symlink documents and private paths. Device absolute paths, project remote URLs, untracked filenames, raw memory docs, secrets and registry location never appear in a model response.
- The exported KUAS profile is the generic **community** baseline, not an owner-approved organization/project profile. The exact policy text and SHA-256 match the bundled Rust KUAS policy asset. This is provenance, not permission.
- Response explicitly says codeWritesAllowed=false, writerLeaseVerified=false, cloudUploadAllowed=false and independentTestsExecuted=false.
- Only a user-authorized local process with filesystem access can launch this adapter. It does NOT authenticate a remote web caller, support cross-device tokens, or secure a compromised host; do not expose over TCP, HTTP, public ingress or an n8n endpoint.

## Owner-controlled CLI examples

List the ID you explicitly allow:
  node scripts/project-bridge/cli.mjs list --allow-project-id my-project

Read only that project's fresh Git context:
  node scripts/project-bridge/cli.mjs get my-project --allow-project-id my-project

A ChatGPT session with authorized Remote Desktop Commander can invoke these commands directly on the user's computer; the command does not need a model API key.

## Local MCP host configuration concept

The local MCP host (e.g. Claude Code) spawns a process using:
- command: absolute path to Node 22+
- args: [absolute path to scripts/project-bridge/mcp.mjs, "--allow-project-id", "my-project"]
- cwd: trusted KatoSync working directory containing this bridge's installed dependencies.
- credentials: none for this local read-only service.

The user must explicitly configure the host connection. Neither ChatGPT nor Claude Code is automatically connected merely because this code exists in a Draft PR. Verify project ID from the KatoSync Project Registry UI; never copy secret-containing Registry files to chat.

## Verified
- Official MCP Client connects via stdio, lists both tools, receives a synthetic project's live Git HEAD + safe context and is denied a different non-allowlisted project.
- Synthetic CLI tests: no allowlist fails; listed projects scoped; no secrets/paths; real Git status observed; Registry drift detected; registered Git-root mismatch denied; symlinked Registry and project-root rejected.
- Read-only smoke against the existing local KatoSync Registry: one explicitly allowlisted project listed and its fresh Git HEAD retrieved successfully, without displaying private project names/paths.
- Full Node suite, TypeScript typecheck and Vite production build on this branch are checked separately before review. No Rust changes.

## Limits and next slices
1. Review and land #69 -> #70 -> this bridge PR in order, then package the Node sidecar with the signed desktop app and test actual host integration on macOS and Windows.
2. Replace local CLI lifecycle with a native-core or signed bridge adapter as appropriate: one source of Git truth, explicit user-scoped permissions, no duplicate project-memory store.
3. Add a separate user-approved metadata/document read API with bounded source citations and redaction; enforce tenant/privacy restrictions before any content reaches a cloud provider.
4. Add scoped **project.create** with an interactive host-side owner approval and native exclusive filesystem checks. This read-only first release intentionally does NOT expose create to a model.
5. Add evidence-backed work.start / checkpoint / complete and KUAS profiles before any external agent is allowed to write.
6. Multi-device connections, per-session tokens, transport security and single-writer leases require an independent design/review. This local process is not an Internet-accessible MCP server.

Created by NMKato Solutions
