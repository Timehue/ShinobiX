import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSoloPveSession } from './_session.js';
import { applySoloPveAction, endSoloPveTurn, runSoloPveAiUntilPlayer } from './_engine.js';
import { applyDoTs } from '../pvp/move.js';
import type { PvpFighter } from '../pvp/session.js';
import { damageCombatHealth } from '../combat-core/health.js';

function fighter(name: string, pos: number): PvpFighter {
    return { name, pos, hp: 10, maxHp: 10, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 0, statuses: [],
        character: { level: 100, specialty: 'Taijutsu', stats: { taijutsuOffense: 1200, taijutsuDefense: 0 }, jutsu: [], pvpItems: [], equipment: {} } };
}
function weekly() {
    return createSoloPveSession({ sessionId: 'weekly-score', ownerSlug: 'alice', now: 100,
        encounter: { kind: 'weekly-boss', id: 'week' }, player: fighter('Alice', 62),
        enemy: fighter('Boss', 63), weeklyBossRoundBudget: 20 });
}
test('weekly overkill never defeats the boss and damage keeps accumulating across actions', () => {
    let session = weekly();
    for (let i = 0; i < 2; i++) {
        const result = applySoloPveAction(session, { type: 'basicAttack' });
        assert.equal(result.applied, true);
        session = result.session;
        assert.equal(session.status, 'active');
        assert.equal(session.enemy.hp, 10);
        assert.ok((session.enemy.damageReceived ?? 0) > session.enemy.maxHp);
        const event = session.events.slice().reverse().find(e => e.actor === 'player' && e.action === 'basicAttack')!;
        assert.ok(event.combat.damage.some(d => d.target === 'enemy' && d.toHp > 10));
    }
    const score = session.enemy.damageReceived!;
    assert.ok(score > 20);
    assert.equal(JSON.parse(JSON.stringify(session)).enemy.damageReceived, score);
    session.player.hp = 0;
    // A normal end-turn check still ends the player's attempt.
    endSoloPveTurn(session);
    assert.equal(session.outcome, 'loss');
    assert.equal(session.enemy.damageReceived, score);
});
test('Wound and Drain score their full amount without exhausting weekly health', () => {
    const enemy = weekly().enemy;
    enemy.statuses = [{ name: 'Wound', amount: 5000, rounds: 2, kind: 'negative' }, { name: 'Drain', amount: 300, rounds: 2, kind: 'negative' }];
    const result = applyDoTs(enemy, 1).fighter;
    assert.equal(result.hp, 10);
    assert.equal(result.damageReceived, 5300);
    assert.equal(result.chakra, 200);
    assert.equal(damageCombatHealth(result, 9000000).damageReceived, 9005300);
});
test('health remains finite for ordinary AI and roaming world boss fighters', () => {
    const ordinary = fighter('Boss', 63);
    assert.equal(damageCombatHealth(ordinary, 5000).hp, 0);
    assert.equal(damageCombatHealth(ordinary, 5000).damageReceived, undefined);
});
test('legacy active weekly fights upgrade without counting other players prior damage', () => {
    const legacy = weekly();
    delete legacy.enemy.unlimitedHealth;
    delete legacy.enemy.damageReceived;
    legacy.enemy.maxHp = 10000;
    legacy.enemy.hp = 1000;
    const upgraded = applySoloPveAction(legacy, { type: 'basicAttack' }).session;
    assert.equal(upgraded.enemy.finiteHpAtScoreAttackCutover, 1000);
    assert.ok(upgraded.enemy.damageReceived! < 9000);
    assert.equal(upgraded.enemy.hp, 10000);
});

test('reflected boss attacks score without killing an unlimited-health enemy', () => {
    const session = weekly();
    session.activeSide = 'enemy';
    session.cooldowns.enemy.clear = 10;
    session.player.hp = session.player.maxHp = 1000;
    session.player.statuses = [{ name: 'Reflect', percent: 100, rounds: 2, kind: 'positive' }];
    runSoloPveAiUntilPlayer(session);
    const result = session;
    assert.equal(result.enemy.hp, 10);
    assert.ok(result.enemy.damageReceived! > 0, JSON.stringify(result.log));
    assert.equal(result.status, 'active');
});
