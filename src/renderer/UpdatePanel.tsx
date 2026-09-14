import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./i18n";
import type { UpdateProgress } from "../shared/types";

/**
 * Update states the panel renders. `opened` exists only on macOS, where the dmg is handed to
 * Finder instead of being installed by the app.
 */
type Phase =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "opened"
  | "failed";

const RELEASES_PAGE = "https://github.com/tt-11-dd/tether-ai/releases/latest";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function UpdatePanel() {
  const { t } = useI18n();
  const platform = window.harness.platform;
  const [current, setCurrent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [releaseUrl, setReleaseUrl] = useState(RELEASES_PAGE);
  const [assetName, setAssetName] = useState<string>();
  const [assetSize, setAssetSize] = useState<number>();
  const [installable, setInstallable] = useState(true);
  const [progress, setProgress] = useState<UpdateProgress>();
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    void window.harness.app.version().then((value) => {
      if (live) setCurrent(value);
    });
    // A download may already be running (or finished) if settings were reopened mid-flight.
    void window.harness.app.updateState().then((state) => {
      if (!live) return;
      if (state.status === "downloading") {
        setVersion(state.version);
        setProgress(state.progress);
        setPhase("downloading");
      } else if (state.status === "ready") {
        setVersion(state.version);
        setPhase("ready");
      }
    });
    const off = window.harness.app.onUpdateProgress((next) => setProgress(next));
    return () => {
      live = false;
      off();
    };
  }, []);

  const check = useCallback(async () => {
    setPhase("checking");
    setMessage("");
    setDismissed(false);
    const result = await window.harness.app.checkUpdate();
    if (result.status === "latest") {
      setCurrent(result.current);
      setPhase("latest");
      return;
    }
    if (result.status === "failed") {
      setMessage(result.error ?? "");
      setPhase("failed");
      return;
    }
    setVersion(result.version);
    setReleaseUrl(result.releaseUrl);
    setInstallable(result.installable);
    setAssetName(result.asset?.name);
    setAssetSize(result.asset?.size);
    setPhase("available");
  }, []);

  const download = useCallback(async () => {
    setMessage("");
    setProgress({ received: 0, ...(assetSize !== undefined ? { total: assetSize, percent: 0 } : {}) });
    setPhase("downloading");
    const result = await window.harness.app.downloadUpdate();
    if (!result.ok) {
      if (result.cancelled) {
        setProgress(undefined);
        setPhase("available");
        return;
      }
      setMessage(result.error ?? "");
      setPhase("failed");
      return;
    }
    setVersion(result.version);
    setPhase("ready");
  }, [assetSize]);

  const cancel = useCallback(async () => {
    await window.harness.app.cancelUpdate();
    setProgress(undefined);
    setPhase("available");
  }, []);

  const install = useCallback(async () => {
    setMessage("");
    setPhase("installing");
    const result = await window.harness.app.installUpdate();
    if (result.ok) {
      setPhase(result.action === "opened-installer" ? "opened" : "installing");
      return;
    }
    if (result.cancelled) {
      setPhase("ready");
      return;
    }
    setMessage(result.error ?? "");
    setPhase("failed");
  }, []);

  const openReleasePage = useCallback(() => {
    void window.harness.app.openExternal(releaseUrl);
  }, [releaseUrl]);

  const percent = progress?.percent;
  const detailLine = (() => {
    if (phase === "available") {
      const size = assetSize !== undefined ? formatBytes(assetSize) : "";
      const name = installable ? assetName ?? "" : t("update.detail");
      return [t("update.available", { version }), name, size].filter(Boolean).join(" · ");
    }
    if (phase === "downloading") {
      const bytes = progress
        ? `${formatBytes(progress.received)}${progress.total ? ` / ${formatBytes(progress.total)}` : ""}`
        : "";
      return [t("update.downloading", { version }), bytes].filter(Boolean).join(" · ");
    }
    if (phase === "ready")
      return `${t("update.ready", { version })} ${
        platform === "darwin" ? t("update.readyMac") : t("update.readyWin")
      }`;
    if (phase === "installing") return t("update.installing");
    if (phase === "opened") return t("update.openedHint");
    if (phase === "checking") return t("update.checking");
    if (phase === "latest") return t("update.currentVersion", { version: current || "—" });
    if (phase === "failed") return [t("update.failed"), message].filter(Boolean).join("：");
    return t("update.hint");
  })();

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  // "Later" collapses the offer back to a plain check button until the user asks again.
  const dismissedOffer = dismissed && phase === "available";

  return (
    <section className={`update-card phase-${phase}${dismissedOffer ? " dismissed" : ""}`}>
      <div className="update-head">
        <span className="update-title">{t("update.title")}</span>
        {current && <span className="update-current">v{current}</span>}
      </div>
      {!dismissedOffer && (
        <>
          <p className="update-line">{detailLine}</p>
          {phase === "downloading" && (
            <div
              className={`update-progress${percent === undefined ? " indeterminate" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(percent === undefined ? {} : { "aria-valuenow": Math.round(percent) })}
            >
              <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
            </div>
          )}
        </>
      )}
      <div className="update-actions">
        {(phase === "idle" || phase === "latest" || phase === "failed" || dismissedOffer) && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void check()}>
            {t("about.checkUpdate")}
          </button>
        )}
        {phase === "available" && !dismissedOffer && installable && (
          <button type="button" className="primary" onClick={() => void download()}>
            {t("update.download")}
          </button>
        )}
        {phase === "available" && !dismissedOffer && (
          <button type="button" className="ghost" onClick={() => setDismissed(true)}>
            {t("update.later")}
          </button>
        )}
        {phase === "downloading" && (
          <button type="button" className="ghost" onClick={() => void cancel()}>
            {t("update.cancel")}
          </button>
        )}
        {(phase === "ready" || phase === "installing") && (
          <button
            type="button"
            className="primary"
            disabled={phase === "installing"}
            onClick={() => void install()}
          >
            {platform === "darwin" ? t("update.installOpen") : t("update.installRestart")}
          </button>
        )}
        {(phase === "failed" || (phase === "available" && !dismissedOffer) || phase === "opened") && (
          <button type="button" className="ghost" onClick={openReleasePage}>
            {t("update.manual")}
          </button>
        )}
      </div>
    </section>
  );
}
