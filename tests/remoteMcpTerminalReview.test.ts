// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { parseRemoteMcpTerminalApproval, parseRemoteMcpTerminalReview } from "../src/lib/remoteMcpTerminalReview.ts";
import { isRemoteMcpReadOnlyScope } from "../src/lib/remoteMcpOwnerReview.ts";
import { parseRemoteMcpRelaySnapshot } from "../src/lib/remoteMcpRelayState.ts";
const NOW = 1_800_000_000_000;
const review = () => ({
  protocol: "katosync-remote-mcp-terminal-review-v1",
  reviewId: "2b43d0ea-7ca8-4a30-bf56-7cf54d75af55",
  operationId: "0750f8d4-756a-4398-becd-ad21313965ca",
  projectId: "katosync", profileId: "git_version", command: "git --version",
  argumentsSha256: "ab".repeat(32), expiresAt: NOW + 90_000,
});
test("an exact native terminal review exposes only the fixed profile and a bounded operation", () => {
  assert.deepEqual(parseRemoteMcpTerminalReview(review(), "katosync", NOW), review());
  for (const patch of [
    { projectId: "other" }, { profileId: "shell" }, { command: "git --version; touch changed" },
    { operationId: "00000000-0000-0000-0000-000000000000" }, { nonce: "must-stay-native" },
    { expiresAt: NOW }, { expiresAt: NOW + 300_001 }, { argumentsSha256: "not-a-digest" },
  ]) assert.equal(parseRemoteMcpTerminalReview({ ...review(), ...patch }, "katosync", NOW), null);
});
test("approval cannot change the reviewed operation, project or argument digest", () => {
  const checked = parseRemoteMcpTerminalReview(review(), "katosync", NOW)!;
  const approved = { protocol: "katosync-remote-mcp-terminal-approval-v1",
    operationId: checked.operationId, projectId: checked.projectId, profileId: "git_version",
    argumentsSha256: checked.argumentsSha256, expiresAt: NOW + 60_000 };
  assert.deepEqual(parseRemoteMcpTerminalApproval(approved, checked, NOW), approved);
  for (const patch of [
    { operationId: checked.reviewId }, { projectId: "other" }, { argumentsSha256: "cd".repeat(32) },
    { profileId: "arbitrary" }, { expiresAt: NOW }, { expiresAt: NOW + 60_001 },
    { deviceProof: "must-stay-native" },
  ]) assert.equal(parseRemoteMcpTerminalApproval({ ...approved, ...patch }, checked, NOW), null);
});
test("terminal profiles require the separate fourth scope and do not enable generic execution", () => {
  const scopes = ["devices.list", "device.status", "git.status"];
  assert.equal(isRemoteMcpReadOnlyScope(scopes), true);
  assert.equal(isRemoteMcpReadOnlyScope([...scopes, "terminal.run_profile"]), true);
  assert.equal(isRemoteMcpReadOnlyScope(["devices.list", "device.status", "terminal.run_profile"]), false);
  for (const scope of ["terminal.execute", "terminal.run", "computer.use", "terminal.run_profile"]) {
    assert.equal(isRemoteMcpReadOnlyScope([...scopes, "terminal.run_profile", scope]), false);
  }
});
test("terminal connection status cannot be inferred from old presence or a grant alone", () => {
  const live = { state: "connected", lastHeartbeatAt: NOW, expiresAt: NOW + 15_000,
    errorCode: null, deviceAccessEnabled: false, remoteJobsEnabled: false,
    readOnlyGitStatusEnabled: true, approvedProjectIds: ["katosync"], terminalProfilesEnabled: true };
  assert.equal(parseRemoteMcpRelaySnapshot(live)?.terminalProfilesEnabled, true);
  assert.equal(parseRemoteMcpRelaySnapshot({ ...live, terminalProfilesEnabled: undefined })?.terminalProfilesEnabled, false);
  assert.equal(parseRemoteMcpRelaySnapshot({ ...live, readOnlyGitStatusEnabled: false, approvedProjectIds: [] }), null);
  assert.equal(parseRemoteMcpRelaySnapshot({ ...live, state: "idle", readOnlyGitStatusEnabled: false, approvedProjectIds: [] }), null);
});
