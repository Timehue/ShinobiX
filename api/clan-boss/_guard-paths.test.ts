import test from 'node:test';
import assert from 'node:assert/strict';
import { clanBossEncounterFixture } from '../../scripts/_clan-boss-acceptance-fixture.js';
import { applyAction, startRound, checkTowerWinner, runAiUntilHuman, towerNeighbors } from '../towers/_engine.js';
import { companionActor } from '../towers/_companion.js';
import { clanBossGuardMultiplier } from '../../shared/clan-boss-guard.js';

test('shared phases ignore slice thresholds and inherit crossed gates before the first telegraph', () => {
    const fresh = clanBossEncounterFixture(0, 3, 41000, 72000, { pool: 528000, poolMax: 528000 });
    const boss = fresh.session.actors.find(a => a.id === fresh.session.phaseState.bossId)!;
    const threshold = fresh.session.phaseState.pendingPhases[0]!;
    boss.hp = Math.floor(boss.maxHp * (threshold / 100 - .01));
    checkTowerWinner(fresh.session, fresh.floor);
    assert.equal(fresh.session.phaseState.triggeredPhases.length, 0);
    const late = clanBossEncounterFixture(0, 3, 41000, 72000, { pool: 211200, poolMax: 528000 });
    const gates = [...late.session.phaseState.pendingPhases];
    startRound(late.session);
    assert.deepEqual(late.session.phaseState.triggeredPhases, gates.filter(t => t >= 40));
    const enemy = late.session.actors.find(a => a.id === late.session.phaseState.bossId)!;
    const enrage = enemy.character.enrage;
    checkTowerWinner(late.session, late.floor); assert.equal(enemy.character.enrage, enrage);
});
test('guard opening survives JSON restoration and reforms on schedule', () => {
    const f = clanBossEncounterFixture();
    f.session.clanBossGuard!.openThroughRound = 2;
    const restored = JSON.parse(JSON.stringify(f.session)) as typeof f.session;
    assert.equal(clanBossGuardMultiplier(restored.clanBossGuard, 2, restored.phaseState.bossId!), .75);
    restored.round = 3; startRound(restored);
    assert.equal(clanBossGuardMultiplier(restored.clanBossGuard, 3, restored.phaseState.bossId!), .25);
    assert.deepEqual(restored.clanBossGuard!.contributors, []);
});
test('boss-only mitigation covers primary and secondary AoE victims without shielding adds', () => {
    for (const primaryBoss of [false, true]) {
        const results: Array<{ boss: number; add: number }> = [];
        for (const guarded of [false, true]) {
            const f = clanBossEncounterFixture(), s = f.session;
            if (!guarded) s.clanBossGuard = undefined;
            const boss = s.actors.find(a => a.id === s.phaseState.bossId)!, add = s.actors.find(a => a.side === 'enemy' && a !== boss)!;
            const player = s.actors.find(a => a.side === 'squad')!;
            for (const a of s.actors) { a.statuses = []; a.shield = 0; }
            s.map.width = 16; s.map.height = 10; s.map.blockedTiles = []; s.map.features = []; s.towerTactics = undefined;
            boss.pos = 70; add.pos = 71; player.pos = 68; add.hp = add.maxHp = 10000;
            const jutsu = { id: 'aoe-engine-fixture', name: 'AoE fixture', type: 'Ninjutsu', method: 'AOE_BURST', ap: 60, range: 4, effectPower: 36, tags: [] };
            player.character.jutsu = [jutsu]; player.character.jutsuMastery = [{ jutsuId: jutsu.id, level: 50 }];
            s.turnQueue = [player.id]; s.activeIndex = 0; s.activeAp = 100; s.actionsThisTurn = 0;
            const before = { boss: boss.hp, add: add.hp };
            assert.ok(applyAction(s, f.floor, { actorId: player.id, type: 'jutsu', jutsuId: jutsu.id, targetId: primaryBoss ? boss.id : add.id }, () => .5).applied);
            results.push({ boss: before.boss - boss.hp, add: before.add - add.hp });
        }
        assert.ok(results[0]!.boss > 0 && results[0]!.add > 0);
        assert.ok(Math.abs(results[1]!.boss / results[0]!.boss - .25) < .02);
        assert.equal(results[0]!.add, results[1]!.add);
    }
});
test('actual companion turn applies guard before owner lifesteal and Wound; pets do not charge teamwork', () => {
    const results: Array<{ damage: number; heal: number; wound: number }> = [];
    for (const mode of ['plain', 'clan', 'world']) {
        const guarded = mode === 'clan';
        const f = clanBossEncounterFixture(0, 1), s = f.session;
        if (!guarded) s.clanBossGuard = undefined;
        if (mode === 'world') { s.towerId = 'world-boss-event'; s.worldBossEvent = { bossDamageReceivedMultiplier: 1.5 } as never; }
        const boss = s.actors.find(a => a.id === s.phaseState.bossId)!, owner = s.actors.find(a => a.side === 'squad')!;
        for (const a of s.actors) { a.statuses = []; a.shield = 0; if (a.side === 'enemy' && a !== boss) a.hp = 0; }
        s.map.features = []; s.map.blockedTiles = []; s.map.hazardTiles = [];
        const adjacent = towerNeighbors(boss.pos, s.map.width, s.map.height)[0]!;
        const pet = companionActor({ petId: 'fixture-pet', name: 'Fixture Pet', hp: 300, damage: 400,
            happiness: 100, loyal: true, pveGearId: 'pve-sanguine-charm', moves: [{ name: 'Bleed', kind: 'wound', power: 60, cooldown: 2, rounds: 2, signature: false }] }, adjacent);
        s.actors.push(pet); owner.hp -= 2000;
        s.turnQueue = [pet.id, owner.id, boss.id]; s.activeIndex = 0; s.activeAp = 100; s.actionsThisTurn = 0;
        const before = { hp: boss.hp, owner: owner.hp };
        runAiUntilHuman(s, f.floor, () => .9);
        const wound = boss.statuses.find(v => v.name === 'Wound');
        results.push({ damage: before.hp - boss.hp, heal: owner.hp - before.owner, wound: Number(wound?.amount ?? 0) });
        if (guarded) assert.deepEqual(s.clanBossGuard!.contributors, []);
    }
    assert.ok(results[0]!.damage > 0 && results[1]!.damage > 0, JSON.stringify(results));
    assert.ok(Math.abs(results[1]!.damage / results[0]!.damage - .25) < .02);
    assert.ok(results[1]!.heal > 0 && results[1]!.heal < results[0]!.heal);
    assert.ok(Math.abs(results[1]!.wound / results[0]!.wound - .25) < .04);
    assert.deepEqual(results[2], results[0], 'clan guard work does not add World Boss bonuses to real pet turns');
});
