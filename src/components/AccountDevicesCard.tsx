// Created by NMKato Solutions
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Laptop, Monitor, RefreshCcw, Server, ShieldCheck, Unplug, Wifi, X } from "lucide-react";
import { useT } from "../i18n";
import { useAccountMesh, type AccountMeshModel } from "../contexts/AccountMeshContext";
import { accountMeshCopy, type MeshDeviceCopy } from "../lib/accountMeshCopy";
import { defaultPeer, deviceConnection, deviceName, devicePresentationState, eligiblePeer, type AccountDevice, type ConnectionMode } from "../lib/accountMeshContract";
import { hasMeshConnectionActivity } from "../lib/meshConnectionState";
import "./accountDevices.css";

function DeviceIcon({ device, main = false }: { device: AccountDevice; main?: boolean }) {
  return main ? <Server size={23} aria-hidden="true" /> : device.platformOs === "macos" ?
    <Laptop size={23} aria-hidden="true" /> : <Monitor size={23} aria-hidden="true" />;
}
function formatSeen(at: string | null, lang: string, c: MeshDeviceCopy): string {
  if (!at) return c.neverSeen;
  return `${c.lastSeen} ${new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(at))}`;
}
function issueText(issue: AccountMeshModel["issue"], c: MeshDeviceCopy): string | null {
  return issue ? ({ account: c.issueAccount, changed: c.issueChanged, registration: c.issueRegistration,
    expired: c.issueExpired, network: c.issueNetwork, busy: c.issueBusy, start: c.issueStart, retry: c.issueRetry })[issue] : null;
}
function Dialog({ title, children, onClose, busy, closeLabel }: { title: string; children: ReactNode; onClose: () => void; busy: boolean; closeLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="account-device-dialog" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h3 id={id}>{title}</h3><button type="button" className="ghost" autoFocus disabled={busy}
      aria-label={closeLabel} onClick={onClose}><X size={19} /></button></header>
    {children}
  </dialog>;
}
function ModeChoices({ mode, onChange, disabled, c }: { mode: ConnectionMode; onChange: (value: ConnectionMode) => void; disabled: boolean; c: MeshDeviceCopy }) {
  const name = useId();
  return <fieldset className="account-device-modes" disabled={disabled}>
    <legend>{c.access}</legend>
    {(["ask", "automatic"] as const).map(value => <label key={value} data-selected={mode === value}>
      <input name={name} type="radio" value={value} checked={mode === value} onChange={() => onChange(value)} />
      <span><strong>{c[value]}</strong><small>{value === "ask" ? c.askHelp : c.automaticHelp}</small></span>
    </label>)}
    <p className="account-device-scope"><ShieldCheck size={16} aria-hidden="true" />{c.accessScope}</p>
  </fieldset>;
}

export function AccountDevicesCard({ refreshEpoch = 0 }: { refreshEpoch?: number }) {
  const model = useAccountMesh(), { lang } = useT();
  const c = accountMeshCopy(lang), { network, runtime, approved, loading, busy, now } = model;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("ask");
  const [mainDialog, setMainDialog] = useState<{ selected: string; revision: number } | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [manageMode, setManageMode] = useState<ConnectionMode>("ask");
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const seenRefresh = useRef(refreshEpoch);
  useEffect(() => {
    if (seenRefresh.current === refreshEpoch) return;
    seenRefresh.current = refreshEpoch; void model.refresh();
  }, [refreshEpoch, model.refresh]);
  useEffect(() => {
    if (!network) { setSelectedId(null); return; }
    setSelectedId(previous => previous && eligiblePeer(network, previous) ? previous : defaultPeer(network));
  }, [network]);
  const savedMode = runtime?.profiles.find(p => p.peerDeviceId === selectedId)?.mode;
  useEffect(() => { setMode(savedMode ?? "ask"); }, [selectedId, savedMode]);
  const own = network?.devices.find(d => d.deviceId === network.localDeviceId);
  const main = network?.devices.find(d => d.deviceId === network.mainDeviceId);
  const selected = network?.devices.find(d => d.deviceId === selectedId);
  const peers = network?.devices.filter(d => d.deviceId !== network.localDeviceId) ?? [];
  const old = peers.filter(d => d.deviceId !== network?.mainDeviceId && !approved.includes(d.fingerprint) &&
    (!d.lastSeenAt || now - Date.parse(d.lastSeenAt) > 7 * 86_400_000));
  const recent = peers.filter(d => !old.includes(d)).sort((a, b) =>
    Number(b.deviceId === network?.mainDeviceId) - Number(a.deviceId === network?.mainDeviceId) ||
    (Date.parse(b.lastSeenAt ?? "") || 0) - (Date.parse(a.lastSeenAt ?? "") || 0));
  const state = network && selected ? deviceConnection(network, runtime, selected.deviceId) : null;
  const active = hasMeshConnectionActivity(state);
  const pairingActive = ["waiting", "verifying", "review"].includes(model.pairing.phase);
  const managed = network?.devices.find(d => d.deviceId === manageId);
  const manageProfile = runtime?.profiles.find(p => p.peerDeviceId === manageId);
  const message = issueText(model.issue, c);
  const hasMain = !!main && network?.mainDeviceAvailable;
  const serverReady = runtime?.serverState === "listening" && runtime.accountRevision === network?.accountRevision &&
    runtime.mainDeviceId === own?.deviceId && own?.deviceId === network?.mainDeviceId;
  const openMain = () => network && setMainDialog({ selected: own?.deviceId ?? network.devices.find(d => d.membershipState !== "revoked")?.deviceId ?? "", revision: network.accountRevision });

  const renderDevice = (device: AccountDevice) => {
    const mainRole = device.deviceId === network?.mainDeviceId;
    const selectable = network ? !!eligiblePeer(network, device.deviceId) : false;
    const status = network ? devicePresentationState(network, runtime, device.deviceId, approved, now) : "registered";
    return <div className="account-device-row" key={device.deviceId} data-selected={selectedId === device.deviceId}>
      <label className="account-device-select" data-disabled={!selectable}>
        <input type="radio" name="account-device-selection" checked={selectedId === device.deviceId}
          disabled={!selectable || busy || pairingActive} onChange={() => setSelectedId(device.deviceId)} />
        <span className="account-device-icon"><DeviceIcon device={device} main={mainRole} /></span>
        <span className="account-device-description"><strong>{deviceName(device)}</strong>
          <small>{mainRole ? c.main : c.participant} · {device.platformOs === "macos" ? "macOS" : device.platformOs === "windows" ? "Windows" : "Linux"}</small>
          <span className="account-device-seen">{formatSeen(device.lastSeenAt, lang, c)}</span>
        </span>
        <span className="account-device-state" data-state={status}><span aria-hidden="true" />{c[status]}</span>
      </label>
      {approved.includes(device.fingerprint) ? <button type="button" className="ghost account-device-manage" disabled={busy}
        onClick={() => { setManageId(device.deviceId); setManageMode(runtime?.profiles.find(p => p.peerDeviceId === device.deviceId)?.mode ?? "ask"); setRevokeConfirm(false); }}>
        {c.manage}<ChevronRight size={14} aria-hidden="true" /></button> : null}
      {!selectable && device.membershipState !== "revoked" && hasMain ? <small className="account-device-via-main">{c.throughMain}</small> : null}
    </div>;
  };

  return <section className="account-devices-card glass" aria-labelledby="account-devices-title" aria-busy={loading}>
    <header className="account-devices-heading">
      <div className="account-devices-heading-copy"><span className="account-devices-eyebrow"><ShieldCheck size={14} aria-hidden="true" />KatoSync</span>
        <h3 id="account-devices-title">{c.title}</h3><p>{c.subtitle}</p></div>
      <button type="button" className="secondary account-devices-refresh" disabled={loading || busy} onClick={() => void model.refresh()}>
        <RefreshCcw size={16} className={loading ? "spin" : ""} aria-hidden="true" />{c.refresh}</button>
    </header>
    <ol className="account-device-steps" aria-label={c.title}>
      {[c.stepAccount, c.stepMain, c.stepConnect].map((text, index) => <li key={text}
        data-complete={index === 0 ? network?.accountVerified : index === 1 ? hasMain :
          !!network && peers.some(d => devicePresentationState(network, runtime, d.deviceId, approved, now) === "connected")}>
        <span>{index === 0 && network?.accountVerified || index === 1 && hasMain ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{text}
      </li>)}
    </ol>
    {loading && !network ? <p className="account-devices-loading" role="status"><RefreshCcw size={18} className="spin" />{c.loading}</p> : null}
    {message ? <div className="account-devices-feedback" role="alert"><p>{message}</p>
      {model.pairing.phase === "error" || model.pairing.phase === "expired" ? <button type="button" className="secondary" disabled={busy} onClick={model.cancelPairing}>{c.retry}</button> : null}
    </div> : null}
    {network && !own ? <section className="account-devices-add"><Laptop size={28} aria-hidden="true" />
      <div><h4>{c.addTitle}</h4><p>{c.addHelp}</p></div>
      <button type="button" className="primary" disabled={busy || loading} onClick={() => void model.addThisDevice()}>{busy ? <RefreshCcw size={15} className="spin" /> : null}{c.add}</button>
    </section> : null}
    {own ? <div className="account-devices-own"><Laptop size={17} aria-hidden="true" /><strong>{deviceName(own)}</strong>
      <span>{c.thisDevice}</span><small>{own.membershipState === "revoked" ? c.revoked : c.account}</small></div> : null}
    {network ? <section className="account-main-device" data-configured={hasMain}>
      <div className="account-main-symbol"><Server size={26} aria-hidden="true" /></div>
      <div className="account-main-copy"><span className="account-devices-eyebrow">{c.main}</span>
        <h4>{main ? deviceName(main) : c.noMain}</h4>
        <p>{main ? !network.mainDeviceAvailable ? c.mainUnavailableHelp : main.deviceId === own?.deviceId ? c.mainHelp : c.mainFixed : c.mainHelp}</p>
        {main ? <span className="account-main-status" data-ready={serverReady}>{!network.mainDeviceAvailable ? c.mainUnavailable : serverReady ? c.mainReady : c.mainChosen}</span> : null}
      </div>
      <div className="account-main-actions">
        {!main && own && own.membershipState !== "revoked" ? <button type="button" className="primary" disabled={busy || loading}
          onClick={() => void model.setPrimary(own.deviceId, network.accountRevision)}>{c.useThisMain}</button> : null}
        <button type="button" className="ghost" disabled={busy || loading || !network.devices.some(d => d.membershipState !== "revoked")}
          onClick={openMain}>{main ? c.changeMain : c.chooseMain}</button>
      </div>
    </section> : null}
    {network ? <section className="account-device-picker" aria-labelledby="account-device-picker-title">
      <div className="account-device-section-heading"><div><h4 id="account-device-picker-title">{c.selectTitle}</h4><p>{c.selectHelp}</p></div>
        <small>{network.devices.length} {c.deviceCount}</small></div>
      {!peers.length ? <div className="account-devices-empty"><Wifi size={28} aria-hidden="true" /><strong>{c.empty}</strong><p>{c.emptyHelp}</p></div> : <>
        <div className="account-device-list" role="group" aria-label={c.available}>{recent.map(renderDevice)}</div>
        {old.length ? <details className="account-device-older"><summary>{c.older} ({old.length})</summary><div className="account-device-list">{old.map(renderDevice)}</div></details> : null}
      </>}
    </section> : null}
    {selected && network && eligiblePeer(network, selected.deviceId) ? <section className="account-device-connect-area" aria-label={c.access}>
      {!active && !pairingActive && approved.includes(selected.fingerprint) ? <ModeChoices mode={mode} onChange={setMode} disabled={busy} c={c} /> : null}
      {pairingActive ? <div className="account-device-progress" role="status" aria-live="polite">
        <RefreshCcw className="spin" size={18} aria-hidden="true" /><div><strong>{model.review ? c.notificationTitle : model.pairing.phase === "verifying" ? c.checking : c.requestSent}</strong>
          <p>{model.review ? c.reviewIntro : c.waiting}</p></div>
        {model.review ? <button className="primary" type="button" disabled={busy} onClick={model.openReview}>{c.notificationAction}</button> : null}
        <button className="ghost" type="button" disabled={busy} onClick={model.cancelPairing}>{c.cancel}</button>
      </div> : <div className="account-device-connect-actions">
        <p><span>{c.thisDevice}</span><ChevronRight size={17} aria-hidden="true" /><strong>{deviceName(selected)}</strong></p>
        {active ? <button type="button" className="secondary" disabled={busy} onClick={() => void model.stop(selected.deviceId)}><Unplug size={16} aria-hidden="true" />{c.stop}</button> :
          <button type="button" className="primary" disabled={busy || loading} onClick={() => void model.connect(selected.deviceId, mode)}><Wifi size={17} aria-hidden="true" />{c.connect}</button>}
      </div>}
      {active || runtime?.profiles.some(p => p.peerDeviceId === selected.deviceId && !p.enabled) ? <p className="account-device-secondary-note">{c.stoppedHint}</p> : null}
    </section> : peers.length && hasMain ? <p className="account-device-select-hint">{c.selectFirst}</p> : null}
    <footer className="account-devices-footer"><Wifi size={16} aria-hidden="true" /><p>{c.networkHint}</p></footer>
    <details className="account-device-details"><summary>{c.details}</summary><p>{c.detailsHint}</p><p>{c.noLiveClaim}</p><p>{c.refreshHint}</p>
      {network ? <dl><div><dt>{c.deviceCount}</dt><dd>{network.devices.length}</dd></div><div><dt>{c.main}</dt><dd>{main ? deviceName(main) : "—"}</dd></div></dl> : null}
    </details>
    {mainDialog && network ? <Dialog title={main ? c.changeTitle : c.chooseMain} onClose={() => setMainDialog(null)} busy={busy} closeLabel={c.close}>
      <p>{main ? c.changeHelp : c.mainHelp}</p>{main ? <p className="account-device-dialog-current">{c.currentMain}: <strong>{deviceName(main)}</strong></p> : null}
      <fieldset className="account-main-options"><legend>{c.newMain}</legend>
        {network.devices.filter(d => ["discovered", "trusted"].includes(d.membershipState)).map(device => <label key={device.deviceId} data-selected={mainDialog.selected === device.deviceId}>
          <input type="radio" name="account-main-choice" checked={mainDialog.selected === device.deviceId} disabled={busy}
            onChange={() => setMainDialog({ ...mainDialog, selected: device.deviceId })} />
          <DeviceIcon device={device} /><span><strong>{deviceName(device)}</strong><small>{device.deviceId === own?.deviceId ? c.thisDevice : formatSeen(device.lastSeenAt, lang, c)}</small></span>
        </label>)}
      </fieldset>
      {message ? <p className="account-devices-feedback" role="alert">{message}</p> : null}
      <footer><button className="secondary" type="button" disabled={busy} onClick={() => setMainDialog(null)}>{c.cancel}</button>
        <button className="primary" type="button" disabled={busy || !mainDialog.selected || mainDialog.selected === network.mainDeviceId}
          onClick={async () => { if (await model.setPrimary(mainDialog.selected, mainDialog.revision)) setMainDialog(null); }}>{c.saveMain}</button></footer>
    </Dialog> : null}
    {managed ? <Dialog title={revokeConfirm ? c.revokeTitle : c.manage} onClose={() => setManageId(null)} busy={busy} closeLabel={c.close}>
      <div className="account-device-review-name"><DeviceIcon device={managed} /><strong>{deviceName(managed)}</strong></div>
      {revokeConfirm ? <p>{c.revokeHelp}</p> : <ModeChoices mode={manageMode} onChange={setManageMode} disabled={busy} c={c} />}
      {message ? <p className="account-devices-feedback" role="alert">{message}</p> : null}
      <footer>{revokeConfirm ? <><button type="button" className="secondary" disabled={busy} onClick={() => setRevokeConfirm(false)}>{c.cancel}</button>
        <button type="button" className="ghost danger" disabled={busy} onClick={async () => { if (await model.revoke(managed.deviceId)) setManageId(null); }}>{c.revoke}</button></> : <>
        <button type="button" className="ghost danger" disabled={busy} onClick={() => setRevokeConfirm(true)}>{c.revoke}</button>
        <button type="button" className="primary" disabled={busy || manageMode === manageProfile?.mode} onClick={async () => { if (await model.setMode(managed.deviceId, manageMode)) setManageId(null); }}>{c.saveAccess}</button></>}</footer>
    </Dialog> : null}
  </section>;
}

export function AccountDeviceNotifications({ onOpenDevices, devicesVisible = false }: { onOpenDevices: () => void; devicesVisible?: boolean }) {
  const model = useAccountMesh(), { lang } = useT(), c = accountMeshCopy(lang);
  const [dismissed, setDismissed] = useState<string[]>([]), [mode, setMode] = useState<ConnectionMode>("ask");
  const reviewPeer = model.network?.devices.find(d => d.deviceId === model.review?.peerDeviceId);
  const detected = model.network?.devices.find(d => d.deviceId !== model.network?.localDeviceId &&
    d.membershipState !== "revoked" && !model.approved.includes(d.fingerprint) && !dismissed.includes(d.fingerprint) &&
    d.lastSeenAt && model.now - Date.parse(d.lastSeenAt) < 86_400_000);
  useEffect(() => { setMode("ask"); }, [model.review?.reviewId]);
  const notification = reviewPeer ?? detected;
  return <>
    {notification && (!devicesVisible || !!reviewPeer) && !model.reviewOpen && !dismissed.includes(model.review?.reviewId ?? notification.fingerprint) ? <aside className="account-device-notification" role="status" aria-live="polite">
      <span className="account-device-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
      <div><strong>{reviewPeer ? c.notificationTitle : c.detectedTitle}</strong><p>{deviceName(notification)}</p>
        <button type="button" className="link-button" onClick={reviewPeer ? model.openReview : onOpenDevices}>{reviewPeer ? c.notificationAction : c.detectedAction}<ChevronRight size={15} aria-hidden="true" /></button></div>
      <button type="button" className="ghost account-device-dismiss" aria-label={c.dismiss} onClick={() => setDismissed(items => [...items, model.review?.reviewId ?? notification.fingerprint])}><X size={17} /></button>
    </aside> : null}
    {model.reviewOpen && model.review && reviewPeer ? <Dialog title={c.reviewTitle} onClose={model.closeReview} busy={model.busy} closeLabel={c.close}>
      <p>{c.reviewIntro}</p><div className="account-device-review-name"><DeviceIcon device={reviewPeer} main={reviewPeer.deviceId === model.network?.mainDeviceId} />
        <span><strong>{deviceName(reviewPeer)}</strong><small>{reviewPeer.deviceId === model.network?.mainDeviceId ? c.main : c.participant}</small></span><ShieldCheck size={20} aria-hidden="true" /></div>
      <ModeChoices mode={mode} onChange={setMode} disabled={model.busy} c={c} /><p className="account-device-secondary-note">{c.approvalOnce}</p>
      {model.issue ? <p className="account-devices-feedback" role="alert">{issueText(model.issue, c)}</p> : null}
      <footer><button type="button" className="secondary" disabled={model.busy} onClick={model.closeReview}>{c.later}</button>
        <button type="button" className="primary" disabled={model.busy || model.review.expiresAt <= model.now} onClick={() => void model.approve(mode)}>
          {model.busy ? <RefreshCcw size={15} className="spin" /> : <ShieldCheck size={16} />}{c.approveConnect}</button></footer>
    </Dialog> : null}
  </>;
}
