import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";

export function StartupScreen({ pending, error, onRetry }: {
  pending: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  const { t } = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return (
    <main className="boot-screen" aria-busy={pending}>
      <section className="boot-card" aria-labelledby="boot-title">
        {error ? <AlertTriangle size={28} aria-hidden="true" /> : <Loader2 className="spin" size={28} aria-hidden="true" />}
        <h1 id="boot-title">{t(error ? "shell.startupFailed" : "shell.preparing")}</h1>
        {error ? <>
          <p role="alert">{error}</p>
          <button className="primary-button" disabled={pending} onClick={() => void onRetry()}>
            <RefreshCcw size={18} aria-hidden="true" />{t("shell.retryStartup")}
          </button>
        </> : <p role="status">{slow ? t("shell.startupWaiting") : t("shell.startupLocal")}</p>}
      </section>
    </main>
  );
}
