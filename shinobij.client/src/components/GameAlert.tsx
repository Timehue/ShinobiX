/**
 * GameAlert — styled in-app replacement for window.alert.
 *
 * On module import this file replaces window.alert with a queued, themed
 * modal. All existing alert(...) calls across the game keep working — they
 * just render a dark/gold dialog instead of the native browser popup.
 *
 * If multiple alerts fire before the user dismisses one, they queue up and
 * are shown one after another (matches native blocking semantics in spirit).
 *
 * Dismissal:
 *   - Click OK
 *   - Press Enter or Escape
 *   - Click the dark backdrop
 *
 * prompt() is left as a native browser call. confirm() is replaced by the
 * themed gameConfirm() at the bottom of this file — but because window.confirm
 * is synchronous (returns a boolean), it is NOT monkey-patched; call sites
 * `await gameConfirm(...)` instead.
 */
// Verbatim-moved from App.tsx (which disables this rule file-wide); effect behavior unchanged.
/* eslint-disable react-hooks/set-state-in-effect */
// This module intentionally co-locates gameConfirm() (the imperative API) with its
// host component so they share the request singleton — disable the Fast-Refresh
// "only export components" rule for that deliberate mix.
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

type Listener = (message: string) => void;

let activeListener: Listener | null = null;
let pendingMessages: string[] = [];

function showGameAlert(message: string): void {
    if (activeListener) activeListener(message);
    // Collapse a duplicate of the message already at the back of the pending
    // buffer — repeated identical alerts (e.g. mashing a button that errors the
    // same way) shouldn't stack into "N more notices queued".
    else if (pendingMessages[pendingMessages.length - 1] !== message) pendingMessages.push(message);
}

// Replace window.alert once, at module import time. Stash the original on
// window in case some debug surface still wants the browser popup.
if (typeof window !== "undefined" && !(window as unknown as { __gameAlertInstalled?: boolean }).__gameAlertInstalled) {
    const w = window as unknown as { __nativeAlert?: typeof window.alert; __gameAlertInstalled?: boolean };
    w.__nativeAlert = window.alert.bind(window);
    w.__gameAlertInstalled = true;
    window.alert = (message?: unknown) => showGameAlert(String(message ?? ""));
}

export function GameAlertHost() {
    const [queue, setQueue] = useState<string[]>([]);

    useEffect(() => {
        // Skip a message identical to the one already at the back of the queue so
        // the same alert can't pile up (see showGameAlert's pending-buffer dedupe).
        activeListener = (m: string) => setQueue((q) => (q[q.length - 1] === m ? q : [...q, m]));
        if (pendingMessages.length > 0) {
            setQueue((q) => [...q, ...pendingMessages]);
            pendingMessages = [];
        }
        return () => {
            activeListener = null;
        };
    }, []);

    const dismiss = () => setQueue((q) => q.slice(1));

    useEffect(() => {
        if (queue.length === 0) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
                e.preventDefault();
                dismiss();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [queue.length]);

    useBodyScrollLock(queue.length > 0);

    if (queue.length === 0) return null;

    const current = queue[0];
    const moreCount = queue.length - 1;

    // Portal to <body> so the modal escapes the .app-shell stacking context.
    // Mounted inline, it rendered BENEATH the fixed side rails (right-menu
    // z-index 999999, etc.), which stayed lit and clickable over the "modal".
    // The portal + the raised .game-alert-backdrop z-index put it on top.
    return createPortal(
        <div className="game-alert-backdrop" onClick={dismiss} role="presentation">
            <div
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label="Notice"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="game-alert-header">
                    <span className="game-alert-badge">忍</span>
                    <span className="game-alert-title">Notice</span>
                </div>
                <p className="game-alert-message">{current}</p>
                <div className="game-alert-footer">
                    {moreCount > 0 && (
                        <span className="game-alert-more">
                            {moreCount} more {moreCount === 1 ? "notice" : "notices"} queued
                        </span>
                    )}
                    <button
                        type="button"
                        className="game-alert-ok"
                        onClick={dismiss}
                        autoFocus
                        onKeyDown={(e) => {
                            // Stop Enter/Space/Escape from bubbling to the
                            // window-level keydown handler — otherwise pressing
                            // Enter on the focused button dismissed TWO queued
                            // alerts (one from the button's native click, one
                            // from the window listener firing dismiss too).
                            if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
                                e.stopPropagation();
                            }
                        }}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

// ── GameConfirm — themed in-app replacement for window.confirm ────────────────
// window.confirm is synchronous and returns a boolean, so (unlike alert) it
// cannot be monkey-patched transparently — a Promise would read truthy at every
// un-migrated call site. Call sites `await gameConfirm(...)` instead. Same
// singleton + portal pattern as the alert host, but each request carries a
// resolver so the awaiting caller receives the user's choice.

export type GameConfirmOptions = {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;       // red Confirm button for destructive actions
};

type ConfirmRequest = { message: string; opts?: GameConfirmOptions; resolve: (ok: boolean) => void };

let activeConfirmListener: ((req: ConfirmRequest) => void) | null = null;
let pendingConfirms: ConfirmRequest[] = [];

/**
 * Themed replacement for window.confirm. Resolves true on Confirm, false on
 * Cancel / backdrop click / Escape. Requests fired before the host mounts are
 * buffered; if the host unmounts with requests still open they resolve false so
 * awaiting callers never hang.
 */
export function gameConfirm(message: string, opts?: GameConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const req: ConfirmRequest = { message: String(message ?? ""), opts, resolve };
        if (activeConfirmListener) activeConfirmListener(req);
        else pendingConfirms.push(req);
    });
}

