import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { maxedStats } from "./stats";
import { normalizeCharacter } from "./normalize-character";
import { normalizeAdminCharacter } from "./admin-character";

/*
 * Characterization tests for the admin-account wrapper around save hydration.
 *
 * Like normalize-character.test.ts, these pin CURRENT behaviour rather than
 * preferred behaviour: the function shipped inside App.tsx with no direct
 * coverage, because App imports a .webp and node:test could never load it. The
 * drain to lib/ is what makes the rule statable once and testable at all, so
 * these exist to prove the move was behaviour-preserving.
 */

function save(over: Partial<Character>): Character {
    return { name: "tester", ...over } as unknown as Character;
}

describe("normalizeAdminCharacter", () => {
    it("forces maxed stats, nothing unspent, and a finished tutorial for an admin", () => {
        const normalized = normalizeAdminCharacter(save({
            name: "Admin 1",
            unspentStats: 40,
            onboardingStep: "inventory",
        }));

        assert.deepEqual(normalized.stats, maxedStats());
        assert.equal(normalized.unspentStats, 0);
        // Admins are name-gated out of every tutorial surface, so a stored
        // mid-tutorial step must never survive the load.
        assert.equal(normalized.onboardingStep, "done");
    });

    it("applies the same override to the second admin account", () => {
        const normalized = normalizeAdminCharacter(save({ name: "Admin 2", unspentStats: 7 }));
        assert.equal(normalized.unspentStats, 0);
        assert.equal(normalized.onboardingStep, "done");
    });

    it("leaves a player untouched beyond ordinary normalization", () => {
        const player = save({ name: "tester", unspentStats: 12, onboardingStep: "inventory" });

        // Not "some plausible player shape" — byte-identical to what every
        // non-admin load already produces, which is the whole claim of the
        // name gate.
        assert.deepEqual(normalizeAdminCharacter(player), normalizeCharacter(player));
        assert.equal(normalizeAdminCharacter(player).onboardingStep, "inventory");
    });

    it("does not treat an admin-looking name as an admin", () => {
        // isAdminAccountName is an exact match on the two reserved names.
        const impostor = save({ name: "admin 1", unspentStats: 9, onboardingStep: "inventory" });
        assert.equal(normalizeAdminCharacter(impostor).onboardingStep, "inventory");
        assert.notDeepEqual(normalizeAdminCharacter(impostor).stats, maxedStats());
    });
});
