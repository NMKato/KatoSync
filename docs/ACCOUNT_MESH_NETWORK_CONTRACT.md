# Kontoweites Mesh: Cloudvertrag

Die Hauptgeraetwahl bestimmt ausschliesslich die Netzwerktopologie. Sie erzeugt keinen Peer-Pin, keine MCP-Freigabe und keine Berechtigung fuer Auftraege. Ein erreichbares Konto-Registrygeraet ist ausserdem noch kein verbundener Peer.

## Native Schnittstellen

| Schnittstelle | Wirkung |
| --- | --- |
| `mesh_account_network_get()` | Liest die aktuelle Kontokonfiguration. Legt weder eine Kontrollrow noch eine Geraeteidentitaet oder Registrierung an. |
| `mesh_account_network_set_primary(deviceId, expectedRevision)` | Waehlt ein registriertes, nicht widerrufenes Geraet mit atomarem Revisionsvergleich. |
| `mesh_account_control::verified_configuration()` | Native Runtimeautoritaet: dieselbe frische Cloudpruefung, zusaetzlich zwingend die exakte, registrierte lokale Identitaet. |

Die IPC-Rueckgabe verwendet camelCase:

```typescript
type AccountNetworkSnapshot = {
  ownerId: string;
  localDeviceId: string | null;
  localFingerprint: string | null;
  localPublicKey: string | null;
  mainDeviceId: string | null;
  mainDeviceAvailable: boolean;
  accountRevision: number;
  accountVerified: true;
  devices: {
    deviceId: string; ownerUserId: string;
    displayName: string; personaName: string | null;
    platformOs: "macos" | "windows" | "linux";
    membershipState: "discovered" | "pending" | "trusted" | "revoked";
    fingerprint: string; publicKey: string;
    lastSeenAt: string | null; revoked: boolean;
  }[];
};
```

Ohne lokale Identitaet sind die drei lokalen Felder `null`. Bei vorhandener Identitaet ohne Registryeintrag ist nur `localDeviceId` null. Ein ausdruecklicher Klick zum Hinzufuegen verwendet die bestehende signierte Enrollmentpipeline; der anschliessende Refresh bleibt lesend.

Nur `discovered` und `trusted` mit unveraendertem, nicht widerrufenem Registrykey sind fuer die Hauptwahl und den Verbindungsaufbau geeignet. `trusted` allein ersetzt keinen lokalen Peer-Pin und keinen frischen gegenseitigen Besitznachweis.

`VerifiedAccountConfiguration` enthaelt zusaetzlich eine servergepruefte `session_id` ausschliesslich fuer native Resumeprofile. Der IPC-Snapshot enthaelt diese ID nicht. Der Adapter akzeptiert keine vom Frontend gelieferten Owner-, Session- oder Public-Key-Behauptungen.

## Datenbank und Nebenlaeufigkeit

Die Data-API-RPCs im Schema `katosync` heissen `mesh_account_network_get()` und `mesh_account_network_set_primary(p_device_id uuid, p_expected_revision bigint)`. Ihre Implementierung liegt im nicht exponierten Schema `katosync_mesh_private`. Die exponierten Wrapper laufen als SECURITY INVOKER. Tabellen-DML fuer `authenticated` bleibt gesperrt; der Getter und Setter binden jede Operation erneut an das aktuelle Konto.

Die Autoritaetspruefung verlangt den festen nativen Issuer, `aud`/`role` authenticated, `is_anonymous` als Boolean false, gueltige Owner-/Session-UUIDs und ein noch gueltiges Token. OAuth-Client-Claims werden abgewiesen. Die Session muss unter demselben Owner aktuell vorhanden, ohne OAuth-Client und innerhalb von `not_after` sein. Zusaetzlich muss die serververwaltete KatoSync-Mitgliedschaft aktiv sein. Fuer reine Topologie wird keine neue MFA-Freigabe erzeugt oder vorausgesetzt.

`mesh_account_network` besitzt genau eine Row pro Owner. Der zusammengesetzte Fremdschluessel `(owner_user_id, main_device_id)` erlaubt ausschliesslich dessen eigenes Registrygeraet. RLS erlaubt nur den eigenen Lesestand. Eine fehlende Row entspricht Revision 0 und keiner Hauptwahl.

Der Setter haelt den Zielgeraete-Lock `FOR SHARE` bis Commit und serialisiert die Auswahl ueber den Owner-Primarschluessel. Zwei Erstauswahlen mit erwarteter Revision 0 haben genau einen Gewinner. Jede veraltete Revision wird abgewiesen, auch bei identischem Ziel. Bei aktueller Revision und identischem Ziel bleibt die Revision unveraendert. Ein tatsaechlicher Wechsel erhoeht sie um eins; der Wertebereich endet bei der groessten exakt darstellbaren JavaScript-Ganzzahl.

Ein widerrufenes Hauptgeraet bleibt als gespeicherte Wahl sichtbar, waehrend `mainDeviceAvailable` false ist. Es gibt keinen stillen Ersatz. Offline-Presence allein aendert die Wahl ebenfalls nicht. Die native Runtime muss die aktuelle Verfuegbarkeit, Revision, eigene Identitaet und exakten Peerkeys beim Start und waehrend laufender Kanaele erneut pruefen.

## Verbindungsmodi und Freigaben

`ask` und `automatic` sind native, kontogebundene Verbindungsprofile. Sie bezeichnen eine ausdruecklich bestaetigte Verbindung beziehungsweise deren erlaubtes Wiederaufnehmen. Sie sind keine allgemeinen Ausfuehrungsrechte. Logout-/Sessionwechsel, Cloud-Revoke, gewechselte Hauptwahl und geaenderte Geraetekeys duerfen nicht durch ein altes Resumeprofil uebergangen werden.

Die bestehende Einladungs-/Proof-/Relaykette akzeptiert jetzt `discovered` oder `trusted` bei unveraenderter Owner-, Key-, Nonce-, Ablauf- und Revokepruefung. Die Migration ersetzt in fuenf vorhandenen produktiven Guards nur sieben Registryzustand-Praedikate. Deren SECURITY INVOKER, Suchpfad, Trigger und bestehende ACL bleiben erhalten. Der verifizierte Vorzustand ist als Testfixture dokumentiert.

## Enge Abnahme

Die lokalen PostgreSQL-Proben laufen ueber `bash scripts/qa-mesh-postgres-local.sh account-network` in einer wegwerfbaren PG17-Instanz mit privatem Unix-Socket ohne TCP-Listener. Sie pruefen Auth-/Session-/Ownergrenzen, NULL-/Stale-CAS, lesenden Initialzustand, unmittelbare Setter-Rueckgabe, den trusted-Proof-/Relaypfad und reale parallele CAS-/Revoke-Sessions. Alle Testidentitaeten sind ausschliesslich synthetische lokale Fixtures.

Die drei bestehenden Edge-Testdateien fuer Inbox-Send, Inbox-Receive und Pairing-Relay enthalten zusaetzliche echte Ed25519-Pruefungen fuer discovered/trusted sowie negative Owner-/Key-/Pending-/Revoke-Faelle. Der neue native Adapter besitzt reine Tests fuer Wirevalidierung, Keybindung, widerrufenes Hauptgeraet, Empty-State und sichere Fehlerkategorien.

Live-Migration, Edge-Rollout, Tauri-Commandregistrierung und der gemeinsame Runtime-/UI-Kandidat werden getrennt koordiniert. Source- und lokale Testergebnisse allein behaupten keine erfolgreiche reale Geraeteverbindung.

(Created by NMKato Solutions)
