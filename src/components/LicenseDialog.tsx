// Created by NMKato Solutions.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { licenseAgreement, licenseAgreements } from "../lib/license";
import { containModalFocus } from "../lib/modalFocus";

export function LicenseDialog({
  accepted,
  checked,
  onAccept,
  onCheckedChange,
  onClose,
  onQuit
}: {
  accepted: boolean;
  checked: boolean;
  onAccept: () => void;
  onCheckedChange: (checked: boolean) => void;
  onClose: () => void;
  onQuit: () => void;
}) {
  const { t, lang } = useT();
  // Lizenztext in der aktuell gewaehlten Sprache (Akzeptanz-/Versions-Schluessel bleibt sprachneutral).
  const license = licenseAgreements[lang] ?? licenseAgreement;
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    return containModalFocus(backdrop, {
      initialFocus: titleRef.current,
      onEscape: accepted ? () => closeRef.current() : undefined
    });
  }, [accepted]);
  return (
    <div ref={backdropRef} className="modal-backdrop license-backdrop" role="presentation">
      <section aria-labelledby="license-title" aria-modal="true" className="license-dialog" role="dialog">
        {accepted ? (
          <button aria-label={t("license.closeAria")} className="icon-button license-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        ) : null}
        <header>
          <img alt="" src="/katosync_logo_centered.png" />
          <div>
            <span className="section-label">KatoSync</span>
            <h2 ref={titleRef} tabIndex={-1} id="license-title">{license.title}</h2>
            <p>
              {t("license.meta", {
                provider: license.provider,
                version: license.version,
                updatedAt: license.updatedAt
              })}
            </p>
          </div>
        </header>
        <div className="license-body" role="region" tabIndex={0} aria-label={license.title}>
          <p className="license-intro">{license.intro}</p>
          <aside className="license-permissions" aria-labelledby="license-permissions-title">
            <h3 id="license-permissions-title">{license.permissionNotice.title}</h3>
            <p>{license.permissionNotice.body}</p>
          </aside>
          {license.sections.map((section) => (
            <article key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </article>
          ))}
          <p className="license-contact">{t("license.contact")}: {license.contact}</p>
        </div>
        <footer>
          {accepted ? (
            <button className="secondary" onClick={onClose} type="button">
              {t("license.close")}
            </button>
          ) : (
            <>
              <label className="license-accept">
                <input checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} type="checkbox" />
                <span>{license.acceptance}</span>
              </label>
              <div className="license-actions">
                <button className="ghost danger" onClick={onQuit} type="button">
                  {t("license.quit")}
                </button>
                <button className="primary" disabled={!checked} onClick={onAccept} type="button">
                  {t("license.accept")}
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
