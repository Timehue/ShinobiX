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
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { createAlertRouter } from "../lib/slow-down-notice";
import { gameToast } from "./GameToast";

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
                // A confirmation can resolve into a notice before this frame runs.
                // Keep focus in the successor dialog instead of its old opener.
                if (!document.querySelector(".game-alert-backdrop") && previouslyFocused?.isConnected) previouslyFocused.focus();
            });
        };
    }, [open, cardRef, restoreFocusRef]);
}

const routeAlert = createAlertRouter();

const SERVER_UNREACHABLE_NOTICE = "The request could not be confirmed. Check your connection and current progress before trying again.";
const SERVER_FAILED_NOTICE = "The server reported an error. Check your current progress before trying again.";

/**
 * Every alert() passes through here, so a raw browser or server error that a
 * call site forwarded unchanged ("Failed to fetch", a 502 page parsed as JSON,
 * a bare "Internal server error.") becomes a sentence a player can act on.
 * Anything else is returned untouched.
 */
export function playerAlertText(message: string): string {
    const text = message.trim();
    if (/^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/.test(text)) return SERVER_UNREACHABLE_NOTICE;
    if (/^Unexpected (token|end of JSON input)/.test(text)) return "The server response could not be read. Check your current progress before trying the action again.";
    if (/^Internal server error\.?$/.test(text)) return SERVER_FAILED_NOTICE;
    return message;
}

/** Keys pressed this soon after a notice opens were meant for whatever had focus before it. */
export const NOTICE_KEY_GUARD_MS = 250;

/** Whether a keydown may dismiss the open notice: never a held key, never a keystroke typed as it arrived. */
export function noticeKeyCanDismiss(e: { repeat: boolean }, openedAt: number, now: number): boolean {
    return !e.repeat && now - openedAt >= NOTICE_KEY_GUARD_MS;
}

