export const licenseAgreement = {
  version: "2.0.0",
  updatedAt: "29. Juni 2026",
  provider: "MK Heartbeat UG (haftungsbeschränkt)",
  contact: "info@mkheartbeat.de",
  title: "Lizenz- und Nutzungsvereinbarung für KatoSync",
  intro:
    "Bitte lies diese Vereinbarung sorgfältig. Mit der Nutzung von KatoSync bestätigst du, dass du die folgenden Bedingungen verstanden hast und akzeptierst.",
  sections: [
    {
      title: "1. Zweck der App",
      body:
        "KatoSync ist ein lokaler Project Memory Uploader für Mistral Libraries. Die App scannt von dir ausgewählte Projektordner, erzeugt daraus CURRENT-Dateien und synchronisiert freigegebene Inhalte über deinen eigenen Mistral API-Key mit deiner ausgewählten Mistral Library."
    },
    {
      title: "2. Eigene Verantwortung für Auswahl und Upload",
      body:
        "Du entscheidest, welche Ordner verbunden werden. Verbinde nur Dateien und Projektstände, die du an Mistral übertragen darfst. KatoSync enthält einen Secret-Scanner, dieser ersetzt aber keine eigene Prüfung und garantiert nicht, dass alle vertraulichen Inhalte erkannt werden."
    },
    {
      title: "3. API-Key, Mistral Konto und Kosten",
      body:
        "Für die Nutzung benötigst du einen eigenen Mistral API-Key und eine eigene Mistral Library ID. Dein API-Key wird im Betriebssystem-Schlüsselbund gespeichert. Mistral Nutzung, Limits, Gebühren, Verfügbarkeit und Datenschutz richten sich nach den Bedingungen deines Mistral Kontos."
    },
    {
      title: "4. Lokale Daten und Übertragung",
      body:
        "KatoSync speichert lokale Konfigurationen, Logs und generierte CURRENT-Dateien auf deinem Gerät. Im MVP werden Inhalte nur an die von dir konfigurierte Mistral Library übertragen; es gibt keine separate KatoSync Cloud von MK Heartbeat für diese Synchronisierung."
    },
    {
      title: "5. Automatischer Uploadplan",
      body:
        "Wenn du den lokalen Uploadplan aktivierst, kann macOS KatoSync zur gewählten Zeit starten. Der Rechner muss dafür eingeschaltet, angemeldet und netzwerkfähig sein. Wenn KatoSync komplett beendet wird, laufen keine automatischen Uploads aus dieser App."
    },
    {
      title: "6. Keine Nutzung für Hochrisiko- oder Pflichtentscheidungen",
      body:
        "KatoSync und die daraus entstehenden Briefings sind Arbeits- und Organisationshilfen. Sie ersetzen keine rechtliche, medizinische, finanzielle, sicherheitskritische oder sonstige professionelle Prüfung."
    },
    {
      title: "7. Updates und Änderungen",
      body:
        "MK Heartbeat kann KatoSync weiterentwickeln, Funktionen ändern oder Sicherheitsverbesserungen ausliefern. Bei wesentlichen Änderungen der Bedingungen kann eine erneute Zustimmung erforderlich sein."
    },
    {
      title: "8. Gewährleistung und Haftung",
      body:
        "KatoSync wird als Arbeitswerkzeug bereitgestellt. Erstelle eigene Backups und prüfe wichtige Ergebnisse selbst. Soweit gesetzlich zulässig, haftet MK Heartbeat nicht für Datenverlust, falsch konfigurierte Uploads, Drittanbieter-Ausfälle oder indirekte Schäden."
    },
    {
      title: "9. KI-Assistenz und Transparenz (EU AI Act)",
      body:
        "Diese Software wurde teilweise mit Unterstützung von KI-Assistenz entwickelt. Zudem können von der App aufbereitete Briefings, Vorschläge und Code-Änderungen auf KI-generierten Inhalten beruhen. KI kann Fehler machen: Bitte überprüfe wichtige Ergebnisse, Code-Änderungen und Entscheidungen eigenständig, bevor du sie übernimmst oder weiterverwendest."
    }
  ],
  acceptance:
    "Ich habe die Lizenz- und Nutzungsvereinbarung gelesen und akzeptiere, dass KatoSync ausgewählte lokale Projektinhalte über meinen Mistral API-Key mit meiner Mistral Library synchronisieren darf."
};
