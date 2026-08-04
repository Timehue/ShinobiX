import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySoloPveAction } from './solo-pve/_engine.js';
import {
    buildInfiltrationEncounter,
    biomeForTerrain,
    infiltrationSessionMatches,
    INFILTRATION_MAP,
    INFILTRATION_ROUND_BUDGET,
    type InfiltrationFighter,
} from './_anbu-infiltration-encounter.js';

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);

function fighter(slug: string, name: string, maxHp: number, extra: Record<string, unknown> = {}): InfiltrationFighter {
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
    return buildInfiltrationEncounter({
        runId: 'infil-test-1',
        now: NOW,
        raider: { ...fighter('raider', 'Raider', 9_000), itemCharges: { kunai: 5, 'soldier-pill': 2 } },
        anbu: fighter('anbu-one', 'The Frostfang Anbu', 12_000),
        terrain: 'forest',
        sector: 12,
        targetVillage: 'Frostfang Village',
    });
}

test('biomeForTerrain accepts sealed terrain values and falls back to central', () => {
    assert.equal(biomeForTerrain('forest'), 'forest');
    assert.equal(biomeForTerrain('SNOW'), 'snow');
    assert.equal(biomeForTerrain('volcano'), 'volcano');
    assert.equal(biomeForTerrain('shadow'), 'shadow');
    assert.equal(biomeForTerrain('central'), 'central');
    assert.equal(biomeForTerrain('swamp'), 'central');
    assert.equal(biomeForTerrain(undefined), 'central');
});

test('buildInfiltrationEncounter seals a one-human Solo PvE session and exact raid binding', () => {
    const session = build();
    assert.equal(session.runtime, 'solo-pve');
    assert.equal(session.sessionId, 'infil-test-1');
    assert.equal(session.ownerSlug, 'raider');
    assert.equal(session.status, 'active');
    assert.equal(session.player.name, 'Raider');
    assert.equal(session.player.hp, 9_000);
    assert.equal(session.enemy.name, 'The Frostfang Anbu');
    assert.equal(session.enemy.hp, 12_000);
    assert.equal(session.enemy.character.boss, true);
    assert.equal(session.enemy.character.aiTargetMode, 'lowest-hp');
    assert.deepEqual(session.itemCharges, { kunai: 5, 'soldier-pill': 2 });
    assert.equal(session.environment.biome, 'forest');
    assert.deepEqual(session.environment.blockedTiles, []);
    assert.deepEqual(session.encounter, {
        kind: 'anbu-infiltration',
        id: '12',
        sourceId: 'anbu-one',
        bindingId: 'infil-test-1',
        level: 100,
        metadata: {
            sector: 12,
            targetVillage: 'Frostfang Village',
            anbuSlug: 'anbu-one',
            terrain: 'forest',
            roundBudget: INFILTRATION_ROUND_BUDGET,
        },
    });
    assert.equal('actors' in session, false);
    assert.equal('towerId' in session, false);
});

test('raider and Anbu start on the same row with tight duel spacing', () => {
    const session = build();
    const width = INFILTRATION_MAP.width;
    const middle = Math.floor(width / 2);
    assert.equal(session.player.pos % width, middle - 2);
    assert.equal(session.enemy.pos % width, middle + 2);
    assert.equal(Math.floor(session.player.pos / width), Math.floor(session.enemy.pos / width));
    assert.ok((session.enemy.pos % width) - (session.player.pos % width) <= 5);
});

test('builder is deterministic for the same authoritative inputs', () => {
    assert.deepEqual(build(), build());
});

test('infiltrationSessionMatches rejects every hostile binding substitution', () => {
    const session = build();
    const run = {
        runId: 'infil-test-1',
        raiderSlug: 'raider',
        sector: 12,
        targetVillage: 'Frostfang Village',
        anbuSlug: 'anbu-one',
        terrain: 'forest',
    };
    assert.equal(infiltrationSessionMatches(run, session), true);
    assert.equal(infiltrationSessionMatches({ ...run, runId: 'other' }, session), false);
    assert.equal(infiltrationSessionMatches({ ...run, raiderSlug: 'attacker' }, session), false);
    assert.equal(infiltrationSessionMatches({ ...run, sector: 13 }, session), false);
    assert.equal(infiltrationSessionMatches({ ...run, targetVillage: 'Moonshadow Village' }, session), false);
    assert.equal(infiltrationSessionMatches({ ...run, anbuSlug: 'other-anbu' }, session), false);
    assert.equal(infiltrationSessionMatches({ ...run, terrain: 'snow' }, session), false);
});

test('shared Solo PvE engine drives the sealed Anbu and terminates the duel', () => {
    let session = buildInfiltrationEncounter({
        runId: 'infil-sim',
        now: NOW,
        raider: fighter('raider', 'Raider', 3_000, {
            stats: { taijutsuOffense: 100, taijutsuDefense: 50, speed: 100, willpower: 100 },
        }),
        anbu: fighter('anbu-one', 'The Frostfang Anbu', 12_000),
        terrain: 'snow',
        sector: 12,
        targetVillage: 'Frostfang Village',
    });
    let guard = 0;
    while (session.status === 'active' && guard++ < INFILTRATION_ROUND_BUDGET + 2) {
        const result = applySoloPveAction(session, { type: 'wait' });
        assert.equal(result.applied, true);
        session = result.session;
    }
    assert.equal(session.status, 'done');
    assert.ok(session.outcome);
    assert.ok(session.player.hp < session.player.maxHp, 'the AI defender must act against the idle raider');
});
