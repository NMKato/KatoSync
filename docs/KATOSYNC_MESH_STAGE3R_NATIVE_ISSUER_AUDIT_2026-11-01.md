# KatoSync Mesh Stage 3R – native Issuer-Prüfung und Geräte-Audit

**01.11.2026 · NMKato Solutions · QA-only, gestapelter Draft auf Stage 3Q**

## Tatsächlicher Stand der installierten Anwendungen

Die vorhandenen macOS-QA-Anwendungen wurden **lesend** auf dem autorisierten M2 und M3 geprüft. Beide besitzen:

- App-Name: `KatoSync Mesh QA Stage2I.app`
- Bundle-ID: `com.nmkato.katosync.meshqa`
- Versionsanzeige: `2.0.0`
- Developer-Team: `T8SB89JPX7`; Signaturprüfung auf beiden Macs erfolgreich
- Exakte SHA-256 des ausführbaren Programms auf **beiden** Rechnern:
  `39ac12719107e0cf012ca9f6442a49ce8660e0862f2e403a0fe311bc01f2b521`

Der M3-Prozess war zum Prüfzeitpunkt gestartet. Dies ist **kein Nachweis**, dass im alten Stage2I-Bundle neue Mesh-V2-Funktionen vorhanden sind; die neuen Protokollstufen liegen bislang im Entwicklungszweig. Die übereinstimmende Programmdatei widerlegt aber eine Build-Differenz zwischen M2 und M3.

Das bestehende Build-Skript `scripts/build-mesh-qa-macos.sh` setzt ausdrücklich `--features katoos-auth-qa` und `VITE_KATOOS_AUTH_QA=1`. Der Rust-Quellcode `src-tauri/src/lib.rs` bindet für dieses Feature den nativen Issuer fest an das **gemeinsame produktive KATOOS-Supabase-Projekt**; ohne das Feature verwendet er den bisherigen KatoSync-Issuer. Weder eine separate Preview-Authentifizierung noch ein isolierter Preview-Schlüsselbund wird dadurch bereitgestellt. Die V2-Signaturen aus Stage3M–3Q dürfen daher **nicht** mit dem vorhandenen KATOOS-Access-Token zu einem Preview-Backend gesendet werden.

## Neuer Stage3R-Nachweis in der Anwendung

Neu ist das **native, lesende Tauri-Kommando** `mesh_native_issuer_readiness` in `src-tauri/src/mesh_native_issuer.rs`. Es meldet den tatsächlich einkompilierten Issuer-Typ (KATOOS-Shared, KatoSync-Legacy oder unbekannt) und die weiter fehlende unabhängige Preview-Sitzung. Der Weg liest **keinen** Token, keine Session, kein Keychain-Geheimnis und führt **keine** HTTP-Anfrage aus.

Die UI-Komponente `MeshConnectionCard.tsx` zeigt den Issuer-Zustand innerhalb der technischen Mesh-Details an. Deutsch, Englisch, Spanisch und Russisch wurden ergänzt. Ein älteres App-Bundle ohne das neue Tauri-Kommando bleibt weiter benutzbar; das Frontend zeigt dann einen eindeutigen Hinweis auf den fehlenden Diagnosebefehl, statt eine Preview-Freigabe vorzutäuschen.

Der neue Rust-Vertrag gibt in jeder Konfiguration weiterhin folgende Sperrwerte zurück:

- `currentSessionReusableForPreview=false`
- `previewTokenStoreIsolated=false`
- `previewCloudProbeEnabled=false`
- `onlinePreviewVerified=false`
- `devicePairingEnabled=false`
- `remoteJobsEnabled=false`

Damit sind die Ergebnisse diagnostisch und **keine** Berechtigung, kein Token-Transfer, kein Cloud-Job und keine Gerätefreigabe. Synthetische Tests prüfen zusätzlich die strikte Syntax der künftigen Preview-Projekt- und Deployment-Bindung; sie sind ausdrücklich kein Online-Auth- oder Signaturnachweis.

## Abnahme und verbleibender Weg

Lokale JS-Integrationstests `tests/meshNativeIssuerStage3R.test.ts` schützen den nativen IPC-Vertrag, die sichere UI-Rückfallanzeige und die vier UI-Sprachen. Rust-Unit-Tests prüfen den kompilierungsabhängigen Issuer und die isolierte Preview-URL, ohne sich einzuloggen.

**P0-Blocker:** Vor einem echten M2↔M3-Preview-Test ist ein von der KATOOS-Sitzung **unabhängiger** GoTrue-Anmeldeweg mit eigenem Credential-Namespace und expliziter Issuer-Bindung erforderlich. Danach: vollständiger isolierter Cloud-JWT-/PostgREST-/Edge-Test, Single-Use-Inbox-Transaktionen und die ausdrückliche SAS-/mTLS-Gerätefreigabe. Der vorhandene produktive KATOOS-Issuer, die produktiven Edge-Inbox-/Enrollment-Dateien und beide installierten Stage2I-Apps bleiben **unverändert**.

**Kein Merge, kein Deployment, kein Overwrite der installierten App, keine neue kostenpflichtige Cloud-Ressource.** Der M2 verfügt bei der Prüfung über rund 85 GiB freien Speicher; ein großer doppelter App-/Rust-Neubau ist deshalb nicht automatisch veranlasst.
