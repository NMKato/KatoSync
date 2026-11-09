# Local-Brain-Modellverteilung (R2-ready)

Created by NMKato Solutions

KatoSync bleibt als Installer klein. Die llama.cpp-Runtime verwaltet KatoSync selbst; die
mehrere GB grossen Modellgewichte laedt der Nutzer getrennt als versioniertes **Modellpaket**.
Zielkanal ist ein NMKato-kontrollierter Cloudflare-R2-Bucket hinter einer Custom Domain.
Bis ein Paket die Lizenz-/Redistribution-Freigabe hat, nutzt KatoSync ausschliesslich den
gepinnten Upstream (Hugging Face Revision + SHA-256).

Code: `src-tauri/src/model_distribution.rs` (Vertrag, Policy, Download, Paketbaum) und
`src-tauri/src/local_brain.rs` (bestehender Gemma-4-Installer, nutzt den Vertrag).

## Paketvertrag `kato-model-package/1`

| Feld | Bedeutung |
| --- | --- |
| `packageId` | `[a-z0-9-]`, stabil ueber Versionen (z. B. `kato-local-brain-gemma-4-e4b`) |
| `version` | SemVer 2.0; `stable` erlaubt keine Vorabversion |
| `channel` | `stable` oder `beta` |
| `releaseState` | `draft` · `internal` · `public` – `public` nur mit bestandenem Release-Gate |
| `fileName`, `sizeBytes`, `sha256`, `quantization` | exakte Artefaktidentitaet; Groesse und Hash sind Pflicht |
| `platforms`, `runtime.id`, `runtime.versions` | unterstuetzte Plattformen und llama.cpp-Builds |
| `minimumRamGb`, `preferredRamGb`, `contextTokens` | Empfehlung; `contextTokens` wird als `--ctx-size` genutzt |
| `license.spdx`, `license.noticeRefs` | Lizenz und NOTICE-Objekte |
| `license.userAcceptanceRequired`, `license.acceptanceTextRef` | explizite Nutzerzustimmung, falls die Lizenz das verlangt |
| `license.redistribution` | `status` (`pending_review`/`approved`/`denied`), `reviewedBy`, `reviewedAt`, `basis` |
| `objectKey` | muss exakt `packages/<packageId>/<version>/<fileName>` sein |
| `upstreamUrl` | optionaler gepinnter Upstream (HTTPS, erlaubter Host, ohne Query/Userinfo) |

Im eingebetteten `src/lib/localBrainManifest.json` (Schema 2) stehen diese Felder als
`models[].package` neben den bestehenden Modellfeldern; `distribution.baseUrl` ist dort
bewusst `null`, `distribution.allowedHosts` die HTTPS-Allowlist.

### Release-Gate

Ein Paket ist erst veroeffentlichbar, wenn `release_gate_blockers` (Rust) bzw.
`localBrainReleaseBlockers` (TS) leer ist:

- SPDX-Lizenz gesetzt, mindestens eine NOTICE-Referenz
- bei `userAcceptanceRequired` ein Zustimmungstext
- Redistribution `approved` mit `reviewedBy`, `reviewedAt` und `basis`

Ein Manifest mit `releaseState: public` und offenen Blockern wird beim Laden abgelehnt.
Nicht oeffentliche Pakete werden nie ueber die eigene Distribution-Base geladen.

## Download- und Installationssemantik

1. Quelle: oeffentliches Paket → `<baseUrl>/<objectKey>`, danach Upstream; sonst nur Upstream.
   Nur HTTPS auf erlaubten Hosts, keine Zugangsdaten, keine Query (keine signierten URLs).
   Weiterleitungen nur auf HTTPS.
2. Staging: inhaltsadressiert `staging/<sha256>.part`; Abbruch behaelt den Teil-Download,
   der naechste Versuch setzt per `Range` fort (`Content-Range` muss exakt anschliessen,
   sonst Neustart).
