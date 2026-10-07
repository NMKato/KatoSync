# Local-Brain-Modell- und Runtime-Verteilung

Created by NMKato Solutions

KatoSync bleibt als Installer klein. Die gepinnte llama.cpp-Runtime und die mehrere GB grossen
Modellgewichte werden getrennt geladen, aber durch dieselbe lokale Sicherheitskette abgesichert.
Ein eigener Cloudflare-R2-Kanal darf erst aktiviert werden, wenn sein offline verwalteter
Ed25519-Root-Key in KatoSync gepinnt, der Kanalindex gueltig signiert und das
Lizenz-/Redistribution-Gate bestanden ist.

Aktueller Release-Zustand (2026-10-07): `distribution.baseUrl` ist `null`, es ist noch kein
Produktions-Root-Key gepinnt und das Modell bleibt `releaseState: internal`. Der R2-Kanal ist
damit absichtlich fail-closed deaktiviert; in diesem Hardening-Slice erfolgt kein R2-Upload.

Code:

- `src-tauri/src/model_trust.rs` – signierter Metadatenumschlag und Rollback-Untergrenze
- `src-tauri/src/model_distribution.rs` – Paketvertrag, Origin-/Redirect-Policy, Download und Modell-Ledger
- `src-tauri/src/safe_archive.rs` – begrenzte Runtime-Extraktion und Runtime-Baum-Ledger
- `src-tauri/src/local_brain.rs` – verbindliche Integration in Installation und Start

## Vertrauensmodell

### Offline gepinnter Root

KatoSync akzeptiert fuer den eigenen R2-Kanal nur Ed25519-Schluessel, deren rohe 32-Byte-
Public-Keys offline festgelegt und in das Release-Binary kompiliert wurden. Die Key-ID ist der
kleingeschriebene SHA-256-Hash des rohen Public-Keys. Root-Schwelle und Schluesselmenge sind Teil
des Clients; eine Rotation braucht fuer v1 ein App-Update. Private Schluessel gehoeren niemals in
Repository, CI-Logs, R2 oder KatoSync-Konfiguration.

Ein leerer Root-Satz, eine unbekannte oder doppelte Key-ID, eine ungueltige Signatur oder eine
nicht erreichte Schwelle beendet die Verifikation. Bis der Produktions-Public-Key vorliegt, liefert
`TrustRoot::production()` absichtlich einen Fehler.

### Signierter Kanalindex `kato-model-index/2`

Nur `channels/<channel>/index.json` ist veraenderlich. Das Objekt enthaelt einen DSSE-aehnlichen
Umschlag:

```json
{
  "payloadType": "application/vnd.katosync.model-index+json",
  "payload": "<base64 der exakten JSON-Payload>",
  "signatures": [{ "keyid": "<sha256-public-key>", "sig": "<base64-ed25519>" }]
}
```

Signiert wird DSSE-v1-PAE ueber Payload-Typ und exakte Payload-Bytes. Die signierte Payload
enthaelt:

| Feld | Sicherheitsbedeutung |
| --- | --- |
| `schema` | exakt `kato-model-index/2` |
| `channel` | muss dem angeforderten Kanal entsprechen |
| `version` | monotoner Rollback-Zaehler, beginnend bei 1 |
| `expires` | RFC-3339-Ablaufzeitpunkt |
| `packages` | vollstaendige, versionierte Paketidentitaeten |

Jeder Paketeintrag bindet mindestens Version, exakten unveraenderlichen Object-Key, Dateiname,
Bytegroesse, SHA-256, Plattform, Runtime-Kompatibilitaet und Lizenz-/Release-Status. Der Object-Key
muss exakt `packages/<packageId>/<version>/<fileName>` lauten; `latest`, unversionierte oder
abweichende Schluessel werden abgelehnt.

Der Client verifiziert vor jedem Download lokal in dieser Reihenfolge:

1. Metadaten-Byteobergrenze, Umschlag und Payload-Typ
2. alle genannten Key-IDs gegen den offline gepinnten Root und die Signaturschwelle
3. Payload-Schema, Kanal und eindeutige `packageId@version`-Eintraege
4. Ablaufzeit (`now < expires`)
5. monotonen `version`-Zaehler und Payload-Hash gegen den lokalen Trust-Floor
6. vollstaendigen Paketvertrag einschliesslich Release-/Lizenz-Gate

Ein niedrigerer Zaehler ist ein Rollback. Dieselbe Version mit anderem Payload-Hash ist ein Fork.
Beides wird abgelehnt. Der akzeptierte Kanalstand (`version`, Payload-SHA-256, Ablaufzeit) liegt
ausserhalb des entfernbaren Local-Brain-Verzeichnisses, damit eine Deinstallation die
Rollback-Untergrenze nicht zuruecksetzt. Beschaedigter lokaler Trust-State ist ein Fehler, kein
stilles Reset.

Abgelaufene Metadaten werden in Produktion immer abgelehnt. Nur Debug-Builds koennen mit
`KATOSYNC_DEV_ALLOW_EXPIRED_MODEL_METADATA=1` den expliziten Entwickler-Override aktivieren;
Release-Builds ignorieren ihn.

