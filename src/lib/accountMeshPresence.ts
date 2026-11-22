// Created by NMKato Solutions
// Restore the existing signed presence lifecycle for registered UX4 identities.
// A receipt is never peer trust, transport readiness or authority to run a job.
import type { AccountNetwork } from "./accountMeshContract.ts";
import type { MeshInvoke } from "./accountMeshPairing.ts";

const RETRY_MS = 600_000;
interface PresenceReceipt {
  accepted: boolean; reportedRecently: boolean; paired: boolean;
  transportReady: boolean; remoteJobsEnabled: boolean; nextPollSeconds: number;
}
function identity(network: AccountNetwork | null): string | null {
  if (!network?.accountVerified || !network.localDeviceId) return null;
  const own = network.devices.find(device => device.deviceId === network.localDeviceId);
  if (!own || !["discovered", "trusted"].includes(own.membershipState) ||
      own.ownerUserId !== network.ownerId || own.fingerprint !== network.localFingerprint ||
      own.publicKey !== network.localPublicKey) return null;
  return [network.ownerId, own.deviceId, own.fingerprint, own.publicKey].join(":");
}
export class AccountMeshPresence {
  private binding: string | null = null;
  private generation = 0;
  private nextAttemptAt = 0;
  private busy = false;
  private disposed = false;
  private invoke: MeshInvoke;
  private enabled: boolean;
  private now: () => number;
  constructor(invoke: MeshInvoke, enabled: boolean, now = Date.now) {
    this.invoke = invoke; this.enabled = enabled; this.now = now;
  }
  updateNetwork(network: AccountNetwork | null): void {
    const next = identity(network);
    if (next !== this.binding) {
      this.binding = next; this.generation++; this.nextAttemptAt = 0;
    }
  }
  dispose(): void { this.disposed = true; this.generation++; this.binding = null; }
  async reportIfDue(): Promise<boolean> {
    if (!this.enabled || this.disposed || !this.binding || this.busy || this.now() < this.nextAttemptAt) return false;
    const generation = this.generation;
    this.busy = true;
    // Set before I/O: concurrent refresh/focus events cannot produce a request storm.
    this.nextAttemptAt = this.now() + RETRY_MS;
    try {
      const receipt = await this.invoke<PresenceReceipt>("mesh_device_presence_report");
      if (this.disposed || generation !== this.generation) return false;
      if (receipt?.accepted !== true || receipt.reportedRecently !== true || receipt.paired !== false ||
          receipt.transportReady !== false || receipt.remoteJobsEnabled !== false ||
          !Number.isSafeInteger(receipt.nextPollSeconds) || receipt.nextPollSeconds < 300 || receipt.nextPollSeconds > 3600)
        return false;
      this.nextAttemptAt = this.now() + receipt.nextPollSeconds * 1000;
      return true;
    } catch {
      // A transient presence error cannot clear verified peer pins or fabricate offline state.
      return false;
    } finally { this.busy = false; }
  }
}
