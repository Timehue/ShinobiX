import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearAccountStatus, loadAccountStatus, refreshAccountStatus } from "./account-status";

const realFetch = globalThis.fetch;

type Call = { url: string };
let calls: Call[] = [];

function respond(body: unknown, status = 200): typeof globalThis.fetch {
    return (async (input: RequestInfo | URL) => {
        calls.push({ url: String(input) });
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        } as Response;
    }) as typeof globalThis.fetch;
}

const guestBody = { ok: true, account: { name: "guesty", guest: true, google: false, hasPassword: false, socialLocked: true } };
const claimedBody = { ok: true, account: { name: "guesty", guest: false, google: true, hasPassword: false, socialLocked: false } };
// A guest who set a first password: the flag survives, the lock does not.
const settledBody = { ok: true, account: { name: "guesty", guest: true, google: false, hasPassword: true, socialLocked: false } };

beforeEach(() => {
    calls = [];
    clearAccountStatus();
});

afterEach(() => {
    globalThis.fetch = realFetch;
    clearAccountStatus();
});

describe("account status cache", () => {
    it("asks the server once and reuses the answer", async () => {
        globalThis.fetch = respond(guestBody);
        const first = await loadAccountStatus();
        const second = await loadAccountStatus();
        assert.equal(first?.socialLocked, true);
        assert.deepEqual(second, first);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "/api/player/account-status");
    });

    it("coalesces concurrent callers into one request", async () => {
        globalThis.fetch = respond(guestBody);
        const [a, b] = await Promise.all([loadAccountStatus(), loadAccountStatus()]);
        assert.equal(a?.guest, true);
        assert.deepEqual(b, a);
        assert.equal(calls.length, 1);
    });

    it("does not cache a failure — one blip must not decide the lock for the whole page", async () => {
        globalThis.fetch = respond({ error: "nope" }, 503);
        assert.equal(await loadAccountStatus(), null);
        globalThis.fetch = respond(guestBody);
        assert.equal((await loadAccountStatus())?.socialLocked, true);
        assert.equal(calls.length, 2);
    });

    it("treats a signed-out 401 as nothing to report rather than an unlocked account", async () => {
        globalThis.fetch = respond({ error: "Authentication required." }, 401);
        assert.equal(await loadAccountStatus(), null);
    });

    it("survives a network throw", async () => {
        globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof globalThis.fetch;
        assert.equal(await loadAccountStatus(), null);
    });

    it("rejects a malformed payload instead of half-trusting it", async () => {
        globalThis.fetch = respond({ ok: true, account: { name: "guesty", guest: true } });
        assert.equal(await loadAccountStatus(), null);
    });

    it("reports a password-holding guest as unlocked, flag and all", async () => {
        globalThis.fetch = respond(settledBody);
        const account = await loadAccountStatus();
        assert.equal(account?.guest, true);
        assert.equal(account?.hasPassword, true);
        assert.equal(account?.socialLocked, false);
    });

    it("re-reads after a first password is set", async () => {
        globalThis.fetch = respond(guestBody);
        assert.equal((await loadAccountStatus())?.socialLocked, true);
        globalThis.fetch = respond(settledBody);
        assert.equal((await refreshAccountStatus())?.socialLocked, false);
    });

    it("re-reads after a Google link so the tavern opens without a reload", async () => {
        globalThis.fetch = respond(guestBody);
        assert.equal((await loadAccountStatus())?.socialLocked, true);
        globalThis.fetch = respond(claimedBody);
        const linked = await refreshAccountStatus();
        assert.equal(linked?.socialLocked, false);
        assert.equal(linked?.google, true);
        // And the new answer is the one that sticks: the read after the refresh
        // is served from cache, so exactly two requests happened in total.
        assert.equal((await loadAccountStatus())?.socialLocked, false);
        assert.equal(calls.length, 2);
    });
});
