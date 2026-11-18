# Beta4: Abhängigkeitsaudit nach Advisory-Rücknahme

## Ergebnis

Am **18. November 2026, 18:52 Uhr MEZ (17:52 UTC)** bestand der unveränderte
Beta4-Abhängigkeitsgraph den vollständigen npm-Audit mit **Exit 0** und
**null Befunden**. Der Nachweis wurde mit einem frischen npm-Cache sowohl
in einer isolierten Linux-Arbeitskopie als auch auf dem physischen M3
erbracht. Es wurde kein GitHub-Actions-Lauf ausgelöst.

Geprüfter Quellstand: `01a9008c3387ecdce07a0ef95f83100b97296cbd`.

SHA-256 der unveränderten `package-lock.json`:

```text
5d0413021b7a619046509c8fbc21a818d1d50baf0e64c3c546e191a382c0974d
```

## Ausführung und Befund

Die beiden Prüfungen verwendeten die offizielle npm-Registry und jeweils
einen neuen temporären Cache. Der ausgeführte Audit entsprach:

```sh
npm audit --audit-level=high --json --registry=https://registry.npmjs.org/ --cache "$audit_cache"
```

`audit_cache` bezeichnet hier den eigens für die Prüfung erzeugten
temporären Cache. Die Arbeitskopien blieben unverändert.

Beide Läufe lieferten:

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    },
    "dependencies": {
      "prod": 113,
      "dev": 85,
      "optional": 65,
      "peer": 0,
      "peerOptional": 0,
      "total": 197
    }
  }
}
```

Die zusätzliche Registry-Abfrage auf M3 ergab `picomatch@4.0.7` und
`vite@8.3.8` als aktuelle Versionen. Im geprüften Lockfile bleiben
`picomatch@4.0.7` und `vite@8.3.5` erhalten; ein Vite-Update war zur
Behebung dieses Gates nicht erforderlich.

## Einordnung der früheren roten Prüfungen

GitHub hat [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
am 18. November zurückgezogen. Der zuvor dokumentierte Audit um
15:56 UTC meldete danach noch fünf hohe Befunde und Exit 1. Der neue
frische Registry-Audit belegt, dass diese Meldung inzwischen auch im
Audit-Ergebnis nicht mehr enthalten ist. Die Ursache der zeitlichen
Verzögerung wurde nicht gesondert untersucht.

Es wurden **keine Advisory-Ausnahme, kein `--omit=dev`, kein erzwungenes
Downgrade und keine Änderung der Audit-Schwelle** eingesetzt. Das bestehende
CI-Gate bleibt erhalten.

Die historischen roten GitHub-Checks bleiben historische Ergebnisse.
Ein abschließender, gebündelter CI-Lauf muss den späteren Release-Quellstand
prüfen. Dieser Audit-PASS allein ersetzt weder die Mesh-/MCP-Live-Abnahme
noch eine Freigabe der vollständigen 4.0-Roadmap.

Bezug: [Desktop-PR #283](https://github.com/NMKato/KatoSync/pull/283),
[ursprünglicher Blocker #282](https://github.com/NMKato/KatoSync/issues/282),
[Beta4-Integrationsprotokoll](KATOSYNC_BETA4_INTEGRATION_20261118.md).
