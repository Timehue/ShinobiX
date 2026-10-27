import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSave, comparisonSquad, compareTower } from './tower-pve-comparison.js';
import { buildTowerEncounter } from '../api/towers/_encounter.js';
import { getFloor } from '../api/towers/_floor-catalog.js';
import { applyAction, type TowerAction } from '../api/towers/_engine.js';

test('the Tower comparison preserves the recent PvE pass strong twelve-slot and prepared midgame fixtures', () => {
    for (const fixture of ['prepared75-rotation', 'prepared75-sustain'] as const) {
        const save = comparisonSave(75, fixture);
        assert.equal(save.character.earnedStatPoints, 17711);
        assert.equal(save.character.equippedJutsuIds.length, 12);
        for (const actor of comparisonSquad(75, fixture)) {
            assert.equal((actor.character.jutsu as unknown[]).length, 12);
            assert.equal(actor.character.bloodlineMult, 1.2);
            assert.ok(Math.abs(Number(actor.character.armorRawDR) - .35) < 1e-9);
        }
    }
    assert.throws(() => comparisonSave(70, 'prepared75-rotation'), /level75/);
    for (const actor of comparisonSquad(100, 'optimized')) {
        assert.equal(actor.character.bloodlineMult, 1.2);
        assert.equal((actor.character.jutsu as unknown[]).length, 12);
        assert.equal((actor.character.stats as Record<string, number>).ninjutsuOffense, 2500);
    }
});

test('prepared PvE endgame squads retain legal clears and individual health pressure in upper Towers', () => {
    for (const floor of [14, 15]) {
        const rows = Array.from({ length: 5 }, (_, seed) => compareTower(floor, seed, 'optimized'));
        assert.ok(rows.filter(row => row.winner === 'squad').length >= 4, JSON.stringify(rows));
        assert.ok(rows.every(row => row.refusedEnemy === 0), 'AI must execute the actions it chooses in these controls');
        const minimumMemberHp = rows.reduce((sum, row) => sum + Math.min(...Object.values(row.minimumMemberHp)), 0) / rows.length;
        assert.ok(minimumMemberHp < (floor === 14 ? .8 : .5), `floor ${floor}: individual minimum ${minimumMemberHp}`);
        const rounds = rows.reduce((sum, row) => sum + row.rounds, 0) / rows.length;
        assert.ok(rounds >= 14 && rounds <= 24, `floor ${floor}: pacing ${rounds}`);
    }
});

test('the stronger PvE training and legal Tower gear do not one-shot ordinary upper-floor openings', () => {
    for (const floorId of [1, 5, 9, 12, 13, 14, 15]) for (const towerGear of [false, true]) {
        const floor = getFloor(floorId)!;
        const base = buildTowerEncounter({ floor, squad: comparisonSquad(floor.recommendedLevel!, 'optimized', towerGear),
            partySize: 4, runId: 'pve-opening-check', seed: 101, now: 0 });
        const player = base.actors.find(a => a.side === 'squad')!;
        const enemies = [...base.actors, ...(base.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)]
            .filter(a => a.side === 'enemy' && a.id !== base.phaseState.bossId);
        const hand = (player.character.equipment as Record<string, string>).hand;
        const attacks: TowerAction[] = [{ actorId: player.id, type: 'weapon', itemId: hand, targetId: '' },
            ...(player.character.jutsu as Array<{ id: string; effectPower?: number; target?: string }>).
                filter(j => Number(j.effectPower) > 0 && !['SELF', 'EMPTY_GROUND'].includes(String(j.target))).
                map(j => ({ actorId: player.id, type: 'jutsu' as const, jutsuId: j.id, targetId: '' }))];
        for (const enemy of enemies) for (const attack of attacks) {
            const session = structuredClone(base), caster = structuredClone(player), target = structuredClone(enemy);
            caster.pos = 0; target.pos = 1;
            const authoredHp = target.maxHp;
            target.hp = target.maxHp = 1_000_000;
            session.actors = [caster, target]; session.pendingEnemyWaves = [];
            session.map.features = []; session.map.boardObjects = []; session.map.blockedTiles = [];
            session.round = 1; session.turnQueue = [caster.id]; session.activeIndex = 0; session.activeAp = 100;
            const result = applyAction(session, floor, { ...attack, targetId: target.id } as TowerAction, () => .5);
            assert.ok(result.applied, JSON.stringify({ floorId, attack, result }));
            assert.ok(target.maxHp - target.hp < authoredHp, JSON.stringify({ floorId, towerGear, attack, target: target.name, authoredHp }));
        }
    }
});
