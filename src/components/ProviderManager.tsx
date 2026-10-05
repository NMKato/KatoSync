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
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  PlugZap,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Play,
  Square,
  Trash2,
  Unplug,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import {
  buildSanitizedProviderDiagnostics,
  currentProviderOwner,
  displayTone,
  API_PROVIDER_PRESETS,
  LOCAL_PRESETS,
  nextRecheckAt,
  normalizeProviderPriority,
  PROVIDER_INSTALL_GUIDES,
  providerDisplayState,
  validateLocalEndpointInput
} from "../lib/providerPolicy";
import { safeHttpUrl } from "../lib/url";
import { apiModelProfile, formatApiPrice } from "../lib/apiModelCatalog";
import { apiUsageSummary } from "../lib/apiUsageLedger";
import { useT, type TKey } from "../i18n";
import type {
  ApiCapability,
  ApiEffort,
  ApiProviderConfig,
  ApiProviderPreset,
  LocalProviderKind,
  ProviderId,
  ProviderReason,
  ProviderStatus
} from "../types";
import type { useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;

const cardProviders: ProviderId[] = ["codex", "claude", "api", "local"];

export const providerIcons = {
  codex: Bot,
  claude: Cloud,
  api: KeyRound,
  local: Cpu,
  local_control: ShieldCheck
} as const;

export const fallbackLabels: Record<ProviderId, string> = {
  codex: "OpenAI Codex",
  claude: "Anthropic Claude Code",
  api: "API Provider",
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
  const connecting = action === "connect" && provider !== "local" && provider !== "api";
  const display = providerDisplayState(status, provider, connecting);
  const tone = displayTone(display);
  const isApi = provider === "api";
  const isLocal = provider === "local";
  const loginUrl = safeHttpUrl(vm.providerLoginUrls[provider]);
  const installGuide = safeHttpUrl(PROVIDER_INSTALL_GUIDES[provider]);
  const recheck = status ? nextRecheckAt(status) : null;
  const reason = status ? reasonKey(status.reason) : null;
  const needsLogin = !isLocal && !isApi && (display === "connect" || display === "reauth" || display === "disabled");

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
    <article className={`provider-card provider-card-${provider} ${tone}`} aria-busy={Boolean(action)}>
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

      {isApi ? (
        <ApiProviderForm vm={vm} />
      ) : isLocal ? (
        <>
          <LocalBrainInstaller vm={vm} />
          <details className="local-provider-advanced">
            <summary>{t("providers.localBrain.advanced")}</summary>
            <div className="local-provider-advanced-body">
              <LocalProviderForm status={status} vm={vm} />
            </div>
          </details>
        </>
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
        ) : isApi ? null : isLocal ? (
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
        {!connecting && !isApi && !(isLocal && !status?.installed) ? (
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
        {!connecting && !isApi && status?.enabled && status.installed ? (
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

const API_PRESET_OPTIONS: ApiProviderPreset[] = [
  "openrouter_eu",
  "openrouter_global",
  "openai",
  "anthropic",
  "deepseek",
  "mistral",
  "xai",
  "zai",
  "custom_openai"
];

const API_CAPABILITY_OPTIONS: ApiCapability[] = ["coding", "reasoning", "security", "vision", "image", "video"];

function apiProviderLabel(preset: ApiProviderPreset, t: ReturnType<typeof useT>["t"]) {
  return preset === "custom_openai"
    ? t("providers.api.custom")
    : API_PROVIDER_PRESETS[preset as Exclude<ApiProviderPreset, "custom_openai">].label;
}

function ApiProviderForm({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const action = vm.providerBusy.api;
  const connections = vm.apiProviders;

  return (
    <div className="api-provider-form">
      <div className="api-provider-pool-head">
        <div>
          <strong>{t("providers.api.poolTitle")}</strong>
          <span>{t("providers.api.poolHint")}</span>
        </div>
        <span className="api-provider-counter">{connections.length}/3</span>
      </div>

      {connections.length ? (
        <div className="api-provider-pool">
          {connections.map((connection: ApiProviderConfig, index: number) => (
            <ApiConnectionSlot
              connection={connection}
              index={index}
              key={connection.id}
              vm={vm}
            />
          ))}
        </div>
      ) : (
        <div className="api-provider-empty">
          <KeyRound size={20} />
          <div>
            <strong>{t("providers.api.emptyTitle")}</strong>
            <span>{t("providers.api.emptyText")}</span>
          </div>
        </div>
      )}

      {connections.length < 3 ? (
        <button
          className="secondary api-provider-add"
          disabled={Boolean(action)}
          onClick={() => void vm.handleAddApiProvider()}
          type="button"
        >
          <Plus size={16} />
          {t("providers.api.add")}
        </button>
      ) : (
        <span className="provider-hint">{t("providers.api.limit")}</span>
      )}

      <div className="api-provider-meta api-provider-pool-meta">
        <span><ShieldCheck size={13} />{t("providers.api.secretSafe")}</span>
        <span>{t("providers.api.poolSafe")}</span>
      </div>
    </div>
  );
}

function compactTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function compactUsd(value: number): string {
  if (value > 0 && value < 0.001) return "<$0.001";
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`;
}

function ApiConnectionSlot({
  connection,
  index,
  vm
}: {
  connection: ApiProviderConfig;
  index: number;
  vm: ViewModel;
}) {
  const { t } = useT();
  const action = vm.providerBusy.api;
  const catalog = vm.apiCatalogs[connection.id];
  const models = catalog?.models ?? [];
  const apiKey = vm.apiKeyInputs[connection.id] ?? "";
  const error = vm.apiKeyErrors[connection.id];
  const profile = connection.model ? apiModelProfile(connection.preset, connection.model) : null;
  const usage = apiUsageSummary(connection.id);
  const supportedEfforts = profile?.supportedEfforts ?? (["auto"] as ApiEffort[]);
  const effort = supportedEfforts.includes(connection.effort) ? connection.effort : "auto";
  const displayName = connection.label.trim() || apiProviderLabel(connection.preset, t);

  const toggleCapability = (capability: ApiCapability) => {
    const next = connection.capabilities.includes(capability)
      ? connection.capabilities.filter((item: ApiCapability) => item !== capability)
      : [...connection.capabilities, capability];
    vm.updateApiProviderDraft(connection.id, { capabilities: next });
  };

  return (
    <section className="api-connection-slot">
      <header className="api-connection-slot-head">
        <div>
          <span>{t("providers.api.slot", { number: index + 1 })}</span>
          <strong>{displayName}</strong>
        </div>
        <span className={connection.model ? "api-slot-ready" : "api-slot-open"}>
          {connection.model ? t("providers.api.configured") : t("providers.api.notConfigured")}
        </span>
      </header>

      <div className="api-provider-grid">
        <label>
          {t("providers.api.provider")}
          <select
            disabled={Boolean(action)}
            value={connection.preset}
            onChange={(event) =>
              vm.updateApiProviderDraft(connection.id, {
                preset: event.target.value as ApiProviderPreset,
                baseUrl: event.target.value === "custom_openai" ? connection.baseUrl : "",
                model: ""
              })
            }
          >
            {API_PRESET_OPTIONS.map((preset) => (
              <option key={preset} value={preset}>{apiProviderLabel(preset, t)}</option>
            ))}
          </select>
        </label>

        <label>
          {t("providers.api.effort")}
          <select
            disabled={Boolean(action)}
            value={effort}
            onChange={(event) =>
              vm.updateApiProviderDraft(connection.id, { effort: event.target.value as ApiEffort })
            }
          >
            {supportedEfforts.map((item: ApiEffort) => (
              <option key={item} value={item}>{t(`providers.api.effort.${item}` as TKey)}</option>
            ))}
          </select>
        </label>
      </div>

      {connection.preset === "custom_openai" ? (
        <label>
          {t("providers.api.endpoint")}
          <input
            autoCapitalize="none"
            autoComplete="off"
            disabled={Boolean(action)}
            onChange={(event) => vm.updateApiProviderDraft(connection.id, { baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            value={connection.baseUrl}
          />
        </label>
      ) : null}

      <div className="api-provider-key-row">
        <label>
          {t("providers.api.key")}
          <input
            autoComplete="off"
            disabled={Boolean(action)}
            onChange={(event) => vm.setApiKeyInput(connection.id, event.target.value)}
            placeholder={t("providers.api.keyPlaceholder")}
            spellCheck={false}
            type="password"
            value={apiKey}
          />
        </label>
        <button
          className="secondary"
          disabled={Boolean(action) || !apiKey.trim()}
          onClick={() => void vm.handleSaveApiProviderKey(connection.id)}
          type="button"
        >
          {action === "key" ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
          {t("providers.api.saveKey")}
        </button>
      </div>

      <div className="api-provider-model-row">
        <label>
          {t("providers.api.model")}
          {models.length ? (
            <select
              disabled={Boolean(action)}
              value={connection.model}
              onChange={(event) => vm.updateApiProviderDraft(connection.id, { model: event.target.value })}
            >
              {connection.model && !models.includes(connection.model) ? (
                <option value={connection.model}>{connection.model}</option>
              ) : null}
              {models.map((model: string) => {
                const modelProfile = apiModelProfile(connection.preset, model);
                return (
                  <option key={model} value={model}>
                    {model} · {formatApiPrice(modelProfile)}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              autoCapitalize="none"
              autoComplete="off"
              disabled={Boolean(action)}
              onChange={(event) => vm.updateApiProviderDraft(connection.id, { model: event.target.value })}
              placeholder={t("providers.api.modelPlaceholder")}
              spellCheck={false}
              value={connection.model}
            />
          )}
        </label>
        <button
          className="secondary"
          disabled={Boolean(action)}
          onClick={() => void vm.handleRefreshApiModels(connection.id)}
          type="button"
        >
          {action === "catalog" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
          {t("providers.api.loadModels")}
        </button>
      </div>

      {profile ? (
        <div className="api-model-summary">
          <span>{formatApiPrice(profile)}</span>
          <span>{t(`providers.api.speed.${profile.speed}` as TKey)}</span>
          {profile.contextWindow ? (
            <span>{t("providers.api.context", { count: Math.round(profile.contextWindow / 1000) })}</span>
          ) : null}
        </div>
      ) : null}

      <div className="api-usage-strip">
        <span>
          <small>{t("providers.api.usage.month")}</small>
          <strong>
            {usage.monthCostIsEstimate ? "≈ " : ""}
            {compactUsd(usage.monthCostUsd)}
          </strong>
        </span>
        <span>
          <small>{t("providers.api.usage.input")}</small>
          <strong>{compactTokenCount(usage.inputTokens)}</strong>
        </span>
        <span>
          <small>{t("providers.api.usage.output")}</small>
          <strong>{compactTokenCount(usage.outputTokens)}</strong>
        </span>
        <span>
          <small>{t("providers.api.usage.requests")}</small>
          <strong>{usage.requests}</strong>
        </span>
        <span className="api-usage-source">
          {usage.requests
            ? t(usage.monthCostIsEstimate ? "providers.api.usage.estimated" : "providers.api.usage.reported")
            : t("providers.api.usage.empty")}
        </span>
      </div>

      <details className="api-provider-advanced">
        <summary>{t("providers.api.advanced")}</summary>
        <div className="api-provider-advanced-body">
          <label>
            {t("providers.api.name")}
            <input
              disabled={Boolean(action)}
              onChange={(event) => vm.updateApiProviderDraft(connection.id, { label: event.target.value })}
              placeholder={t("providers.api.namePlaceholder")}
              value={connection.label}
            />
          </label>
          <label>
            {t("providers.api.mode")}
            <select
              disabled={Boolean(action)}
              onChange={(event) =>
                vm.updateApiProviderDraft(connection.id, {
                  mode: event.target.value as ApiProviderConfig["mode"]
                })
              }
              value={connection.mode}
            >
              <option value="auto">{t("providers.api.mode.auto")}</option>
              <option value="specialist">{t("providers.api.mode.specialist")}</option>
              <option value="fallback">{t("providers.api.mode.fallback")}</option>
            </select>
          </label>

          <div className="api-capability-field">
            <span>{t("providers.api.preferredFor")}</span>
            <div className="api-capability-chips">
              {API_CAPABILITY_OPTIONS.map((capability) => (
                <button
                  aria-pressed={connection.capabilities.includes(capability)}
                  className={connection.capabilities.includes(capability) ? "active" : ""}
                  disabled={Boolean(action)}
                  key={capability}
                  onClick={() => toggleCapability(capability)}
                  type="button"
                >
                  {t(`providers.api.capability.${capability}` as TKey)}
                </button>
              ))}
            </div>
          </div>

          <label className="api-provider-enabled">
            <input
              checked={connection.enabled}
              disabled={Boolean(action)}
              onChange={(event) => vm.updateApiProviderDraft(connection.id, { enabled: event.target.checked })}
              type="checkbox"
            />
            <span>{t("providers.api.enabled")}</span>
          </label>
        </div>
      </details>

      <div className="api-provider-meta">
        {connection.preset === "openrouter_eu" ? <span>{t("providers.api.euRoute")}</span> : null}
        {catalog ? <span>{t("providers.api.modelCount", { count: catalog.models.length })}</span> : null}
      </div>

      {error ? <span className="provider-field-error">{error}</span> : null}

      <div className="api-connection-actions">
        <button
          className="primary"
          disabled={Boolean(action) || !connection.model.trim()}
          onClick={() => void vm.handleSaveApiProvider(connection.id)}
          type="button"
        >
          {action === "connect" ? <Loader2 className="spin" size={16} /> : <PlugZap size={16} />}
          {t("providers.api.saveAndTest")}
        </button>
        <button
          className="ghost"
          disabled={Boolean(action)}
          onClick={() => void vm.handleRemoveApiProviderKey(connection.id)}
          type="button"
        >
          <KeyRound size={14} />
          {t("providers.api.removeKey")}
        </button>
        <button
          className="ghost danger"
          disabled={Boolean(action)}
          onClick={() => void vm.handleDeleteApiProvider(connection.id)}
          type="button"
        >
          <Trash2 size={14} />
          {t("providers.api.delete")}
        </button>
      </div>
    </section>
  );
}

function LocalBrainInstaller({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const brain = vm.localBrainStatus;
  const progress = vm.localBrainProgress;
  const busy = vm.localBrainBusy;
  const installed = Boolean(brain?.runtimeInstalled && brain?.modelInstalled);
  const running = Boolean(brain?.running);
  const percent = progress?.percent == null ? null : Math.max(0, Math.min(100, progress.percent));
  const sizeGb = brain ? (brain.modelSizeBytes / 1_000_000_000).toFixed(2) : "4.59";
  const ramText = brain?.ramGb ? `${brain.ramGb} GB` : t("providers.localBrain.unknown");
  const fitKey = brain?.ramFit ?? "unknown";

  return (
    <section className={`local-brain-card ${running ? "running" : installed ? "installed" : ""}`}>
      <div className="local-brain-head">
        <div className="local-brain-icon"><Cpu size={19} /></div>
        <div className="local-brain-copy">
          <span>{t("providers.localBrain.recommended")}</span>
          <strong>{brain?.modelName ?? "Kato Local Brain · Gemma 4 E4B"}</strong>
          <small>{t("providers.localBrain.subtitle")}</small>
        </div>
        <span className={`local-brain-state ${running ? "live" : installed ? "ok" : ""}`}>
          {running
            ? t("providers.localBrain.running")
            : installed
              ? t("providers.localBrain.installed")
              : t("providers.localBrain.notInstalled")}
        </span>
      </div>

      <div className="local-brain-facts">
        <span><strong>{sizeGb} GB</strong>{t("providers.localBrain.download")}</span>
        <span><strong>{brain?.quantization ?? "Q4_0"}</strong>{t("providers.localBrain.quantization")}</span>
        <span><strong>{ramText}</strong>{t(`providers.localBrain.fit.${fitKey}` as TKey)}</span>
      </div>

      {progress && busy === "install" ? (
        <div className="local-brain-progress" role="status" aria-live="polite">
          <div>
            <span>{progress.label}</span>
            <strong>{percent == null ? "…" : `${percent.toFixed(0)}%`}</strong>
          </div>
          <div className="local-brain-progress-track" aria-hidden="true">
            <span style={{ width: `${percent ?? 4}%` }} />
          </div>
        </div>
      ) : null}

      <div className="local-brain-actions">
        {!installed ? (
          <button
            className="primary"
            disabled={Boolean(busy) || brain?.supported === false}
            onClick={() => void vm.handleInstallLocalBrain()}
            type="button"
          >
            {busy === "install" ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
            {t("providers.localBrain.install")}
          </button>
        ) : running ? (
          <button className="secondary" disabled={Boolean(busy)} onClick={() => void vm.handleStopLocalBrain()} type="button">
            {busy === "stop" ? <Loader2 className="spin" size={15} /> : <Square size={14} />}
            {t("providers.localBrain.stop")}
          </button>
        ) : (
          <button className="primary" disabled={Boolean(busy)} onClick={() => void vm.handleStartLocalBrain()} type="button">
            {busy === "start" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
            {t("providers.localBrain.start")}
          </button>
        )}
        {installed ? (
          <button className="ghost" disabled={Boolean(busy)} onClick={() => void vm.handleRemoveLocalBrain()} type="button">
            {busy === "remove" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
            {t("providers.localBrain.remove")}
          </button>
        ) : null}
      </div>

      {brain?.supported === false ? (
        <span className="provider-field-error">{t("providers.localBrain.unsupported")}</span>
      ) : (
        <span className="provider-safe-note">{t("providers.localBrain.safe")}</span>
      )}
    </section>
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
