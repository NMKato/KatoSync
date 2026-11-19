// Created by NMKato Solutions
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAccountNetwork, parseAccountRuntime, eligiblePeer, devicePresentationState, sameDeviceBinding, deviceName,
  type AccountNetwork, type AccountRuntime } from "../src/lib/accountMeshContract.ts";
import { AccountMeshPairing, type MeshInvoke } from "../src/lib/accountMeshPairing.ts";

const owner = "10000000-0000-4000-8000-000000000001", own = "20000000-0000-4000-8000-000000000001";
const peer = "20000000-0000-4000-8000-000000000002", third = "20000000-0000-4000-8000-000000000003";
const request = "30000000-0000-4000-8000-000000000001", now = 1_800_000_000_000;
const fp = (byte: string) => Array(16).fill(byte).join("-");
const noAuthority = { paired: false as const, transportReady: false as const, remoteJobsEnabled: false as const };
function network(): AccountNetwork {
  return { ownerId: owner, localDeviceId: own, localFingerprint: fp("11"), localPublicKey: "a".repeat(43),
    mainDeviceId: peer, accountRevision: 1, mainDeviceAvailable: true, accountVerified: true,
    devices: [{ deviceId: own, ownerUserId: owner, displayName: "Laptop", personaName: null,
      platformOs: "macos", membershipState: "discovered", fingerprint: fp("11"), publicKey: "a".repeat(43), lastSeenAt: new Date(now).toISOString() },
    { deviceId: peer, ownerUserId: owner, displayName: "Main", personaName: null,
      platformOs: "macos", membershipState: "trusted", fingerprint: fp("22"), publicKey: "b".repeat(43), lastSeenAt: new Date(now).toISOString() }] };
}
function runtime(n = network()): AccountRuntime {
  return { ownerId: n.ownerId, localDeviceId: n.localDeviceId, mainDeviceId: n.mainDeviceId,
    accountRevision: n.accountRevision, profiles: [], serverState: "idle", errorCode: null, remoteJobsEnabled: false,
    connections: [{ peerDeviceId: peer, peerFingerprint: fp("22"), role: "client", state: "connected",
      lastHeartbeatAt: now - 1000, expiresAt: now + 20_000, errorCode: null, remoteJobsEnabled: false }] };
}
function offer() { return { protocol: "katosync-mesh-pairing-v1", publicKey: "b".repeat(43),
  nonce: "n".repeat(43), accountScope: "s".repeat(43), signature: "v".repeat(86), expiresAt: now / 1000 + 180 }; }
function invite() { return { requestId: request, sourceDeviceId: peer, fingerprint: fp("22"),
  expiresAt: new Date(now + 180_000).toISOString(), signedOffer: offer() }; }
function responseProof() { return { fingerprint: fp("22"), comparisonCode: "ABCD-1234-5678", paired: false, peerCount: 0, transportReady: false }; }

