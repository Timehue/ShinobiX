/**
 * "While you were away" — the single digest modal for the offline-notice inbox.
 *
 * The inbox holds up to ten notices and each one used to be its own alert(),
 * which GameAlert queues one-behind-another: a player returning from a week
 * away clicked OK ten times before they could move. This shows the whole inbox
 * ONCE, in one dialog: the notice that asks something of the player pinned at
 * the top with an "Act on this" flag, then everything else newest first, every
 * line stamped with how long ago it happened.
 *
 * It mounts ITSELF into <body> on its own React root — deliberately. The
 * heartbeat calls lib/offline-notices.applyOfflineNotices from a lazy import,
 * and App.tsx has one line of headroom left in its size ratchet, so there is no
 * room there for a host component + its state. Nothing here needs app context:
 * it is a read-only dialog with one dismiss.
 *
 * Styling reuses the vetted .game-alert-backdrop / .game-alert-card chrome
 * (z-index above every fixed rail, portal-safe) plus the .away-* rules in
 * styles/index/22-pet-battle-sprites.css. No CSS import here on purpose — the
 * node test runner cannot load .css.
 */
// This module deliberately co-locates the imperative show/close API with the
// card it mounts — they share the open-root singleton, exactly as GameAlert.tsx
// co-locates gameConfirm with its host.
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from "react";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import type { OfflineNoticeDigest } from "../lib/offline-notices";

export function OfflineNoticeDigestCard({ digest, onClose }: { digest: OfflineNoticeDigest; onClose: () => void }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    useBodyScrollLock(true);

    useEffect(() => {
        const restore = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); onClose(); return; }
            if (e.key !== "Tab") return;
            // Only one focusable control lives in here, so the trap is simply:
            // Tab always lands back on it.
            e.preventDefault();
            closeRef.current?.focus();
        }
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            requestAnimationFrame(() => { if (restore?.isConnected) restore.focus(); });
        };
    }, [onClose]);

    return (
        <div className="game-alert-backdrop" onClick={onClose} role="presentation">
            <div
                ref={cardRef}
                className="game-alert-card away-digest-card"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="away-digest-title"
                aria-describedby="away-digest-subtitle"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="game-alert-header away-digest-header">
                    <span className="game-alert-badge" aria-hidden="true">忍</span>
                    <span className="away-digest-heading">
                        <span className="away-digest-title" id="away-digest-title">{digest.title}</span>
                        <span className="away-digest-subtitle" id="away-digest-subtitle">{digest.subtitle}</span>
                    </span>
                </div>
                <ul className="away-digest-list">
                    {digest.entries.map((e, i) => (
                        <li className={`away-notice away-notice-${e.tone}`} key={`${e.kind}-${e.at}-${i}`}>
                            <span className="away-notice-icon" aria-hidden="true">{e.icon}</span>
                            <span className="away-notice-body">
                                <span className="away-notice-meta">
                                    {e.when && <span className="away-notice-when">{e.when}</span>}
                                    {e.actionable && <span className="away-notice-flag">Act on this</span>}
                                </span>
                                <span className="away-notice-text">{e.text}</span>
                            </span>
                        </li>
                    ))}
                </ul>
                <div className="game-alert-footer">
                    <button ref={closeRef} type="button" className="game-alert-ok" onClick={onClose}>
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}

let openContainer: HTMLDivElement | null = null;
let openRoot: { unmount: () => void } | null = null;

/** Mount the digest on its own root in <body>; a second call replaces the first. */
export function showOfflineNoticeDigest(digest: OfflineNoticeDigest): void {
    if (typeof document === "undefined" || digest.entries.length === 0) return;
    void import("react-dom/client").then(({ createRoot }) => {
        closeOfflineNoticeDigest();
        const container = document.createElement("div");
        container.className = "away-digest-root";
        document.body.appendChild(container);
        const root = createRoot(container);
        openContainer = container;
        openRoot = root;
        root.render(<OfflineNoticeDigestCard digest={digest} onClose={closeOfflineNoticeDigest} />);
    });
}

/** Tear the digest down. Safe to call when nothing is open. */
export function closeOfflineNoticeDigest(): void {
    const root = openRoot;
    const container = openContainer;
    openRoot = null;
    openContainer = null;
    if (!root) return;
    // Unmount off the current React commit — calling unmount() from inside the
    // root's own click handler would tear the tree down mid-render.
    setTimeout(() => {
        root.unmount();
        container?.remove();
    }, 0);
}