3. Verifikation: exakte Groesse + SHA-256. Abweichung verwirft die Datei (fail closed) und
   versucht keine weitere Quelle mit demselben falschen Inhalt.
4. Promote: atomarer Rename nach `packages/<id>/<version>/<fileName>`; erst danach wird das
   Ledger `packages/<id>/ledger.json` geschrieben (aktiv, Rollback, Pin, Hash, Groesse).
5. Start: `resolve_for_launch` prueft Groesse und mtime; bei veraenderter mtime wird neu gehasht.
   Unverifizierte Gewichte werden nie an llama.cpp uebergeben. Altbestand aus `models/`
   wird vor Nutzung ins Staging verschoben und denselben Pruefungen unterzogen.
6. Update/Rollback: `plan_update` → `not_installed` · `current` · `update_available` ·
   `pinned` · `newer_installed`. Aktive, vorherige und gepinnte Version bleiben erhalten,
   alles andere wird beim Promote entfernt. Rollback aktiviert die vorherige Version und pinnt sie.
7. Entfernen: einzelne Version (aktive nur bei gestopptem Local Brain), Symlinks und Pfade
   ausserhalb des Paketbaums werden verweigert. `remove_local_brain` entfernt weiterhin alles.

Persistiert werden nur Version, Kanal, Dateiname, Hash, Groesse und Zeitstempel – nie URLs,
Tokens oder Signaturen.

## R2-Objektlayout

```
<bucket>/
  channels/
    stable/index.json          # kato-model-index/1, kurze Cache-TTL
    beta/index.json
  packages/
    <packageId>/
      <version>/
        manifest.json          # kato-model-package/1 (identisch zum Index-Eintrag)
        <fileName>.gguf        # unveraenderlich nach Upload
        SHA256SUMS
        LICENSE
        NOTICE
        ACCEPTANCE.md          # nur falls userAcceptanceRequired
```

- Auslieferung ueber eine R2 Custom Domain (oeffentlicher Lesezugriff, `Range` unterstuetzt).
  Die Domain wird erst nach Freigabe als `distribution.baseUrl` und in `allowedHosts`
  eingetragen; keine Account-ID, kein `r2.dev`-Entwicklungs-Endpunkt, keine Presigned URLs.
- Versionierte Objekte sind unveraenderlich (`Cache-Control: public, max-age=31536000, immutable`).
  Korrekturen erfolgen nur als neue Version; `index.json` erhaelt eine kurze TTL.

## Release-/Upload-Checkliste

1. Upstream-Revision pinnen, GGUF lokal laden, `shasum -a 256` und Bytegroesse notieren.
2. Lizenz pruefen: SPDX, NOTICE-Pflichten, Weitergabe- und Zustimmungsbedingungen.
   Ergebnis in `license.redistribution` dokumentieren (`reviewedBy`, `reviewedAt`, `basis`).
3. `manifest.json` mit `releaseState: internal` erzeugen; `objectKey` nach obigem Layout.
4. Upload mit owner-lokalen R2-Zugangsdaten (z. B. `wrangler r2 object put` oder ein
   S3-kompatibler Client). Zugangsdaten bleiben ausserhalb des Repos und werden nie im
   Manifest oder in Logs abgelegt.
5. Nach dem Upload ueber die Custom Domain herunterladen und Groesse + SHA-256 erneut pruefen.
6. Release-Gate leer? Erst dann `releaseState: public` setzen und `channels/<channel>/index.json`
   aktualisieren. Das eingebettete Manifest erhaelt die neue Version und ggf. `baseUrl`.
7. KatoSync-Tests (`npm test`, `cargo test`) laufen gegen das neue Manifest; kein Merge
   ohne Freigabe des aktiven Stabilitaetsfensters.
8. Rueckzug: Index-Eintrag entfernen oder Kanal auf die Vorversion zuruecksetzen; installierte
   Clients behalten ihre verifizierte Version und koennen per Rollback/Pin zurueckwechseln.

Modellgewichte (`*.gguf`) werden nie eingecheckt.
