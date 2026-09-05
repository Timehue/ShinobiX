import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    type FirstPactProgress,
} from "../../shared/first-pact-contract.js";
import type { ShowdownSession } from "../_pet-showdown/engine.js";

process.env.NODE_ENV = "test";
process.env.SHINOBIX_QA_MEMORY_KV = "1";
process.env.SESSION_SECRET = "first-pact-showdown-authority-secret";

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = "firstpactshowdown";
const PET_IDS = ["pact-pet-a", "pact-pet-b", "pact-pet-c", "pact-pet-d"];
let handler: Handler;
let kv: typeof import("../_storage.js").kv;
let token = "";

function pet(id: string, level: number) {
    return {
        id,
        name: `Companion ${id.slice(-1).toUpperCase()}`,
        element: "Fire",
        role: "assassin",
        rarity: "standard",
        level,
        hp: 800,
        attack: 120,
        defense: 95,
        speed: 105,
        jutsus: [{ name: "Witness Flame", power: 90, kind: "damage" }],
    };
}

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>): Promise<Out> {
    const out = response();
    await handler({
        method: "POST",
        body: { playerName: PLAYER, ...body },
        headers: { "content-type": "application/json", "x-player-token": token },
        socket: { remoteAddress: "127.0.0.74" },
    } as never, out.res);
    return out.out;
}

function menagerieProgress(): FirstPactProgress {
    let progress: FirstPactProgress = {
        ...createFirstPactProgress(10),
        mainStep: "meet-scribe-vey",
        flags: ["crossed-celestial-threshold"],
    };
    for (const beat of ["meet-scribe", "omen-bell", "omen-aqueduct", "omen-gardens", "report-omens"] as const) {
        progress = advanceFirstPactMainBeat(progress, beat, 20).progress;
    }
    return progress;
}

before(async () => {
    ({ kv } = await import("../_storage.js"));
    token = (await import("../_auth.js")).issuePlayerToken(PLAYER)!;
    handler = (await import("./showdown.js")).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.del(`first-pact:${PLAYER}`);
    await kv.set(`first-pact:${PLAYER}`, menagerieProgress());
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER,
            level: 100,
            pets: PET_IDS.map((id, index) => pet(id, [100, 96, 91, 88][index])),
        },
    });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test("First Pact admission seals the chapter and exactly two active pets plus two reserves", async () => {
    const premature = await post({ action: "first-pact", encounterId: "lattice-guardian", petIds: PET_IDS });
    assert.equal(premature.statusCode, 409);

    const shortTeam = await post({ action: "first-pact", encounterId: "court-menagerie", petIds: PET_IDS.slice(0, 3) });
    assert.equal(shortTeam.statusCode, 400);

    const started = await post({ action: "first-pact", encounterId: "court-menagerie", petIds: PET_IDS });
    assert.equal(started.statusCode, 200);
    const state = started.body?.state as { sessionId?: string; format?: string; player?: unknown[]; enemy?: unknown[] };
    assert.equal(state.format, "2v2");
    assert.equal(state.player?.length, 4);
    assert.equal(state.enemy?.length, 4);
    assert.equal("bindingKind" in state, false, "the server-only campaign binding must not enter the public battle view");
    const sealed = await kv.get<ShowdownSession>(`pet:showdown:${PLAYER}:${state.sessionId}`);
    assert.equal(sealed?.bindingKind, "first-pact");
    assert.equal((started.body?.firstPact as { encounterId?: string })?.encounterId, "court-menagerie");
});

test("a bound First Pact victory advances once and can be safely reclaimed", async () => {
    const started = await post({ action: "first-pact", encounterId: "court-menagerie", petIds: PET_IDS });
    assert.equal(started.statusCode, 200);
    const sessionId = String((started.body?.state as { sessionId?: unknown }).sessionId ?? "");
    assert.ok(sessionId);

    const key = `pet:showdown:${PLAYER}:${sessionId}`;
    const session = await kv.get<ShowdownSession>(key);
    assert.ok(session);
    session!.finished = true;
    session!.outcome = "win";
    await kv.set(key, session);

    const settled = await post({ action: "turn", sessionId, commands: [] });
    assert.equal(settled.statusCode, 200);
    const first = settled.body?.firstPact as { advanced?: boolean; progress?: FirstPactProgress };
    assert.equal(first.advanced, true);
    assert.equal(first.progress?.mainStep, "recover-withheld-record");
    assert.equal(first.progress?.courtStanding, 450);

    const replayed = await post({ action: "turn", sessionId, commands: [] });
    assert.equal(replayed.statusCode, 200);
    const second = replayed.body?.firstPact as { advanced?: boolean; progress?: FirstPactProgress };
    assert.equal(second.advanced, false);
    assert.equal(second.progress?.mainStep, "recover-withheld-record");
    assert.equal(second.progress?.courtStanding, 450);
    assert.equal(second.progress?.mainQuest.battleProofs.length, 1);
});

test("an active First Pact fight refreshes its campaign binding with the session lease", async () => {
    const started = await post({ action: "first-pact", encounterId: "court-menagerie", petIds: PET_IDS });
    assert.equal(started.statusCode, 200);
    const sessionId = String((started.body?.state as { sessionId?: unknown }).sessionId ?? "");
    const bindingKey = `sd-fp:${PLAYER}:${sessionId}`;
    await kv.set(bindingKey, { encounterId: "court-menagerie" }, { ex: 1 });

    const turn = await post({ action: "turn", sessionId, commands: [] });
    assert.equal(turn.statusCode, 200);
    assert.equal((turn.body?.state as { finished?: boolean }).finished, false);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.deepEqual(await kv.get(bindingKey), { encounterId: "court-menagerie" });
});

test("a missing campaign binding fails closed before a First Pact turn advances", async () => {
    const started = await post({ action: "first-pact", encounterId: "court-menagerie", petIds: PET_IDS });
    assert.equal(started.statusCode, 200);
    const sessionId = String((started.body?.state as { sessionId?: unknown }).sessionId ?? "");
    const sessionKey = `pet:showdown:${PLAYER}:${sessionId}`;
    const before = await kv.get<ShowdownSession>(sessionKey);
    await kv.del(`sd-fp:${PLAYER}:${sessionId}`);

    const refused = await post({ action: "turn", sessionId, commands: [] });
    assert.equal(refused.statusCode, 503);
    const after = await kv.get<ShowdownSession>(sessionKey);
    assert.equal(after?.round, before?.round);
    assert.equal(after?.finished, false);
});
