import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SaveConflictDraft } from "../lib/save-conflict";
import { latestSaveConflictRevision } from "../lib/save-conflict";
import { LoadingState } from "./ui/LoadingState";
import { Modal } from "./ui/Modal";
import "../styles/save-conflict-banner.css";

type SaveConflictAction = "keep" | "download" | "restore";

type SaveConflictBannerProps = {
    draft: SaveConflictDraft | null;
    onKeepServer: () => void | Promise<void>;
    onDownload: () => void | Promise<void>;
    onRestore: (beginBlockingRestore: () => void) => void | Promise<void>;
};

export function SaveConflictBanner({ draft, onKeepServer, onDownload, onRestore }: SaveConflictBannerProps) {
    const [busyAction, setBusyAction] = useState<SaveConflictAction | null>(null);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [restoreBlocking, setRestoreBlocking] = useState(false);
    const errorRef = useRef<HTMLParagraphElement>(null);
    const actionInFlightRef = useRef(false);

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    if (!draft) return null;
    const latest = latestSaveConflictRevision(draft);
    const detected = new Date(latest.detectedAt);
    const busy = busyAction !== null;

    async function runAction(action: SaveConflictAction, work: () => void | Promise<void>) {
        if (actionInFlightRef.current) return;
        actionInFlightRef.current = true;
        setBusyAction(action);
        setError("");
        setStatus("");
        try {
            await work();
            if (action === "download") setStatus("Local draft downloaded. The protected browser copy is still available.");
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : "That recovery action could not be completed.");
        } finally {
            actionInFlightRef.current = false;
            setRestoreBlocking(false);
            setBusyAction(null);
        }
    }

    const recoveryUi = (<>
        <aside
            className="save-conflict-banner"
            aria-labelledby="save-conflict-title"
            aria-describedby="save-conflict-summary save-conflict-time"
            aria-busy={busy}
        >
            <div className="save-conflict-banner__heading">
                <span aria-hidden="true">&#9888;</span>
                <div>
                    <p className="save-conflict-banner__eyebrow">Local draft protected</p>
                    <h2 id="save-conflict-title">Device and server saves diverged</h2>
                </div>
            </div>
            <p id="save-conflict-summary" className="save-conflict-banner__summary" role="status" aria-live="polite">
                The server save stays active. Your device version is preserved for 24 hours{draft.revisions.length > 1 ? `, including ${draft.revisions.length} recovery copies` : ""}.
            </p>
            <p id="save-conflict-time" className="save-conflict-banner__time">
                Detected <time dateTime={detected.toISOString()}>{detected.toLocaleString()}</time>
            </p>
            <div className="save-conflict-banner__areas">
                <strong>Differences detected</strong>
                <ul>
                    {latest.areas.map((area) => <li key={area}>{area}</li>)}
                </ul>
            </div>
            {error ? <p ref={errorRef} className="save-conflict-banner__error" role="alert" tabIndex={-1}>{error}</p> : null}
            {status ? <p className="save-conflict-banner__status" role="status" aria-live="polite">{status}</p> : null}
            <div className="save-conflict-banner__actions" aria-label="Save conflict recovery actions">
                <button type="button" disabled={busy} onClick={() => void runAction("keep", onKeepServer)}>
                    {busyAction === "keep" ? "Clearing draft…" : "Keep server"}
                </button>
                <button type="button" disabled={busy} onClick={() => void runAction("download", onDownload)}>
                    {busyAction === "download" ? "Preparing download…" : "Download local draft"}
                </button>
                <button className="save-conflict-banner__restore" type="button" disabled={busy} onClick={() => void runAction("restore", () => onRestore(() => {
                    setRestoreBlocking(true);
                }))}>
                    {busyAction === "restore" ? "Restoring…" : "Restore this device draft"}
                </button>
            </div>
        </aside>
        <Modal open={restoreBlocking} onClose={() => undefined} bare ariaLabel="Restoring protected save" size="sm" disableBackdropClose disableEscapeClose backdropClassName="save-conflict-restore-backdrop">
            <LoadingState>Verifying your protected revision with the server…</LoadingState>
        </Modal>
    </>);

    // Active fights portal directly to <body>. Recovery must share that root
    // stacking context or the battlefield can intercept its visible controls.
    return typeof document === "undefined" ? recoveryUi : createPortal(recoveryUi, document.body);
}
