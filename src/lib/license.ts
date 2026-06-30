import type { Lang } from "../i18n";

export interface LicenseSection {
  title: string;
  body: string;
}

export interface LicenseAgreement {
  version: string;
  updatedAt: string;
  provider: string;
  contact: string;
  title: string;
  intro: string;
  sections: LicenseSection[];
  acceptance: string;
}

// Sprachneutral (Firmenname/Kontakt/Version gelten ueberall gleich; updatedAt ist landesueblich formatiert).
const PROVIDER = "MK Heartbeat UG (haftungsbeschränkt)";
const CONTACT = "info@mkheartbeat.de";
const VERSION = "2.0.0";

const de: LicenseAgreement = {
  version: VERSION,
  updatedAt: "29. Juni 2026",
  provider: PROVIDER,
  contact: CONTACT,
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

const en: LicenseAgreement = {
  version: VERSION,
  updatedAt: "June 29, 2026",
  provider: PROVIDER,
  contact: CONTACT,
  title: "License and Terms of Use for KatoSync",
  intro:
    "Please read this agreement carefully. By using KatoSync, you confirm that you have read, understood, and accept the following terms.",
  sections: [
    {
      title: "1. Purpose of the App",
      body:
        "KatoSync is a local project memory uploader for Mistral Libraries. The app scans the project folders you select, generates CURRENT files from them, and synchronizes the content you approve for sharing to your selected Mistral Library using your own Mistral API key."
    },
    {
      title: "2. Your Responsibility for Selection and Upload",
      body:
        "You decide which folders are connected. Connect only files and project states that you are permitted to transfer to Mistral. KatoSync includes a secret scanner, but it does not replace your own review and does not guarantee that all confidential content will be detected."
    },
    {
      title: "3. API Key, Mistral Account, and Costs",
      body:
        "To use the app, you need your own Mistral API key and your own Mistral Library ID. Your API key is stored in the operating system keychain. Mistral usage, limits, fees, availability, and data protection are governed by the terms of your Mistral account."
    },
    {
      title: "4. Local Data and Transmission",
      body:
        "KatoSync stores local configurations, logs, and generated CURRENT files on your device. In the MVP, content is transmitted only to the Mistral Library you have configured; there is no separate KatoSync cloud operated by MK Heartbeat UG for this synchronization."
    },
    {
      title: "5. Automatic Upload Schedule",
      body:
        "If you enable the local upload schedule, macOS may launch KatoSync at the time you select. For this, your computer must be powered on, logged in, and connected to a network. If KatoSync is fully quit, no automatic uploads will run from this app."
    },
    {
      title: "6. No Use for High-Risk or Mandatory Decisions",
      body:
        "KatoSync and the briefings it produces are work and organizational aids. They do not replace any legal, medical, financial, safety-critical, or other professional review."
    },
    {
      title: "7. Updates and Changes",
      body:
        "MK Heartbeat UG may continue to develop KatoSync, change features, or deliver security improvements. In the event of material changes to these terms, renewed consent may be required."
    },
    {
      title: "8. Warranty and Liability",
      body:
        "KatoSync is provided as a working tool. Create your own backups and review important results yourself. To the extent permitted by law, MK Heartbeat UG is not liable for data loss, misconfigured uploads, third-party outages, or indirect damages."
    },
    {
      title: "9. AI Assistance and Transparency (EU AI Act)",
      body:
        "This software was developed in part with AI assistance. In addition, briefings, suggestions, and code changes prepared by the app may be based on AI-generated content. AI can make mistakes: please review important results, code changes, and decisions on your own before adopting or reusing them."
    }
  ],
  acceptance:
    "I have read the License and Terms of Use and accept that KatoSync may synchronize selected local project content with my Mistral Library using my Mistral API key."
};

const es: LicenseAgreement = {
  version: VERSION,
  updatedAt: "29 de junio de 2026",
  provider: PROVIDER,
  contact: CONTACT,
  title: "Contrato de Licencia y Condiciones de Uso de KatoSync",
  intro:
    "Le rogamos que lea atentamente este contrato. Al utilizar KatoSync, usted confirma que ha comprendido y que acepta las siguientes condiciones.",
  sections: [
    {
      title: "1. Finalidad de la aplicación",
      body:
        "KatoSync es un cargador local de memoria de proyectos (Project Memory Uploader) para Mistral Libraries. La aplicación analiza las carpetas de proyecto que usted seleccione, genera a partir de ellas archivos CURRENT y sincroniza los contenidos autorizados con su Mistral Library seleccionada a través de su propio Mistral API key."
    },
    {
      title: "2. Responsabilidad propia respecto a la selección y la carga",
      body:
        "Usted decide qué carpetas se conectan. Conecte únicamente archivos y estados de proyecto que esté autorizado a transmitir a Mistral. KatoSync incluye un escáner de secretos (Secret-Scanner), pero este no sustituye su propia verificación ni garantiza que se detecten todos los contenidos confidenciales."
    },
    {
      title: "3. API key, cuenta de Mistral y costos",
      body:
        "Para el uso necesita un Mistral API key propio y un Mistral Library ID propio. Su API key se almacena en el llavero del sistema operativo. El uso de Mistral, los límites, las tarifas, la disponibilidad y la protección de datos se rigen por las condiciones de su cuenta de Mistral."
    },
    {
      title: "4. Datos locales y transmisión",
      body:
        "KatoSync almacena configuraciones locales, registros (logs) y los archivos CURRENT generados en su dispositivo. En el MVP, los contenidos se transmiten únicamente a la Mistral Library que usted haya configurado; no existe una nube KatoSync independiente de MK Heartbeat para esta sincronización."
    },
    {
      title: "5. Plan de carga automático",
      body:
        "Si activa el plan de carga local, macOS puede iniciar KatoSync a la hora seleccionada. Para ello, el equipo debe estar encendido, con la sesión iniciada y con acceso a la red. Si KatoSync se cierra por completo, no se ejecutarán cargas automáticas desde esta aplicación."
    },
    {
      title: "6. Prohibición de uso para decisiones de alto riesgo u obligatorias",
      body:
        "KatoSync y los briefings que de él se derivan son herramientas de trabajo y de organización. No sustituyen ninguna verificación jurídica, médica, financiera, crítica para la seguridad ni de cualquier otra índole profesional."
    },
    {
      title: "7. Actualizaciones y modificaciones",
      body:
        "MK Heartbeat puede seguir desarrollando KatoSync, modificar funciones o distribuir mejoras de seguridad. En caso de modificaciones sustanciales de las condiciones, podrá ser necesario un nuevo consentimiento."
    },
    {
      title: "8. Garantía y responsabilidad",
      body:
        "KatoSync se proporciona como herramienta de trabajo. Realice sus propias copias de seguridad y verifique personalmente los resultados importantes. En la medida en que lo permita la ley, MK Heartbeat no se hace responsable de la pérdida de datos, de cargas mal configuradas, de fallos de terceros ni de daños indirectos."
    },
    {
      title: "9. Asistencia de IA y transparencia (EU AI Act)",
      body:
        "Este software se ha desarrollado en parte con el apoyo de asistencia de IA. Además, los briefings, las sugerencias y las modificaciones de código que la aplicación elabore pueden basarse en contenidos generados por IA. La IA puede cometer errores: verifique de forma independiente los resultados, las modificaciones de código y las decisiones importantes antes de adoptarlos o seguir utilizándolos."
    }
  ],
  acceptance:
    "He leído el Contrato de Licencia y Condiciones de Uso y acepto que KatoSync pueda sincronizar contenidos locales de proyecto seleccionados con mi Mistral Library a través de mi Mistral API key."
};

const ru: LicenseAgreement = {
  version: VERSION,
  updatedAt: "29 июня 2026 г.",
  provider: PROVIDER,
  contact: CONTACT,
  title: "Лицензионное соглашение и условия использования KatoSync",
  intro:
    "Пожалуйста, внимательно ознакомьтесь с настоящим Соглашением. Используя KatoSync, вы подтверждаете, что поняли и принимаете изложенные ниже условия.",
  sections: [
    {
      title: "1. Назначение приложения",
      body:
        "KatoSync — это локальное приложение для загрузки проектной памяти (Project Memory Uploader) в Mistral Library. Приложение сканирует выбранные вами папки проектов, формирует на их основе CURRENT-файлы и синхронизирует предоставленное вами содержимое с выбранной вами Mistral Library, используя ваш собственный Mistral API key."
    },
    {
      title: "2. Ваша ответственность за выбор и загрузку данных",
      body:
        "Вы самостоятельно решаете, какие папки подключать. Подключайте только те файлы и состояния проектов, которые вы вправе передавать в Mistral. KatoSync включает в себя сканер секретов (Secret Scanner), однако он не заменяет вашу собственную проверку и не гарантирует выявления всех конфиденциальных данных."
    },
    {
      title: "3. API key, учётная запись Mistral и расходы",
      body:
        "Для использования приложения вам необходимы собственный Mistral API key и собственный Mistral Library ID. Ваш API key хранится в системном хранилище ключей операционной системы. Условия использования, лимиты, тарифы, доступность и защита данных при работе с Mistral регулируются условиями вашей учётной записи Mistral."
    },
    {
      title: "4. Локальные данные и передача",
      body:
        "KatoSync сохраняет локальные настройки, журналы (логи) и сформированные CURRENT-файлы на вашем устройстве. В версии MVP содержимое передаётся исключительно в настроенную вами Mistral Library; отдельного облачного сервиса KatoSync компании MK Heartbeat для данной синхронизации не предусмотрено."
    },
    {
      title: "5. Автоматический план загрузки",
      body:
        "Если вы активируете локальный план загрузки, macOS может запускать KatoSync в установленное вами время. Для этого компьютер должен быть включён, должен быть выполнен вход в систему и обеспечено сетевое соединение. При полном завершении работы KatoSync автоматические загрузки из данного приложения не выполняются."
    },
    {
      title: "6. Запрет использования для высокорисковых или обязательных решений",
      body:
        "KatoSync и формируемые им брифинги являются вспомогательными средствами для работы и организации. Они не заменяют юридической, медицинской, финансовой, критически важной для безопасности или иной профессиональной проверки."
    },
    {
      title: "7. Обновления и изменения",
      body:
        "MK Heartbeat вправе развивать KatoSync, изменять функциональность или предоставлять обновления безопасности. При существенном изменении условий может потребоваться повторное согласие."
    },
    {
      title: "8. Гарантии и ответственность",
      body:
        "KatoSync предоставляется как рабочий инструмент. Создавайте собственные резервные копии и самостоятельно проверяйте важные результаты. В пределах, допускаемых законодательством, MK Heartbeat не несёт ответственности за потерю данных, неверно настроенные загрузки, сбои сторонних поставщиков, а также за косвенный ущерб."
    },
    {
      title: "9. Помощь ИИ и прозрачность (Закон ЕС об ИИ, EU AI Act)",
      body:
        "Данное программное обеспечение было частично разработано с применением ИИ-ассистентов. Кроме того, подготовленные приложением брифинги, предложения и изменения в коде могут основываться на содержимом, сгенерированном ИИ. ИИ может допускать ошибки: пожалуйста, самостоятельно проверяйте важные результаты, изменения в коде и решения, прежде чем принимать их или использовать в дальнейшем."
    }
  ],
  acceptance:
    "Я прочитал(а) Лицензионное соглашение и условия использования и принимаю, что KatoSync вправе синхронизировать выбранное мной локальное содержимое проектов с моей Mistral Library, используя мой Mistral API key."
};

export const licenseAgreements: Record<Lang, LicenseAgreement> = { de, en, es, ru };

// Sprachneutrale Quelle fuer den Akzeptanz-/Versions-Schluessel (eine erteilte Zustimmung gilt sprachunabhaengig).
export const licenseAgreement = de;
