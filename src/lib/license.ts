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
  permissionNotice: LicenseSection;
  sections: LicenseSection[];
  acceptance: string;
}

// Sprachneutral (Firmenname/Kontakt/Version gelten ueberall gleich; updatedAt ist landesueblich formatiert).
const PROVIDER = "MK Heartbeat UG (haftungsbeschränkt)";
const CONTACT = "info@mkheartbeat.de";
// New factual scope requires explicit reacceptance; never migrate a previous consent silently.
const VERSION = "4.0.0-beta.1";

const de: LicenseAgreement = {
  version: VERSION,
  updatedAt: "22. November 2026",
  provider: PROVIDER,
  contact: CONTACT,
  title: "Lizenz- und Nutzungsvereinbarung für KatoSync",
  intro:
    "Bitte lies diese Vereinbarung sorgfältig. Die Zustimmung erfolgt ausdrücklich über die unten stehende Auswahl und die Schaltfläche „Akzeptieren und starten“.",
  permissionNotice: {"title": "Zugriffsfreigaben bleiben getrennt", "body": "Hier akzeptierst du die Nutzungsbedingungen. Zugriffe auf Projektordner, Anbieter, Mesh-Geräte, MCP und Betriebssystemfunktionen werden gesondert eingerichtet und freigegeben. Diese Zustimmung erteilt keine pauschale Fernsteuerungs- oder Geräteberechtigung."},
  sections: [
    {
      title: "1. Zweck der App",
      body:
        "KatoSync unterstützt lokale Projektarbeit, Project Memory und RAG, Agent Sync sowie optional lokale Modelle und Mesh-Verbindungen zwischen Geräten. Der verfügbare Funktionsumfang hängt von Build, Einrichtung und Freigaben ab. Die Mistral-Library-Synchronisierung ist eine optionale Funktion; externe Anbieter und lokale Modelle werden getrennt konfiguriert."
    },
    {
      title: "2. Auswahl von Projekten und Aufträgen",
      body:
        "Du entscheidest, welche Projektordner, Anbieter und Geräte du für die jeweilige Funktion freigibst. Übertrage nur Inhalte, zu deren Verarbeitung und Weitergabe du berechtigt bist. Ein Secret-Scanner unterstützt die Prüfung, ersetzt sie jedoch nicht und garantiert keine vollständige Erkennung vertraulicher Inhalte. Prüfe Aufträge und Ergebnisse vor ihrer Übernahme."
    },
    {
      title: "3. Anbieterzugänge und Kosten",
      body:
        "Für externe Dienste können eigene Konten, Abonnements, API-Schlüssel oder eine Anmeldung beim jeweiligen Anbieter nötig sein. Es gelten dessen Bedingungen, Limits, Gebühren und Datenschutzregeln. Lokale Modelle benötigen keinen Mistral-Schlüssel. Von KatoSync verwaltete Zugangsdaten werden im Betriebssystem-Schlüsselbund gespeichert; Zugangsdaten einer Anbieter-CLI verbleiben bei dieser CLI."
    },
    {
      title: "4. Lokale Daten und Übertragung",
      body:
        "KatoSync speichert lokale Konfigurationen, Protokolle und Projektartefakte. Aktivierte Konto-, Mesh- und Remote-Funktionen können Konto-, Geräte- und Auftragsmetadaten über die zugehörigen Dienste verarbeiten. Projektinhalte werden im Rahmen der gewählten Funktion und ihrer Freigaben an konfigurierte Anbieter oder Geräte übergeben. Die Anmeldung allein erteilt keinen allgemeinen Zugriff auf Projektordner oder andere Geräte."
    },
    {
      title: "5. Automatische Abläufe und Hintergrunddienste",
      body:
        "Zeitpläne, Warteschlangen und Hintergrunddienste arbeiten entsprechend ihrer Einrichtung und den vorhandenen Freigaben. Geräte und benötigte Dienste müssen verfügbar sein. Das Schließen eines Fensters beendet nicht zwingend eingerichtete Hintergrunddienste. Prüfe den angezeigten Laufstatus und verwende die vorgesehene Stopp- oder Beenden-Funktion für den jeweiligen Ablauf."
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
    "Ich habe die Lizenz- und Nutzungsvereinbarung gelesen und stimme diesen Bedingungen zu. Konkrete Projekt-, Anbieter- und Gerätezugriffe werden gesondert freigegeben."
};

const en: LicenseAgreement = {
  version: VERSION,
  updatedAt: "November 22, 2026",
  provider: PROVIDER,
  contact: CONTACT,
  title: "License and Terms of Use for KatoSync",
  intro:
    "Please read this agreement carefully. Consent is given explicitly through the selection below and the “Accept and start” button.",
  permissionNotice: {"title": "Access permissions remain separate", "body": "Here you accept the terms of use. Access to project folders, providers, Mesh devices, MCP and operating system capabilities is configured and authorized separately. This acceptance does not grant unrestricted remote control or device access."},
  sections: [
    {
      title: "1. Purpose of the App",
      body:
        "KatoSync supports local project work, Project Memory and RAG, Agent Sync, and optional local models and Mesh connections between devices. Available functionality depends on the build, configuration and permissions. Mistral Library synchronization is optional; external providers and local models are configured separately."
    },
    {
      title: "2. Selection of Projects and Jobs",
      body:
        "You decide which project folders, providers and devices to authorize for each function. Transfer only content that you are entitled to process and share. A secret scanner supports your review but does not replace it or guarantee that all confidential content is detected. Review jobs and results before adopting them."
    },
    {
      title: "3. Provider Accounts and Costs",
      body:
        "External services may require your own accounts, subscriptions, API keys or provider sign-in. Their terms, limits, fees and data protection rules apply. Local models do not require a Mistral key. Credentials managed by KatoSync are stored in the operating system keychain; credentials belonging to a provider CLI remain with that CLI."
    },
    {
      title: "4. Local Data and Transmission",
      body:
        "KatoSync stores local configuration, logs and project artifacts. Enabled account, Mesh and remote functions may process account, device and job metadata through their associated services. Project content is passed to configured providers or devices within the selected function and its permissions. Signing in alone does not grant general access to project folders or other devices."
    },
    {
      title: "5. Automated Workflows and Background Services",
      body:
        "Schedules, queues and background services operate according to their configuration and existing permissions. Devices and required services must be available. Closing a window does not necessarily stop configured background services. Check the displayed runtime status and use the designated stop or quit action for the relevant workflow."
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
    "I have read the License and Terms of Use and agree to these terms. Specific project, provider and device access is authorized separately."
};

const es: LicenseAgreement = {
  version: VERSION,
  updatedAt: "22 de noviembre de 2026",
  provider: PROVIDER,
  contact: CONTACT,
  title: "Contrato de Licencia y Condiciones de Uso de KatoSync",
  intro:
    "Lea atentamente este acuerdo. El consentimiento se otorga expresamente mediante la selección inferior y el botón «Aceptar e iniciar».",
  permissionNotice: {"title": "Los permisos de acceso se conceden por separado", "body": "Aquí acepta las condiciones de uso. El acceso a carpetas de proyectos, proveedores, dispositivos Mesh, MCP y funciones del sistema operativo se configura y autoriza por separado. Esta aceptación no concede control remoto ni acceso ilimitado a dispositivos."},
  sections: [
    {
      title: "1. Finalidad de la aplicación",
      body:
        "KatoSync permite trabajar con proyectos locales, Project Memory y RAG, Agent Sync y, de forma opcional, modelos locales y conexiones Mesh entre dispositivos. Las funciones disponibles dependen de la compilación, la configuración y los permisos. La sincronización con Mistral Library es opcional; los proveedores externos y los modelos locales se configuran por separado."
    },
    {
      title: "2. Selección de proyectos y tareas",
      body:
        "Usted decide qué carpetas de proyectos, proveedores y dispositivos autoriza para cada función. Transfiera únicamente contenidos que tenga derecho a procesar y compartir. El escáner de secretos ayuda a la revisión, pero no la sustituye ni garantiza detectar todo el contenido confidencial. Revise las tareas y los resultados antes de adoptarlos."
    },
    {
      title: "3. Cuentas de proveedores y costos",
      body:
        "Los servicios externos pueden requerir cuentas, suscripciones, claves API o una sesión propia con el proveedor. Se aplican sus condiciones, límites, tarifas y normas de protección de datos. Los modelos locales no requieren una clave de Mistral. Las credenciales administradas por KatoSync se guardan en el llavero del sistema operativo; las credenciales de una CLI del proveedor permanecen en esa CLI."
    },
    {
      title: "4. Datos locales y transmisión",
      body:
        "KatoSync almacena configuraciones, registros y artefactos de proyectos locales. Las funciones activadas de cuenta, Mesh y acceso remoto pueden procesar metadatos de cuentas, dispositivos y tareas mediante sus servicios asociados. Los contenidos de los proyectos se entregan a los proveedores o dispositivos configurados dentro de la función elegida y sus permisos. Iniciar sesión no concede por sí solo acceso general a carpetas de proyectos ni a otros dispositivos."
    },
    {
      title: "5. Procesos automáticos y servicios en segundo plano",
      body:
        "Los horarios, las colas y los servicios en segundo plano funcionan según su configuración y los permisos existentes. Los dispositivos y servicios necesarios deben estar disponibles. Cerrar una ventana no detiene necesariamente los servicios en segundo plano configurados. Compruebe el estado de ejecución mostrado y utilice la acción de detener o salir correspondiente al proceso."
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
    "He leído el Contrato de Licencia y Condiciones de Uso y acepto estas condiciones. El acceso concreto a proyectos, proveedores y dispositivos se autoriza por separado."
};

const ru: LicenseAgreement = {
  version: VERSION,
  updatedAt: "22 ноября 2026 г.",
  provider: PROVIDER,
  contact: CONTACT,
  title: "Лицензионное соглашение и условия использования KatoSync",
  intro:
    "Внимательно прочитайте это соглашение. Согласие даётся явно с помощью отметки ниже и кнопки «Принять и начать».",
  permissionNotice: {"title": "Разрешения на доступ выдаются отдельно", "body": "Здесь вы принимаете условия использования. Доступ к папкам проектов, провайдерам, устройствам Mesh, MCP и функциям операционной системы настраивается и разрешается отдельно. Принятие этих условий не даёт неограниченного удалённого управления или доступа к устройствам."},
  sections: [
    {
      title: "1. Назначение приложения",
      body:
        "KatoSync поддерживает работу с локальными проектами, Project Memory и RAG, Agent Sync, а также дополнительные локальные модели и Mesh-соединения между устройствами. Доступные функции зависят от сборки, настройки и разрешений. Синхронизация с Mistral Library является дополнительной функцией; внешние провайдеры и локальные модели настраиваются отдельно."
    },
    {
      title: "2. Выбор проектов и заданий",
      body:
        "Вы решаете, какие папки проектов, провайдеры и устройства разрешить для каждой функции. Передавайте только содержимое, которое вы вправе обрабатывать и предоставлять другим сторонам. Сканер секретов помогает проверке, но не заменяет её и не гарантирует обнаружения всех конфиденциальных данных. Проверяйте задания и результаты перед их принятием."
    },
    {
      title: "3. Учётные записи провайдеров и расходы",
      body:
        "Для внешних сервисов могут понадобиться собственные учётные записи, подписки, API-ключи или вход у провайдера. Применяются его условия, лимиты, тарифы и правила защиты данных. Локальным моделям ключ Mistral не требуется. Учётные данные, которыми управляет KatoSync, хранятся в системном хранилище ключей; учётные данные CLI провайдера остаются у этой CLI."
    },
    {
      title: "4. Локальные данные и передача",
      body:
        "KatoSync сохраняет локальные настройки, журналы и артефакты проектов. Включённые функции учётной записи, Mesh и удалённого доступа могут обрабатывать метаданные учётных записей, устройств и заданий через связанные сервисы. Содержимое проектов передаётся настроенным провайдерам или устройствам в рамках выбранной функции и её разрешений. Сам по себе вход не даёт общего доступа к папкам проектов или другим устройствам."
    },
    {
      title: "5. Автоматические процессы и фоновые службы",
      body:
        "Расписания, очереди и фоновые службы работают согласно настройкам и имеющимся разрешениям. Устройства и необходимые сервисы должны быть доступны. Закрытие окна не обязательно останавливает настроенные фоновые службы. Проверяйте отображаемое состояние работы и используйте предусмотренную команду остановки или выхода для соответствующего процесса."
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
    "Я прочитал(а) Лицензионное соглашение и условия использования и принимаю эти условия. Конкретный доступ к проектам, провайдерам и устройствам разрешается отдельно."
};

export const licenseAgreements: Record<Lang, LicenseAgreement> = { de, en, es, ru };

// Sprachneutrale Quelle fuer den Akzeptanz-/Versions-Schluessel (eine erteilte Zustimmung gilt sprachunabhaengig).
export const licenseAgreement = de;
