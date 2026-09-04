import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SHINOBIX_QA_MEMORY_KV = "1";
process.env.SESSION_SECRET = "first-pact-handler-authority-secret-32-bytes";

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = "firstpactauthority";
let handler: Handler;
let kv: typeof import("../_storage.js").kv;
let token = "";

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
        socket: { remoteAddress: "127.0.0.73" },
    } as never, out.res);
    return out.out;
}

before(async () => {
    ({ kv } = await import("../_storage.js"));
    token = (await import("../_auth.js")).issuePlayerToken(PLAYER)!;
    handler = (await import("./state.js")).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.del(`first-pact:${PLAYER}`);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, level: 100, pets: [] } });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test("the Celestial crossing enforces level 100 from the stored save", async () => {
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, level: 99, pets: [] } });
    const denied = await post({ action: "enter" });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body?.requiredLevel, 100);
    assert.equal(await kv.get(`first-pact:${PLAYER}`), null);
});

test("side quests and checkpoints remain sealed until entry, and checkpoint districts are derived", async () => {
    const prematureQuest = await post({ action: "accept-stable-quest" });
    assert.equal(prematureQuest.statusCode, 409);
    const prematureCheckpoint = await post({ action: "checkpoint", position: { x: 68, y: 46, district: "arrival-court" } });
    assert.equal(prematureCheckpoint.statusCode, 409);

    assert.equal((await post({ action: "enter" })).statusCode, 200);
    const checkpoint = await post({ action: "checkpoint", position: { x: 68, y: 46, district: "arrival-court" } });
    assert.equal(checkpoint.statusCode, 200);
    assert.deepEqual((checkpoint.body?.progress as { lastPosition?: unknown }).lastPosition, {
        x: 68,
        y: 46,
        district: "gateworks",
    });
});

test("the handler rejects skipped chapters and keeps the stable tournament independent", async () => {
    const entered = await post({ action: "enter" });
    assert.equal(entered.statusCode, 200);
    assert.equal((entered.body?.progress as Record<string, unknown>)?.mainStep, "meet-scribe-vey");

    const skipped = await post({ action: "advance-main", beat: "report-omens" });
    assert.equal(skipped.statusCode, 409);

    assert.equal((await post({ action: "advance-main", beat: "meet-scribe" })).statusCode, 200);
    assert.equal((await post({ action: "accept-stable-quest" })).statusCode, 200);
    for (const beat of ["omen-gardens", "omen-aqueduct", "omen-bell"] as const) {
        assert.equal((await post({ action: "advance-main", beat })).statusCode, 200);
    }
    const state = await post({ action: "state" });
    const progress = state.body?.progress as {
        mainStep?: string;
        stableQuest?: { status?: string };
        mainQuest?: { omens?: string[] };
    };
    assert.equal(progress.mainStep, "return-to-vey");
    assert.equal(progress.stableQuest?.status, "accepted");
    assert.deepEqual(progress.mainQuest?.omens, ["gardens", "aqueduct", "bell"]);
});

test("the server records one pact promise and rejects a second answer", async () => {
    const { createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    const ready = {
        ...createFirstPactProgress(100),
        chapter: 3 as const,
        mainStep: "make-first-pact" as const,
        flags: ["crossed-celestial-threshold"],
    };
    await kv.set(`first-pact:${PLAYER}`, ready);

    const retiredNonChoice = await post({ action: "advance-main", beat: "forge-first-pact" });
    assert.equal(retiredNonChoice.statusCode, 400);

    const chosen = await post({ action: "advance-main", beat: "forge-first-pact-kept-future" });
    assert.equal(chosen.statusCode, 200);
    const chosenProgress = chosen.body?.progress as { mainStep?: string; mainQuest?: { pactVow?: string }; flags?: string[] };
    assert.equal(chosenProgress.mainStep, "challenge-court-echo");
    assert.equal(chosenProgress.mainQuest?.pactVow, "kept-future");
    assert.deepEqual(chosenProgress.flags?.filter((flag) => flag.startsWith("pact-vow-")), ["pact-vow-kept-future"]);

    const second = await post({ action: "advance-main", beat: "forge-first-pact-open-road" });
    assert.equal(second.statusCode, 409);
    assert.equal(((second.body?.progress as { mainQuest?: { pactVow?: string } })?.mainQuest?.pactVow), "kept-future");
});
