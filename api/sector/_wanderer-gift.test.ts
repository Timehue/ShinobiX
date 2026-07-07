import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { decideWandererGift, rollWandererGift, WANDERER_GIFTS_PER_DAY } from "./_wanderer-gift.js";
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    parseNaturalWandererId,
    wandererRelocationSector,
    withWandererUseState,
    WANDERER_ENCOUNTER_COOLDOWN_MS,
} from "./_wanderer-encounter.js";

describe("rollWandererGift", () => {
    it("rolls 0–1 fate shards, 1–5 bone charms, and positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = rollWandererGift(40, r);
            assert.ok(g.fateShards === 0 || g.fateShards === 1, `shards ${g.fateShards}`);
            assert.ok(g.boneCharms >= 1 && g.boneCharms <= 5, `charms ${g.boneCharms}`);
            assert.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    it("fate shard is occasional (low rng grants 1, mid rng grants 0)", () => {
        assert.equal(rollWandererGift(40, () => 0).fateShards, 1);
        assert.equal(rollWandererGift(40, () => 0.5).fateShards, 0);
    });
    it("ryo scales with level but stays modest", () => {
        const lo = rollWandererGift(1, () => 0.5);
        const hi = rollWandererGift(100, () => 0.5);
        assert.ok(hi.ryo > lo.ryo);
        assert.ok(hi.ryo <= 1500, "ryo stays small");
    });
    it("clamps junk level", () => {
        assert.equal(rollWandererGift(0, () => 0).ryo, rollWandererGift(1, () => 0).ryo);
        assert.equal(rollWandererGift(9999, () => 0).ryo, rollWandererGift(100, () => 0).ryo);
    });
});

describe("decideWandererGift", () => {
    it("allows up to the daily cap, then blocks", () => {
        for (let i = 0; i < WANDERER_GIFTS_PER_DAY; i++) assert.equal(decideWandererGift(i).ok, true);
        const d = decideWandererGift(WANDERER_GIFTS_PER_DAY);
        assert.equal(d.ok, false);
        if (!d.ok) assert.equal(d.reason, "daily-cap");
    });
});

describe("wanderer encounter cooldown", () => {
    it("recognizes only natural road wanderer ids", () => {
        assert.deepEqual(parseNaturalWandererId("w-12-345-1"), { sector: 12, dayBucket: 345, index: 1 });
        assert.equal(parseNaturalWandererId("legacy-sage"), null);
        assert.equal(parseNaturalWandererId("legacy-emissary-hollow-warden"), null);
        assert.equal(parseNaturalWandererId("merc-abc"), null);
    });

    it("moves a used wanderer to a different sector and stamps the save cooldown", () => {
        const now = 10_000;
        const used = withWandererUseState({ wandererCooldowns: { stale: now - 1 } }, "w-7-1-0", now, 7);
        assert.equal(used.cooldownUntil, now + WANDERER_ENCOUNTER_COOLDOWN_MS);
        assert.equal(currentWandererCooldownUntil(used.character, "w-7-1-0", now), used.cooldownUntil);
        assert.notEqual(used.moveToSector, 7);
        assert.equal((used.character.wandererMoves as Record<string, number>)["w-7-1-0"], used.moveToSector);
        assert.equal("stale" in (used.character.wandererCooldowns as Record<string, number>), false);
    });

    it("relocation is deterministic and never chooses the source sector", () => {
        const a = wandererRelocationSector("w-7-1-0", 12);
        const b = wandererRelocationSector("w-7-1-0", 12);
        assert.equal(a, b);
        assert.ok(a >= 1 && a <= 60);
        assert.notEqual(a, 12);
    });

    it("hard cooldown claim blocks replay of the same wanderer id", async () => {
        const store = new Map<string, unknown>();
        const kv = {
            async get<T>(key: string) { return (store.get(key) ?? null) as T | null; },
            async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) {
                if (opts?.nx && store.has(key)) return null;
                store.set(key, value);
                return "OK" as const;
            },
        };
        const first = await claimWandererUseCooldown(kv, "aki", "w-7-1-0", 1_000);
        assert.equal(first.ok, true);
        const second = await claimWandererUseCooldown(kv, "aki", "w-7-1-0", 1_001);
        assert.equal(second.ok, false);
        if (!second.ok) assert.equal(second.reason, "cooldown");
        const legacy = await claimWandererUseCooldown(kv, "aki", "legacy-sage", 1_002);
        assert.equal(legacy.ok, false);
        if (!legacy.ok) assert.equal(legacy.reason, "invalid-wanderer");
    });
});
