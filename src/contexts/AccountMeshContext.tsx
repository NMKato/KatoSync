// Created by NMKato Solutions
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AccountMeshPairing, type PairingState } from "../lib/accountMeshPairing";
import { DEVICE_FINGERPRINT, eligiblePeer, meshIssue, parseAccountNetwork, parseAccountRuntime, sameDeviceBinding,
  type AccountNetwork, type AccountRuntime, type ConnectionMode } from "../lib/accountMeshContract";

export interface DeviceApprovalReview {
  version: 1; reviewId: string; peerDeviceId: string; peerFingerprint: string;
  expectedRevision: number; expiresAt: number; proofReady: true;
}
type Issue = ReturnType<typeof meshIssue>;
export interface AccountMeshModel {
  network: AccountNetwork | null; runtime: AccountRuntime | null; approved: string[];
  loading: boolean; busy: boolean; issue: Issue | null; pairing: PairingState;
  review: DeviceApprovalReview | null; reviewOpen: boolean; now: number;
  refresh: () => Promise<void>; addThisDevice: () => Promise<void>;
  setPrimary: (deviceId: string, expectedRevision: number) => Promise<boolean>;
  connect: (peerId: string, mode: ConnectionMode) => Promise<void>;
  stop: (peerId: string) => Promise<void>; setMode: (peerId: string, mode: ConnectionMode) => Promise<boolean>;
  revoke: (peerId: string) => Promise<boolean>; approve: (mode: ConnectionMode) => Promise<void>;
  openReview: () => void; closeReview: () => void; cancelPairing: () => void;
}
export const AccountMeshContext = createContext<AccountMeshModel | null>(null);
const emptyPairing = (): PairingState => ({ phase: "idle", session: null, proof: null, issue: null });
function retireNativeReview(reviewId: unknown): void {
  if (typeof reviewId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(reviewId))
    void invoke("mesh_account_peer_cancel_review", { reviewId }).catch(() => {});
}

