import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySoloPveAction, endSoloPveTurn } from '../solo-pve/_engine.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import { buildHollowGateProfile } from './_encounter.js';
import { createHollowGateCombatBinding } from './_combat-session.js';
import type { HollowGateRunToken } from './_run-token.js';

const stats = { strength: 200, speed: 200, intelligence: 200, willpower: 200, bukijutsuOffense: 200, bukijutsuDefense: 200, taijutsuOffense: 200, taijutsuDefense: 200, genjutsuOffense: 200, genjutsuDefense: 200, ninjutsuOffense: 200, ninjutsuDefense: 200 };
const fighter = (name: string, pos: number) => ({ name, hp: 1_000, maxHp: 1_000, chakra: 1_000, maxChakra: 1_000, stamina: 1_000, maxStamina: 1_000, shield: 0, statuses: [], character: { name, level: 30, specialty: 'Taijutsu', stats, jutsu: [], jutsuMastery: [] }, pos });
function session(metadata?: Record<string, string | number | boolean | null>): SoloPveSession {
    return createSoloPveSession({
        sessionId: `test-${metadata?.floor ?? 'plain'}-${metadata?.combatKind ?? 'generic'}`,
        ownerSlug: 'player',
        encounter: metadata ? { kind: 'hollow-gate', id: 'gate', bindingId: 'binding', metadata } : { kind: 'test', id: 'plain' },
        player: fighter('player', 62), enemy: fighter('hound', 63), now: 1_000,
    });
}

test('Hollow Gate lane multipliers are enforced by the Solo PvE engine', () => {
    const plain = applySoloPveAction(session(), { type: 'basicAttack' }).session;
    const lantern = applySoloPveAction(session({ floor: 2, combatKind: 'battle', nodeId: 'floor:2:tile:1' }), { type: 'basicAttack' }).session;
    const darkSource = session({ floor: 2, combatKind: 'battle', nodeId: 'floor:2:tile:1' });
    darkSource.round = 2;
    const dark = applySoloPveAction(darkSource, { type: 'basicAttack' }).session;
    const plainDamage = 1_000 - plain.enemy.hp;
    assert.ok(1_000 - lantern.enemy.hp > plainDamage, 'Lanternlight boosts server damage');
    assert.ok(1_000 - dark.enemy.hp < plainDamage, 'Veil-Slip reduces server damage');
});

test('Hollow Gate hazards and Berserker retreat restrictions resolve on the server', () => {
    const hazard = session({ floor: 1, combatKind: 'battle', nodeId: 'floor:1:tile:1' });
    hazard.round = 3;
    hazard.activeSide = 'enemy';
    hazard.player.pos = 0;
    endSoloPveTurn(hazard);
    assert.equal(hazard.player.hp, 960);
    assert.match(hazard.log.at(-2) ?? hazard.log.at(-1) ?? '', /Cinder Pounce|Round 4/);

    const sealed = session({ floor: 5, combatKind: 'boss', nodeId: 'floor:5:tile:1', noRetreat: true });
    const fled = applySoloPveAction(sealed, { type: 'flee' }, { escapeSucceeds: () => true });
    assert.equal(fled.applied, false);
    assert.equal(fled.reason, 'retreat-sealed');
    assert.equal(fled.session.status, 'active');
});

test('Hollow Gate profile scaling and augments are derived from the sealed run token', () => {
    const binding = createHollowGateCombatBinding({ playerName: 'player', token: 'sealed-token', floor: 5, nodeId: 'floor:5:tile:8', kind: 'boss', runId: 'hg-profile' });
    const base: HollowGateRunToken = { playerName: 'player', mintedAt: 1, floorDepth: 5, currentFloor: 5, seed: 'seed', entryCurrencies: {}, offeredAugmentIds: [], chosenAugmentId: null, dailyRunOrdinal: 1, bossName: 'The Remembered Alpha' };
    const plain = buildHollowGateProfile({ binding, run: base, playerLevel: 40 });
    const greedy = buildHollowGateProfile({ binding, run: { ...base, chosenAugmentId: 'greedy-pact' }, playerLevel: 40 });
    assert.equal(plain.name, 'The Remembered Alpha');
    assert.equal(plain.level, 55);
    assert.equal(plain.jutsuIds instanceof Array, true);
    assert.ok(Number(greedy.hp) > Number(plain.hp));
    assert.ok(Number((greedy.stats as Record<string, number>).strength) > Number((plain.stats as Record<string, number>).strength));
});
