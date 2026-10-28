# KatoSync Desktop – eindeutige QA-Version und zentriertes 3D-Icon

## Ergebnis

Auf beiden autorisierten Macs war vor der Bereinigung sowohl eine ältere
normale KatoSync-App als auch ein älterer QA-Build installiert; auf dem M2
gab es außerdem eine ältere Project-Preview-App. Die alte Stable/Preview
ließ sich über den macOS-LaunchAgent teils weiterhin als lokaler
Daemon starten. Ein separater, von einer älteren lokalen KatoSync-
Konfiguration stammender Gemma/llama-Server lief noch auf M2.

Es wurde für beide Macs **genau eine aktiv installierte KatoSync-App**
beibehalten: `KatoSync Mesh QA Stage2I.app`, Bundle-ID
`com.nmkato.katosync.meshqa`. Die älteren App-Bundles (3 auf M2,
2 auf M3) wurden kontrolliert in den jeweiligen Benutzer-Papierkorb
verschoben. Nur die exakt betreffenden alten `control`- und auf M2
`sync`-LaunchAgents wurden entladen und ebenfalls in den Papierkorb
verschoben. Sonstige Watchdog-, Provider-Health-, KATOOS- oder
System-LaunchAgents wurden nicht verändert.

Der alte, isoliert laufende `llama-server` auf M2 wurde kontrolliert
beendet; auf M3 lief kein Modellserver. **Modellgewichte, Keychain-
Daten, Nutzerprofile, Auth-Sessions, Projektdateien, Repositories,
Datenbanken und Logs wurden nicht gelöscht.** Die Einträge im
Papierkorb sind für einen manuellen Rollback verfügbar.

## Icon-Fix

Die alte transparente Signet-Datei war visuell rechtsversetzt;
gleichzeitig war der 96px-Markenkörper größer als sein 82px-Rahmen.
Die korrigierte Version verwendet:

- reproduzierbaren Generator `scripts/generate-katosync-icons.py`
  (Pillow + macOS iconutil, keine externen Inhalte);
- Original-Markensignet als hochauflösende 3D-Bildquelle;
  transparentes neues Logo `public/katosync_logo_centered.png`
  mit symmetrisch zentriertem sichtbarem Bereich;
- macOS-Icon mit dunklem, abgerundetem Petrol-Rahmen,
  sanfter Tiefenschattierung, feiner innerer Lichtkante,
  dezentem Signetschatten und ausreichender Innenluft;
- vollständig regenerierten Tauri-Icons `icon.icns`,
  `icon.ico`, `32x32.png`, `128x128.png`,
  `128x128@2x.png` und 1024er Master;
- Sidebar-Rahmen 88px, Inhalt 80px und begrenztem
  Überlauf, responsive 56px/52px.

Das neue transparente Logo ersetzt die bisherige referenzierte
Datei in den relevanten App-Komponenten; die originale Grafik bleibt
als nicht modifizierte Vorlage erhalten.

## Echte Abnahme auf M2/M3

- M2: TypeScript/Vite QA Build und alle **330 Node-Tests bestanden**,
  Rust Format erfolgreich. Neuer QA-Tauri-Build mit QA-Bundle-ID,
  `katoos-auth-qa`, Frontend QA Feature, gültiger
  Developer-ID-Signatur erstellt.
- Das neue signierte Bundle wurde auf beiden Macs an **derselben**
  App-Position ausgetauscht, ohne dauerhafte zweite App-Installation.
  M2 zeigte das neue zentrierte Logo im live gestarteten Sidebar-
  Rahmen; der Fenstertitel blieb `Mesh QA (isoliert)`.
- M2 und M3: App-Executable SHA256
  `17f4345c0492f04563266e1ef69c18c8522bd197babe3f641f23c71728ceff10`,
  Icon-Resource SHA256
  `604f625ea8d3f28e8f51c6983a412dd3b9000a249a9c31a5f4f44d8376b322a8`,
  auf beiden Maschinen identisch.
- macOS `codesign --verify --deep --strict` für die installierten
  Apps auf beiden Geräten erfolgreich.
- Nach der Bereinigung: nur ein KatoSync-App-Prozess je Mac,
  **0 separate laufende llama-server/ollama-Prozesse**.
  Kein Legacy-App-Autostart im ursprünglichen LaunchAgents-Ordner.

**Nicht enthalten:** neue Peer-Freigabe, SAS-Abnahme, echte
mTLS-Verbindung oder Freischaltung von Remote-Jobs.
Die zuvor live registrierten Geräte bleiben `discovered`.

## Reproduzieren

`python3 scripts/generate-katosync-icons.py` und dann
`VITE_KATOOS_AUTH_QA=1 npm run build`.
Mac-Installations- und Signierungsvorgang:
`scripts/build-mesh-qa-macos.sh` mit vom Entwickler
bereitgestellter Signaturidentität und einem schon vorhandenen
signierten, isolierten QA-App-Bundle.
