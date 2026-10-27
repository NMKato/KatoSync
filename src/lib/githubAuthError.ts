// Created by NMKato Solutions
// Localize only controlled error categories. Never echo raw backend errors,
// credentials, account details or OAuth device codes into UI/telemetry.
export type GithubAuthFailure = "session" | "keychain" | "network" | "configuration" | "unknown";
export function classifyGithubAuthFailure(error: unknown): GithubAuthFailure {
  const message = typeof error === "string" ? error :
    error instanceof Error ? error.message : "";
  if (/Schlüsselbund|Keychain|Betriebssystem-Schlüsselbund|credential store/i.test(message))
    return "keychain";
  if (/nicht registriert|nicht eingerichtet|konfiguriert|Client-ID|App.Config/i.test(message))
    return "configuration";
  if (/Sitzung|KatoSync.Konto|KATOOS.Konto|KatoSync.Benutzer|identity|identität|erst.*anmelden/i.test(message))
    return "session";
  if (/nicht erreich|Netzwerk|HTTP.Client|Netz|network|zeitüberschreitung|timeout|token.abfrage fehl/i.test(message))
    return "network";
  return "unknown";
}
