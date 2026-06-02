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
 * confirm() and prompt() are left as native browser calls — they return
 * values synchronously and would require touching each call site.
 */
// Verbatim-moved from App.tsx (which disables this rule file-wide); effect behavior unchanged.
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";

type Listener = (message: string) => void;

let activeListener: Listener | null = null;
let pendingMessages: string[] = [];

function showGameAlert(message: string): void {
    if (activeListener) activeListener(message);
    else pendingMessages.push(message);
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
        activeListener = (m: string) => setQueue((q) => [...q, m]);
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

    if (queue.length === 0) return null;

    const current = queue[0];
    const moreCount = queue.length - 1;

    return (
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
        </div>
    );
}
