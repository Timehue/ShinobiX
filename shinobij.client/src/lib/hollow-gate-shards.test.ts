import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun } from "../types/character";
import {
    applyShardConsumable,
    shardConsumableAvailable,
    tryHollowGateSecondWind,
    HOLLOW_SHARD_CONSUMABLES,
} from "./hollow-gate-shards";

const run = (over: Partial<HollowGateShrineRun> = {}): HollowGateShrineRun =>
    ({ torch: 4, keys: 0, threat: 80, tiles: [], entryCurrencies: { hollowShards: 0 }, ...over }) as HollowGateShrineRun;
const char = (over: Record<string, number> = {}): Character =>
    ({ hollowShards: 100, maxHp: 200, hp: 40, ryo: 0, ...over }) as unknown as Character;

const cost = (id: string) => HOLLOW_SHARD_CONSUMABLES.find((c) => c.id === id)!.cost;

test("reignite refills torch and deducts its cost", () => {
    const r = applyShardConsumable("reignite", run({ torch: 3 }), char());
    assert.equal(r.ok, true);
    if (r.ok) {
        assert.equal(r.run.torch, 10);
        assert.equal(r.character.hollowShards, 100 - cost("reignite"));
    }
});

test("skeleton key grants an in-run key", () => {
    const r = applyShardConsumable("skeleton-key", run({ keys: 1 }), char());
    assert.ok(r.ok && r.run.keys === 2);
});

test("hollow ward wipes threat and sets ward steps", () => {
    const r = applyShardConsumable("hollow-ward", run({ threat: 95 }), char());
    assert.ok(r.ok && r.run.threat === 0 && (r.run.wardSteps ?? 0) > 0);
});

test("diviner reveals all tiles and is once-per-run", () => {
    const base = run({ diviner: false, tiles: [{ kind: "chest", revealed: false, resolved: false } as never] });
    const r = applyShardConsumable("diviner-eye", base, char());
    assert.ok(r.ok && r.run.diviner === true && r.run.tiles[0].revealed === true);
    if (r.ok) assert.equal(shardConsumableAvailable(HOLLOW_SHARD_CONSUMABLES.find(c => c.id === "diviner-eye")!, r.run, r.character), false);
});

test("sanctify re-snapshots entry currencies to the current balance", () => {
    const r = applyShardConsumable("sanctify", run({ entryCurrencies: { ryo: 0 } }), char({ ryo: 5000 }));
    assert.ok(r.ok && r.run.entryCurrencies?.ryo === 5000);
});

test("not affordable -> unavailable and apply fails", () => {
    const poor = char({ hollowShards: 1 });
    const c = HOLLOW_SHARD_CONSUMABLES.find((x) => x.id === "second-wind")!;
    assert.equal(shardConsumableAvailable(c, run(), poor), false);
    assert.equal(applyShardConsumable("second-wind", run(), poor).ok, false);
});

test("second wind: arm then revive at half HP, charge consumed", () => {
    const armed = applyShardConsumable("second-wind", run(), char());
    assert.ok(armed.ok && armed.run.secondWindArmed === true);
    if (!armed.ok) return;
    const dead = { ...armed.character, hp: 0, hospitalized: true } as Character;
    const revived = tryHollowGateSecondWind(armed.run, dead);
    assert.ok(revived);
    assert.equal(revived!.character.hp, 100);            // 50% of maxHp 200
    assert.equal(revived!.character.hospitalized, false);
    assert.equal(revived!.run.secondWindArmed, false);
    // no charge -> null
    assert.equal(tryHollowGateSecondWind(revived!.run, dead), null);
});
