import { strict as assert } from "node:assert";
import test from "node:test";
import type { Character } from "../types/character";
import { commitAuthoritativeMissionClaim } from "./versioned-mission-claim";

const current = { name: "Alice", hp: 100, maxHp: 100, ryo: 5, inventory: [] } as Character;
const authoritative = { ...current, hp: 37, ryo: 15 };
const applied = {
    ok: true,
    applied: true,
    reward: { xpBoosted: 0, ryo: 10, stamina: 0, territoryScrolls: 0, currency: {} },
    completion: "daily",
    character: authoritative,
    _saveVersion: 12,
};

test("mission claim commits the exact authoritative character and save version", () => {
    let committedCharacter: Character | undefined;
    let committedVersion: unknown;
    const accepted = commitAuthoritativeMissionClaim(applied, (character, version) => {
        committedCharacter = character;
        committedVersion = version;
        return true;
    });

    assert.equal(accepted, true);
    assert.equal(committedCharacter, authoritative);
    assert.equal(committedVersion, 12);
    assert.equal(committedCharacter?.hp, 37, "the claim cannot replace surviving combat HP with the stale client value");
});

test("a rejected stale authoritative claim never falls through to legacy mirroring", () => {
    let calls = 0;
    const accepted = commitAuthoritativeMissionClaim(applied, () => {
        calls += 1;
        return false;
    });

    assert.equal(accepted, false);
    assert.equal(calls, 1);
});

test("only a response without a character selects the rolling-deploy fallback", () => {
    const legacy = { ...applied, character: undefined, _saveVersion: undefined };
    let called = false;
    assert.equal(commitAuthoritativeMissionClaim(legacy, () => { called = true; return true; }), null);
    assert.equal(called, false);

});
