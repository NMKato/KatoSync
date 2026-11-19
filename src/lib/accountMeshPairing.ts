// Created by NMKato Solutions
// Signed message choreography only. This class never approves a key or starts a job.
import { eligiblePeer, sameDeviceBinding, DEVICE_ID, type AccountNetwork, type PairingProof } from "./accountMeshContract.ts";
import { matchEasyRelayMessage, validEasyMeshSession, type EasyMeshSession } from "./meshEasyPairing.ts";

export type MeshInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
type PublicOffer = { protocol: string; publicKey: string; nonce: string; expiresAt: number; accountScope: string; signature: string };
type Invitation = { requestId: string; sourceDeviceId: string; expiresAt: string; fingerprint: string; signedOffer: PublicOffer };
type RelayMessage = { requestId: string; senderDeviceId: string; recipientDeviceId: string; kind: "challenge" | "response"; payloadJson: string; expiresAt: number };
export interface PairingState {
  phase: "idle" | "waiting" | "verifying" | "review" | "expired" | "error";
  session: EasyMeshSession | null; proof: PairingProof | null; issue: string | null;
}
const idle = (): PairingState => ({ phase: "idle", session: null, proof: null, issue: null });
function delivery(data: { paired?: unknown; transportReady?: unknown; remoteJobsEnabled?: unknown }): void {
  if (data.paired !== false || data.transportReady !== false || data.remoteJobsEnabled !== false) throw Error("MESH_PAIRING_INVALID_RECEIPT");
}
function checkedProof(value: PairingProof, session: EasyMeshSession, now: number): PairingProof {
  if (!validEasyMeshSession(session, now) || value?.paired !== false || value.peerCount !== 0 || value.transportReady !== false ||
      value.fingerprint !== session.peerFingerprint || !/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(value.comparisonCode))
    throw Error("MESH_PAIRING_INVALID_PROOF");
  return value;
}

