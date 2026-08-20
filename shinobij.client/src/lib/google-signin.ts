// Client half of Google sign-in. The server does the whole OAuth exchange (see
// api/_google-auth.ts); this file only has to start the redirect, remember a
// nonce across it, and trade the returned ticket for a session token.
//
// There is no Google SDK here on purpose — the site's CSP blocks Google-hosted
// scripts and iframes, and a plain redirect needs neither.
//
// Both network calls ride sessionLoadFetch's deadline. A plain fetch here let a
// stalled connection pin the boot "Restoring…" gate (claim) or the login-gate
// controls (start) forever — and the redirect return is the most stall-prone
// moment in the app: a fresh page load on a renegotiating mobile radio.

import { sessionLoadFetch } from "./session-load-authority";

/**
 * The nonce ties a completed sign-in back to the browser that started it.
 * sessionStorage, not localStorage: it belongs to this tab's attempt, and it
 * should not outlive the tab or be shared with another one.
 */
const NONCE_STORAGE = "shinobix:googleNonce";

export type GoogleAuthOutcome = "ok" | "signup" | "linked" | "taken" | "expired" | "error";

export type GoogleClaimResult =
    | { status: "signed-in"; name: string; token?: string; linked?: boolean }
    | { status: "needs-signup"; suggestedName: string; signupTicket: string; nonce: string }
    | { status: "banned"; message: string }
    | { status: "failed"; message: string };

function randomNonce(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function rememberNonce(nonce: string): void {
    try { sessionStorage.setItem(NONCE_STORAGE, nonce); } catch { /* private mode */ }
}

function recallNonce(): string {
    try { return sessionStorage.getItem(NONCE_STORAGE) ?? ""; } catch { return ""; }
}

export function forgetGoogleNonce(): void {
    try { sessionStorage.removeItem(NONCE_STORAGE); } catch { /* private mode */ }
}

/**
 * Begin sign-in: ask the server for an authorize URL, then hand the browser to
 * Google. `mode: "link"` attaches Google to the account already signed in, and
 * needs the request to carry auth headers — which is why this is a POST through
 * the patched fetch rather than a plain link.
 */
export async function startGoogleSignIn(mode: "login" | "link" = "login"): Promise<string | null> {
    const nonce = randomNonce();
    rememberNonce(nonce);
    try {
        const response = await sessionLoadFetch("/api/auth/google/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nonce, mode }),
        });
        const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
        if (!response.ok || !data?.url) {
            return data?.error ?? "Google sign-in is unavailable right now.";
        }
        window.location.href = data.url;
        return null;
    } catch {
        return "Could not reach the server to start Google sign-in.";
    }
}

/**
 * Read the outcome the callback left in the URL, and strip it immediately.
 *
 * The ticket is single-use and short-lived, but a credential-shaped value has
 * no business sitting in the address bar, browser history, or the referrer of
 * the next request — so it comes out of the URL before anything else happens.
 */
export function readGoogleRedirect(): { outcome: GoogleAuthOutcome; ticket: string } | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("gauth");
    if (!outcome) return null;
    const ticket = params.get("gticket") ?? "";

    params.delete("gauth");
    params.delete("gticket");
    const query = params.toString();
    try {
        window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
        );
    } catch { /* replaceState can throw in exotic embedding contexts */ }

    return { outcome: outcome as GoogleAuthOutcome, ticket };
}

const OUTCOME_MESSAGES: Partial<Record<GoogleAuthOutcome, string>> = {
    taken: "That Google account is already linked to a different shinobi.",
    expired: "Your session ended while Google was signing you in. Sign in again, then link Google.",
    error: "Google sign-in did not complete. Try again.",
};

/**
 * Route a finished redirect to whichever of the three things happens next:
 * bring the player in, send them to the character creator, or explain why not.
 * Keeping the fan-out here is what stops App.tsx growing a fourth login branch.
 */
export async function finishGoogleRedirect(
    redirect: { outcome: GoogleAuthOutcome; ticket: string },
    on: {
        signedIn: (name: string, token?: string, linked?: boolean) => Promise<void> | void;
        needsSignup: (handoff: { suggestedName: string; signupTicket: string; nonce: string }) => void;
        failed: (message: string) => void;
    },
): Promise<void> {
    const claimed = await claimGoogleSignIn(redirect.outcome, redirect.ticket);
    if (claimed.status === "needs-signup") {
        on.needsSignup({ suggestedName: claimed.suggestedName, signupTicket: claimed.signupTicket, nonce: claimed.nonce });
        return;
    }
    if (claimed.status === "signed-in") {
        await on.signedIn(claimed.name, claimed.token, claimed.linked);
        return;
    }
    on.failed(claimed.message);
}

/** Trade the callback's ticket for a session token, or for a signup handoff. */
export async function claimGoogleSignIn(
    outcome: GoogleAuthOutcome,
    ticket: string,
): Promise<GoogleClaimResult> {
    const nonce = recallNonce();
    if (outcome !== "ok" && outcome !== "signup" && outcome !== "linked") {
        forgetGoogleNonce();
        return { status: "failed", message: OUTCOME_MESSAGES[outcome] ?? "Google sign-in did not complete." };
    }
    if (!ticket || !nonce) {
        forgetGoogleNonce();
        return {
            status: "failed",
            message: "This sign-in has to finish in the same browser tab that started it. Try again here.",
        };
    }

    try {
        const response = await sessionLoadFetch("/api/auth/google/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket, nonce }),
        });
        const data = await response.json().catch(() => null) as {
            name?: string;
            token?: string;
            linked?: boolean;
            needsSignup?: boolean;
            suggestedName?: string;
            signupTicket?: string;
            error?: string;
        } | null;

        if (response.status === 403) {
            forgetGoogleNonce();
            return { status: "banned", message: data?.error ?? "Account is banned." };
        }
        if (!response.ok || !data) {
            forgetGoogleNonce();
            return { status: "failed", message: data?.error ?? "Google sign-in did not complete. Try again." };
        }
        // The signup ticket is redeemed later by the character creator, so the
        // nonce has to survive until then.
        if (data.needsSignup && data.signupTicket) {
            return {
                status: "needs-signup",
                suggestedName: data.suggestedName ?? "",
                signupTicket: data.signupTicket,
                nonce,
            };
        }
        forgetGoogleNonce();
        if (!data.name) return { status: "failed", message: "Google sign-in did not complete. Try again." };
        return { status: "signed-in", name: data.name, token: data.token, linked: data.linked };
    } catch {
        forgetGoogleNonce();
        return { status: "failed", message: "Could not reach the server to finish signing in." };
    }
}
