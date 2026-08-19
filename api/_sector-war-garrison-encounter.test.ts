import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySoloPveAction } from './solo-pve/_engine.js';
import {
    buildGarrisonEncounter,
    garrisonSessionMatches,
    GARRISON_MAP,
    GARRISON_ROUND_BUDGET,
    GARRISON_ENCOUNTER_KIND,
    type GarrisonFighter,
} from './_sector-war-garrison-encounter.js';

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);

function fighter(slug: string, name: string, maxHp: number, extra: Record<string, unknown> = {}): GarrisonFighter {
    return {
        slug,
        name,
        character: {
            level: 100,
            specialty: 'Taijutsu',
            maxHp,
            maxChakra: 8_000,
            maxStamina: 8_000,
            stats: { taijutsuOffense: 4_000, taijutsuDefense: 2_000, speed: 1_000, willpower: 1_000 },
            jutsu: [],
            pvpItems: [],
            equipment: {},
            ...extra,
        },
    };
}

function build() {
    return buildGarrisonEncounter({
        runId: 'garrison-test-1',
        now: NOW,
        attacker: { ...fighter('attacker', 'Attacker', 9_000), itemCharges: { kunai: 5, 'soldier-pill': 2 } },
        anbu: fighter('anbu-one', 'The Frostfang Anbu', 12_000),
        terrain: 'forest',
        sector: 12,
        contestId: '12:moonshadowvillage-vs-frostfangvillage',
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
    });
}

test('buildGarrisonEncounter seals a one-human Solo PvE session and exact contest binding', () => {
    const session = build();
    assert.equal(session.runtime, 'solo-pve');
    assert.equal(session.sessionId, 'garrison-test-1');
    assert.equal(session.ownerSlug, 'attacker');
    assert.equal(session.status, 'active');
    assert.equal(session.player.name, 'Attacker');
    assert.equal(session.player.hp, 9_000);
    assert.equal(session.enemy.name, 'The Frostfang Anbu');
    assert.equal(session.enemy.hp, 12_000);
    // The AI side reads real gear/jutsu already resolved onto the character by
    // hydrateCharacterFromSave (the caller's job); this file only seals the
    // sides into a session and marks the enemy for the shared AI logic.
    assert.equal(session.enemy.character.boss, true);
    assert.equal(session.enemy.character.aiTargetMode, 'lowest-hp');
    assert.deepEqual(session.itemCharges, { kunai: 5, 'soldier-pill': 2 });
    assert.equal(session.environment.biome, 'forest');
    assert.deepEqual(session.environment.blockedTiles, []);
    assert.deepEqual(session.encounter, {
        kind: GARRISON_ENCOUNTER_KIND,
        id: '12',
        sourceId: 'anbu-one',
        bindingId: 'garrison-test-1',
        level: 100,
        metadata: {
            sector: 12,
            contestId: '12:moonshadowvillage-vs-frostfangvillage',
            attackerVillage: 'Moonshadow Village',
            defenderVillage: 'Frostfang Village',
            anbuSlug: 'anbu-one',
            terrain: 'forest',
            roundBudget: GARRISON_ROUND_BUDGET,
        },
    });
    // Distinguishable from Anbu Infiltration's session shape even though the
    // two share a builder pattern.
    assert.notEqual(GARRISON_ENCOUNTER_KIND, 'anbu-infiltration');
    assert.equal('actors' in session, false);
    assert.equal('towerId' in session, false);
});

test('attacker and ANBU start on the same row with tight duel spacing', () => {
    const session = build();
    const width = GARRISON_MAP.width;
    const middle = Math.floor(width / 2);
    assert.equal(session.player.pos % width, middle - 2);
    assert.equal(session.enemy.pos % width, middle + 2);
    assert.equal(Math.floor(session.player.pos / width), Math.floor(session.enemy.pos / width));
});

test('builder is deterministic for the same authoritative inputs', () => {
    assert.deepEqual(build(), build());
});

test('garrisonSessionMatches rejects every hostile binding substitution', () => {
    const session = build();
    const run = {
        runId: 'garrison-test-1',
        attackerName: 'attacker',
        sector: 12,
        contestId: '12:moonshadowvillage-vs-frostfangvillage',
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
        anbuSlug: 'anbu-one',
        terrain: 'forest',
    };
    assert.equal(garrisonSessionMatches(run, session), true);
    assert.equal(garrisonSessionMatches({ ...run, runId: 'other' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, attackerName: 'someone-else' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, sector: 13 }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, contestId: '13:x-vs-y' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, attackerVillage: 'Ashen Leaf Village' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, defenderVillage: 'Stormveil Village' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, anbuSlug: 'other-anbu' }, session), false);
    assert.equal(garrisonSessionMatches({ ...run, terrain: 'snow' }, session), false);
    // A finished-but-foreign solo-pve session (e.g. an Anbu Infiltration run
    // reusing the same runId by coincidence) must never satisfy the binding —
    // this is the anti-cheat backbone the resolve endpoint relies on.
    assert.equal(garrisonSessionMatches(run, null), false);
    assert.equal(garrisonSessionMatches(run, { ...session, encounter: { ...session.encounter, kind: 'anbu-infiltration' } }), false);
});

test('shared Solo PvE engine drives the sealed ANBU (the "smart AI") and terminates the duel', () => {
    let session = buildGarrisonEncounter({
        runId: 'garrison-sim',
        now: NOW,
        attacker: fighter('attacker', 'Attacker', 3_000, {
            stats: { taijutsuOffense: 100, taijutsuDefense: 50, speed: 100, willpower: 100 },
        }),
        anbu: fighter('anbu-one', 'The Frostfang Anbu', 12_000),
        terrain: 'snow',
        sector: 12,
        contestId: '12:moonshadowvillage-vs-frostfangvillage',
        attackerVillage: 'Moonshadow Village',
        defenderVillage: 'Frostfang Village',
    });
    let guard = 0;
    while (session.status === 'active' && guard++ < GARRISON_ROUND_BUDGET + 2) {
        const result = applySoloPveAction(session, { type: 'wait' });
        assert.equal(result.applied, true);
        session = result.session;
    }
    assert.equal(session.status, 'done');
    assert.ok(session.outcome);
    assert.ok(session.player.hp < session.player.maxHp, 'the sealed ANBU must act against the idle attacker');
});