function showGameAlert(rawMessage: string): void {
    const message = playerAlertText(rawMessage);
    // A rate-limit "slow down" refusal only asks the player to wait — never
    // worth a modal to click through. It becomes a quiet toast, and a repeat of
    // the same notice within SLOW_DOWN_TOAST_GAP_MS is dropped (see
    // lib/slow-down-notice.ts). Every other alert keeps its modal.
    const route = routeAlert(message, Date.now());
    if (route !== "modal") {
        if (route === "toast") gameToast(message, { kind: "info" });
        return;
    }
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
    const openedAtRef = useRef(0);
    const head = queue[0];

    // Each notice starts its own key guard, including one that takes the place
    // of a dismissed notice in the queue.
    useLayoutEffect(() => {
        if (head) openedAtRef.current = performance.now();
    }, [head]);

    useEffect(() => {
        if (queue.length === 0) return;
        function onKey(e: KeyboardEvent) {
            // Space is left to the focused OK button, which activates natively.
            // Enter is ignored while held, or when it was typed (into chat, say)
            // as the notice arrived. Escape always dismisses.
            if (e.key === "Escape" || (e.key === "Enter" && noticeKeyCanDismiss(e, openedAtRef.current, performance.now()))) {
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
                onKeyDown={(e) => {
                    // Handle Escape before an owning screen can stop its
                    // bubbled key event on the way to the window listener.
                    if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        dismiss();
                    }
                }}
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
                            // Escape reaches the alert card above, including
                            // while OK is focused.
                            if (e.key === "Enter" || e.key === " ") {
                                e.stopPropagation();
                                // OK takes focus the moment the notice opens, so a
                                // held key or one typed as it arrived would click it.
                                if (!noticeKeyCanDismiss(e, openedAtRef.current, performance.now())) e.preventDefault();
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
    initialFocus?: "confirm" | "cancel";
    /** Cancel a confirmation when the scene that requested it is interrupted. */
    signal?: AbortSignal;
};

/** A destructive confirm opens on Cancel, so a stray Enter cannot accept it. An explicit initialFocus wins. */
export function confirmFocusesCancel(opts: GameConfirmOptions | undefined): boolean {
    return opts?.initialFocus ? opts.initialFocus === "cancel" : opts?.danger === true;
}

type ConfirmRequest = {
    message: string;
    opts?: GameConfirmOptions;
    resolve: (ok: boolean) => void;
    restoreFocus: HTMLElement | null;
};

let activeConfirmListener: ((req: ConfirmRequest) => void) | null = null;
let cancelConfirmListener: ((req: ConfirmRequest) => void) | null = null;
let pendingConfirms: ConfirmRequest[] = [];

/**
 * Themed replacement for window.confirm. Resolves true on Confirm, false on
 * Cancel / backdrop click / Escape. Requests fired before the host mounts are
 * buffered; if the host unmounts with requests still open they resolve false so
 * awaiting callers never hang.
 */
export function gameConfirm(message: string, opts?: GameConfirmOptions): Promise<boolean> {
    if (opts?.signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            opts?.signal?.removeEventListener("abort", cancel);
            resolve(ok && !opts?.signal?.aborted);
        };
        const req: ConfirmRequest = {
            message: String(message ?? ""),
            opts,
            resolve: finish,
            restoreFocus: typeof document === "undefined" ? null : document.activeElement as HTMLElement | null,
        };
        const cancel = () => {
            pendingConfirms = pendingConfirms.filter(request => request !== req);
            cancelConfirmListener?.(req);
            finish(false);
        };
        opts?.signal?.addEventListener("abort", cancel, { once: true });
        if (activeConfirmListener) activeConfirmListener(req);
        else pendingConfirms.push(req);
    });
}

export function GameConfirmHost() {
    const [queue, setQueue] = useState<ConfirmRequest[]>([]);
    const cardRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const descriptionId = useId();
    const current = queue[0];

    // Also honor the preferred action when a queued request replaces a dialog
    // without unmounting its buttons (autoFocus alone only handles the mount).
    useEffect(() => {
        if (!current) return;
        (confirmFocusesCancel(current.opts) ? cancelRef : confirmRef).current?.focus();
    }, [current]);

    useEffect(() => {
        cancelConfirmListener = (req) => setQueue(q => q.filter(request => request !== req));
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
            cancelConfirmListener = null;
            // Resolve anything still open as cancelled so awaiting callers unblock.
            setQueue((q) => { q.forEach((r) => r.resolve(false)); return []; });
        };
    }, []);

    const settle = useCallback((ok: boolean) =>
        setQueue((q) => {
            // A cancelled dialog's old click/keydown must not accept its successor.
            if (!current || q[0] !== current) return q;
            current.resolve(ok);
            return q.slice(1);
        }), [current]);

    useLayoutEffect(() => {
        if (!current) return;
        // Escape = cancel. Enter activates the preferred, focused button, so
        // no window-level Enter handler is needed
        // (which also avoids the double-settle the alert host had to guard against).
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") { e.preventDefault(); settle(false); }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [current, settle]);

    useBodyScrollLock(queue.length > 0);
    useDialogFocusTrap(queue.length > 0, cardRef, restoreFocusRef);

    if (queue.length === 0) return null;

    const opts = current.opts ?? {};
    const moreCount = queue.length - 1;
    const focusCancel = confirmFocusesCancel(opts);

    return createPortal(
        <div className="game-alert-backdrop" onClick={() => settle(false)} role="presentation">
            <div
                ref={cardRef}
                className="game-alert-card"
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title ?? "Confirm"}
                aria-describedby={descriptionId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="game-alert-header">
                    <span className="game-alert-badge">忍</span>
                    <span className="game-alert-title">{opts.title ?? "Confirm"}</span>
                </div>
                <p id={descriptionId} className="game-alert-message">{current.message}</p>
                <div className="game-alert-footer">
                    {moreCount > 0 && (
                        <span className="game-alert-more">
                            {moreCount} more {moreCount === 1 ? "prompt" : "prompts"} queued
                        </span>
                    )}
                    <button ref={cancelRef} type="button" className="game-alert-cancel" onClick={() => settle(false)} autoFocus={focusCancel}>
                        {opts.cancelLabel ?? "Cancel"}
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        className={`game-alert-ok${opts.danger ? " danger" : ""}`}
                        onClick={() => settle(true)}
                        autoFocus={!focusCancel}
                    >
                        {opts.confirmLabel ?? "Confirm"}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
