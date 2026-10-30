import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GOOGLE_REAUTH_MESSAGE, reauthenticate } from "./session-reauth";
import { rememberGuestSession, resumeGuestFor } from "./guest-play";

function installLocalStorage() {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)); },
        removeItem: (key: string) => { store.delete(key); },
    };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("session-expired re-authentication", () => {
    beforeEach(() => installLocalStorage());

    it("resumes a guest from this browser's credential without a password", async () => {
        rememberGuestSession({ name: "Rill", resume: "resume-key-for-rill-0001" });
        const sent: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (_url: string, init?: RequestInit) => {
            sent.push(String(init?.body));
            return reply(200, { ok: true, name: "rill", token: "fresh-guest-token" });
        }) as typeof fetch;
        try {
            const outcome = await reauthenticate("rill", "", async () => { throw new Error("verify must not run for a guest"); }, resumeGuestFor);
            assert.deepEqual(outcome, { status: "ok", token: "fresh-guest-token" });
            assert.match(sent[0], /"action":"guest-resume"/);
        } finally {
            globalThis.fetch = original;
        }
    });

    it("tells a Google-only account how to get back in instead of 'Incorrect password'", async () => {
        const outcome = await reauthenticate("kaida", "", async () => reply(200, { ok: false, passwordless: true }), resumeGuestFor);
        assert.deepEqual(outcome, { status: "refused", message: GOOGLE_REAUTH_MESSAGE });
    });

    it("keeps a ban apart from a wrong password", async () => {
        const banned = await reauthenticate("kaida", "pw", async () => reply(403, { ok: false, error: "Account is banned." }), resumeGuestFor);
        assert.deepEqual(banned, { status: "refused", message: "Account is banned." });
        const wrong = await reauthenticate("kaida", "pw", async () => reply(401, { ok: false }), resumeGuestFor);
        assert.deepEqual(wrong, { status: "refused", message: "Incorrect password. Try again." });
        const ok = await reauthenticate("kaida", "pw", async () => reply(200, { ok: true, token: "t" }), resumeGuestFor);
        assert.deepEqual(ok, { status: "ok", token: "t" });
    });
});
