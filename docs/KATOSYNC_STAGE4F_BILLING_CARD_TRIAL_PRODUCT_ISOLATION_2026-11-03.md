# Stage 4F – KatoSync-Abo mit Karte, automatische Verlängerung und Produkttrennung

Beschluss vom 03.11.2026. Nicht öffentlich freigeschaltet; Preise und Implementierung sind im Testzustand.

## Stripe Live-Katalog, korrektes Konto

Stripe-Konto MK Heartbeat UG: acct_1T8FaBRlRREUhJSr.
Nur KatoSync Pro Produkt prod_VYsQNVBDeJ3TaO, monatlicher Preis price_1UXkfiRlRREUhJSrNo3taV4L: 9,90 Euro EUR pro Monat, Steuerverhalten inklusive, maximal zehn registrierte Agenten-Geräte. Produkt bleibt inaktiv (prelaunch). Das Stripe-Produkt wurde bereits in der Produktbeschreibung und Metadaten auf card_required=true, trial_auto_paid=true und trial_days=14 korrigiert.

Bestehende KatoOS-, Picnic-, TableRocket- und sonstige Stripe-Produkte sind unabhängig. Der gleiche Stripe-Account darf viele Produkte verwalten; die Produktzuordnung muss jedoch über exakte Price-ID und Product-ID und eigene katosync.billing_* Tabellen kontrolliert werden. Keinerlei Mutation an public.katoos_subscription, public.katoos_user_entitlement oder Fremdprodukten.

## Kundenvertrag

- Pro wird mit einer Zahlungsmethode (bei Checkout) 14 volle Tage kostenlos gestartet. Dies ist ein wiederkehrendes kostenpflichtiges Abo mit anfänglicher kostenloser Phase.
- Ohne rechtzeitige Kündigung versucht Stripe am Ende des 14. Tages automatisch 9,90 Euro inklusive Umsatzsteuer für den neuen Monatszeitraum einzuziehen.
- Kündigung jederzeit, auch am ersten Tag. Die normale Kündigung wird zum Ende der bereits gewährten Trial- oder bezahlten Periode gesetzt (cancel_at_period_end=true), damit Mesh während des verbleibenden Zeitraums weiter funktioniert. Kein automatischer Einzug nach der Kündigung.
- Erste Zahlungsmethode ist bei Vertragsabschluss erforderlich; das Erfassen allein beweist noch nicht, dass eine spätere Zahlung erfolgreich sein wird. Bei fehlgeschlagener Zahlung braucht es Statusmeldungen, Zahlungsverfolgung und eine definierte, sichere Kulanzregel.
- Eine kostenlose Testphase pro kanonischem, verifiziertem KATOOS-Konto (mesh_trial_claims) mit Missbrauchsprüfung und atomarer Eventverarbeitung. Keine heimliche Mehrfachprobe durch erneutes Anlegen einer Subscription.
- Stripe Customer Portal kann verwalten; wegen § 312k BGB ist für Verbraucher zusätzlich ein jederzeit erreichbarer Kündigungsbutton mit direkt erreichbarer Bestätigungsseite und Bestätigungs-Mail erforderlich. Der Checkout muss transparent Gesamtpreis, Testdauer, Verlängerungsbedingungen und Kündigungsweg anzeigen.
- Spätestens sieben Tage vor Testende Versand einer Erinnerung mit Preis, Datum und Kündigungsmöglichkeit konfigurieren (Stripe-Recommendation für Trial-Compliance).

## Technische Vorbereitung (nicht deployt)

- Rein serverseitige Checkout-Konfiguration in src/lib/katoSyncBillingContract.ts mit festen KatoSync Product-/Price-IDs, payment_method_collection=always, trial_period_days=14 nur nach authentifizierter Prüfung, und metadata.product_key=katosync.
- Neue isolierte Tabellen katosync.billing_subscriptions und katosync.billing_webhook_events als lokale SQL-Migration mit RLS, exakt verifiziertem Stripe-Konto/Produkt/Preis und Idempotenz-Ereignis-ID. Keine Schemaänderung in anderen Produkten.
- Pure Stripe-Billing-Entscheidungsfunktion ignoriert ausdrücklich alle anderen Produkte, zusätzliche Items, falsches Konto oder unbestätigte Ereignisse. Trialing mit cancel_at_period_end bleibt bis trial_end gültig; active mit cancel_at_period_end bis paid-through Ende.
- Jede echte Webhook-Mutation verlangt Stripe-Signature-Prüfung, serverseitigen frischen Subscription-Abruf und atomare Verarbeitung inkl. Event-ID-Idempotenz, Subscription-Status, Trial-Claim und Mesh-Policy. Dieser Adapter ist noch NICHT implementiert.
- Provider-Fallback-Modul wählt nach erschöpften Codex-/Claude-Limits ein bereites Gemma-Modell auf dem eigenen Rechner. Keine Garantie beliebiger Aufgaben; lokale Fähigkeiten, freier RAM, Modell-Ready-State und Freigabe müssen gegeben sein. Es startet aktuell keine echten Jobs.
- KatoSync-Pro-Verkaufsfreigabe erst nach Stripe-Checkout/Portal/Webhook-E2E, deutschem Kündigungsweg, Produkttrennungsregression und Mesh-E2E-Abnahme.

## Wichtige Klarstellung

Das Vorliegen eines Stripe-Produkts und einer Price-ID aktiviert keinen Checkout. Kein echter Kunde wurde hier belastet, kein neues Abo angelegt und kein fremdes Produkt geändert. Das veröffentlichte Supabase Enrollment-Backend bleibt auf v4; diese Trial-/Billing-Migrationen wurden NICHT produktiv eingespielt. UI und API sind deshalb noch nicht im End-to-End-Betrieb.
