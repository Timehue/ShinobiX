import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ACADEMY_SPAR_HP,
    ACADEMY_SPAR_JUTSU_IDS,
    ACADEMY_SPAR_LEVEL,
    ACADEMY_SPAR_POOL,
    ACADEMY_SPAR_STATS,
    academySparEnemyTemplate,
} from "../api/story/_academy-spar";
import {
    academySparJutsuIds,
    buildAcademySparDummy,
    ACADEMY_SPAR_HP as CLIENT_HP,
    ACADEMY_SPAR_LEVEL as CLIENT_LEVEL,
} from "../shinobij.client/src/lib/academy-spar";

/*
 * Cross-build-root parity for the onboarding sparring dummy — the first
 * subsystem of step 5 of the AI-fight migration
 * (docs/runbooks/combat-mode-migration.md).
 *
 * The Academy spar now has TWO opponents that must be the same opponent: the
 * server builds the sealed one from api/story/_academy-spar.ts constants, and
 * the client still builds the local-fallback one from lib/academy-spar.ts. The
 * server half deliberately hardcodes its numbers rather than importing the
 * client's (the api/ build root cannot reach into shinobij.client/, which is
 * why api/_ai-profile-catalog.ts is a generated mirror) — so THIS test is what
 * stops them drifting.
 *
 * Drift here is not a rounding detail. The spar is the guaranteed first win of
 * a brand-new account: a dummy with more HP or a real stat sheet turns a
 * sub-60-second teaching bout into a fight a level-1 player can lose.
 *
 * Lives under scripts/ because it imports from BOTH roots; the test runner
 * scans that directory, so it needs no registration.
 */

test("the sealed dummy and the local-fallback dummy are the same opponent", () => {
    const local = buildAcademySparDummy({ id: "temp-academy-spar-1700000000000", village: "Stormveil Village" });

    assert.equal(ACADEMY_SPAR_LEVEL, CLIENT_LEVEL, "level drift");
    assert.equal(ACADEMY_SPAR_LEVEL, local.level, "server level does not match the built dummy");
    assert.equal(ACADEMY_SPAR_HP, CLIENT_HP, "hp constant drift");
    assert.equal(ACADEMY_SPAR_HP, local.hp, "server hp does not match the built dummy");
    assert.equal(ACADEMY_SPAR_POOL, local.chakra, "chakra pool drift");
    assert.equal(ACADEMY_SPAR_POOL, local.stamina, "stamina pool drift");
    assert.deepEqual(ACADEMY_SPAR_JUTSU_IDS, academySparJutsuIds, "loadout drift — the server mirrors the client's first two balanced jutsu");
    assert.deepEqual(ACADEMY_SPAR_JUTSU_IDS, local.jutsuIds, "the built dummy no longer carries the mirrored ids");

    // Every stat, both directions — an extra key on either side is drift too.
    assert.deepEqual(
        Object.keys(ACADEMY_SPAR_STATS).sort(),
        Object.keys(local.stats).sort(),
        "stat key sets differ",
    );
    for (const [key, value] of Object.entries(local.stats as Record<string, number>)) {
        assert.equal(ACADEMY_SPAR_STATS[key], value, `${key} drift (client ${value}, server ${ACADEMY_SPAR_STATS[key]})`);
    }
});

test("the sealed template stays a level-1 pushover, not a scaled enemy", () => {
    const template = academySparEnemyTemplate(null);
    assert.equal(template.level, 1);
    assert.equal(template.hp, 50);
    assert.equal(template.armorRawDR, 0, "armor would blunt the teaching hits");
    // The unguarded precondition that keeps this test honest: a generic level-1
    // mission enemy carries 180+ offense and 250+ HP. If the dummy ever climbs
    // toward that curve the assertions above stop describing a tutorial.
    const highestStat = Math.max(...Object.values(template.stats as Record<string, number>));
    assert.ok(highestStat < 30, `dummy stats climbed to ${highestStat} — that is mission-enemy territory, not a training dummy`);
});

test("the sealed dummy actually resolves its jutsu (an unarmed dummy teaches nothing)", () => {
    const template = academySparEnemyTemplate(null);
    assert.equal(template.jutsu.length, ACADEMY_SPAR_JUTSU_IDS.length, "a mirrored id no longer resolves in the server jutsu catalog");
    for (const id of ACADEMY_SPAR_JUTSU_IDS) {
        assert.ok(template.jutsu.some((jutsu) => jutsu.id === id), `${id} dropped out of the resolved loadout`);
    }
});
