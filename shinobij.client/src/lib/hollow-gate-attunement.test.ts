import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun } from "../types/character";
import {
    buyAttunement,
    attunementRank,
    attunementNextCost,
    attunementStartKeys,
    attunementStartWard,
    attunementCartographer,
    attunementDailyBonus,
    attunementLootRetention,
    applyAttunementToRun,
    keyForgeUnlocked,
    forgeHollowGateKey,
    KEY_FORGE_COST,
} from "./hollow-gate-attunement";

const char = (over: Record<string, unknown> = {}): Character =>
    ({ hollowShards: 1000, hollowGateAttunement: {}, ...over }) as unknown as Character;

test("buy deducts shards and increments rank; cost scales with rank", () => {
    let c = char({ hollowShards: 200 });
    assert.equal(attunementNextCost(c, "seasoned-delver"), 30);
    const r1 = buyAttunement(c, "seasoned-delver");
    assert.ok(r1.ok);
    if (!r1.ok) return;
    c = r1.character;
    assert.equal(attunementRank(c, "seasoned-delver"), 1);
    assert.equal(c.hollowShards, 170);
    assert.equal(attunementNextCost(c, "seasoned-delver"), 60); // rank 2 costs base*2
});

test("buy fails when maxed or broke", () => {
    assert.equal(buyAttunement(char({ hollowShards: 5 }), "seasoned-delver").ok, false);   // broke
    const maxed = char({ hollowGateAttunement: { cartographer: 1 } });
    assert.equal(attunementNextCost(maxed, "cartographer"), null);
    assert.equal(buyAttunement(maxed, "cartographer").ok, false);
});

test("effect getters reflect ranks", () => {
    const c = char({ hollowGateAttunement: { "seasoned-delver": 2, "reiki-reserves": 1, cartographer: 1, "greedy-hands": 3, "extra-dive": 1 } });
    assert.equal(attunementStartKeys(c), 2);
    assert.equal(attunementStartWard(c), 3);
    assert.equal(attunementCartographer(c), true);
    assert.equal(attunementDailyBonus(c), 1);
    assert.equal(attunementLootRetention(c), 0.8);       // 0.5 + 0.3, capped
});

test("loot retention defaults to 0.5 with no greedy hands", () => {
    assert.equal(attunementLootRetention(char()), 0.5);
});

test("applyAttunementToRun: first floor grants keys + ward; cartographer reveals descent", () => {
    const c = char({ hollowGateAttunement: { "seasoned-delver": 1, "reiki-reserves": 2, cartographer: 1 } });
    const run = { keys: 0, tiles: [{ kind: "descend", revealed: false }, { kind: "chest", revealed: false }] } as unknown as HollowGateShrineRun;
    const out = applyAttunementToRun(run, c, true);
    assert.equal(out.keys, 1);
    assert.equal(out.wardSteps, 6);                      // 3 * rank 2
    assert.equal(out.tiles[0].revealed, true);           // descend revealed
    assert.equal(out.tiles[1].revealed, false);          // chest untouched
});

test("applyAttunementToRun: later floors skip keys/ward but still reveal descent", () => {
    const c = char({ hollowGateAttunement: { "seasoned-delver": 2, cartographer: 1 } });
    const run = { keys: 1, tiles: [{ kind: "boss", revealed: false }] } as unknown as HollowGateShrineRun;
    const out = applyAttunementToRun(run, c, false);
    assert.equal(out.keys, 1);                           // not re-granted
    assert.equal(out.tiles[0].revealed, true);           // boss/descent revealed
});

test("key forge: locked until attuned, then converts shards into a key", () => {
    const locked = char({ inventory: [], itemStacks: [] });
    assert.equal(keyForgeUnlocked(locked), false);
    assert.equal(forgeHollowGateKey(locked).ok, false);

    const unlocked = char({ hollowGateAttunement: { "key-forge": 1 }, hollowShards: 100, inventory: [], itemStacks: [] });
    assert.equal(keyForgeUnlocked(unlocked), true);
    const r = forgeHollowGateKey(unlocked);
    assert.ok(r.ok);
    if (r.ok) {
        assert.equal(r.character.hollowShards, 100 - KEY_FORGE_COST);
        // a key landed somewhere (inventory[] for uniques, itemStacks[] for stackables)
        const added = (r.character.inventory?.length ?? 0) + (r.character.itemStacks?.length ?? 0);
        assert.ok(added > 0, "a Hollow Gate Key was added to the character");
    }
});

test("key forge: fails when shards are too few", () => {
    const c = char({ hollowGateAttunement: { "key-forge": 1 }, hollowShards: 5, inventory: [], itemStacks: [] });
    assert.equal(forgeHollowGateKey(c).ok, false);
});
