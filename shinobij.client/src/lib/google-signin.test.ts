import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleStartBody, readGoogleRedirect } from "./google-signin";

/*
 * The ticket the OAuth callback hands back is credential-shaped: whoever holds
 * it (with the right nonce) can trade it for a session token. It arrives in the
 * URL because a top-level redirect has nowhere else to put it, which makes
 * getting it back OUT of the URL the load-bearing behaviour here — otherwise it
 * persists in history, in the referrer of the next request, and in any
 * diagnostics that record the current location.
 */

type ReplaceCall = { url: string };

let replaced: ReplaceCall[] = [];

function installWindow(url: string) {
    const parsed = new URL(url);
    replaced = [];
    (globalThis as { window?: unknown }).window = {
        location: { search: parsed.search, pathname: parsed.pathname, hash: parsed.hash },
        history: {
            replaceState: (_state: unknown, _title: string, next: string) => {
                replaced.push({ url: next });
                const resolved = new URL(next, parsed.origin);
                (globalThis as { window?: { location: Record<string, string> } }).window!.location.search = resolved.search;
            },
        },
    };
}

beforeEach(() => { replaced = []; });
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("readGoogleRedirect", () => {
    it("returns nothing when the URL carries no sign-in result", () => {
        installWindow("https://shinobijourney.com/?utm=x");
        assert.equal(readGoogleRedirect(), null);
        assert.deepEqual(replaced, [], "an unrelated URL must be left exactly as it is");
    });

    it("reads the outcome and ticket, then strips both from the URL", () => {
        installWindow("https://shinobijourney.com/?gauth=ok&gticket=abc123");
        const result = readGoogleRedirect();
        assert.deepEqual(result, { outcome: "ok", ticket: "abc123" });
        assert.equal(replaced.length, 1, "the URL must be rewritten immediately");
        assert.equal(replaced[0].url, "/", "no query string should survive");
        assert.ok(!replaced[0].url.includes("abc123"), "the ticket must not remain in the address bar");
    });

    it("keeps unrelated query parameters and the hash route intact", () => {
        installWindow("https://shinobijourney.com/?ref=discord&gauth=signup&gticket=t1#/village");
        const result = readGoogleRedirect();
        assert.equal(result?.outcome, "signup");
        assert.equal(replaced[0].url, "/?ref=discord#/village");
    });

    it("reports a failure outcome that carries no ticket", () => {
        installWindow("https://shinobijourney.com/?gauth=taken");
        assert.deepEqual(readGoogleRedirect(), { outcome: "taken", ticket: "" });
        assert.equal(replaced[0].url, "/");
    });

    it("consumes the result exactly once", () => {
        installWindow("https://shinobijourney.com/?gauth=ok&gticket=abc123");
        assert.ok(readGoogleRedirect());
        // The strip updated window.location.search, so a second read — a React
        // remount, say — must not re-run a sign-in that already happened.
        assert.equal(readGoogleRedirect(), null);
    });

    it("keeps the Android shell's launch parameters when it strips the result", () => {
        // The Flutter shell returns sign-ins as /?gauth…&gticket…&playNative=1&playReview=0,
        // and the review prompt reads playNative later in the session.
        installWindow("https://shinobijourney.com/?gauth=ok&gticket=abc123&playNative=1&playReview=0");
        readGoogleRedirect();
        assert.equal(replaced[0].url, "/?playNative=1&playReview=0");
    });

    it("survives a history API that refuses to rewrite", () => {
        installWindow("https://shinobijourney.com/?gauth=ok&gticket=abc123");
        (globalThis as { window: { history: { replaceState: () => void } } }).window.history.replaceState = () => {
            throw new Error("replaceState blocked");
        };
        // Failing to tidy the URL must not cost the player their sign-in.
        assert.deepEqual(readGoogleRedirect(), { outcome: "ok", ticket: "abc123" });
    });
});

describe("googleStartBody", () => {
    function withUserAgent(userAgent: string, run: () => void) {
        const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
        try { run(); } finally {
            if (original) Object.defineProperty(globalThis, "navigator", original);
            else Reflect.deleteProperty(globalThis, "navigator");
        }
    }

    it("sends only the nonce and mode from a normal browser", () => {
        withUserAgent("Mozilla/5.0 (Linux; Android 16) Chrome/150.0.0.0 Mobile Safari/537.36", () => {
            assert.deepEqual(googleStartBody("n".repeat(48), "login"), { nonce: "n".repeat(48), mode: "login" });
        });
    });

    it("asks for the app return only inside the Flutter shell", () => {
        withUserAgent("Mozilla/5.0 (Linux; Android 16; wv) Chrome/150.0.0.0 Mobile Safari/537.36 ShinobiJourneyApp/1", () => {
            assert.deepEqual(googleStartBody("n".repeat(48), "link"), { nonce: "n".repeat(48), mode: "link", client: "android-app" });
        });
    });
});