export class AccountMeshPairing {
  private network: AccountNetwork | null = null;
  private state: PairingState = idle();
  private generation = 0;
  private busy = false;
  private disposed = false;
  private invoke: MeshInvoke;
  private changed: (state: PairingState) => void;
  private now: () => number;
  constructor(invoke: MeshInvoke, changed: (state: PairingState) => void, now = Date.now) {
    this.invoke = invoke; this.changed = changed; this.now = now;
  }
  get snapshot(): PairingState { return this.state; }
  get inFlight(): boolean { return this.busy; }
  private publish(state: PairingState): void { this.state = state; if (!this.disposed) this.changed(state); }
  updateNetwork(network: AccountNetwork): void {
    if (this.network && this.state.session && !sameDeviceBinding(this.network, network, this.state.session.peerDeviceId)) {
      this.generation++;
      this.publish({ phase: "error", session: null, proof: null, issue: "MESH_ACCOUNT_BINDING_CHANGED" });
    }
    this.network = network;
  }
  cancel(): void { this.generation++; this.publish(idle()); }
  dispose(): void { this.disposed = true; this.generation++; this.network = null; }
  private current(generation: number, network: AccountNetwork, peerId?: string): boolean {
    return !this.disposed && generation === this.generation && !!this.network &&
      network.ownerId === this.network.ownerId && network.localDeviceId === this.network.localDeviceId &&
      (!peerId || sameDeviceBinding(network, this.network, peerId));
  }
  private failure(error: unknown, generation: number): void {
    if (this.disposed || generation !== this.generation) return;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "MESH_PAIRING_FAILED";
    this.publish({ ...this.state, phase: /EXPIRED/.test(message) ? "expired" : "error", proof: null,
      issue: /^MESH_[A-Z0-9_]{1,120}$/.test(message) ? message : "MESH_PAIRING_FAILED" });
  }
  async request(peerId: string): Promise<void> {
    const network = this.network;
    if (!network || this.busy || this.state.session || this.disposed) return;
    const peer = eligiblePeer(network, peerId);
    if (!peer || !network.localDeviceId) throw Error("MESH_ACCOUNT_BINDING_CHANGED");
    this.busy = true;
    const generation = ++this.generation;
    this.publish({ phase: "verifying", session: null, proof: null, issue: null });
    try {
      const result = await this.invoke<{ requestId: string; expiresAt: string; deliveryOnly: boolean; paired: false; transportReady: false; remoteJobsEnabled: false }>(
        "mesh_inbox_invite_send", { targetDeviceId: peerId });
      delivery(result);
      const session: EasyMeshSession = { role: "sender", requestId: result.requestId, localDeviceId: network.localDeviceId,
        peerDeviceId: peerId, peerFingerprint: peer.fingerprint, expiresAtMs: Date.parse(result.expiresAt) };
      if (!result.deliveryOnly || !validEasyMeshSession(session, this.now())) throw Error("MESH_PAIRING_INVALID_RECEIPT");
      if (this.current(generation, network, peerId)) this.publish({ phase: "waiting", session, proof: null, issue: null });
    } catch (error) { this.failure(error, generation); }
    finally { this.busy = false; }
  }
  async tick(): Promise<void> {
    const network = this.network;
    if (!network || !network.localDeviceId || !network.mainDeviceId || this.busy || this.disposed ||
        ["review", "error", "expired"].includes(this.state.phase)) return;
    const session = this.state.session;
    if (session && !validEasyMeshSession(session, this.now())) {
      this.publish({ ...this.state, phase: "expired", proof: null, issue: "MESH_PAIRING_EXPIRED" }); return;
    }
    this.busy = true;
    const generation = this.generation;
    try {
      if (session) {
        // Simultaneous clicks must converge on one exchange: the lexically larger
        // device accepts the smaller device's request, without changing any trust.
        if (session.role === "sender" && session.localDeviceId > session.peerDeviceId &&
            await this.receiveInvitation(network, generation, session.peerDeviceId)) return;
        await this.receiveRelay(network, session, generation);
      }
      else await this.receiveInvitation(network, generation);
    } catch (error) { this.failure(error, generation); }
    finally { this.busy = false; }
  }
  private async receiveInvitation(network: AccountNetwork, generation: number, expectedPeerId?: string): Promise<boolean> {
    const inbox = await this.invoke<{ invitations: Invitation[]; paired: false; transportReady: false; remoteJobsEnabled: false }>("mesh_inbox_recipient_list");
    delivery(inbox);
    if (!Array.isArray(inbox.invitations) || inbox.invitations.length > 10) throw Error("MESH_PAIRING_INVALID_RECEIPT");
    if (!this.current(generation, network)) return false;
    const invitation = inbox.invitations.find(item => {
      const peer = eligiblePeer(network, item.sourceDeviceId);
      return peer && (!expectedPeerId || item.sourceDeviceId === expectedPeerId) && DEVICE_ID.test(item.requestId) && item.fingerprint === peer.fingerprint &&
        item.signedOffer?.publicKey === peer.publicKey && item.signedOffer.protocol === "katosync-mesh-pairing-v1" &&
        /^[A-Za-z0-9_-]{86}$/.test(item.signedOffer.signature) && /^[A-Za-z0-9_-]{43}$/.test(item.signedOffer.nonce) &&
        /^[A-Za-z0-9_-]{43}$/.test(item.signedOffer.accountScope) &&
        Number.isSafeInteger(item.signedOffer.expiresAt) && item.signedOffer.expiresAt * 1000 === Date.parse(item.expiresAt) &&
        Date.parse(item.expiresAt) > this.now() && Date.parse(item.expiresAt) <= this.now() + 600_000;
    });
    if (!invitation) return false;
    const peerId = invitation.sourceDeviceId;
    // Accepting here ONLY exchanges public, signed possession proofs. It grants no trust.
    // The native account approval is a separate command behind an explicit user click.
    const accepted = await this.invoke<{ requestId: string; state: string; decisionOnly: boolean; paired: false; transportReady: false; remoteJobsEnabled: false }>(
      "mesh_inbox_recipient_decide", { requestId: invitation.requestId, action: "accept" });
    delivery(accepted);
    if (accepted.requestId !== invitation.requestId || accepted.state !== "accepted" || !accepted.decisionOnly)
      throw Error("MESH_PAIRING_INVALID_RECEIPT");
    if (!this.current(generation, network, peerId)) return false;
    const session: EasyMeshSession = { role: "recipient", requestId: invitation.requestId, localDeviceId: network.localDeviceId!,
      peerDeviceId: peerId, peerFingerprint: invitation.fingerprint, expiresAtMs: Date.parse(invitation.expiresAt) };
    if (!validEasyMeshSession(session, this.now())) throw Error("MESH_PAIRING_EXPIRED");
    this.publish({ phase: "verifying", session, proof: null, issue: null });
    const payloadJson = await this.invoke<string>("mesh_pairing_challenge_create", { offerJson: JSON.stringify(invitation.signedOffer) });
    const challenge = JSON.parse(payloadJson);
    if (challenge.protocol !== "katosync-mesh-challenge-v1" || !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.expiresAt * 1000 <= this.now() || challenge.expiresAt > invitation.signedOffer.expiresAt ||
        Object.keys(invitation.signedOffer).some(key => challenge.offer?.[key] !== invitation.signedOffer[key as keyof PublicOffer]))
      throw Error("MESH_PAIRING_INVALID_PROOF");
    if (!this.current(generation, network, peerId)) return false;
    await this.sendRelay(session, "challenge", payloadJson);
    if (this.current(generation, network, peerId)) this.publish({ phase: "waiting", session, proof: null, issue: null });
    return true;
  }
  private async sendRelay(session: EasyMeshSession, kind: "challenge" | "response", payloadJson: string): Promise<void> {
    if (!validEasyMeshSession(session, this.now())) throw Error("MESH_PAIRING_EXPIRED");
    const sent = await this.invoke<{ messageId: string; deliveryOnly: boolean; paired: false; transportReady: false; remoteJobsEnabled: false }>(
      "mesh_pairing_relay_send", { requestId: session.requestId, recipientDeviceId: session.peerDeviceId, kind, payloadJson });
    delivery(sent);
    if (!sent.deliveryOnly || !DEVICE_ID.test(sent.messageId)) throw Error("MESH_PAIRING_INVALID_RECEIPT");
  }
  private async receiveRelay(network: AccountNetwork, session: EasyMeshSession, generation: number): Promise<void> {
    const received = await this.invoke<{ messages: RelayMessage[]; deliveryOnly: boolean; paired: false; transportReady: false; remoteJobsEnabled: false }>("mesh_pairing_relay_list");
    delivery(received);
    if (!received.deliveryOnly || !Array.isArray(received.messages) || received.messages.length > 10) throw Error("MESH_PAIRING_INVALID_RECEIPT");
    if (!this.current(generation, network, session.peerDeviceId)) return;
    const message = received.messages.find(m => typeof m.payloadJson === "string" && m.payloadJson.length <= 8192 && matchEasyRelayMessage(session, m, this.now()));
    if (!message) return;
    this.publish({ phase: "verifying", session, proof: null, issue: null });
    let proof: PairingProof;
    if (session.role === "sender") {
      const response = await this.invoke<[string, PairingProof]>("mesh_pairing_response_create", { challengeJson: message.payloadJson });
      if (!Array.isArray(response) || response.length !== 2 || typeof response[0] !== "string" ||
          JSON.parse(response[0]).protocol !== "katosync-mesh-response-v1") throw Error("MESH_PAIRING_INVALID_PROOF");
      proof = checkedProof(response[1], session, this.now());
      if (!this.current(generation, network, session.peerDeviceId)) return;
      await this.sendRelay(session, "response", response[0]);
    } else {
      proof = checkedProof(await this.invoke<PairingProof>("mesh_pairing_response_verify", { responseJson: message.payloadJson }), session, this.now());
    }
    if (this.current(generation, network, session.peerDeviceId) && validEasyMeshSession(session, this.now()))
      this.publish({ phase: "review", session, proof, issue: null });
  }
}
