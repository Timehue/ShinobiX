/*
 * Shared unread-mail count, driven by ONE poller shared across every badge that
 * subscribes (desktop right-rail + mobile nav), so the count can appear in
 * several places without multiplying /api/messages polls.
 *
 * Mirrors the subscribe pattern used by lib/pet-music's audio-mute switch. Auth
 * rides the global window.fetch interceptor (authFetch.ts) — a bare /api/ fetch
 * is signed automatically — so there is nothing to wire here. The poller only
 * runs while at least one badge is mounted, pauses while the tab is hidden, and
 * re-polls on focus so the badge is fresh when the player returns.
 */

import { visiblePoll } from "./poll";

const POLL_MS = 30000;

let unread = 0;
const subs = new Set<(n: number) => void>();
let stopPoll: (() => void) | null = null;

function emit(): void {
    subs.forEach((cb) => {
        try { cb(unread); } catch { /* a bad subscriber must not break the rest */ }
    });
}

async function poll(): Promise<void> {
    // Don't poll a backgrounded tab — saves the request and respects the
    // bandwidth budget. The visibilitychange handler re-polls on return.
    if (typeof document !== "undefined" && document.hidden) return;
    try {
        const r = await fetch("/api/messages");
        if (!r.ok) return; // 401 when logged out, etc. — keep last known count
        const inbox = await r.json();
        if (!Array.isArray(inbox)) return;
        const next = inbox.reduce((sum: number, e) => sum + (Number(e?.unread) || 0), 0);
        if (next !== unread) {
            unread = next;
            emit();
        }
    } catch {
        /* offline — keep last known count */
    }
}

function start(): void {
    if (stopPoll) return;
    void poll();
    // visiblePoll already owns the three things this hand-rolled: skip the tick
    // while hidden, re-poll the moment the tab is shown, and jitter the interval
    // so every badge-bearing client does not hit /api/messages on one tick.
    stopPoll = visiblePoll(() => void poll(), POLL_MS);
}

function stop(): void {
    if (stopPoll) { stopPoll(); stopPoll = null; }
}

export function getUnreadMail(): number {
    return unread;
}

/** Subscribe to unread-count changes; immediately invoked with the current value. */
export function subscribeUnreadMail(cb: (n: number) => void): () => void {
    subs.add(cb);
    cb(unread);
    if (subs.size === 1) start();
    return () => {
        subs.delete(cb);
        if (subs.size === 0) stop();
    };
}

/**
 * Re-poll now. Called by the Messages screen right after it opens a conversation
 * (which marks it read server-side), so the badge clears promptly instead of
 * waiting up to a full poll interval.
 */
export function refreshUnreadMail(): void {
    void poll();
}