export function GameConfirmHost() {
    const [queue, setQueue] = useState<ConfirmRequest[]>([]);

    useEffect(() => {
        activeConfirmListener = (req) => setQueue((q) => [...q, req]);
        if (pendingConfirms.length > 0) {
            setQueue((q) => [...q, ...pendingConfirms]);
            pendingConfirms = [];
        }
        return () => {
            activeConfirmListener = null;
            // Resolve anything still open as cancelled so awaiting callers unblock.
            setQueue((q) => { q.forEach((r) => r.resolve(false)); return []; });
        };
    }, []);

    const settle = (ok: boolean) =>
        setQueue((q) => {
            if (q.length === 0) return q;
            q[0].resolve(ok);
            return q.slice(1);
        });

    useEffect(() => {
        if (queue.length === 0) return;
        // Escape = cancel. Enter "= confirm" is handled by the autoFocus'd Confirm
        // button's native activation, so no window-level Enter handler is needed
        // (which also avoids the double-settle the alert host had to guard against).
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") { e.preventDefault(); settle(false); }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [queue.length]);

    useBodyScrollLock(queue.length > 0);

    if (queue.length === 0) return null;

    const current = queue[0];
    const opts = current.opts ?? {};
    const moreCount = queue.length - 1;

    return createPortal(
        <div className="game-alert-backdrop" onClick={() => settle(false)} role="presentation">
            <div
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title ?? "Confirm"}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="game-alert-header">
                    <span className="game-alert-badge">忍</span>
                    <span className="game-alert-title">{opts.title ?? "Confirm"}</span>
                </div>
                <p className="game-alert-message">{current.message}</p>
                <div className="game-alert-footer">
                    {moreCount > 0 && (
                        <span className="game-alert-more">
                            {moreCount} more {moreCount === 1 ? "prompt" : "prompts"} queued
                        </span>
                    )}
                    <button type="button" className="game-alert-cancel" onClick={() => settle(false)}>
                        {opts.cancelLabel ?? "Cancel"}
                    </button>
                    <button
                        type="button"
                        className={`game-alert-ok${opts.danger ? " danger" : ""}`}
                        onClick={() => settle(true)}
                        autoFocus
                    >
                        {opts.confirmLabel ?? "Confirm"}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
