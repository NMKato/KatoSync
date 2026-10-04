// Created by NMKato Solutions
// Agent Sync: Providerkarten fuer Codex, Claude Code und lokale Modelle. Reine View – alle
// Seiteneffekte laufen ueber das ViewModel (Repository -> Rust-Provider-Adapter).
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  PlugZap,
  RefreshCcw,
  Search,
  ShieldCheck,
  Unplug,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import {
  buildSanitizedProviderDiagnostics,
  currentProviderOwner,
  displayTone,
  LOCAL_PRESETS,
  nextRecheckAt,
  normalizeProviderPriority,
  PROVIDER_INSTALL_GUIDES,
  providerDisplayState,
  validateLocalEndpointInput
} from "../lib/providerPolicy";
import { safeHttpUrl } from "../lib/url";
import { useT, type TKey } from "../i18n";
import type { LocalProviderKind, ProviderId, ProviderReason, ProviderStatus } from "../types";
import type { useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;

const cardProviders: ProviderId[] = ["codex", "claude", "local"];

export const providerIcons = {
  codex: Bot,
  claude: Cloud,
  local: Cpu,
  local_control: ShieldCheck
} as const;

export const fallbackLabels: Record<ProviderId, string> = {
  codex: "OpenAI Codex",
  claude: "Anthropic Claude Code",
  local: "Local Model",
  local_control: "Local Control / RDC"
};

const localKindLabels: Record<LocalProviderKind, string> = {
  ollama: "Ollama",
  lm_studio: "LM Studio",
  open_ai_compatible: "OpenAI-compatible"
};

const knownReasons = new Set<string>([
  "not_checked", "not_installed", "not_configured", "invalid_endpoint", "sign_in_required",
  "ready_test_pending", "ready", "disabled_in_kato_sync", "quota_limited", "capacity_limited",
  "offline", "timed_out", "ready_test_failed", "login_started", "login_in_progress",
  "login_cancelled", "login_timed_out", "login_failed", "no_models", "model_missing",
  "endpoint_auth_required", "endpoint_error", "endpoint_invalid_response", "capability_failed",
  "insecure_remote_key", "secret_store_unavailable", "local_control_running", "local_control_queue_only"
]);

function reasonKey(reason: ProviderReason | string): TKey | null {
  return knownReasons.has(reason) ? (`providers.reason.${reason}` as TKey) : null;
}

function formatTime(value: string | null | undefined, withDate = true): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return withDate ? date.toLocaleString() : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ProviderManager({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const config = vm.config;
  if (!config) return null;
  const priority = normalizeProviderPriority(config.providerPriority);
  const owner = currentProviderOwner(
    vm.providerStatuses,
    priority,
    vm.codexRun.status === "running" ? vm.codexRun.result?.runner ?? config.codexPreferredRunner : null
  );
  const anyBusy = Object.keys(vm.providerBusy).length > 0;
  const localControl = vm.providerStatuses.find((status) => status.provider === "local_control");

  const copyDiagnostics = async () => {
    const ok = await copyText(buildSanitizedProviderDiagnostics(vm.providerStatuses, config.appVersion));
    vm.setNotice({
      kind: ok ? "ok" : "warn",
      text: ok ? t("providers.diagnosticsCopied") : t("providers.diagnosticsFailed")
    });
  };

  return (
    <section className="provider-manager" id="section-agent-sync">
      <div className="provider-hero">
        <div>
          <span className="section-label">{t("providers.eyebrow")}</span>
          <h2>{t("providers.title")}</h2>
          <p>{t("providers.intro")}</p>
        </div>
        <div className="provider-hero-actions">
          <button
            className="secondary"
            disabled={anyBusy}
            onClick={() => void vm.handleRefreshProviders(true)}
            type="button"
          >
            {anyBusy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {t("providers.testAll")}
          </button>
          <button className="ghost" disabled={!vm.providerStatuses.length} onClick={() => void copyDiagnostics()} type="button">
            <Copy size={16} />
            {t("providers.copyDiagnostics")}
          </button>
        </div>
      </div>

      <div className="provider-route-wrap">
        <span className="provider-route-title">{t("providers.routeTitle")}</span>
        <ol className="provider-route" aria-label={t("providers.routeAria")}>
          {priority.map((provider, index) => {
            const status = vm.providerStatuses.find((entry) => entry.provider === provider);
            const Icon = providerIcons[provider];
            const tone = displayTone(providerDisplayState(status, provider));
            return (
              <li className={`provider-route-item ${owner === provider ? "active" : ""}`} key={provider}>
                <span className="provider-route-rank">{index + 1}</span>
                <span className={`provider-dot ${tone}`} aria-hidden="true" />
                <Icon size={16} />
                <span className="provider-route-name">{status?.label ?? fallbackLabels[provider]}</span>
                {owner === provider ? <strong>{t("providers.currentOwner")}</strong> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="provider-cards">
        {cardProviders.map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            rank={priority.indexOf(provider)}
            lastMovable={priority.length - 2}
            status={vm.providerStatuses.find((entry) => entry.provider === provider)}
            vm={vm}
          />
        ))}
      </div>

      <div className="provider-info-grid">
        <div className="provider-policy-note">
          <ShieldCheck size={19} />
          <div>
            <strong>{t("providers.policy.title")}</strong>
            <span>{t("providers.policy.text")}</span>
          </div>
        </div>
        <div className="provider-policy-note">
          <KeyRound size={19} />
          <div>
            <strong>{t("providers.ownership.title")}</strong>
            <span>{t("providers.ownership.text")}</span>
          </div>
        </div>
        <div className="provider-policy-note">
          <ShieldCheck size={19} />
          <div>
            <strong>{t("providers.fallback.title")}</strong>
            <span>
              {t(
                reasonKey(localControl?.reason ?? "local_control_queue_only") ??
                  "providers.reason.local_control_queue_only"
              )}
            </span>
          </div>
        </div>
      </div>

      {vm.providerHistory.length ? (
        <div className="provider-transitions">
          <h3>{t("providers.transitions")}</h3>
          <ul>
            {vm.providerHistory
              .slice(-5)
              .reverse()
              .map((event) => (
                <li key={`${event.provider}-${event.at}-${event.to}`}>
                  <span>{fallbackLabels[event.provider]}</span>
                  <span>
                    {t(`providers.flow.${event.from}` as TKey)} → <strong>{t(`providers.flow.${event.to}` as TKey)}</strong>
                  </span>
                  <time dateTime={event.at}>{formatTime(event.at, false)}</time>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ProviderCard({
  provider,
  rank,
  lastMovable,
  status,
  vm
}: {
  provider: ProviderId;
  rank: number;
  lastMovable: number;
  status: ProviderStatus | undefined;
  vm: ViewModel;
}) {
  const { t } = useT();
  const [loginCode, setLoginCode] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [browserState, setBrowserState] = useState<"idle" | "opening" | "opened" | "error">("idle");
  const [linkCopied, setLinkCopied] = useState(false);
  const lastAutoOpenedUrl = useRef<string | null>(null);
  const Icon = providerIcons[provider];
  const action = vm.providerBusy[provider];
  const connecting = action === "connect" && provider !== "local";
  const display = providerDisplayState(status, provider, connecting);
  const tone = displayTone(display);
  const isLocal = provider === "local";
  const loginUrl = safeHttpUrl(vm.providerLoginUrls[provider]);
  const installGuide = safeHttpUrl(PROVIDER_INSTALL_GUIDES[provider]);
  const recheck = status ? nextRecheckAt(status) : null;
  const reason = status ? reasonKey(status.reason) : null;
  const needsLogin = !isLocal && (display === "connect" || display === "reauth" || display === "disabled");

  const openLoginPage = useCallback(async () => {
    if (!loginUrl) return;
    setBrowserState("opening");
    const opened = await vm.handleOpenProviderLoginUrl(provider, loginUrl);
    setBrowserState(opened ? "opened" : "error");
  }, [loginUrl, provider, vm]);

  useEffect(() => {
    if (!connecting || !loginUrl || lastAutoOpenedUrl.current === loginUrl) return;
    lastAutoOpenedUrl.current = loginUrl;
    void openLoginPage();
  }, [connecting, loginUrl, openLoginPage]);

  useEffect(() => {
    if (!connecting) {
      lastAutoOpenedUrl.current = null;
      setBrowserState("idle");
    }
  }, [connecting]);

  return (
    <article className={`provider-card ${tone}`} aria-busy={Boolean(action)}>
      <header>
        <div className="provider-mark"><Icon size={24} /></div>
        <div className="provider-card-title">
          <h3>{status?.label ?? fallbackLabels[provider]}</h3>
          <span className={`provider-state ${tone}`} role="status">
            <span aria-hidden="true" />
            {t(display === "disabled" ? "providers.state.disconnected" : (`providers.state.${display}` as TKey))}
          </span>
        </div>
        <div className="provider-priority-controls" role="group" aria-label={t("providers.priority")}>
          <button
            aria-label={t("providers.moveUp")}
            className="icon-button"
            disabled={rank <= 0}
            onClick={() => void vm.handleMoveProvider(provider, "up")}
            title={t("providers.moveUp")}
            type="button"
          ><ArrowUp size={15} /></button>
          <button
            aria-label={t("providers.moveDown")}
            className="icon-button"
            disabled={rank >= lastMovable}
            onClick={() => void vm.handleMoveProvider(provider, "down")}
            title={t("providers.moveDown")}
            type="button"
          ><ArrowDown size={15} /></button>
        </div>
      </header>

      {isLocal ? (
        <LocalProviderForm status={status} vm={vm} />
      ) : (
        <p className="provider-auth-note">{t(`providers.${provider}.authNote` as TKey)}</p>
      )}

      <p className={`provider-message ${tone}`}>
        {connecting ? t("providers.loginWaiting") : reason ? t(reason) : t("providers.statusPending")}
      </p>
      {status?.retryHint && display === "quota" ? (
        <p className="provider-hint">{t("providers.retryHint", { hint: status.retryHint })}</p>
      ) : null}
      {recheck ? <p className="provider-hint">{t("providers.nextRecheck", { time: formatTime(recheck, false) })}</p> : null}
      {connecting && loginUrl ? (
        <div className="provider-login-browser-action">
          <div className="provider-login-browser-buttons">
            <button
              className="provider-login-link"
              disabled={browserState === "opening"}
              onClick={() => void openLoginPage()}
              type="button"
            >
              {browserState === "opening" ? <Loader2 className="spin" size={14} /> : <ExternalLink size={14} />}
              {browserState === "opened" ? t("providers.reopenLoginPage") : t("providers.openLoginPage")}
            </button>
            <button
              className="provider-login-link secondary-link"
              onClick={async () => {
                setLinkCopied(await copyText(loginUrl));
              }}
              type="button"
            >
              <Copy size={14} />
              {linkCopied ? t("providers.loginLinkCopied") : t("providers.copyLoginLink")}
            </button>
          </div>
          <span className={`provider-login-feedback ${browserState}`} role="status">
            {browserState === "opening"
              ? t("providers.openingLoginPage")
              : browserState === "opened"
                ? t("providers.loginPageOpened")
                : browserState === "error"
                  ? t("providers.loginPageOpenFailed")
                  : ""}
          </span>
        </div>
      ) : null}
      {connecting && provider === "claude" ? (
        <div className="provider-login-code">
          <label>
            {t("providers.loginCodeLabel")}
            <div className="provider-login-code-row">
              <input
                autoComplete="one-time-code"
                onChange={(event) => setLoginCode(event.target.value)}
                placeholder={t("providers.loginCodePlaceholder")}
                spellCheck={false}
                type="password"
                value={loginCode}
              />
              <button
                className="secondary"
                disabled={submittingCode || !loginCode.trim()}
                onClick={async () => {
                  setSubmittingCode(true);
                  const accepted = await vm.handleSubmitProviderLoginCode(provider, loginCode);
                  if (accepted) setLoginCode("");
                  setSubmittingCode(false);
                }}
                type="button"
              >
                {submittingCode ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
                {t("providers.submitLoginCode")}
              </button>
            </div>
          </label>
          <span className="provider-hint">{t("providers.loginCodeNote")}</span>
        </div>
      ) : null}
      {display === "notInstalled" && installGuide ? (
        <a className="provider-login-link" href={installGuide} rel="noreferrer" target="_blank">
          <ExternalLink size={14} />
          {t("providers.installGuide")}
        </a>
      ) : null}

      <dl className="provider-meta">
        <div><dt>{t("providers.lastCheck")}</dt><dd>{formatTime(status?.lastSuccessAt)}</dd></div>
        <div><dt>{t("providers.versionModel")}</dt><dd title={status?.model ?? status?.version ?? ""}>{status?.model || status?.version || "—"}</dd></div>
        {status?.endpointScope ? (
          <div><dt>{t("providers.scope")}</dt><dd>{t(`providers.scope.${status.endpointScope}` as TKey)}</dd></div>
        ) : null}
      </dl>

      <footer>
        {connecting ? (
          <button className="secondary" onClick={() => void vm.handleCancelProviderLogin(provider)} type="button">
            <X size={16} />
            {t("providers.cancelLogin")}
          </button>
        ) : isLocal ? (
          <button
            className="primary"
            disabled={Boolean(action) || Boolean(validateLocalEndpointInput(vm.localProviderDraft?.baseUrl ?? ""))}
            onClick={() => void vm.handleConnectProvider(provider)}
            type="button"
          >
            {action === "connect" ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
            {t("providers.saveAndTest")}
          </button>
        ) : needsLogin ? (
          <button
            className="primary"
            disabled={Boolean(action) || !status?.installed}
            onClick={() => void vm.handleConnectProvider(provider, display === "reauth")}
            type="button"
          >
            <LogIn size={16} />
            {display === "reauth" ? t("providers.reconnect") : t("providers.connect")}
          </button>
        ) : null}
        {!connecting && !(isLocal && !status?.installed) ? (
          <button
            className={needsLogin || isLocal ? "secondary" : "primary"}
            disabled={Boolean(action) || !status?.installed}
            onClick={() => void vm.handleTestProvider(provider)}
            type="button"
          >
            {action === "test" ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {t("providers.test")}
          </button>
        ) : null}
        {!connecting && status?.enabled && status.installed ? (
          <button
            className="ghost"
            disabled={Boolean(action)}
            onClick={() => void vm.handleDisconnectProvider(provider)}
            title={t("providers.disconnectNote")}
            type="button"
          >
            {action === "disconnect" ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
            {t("providers.disconnect")}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function LocalProviderForm({ status, vm }: { status: ProviderStatus | undefined; vm: ViewModel }) {
  const { t } = useT();
  const draft = vm.localProviderDraft;
  if (!draft) return null;
  const saved = vm.config?.localProvider;
  const unsaved =
    Boolean(saved) &&
    (saved?.kind !== draft.kind || saved?.baseUrl !== draft.baseUrl || saved?.model !== draft.model);
  const endpointError = draft.baseUrl ? validateLocalEndpointInput(draft.baseUrl) : null;
  const busy = Boolean(vm.providerBusy.local);
  const showKey = draft.kind !== "ollama";
  const keyError = vm.localKeyError ? reasonKey(vm.localKeyError) : null;

  return (
    <div className="local-provider-form">
      <div className="local-provider-discover">
        <button className="ghost" disabled={busy} onClick={() => void vm.handleDiscoverLocalProviders()} type="button">
          {vm.providerBusy.local === "test" ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
          {t("providers.local.discover")}
        </button>
        {vm.discoveredLocal && vm.discoveredLocal.length === 0 ? (
          <span className="provider-hint">{t("providers.local.discoverNone")}</span>
        ) : null}
        {vm.discoveredLocal?.map((found) => (
          <button
            className="provider-chip"
            key={found.baseUrl}
            onClick={() =>
              vm.updateLocalProviderDraft({ kind: found.kind, baseUrl: found.baseUrl, model: found.models[0] ?? "" })
            }
            type="button"
          >
            {t("providers.local.discoverFound", { name: localKindLabels[found.kind], count: found.models.length })}
            <em>{t("providers.local.use")}</em>
          </button>
        ))}
      </div>
      <label>
        {t("providers.local.preset")}
        <select
          onChange={(event) => {
            const kind = event.target.value as LocalProviderKind;
            vm.updateLocalProviderDraft({
              kind,
              baseUrl: kind === "open_ai_compatible" ? draft.baseUrl : LOCAL_PRESETS[kind]
            });
          }}
          value={draft.kind}
        >
          {(Object.keys(localKindLabels) as LocalProviderKind[]).map((kind) => (
            <option key={kind} value={kind}>{localKindLabels[kind]}</option>
          ))}
        </select>
      </label>
      <label>
        {t("providers.local.endpoint")}
        <input
          aria-invalid={Boolean(endpointError)}
          autoComplete="off"
          inputMode="url"
          onChange={(event) => vm.updateLocalProviderDraft({ baseUrl: event.target.value })}
          placeholder="http://127.0.0.1:11434"
          spellCheck={false}
          value={draft.baseUrl}
        />
      </label>
      {endpointError ? (
        <span className="provider-field-error" role="alert">{t(`providers.local.error.${endpointError}` as TKey)}</span>
      ) : null}
      <label>
        {t("providers.local.model")}
        <input
          autoComplete="off"
          list="katosync-local-models"
          onChange={(event) => vm.updateLocalProviderDraft({ model: event.target.value })}
          placeholder={t("providers.local.modelPlaceholder")}
          spellCheck={false}
          value={draft.model}
        />
        <datalist id="katosync-local-models">
          {(vm.discoveredLocal ?? [])
            .filter((found) => found.baseUrl === draft.baseUrl)
            .flatMap((found) => found.models)
            .map((model) => <option key={model} value={model} />)}
        </datalist>
      </label>
      {showKey ? (
        <div className="local-provider-key">
          <label>
            {t("providers.local.apiKey")}
            <div className="local-provider-key-row">
              <input
                autoComplete="new-password"
                onChange={(event) => vm.setLocalKeyInput(event.target.value)}
                placeholder={t("providers.local.apiKeyPlaceholder")}
                spellCheck={false}
                type="password"
                value={vm.localKeyInput}
              />
              <button
                className="secondary"
                disabled={busy || !vm.localKeyInput.trim() || Boolean(validateLocalEndpointInput(draft.baseUrl))}
                onClick={() => void vm.handleSaveLocalProviderKey()}
                type="button"
              >
                <KeyRound size={15} />
                {t("providers.local.saveKey")}
              </button>
            </div>
          </label>
          {status?.secretStored ? (
            <span className="provider-safe-note">
              {t("providers.local.keyStored")}{" "}
              <button className="link-button" disabled={busy} onClick={() => void vm.handleRemoveLocalProviderKey()} type="button">
                {t("providers.local.removeKey")}
              </button>
            </span>
          ) : null}
          {vm.localKeyError ? (
            <span className="provider-field-error" role="alert">{keyError ? t(keyError) : vm.localKeyError}</span>
          ) : null}
          <span className="provider-hint">{t("providers.local.keyNote")}</span>
        </div>
      ) : null}
      {unsaved ? <span className="provider-hint">{t("providers.local.unsaved")}</span> : null}
      <span className="provider-safe-note">{t("providers.local.safeNote")}</span>
    </div>
  );
}
