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
// This module intentionally co-locates gameConfirm() (the imperative API) with its
// host component so they share the request singleton — disable the Fast-Refresh
// "only export components" rule for that deliberate mix.
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

type AlertRequest = { message: string; restoreFocus: HTMLElement | null };
type Listener = (request: AlertRequest) => void;

let activeListener: Listener | null = null;
let pendingMessages: AlertRequest[] = [];

function useDialogFocusTrap(
    open: boolean,
    cardRef: RefObject<HTMLDivElement | null>,
    restoreFocusRef: RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        if (!open) return;
        const previouslyFocused = restoreFocusRef.current ?? document.activeElement as HTMLElement | null;
        const card = cardRef.current;
        const focusableSelector = [
            "button:not([disabled])",
            "[href]",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[tabindex]:not([tabindex='-1'])",
        ].join(",");
        const focusables = () => Array.from(card?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);

        // autoFocus remains authoritative for the preferred action. This fallback
        // covers dialogs whose browser does not honor it or whose content changes.
        if (!card?.contains(document.activeElement)) (focusables()[0] ?? card)?.focus();

        function trapTab(e: KeyboardEvent) {
            if (e.key !== "Tab") return;
            const items = focusables();
            if (!items.length) {
                e.preventDefault();
                card?.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        window.addEventListener("keydown", trapTab);
        return () => {
            window.removeEventListener("keydown", trapTab);
            // A portal teardown can move focus back to <body> after an
            // immediate focus() call. Restore on the next frame, once React
            // has removed the dialog node, and only if the opener still exists.
            requestAnimationFrame(() => {
                if (previouslyFocused?.isConnected) previouslyFocused.focus();
            });
        };
    }, [open, cardRef, restoreFocusRef]);
}

