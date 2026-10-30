# KatoSync Mesh Stage 2P – Real-Hardware-LAN-QA, synthetische Zertifikate

**Datum:** 30. Oktober 2026. Reproduzierbarer Test auf zwei tatsächlich getrennten macOS-Arm64-Rechnern, M2 und M3. Dies ist **kein Live-Konto-Pairing** und kein echter Freigabestand für Mesh-Remote-Tasks.

## Voraussetzungen und Befunde

- M2 und M3 sind online und erreichen sich direkt über ihr privates RFC1918-LAN; keine WAN-Adresse, kein Tunnel und keine Cloud-Infrastruktur für den Test verwendet.
- Die Rust-Testquellen `mesh_tls.rs`, `mesh_transport.rs` und `mesh_admission.rs` haben auf **beiden Rechnern dieselben SHA-256-Dateiwerte**. Unterschiedliche lokale Git-Commitstände sind dadurch für diese drei getesteten Module transparent.
- Die bestehende Hardware-QA `mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe` ist im regulären Rust-Testlauf absichtlich ignoriert und nur mit `--ignored --exact` auszuführen.
- Der Test verwendet fest definierte **künstliche** Ed25519-Testidentitäten aus `SigningKey::from_bytes([41;32])`, `[42;32]` und für den falschen Pin `[43;32]`. **Keine Keychain, Tokens, Supabase-Zugriffe oder echte Konto-Geräteidentitäten.**
- Explizites `KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY`, Rolleneinstellung, Ziel-IP und erwartete Gegenstellen-IP erforderlich. Der Server lässt einen einmaligen, zeitbegrenzten TCP-Accept zu; kein Daemon oder dauerhafter Listener.

## Durchgeführte Hardwaretests

| Test | M2 (einmaliger Server) | M3 (Client) | Ergebnis |
|---|---|---|---|
| Positive, gegenseitig gepinnte TLS‑1.3-Verbindung | `manual_two_host_private_lan_pinned_tls_probe` 1/1 PASS | 1/1 PASS | **Bestanden** |
| Falscher Zertifikats-Pin am M3-Client | Der Server bestätigt die erwartete Verbindungsablehnung, 1/1 PASS | Der Client bestätigt die erwartete Ablehnung, 1/1 PASS | **Bestanden** |

Der positiv getestete TLS-Probe tauscht ausschließlich ein kurzes festes Probe-Frame mit 32‑Byte-Nonce und Echo der Nonce aus. Daraus entsteht kein länger lebender Session-Token, Peer-Verbindungseintrag oder Remote-Auftrag. Der Negativtest beweist, dass ein falscher Pin auf realer LAN-Hardware nicht unbemerkt akzeptiert wird; **nicht**, dass alle denkbaren Angriffe ausgeschlossen sind.

Die private LAN-Socket-Adresse wurde für jedes Experiment fest vorgegeben, der unprivilegierte Testport danach wieder freigegeben. **Auf beiden Macs: 0 verbleibende Listener auf den benutzten QA-Ports.**

## Wiederholbare Teststeuerung

Der neue `scripts/qa-mesh-two-mac-synthetic.sh`-Launcher benötigt eine getrennte, **bewusste Freigabe** vor jeder Testausführung; ohne gesetzte Parameter verweigert er den Start. Er führt nur den ausdrücklich ignorierten Rust-Hardwaretest aus und hat keine Installations-, Enrollment-, Pairing- oder Remote-Job-Funktion.

In zwei Terminals, auf getrennten Macs, in ihren **jeweils isolierten Test-Repositories**:

```bash
# M2: Server — PRIVATE_M2 und PRIVATE_M3 durch eigene private LAN-IPs ersetzen.
export KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY
export KATOSYNC_MESH_LAN_QA_ROLE=server
export KATOSYNC_MESH_LAN_QA_ADDRESS=PRIVATE_M2:49327
export KATOSYNC_MESH_LAN_QA_EXPECT_PEER=PRIVATE_M3
bash scripts/qa-mesh-two-mac-synthetic.sh

# M3: Client (auf dem anderen Mac, mit derselben Rust-Transport-Testversion).
export KATOSYNC_MESH_LAN_QA_ALLOW=SYNTHETIC_FIXTURES_ONLY
export KATOSYNC_MESH_LAN_QA_ROLE=client
export KATOSYNC_MESH_LAN_QA_ADDRESS=PRIVATE_M2:49327
export KATOSYNC_MESH_LAN_QA_EXPECT_PEER=PRIVATE_M2
bash scripts/qa-mesh-two-mac-synthetic.sh
```

