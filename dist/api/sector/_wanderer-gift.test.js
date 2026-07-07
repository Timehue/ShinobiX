"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wanderer_gift_js_1 = require("./_wanderer-gift.js");
const _wanderer_encounter_js_1 = require("./_wanderer-encounter.js");
(0, node_test_1.describe)("rollWandererGift", () => {
    (0, node_test_1.it)("rolls 0–1 fate shards, 1–5 bone charms, and positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = (0, _wanderer_gift_js_1.rollWandererGift)(40, r);
            node_assert_1.strict.ok(g.fateShards === 0 || g.fateShards === 1, `shards ${g.fateShards}`);
            node_assert_1.strict.ok(g.boneCharms >= 1 && g.boneCharms <= 5, `charms ${g.boneCharms}`);
            node_assert_1.strict.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    (0, node_test_1.it)("fate shard is occasional (low rng grants 1, mid rng grants 0)", () => {
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(40, () => 0).fateShards, 1);
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(40, () => 0.5).fateShards, 0);
    });
    (0, node_test_1.it)("ryo scales with level but stays modest", () => {
        const lo = (0, _wanderer_gift_js_1.rollWandererGift)(1, () => 0.5);
        const hi = (0, _wanderer_gift_js_1.rollWandererGift)(100, () => 0.5);
        node_assert_1.strict.ok(hi.ryo > lo.ryo);
        node_assert_1.strict.ok(hi.ryo <= 1500, "ryo stays small");
    });
    (0, node_test_1.it)("clamps junk level", () => {
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(0, () => 0).ryo, (0, _wanderer_gift_js_1.rollWandererGift)(1, () => 0).ryo);
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(9999, () => 0).ryo, (0, _wanderer_gift_js_1.rollWandererGift)(100, () => 0).ryo);
    });
});
(0, node_test_1.describe)("decideWandererGift", () => {
    (0, node_test_1.it)("allows up to the daily cap, then blocks", () => {
        for (let i = 0; i < _wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY; i++)
            node_assert_1.strict.equal((0, _wanderer_gift_js_1.decideWandererGift)(i).ok, true);
        const d = (0, _wanderer_gift_js_1.decideWandererGift)(_wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY);
        node_assert_1.strict.equal(d.ok, false);
        if (!d.ok)
            node_assert_1.strict.equal(d.reason, "daily-cap");
    });
});
(0, node_test_1.describe)("wanderer encounter cooldown", () => {
    (0, node_test_1.it)("recognizes only natural road wanderer ids", () => {
        node_assert_1.strict.deepEqual((0, _wanderer_encounter_js_1.parseNaturalWandererId)("w-12-345-1"), { sector: 12, dayBucket: 345, index: 1 });
        node_assert_1.strict.equal((0, _wanderer_encounter_js_1.parseNaturalWandererId)("legacy-sage"), null);
        node_assert_1.strict.equal((0, _wanderer_encounter_js_1.parseNaturalWandererId)("legacy-emissary-hollow-warden"), null);
        node_assert_1.strict.equal((0, _wanderer_encounter_js_1.parseNaturalWandererId)("merc-abc"), null);
    });
    (0, node_test_1.it)("moves a used wanderer to a different sector and stamps the save cooldown", () => {
        const now = 10_000;
        const used = (0, _wanderer_encounter_js_1.withWandererUseState)({ wandererCooldowns: { stale: now - 1 } }, "w-7-1-0", now, 7);
        node_assert_1.strict.equal(used.cooldownUntil, now + _wanderer_encounter_js_1.WANDERER_ENCOUNTER_COOLDOWN_MS);
        node_assert_1.strict.equal((0, _wanderer_encounter_js_1.currentWandererCooldownUntil)(used.character, "w-7-1-0", now), used.cooldownUntil);
        node_assert_1.strict.notEqual(used.moveToSector, 7);
        node_assert_1.strict.equal(used.character.wandererMoves["w-7-1-0"], used.moveToSector);
        node_assert_1.strict.equal("stale" in used.character.wandererCooldowns, false);
    });
    (0, node_test_1.it)("relocation is deterministic and never chooses the source sector", () => {
        const a = (0, _wanderer_encounter_js_1.wandererRelocationSector)("w-7-1-0", 12);
        const b = (0, _wanderer_encounter_js_1.wandererRelocationSector)("w-7-1-0", 12);
        node_assert_1.strict.equal(a, b);
        node_assert_1.strict.ok(a >= 1 && a <= 60);
        node_assert_1.strict.notEqual(a, 12);
    });
    (0, node_test_1.it)("hard cooldown claim blocks replay of the same wanderer id", async () => {
        const store = new Map();
        const kv = {
            async get(key) { return (store.get(key) ?? null); },
            async set(key, value, opts) {
                if (opts?.nx && store.has(key))
                    return null;
                store.set(key, value);
                return "OK";
            },
        };
        const first = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(kv, "aki", "w-7-1-0", 1_000);
        node_assert_1.strict.equal(first.ok, true);
        const second = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(kv, "aki", "w-7-1-0", 1_001);
        node_assert_1.strict.equal(second.ok, false);
        if (!second.ok)
            node_assert_1.strict.equal(second.reason, "cooldown");
        const legacy = await (0, _wanderer_encounter_js_1.claimWandererUseCooldown)(kv, "aki", "legacy-sage", 1_002);
        node_assert_1.strict.equal(legacy.ok, false);
        if (!legacy.ok)
            node_assert_1.strict.equal(legacy.reason, "invalid-wanderer");
    });
});