## Paketvertrag `kato-model-package/1`

| Feld | Bedeutung |
| --- | --- |
| `packageId` | `[a-z0-9-]`, stabil ueber Versionen |
| `version` | SemVer 2.0; `stable` erlaubt keine Vorabversion |
| `channel` | `stable` oder `beta` |
| `releaseState` | `draft`, `internal` oder `public` |
| `fileName`, `sizeBytes`, `sha256` | exakte Artefaktidentitaet und harte Downloadgrenze |
| `platforms`, `runtime.id`, `runtime.versions` | Plattform- und Runtime-Bindung |
| `objectKey` | exakt versionierter, unveraenderlicher R2-Key |
| `upstreamUrl` | optionaler gepinnter HTTPS-Upstream ohne Userinfo/Query/Fragment |
| `license.*` | Lizenz-, NOTICE-, Zustimmungstext- und Redistribution-Nachweis |

Das eingebettete Manifest ist der vertrauenswuerdige Fallback fuer den gepinnten Upstream, solange
keine eigene Distribution-Base gesetzt ist. Sobald `baseUrl` gesetzt ist, muss der signierte Index
erfolgreich verifiziert werden; es gibt keinen stillen Rueckfall auf einen rohen R2-Index.

### Fail-closed Release-Gate

`releaseState: public` ist nur gueltig, wenn `release_gate_blockers` (Rust) beziehungsweise
`localBrainReleaseBlockers` (TypeScript) leer ist:

- SPDX-Lizenz gesetzt und mindestens eine NOTICE-Referenz vorhanden
- bei erforderlicher Nutzerzustimmung ein Zustimmungstext referenziert
- Redistribution `approved` mit `reviewedBy`, `reviewedAt` und `basis`

Ein signierter Index kann dieses Gate nicht umgehen. Ein nicht freigegebenes Paket wird weder aus
dem eigenen Kanal gewaehlt noch durch eine Signatur automatisch oeffentlich.

## Origin- und Redirect-Policy

- Direkte Quellen muessen HTTPS auf dem Standardport, ohne Userinfo, Query oder Fragment sein und
  einen Host aus `distribution.allowedHosts` verwenden.
- Jede einzelne Weiterleitung wird erneut geprueft: HTTPS/Standardport, keine URL-Zugangsdaten,
  kein Fragment und nur ein exakter beziehungsweise eng begrenzter CDN-Host aus
  `redirectHosts`. Redirect-Hosts sind keine zulaessigen direkten Quellen.
- Zeitlich begrenzte CDN-Queryparameter sind erst am validierten Redirect-Ziel erlaubt und werden
  weder protokolliert noch persistiert. KatoSync sendet keine Download-Credentials.
- Maximal fuenf Redirects; Referer und Cookie-Speicher sind deaktiviert.

Das aktuelle eingebettete Manifest erlaubt direkte Downloads von `github.com` und
`huggingface.co`; Redirects sind auf `release-assets.githubusercontent.com` und echte
Subdomains von `hf.co` begrenzt.

## Download-, Extraktions- und Installationskette

1. Vertrauenswuerdige Metadaten bestimmen einen exakten, versionierten Artefaktschluessel.
2. Download in ein KatoSync-eigenes Staging-Verzeichnis (Unix `0700`) als
   `staging/<sha256>.part`.
3. Die signierte/gepinnte Bytegroesse ist zugleich die harte Downloadobergrenze – auch bei
   chunked Transfer. Runtime-Archive besitzen ebenfalls eine verpflichtende `sizeBytes`-Angabe.
4. Unterbrechungen duerfen per `Range` fortgesetzt werden. `Content-Range` muss exakt
   anschliessen; ein gepflanzter, vollstaendiger oder fortgesetzter Teil muss am Ende immer erneut
   exakte Groesse und SHA-256 bestehen. Eine `.part`-Datei ist nie promotbar.
5. Runtime-Archive werden erst nach Downloadverifikation in ein frisches privates Verzeichnis
   entpackt. Grenzen: 1 GiB entpackte Dateien, 512 MiB pro Eintrag, 4096 Eintraege und Pfadtiefe 8;
   der gesamte dekomprimierte Gzip-Strom ist ebenfalls begrenzt.
6. Absolute Pfade, `..`, Backslashes/Laufwerkspfade, Steuerzeichen, Hardlinks, Geraete, FIFOs und
   sonstige Spezialdateien werden abgelehnt. Allgemeine Symlinks werden abgelehnt. Die offiziellen
   llama.cpp-Archive enthalten soname-Geschwister-Aliase; ausschliesslich solche einfachen,
   archivintern aufloesbaren Namen werden als regulaere Kopien materialisiert – nie als Link.
7. Erst der vollstaendig gepruefte Modell- oder Runtime-Baum wird per Rename atomar promotet.
   Teil-/Fehlerzustaende erhalten kein gueltiges Ledger.