Die obige positive QA ist auf den beiden Macs **bereits erfolgreich durchgeführt**. Zum isolierten Negativtest wird auf dem Server ein neuer Port mit `KATOSYNC_MESH_LAN_QA_NEGATIVE=YES`, auf dem Client `KATOSYNC_MESH_LAN_QA_ROLE=client-wrong-pin` verwendet.

## Aufgeräumt und verifiziert

- Beide installierten `KatoSync Mesh QA Stage2I.app`-Bins bleiben unverändert; SHA‑256 beider Mac-Binärdateien identisch: `39ac12719107e0cf012ca9f6442a49ce8660e0862f2e403a0fe311bc01f2b521`.
- Temporäre `src-tauri/resources/poppler/.test-only`, `typst/.test-only` und der M3-`dist/index.html`-Compiler-Platzhalter wurden entfernt. Beide Quellarbeitsverzeichnisse nach der Hardware-QA **sauber**.
- Kein Zugriff auf private oder produktive Keychain-Schlüssel. Kein Cloud-Migration- oder Edge-Deployment. Die M2/M3-Tests waren einmalige Rust-Testprozesse.
- Read-only-Live-Preflight: 2 `discovered`-Geräte, 0 Einladungen, Stage 2L/2O-Migrationen noch nicht live, `service_role` hat Tabellen-UPDATE-Berechtigung; das bisherige authentifizierte Invite-SELECT wird erst mit der geplanten Stage-2O-Migration entzogen.

## Was damit **nicht** freigegeben ist

1. Gestapelter QA-Rollout von PR #177 bis #181 mit überprüfter Migrationsreihenfolge, DB-Privileges und Edge-Feature-Flags.
2. Realer KatoSync-Einladungsfluss mit den **existierenden gerätegebundenen** OS-Schlüsseln und separatem Login-/Mitgliedschafts-/Widerrufstest auf M2 und M3.
3. **Beidseitige menschliche SAS-Bestätigung** für genau diese echte Session und gespeicherte, beidseitig konsistente Key-Pins.
4. Authentifizierter TLS-Transport mit den **echten** nach SAS bestätigten Gerätezertifikaten, Peer-Liveness/Re-Auth und Revocation-Watcher.
5. Nur nach gesonderter Freigabe überhaupt Read-only-Remote-Jobs; Writer bleiben gesperrt.

**Status:** Synthetischer M2/M3-mTLS-Hardwaretest einschließlich falschem Pin nachgewiesen. **Echte Geräte weiterhin nicht verbunden.**

## Zusätzliche reproduzierte Launcher-Abnahme

Der neue M2-Launcher wurde zusätzlich direkt gegen den M3-Testclient mit einem weiteren einmaligen QA-Port ausgeführt: **M2 1/1 PASS, M3 1/1 PASS**, anschließend vom M2-Launcher **`AUTO_CLEANED_OK`**. Die zuvor fehlenden Tauri-Testressourcen wurden unter dem gesonderten, bewussten Flag **`KATOSYNC_MESH_LAN_QA_SCAFFOLD=YES`** ausschließlich für diesen synthetischen Lauf erstellt und durch einen Exit-Trap wieder entfernt. Für eine Wiederholung in einem Repo ohne echte Poppler-/Typst- und Frontend-Build-Ressourcen muss auf jeder Maschine zusätzlich dieses Flag gesetzt werden. Ohne das Flag verweigert der Launcher den Lauf, statt echte Release-Artefakte zu suggerieren.

Die ursprünglichen Testkommandos oben beschreiben die **Netzwerk- und Rollengrenzen**; sie setzen ein bereits testfähig vorbereitetes Build-Verzeichnis voraus. Eine QA-Scaffold ist ausdrücklich kein Ersatz für die noch offene Release-Freigabe.
