//! Begrenzter Warm-up fuer Abo-Provider (Codex mit ChatGPT-Login, Claude Code mit claude.ai-Abo).
//!
//! Ein winziger READY-Prompt ohne Tools startet das rollierende Nutzungsfenster des Providers,
//! bevor echte Arbeit ansteht. Harte Grenzen: hoechstens ein erfolgreicher Warm-up pro Provider und
//! Cooldown-Fenster (persistiert, ueberlebt Neustarts), Backoff nach Fehlversuchen, nie parallel,
//! nie waehrend ein Runner arbeitet. Ein Warm-up-Fehler ist folgenlos: keine Karte, kein Failover.
//! Gespeichert werden nur Zeitstempel und Ergebnis-Codes – nie Antworten, Tokens oder Account-Daten.
//!
//! (Created by NMKato Solutions)

use crate::provider_manager::{self, ProviderId, WarmUpResult};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

/// Konservativ unter dem 5-Stunden-Fenster: hoechstens ein Warm-up je Provider alle 4 h 50 min.
pub const WARMUP_COOLDOWN_SECS: i64 = 4 * 3600 + 50 * 60;
/// Nach einem Fehlversuch fruehestens nach 30 Minuten erneut versuchen.
pub const WARMUP_RETRY_SECS: i64 = 30 * 60;
const SCHEMA_VERSION: u32 = 1;

// Compile-Zeit-Grenzen: konservativ knapp unter dem 5-Stunden-Fenster, Backoff kuerzer als Cooldown.
const _: () = {
    assert!(WARMUP_COOLDOWN_SECS >= 4 * 3600 + 45 * 60);
    assert!(WARMUP_COOLDOWN_SECS <= 4 * 3600 + 55 * 60);
    assert!(WARMUP_RETRY_SECS < WARMUP_COOLDOWN_SECS);
};

static WARMUP_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static ACTIVE_RUNS: AtomicUsize = AtomicUsize::new(0);

/// Markiert einen laufenden echten Runner-Job; solange er lebt, startet kein Warm-up.
pub struct RunnerActivity(());

impl RunnerActivity {
    pub fn begin() -> Self {
        ACTIVE_RUNS.fetch_add(1, Ordering::SeqCst);
        Self(())
    }
}

impl Drop for RunnerActivity {
    fn drop(&mut self) {
        ACTIVE_RUNS.fetch_sub(1, Ordering::SeqCst);
    }
}

fn runner_active() -> bool {
    ACTIVE_RUNS.load(Ordering::SeqCst) > 0
}

struct InFlight;

impl InFlight {
    fn acquire() -> Option<Self> {
        WARMUP_IN_FLIGHT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        WARMUP_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWarmupEntry {
    #[serde(default)]
    pub last_success_at: Option<String>,
    #[serde(default)]
    pub last_attempt_at: Option<String>,
    #[serde(default)]
    pub last_result: Option<WarmUpResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWarmupState {
    pub schema_version: u32,
    #[serde(default)]
    pub codex: ProviderWarmupEntry,
    #[serde(default)]
    pub claude: ProviderWarmupEntry,
}

impl Default for ProviderWarmupState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            codex: ProviderWarmupEntry::default(),
            claude: ProviderWarmupEntry::default(),
        }
    }
}

impl ProviderWarmupState {
    fn entry_mut(&mut self, provider: ProviderId) -> Option<&mut ProviderWarmupEntry> {
        match provider {
            ProviderId::Codex => Some(&mut self.codex),
            ProviderId::Claude => Some(&mut self.claude),
            _ => None,
        }
    }

    pub fn entry(&self, provider: ProviderId) -> Option<&ProviderWarmupEntry> {
        match provider {
            ProviderId::Codex => Some(&self.codex),
            ProviderId::Claude => Some(&self.claude),
            _ => None,
        }
    }
}

/// Ergebnis eines Warm-up-Aufrufs. `Skipped*` bedeutet: keine Inferenz ausgefuehrt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarmupOutcome {
    Warmed,
    Failed,
    SkippedUnsupported,
    SkippedFeatureDisabled,
    SkippedProviderDisabled,
    SkippedCooldown,
    SkippedBackoff,
    SkippedRunnerBusy,
    SkippedWorkActive,
    SkippedInFlight,
    SkippedNotInstalled,
    SkippedNotAuthenticated,
    SkippedNotSubscription,
    SkippedStateUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupReport {
    pub provider: ProviderId,
    pub outcome: WarmupOutcome,
    pub state: ProviderWarmupState,
}

fn parse_time(value: Option<&String>) -> Option<DateTime<Utc>> {
    value
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|time| time.with_timezone(&Utc))
}

