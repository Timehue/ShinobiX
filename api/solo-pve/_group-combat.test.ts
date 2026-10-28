import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { groupCombatCases, groupCombatFixture, groupFinisher } from '../../scripts/narrative-group-fixtures.js';
import { applySoloPveAction } from './_engine.js';
import { narrativeGroupWinConfirmed } from './_group-proof.js';
import { resolveAiFightOutcome } from '../missions/_ai-fight-outcome.js';
import { hexDistance } from '../combat-core/grid.js';
import { createStoryCombatBinding, validateCompletedStoryCombatSession } from '../story/_authoritative-story-combat.js';
import { executeSoloPveAction, type SoloPveLock } from './_action-service.js';
import { terminalizeLapsedSoloPveSession } from './_abandon.js';

for (const entry of groupCombatCases) {
    test(`${entry.key}: sealed HP/stats reach the grid unchanged, with independent actors and no Tower floor scaling`, async () => {
        // Keep browser module resolution outside the server's NodeNext graph.
        const clientModule = '../../shinobij.client/src/lib/hunt-combat-api.js';
        const { huntSessionForTower } = await import(clientModule);
        const { session, control } = groupCombatFixture(entry.key, entry.name);
        const combat = session.huntCombat!;
        assert.equal(combat.purpose, 'narrative-group');
        const enemies = combat.battle.actors.filter(a => a.side === 'enemy');
        assert.ok(enemies.length >= 2);
        assert.equal(combat.formation.count, enemies.length);
        assert.equal(enemies.reduce((n, a) => n + a.maxHp, 0), control.enemy.maxHp, 'the original sealed health budget is split exactly, not replaced by Tower stats');
        assert.deepEqual(combat.battle.actors[0].character, control.player.character, 'player stats/loadout stay sealed by Solo-PvE');
        assert.equal(combat.battle.actors[0].maxHp, control.player.maxHp);
        assert.equal(combat.battle.actors[0].hp, control.player.hp);
        assert.equal(new Set(combat.battle.actors.map(a => a.pos)).size, enemies.length + 1);
        assert.ok(combat.battle.actors.every(a => !session.environment.blockedTiles.includes(a.pos)));
        assert.deepEqual(huntSessionForTower(session).actors, combat.battle.actors, 'the client projection changes no HP/stats');
        for (const enemy of enemies) {
            assert.equal(combat.battle.turnQueue.filter(id => id === enemy.id).length, 1);
            assert.equal(enemy.hp, enemy.maxHp);
            assert.ok(enemy.maxHp > 0 && enemy.maxChakra >= 250 && enemy.maxStamina >= 250);
            assert.ok(Object.values(enemy.character.stats as Record<string, number>).every(Number.isFinite));
            assert.ok(existsSync(resolve('shinobij.client/public', String(enemy.character.avatarImage).slice(1))));
            assert.equal((enemy.character.jutsu as unknown[]).length, 3);
            assert.notEqual(enemy.cooldowns, enemies.find(a => a.id !== enemy.id)!.cooldowns);
            assert.notEqual(enemy.character.stats, enemies.find(a => a.id !== enemy.id)!.character.stats);
        }
        assert.ok(new Set(enemies.map(a => JSON.stringify(a.character.jutsu))).size >= 2, 'roles bring different legal kits');
    });
    test(`${entry.key}: every opponent takes its own turn and uses its own legal abilities`, () => {
        const { session } = groupCombatFixture(entry.key, entry.name);
        const b = session.huntCombat!.battle;
        b.map.blockedTiles = [];
        const playerPos = b.actors[0].pos;
        const positions = Array.from({ length: 120 }, (_, i) => i).filter(i => i !== playerPos && hexDistance(playerPos, i, 12) <= 3);
        b.actors.slice(1).forEach((a, i) => { a.pos = positions[i]; });
        const result = applySoloPveAction(session, { type: 'huntAction', action: { type: 'wait' } });
        assert.equal(result.applied, true);
        const next = result.session.huntCombat!.battle;
        for (const enemy of next.actors.filter(a => a.side === 'enemy')) {
            assert.ok(Object.keys(enemy.cooldowns).length > 0, `${enemy.name} must actually cast on its own turn`);
            assert.ok(enemy.chakra < enemy.maxChakra || enemy.stamina < enemy.maxStamina, `${enemy.name} pays its own resources`);
        }
        assert.equal(next.turnQueue[next.activeIndex], 'player');
    });
    test(`${entry.key}: the last opponent gates victory, the original settlement, and a terminal battlefield`, () => {
        const { session, character, village, progress } = groupCombatFixture(entry.key, entry.name);
        session.huntCombat!.battle.actors[0].character.jutsu = [groupFinisher];
        let current = session;
        const enemies = current.huntCombat!.battle.actors.filter(a => a.side === 'enemy');
        const binding = createStoryCombatBinding({ runId: current.sessionId, playerName: 'groupaudit', village, progressIndex: progress, now: current.createdAt });
        for (const [index, enemy] of [...enemies].reverse().entries()) {
            // This test isolates terminal/proof handling across 13 last hits;
            // the separate turn test exercises unmodified incoming damage.
            current.huntCombat!.battle.actors[0].hp = current.huntCombat!.battle.actors[0].maxHp;
            if (index > 0) current = applySoloPveAction(current, { type: 'huntAction', action: { type: 'wait' } }).session;
            // Controlled last-hit fixture: normal Reflect damage still applies;
            // an artificial 10,000-power hit would kill the tester by reflection.
            current.huntCombat!.battle.actors.find(a => a.id === enemy.id)!.hp = 1;
            const result = applySoloPveAction(current, { type: 'huntAction', action: { type: 'jutsu', jutsuId: groupFinisher.id, targetId: enemy.id } });
            assert.equal(result.applied, true, result.reason ?? 'cast accepted'); current = result.session;
            assert.equal(current.huntCombat!.battle.actors.find(a => a.id === enemy.id)!.hp, 0);
            if (index < enemies.length - 1) {
                assert.equal(current.status, 'active');
                assert.equal(narrativeGroupWinConfirmed(current), false);
                assert.equal(resolveAiFightOutcome({ ...current, status: 'done', winner: 'player' }), 'unknown');
                if (entry.key.startsWith('story-ai-')) assert.equal(validateCompletedStoryCombatSession({ binding, session: { ...current, status: 'done', winner: 'player' }, playerName: 'groupaudit', character, now: current.createdAt }).ok, false);
            }
        }
        assert.equal(current.status, 'done'); assert.equal(current.winner, 'player');
        assert.equal(narrativeGroupWinConfirmed(current), true);
        assert.equal(resolveAiFightOutcome(current), 'win');
        assert.ok(current.log.includes('Every opponent is defeated. Encounter won!'));
        assert.equal(applySoloPveAction(current, { type: 'huntAction', action: { type: 'wait' } }).applied, false, 'a completed battlefield cannot keep the player in combat');
        if (entry.key.startsWith('story-ai-')) assert.equal(validateCompletedStoryCombatSession({ binding, session: current, playerName: 'groupaudit', character, now: current.createdAt }).ok, true);
    });
}

