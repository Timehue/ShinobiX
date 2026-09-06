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

test("the accepted vow seals server pet names once and ignores forged client labels", async () => {
    const { createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    const ids = ["pet-a", "pet-b", "pet-c", "pet-d"];
    await kv.set(`first-pact:${PLAYER}`, {
        ...createFirstPactProgress(100),
        chapter: 3,
        mainStep: "make-first-pact",
        flags: ["crossed-celestial-threshold", "defeated-lattice-guardian"],
        mainQuest: { omens: [], battleProofs: ["lattice-proof"], latticeCompanionIds: ids },
    });
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 2,
        character: {
            name: PLAYER,
            level: 100,
            pets: [
                { id: "pet-a", name: "Kumo", nickname: "Cloud" },
                { id: "pet-b", name: "Tora" },
                { id: "pet-c", name: "Mori" },
                { id: "pet-d", name: "Suzu" },
            ],
        },
    });

    const chosen = await post({
        action: "advance-main",
        beat: "forge-first-pact-kept-future",
        pactCompanionNames: ["Forged One", "Forged Two", "Forged Three", "Forged Four"],
    });
    assert.equal(chosen.statusCode, 200);
    assert.deepEqual((chosen.body?.progress as { mainQuest: { pactCompanionNames?: unknown } }).mainQuest.pactCompanionNames,
        ["Cloud", "Tora", "Mori", "Suzu"]);

    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 3,
        character: {
            name: PLAYER,
            level: 100,
            pets: [
                { id: "pet-a", name: "Kumo", nickname: "Cirrus" },
                { id: "pet-b", name: "Tora" },
                { id: "pet-c", name: "Mori" },
            ],
        },
    });
    const staleRetry = await post({ action: "advance-main", beat: "forge-first-pact-kept-future" });
    assert.equal(staleRetry.statusCode, 409);
    assert.deepEqual((staleRetry.body?.progress as { mainQuest: { pactCompanionNames?: unknown } }).mainQuest.pactCompanionNames,
        ["Cloud", "Tora", "Mori", "Suzu"], "rename and removal after the vow cannot rewrite its record");
});

test("return visits are unlocked by stored findings, remain optional, and are idempotent", async () => {
    const { createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    await kv.set(`first-pact:${PLAYER}`, {
        ...createFirstPactProgress(100),
        chapter: 4,
        mainStep: "return-to-threshold",
        flags: ["crossed-celestial-threshold"],
        writs: ["writ-audit"],
        findings: ["writ-audit"],
        stableQuest: { status: "complete", tournamentWins: 3, battleProofs: ["a", "b", "c"] },
    });

    assert.equal((await post({ action: "visit-aftermath", aftermathId: "writ-pruning" })).statusCode, 409);
    const visited = await post({ action: "visit-aftermath", aftermathId: "writ-audit" });
    assert.equal(visited.statusCode, 200);
    assert.equal(visited.body?.replayed, false);
    assert.deepEqual((visited.body?.progress as { aftermathVisits?: string[] }).aftermathVisits, ["writ-audit"]);
    const replayed = await post({ action: "visit-aftermath", aftermathId: "writ-audit" });
    assert.equal(replayed.statusCode, 200);
    assert.equal(replayed.body?.replayed, true);
    assert.deepEqual((replayed.body?.progress as { aftermathVisits?: string[] }).aftermathVisits, ["writ-audit"]);
    assert.equal((await post({ action: "advance-main", beat: "complete-crossing" })).statusCode, 200,
        "an unvisited stable aftermath must not block crossing completion");
});

test("an exact completion replay repairs a lost response without duplicating its reward", async () => {
    const { createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    await kv.set(`first-pact:${PLAYER}`, {
        ...createFirstPactProgress(100),
        chapter: 4,
        mainStep: "return-to-threshold",
        flags: ["crossed-celestial-threshold"],
        mainQuest: { omens: [], battleProofs: [], pactVow: "open-road" },
    });
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 4,
        character: { name: PLAYER, level: 100, pets: [], auraStones: 7, serverTitles: [] },
    });

    const first = await post({ action: "advance-main", beat: "complete-crossing" });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body?.replayed, false);
    assert.equal(first.body?.grantedAuraStones, 15);
    assert.deepEqual(first.body?.grantedTitles, ["Pactbound", "Road Unclosed"]);
    assert.equal((first.body?.character as { auraStones?: number }).auraStones, 22);
    assert.equal(Number(first.body?._saveVersion), 5);

    // Model a lost first response by issuing the same action again. The exact
    // replay closes cleanly, while the save-locked grant writes nothing twice.
    const replay = await post({ action: "advance-main", beat: "complete-crossing" });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal(replay.body?.grantedAuraStones, undefined);
    assert.equal(replay.body?.grantedTitles, undefined);
    assert.equal((replay.body?.character as { auraStones?: number }).auraStones, 22,
        "a replay still returns the authoritative character for atomic client adoption");
    assert.equal(Number(replay.body?._saveVersion), 5);
    const stored = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const character = stored?.character as { auraStones?: number; serverTitles?: string[] };
    assert.equal(character.auraStones, 22);
    assert.deepEqual(character.serverTitles, ["Pactbound", "Road Unclosed"]);

    const unrelated = await post({ action: "advance-main", beat: "report-omens" });
    assert.equal(unrelated.statusCode, 409, "completion replay must not make other stale beats valid");
});

