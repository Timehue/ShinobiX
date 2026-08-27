import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { deleteServerAccount } from "./mission-combat-claim";

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

type RecordedCall = { url: string; init: RequestInit };

function installSuccessfulFetch(calls: RecordedCall[]): void {
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return new Response(null, { status: 204 });
    }) as typeof fetch;
}

test("passwordless deletion leaves authentication to the active session token", { concurrency: false }, async () => {
    const calls: RecordedCall[] = [];
    installSuccessfulFetch(calls);

    assert.deepEqual(await deleteServerAccount("GoogleOnly"), { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, "/api/save/googleonly");
    assert.equal(calls[1]?.url, "/api/player-auth");
    assert.equal(new Headers(calls[0]?.init.headers).has("x-player-password"), false);
    assert.equal(new Headers(calls[1]?.init.headers).has("x-player-password"), false);
    assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { action: "delete", name: "googleonly" });
});

test("password accounts send the password to both deletion endpoints", { concurrency: false }, async () => {
    const calls: RecordedCall[] = [];
    installSuccessfulFetch(calls);

    assert.deepEqual(await deleteServerAccount("PasswordUser", "StrongPass1"), { ok: true });
    assert.equal(new Headers(calls[0]?.init.headers).get("x-player-password"), "StrongPass1");
    assert.equal(new Headers(calls[1]?.init.headers).get("x-player-password"), "StrongPass1");
    assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {
        action: "delete",
        name: "passworduser",
        password: "StrongPass1",
    });
});

test("auth deletion cannot race ahead of save deletion", { concurrency: false }, async () => {
    const calls: RecordedCall[] = [];
    let releaseSave!: () => void;
    const saveFinished = new Promise<void>((resolve) => { releaseSave = resolve; });
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        if (calls.length === 1) await saveFinished;
        return new Response(null, { status: 204 });
    }) as typeof fetch;

    const deletion = deleteServerAccount("TokenUser");
    await Promise.resolve();
    assert.deepEqual(calls.map((call) => call.url), ["/api/save/tokenuser"]);
    releaseSave();
    assert.deepEqual(await deletion, { ok: true });
    assert.deepEqual(calls.map((call) => call.url), ["/api/save/tokenuser", "/api/player-auth"]);
});

test("the profile flow only prompts when the server reports a password", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const start = app.indexOf("async function deleteCharacter(");
    const end = app.indexOf("function endLocalSession(", start);
    const flow = app.slice(start, end);

    assert.ok(start >= 0 && end > start, "deleteCharacter flow must remain present");
    assert.match(flow, /await refreshAccountStatus\(\)/);
    assert.match(flow, /accountStatus\.name !== accountKey\(accountName\)/);
    assert.match(flow, /if \(accountStatus\.hasPassword\) \{[\s\S]*gamePasswordPrompt\(/);
    assert.match(flow, /let localPw = "";/, "passwordless accounts must reach token-backed deletion without a fabricated password");
});
