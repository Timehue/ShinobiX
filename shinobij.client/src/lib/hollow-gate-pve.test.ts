import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHollowGateCombatReward } from "./hollow-gate-pve";

test("Hollow Gate formats only the server settlement receipt", () => {
    assert.equal(formatHollowGateCombatReward({ ok: true, won: true, reward: { ryo: 500, hollowShards: 20, fragments: 2 }, elementalShards: 1 }), "+500 ryo, +20 Hollow Shards, +2 Legendary Fragment, +1 Elemental Shard");
    assert.equal(formatHollowGateCombatReward({ ok: true, won: false }), "");
});

test("a won threat ambush names its place against the run's paid-ambush cap (owner A9)", () => {
    assert.equal(formatHollowGateCombatReward({ ok: true, won: true, reward: { auraDust: 10 }, ambushPurse: { ordinal: 17, paidCap: 16, paid: false } }),
        "+10 Aura Dust, this run's 16 paid ambushes are spent, dust only");
    assert.equal(formatHollowGateCombatReward({ ok: true, won: true, reward: { ryo: 485, auraDust: 10 }, ambushPurse: { ordinal: 3, paidCap: 16, paid: true } }),
        "+485 ryo, +10 Aura Dust, paid ambush 3 of 16 this run");
});