test("a failed completion grant is reported and the sealed completion repairs on retry", async () => {
    const { createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    await kv.set(`first-pact:${PLAYER}`, {
        ...createFirstPactProgress(100),
        chapter: 4,
        mainStep: "return-to-threshold",
        flags: ["crossed-celestial-threshold"],
    });
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 9,
        character: { name: PLAYER, level: 100, pets: [], auraStones: 3, serverTitles: [] },
    });

    const mutableKv = kv as typeof kv & { compareSet: typeof kv.compareSet };
    const compareSet = mutableKv.compareSet;
    mutableKv.compareSet = async () => { throw new Error("injected-save-write-failure"); };
    let failed: Out;
    try {
        failed = await post({ action: "advance-main", beat: "complete-crossing" });
    } finally {
        mutableKv.compareSet = compareSet;
    }
    assert.equal(failed.statusCode, 503);
    assert.equal((failed.body?.progress as { mainStep?: string }).mainStep, "complete",
        "the earned story completion remains sealed while its grant is retryable");
    const beforeRepair = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    assert.equal((beforeRepair?.character as { auraStones?: number }).auraStones, 3);

    // Reload begins with a state read, so repair cannot depend on the old
    // epilogue button surviving in browser memory.
    const repaired = await post({ action: "state" });
    assert.equal(repaired.statusCode, 200);
    assert.equal(repaired.body?.grantedAuraStones, 15);
    assert.equal((repaired.body?.character as { auraStones?: number }).auraStones, 18);
    assert.equal(Number(repaired.body?._saveVersion), 10);
    const afterRepair = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    assert.equal((afterRepair?.character as { auraStones?: number }).auraStones, 18);
});

test("concurrent completion replays serialize the title receipt and currency", async () => {
    const { advanceFirstPactMainBeat, createFirstPactProgress } = await import("../../shared/first-pact-contract.js");
    const ready = { ...createFirstPactProgress(100), chapter: 4 as const, mainStep: "return-to-threshold" as const };
    const complete = advanceFirstPactMainBeat(ready, "complete-crossing", 101).progress;
    await kv.set(`first-pact:${PLAYER}`, complete);
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 2,
        character: { name: PLAYER, level: 100, pets: [], auraStones: 1, serverTitles: [] },
    });

    const [left, right] = await Promise.all([
        post({ action: "advance-main", beat: "complete-crossing" }),
        post({ action: "advance-main", beat: "complete-crossing" }),
    ]);
    assert.equal(left.statusCode, 200);
    assert.equal(right.statusCode, 200);
    assert.equal(Number(left.body?.grantedAuraStones ?? 0) + Number(right.body?.grantedAuraStones ?? 0), 15);
    const stored = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
    const character = stored?.character as { auraStones?: number; serverTitles?: string[] };
    assert.equal(character.auraStones, 16);
    assert.deepEqual(character.serverTitles, ["Pactbound"]);
});
