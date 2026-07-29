/**
 * GameToast — transient, non-blocking confirmation.
 *
 * The counterpart to GameAlert: use a toast for ROUTINE SUCCESS ("Crafted 3x
 * Kunai", "Sent 500 ryo to Rill") and keep alert() for anything the player must
 * actually acknowledge — errors, refusals, and state they'd be hurt by missing.
 * A toast is dismissible-by-ignoring, so a message that matters must not be one.
 *
 * Control flow is unchanged by swapping alert() for gameToast(): the patched
 * window.alert in GameAlert.tsx is already fire-and-forget (it queues and
 * returns void), so neither call ever blocked the caller. The difference is
 * purely presentational — no modal to click through.
 *
 * Deliberately NOT a window.* patch. alert() keeps its meaning, and demoting a
 * message is an explicit, reviewable edit at the call site.
 */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type GameToastKind = "success" | "info";
export type GameToastOptions = {
    kind?: GameToastKind;
    /**
     * ms before auto-dismiss. Clamped to >= 1200 so a toast is always readable.
     * Omit it and the duration scales with message length — see readingTime.
     */
    duration?: number;
};

type Toast = { id: number; message: string; kind: GameToastKind; duration: number };

const BASE_DURATION = 3000;
const MIN_DURATION = 1200;
const MAX_DURATION = 8000;
/** Oldest toasts beyond this are dropped, so a reward burst can't wallpaper the screen. */
const MAX_VISIBLE = 3;

/**
 * Long messages need longer on screen. Some confirmations carry detail worth
 * reading — a bank transfer reports the amount received and the tax burned — and
 * a fixed timeout would yank those away mid-sentence. Roughly 45ms per character
 * past the first 40, which lands a short "Crafted 3x Kunai." at the 3s base and a
 * two-line receipt near 5-6s.
 */
export function readingTime(message: string): number {
    const extra = Math.max(0, message.length - 40) * 45;
    return Math.min(MAX_DURATION, BASE_DURATION + extra);
}

let activeListener: ((t: Toast) => void) | null = null;
let buffered: Toast[] = [];
let nextId = 1;

/**
 * Show a transient confirmation. Safe to call before the host mounts (buffered)
 * and safe to call when no host exists at all (the message is simply dropped
 * rather than throwing — a cosmetic notice must never break a game action).
 */
export function gameToast(message: string, opts?: GameToastOptions): void {
    const text = String(message ?? "").trim();
    if (!text) return;
    const toast: Toast = {
        id: nextId++,
        message: text,
        kind: opts?.kind ?? "success",
        duration: Math.max(MIN_DURATION, opts?.duration ?? readingTime(text)),
    };
    if (activeListener) activeListener(toast);
    else {
        buffered.push(toast);
        // Bound the pre-mount buffer too; without this, toasts fired in a loop
        // before mount would all arrive at once.
        if (buffered.length > MAX_VISIBLE) buffered = buffered.slice(-MAX_VISIBLE);
    }
}

export function GameToastHost() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Timers are per-toast so a later toast never cuts an earlier one short.
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

    useEffect(() => {
        const push = (t: Toast) => setToasts((list) => [...list, t].slice(-MAX_VISIBLE));
        activeListener = push;
        if (buffered.length > 0) {
            const pending = buffered;
            buffered = [];
            // Deferred, not called straight from the effect body: setting state
            // synchronously inside an effect makes React render twice before paint.
            // Claiming `buffered` above is still synchronous, so a second host
            // mounting in the same tick cannot pick up the same toasts.
            queueMicrotask(() => setToasts((list) => [...list, ...pending].slice(-MAX_VISIBLE)));
        }
        // Copy the ref for the cleanup: by the time it runs, timers.current may
        // point at a different Map than the one this effect started with.
        const pendingTimers = timers.current;
        return () => {
            activeListener = null;
            pendingTimers.forEach((id) => clearTimeout(id));
            pendingTimers.clear();
        };
    }, []);

    // Arm a dismiss timer for any toast that doesn't have one yet.
    useEffect(() => {
        for (const t of toasts) {
            if (timers.current.has(t.id)) continue;
            const handle = setTimeout(() => {
                timers.current.delete(t.id);
                setToasts((list) => list.filter((x) => x.id !== t.id));
            }, t.duration);
            timers.current.set(t.id, handle);
        }
        // Drop timers for toasts already gone (dismissed by click or overflow).
        for (const [id, handle] of timers.current) {
            if (!toasts.some((t) => t.id === id)) {
                clearTimeout(handle);
                timers.current.delete(id);
            }
        }
    }, [toasts]);

    if (toasts.length === 0) return null;

    return createPortal(
        // polite, not assertive: these are confirmations, so they must not
        // interrupt whatever a screen reader is already saying.
        //
        // Nothing here is clickable — see the pointer-events note in
        // styles/index/31-game-toast.css. Toasts expire on their own, and a
        // transient overlay that can swallow a tap is a worse bug than a toast
        // the player has to wait out.
        <div className="game-toast-stack" role="status" aria-live="polite">
            {toasts.map((t) => (
                <div key={t.id} className={`game-toast game-toast-${t.kind}`}>
                    {t.message}
                </div>
            ))}
        </div>,
        document.body,
    );
}