test("account roster accepts registered devices and a genuinely unregistered local app", () => {
  assert.equal(parseAccountNetwork(network()).devices.length, 2);
  const n = network(); n.localDeviceId = null; n.localFingerprint = null; n.localPublicKey = null; n.devices.shift();
  assert.equal(parseAccountNetwork(n).localDeviceId, null);
});
test("device labels retain chosen names and replace only exact generated key-prefix names", () => {
  const device = network().devices[0];
  device.displayName = "Mein Arbeitsrechner";
  assert.equal(deviceName(device), "Mein Arbeitsrechner");
  device.displayName = "KatoSync macos aaaaa";
  assert.equal(deviceName(device), "KAI Atlas Mac-1111");
  device.personaName = "  Studio  ";
  assert.equal(deviceName(device), "Studio");
  device.personaName = null;
  device.displayName = "KatoSync macos zzzzz";
  assert.equal(deviceName(device), "KatoSync macos zzzzz");
});
test("mixed account rows, duplicate identity and local key substitutions are rejected", () => {
  const n = network(); n.devices[1].ownerUserId = third;
  assert.throws(() => parseAccountNetwork(n));
  const duplicate = network(); duplicate.devices[1].fingerprint = duplicate.localFingerprint!;
  assert.throws(() => parseAccountNetwork(duplicate));
  const changed = network(); changed.localPublicKey = "x".repeat(43);
  assert.throws(() => parseAccountNetwork(changed));
});
test("recent account presence never becomes a connected transport", () => {
  assert.equal(devicePresentationState(network(), null, peer, [fp("22")], now), "registered");
  assert.equal(devicePresentationState(network(), null, peer, [], now), "approval");
});
test("only a fresh, exact-role heartbeat for the current primary revision displays connected", () => {
  const n = network(), state = runtime();
  assert.equal(devicePresentationState(n, state, peer, [fp("22")], now), "connected");
  state.connections[0].lastHeartbeatAt = now - 21_000;
  assert.equal(devicePresentationState(n, state, peer, [fp("22")], now), "offline");
  state.connections[0].lastHeartbeatAt = now - 1000; state.accountRevision = 0;
  assert.equal(devicePresentationState(n, state, peer, [fp("22")], now), "registered");
  state.accountRevision = 1; state.connections[0].role = "server";
  assert.equal(devicePresentationState(n, state, peer, [fp("22")], now), "registered");
});
test("revoked or pending devices and participant-to-participant connections cannot be selected", () => {
  const n = network(); n.devices.push({ ...n.devices[1], deviceId: third, fingerprint: fp("33"), publicKey: "c".repeat(43) });
  assert.equal(eligiblePeer(n, third), null);
  n.devices[1].membershipState = "revoked"; assert.equal(eligiblePeer(n, peer), null);
  n.devices[1].membershipState = "pending"; assert.equal(eligiblePeer(n, peer), null);
});
test("primary revision, account and public-key changes invalidate a remembered selection", () => {
  for (const change of [
    (n: AccountNetwork) => { n.accountRevision++; },
    (n: AccountNetwork) => { n.ownerId = third; },
    (n: AccountNetwork) => { n.devices[1].publicKey = "x".repeat(43); },
  ]) { const next = network(); change(next); assert.equal(sameDeviceBinding(network(), next, peer), false); }
});
test("runtime payload cannot claim job permissions or cross-account connections", () => {
  assert.equal(parseAccountRuntime(runtime(), network())?.connections.length, 1);
  assert.throws(() => parseAccountRuntime({ ...runtime(), remoteJobsEnabled: true }, network()));
  assert.throws(() => parseAccountRuntime({ ...runtime(), ownerId: third }, network()));
});
test("one connect click negotiates proofs but never auto-approves or starts a channel", async () => {
  const calls: string[] = [];
  const bridge = (async (command: string) => {
    calls.push(command);
    if (command === "mesh_inbox_invite_send") return { ...noAuthority, deliveryOnly: true, requestId: request, expiresAt: new Date(now + 180_000).toISOString() };
    if (command === "mesh_pairing_relay_list") return { ...noAuthority, deliveryOnly: true, messages: [{ requestId: request,
      senderDeviceId: peer, recipientDeviceId: own, kind: "challenge", expiresAt: now / 1000 + 180, payloadJson: "{}" }] };
    if (command === "mesh_pairing_response_create") return [JSON.stringify({ protocol: "katosync-mesh-response-v1" }), responseProof()];
    if (command === "mesh_pairing_relay_send") return { ...noAuthority, deliveryOnly: true, messageId: request };
    throw Error(command);
  }) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => now);
  engine.updateNetwork(network()); await engine.request(peer); await engine.tick();
  assert.equal(engine.snapshot.phase, "review");
  assert.equal(calls.some(c => /approve|connection_start|terminal/.test(c)), false);
});
test("receiving a signed invitation only prepares proofs until a separate explicit approval", async () => {
  const calls: string[] = [];
  const bridge = (async (command: string) => {
    calls.push(command);
    if (command === "mesh_inbox_recipient_list") return { ...noAuthority, invitations: [invite()] };
    if (command === "mesh_inbox_recipient_decide") return { ...noAuthority, decisionOnly: true, requestId: request, state: "accepted" };
    if (command === "mesh_pairing_challenge_create") return JSON.stringify({ protocol: "katosync-mesh-challenge-v1", offer: offer(), expiresAt: now / 1000 + 180 });
    if (command === "mesh_pairing_relay_send") return { ...noAuthority, deliveryOnly: true, messageId: request };
    throw Error(command);
  }) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => now);
  engine.updateNetwork(network()); await engine.tick();
  assert.equal(engine.snapshot.phase, "waiting"); assert.equal(engine.snapshot.session?.role, "recipient");
  assert.equal(calls.some(c => /approve|connection_start/.test(c)), false);
});
test("an incoming offer with a different registered key is ignored, even with a matching name", async () => {
  const calls: string[] = [], item = invite(); item.signedOffer.publicKey = "x".repeat(43);
  const bridge = (async (command: string) => { calls.push(command); return { ...noAuthority, invitations: [item] }; }) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => now);
  engine.updateNetwork(network()); await engine.tick();
  assert.equal(engine.snapshot.phase, "idle"); assert.deepEqual(calls, ["mesh_inbox_recipient_list"]);
});
test("a delayed invitation result cannot revive a cancelled or switched-account flow", async () => {
  let finish!: (value: unknown) => void;
  const bridge = (() => new Promise(resolve => { finish = resolve; })) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => now); engine.updateNetwork(network());
  const pending = engine.request(peer); engine.cancel();
  finish({ ...noAuthority, deliveryOnly: true, requestId: request, expiresAt: new Date(now + 180_000).toISOString() });
  await pending; assert.equal(engine.snapshot.phase, "idle"); assert.equal(engine.snapshot.session, null);
});
test("double clicks send only one invitation and expired requests cannot reach a review", async () => {
  let count = 0, clock = now;
  const bridge = (async () => { count++; return { ...noAuthority, deliveryOnly: true, requestId: request, expiresAt: new Date(now + 180_000).toISOString() }; }) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => clock); engine.updateNetwork(network());
  await Promise.all([engine.request(peer), engine.request(peer)]); assert.equal(count, 1);
  clock += 180_001; await engine.tick(); assert.equal(engine.snapshot.phase, "expired"); assert.equal(count, 1);
});
test("a primary switch cancels a pending flow without issuing a permission command", async () => {
  const bridge = (async () => ({ ...noAuthority, deliveryOnly: true, requestId: request, expiresAt: new Date(now + 180_000).toISOString() })) as MeshInvoke;
  const engine = new AccountMeshPairing(bridge, () => {}, () => now); engine.updateNetwork(network()); await engine.request(peer);
  const changed = network(); changed.accountRevision++; engine.updateNetwork(changed);
  assert.equal(engine.snapshot.phase, "error"); assert.equal(engine.snapshot.session, null);
});
