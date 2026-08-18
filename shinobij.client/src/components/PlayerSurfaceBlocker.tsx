import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Only an explicit server "unavailable" raises this surface. There was a
 * second cold-capability-truth mode; it put this full-screen
 * dialog in front of every player on every refresh while the boot capability
 * request was merely in flight, so it is gone rather than merely unreachable —
 * see playerSurfaceBlockerMode in lib/live-capability-admission.ts. With one
 * surface left there is nothing for a `mode` prop to select. */
export type PlayerSurfaceBlockerMode = "maintenance";

/**
 * A modal dialog is used instead of a visual-only overlay because showModal()
 * makes every other document subtree inert, including body portals that sit
 * outside App's normal shell. App also marks its mounted shell inert as a
 * fallback for browsers that do not implement the dialog top layer.
 */
export function PlayerSurfaceBlocker({
    onOperatorRecovery,
    operatorSurface,
    onCloseOperatorRecovery,
}: {
    onOperatorRecovery: () => void;
    operatorSurface?: ReactNode;
    onCloseOperatorRecovery?: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (!dialog.open) {
            if (typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
        }
        return () => {
            if (!dialog.open) return;
            if (typeof dialog.close === "function") dialog.close();
            else dialog.removeAttribute("open");
        };
    }, []);

    const operatorRecoveryOpen = operatorSurface !== undefined && operatorSurface !== null;
    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={operatorRecoveryOpen ? "operator-recovery-title" : "player-surface-blocker-title"}
            onCancel={(event) => { event.preventDefault(); }}
            style={{
                position: "fixed", inset: 0, width: "100vw", height: "100vh",
                maxWidth: "none", maxHeight: "none", margin: 0, border: 0,
                padding: "1rem", boxSizing: "border-box",
                background: "rgba(2, 6, 23, 0.92)", color: "inherit",
            }}
        >
            {operatorRecoveryOpen ? (
                <section
                    data-operator-recovery-surface
                    style={{ width: "100%", height: "100%", overflow: "auto" }}
                >
                    <header style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
                        <h1 id="operator-recovery-title" style={{ margin: 0, fontSize: "1.2rem" }}>Operator recovery</h1>
                        <button type="button" onClick={onCloseOperatorRecovery} style={{ marginLeft: "auto" }}>
                            Return to maintenance notice
                        </button>
                    </header>
                    {operatorSurface}
                </section>
            ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                    <section className="card" role="status" aria-live="polite" style={{ maxWidth: 620, padding: "1.4rem" }}>
                        <h1 id="player-surface-blocker-title">ShinobiX is temporarily unavailable</h1>
                        <p>
                            The game is in maintenance. Player polling and actions are paused; your current screen and resumable operation state remain mounted and preserved.
                        </p>
                        <button type="button" autoFocus onClick={onOperatorRecovery}>Operator recovery</button>
                        <p style={{ marginBottom: 0 }}>
                            <a href="/terms">Terms</a>{" · "}<a href="/privacy">Privacy</a>
                        </p>
                    </section>
                </div>
            )}
        </dialog>
    );
}
