/*
 * Client-side PvP targeting guard. pvpAffectsOpponent (lib/tags.ts) is what the
 * battle screen uses to decide "auto-cast on me" vs "arm then click the enemy".
 * It MUST agree with the server's affectsOpponent gate (api/pvp/move.ts), or a
 * clicked jutsu can silently do nothing. Cross-root set parity is enforced
 * separately by scripts/pvp-tags-parity.test.mjs; this pins the decision logic.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { pvpAffectsOpponent } from "./tags";
import type { Jutsu } from "../types/combat";

type TagInput = { name: string; percent?: number };
function j(effectPower: number, tags: TagInput[]): Pick<Jutsu, "effectPower" | "tags"> {
    return { effectPower, tags: tags as Jutsu["tags"] };
}

describe("pvpAffectsOpponent — self-cast vs opponent-target decision", () => {
    it("a damaging jutsu always targets the opponent", () => {
        assert.equal(pvpAffectsOpponent(j(30, [])), true);
    });

    it("a pure self-buff (no damage, no opponent tag) is self-cast", () => {
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Absorb", percent: 30 }])), false);
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Shield" }, { name: "Reflect", percent: 30 }])), false);
    });

    it("a pure opponent debuff (no damage) targets the opponent", () => {
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Decrease Damage Given", percent: 30 }])), true);
    });

    it("the mixed self-buff + opponent-debuff case targets the opponent (the old auto-cast bug)", () => {
        // Absorb is a self-buff; Decrease Damage Given hits the opponent. The old
        // client heuristic auto-cast this (self) while the server applied the
        // debuff to the opponent behind a range gate — the classic "clicked but
        // nothing happened" mismatch. Now both arm-then-click the enemy.
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Absorb", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }])), true);
    });

    it("resolves aliases before deciding (Afterburn → Ignition is opponent-affecting)", () => {
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Afterburn", percent: 30 }])), true);
    });

    it("a Siphon-only zero-damage jutsu is self-cast (Siphon is a self-heal, not an opponent tag)", () => {
        // Server strips a never-resolving Siphon from a 0-damage jutsu and never
        // gates it on the opponent, so the client treating it as self is consistent.
        assert.equal(pvpAffectsOpponent(j(0, [{ name: "Vamp", percent: 30 }])), false);
    });
});
