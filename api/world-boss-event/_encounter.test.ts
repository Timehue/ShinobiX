import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBossTeamEncounter, worldBossFloor, worldBossMatchHpForParty } from './_encounter';
import { WORLD_BOSS_DEFINITIONS, worldBossGuardVisual } from '../../shared/world-boss-event';
import { computeDamage, applyAction, startRound } from '../towers/_engine';
import { makeRng } from '../towers/_sim';

test('each world boss is sealed with its own defensive Tower mechanic', () => {
    const hollowBeast = worldBossFloor('hollow-beast', 'Chicxulub');
    assert.equal(hollowBeast.boss?.mechanic, 'regen');
    assert.deepEqual(hollowBeast.boss?.strike, { kind: 'nova', pct: 14, radius: 2, everyRounds: 2 });

    const bullGuardian = worldBossFloor('hollow-gate-bull', 'Murogane');
    assert.equal(bullGuardian.boss?.mechanic, 'bulwark');
    assert.deepEqual(bullGuardian.boss?.strike, { kind: 'slam', pct: 14, radius: 1, everyRounds: 2 });
    assert.equal(bullGuardian.enemies.reduce((count, enemy) => count + enemy.count, 0), 2);

    const mazeWarden = worldBossFloor('hollow-maze-minotaur', 'Donkaku');
    assert.deepEqual(mazeWarden.boss?.phases, [75, 50, 25]);
    assert.deepEqual(mazeWarden.boss?.aegis, { shieldPct: 10 });
    assert.deepEqual(mazeWarden.boss?.strike, { kind: 'volley', pct: 14, radius: 1, everyRounds: 2 });
});

function encounter(bossId: typeof WORLD_BOSS_DEFINITIONS[number]['id'], partySize = 1, hollowShardsDeposited = 0) {
    return buildWorldBossTeamEncounter({
        event: { eventId: 'test-event', bossId, bossName: 'Test Boss', hp: 600_000, hollowShardsDeposited },
        matchId: 'test-match', runId: 'test-run', seed: 42, now: 1000,
        squad: Array.from({ length: partySize }, (_, i) => ({
            id: `sq-${i}`, name: `Player ${i}`, ownerSlug: `player-${i}`, ai: false,
            character: { level: 100, specialty: 'Taijutsu', maxHp: 12_000, maxChakra: 1000, maxStamina: 1000,
                stats: { taijutsuOffense: 2500, taijutsuDefense: 2500, strength: 1000, speed: 1000 }, armorRawDR: 0.25 },
        })),
    });
}

test('all raids seal matching broodguards with smaller HP and real attack kits', () => {
    for (const definition of WORLD_BOSS_DEFINITIONS) for (const size of [1, 2, 3]) {
        const session = encounter(definition.id, size);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        const guards = session.actors.filter(actor => actor.side === 'enemy' && actor.id !== boss.id);
        assert.equal(boss.maxHp, 28_000 * size);
        assert.equal(boss.character.towerDmgScale, 1, 'solo/duo bosses must not inherit Tower damage discounts');
        assert.equal(guards.length, 2);
        for (const guard of guards) {
            assert.equal(guard.character.visual, worldBossGuardVisual(definition.id));
            assert.ok(guard.maxHp >= 1800 && guard.maxHp < boss.maxHp);
            assert.ok(Array.isArray(guard.character.jutsu) && guard.character.jutsu.length > 0);
        }
    }
});

test('a boss signature damages a defended endgame player through the actual action resolver', () => {
    for (const definition of WORLD_BOSS_DEFINITIONS) {
        const session = encounter(definition.id);
        const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
        const player = session.actors.find(actor => actor.side === 'squad')!;
        // Remove other targets and put the player in authored signature range.
        session.actors = [boss, player];
        boss.pos = 144;
        player.pos = 142;
        startRound(session);
        session.activeIndex = session.turnQueue.indexOf(boss.id);
        session.activeAp = 100;
        const result = applyAction(session, session.encounterFloor!, { actorId: boss.id, type: 'jutsu', jutsuId: 'world-boss-quake', targetId: player.id }, makeRng(42));
        assert.equal(result.applied, true, JSON.stringify(result));
        const lost = player.maxHp - player.hp;
        assert.ok(lost >= 1200 && lost < 4800, `${definition.name}: ${lost} damage should threaten without one-shotting`);
    }
});

test('crystal weakening still reduces boss damage for solo, duo and trio raids', () => {
    for (const size of [1, 2, 3]) {
        const full = encounter('hollow-maze-minotaur', size);
        const weak = encounter('hollow-maze-minotaur', size, 60);
        const boss = full.actors.find(actor => actor.id === full.phaseState.bossId)!;
        const weakenedBoss = weak.actors.find(actor => actor.id === weak.phaseState.bossId)!;
        const jutsu = (boss.character.jutsu as Array<{ effectPower: number; type: string }>)[0]!;
        const damage = computeDamage(boss, full.actors[0]!, jutsu, 0);
        const weakenedDamage = computeDamage(weakenedBoss, weak.actors[0]!, jutsu, 0);
        assert.equal(weakenedBoss.character.towerDmgScale, 0.5);
        assert.ok(Math.abs(weakenedDamage - damage / 2) <= 1);
    }
});

test('world boss match HP budget scales to solo, duo, and trio size without exceeding shared HP', () => {
    assert.equal(worldBossMatchHpForParty(200_000, 1), 28_000);
    assert.equal(worldBossMatchHpForParty(200_000, 2), 56_000);
    assert.equal(worldBossMatchHpForParty(200_000, 3), 84_000);
    assert.equal(worldBossMatchHpForParty(42_000, 3), 42_000);
});
