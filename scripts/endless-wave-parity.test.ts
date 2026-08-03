import { test } from "node:test";
import assert from "node:assert/strict";
import { endlessScaleFactor as serverFactor } from "../api/endless/_run";
import { scaleEndlessProfile, type EndlessProfile } from "../api/endless/_wave-opponent";
import { endlessScaleFactor as clientFactor, scaleEndlessAiClone } from "../shinobij.client/src/lib/endless-tower";
import type { CreatorAi } from "../shinobij.client/src/types/creator-ai";

/*
 * Cross-build-root parity for the Endless Tower wave math — step 5 subsystem 2
 * of the AI-fight migration.
 *
 * Endless already ran the SAME numbers on both sides before this: the client
 * banks a predicted reward while api/endless/_run.ts recomputes the real one, so
 * `endlessScaleFactor` has been duplicated across the build-root boundary for a
 * long time with NOTHING pinning the copies together. Subsystem 2 puts a second
 * duplicate next to it (`scaleEndlessProfile` mirrors `scaleEndlessAiClone`), so
 * both get a guard here.
 *
 * ⚠ What this does NOT assert, deliberately: that the two sides PICK the same
 * opponent. The client draws from its own roster (built-ins plus admin-authored
 * creatorAis); the server draws from the generated catalog. Making them agree
 * would mean trusting the client's roster, which is the authority the migration
 * removes. The server's pick is authoritative and the client renders what it is
 * handed. Only the arithmetic has to match.
 */

const BASE: CreatorAi = {
    id: "builtin-ai-academy-sparring",
    name: "Sparring Partner",
    icon: "🥋",
    level: 20,
    village: "Stormveil Village",
    hp: 2400,
    chakra: 1800,
    stamina: 1700,
    stats: {
        strength: 310, speed: 305, intelligence: 288, willpower: 291,
        bukijutsuOffense: 260, taijutsuOffense: 415, genjutsuOffense: 244, ninjutsuOffense: 251,
        bukijutsuDefense: 302, taijutsuDefense: 377, genjutsuDefense: 288, ninjutsuDefense: 295,
    },
    jutsuIds: ["starter-tai-fire-2", "starter-nin-earth-1"],
    rules: [],
};

test("the scale factor is identical on both sides, wave 1..200", () => {
    for (let wave = 1; wave <= 200; wave++) {
        assert.equal(serverFactor(wave), clientFactor(wave), `factor drift at wave ${wave}`);
    }
});

test("the scaled clone is identical on both sides, every field", () => {
    // Waves chosen to straddle every discontinuity: the 5s and 10s milestone
    // bumps, and the waves where each cap (stats x4, hp x5, pools x3) engages.
    for (const wave of [1, 2, 4, 5, 9, 10, 11, 15, 20, 25, 30, 40, 50, 75, 100, 137, 200]) {
        const client = scaleEndlessAiClone(BASE, wave);
        const server = scaleEndlessProfile(BASE as unknown as EndlessProfile, wave);
        assert.equal(server.id, client.id, `id drift at wave ${wave}`);
        assert.equal(server.name, client.name, `display name drift at wave ${wave}`);
        assert.equal(server.hp, client.hp, `hp drift at wave ${wave}`);
        assert.equal(server.chakra, client.chakra, `chakra drift at wave ${wave}`);
        assert.equal(server.stamina, client.stamina, `stamina drift at wave ${wave}`);
        assert.deepEqual(server.stats, client.stats as unknown as Record<string, number>, `stat drift at wave ${wave}`);
    }
});

test("the caps really engage in the range tested — otherwise the test above is vacuous", () => {
    // Unguarded precondition. Scaling is capped at x4 stats / x5 hp / x3 pools,
    // and if every wave sampled sat below those caps this file would pass even
    // if one side dropped its caps entirely.
    const deep = scaleEndlessProfile(BASE as unknown as EndlessProfile, 200);
    assert.equal(deep.hp, BASE.hp * 5, "hp cap never reached — raise the deepest wave sampled");
    assert.equal(deep.stats!.strength, Math.floor(BASE.stats.strength * 4), "stat cap never reached");
    assert.equal(deep.chakra, BASE.chakra * 3, "chakra cap never reached");
    const shallow = scaleEndlessProfile(BASE as unknown as EndlessProfile, 1);
    assert.equal(shallow.hp, BASE.hp, "wave 1 must be the unscaled baseline");
});

test("a milestone floor is starred on both sides", () => {
    assert.match(String(scaleEndlessProfile(BASE as unknown as EndlessProfile, 10).name), /^★ /);
    assert.equal(scaleEndlessProfile(BASE as unknown as EndlessProfile, 10).name, scaleEndlessAiClone(BASE, 10).name);
    assert.doesNotMatch(String(scaleEndlessProfile(BASE as unknown as EndlessProfile, 11).name), /^★ /);
});
