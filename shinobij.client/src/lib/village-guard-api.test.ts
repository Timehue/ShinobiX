import assert from "node:assert/strict";
import { test } from "node:test";
import { askVillageGuardPost } from "./village-guard-api";

const BODY = { attackerCharacter: { name: "Caius" }, village: "Frostfang Village", guardName: "Dopey" };
const answering = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("only a guard the server names starts a duel", async () => {
    const guard = { name: "Dopey" };
    assert.deepEqual(await askVillageGuardPost(BODY, answering(200, { pvp: true, guardCharacter: guard })), { kind: "duel", guard });
});

test("every other answer is the garrison, including a guard whose save is missing", async () => {
    for (const body of [{ noGuard: true }, { pvp: false, guardName: "Dopey", guardLevel: 40 }, {}]) {
        assert.deepEqual(await askVillageGuardPost(BODY, answering(200, body)), { kind: "garrison" }, JSON.stringify(body));
    }
});

test("a refusal keeps the server's reason and starts nothing", async () => {
    assert.deepEqual(await askVillageGuardPost(BODY, answering(429, { error: "Too many raids." })),
        { kind: "refused", message: "Too many raids." });
});

test("a lost or unreadable reply is a refusal, never a free garrison fight", async () => {
    const lost = (async () => { throw new Error("offline"); }) as typeof fetch;
    const garbled = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    for (const fetchFn of [lost, garbled]) {
        assert.equal((await askVillageGuardPost(BODY, fetchFn)).kind, "refused");
    }
});
