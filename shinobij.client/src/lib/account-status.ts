/*
 * The signed-in account's own standing, as the server reports it.
 *
 * Screens must not decide this locally. The only guest signal the client used
 * to have is `shinobix:guestName` in localStorage, which is browser-local and
 * player-editable — so a lock derived from it would disagree with the server on
 * a second device, and could be switched off from devtools. `socialLocked`
 * arrives pre-computed from `api/player/account-status.ts`, which is the same
 * predicate `api/_guest-gate.ts` enforces on the endpoints. The UI lock and the
 * server gate therefore cannot drift, including when the kill switch is thrown.
 */
import { useEffect, useState } from "react";
import type { AccountStatus, AccountStatusResponse } from "../../../shared/account-status";

const ENDPOINT = "/api/player/account-status";

type Listener = (status: AccountStatus | null) => void;

let cached: AccountStatus | null = null;
let inFlight: Promise<AccountStatus | null> | null = null;
const listeners = new Set<Listener>();

function publish(next: AccountStatus | null): void {
    cached = next;
    for (const listener of listeners) listener(next);
}

function isAccountStatus(value: unknown): value is AccountStatus {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return typeof record.name === "string"
        && typeof record.guest === "boolean"
        && typeof record.google === "boolean"
        && typeof record.hasPassword === "boolean"
        && typeof record.socialLocked === "boolean";
}

/**
 * Read the account's standing, reusing the session's answer.
 *
 * A failed request keeps whatever was already known rather than caching the
 * failure: a single blip must not silently unlock a guest's chat controls, nor
 * lock a real player's, for the life of the page.
 */
export function loadAccountStatus(): Promise<AccountStatus | null> {
    if (cached) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            const res = await fetch(ENDPOINT);
            // 401 is the ordinary answer before sign-in; there is nothing to
            // report and nothing to lock, since every gated screen needs a
            // character anyway.
            if (!res.ok) return null;
            const data = await res.json().catch(() => null) as AccountStatusResponse | null;
            const account = data && data.ok ? data.account : null;
            if (!isAccountStatus(account)) return null;
            publish(account);
            return account;
        } catch {
            return null;
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

/**
 * Drop the cached answer and fetch a fresh one.
 *
 * Called at each moment a guest becomes a real account — a Google link landing,
 * or a first password being set — so the tavern opens without a page reload.
 */
export function refreshAccountStatus(): Promise<AccountStatus | null> {
    cached = null;
    inFlight = null;
    publish(null);
    return loadAccountStatus();
}

/**
 * Forget the account entirely.
 *
 * No production caller today: switching shinobi in one page is already handled
 * by the name check in `useSocialLock`, and signing out reloads. This exists so
 * tests can isolate, and as the correct hook if a sign-out ever stops reloading.
 */
export function clearAccountStatus(): void {
    cached = null;
    inFlight = null;
    publish(null);
}

export type SocialLock = {
    /** The tavern and the message channels are shut for this account. */
    locked: boolean;
    /** No answer yet. Render neither the lock nor the controls while true. */
    loading: boolean;
};

/**
 * The tavern/messaging lock for the signed-in account.
 *
 * Starts as `loading` so a screen never flashes the compose box at a guest (or
 * the lock at a real player) before the server has answered.
 *
 * Pass the character currently on screen and the cache re-validates itself
 * whenever those disagree — switching shinobi in one page must not carry the
 * previous account's standing across. (The Google link path needs no such help:
 * it is a full redirect out to Google and back, so the module starts cold.)
 */
export function useSocialLock(playerName?: string): SocialLock {
    const [status, setStatus] = useState<AccountStatus | null>(cached);
    const [settled, setSettled] = useState(cached !== null);
    const forName = playerName ? playerName.trim().toLowerCase() : "";

    useEffect(() => {
        let cancelled = false;
        const listener: Listener = (next) => {
            if (cancelled) return;
            setStatus(next);
            setSettled(next !== null);
        };
        listeners.add(listener);
        const stale = !!forName && !!cached && cached.name !== forName;
        void (stale ? refreshAccountStatus() : loadAccountStatus())
            .then(() => { if (!cancelled) setSettled(true); });
        return () => { cancelled = true; listeners.delete(listener); };
    }, [forName]);

    // `socialLocked` is read straight through, never recomputed from `guest` —
    // the server owns the rule, including the "a password releases you" half.
    return {
        locked: status?.socialLocked === true,
        loading: !settled,
    };
}

/** The one line of copy every locked surface shows, so they stay consistent. */
export const SOCIAL_LOCK_TITLE = "Locked for guest characters";
export const SOCIAL_LOCK_BODY =
    "This character has no owner yet — it lives only in this browser and cannot be signed back into from anywhere else. "
    + "Link a Google account or set a password to make it a real account, and the tavern and messages open up.";