Das Modell-Ledger persistiert Version, Kanal, Dateiname, Hash, Groesse und Metadatenherkunft. Bei
einem signierten Kanal sind dies zusaetzlich Indexversion und Payload-Hash. URLs, Tokens und
Signaturen werden nicht persistiert.

Das Runtime-Baum-Ledger bindet Runtime-Version, Archivhash, Executable sowie Hash und Groesse jeder
entpackten Datei. Vor einem eigenen `llama-server`-Start wird der komplette Baum erneut gehasht;
ersetzte oder eingeschleuste Dateien und Links stoppen den Start. Modellgewichte werden beim
ersten Start pro Prozess beziehungsweise nach jeder erkennbaren Dateiaenderung erneut gegen ihr
Ledger gehasht.

## Restrisiken und offene Release-Blocker

- **Kein Produktions-Root gepinnt:** `PINNED_ROOT_KEYS_HEX` ist leer. Der signierte R2-Kanal
  bleibt deaktiviert, bis der offline erzeugte Public-Key per App-Update gepinnt ist.
- **Kein Signier-/Publish-Werkzeug im Repo:** Index-Payloads muessen offline mit dem Root-Key
  signiert werden; Signier- und Upload-Werkzeug gehoeren nicht in dieses oeffentliche Repository.
- **Lizenz-Gate offen:** Das empfohlene Modell bleibt `internal`, bis die Redistribution geprueft
  und dokumentiert ist; ein signierter Index kann das Gate nicht aufheben.
- **Gleicher Benutzer:** Zwischen Baum-/Modell-Hash und Prozessstart bleibt ein kurzes
  TOCTOU-Fenster gegen Prozesse desselben Benutzerkontos. Installierte Gewichte sind
  schreibgeschuetzt, Dateistempel erzwingen Re-Hash; ein vollstaendiger Schutz gegen lokale
  Malware desselben Kontos ist ausserhalb des Bedrohungsmodells.
- **Root-Rotation/Revocation:** v1 rotiert Schluessel ausschliesslich per App-Update; es gibt
  keine separate Root-/Targets-Rollentrennung wie bei vollem TUF.

## Update und Rollback

- Ein Remote-Download darf eine aktive Installation nie auf eine niedrigere SemVer-Version setzen.
- Eine bereits installierte Version darf nicht unter derselben Versionsnummer anderen Inhalt
  erhalten.
- Rollback aktiviert ausschliesslich die im lokalen Ledger vorhandene vorherige Version. Das Ziel
  wird vor Aktivierung erneut vollstaendig gehasht und anschliessend gepinnt.
- Aeltere Remote-Metadaten werden fuer Rollback niemals akzeptiert; der Metadaten-Floor bleibt
  monoton.

## R2-Objektlayout und Immutabilitaet

```text
<bucket>/
  channels/
    stable/index.json          # signierter Umschlag, kurze TTL
    beta/index.json
  packages/
    <packageId>/
      <version>/
        manifest.json          # optionales, identisches Paketdokument
        <fileName>.gguf        # nach Veroeffentlichung unveraenderlich
        SHA256SUMS
        LICENSE
        NOTICE
        ACCEPTANCE.md          # nur falls erforderlich
```

R2/IAM muss veroeffentlichte `packages/<id>/<version>/...`-Objekte organisatorisch gegen
Ueberschreiben und Loeschen schuetzen. Auslieferung: lange immutable Cache-TTL fuer Paketobjekte,
kurze TTL fuer den signierten Index. Korrekturen erhalten immer eine neue Paketversion und eine
hoehere Indexversion. Ein mutables `latest`-Artefakt ist nicht Teil des Designs.

## Fail-closed Release- und Upload-Checkliste

1. Ed25519-Root offline erzeugen/sichern; ausschliesslich den Public-Key in KatoSync pinnen.
2. Upstream-Revision, exakte Bytegroesse und SHA-256 lokal verifizieren.
3. Lizenz, NOTICE, Weitergabe und etwaige Zustimmungspflichten pruefen und dokumentieren.
4. Paket zunaechst `internal` halten; versionierten Object-Key festlegen.
5. Mit owner-lokalen R2-Credentials hochladen. KatoSync liest oder protokolliert keine
   Provider-Tokens. Dieser Hardening-Slice fuehrt keinen Produktions-Upload aus.
6. Objekt ueber die freigegebene Custom Domain erneut herunterladen und Groesse/Hash pruefen;
   R2-Policy gegen Ueberschreiben/Loeschen verifizieren.
7. Erst bei leerem Lizenz-Gate `public` setzen. Indexversion erhoehen, Ablaufzeit setzen, exakte
   Payload offline signieren und Umschlag veroeffentlichen.
8. Client mit dem gepinnten Root gegen gueltige, manipulierte, abgelaufene und zurueckgerollte
   Metadaten testen. Danach `baseUrl` aktivieren.
9. Kein automatisches Merge; Release erst nach der gesamten verifizierten Testmatrix.

Modellgewichte, private Signierschluessel und R2-Credentials werden nie eingecheckt.
