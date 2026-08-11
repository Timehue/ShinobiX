import assert from "node:assert/strict";
import test from "node:test";
import { postPlayerChallengeTerminal } from "./player-api.ts";

const original = {
    id: "challenge-1",
    fromName: "Kakashi",
    toName: "Obito",
    challenger: { name: "Kakashi" },
    createdAt: 1,
};

test("terminal challenge transition commits before deleting its outgoing authorization", async () => {
    const priorFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
            url: String(input),
            method: init?.method ?? "GET",
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const accepted = { ...original, accepted: true, declined: false, fromName: "Obito", toName: "Kakashi", battleId: "battle-1" };
        assert.equal(await postPlayerChallengeTerminal(original as never, accepted as never), true);
        assert.deepEqual(calls.map((call) => call.method), ["POST", "DELETE"]);
        assert.deepEqual(calls[0].body, { targetName: "Kakashi", challenge: accepted });
        assert.deepEqual(calls[1].body, { targetName: "Obito", fromName: "Kakashi", challengeId: "challenge-1" });
    } finally {
        globalThis.fetch = priorFetch;
    }
});

test("a contradictory terminal transition is rejected without touching the server", async () => {
    const priorFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
        const contradictory = { ...original, accepted: true, declined: true, fromName: "Obito", toName: "Kakashi" };
        assert.equal(await postPlayerChallengeTerminal(original as never, contradictory as never), false);
        assert.equal(calls, 0);
    } finally {
        globalThis.fetch = priorFetch;
    }
});
