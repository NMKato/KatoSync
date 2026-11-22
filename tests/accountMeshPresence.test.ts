// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { AccountMeshPresence } from "../src/lib/accountMeshPresence.ts";
import type { AccountNetwork } from "../src/lib/accountMeshContract.ts";
import type { MeshInvoke } from "../src/lib/accountMeshPairing.ts";
const receipt = { accepted: true, reportedRecently: true, paired: false, transportReady: false, remoteJobsEnabled: false, nextPollSeconds: 600 };
function network(): AccountNetwork {
  const own = { deviceId: "11111111-1111-4111-8111-111111111111", ownerUserId: "22222222-2222-4222-8222-222222222222",
    fingerprint: "AA-".repeat(15) + "AA", publicKey: "A".repeat(43), displayName: "QA", personaName: null,
    platformOs: "macos" as const, membershipState: "discovered" as const, lastSeenAt: null };
  return { ownerId: own.ownerUserId, localDeviceId: own.deviceId, localFingerprint: own.fingerprint,
    localPublicKey: own.publicKey, mainDeviceId: own.deviceId, accountRevision: 1,
    mainDeviceAvailable: true, accountVerified: true, devices: [own] };
}
function invoker(run: () => Promise<unknown>): MeshInvoke {
  return async <T>(command: string) => { assert.equal(command, "mesh_device_presence_report"); return await run() as T; };
}
test("presence needs explicit build opt-in and exact registered, non-revoked identity", async () => {
  let calls = 0;
  const invoke = invoker(async () => { calls++; return receipt; });
  const off = new AccountMeshPresence(invoke, false); off.updateNetwork(network());
  assert.equal(await off.reportIfDue(), false);
  const active = new AccountMeshPresence(invoke, true);
  for (const current of [null, { ...network(), localDeviceId: null },
    { ...network(), localPublicKey: "B".repeat(43) },
    { ...network(), devices: network().devices.map(d => ({ ...d, membershipState: "revoked" as const })) }]) {
    active.updateNetwork(current); assert.equal(await active.reportIfDue(), false);
  }
  assert.equal(calls, 0);
});
test("presence has no overlap and obeys the server's bounded next poll", async () => {
  let now = 0, calls = 0, resolve!: (value: unknown) => void;
  const active = new AccountMeshPresence(invoker(() => { calls++; return new Promise(r => { resolve = r; }); }), true, () => now);
  active.updateNetwork(network()); const first = active.reportIfDue();
  assert.equal(await active.reportIfDue(), false); assert.equal(calls, 1);
  resolve({ ...receipt, nextPollSeconds: 900 }); assert.equal(await first, true);
  now = 899_999; assert.equal(await active.reportIfDue(), false);
  now = 900_000; const next = active.reportIfDue(); assert.equal(calls, 2);
  resolve(receipt); assert.equal(await next, true);
});
test("failed presence retries with backoff without altering roster or connection truth", async () => {
  let now = 0, calls = 0;
  const current = network(), before = JSON.stringify(current);
  const active = new AccountMeshPresence(invoker(async () => { calls++; throw Error("MESH_PRESENCE_UNAVAILABLE"); }), true, () => now);
  active.updateNetwork(current); assert.equal(await active.reportIfDue(), false);
  now = 599_999; assert.equal(await active.reportIfDue(), false); assert.equal(calls, 1);
  now = 600_000; assert.equal(await active.reportIfDue(), false); assert.equal(calls, 2);
  assert.equal(JSON.stringify(current), before);
});
test("presence rejects malformed receipts and any claimed pairing, transport or job authority", async () => {
  for (const bad of [null, { ...receipt, accepted: false }, { ...receipt, paired: true },
    { ...receipt, transportReady: true }, { ...receipt, remoteJobsEnabled: true },
    { ...receipt, nextPollSeconds: 299 }, { ...receipt, nextPollSeconds: 3601 }, { ...receipt, nextPollSeconds: 300.5 }]) {
    const active = new AccountMeshPresence(invoker(async () => bad), true);
    active.updateNetwork(network()); assert.equal(await active.reportIfDue(), false);
  }
});
test("account changes invalidate in-flight receipts without delaying the new registered identity", async () => {
  let resolve!: (value: unknown) => void, calls = 0;
  const active = new AccountMeshPresence(invoker(() => { calls++; return new Promise(r => { resolve = r; }); }), true, () => 0);
  active.updateNetwork(network()); const old = active.reportIfDue();
  const next = network(); next.ownerId = "33333333-3333-4333-8333-333333333333"; next.devices[0].ownerUserId = next.ownerId;
  active.updateNetwork(next); resolve(receipt); assert.equal(await old, false);
  const fresh = active.reportIfDue(); assert.equal(calls, 2); resolve(receipt); assert.equal(await fresh, true);
});
test("cleanup invalidates pending work; a StrictMode remount gets a fresh lifecycle", async () => {
  let resolve!: (value: unknown) => void;
  const old = new AccountMeshPresence(invoker(() => new Promise(r => { resolve = r; })), true, () => 0);
  old.updateNetwork(network()); const pending = old.reportIfDue(); old.dispose(); resolve(receipt);
  assert.equal(await pending, false); assert.equal(await old.reportIfDue(), false);
  const fresh = new AccountMeshPresence(invoker(async () => receipt), true, () => 0);
  fresh.updateNetwork(network()); assert.equal(await fresh.reportIfDue(), true);
});
