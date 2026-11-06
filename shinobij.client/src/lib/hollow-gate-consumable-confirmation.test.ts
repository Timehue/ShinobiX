import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun } from "../types/character";
import { activateHollowGateConsumable, type HollowGateConsumableScope } from "./hollow-gate-consumable-confirmation";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const run = (overrides: Partial<HollowGateShrineRun> = {}): HollowGateShrineRun => ({
    runToken: "run-one", floor: 1, width: 1, height: 1, playerX: 0, playerY: 0,
    keys: 1, torch: 4, threat: 30, wardSteps: 0, completed: false,
    tiles: [{ kind: "empty", terrain: "room_floor", roomId: 0, revealed: false, resolved: false }],
    ...overrides,
});
function pending() {
    let release!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { release = resolve; });
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return response; }) as typeof fetch;
    const original = run();
    let current: HollowGateConsumableScope | null = { run: original, playerName: "diver" };
    const commits: { character: Character; version: unknown }[] = [], runs: HollowGateShrineRun[] = [], logs: string[] = [];
    let accept = true;
    return {
        original, commits, runs, logs, requests,
        setCurrent: (next: HollowGateConsumableScope | null) => { current = next; },
        refuseCharacter: () => { accept = false; },
        start: (id = "diviner-eye") => activateHollowGateConsumable(id, { run: original, playerName: "diver" }, {
            current: () => current, setRun: next => { runs.push(next); }, pushLog: line => { logs.push(line); },
            onVersionedCharacter: (character, version) => { commits.push({ character, version }); return accept; },
        }),
        finish: (extra: Record<string, unknown> = {}, status = 200) => release(new Response(JSON.stringify({
            ok: true, character: { name: "diver", hollowShards: 75, hollowGateRun: original }, _saveVersion: 12,
            runState: { keys: 2, torch: 10, threat: 0, wardSteps: 6, divinerUsed: true, secondWindArmed: true },
            entryCurrencies: { hollowShards: 75 }, ...extra,
        }), { status })),
    };
}

for (const id of ["reignite", "skeleton-key", "hollow-ward", "diviner-eye", "sanctify", "second-wind"]) {
    test(`a delayed ${id} receipt preserves the next floor while reconciling its paid character`, async () => {
        const f = pending(), done = f.start(id);
        const next = run({ floor: 2, keys: 7, torch: 9, threat: 8, wardSteps: 3, entryCurrencies: { hollowShards: 80 } });
        f.setCurrent({ run: next, playerName: "diver" });
        f.finish(); await done;
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].action, id === "second-wind" ? "arm-second-wind" : id);
        assert.equal(f.commits.length, 1);
        assert.equal(f.commits[0].character.hollowShards, 75);
        assert.equal(f.commits[0].version, 12);
        assert.equal(f.commits[0].character.hollowGateRun, next, "retain the exact newer board and its resources");
        assert.deepEqual(f.runs, []);
        assert.deepEqual(f.logs, []);
    });
}

test("a replacement token cannot resurrect the old run", async () => {
    const f = pending(), done = f.start();
    const next = run({ runToken: "run-two", keys: 7 });
    f.setCurrent({ run: next, playerName: "diver" });
    f.finish(); await done;
    assert.equal(f.commits[0].character.hollowGateRun, next);
    assert.deepEqual(f.runs, []);
    assert.deepEqual(f.logs, []);
});

test("same-floor replies preserve intervening movement and apply a paid effect despite a stale character receipt", async () => {
    const f = pending(), done = f.start();
    const moved = run({ playerX: 1, width: 2, tiles: [...f.original.tiles, { ...f.original.tiles[0], seen: true }] });
    f.setCurrent({ run: moved, playerName: "diver" }); f.refuseCharacter();
    f.finish({ alreadyReported: true }); await done;
    assert.equal(f.requests.length, 1, "a replay receipt never starts another purchase");
    assert.equal(f.runs.length, 1);
    assert.equal(f.runs[0].playerX, 1);
    assert.equal(f.runs[0].tiles.length, 2);
    assert.equal(f.runs[0].diviner, true);
    assert.deepEqual([f.runs[0].keys, f.runs[0].torch, f.runs[0].threat, f.runs[0].wardSteps, f.runs[0].secondWindArmed], [2, 10, 0, 6, true]);
    assert.deepEqual(f.runs[0].entryCurrencies, { hollowShards: 75 });
    assert.equal(f.commits[0].character.hollowGateRun, f.runs[0]);
    assert.deepEqual(f.logs, ["Diviner's Eye activated."]);
});

for (const mode of ["pve", "pet"] as const) {
    test(`the run owner accepts a paid Eye while its shrine is hidden for ${mode} combat`, async () => {
        const f = pending(), done = f.start();
        const activeCombat = { runId: "fight-one", nodeId: "floor:1:ambush:test", floor: 1, kind: "ambush" as const, mode };
        f.setCurrent({ run: run({ activeCombat }), playerName: "diver" });
        f.finish(); await done;
        assert.equal(f.runs[0].activeCombat, activeCombat, "the paid reply must not close or replace the fight");
        assert.equal(f.runs[0].diviner, true);
        assert.equal(f.commits[0].character.hollowShards, 75);
        assert.equal(f.commits[0].character.hollowGateRun, f.runs[0]);
        assert.equal(f.requests.length, 1);
    });
}

for (const scope of [null, { run: run(), playerName: "another-account" }]) {
    test(`a response cannot publish after ${scope ? "account replacement" : "the run owner closes"}`, async () => {
        const f = pending(), done = f.start(); f.setCurrent(scope);
        f.finish(); await done;
        assert.deepEqual([f.commits, f.runs, f.logs], [[], [], []]);
    });
}

test("a completed run keeps its final projection", async () => {
    const f = pending(), done = f.start();
    const completed = run({ completed: true });
    f.setCurrent({ run: completed, playerName: "diver" });
    f.finish(); await done;
    assert.equal(f.commits[0].character.hollowGateRun, completed);
    assert.deepEqual(f.runs, []);
});

for (const changed of [false, true]) {
    test(`an unsuccessful reply ${changed ? "does not log into the next floor" : "keeps the current-floor retry message"}`, async () => {
        const f = pending(), done = f.start();
        if (changed) f.setCurrent({ run: run({ floor: 2 }), playerName: "diver" });
        f.finish({ ok: false, error: "Try again." }, 409); await done;
        assert.deepEqual([f.commits, f.runs], [[], []]);
        assert.deepEqual(f.logs, changed ? [] : ["Try again."]);
    });
}
