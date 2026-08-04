import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHollowGateCombatReward } from "./hollow-gate-pve";

test("Hollow Gate formats only the server settlement receipt", () => {
    assert.equal(formatHollowGateCombatReward({ ok: true, won: true, reward: { ryo: 500, hollowShards: 20, fragments: 2 }, elementalShards: 1 }), "+500 ryo, +20 Hollow Shards, +2 Legendary Fragment, +1 Elemental Shard");
    assert.equal(formatHollowGateCombatReward({ ok: true, won: false }), "");
});
