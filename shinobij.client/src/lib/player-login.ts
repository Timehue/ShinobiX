// The credential half of signing in, drained verbatim out of App.tsx.
//
// This is only the "is this really you" conversation with the server. Loading
// the save and painting the game stays in App, which owns that state. Keeping
// the two apart is what lets Google sign-in, guest resume, and a remembered
// account all reuse the same second half without re-implementing this first one.

import { sessionLoadFetch } from "./session-load-authority";
import {
    authRateLimitMessage,
    requiresLegacyAdminRecovery,
    type PlayerAuthResponse,
} from "./player-auth-policy";

export const FORGOT_PASSWORD_HINT =
    "Player name or password is incorrect.\n\nCheck for typos and capitals in your name. If you've forgotten your password, ask a moderator on Discord (discord.gg/bCQGs8r6SK) to verify your character and reset it.";

export type PlayerLoginResult =
    /** Credentials accepted. `token` is absent when SESSION_SECRET is unset server-side. */
    | { status: "ok"; token?: string }
    /** The attempt was abandoned because a newer session load started. */
    | { status: "superseded" }
    /** Show `message` and stay on the login screen. */
    | { status: "rejected"; message: string }
    /** This account signs in another way entirely. */
    | { status: "passwordless"; google: boolean; message: string };

/**
 * Fetch a player's save, retrying once past a storage hiccup.
 *
 * Null means the request never got an answer at all — distinct from a response
 * that says 404, which is a real (and separately handled) verdict about the
 * account. Callers must not treat "could not reach the server" as "no save".
 */
export async function fetchPlayerSave(name: string, isCurrent: () => boolean): Promise<Response | null> {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
            if (!isCurrent()) return null;
            // authFetch attaches the minted token to this relative /api/ URL.
            response = await sessionLoadFetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`, undefined, 20000);
            if (!isCurrent()) return null;
            if (response.status !== 503) break; // 503 = storage unavailable, retry
        } catch { /* timeout/network — retry */ }
    }
    return response;
}

/**
 * Verify a name + password against the server.
 *
 * Retries once, because a cold Supabase connection routinely makes the first
 * call slow enough to look like a failure — and reporting a storage hiccup as a
 * wrong password is how a player concludes the game ate their account.
 */
export async function verifyPlayerCredentials(
    name: string,
    password: string,
    isCurrent: () => boolean,
): Promise<PlayerLoginResult> {
    let verified = false;
    let result: PlayerLoginResult = { status: "rejected", message: FORGOT_PASSWORD_HINT };

    for (let attempt = 0; attempt < 2 && !verified; attempt++) {
        try {
            if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
            if (!isCurrent()) return { status: "superseded" };
            const response = await sessionLoadFetch("/api/player-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "verify", name: name.trim().toLowerCase(), password }),
            }, 15000);
            if (!isCurrent()) return { status: "superseded" };
            if (response.status === 503) continue; // storage unavailable — retry
            const data = await response.json().catch(() => ({})) as PlayerAuthResponse;
            if (!isCurrent()) return { status: "superseded" };

            if (requiresLegacyAdminRecovery(response.status, data)) {
                // A save without a server credential cannot be claimed from
                // localStorage. Only authenticated admin recovery may bind a
                // password to it, so never enter the offline/local fallback.
                return {
                    status: "rejected",
                    message: "This legacy account does not yet have a server password. For your security, an administrator must verify ownership and reset the password before you can sign in.",
                };
            }
            if (response.status === 403) {
                // Banned. Show the detail and bail out — do not fall back to the
                // local cache, the server explicitly refused.
                const ban = data.ban;
                if (!ban) return { status: "rejected", message: "⛔ Your account is banned." };
                const when = ban.permanent ? "permanently" : `until ${new Date(ban.until).toLocaleString()}`;
                return {
                    status: "rejected",
                    message: `⛔ Your account is banned ${when}.\n\nReason: ${ban.reason || "(no reason given)"}`,
                };
            }
            if (response.status === 429) return { status: "rejected", message: authRateLimitMessage(data) };

            if (response.ok) {
                verified = true;
                const body = data as PlayerAuthResponse & { passwordless?: boolean; google?: boolean; error?: string };
                // There is no password on this account to be right or wrong.
                // Saying so is the difference between a Google player finding
                // their way in and one who assumes they have been locked out.
                if (body.passwordless) {
                    return {
                        status: "passwordless",
                        google: body.google === true,
                        message: body.error ?? "This account signs in another way.",
                    };
                }
                // Token presence is NOT part of the verdict: the server returns
                // none when SESSION_SECRET is unset, which is the documented
                // password fallback. Requiring one rejected correct passwords.
                result = data.ok === true
                    ? { status: "ok", token: data.token ?? undefined }
                    : { status: "rejected", message: FORGOT_PASSWORD_HINT };
            } else {
                verified = true; // non-retriable HTTP error
            }
        } catch {
            // Network/timeout — retry once, then require an online login.
        }
    }

    if (!verified) {
        return {
            status: "rejected",
            message: "Could not reach server to verify password. Check your connection and try again.",
        };
    }
    return result;
}