export function AccountMeshProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<AccountNetwork | null>(null);
  const [runtime, setRuntime] = useState<AccountRuntime | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [pairing, setPairing] = useState<PairingState>(emptyPairing);
  const [review, setReview] = useState<DeviceApprovalReview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const account = useRef<AccountNetwork | null>(null);
  const reviewRef = useRef<DeviceApprovalReview | null>(null);
  const engine = useRef<AccountMeshPairing | null>(null);
  const epoch = useRef(0), mounted = useRef(false), reading = useRef(false), mutating = useRef(false);
  const resumeOwner = useRef<string | null>(null);
  const statusReading = useRef(false);
  const operationVersion = useRef(0);
  const invalidateReview = useCallback(() => {
    const prior = reviewRef.current;
    reviewRef.current = null; setReview(null); setReviewOpen(false);
    if (prior) retireNativeReview(prior.reviewId);
  }, []);

  const installNetwork = useCallback((next: AccountNetwork) => {
    const before = account.current;
    if (before && (before.ownerId !== next.ownerId || before.localDeviceId !== next.localDeviceId ||
        before.localFingerprint !== next.localFingerprint || before.localPublicKey !== next.localPublicKey)) {
      setRuntime(null); setApproved([]); invalidateReview();
      resumeOwner.current = null; engine.current?.cancel();
    }
    const pending = reviewRef.current;
    if (before && pending && (!sameDeviceBinding(before, next, pending.peerDeviceId) || !eligiblePeer(next, pending.peerDeviceId))) {
      invalidateReview(); engine.current?.cancel(); setIssue("changed");
    }
    account.current = next; setNetwork(next); engine.current?.updateNetwork(next);
  }, [invalidateReview]);
  const readPins = useCallback(async (next: AccountNetwork): Promise<string[]> => {
    if (!next.localDeviceId) return [];
    const pins = await invoke<{ approvalOnly: boolean; transportReady: boolean; remoteJobsEnabled: boolean;
      peers: { fingerprint: string; publicKey: string; status: string }[] }>("mesh_local_approved_peers");
    if (!pins.approvalOnly || pins.transportReady !== false || pins.remoteJobsEnabled !== false ||
        !Array.isArray(pins.peers) || pins.peers.length > 10 || pins.peers.some(p =>
          p.status !== "locally_approved" || !DEVICE_FINGERPRINT.test(p.fingerprint))) throw Error("MESH_ACCOUNT_INVALID_STATE");
    return pins.peers.filter(p => next.devices.some(d => d.fingerprint === p.fingerprint &&
      d.publicKey === p.publicKey && d.membershipState !== "revoked")).map(p => p.fingerprint);
  }, []);
  const refresh = useCallback(async () => {
    if (reading.current || mutating.current || !mounted.current || !window.__TAURI_INTERNALS__) return;
    reading.current = true; setLoading(true);
    const generation = epoch.current, operation = operationVersion.current;
    const valid = () => mounted.current && generation === epoch.current && operation === operationVersion.current;
    try {
      const next = parseAccountNetwork(await invoke("mesh_account_network_get"));
      if (!valid()) return;
      installNetwork(next);
      const pins = await readPins(next);
      if (!valid() || account.current?.ownerId !== next.ownerId || account.current?.localDeviceId !== next.localDeviceId ||
          account.current?.accountRevision !== next.accountRevision) return;
      setApproved(pins);
      if (next.localDeviceId && next.mainDeviceAvailable && resumeOwner.current !== next.ownerId) {
        // Native reads stored profiles and revalidates account, primary revision, pins and revocation.
        // Only explicit automatic profiles may reconnect; ask profiles remain waiting for a click.
        const actual = await invoke("mesh_account_connection_resume");
        if (valid() && account.current?.ownerId === next.ownerId && account.current?.accountRevision === next.accountRevision) {
          const parsed = parseAccountRuntime(actual, next); setRuntime(parsed);
          if (parsed) resumeOwner.current = next.ownerId;
        }
      }
      if (valid()) setIssue(null);
    } catch (error) {
      if (valid()) { setIssue(meshIssue(error)); setRuntime(null); }
    } finally {
      if (mounted.current && generation === epoch.current) { reading.current = false; setLoading(false); }
    }
  }, [installNetwork, readPins]);
  const mutate = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    if (mutating.current || !mounted.current) return false;
    const generation = epoch.current;
    mutating.current = true; operationVersion.current++; setBusy(true); setIssue(null);
    try { await work(); return mounted.current && generation === epoch.current; }
    catch (error) { if (mounted.current && generation === epoch.current) setIssue(meshIssue(error)); return false; }
    finally { if (mounted.current && generation === epoch.current) { mutating.current = false; setBusy(false); } }
  }, []);
  const freshPeer = useCallback(async (peerId: string): Promise<AccountNetwork> => {
    const before = account.current;
    const next = parseAccountNetwork(await invoke("mesh_account_network_get"));
    if (!before || !sameDeviceBinding(before, next, peerId) || !eligiblePeer(next, peerId)) {
      if (mounted.current) installNetwork(next);
      throw Error("MESH_ACCOUNT_BINDING_CHANGED");
    }
    if (!mounted.current) throw Error("MESH_ACCOUNT_SESSION_CHANGED");
    installNetwork(next); return next;
  }, [installNetwork]);
  const acceptRuntime = useCallback((value: unknown, current: AccountNetwork) => {
    if (!mounted.current || account.current?.ownerId !== current.ownerId ||
        account.current?.localDeviceId !== current.localDeviceId || account.current?.localFingerprint !== current.localFingerprint ||
        account.current?.accountRevision !== current.accountRevision || account.current?.mainDeviceId !== current.mainDeviceId) return;
    setRuntime(parseAccountRuntime(value, current));
  }, []);

  useEffect(() => {
    mounted.current = true; epoch.current++; reading.current = false; mutating.current = false;
    resumeOwner.current = null;
    engine.current = new AccountMeshPairing(invoke, state => {
      if (!mounted.current) return;
      setPairing(state);
      if (state.phase !== "review" && reviewRef.current) invalidateReview();
      if (state.issue) setIssue(meshIssue(state.issue));
    });
    void refresh();
    const cloud = window.setInterval(() => { if (!mutating.current) void refresh(); }, 60_000);
    const relay = window.setInterval(() => { if (!mutating.current) void engine.current?.tick(); }, 12_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const focus = () => { if (!mutating.current) void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      const pendingReview = reviewRef.current; reviewRef.current = null;
      mounted.current = false; epoch.current++; retireNativeReview(pendingReview?.reviewId);
      engine.current?.dispose(); engine.current = null;
      window.clearInterval(cloud); window.clearInterval(relay); window.clearInterval(clock);
      window.removeEventListener("focus", focus);
    };
  }, [refresh, invalidateReview]);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = account.current, generation = epoch.current, operation = operationVersion.current;
      if (current?.localDeviceId && !statusReading.current && !mutating.current && window.__TAURI_INTERNALS__) {
        statusReading.current = true;
        try {
          const actual = await invoke("mesh_account_connection_status");
          if (active && mounted.current && epoch.current === generation && operation === operationVersion.current && account.current?.ownerId === current.ownerId)
            acceptRuntime(actual, current);
        } catch { if (active && epoch.current === generation && operation === operationVersion.current) setRuntime(null); }
        finally { statusReading.current = false; }
      }
      if (active) timer = setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [acceptRuntime]);
  useEffect(() => {
    const current = account.current, session = pairing.session;
    if (pairing.phase !== "review" || !session || !pairing.proof || !current ||
        !eligiblePeer(current, session.peerDeviceId)) return;
    let active = true;
    const generation = epoch.current;
    void invoke<DeviceApprovalReview>("mesh_account_peer_review", {
      peerDeviceId: session.peerDeviceId, peerFingerprint: session.peerFingerprint, expectedRevision: current.accountRevision,
    }).then(actual => {
      if (!active || !mounted.current || generation !== epoch.current) { retireNativeReview(actual?.reviewId); return; }
      if (actual.version !== 1 || typeof actual.reviewId !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(actual.reviewId) || actual.proofReady !== true ||
          actual.peerDeviceId !== session.peerDeviceId || actual.peerFingerprint !== session.peerFingerprint ||
          actual.expectedRevision !== current.accountRevision || !Number.isSafeInteger(actual.expiresAt) ||
          actual.expiresAt <= Date.now() || actual.expiresAt > Date.now() + 300_000) {
        retireNativeReview(actual.reviewId); throw Error("MESH_ACCOUNT_INVALID_STATE");
      }
      reviewRef.current = actual; setReview(actual); setIssue(null);
      if (session.role === "sender") setReviewOpen(true);
    }).catch(error => { if (active && mounted.current && generation === epoch.current) setIssue(meshIssue(error)); });
    return () => { active = false; };
  }, [pairing]);
  useEffect(() => {
    if (review && review.expiresAt <= now) {
      invalidateReview(); engine.current?.cancel(); setIssue("expired");
    }
  }, [review, now, invalidateReview]);

  const addThisDevice = useCallback(async () => { await mutate(async () => {
    await invoke("mesh_account_device_discover");
    const next = parseAccountNetwork(await invoke("mesh_account_network_get"));
    if (!mounted.current) return;
    installNetwork(next); setApproved(await readPins(next));
    if (next.mainDeviceAvailable) acceptRuntime(await invoke("mesh_account_connection_resume"), next);
  }); }, [mutate, installNetwork, readPins, acceptRuntime]);
  const setPrimary = useCallback(async (deviceId: string, expectedRevision: number) => mutate(async () => {
    const next = parseAccountNetwork(await invoke("mesh_account_network_set_primary", { deviceId, expectedRevision }));
    if (!mounted.current) return;
    installNetwork(next); setRuntime(null); invalidateReview();
    engine.current?.cancel();
    acceptRuntime(await invoke("mesh_account_connection_resume"), next);
  }), [mutate, installNetwork, acceptRuntime, invalidateReview]);
  const connect = useCallback(async (peerId: string, mode: ConnectionMode) => { await mutate(async () => {
    const current = await freshPeer(peerId), peer = eligiblePeer(current, peerId)!;
    const pins = await readPins(current);
    if (!mounted.current) return;
    setApproved(pins);
    if (pins.includes(peer.fingerprint)) {
      acceptRuntime(await invoke("mesh_account_connection_start", { peerDeviceId: peerId,
        peerFingerprint: peer.fingerprint, expectedRevision: current.accountRevision, mode }), current);
    } else { await engine.current?.request(peerId); }
  }); }, [mutate, freshPeer, readPins, acceptRuntime]);
  const approve = useCallback(async (mode: ConnectionMode) => { await mutate(async () => {
    const actual = reviewRef.current;
    if (!actual || actual.expiresAt <= Date.now() || engine.current?.snapshot.phase !== "review") throw Error("MESH_PAIRING_EXPIRED");
    const current = await freshPeer(actual.peerDeviceId);
    if (current.accountRevision !== actual.expectedRevision || reviewRef.current?.reviewId !== actual.reviewId)
      throw Error("MESH_ACCOUNT_BINDING_CHANGED");
    let result: unknown;
    try {
      result = await invoke("mesh_account_peer_approve", { reviewId: actual.reviewId, peerDeviceId: actual.peerDeviceId,
        peerFingerprint: actual.peerFingerprint, expectedRevision: actual.expectedRevision, mode });
    } catch (error) {
      if (String(error).includes("MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED") && mounted.current) {
        setApproved(await readPins(current)); invalidateReview(); engine.current?.cancel();
      }
      throw error;
    }
    if (!mounted.current) return;
    acceptRuntime(result, current); setApproved(await readPins(current));
    reviewRef.current = null; setReview(null); setReviewOpen(false); engine.current?.cancel();
  }); }, [mutate, freshPeer, acceptRuntime, readPins, invalidateReview]);
  const stop = useCallback(async (peerId: string) => { await mutate(async () => {
    const current = account.current;
    if (!current) return;
    acceptRuntime(await invoke("mesh_account_connection_stop", { peerDeviceId: peerId }), current);
  }); }, [mutate, acceptRuntime]);
  const setMode = useCallback(async (peerId: string, mode: ConnectionMode) => mutate(async () => {
    const current = await freshPeer(peerId), peer = eligiblePeer(current, peerId)!;
    acceptRuntime(await invoke("mesh_account_connection_set_mode", { peerDeviceId: peerId, peerFingerprint: peer.fingerprint,
      expectedRevision: current.accountRevision, mode }), current);
  }), [mutate, freshPeer, acceptRuntime]);
  const revoke = useCallback(async (peerId: string) => mutate(async () => {
    const current = account.current, peer = current?.devices.find(d => d.deviceId === peerId);
    if (!current || !peer) return;
    acceptRuntime(await invoke("mesh_account_peer_revoke", { peerDeviceId: peerId, peerFingerprint: peer.fingerprint,
      expectedRevision: current.accountRevision }), current);
    if (engine.current?.snapshot.session?.peerDeviceId === peerId) engine.current.cancel();
    if (mounted.current) setApproved(await readPins(current));
  }), [mutate, readPins, acceptRuntime]);
  const cancelPairing = useCallback(() => {
    if (mutating.current) return;
    invalidateReview(); engine.current?.cancel(); setIssue(null);
  }, [invalidateReview]);
  const value = useMemo<AccountMeshModel>(() => ({ network, runtime, approved, loading, busy, issue, pairing, review, reviewOpen, now,
    refresh, addThisDevice, setPrimary, connect, stop, setMode, revoke, approve, cancelPairing,
    openReview: () => setReviewOpen(true), closeReview: () => { if (!mutating.current) setReviewOpen(false); },
  }), [network, runtime, approved, loading, busy, issue, pairing, review, reviewOpen, now,
    refresh, addThisDevice, setPrimary, connect, stop, setMode, revoke, approve, cancelPairing]);
  return <AccountMeshContext.Provider value={value}>{children}</AccountMeshContext.Provider>;
}

export function useAccountMesh(): AccountMeshModel {
  const model = useContext(AccountMeshContext);
  if (!model) throw Error("AccountMeshProvider is required");
  return model;
}