/// Reine Cooldown-Regel. Zeitstempel weit in der Zukunft (Uhrensprung) werden ignoriert,
/// leicht vorauseilende zaehlen konservativ als "gerade eben".
pub fn gate(entry: &ProviderWarmupEntry, now: DateTime<Utc>) -> Option<WarmupOutcome> {
    let cooldown = ChronoDuration::seconds(WARMUP_COOLDOWN_SECS);
    let retry = ChronoDuration::seconds(WARMUP_RETRY_SECS);
    let within = |at: Option<DateTime<Utc>>, window: ChronoDuration| {
        at.filter(|at| *at <= now + window)
            .is_some_and(|at| now - at.min(now) < window)
    };
    if within(parse_time(entry.last_success_at.as_ref()), cooldown) {
        return Some(WarmupOutcome::SkippedCooldown);
    }
    if within(parse_time(entry.last_attempt_at.as_ref()), retry) {
        return Some(WarmupOutcome::SkippedBackoff);
    }
    None
}

pub fn load_state(path: &Path) -> ProviderWarmupState {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ProviderWarmupState>(&raw).ok())
        .unwrap_or_default()
}

fn save_state(path: &Path, state: &ProviderWarmupState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn skip_reason(result: WarmUpResult) -> WarmupOutcome {
    match result {
        WarmUpResult::Warmed => WarmupOutcome::Warmed,
        WarmUpResult::Failed => WarmupOutcome::Failed,
        WarmUpResult::NotInstalled => WarmupOutcome::SkippedNotInstalled,
        WarmUpResult::NotAuthenticated => WarmupOutcome::SkippedNotAuthenticated,
        WarmUpResult::NotSubscription => WarmupOutcome::SkippedNotSubscription,
    }
}

/// Schalter aus der App-Config; die Rust-Seite prueft sie unabhaengig vom Frontend erneut.
pub struct WarmupSettings {
    pub feature_enabled: bool,
    pub provider_enabled: bool,
    /// Local-Control-Lanes/Inbox, Scheduler-Resume, Orchestrator-Lease oder offene Router-Jobs.
    pub external_work_active: bool,
}

/// Fuehrt hoechstens einen Warm-up aus. Alle Gates werden vor der Inferenz erneut geprueft; der
/// Versuch wird VOR dem Prompt persistiert, damit ein Absturz/Neustart ihn nicht sofort wiederholt.
pub async fn run(provider: ProviderId, path: &Path, settings: WarmupSettings) -> WarmupReport {
    let report = |outcome, state| WarmupReport {
        provider,
        outcome,
        state,
    };
    let state = load_state(path);
    if !matches!(provider, ProviderId::Codex | ProviderId::Claude) {
        return report(WarmupOutcome::SkippedUnsupported, state);
    }
    if !settings.feature_enabled {
        return report(WarmupOutcome::SkippedFeatureDisabled, state);
    }
    if !settings.provider_enabled {
        return report(WarmupOutcome::SkippedProviderDisabled, state);
    }
    if runner_active() {
        return report(WarmupOutcome::SkippedRunnerBusy, state);
    }
    if settings.external_work_active {
        return report(WarmupOutcome::SkippedWorkActive, state);
    }
    let Some(_guard) = InFlight::acquire() else {
        return report(WarmupOutcome::SkippedInFlight, state);
    };
    // Erst unter dem In-Flight-Lock frisch lesen, damit zwei Aufrufe nie dasselbe Fenster nutzen.
    let mut state = load_state(path);
    if let Some(skip) = state
        .entry(provider)
        .and_then(|entry| gate(entry, Utc::now()))
    {
        return report(skip, state);
    }
    let executable = match provider_manager::warm_up_eligibility(provider).await {
        Ok(executable) => executable,
        Err(result) => return report(skip_reason(result), state),
    };
    if runner_active() {
        return report(WarmupOutcome::SkippedRunnerBusy, state);
    }
    if let Some(entry) = state.entry_mut(provider) {
        entry.last_attempt_at = Some(Utc::now().to_rfc3339());
    }
    if save_state(path, &state).is_err() {
        // Ohne persistierten Versuch kein Prompt: sonst wuerde jeder Neustart erneut senden.
        return report(WarmupOutcome::SkippedStateUnavailable, load_state(path));
    }
    let result = provider_manager::run_warm_up(provider, &executable).await;
    if let Some(entry) = state.entry_mut(provider) {
        entry.last_result = Some(result);
        if result == WarmUpResult::Warmed {
            entry.last_success_at = Some(Utc::now().to_rfc3339());
        }
    }
    let _ = save_state(path, &state);
    report(skip_reason(result), state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(offset_secs: i64) -> Option<String> {
        Some((Utc::now() + ChronoDuration::seconds(offset_secs)).to_rfc3339())
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!("katosync-warmup-{}-{name}", std::process::id()))
            .join("provider-warmup.json")
    }

    #[test]
    fn gate_enforces_cooldown_backoff_and_ignores_far_future_clocks() {
        let now = Utc::now();
        let fresh = ProviderWarmupEntry::default();
        assert_eq!(gate(&fresh, now), None);

        let warmed = ProviderWarmupEntry {
            last_success_at: at(-3600),
            last_attempt_at: at(-3600),
            last_result: Some(WarmUpResult::Warmed),
        };
        assert_eq!(gate(&warmed, now), Some(WarmupOutcome::SkippedCooldown));

        let expired = ProviderWarmupEntry {
            last_success_at: at(-WARMUP_COOLDOWN_SECS - 60),
            last_attempt_at: at(-WARMUP_COOLDOWN_SECS - 60),
            last_result: Some(WarmUpResult::Warmed),
        };
        assert_eq!(gate(&expired, now), None);

        let failed = ProviderWarmupEntry {
            last_success_at: None,
            last_attempt_at: at(-60),
            last_result: Some(WarmUpResult::Failed),
        };
        assert_eq!(gate(&failed, now), Some(WarmupOutcome::SkippedBackoff));

        let slightly_ahead = ProviderWarmupEntry {
            last_success_at: at(120),
            ..ProviderWarmupEntry::default()
        };
        assert_eq!(
            gate(&slightly_ahead, now),
            Some(WarmupOutcome::SkippedCooldown)
        );

        let far_future = ProviderWarmupEntry {
            last_success_at: at(WARMUP_COOLDOWN_SECS * 10),
            ..ProviderWarmupEntry::default()
        };
        assert_eq!(gate(&far_future, now), None);

        let garbage = ProviderWarmupEntry {
            last_success_at: Some("not-a-date".to_string()),
            ..ProviderWarmupEntry::default()
        };
        assert_eq!(gate(&garbage, now), None);
    }

    #[test]
    fn state_round_trips_and_tolerates_missing_or_corrupt_files() {
        let path = temp_path("roundtrip");
        let _ = fs::remove_file(&path);
        assert_eq!(load_state(&path), ProviderWarmupState::default());

        let mut state = ProviderWarmupState::default();
        state.codex.last_success_at = at(0);
        state.codex.last_result = Some(WarmUpResult::Warmed);
        save_state(&path, &state).unwrap();
        assert_eq!(load_state(&path), state);
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"lastSuccessAt\""));
        assert!(raw.contains("\"warmed\""));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        fs::write(&path, b"{ broken").unwrap();
        assert_eq!(load_state(&path), ProviderWarmupState::default());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn run_skips_without_inference_for_unsupported_disabled_busy_or_cooling_providers() {
        let path = temp_path("run");
        let _ = fs::remove_file(&path);
        let on = || WarmupSettings {
            feature_enabled: true,
            provider_enabled: true,
            external_work_active: false,
        };

        for provider in [ProviderId::Api, ProviderId::Local, ProviderId::LocalControl] {
            let report = run(provider, &path, on()).await;
            assert_eq!(report.outcome, WarmupOutcome::SkippedUnsupported);
        }
        let report = run(
            ProviderId::Codex,
            &path,
            WarmupSettings {
                feature_enabled: false,
                provider_enabled: true,
                external_work_active: false,
            },
        )
        .await;
        assert_eq!(report.outcome, WarmupOutcome::SkippedFeatureDisabled);
        let report = run(
            ProviderId::Claude,
            &path,
            WarmupSettings {
                feature_enabled: true,
                provider_enabled: false,
                external_work_active: false,
            },
        )
        .await;
        assert_eq!(report.outcome, WarmupOutcome::SkippedProviderDisabled);

        let report = run(
            ProviderId::Codex,
            &path,
            WarmupSettings {
                external_work_active: true,
                ..on()
            },
        )
        .await;
        assert_eq!(report.outcome, WarmupOutcome::SkippedWorkActive);

        {
            let _job = RunnerActivity::begin();
            let report = run(ProviderId::Codex, &path, on()).await;
            assert_eq!(report.outcome, WarmupOutcome::SkippedRunnerBusy);
        }

        // Persistierter Erfolg (z. B. vor einem App-Neustart) blockiert bis zum Fensterende.
        let mut state = ProviderWarmupState::default();
        state.claude.last_success_at = at(-600);
        save_state(&path, &state).unwrap();
        let report = run(ProviderId::Claude, &path, on()).await;
        assert_eq!(report.outcome, WarmupOutcome::SkippedCooldown);
        assert_eq!(report.state, state);
        // Kein Warm-up hat den Zustand veraendert.
        assert_eq!(load_state(&path), state);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
