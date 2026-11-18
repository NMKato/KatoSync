// Created by NMKato Solutions
// Pfad-/Secret-Ausschluesse der Project Registry. Rein und ohne Laufzeit-Imports. Spiegelt die
// Regeln des Rust-Adapters (src-tauri/src/project_registry.rs); beide Seiten werden getestet.
// Das Frontend prueft Adapter-Ergebnisse vor dem Persistieren erneut (Defense in Depth).

// Nicht versteckte Ordner, die nie betreten werden (Build-Ausgaben, Abhaengigkeiten, Caches, Systemordner).
export const EXCLUDED_DIR_NAMES: readonly string[] = [
  "node_modules",
  "deriveddata",
  "build",
  "dist",
  "out",
  "target",
  "pods",
  "carthage",
  "coverage",
  "venv",
  "__pycache__",
  "__macosx",
  "library",
  "applications",
  "secrets",
  "private",
  "keys",
  "credentials"
];

const EXCLUDED_DIR_SET = new Set(EXCLUDED_DIR_NAMES);

/** Versteckte Ordner (.git, .ssh, .cache, .env …) und bekannte Build-/Cache-/Secret-Ordner. */
export function isExcludedDirName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return !lower || lower.startsWith(".") || EXCLUDED_DIR_SET.has(lower);
}

const SECRET_FILE_NAME =
  /(^\.env(\.|$)|secret|apikey|api_key|private_key|credential|\.pem$|\.key$|\.p12$|\.pfx$|\.p8$|\.cer$|\.crt$|\.jks$|\.keystore$|\.mobileprovision$|^id_(rsa|dsa|ecdsa|ed25519)|^\.npmrc$|^\.netrc$|^\.pypirc$|\.tfvars$)/i;

export function isSecretFileName(name: string): boolean {
  return SECRET_FILE_NAME.test(name.trim());
}

/** Relativer Projektpfad ist tabu: Ausbruch (..), absolut, ausgeschlossener Ordner oder Secret-Dateiname. */
export function isExcludedRelativePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "..")) return true;
  const file = segments[segments.length - 1];
  return segments.slice(0, -1).some(isExcludedDirName) || isSecretFileName(file);
}

const SECRET_CONTENT =
  /(API_KEY\s*=|SECRET\s*=|TOKEN\s*=|PASSWORD\s*=|PRIVATE_KEY|BEGIN RSA PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE|DATABASE_URL|mistral_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,})/i;

export function hasSecretPattern(text: string): boolean {
  return SECRET_CONTENT.test(text);
}

/** Ersetzt Secret-Treffer; sichert Texte ab, die in Capsule/Registry landen. */
export function redactSecrets(text: string): string {
  return text.replace(new RegExp(SECRET_CONTENT.source, "gi"), "[redacted]");
}

/** Entfernt Zugangsdaten aus einer Remote-URL (https://user:token@host/… -> https://host/…). */
export function sanitizeRemoteUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
}

/** host/owner/repo in Kleinschreibung ohne Protokoll, Zugangsdaten und .git – Basis der kanonischen Identitaet. */
export function normalizeRemote(url: string | null | undefined): string | null {
  const clean = sanitizeRemoteUrl(url);
  if (!clean) return null;
  let rest = clean;
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(rest);
  if (scp) rest = `${scp[1]}/${scp[2]}`;
  else rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^/@\s]*@/, "");
  rest = rest.replace(/:\d+(?=\/)/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  return rest ? rest.toLowerCase() : null;
}