function showGameAlert(message: string): void {
    const request: AlertRequest = {
        message,
        restoreFocus: document.activeElement as HTMLElement | null,
    };
    if (activeListener) activeListener(request);
    // Collapse a duplicate of the message already at the back of the pending
    // buffer — repeated identical alerts (e.g. mashing a button that errors the
    // same way) shouldn't stack into "N more notices queued".
    else if (pendingMessages[pendingMessages.length - 1]?.message !== message) pendingMessages.push(request);
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
    const [queue, setQueue] = useState<AlertRequest[]>([]);
    const cardRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        // Skip a message identical to the one already at the back of the queue so
        // the same alert can't pile up (see showGameAlert's pending-buffer dedupe).
        activeListener = (request) => setQueue((q) => {
            if (q[q.length - 1]?.message === request.message) return q;
            if (q.length === 0) restoreFocusRef.current = request.restoreFocus;
            return [...q, request];
        });
        if (pendingMessages.length > 0) {
            const pending = pendingMessages;
            pendingMessages = [];
            setQueue((q) => {
                if (q.length === 0) restoreFocusRef.current = pending[0]?.restoreFocus ?? null;
                return [...q, ...pending];
            });
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
    useDialogFocusTrap(queue.length > 0, cardRef, restoreFocusRef);

    if (queue.length === 0) return null;

    const current = queue[0].message;
    const moreCount = queue.length - 1;

    // Portal to <body> so the modal escapes the .app-shell stacking context.
    // Mounted inline, it rendered BENEATH the fixed side rails (right-menu
    // z-index 999999, etc.), which stayed lit and clickable over the "modal".
    // The portal + the raised .game-alert-backdrop z-index put it on top.
    return createPortal(
        <div className="game-alert-backdrop" onClick={dismiss} role="presentation">
            <div
                ref={cardRef}
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label="Notice"
                tabIndex={-1}
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
                            // Escape intentionally bubbles to the dialog-level
                            // handler so keyboard dismissal works while OK is focused.
                            if (e.key === "Enter" || e.key === " ") {
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

export type GamePasswordPromptOptions = {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
};

type PasswordRequest = {
    message: string;
    opts?: GamePasswordPromptOptions;
    resolve: (value: string | null) => void;
    restoreFocus: HTMLElement | null;
};

let activePasswordListener: ((req: PasswordRequest) => void) | null = null;
let pendingPasswords: PasswordRequest[] = [];

/**
 * Themed replacement for `window.prompt` when the value being collected is a
 * PASSWORD. Resolves the entered text, or null on Cancel / backdrop / Escape.
 *
 * Why this exists instead of window.prompt: the native dialog renders the typed
 * value in clear text (shoulder-surfable, and screen-shareable by accident) and
 * some browsers retain prompt input, so a password does not belong in it. This
 * uses <input type="password">, so the value is masked and the browser treats it
 * as a credential field — which also lets a password manager fill it.
 *
 * The value lives only in this component's state, is wiped on settle, and is
 * never logged or persisted here. Callers get it, use it for the request, and
 * drop it — this does NOT store a password anywhere, so the token-first auth
 * rule is unaffected.
 *
 * Same buffering contract as gameConfirm: requests fired before the host mounts
 * queue up, and if the host unmounts with one open it resolves null so awaiting
 * callers never hang.
 */
export function gamePasswordPrompt(message: string, opts?: GamePasswordPromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        const req: PasswordRequest = {
            message: String(message ?? ""),
            opts,
            resolve,
            restoreFocus: typeof document === "undefined" ? null : document.activeElement as HTMLElement | null,
        };
        if (activePasswordListener) activePasswordListener(req);
        else pendingPasswords.push(req);
    });
}

export function GamePasswordPromptHost() {
    const [queue, setQueue] = useState<PasswordRequest[]>([]);
    const [value, setValue] = useState("");
    const cardRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        activePasswordListener = (req) => setQueue((q) => {
            if (q.length === 0) restoreFocusRef.current = req.restoreFocus;
            return [...q, req];
        });
        if (pendingPasswords.length > 0) {
            const pending = pendingPasswords;
            pendingPasswords = [];
            setQueue((q) => {
                if (q.length === 0) restoreFocusRef.current = pending[0]?.restoreFocus ?? null;
                return [...q, ...pending];
            });
        }
        return () => {
            activePasswordListener = null;
            setQueue((q) => { q.forEach((r) => r.resolve(null)); return []; });
        };
    }, []);

    // Always clear the field on settle so a typed password never lingers in state
    // for the next request in the queue.
    const settle = (result: string | null) => {
        setValue("");
        setQueue((q) => {
            if (q.length === 0) return q;
            q[0].resolve(result);
            return q.slice(1);
        });
    };

    useEffect(() => {
        if (queue.length === 0) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") { e.preventDefault(); settle(null); }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [queue.length]);

    useBodyScrollLock(queue.length > 0);
    useDialogFocusTrap(queue.length > 0, cardRef, restoreFocusRef);

    if (queue.length === 0) return null;

    const current = queue[0];
    const opts = current.opts ?? {};

    return createPortal(
        <div className="game-alert-backdrop" onClick={() => settle(null)} role="presentation">
            <div
                ref={cardRef}
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title ?? "Password required"}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="game-alert-header">
                    <span className="game-alert-badge">忍</span>
                    <span className="game-alert-title">{opts.title ?? "Password required"}</span>
                </div>
                <p className="game-alert-message">{current.message}</p>
                <form
                    onSubmit={(e) => { e.preventDefault(); settle(value); }}
                >
                    <input
                        className="game-alert-input"
                        type="password"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        autoComplete="current-password"
                        autoFocus
                        aria-label="Password"
                    />
                    <div className="game-alert-footer">
                        <button type="button" className="game-alert-cancel" onClick={() => settle(null)}>
                            {opts.cancelLabel ?? "Cancel"}
                        </button>
                        <button type="submit" className={`game-alert-ok${opts.danger ? " danger" : ""}`}>
                            {opts.confirmLabel ?? "Confirm"}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}

export type GameConfirmOptions = {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;       // red Confirm button for destructive actions
};

type ConfirmRequest = {
    message: string;
    opts?: GameConfirmOptions;
    resolve: (ok: boolean) => void;
    restoreFocus: HTMLElement | null;
};

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
        const req: ConfirmRequest = {
            message: String(message ?? ""),
            opts,
            resolve,
            restoreFocus: typeof document === "undefined" ? null : document.activeElement as HTMLElement | null,
        };
        if (activeConfirmListener) activeConfirmListener(req);
        else pendingConfirms.push(req);
    });
}

export function GameConfirmHost() {
    const [queue, setQueue] = useState<ConfirmRequest[]>([]);
    const cardRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        activeConfirmListener = (req) => setQueue((q) => {
            if (q.length === 0) restoreFocusRef.current = req.restoreFocus;
            return [...q, req];
        });
        if (pendingConfirms.length > 0) {
            const pending = pendingConfirms;
            pendingConfirms = [];
            setQueue((q) => {
                if (q.length === 0) restoreFocusRef.current = pending[0]?.restoreFocus ?? null;
                return [...q, ...pending];
            });
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
    useDialogFocusTrap(queue.length > 0, cardRef, restoreFocusRef);

    if (queue.length === 0) return null;

    const current = queue[0];
    const opts = current.opts ?? {};
    const moreCount = queue.length - 1;

    return createPortal(
        <div className="game-alert-backdrop" onClick={() => settle(false)} role="presentation">
            <div
                ref={cardRef}
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title ?? "Confirm"}
                tabIndex={-1}
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