test('large groups retain stable move receipts and idempotent expiry/forfeit costs', async () => {
    let stored = groupCombatFixture('story-ai-frostfang-village-35').session;
    const command = { sessionId: stored.sessionId, ownerSlug: stored.ownerSlug, expectedVersion: stored.version,
        moveToken: 'group-forfeit-0001', action: { type: 'abandon' as const } };
    const beforeHp = stored.player.hp;
    const deps = { read: async () => structuredClone(stored), write: async (s: typeof stored) => { stored = s; },
        lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => stored.createdAt + 1 };
    assert.equal((await executeSoloPveAction(command, deps)).body.applied, true);
    assert.equal(stored.player.hp, beforeHp - Math.floor(stored.player.maxHp * .1));
    assert.equal((await executeSoloPveAction(command, deps)).body.duplicate, true);
    assert.equal(stored.player.hp, beforeHp - Math.floor(stored.player.maxHp * .1));
    stored = groupCombatFixture('story-ai-frostfang-village-35').session;
    const expiry = { ...deps, now: () => stored.expiresAt + 1,
        compareWrite: async (_before: typeof stored, next: typeof stored) => { stored = next; return true; } };
    await terminalizeLapsedSoloPveSession(stored.sessionId, expiry);
    assert.equal(stored.status, 'done');
    assert.equal(stored.huntCombat!.battle.status, 'done');
    const hp = stored.player.hp;
    await terminalizeLapsedSoloPveSession(stored.sessionId, expiry);
    assert.equal(stored.player.hp, hp);
});
