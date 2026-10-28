import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { storyBossEnemyTemplate, createStoryCombatBinding, validateCompletedStoryCombatSession } from './_authoritative-story-combat.js';
import { attachStoryTwinCombat } from './_twin-combat.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import { executeSoloPveAction, type SoloPveLock } from '../solo-pve/_action-service.js';
import { STORY_TWIN_TRIALS } from '../../shared/story-twin-trials.js';
import { storyTwinArt } from '../../shared/story-twin-art.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { applyStoryBossSettlement, STORY_REWARDS } from './_settle.js';
import { terminalizeLapsedSoloPveSession } from '../solo-pve/_abandon.js';
import { checkTowerWinner } from '../towers/_engine.js';
import { projectHuntCombat } from '../solo-pve/_hunt-combat.js';

const NOW = 1_800_000_000_000;
function encounter(village: string) {
    const character = { name: 'Trial', level: 50, village, storyProgress: 4, hp: 50_000, maxHp: 50_000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        stats: { ninjutsuOffense: 2000, ninjutsuDefense: 1000, bukijutsuDefense: 1000, taijutsuDefense: 1000, speed: 1000 }, jutsu: [], inventory: [], ryo: 0 };
    const profile = storyBossEnemyTemplate({ village, progressIndex: 4 });
    const session = buildSoloPveAiEncounter({ profile, save: { character }, playerName: 'trial', sessionId: `twin-trial-${village.split(' ')[0]}`, now: NOW, admin: null, difficultyMode: 'STORY',
        encounter: { kind: 'story-boss', id: `${village}:4`, sourceId: profile.id, bindingId: `twin-trial-${village.split(' ')[0]}` } });
    const originalHp = session.enemy.maxHp;
    attachStoryTwinCombat(session);
    const binding = createStoryCombatBinding({ runId: session.sessionId, playerName: 'trial', village, progressIndex: 4, now: NOW });
    return { session, character, originalHp, binding };
}
for (const village of ['Stormveil Village', 'Frostfang Village']) {
    test(`${village}: both twins are distinct actors with separate health, resources, kits and queued turns`, () => {
        const { session, originalHp } = encounter(village);
        const battle = session.huntCombat!.battle;
        const enemies = battle.actors.filter(a => a.side === 'enemy');
        const definitions = STORY_TWIN_TRIALS[session.encounter.sourceId!]!;
        assert.equal(enemies.length, 2);
        assert.equal(enemies.reduce((sum, a) => sum + a.maxHp, 0), originalHp, 'the old combined health is split, not doubled');
        assert.equal(new Set(battle.actors.map(a => a.pos)).size, 3);
        for (const [i, enemy] of enemies.entries()) {
            assert.equal(battle.turnQueue.filter(id => id === enemy.id).length, 1);
            assert.ok(enemy.hp > 0 && enemy.maxChakra > 0 && enemy.maxStamina > 0);
            assert.equal(enemy.character.avatarImage, definitions[i].art);
            assert.equal(storyTwinArt(enemy.id), definitions[i].art);
            assert.ok(existsSync(resolve('shinobij.client/public', definitions[i].art.slice(1))));
            const jutsu = enemy.character.jutsu as Array<Record<string, unknown>>;
            const expected = [...new Set([...definitions[i].jutsuIds, 'starter-universal-flicker'])];
            assert.deepEqual(jutsu.map(j => j.id), expected);
            assert.deepEqual(jutsu.map(j => j.tags), resolveAiProfileJutsu(expected).map(j => j.tags));
        }
        assert.notDeepEqual(enemies[0].character.jutsu, enemies[1].character.jutsu);
        assert.notEqual(enemies[0].cooldowns, enemies[1].cooldowns);
        assert.equal(battle.turnQueue[0], 'player');
    });
    test(`${village}: both twins actually take turns and use their own abilities`, () => {
        const { session } = encounter(village);
        const b = session.huntCombat!.battle;
        b.actors[0].pos = 0;
        b.actors[1].pos = 1;
        b.actors[2].pos = 12;
        const result = applySoloPveAction(session, { type: 'huntAction', action: { type: 'wait' } });
        assert.equal(result.applied, true);
        const next = result.session.huntCombat!.battle;
        for (const enemy of next.actors.filter(a => a.side === 'enemy')) {
            assert.ok(Object.keys(enemy.cooldowns).length > 0, `${enemy.name} cast a technique on its turn`);
            assert.ok(next.log.some(line => line.includes(enemy.name)), `${enemy.name} has its own log entries`);
        }
        assert.equal(next.turnQueue[next.activeIndex], 'player');
    });
    test(`${village}: killing one twin leaves the other alive and blocks the chapter reward until both fall`, () => {
        const { session, binding, character } = encounter(village);
        const b = session.huntCombat!.battle;
        const player = b.actors[0];
        player.character.jutsu = [{ id: 'audit-finisher', name: 'Audit finisher', type: 'Ninjutsu', element: 'None', ap: 60,
            range: 30, effectPower: 10000, target: 'OPPONENT', method: 'SINGLE', chakraCost: 0, staminaCost: 0, cooldown: 0, tags: [] }];
        const first = applySoloPveAction(session, { type: 'huntAction', action: { type: 'jutsu', jutsuId: 'audit-finisher', targetId: b.actors[1].id } });
        assert.equal(first.applied, true, first.reason ?? 'first targeted cast accepted');
        const after = first.session.huntCombat!.battle;
        assert.equal(after.actors[1].hp, 0, after.log.join('\n'));
        assert.equal(after.actors[2].hp, b.actors[2].hp);
        assert.equal(first.session.status, 'active');
        const forged = { ...first.session, status: 'done' as const, winner: 'player' as const };
        assert.deepEqual(validateCompletedStoryCombatSession({ binding, session: forged, playerName: 'trial', character, now: NOW }), { ok: false, reason: 'not-complete' });
        const nextTurn = applySoloPveAction(first.session, { type: 'huntAction', action: { type: 'wait' } });
        assert.equal(nextTurn.applied, true);
        assert.equal(nextTurn.session.huntCombat!.battle.actors[1].hp, 0, 'a downed twin stays down while the survivor takes a turn');
        const second = applySoloPveAction(nextTurn.session, { type: 'huntAction', action: { type: 'jutsu', jutsuId: 'audit-finisher', targetId: after.actors[2].id } });
        assert.equal(second.applied, true, second.reason ?? 'second targeted cast accepted');
        assert.equal(second.session.winner, 'player');
        assert.equal(validateCompletedStoryCombatSession({ binding, session: second.session, playerName: 'trial', character, now: NOW }).ok, true);
        const reward = applyStoryBossSettlement(character, { opponentId: binding.opponentId }, second.session.player.hp);
        assert.equal(reward.ok, true);
        if (reward.ok) {
            assert.equal(reward.progress, 5);
            assert.equal(reward.ryo, STORY_REWARDS[4].ryo);
        }
    });
    test(`${village}: targeted actions survive persistence and duplicate delivery without charging twice`, async () => {
        const { session } = encounter(village);
        let stored = structuredClone(session);
        const b = stored.huntCombat!.battle;
        b.actors[0].pos = 0; b.actors[1].pos = 1; b.actors[2].pos = 12;
        const command = { sessionId: stored.sessionId, ownerSlug: 'trial', expectedVersion: 1, moveToken: 'twin-move-0001',
            action: { type: 'huntAction' as const, action: { type: 'attack' as const, targetId: b.actors[2].id } } };
        const deps = { read: async () => structuredClone(stored), write: async (s: typeof stored) => { stored = structuredClone(s); },
            lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => NOW + 1 };
        const first = await executeSoloPveAction(command, deps);
        assert.equal(first.body.applied, true, first.body.reason ?? 'versioned targeted attack accepted');
        assert.equal(stored.huntCombat!.battle.actors[1].hp, b.actors[1].hp);
        assert.ok(stored.huntCombat!.battle.actors[2].hp < b.actors[2].hp);
        const paid = stored.huntCombat!.battle.actors[0].stamina;
        const replay = await executeSoloPveAction(command, deps);
        assert.equal(replay.body.duplicate, true);
        assert.equal(stored.huntCombat!.battle.actors[0].stamina, paid);
    });
    test(`${village}: one area attack can defeat both twins and produces a trial result`, () => {
        const { session } = encounter(village);
        const b = session.huntCombat!.battle;
        b.actors[0].pos = 0; b.actors[1].pos = 1; b.actors[2].pos = 2;
        b.actors[0].character.jutsu = [{ id: 'area-finisher', name: 'Area finisher', type: 'Ninjutsu', target: 'OPPONENT',
            method: 'AOE_BURST', ap: 100, range: 30, effectPower: 10000, chakraCost: 0, staminaCost: 0, cooldown: 0, tags: [] }];
        const result = applySoloPveAction(session, { type: 'huntAction', action: { type: 'jutsu', jutsuId: 'area-finisher', targetId: b.actors[1].id } });
        assert.equal(result.applied, true);
        assert.equal(result.session.winner, 'player');
        assert.ok(result.session.huntCombat!.battle.actors.filter(a => a.side === 'enemy').every(a => a.hp === 0));
        assert.ok(result.session.log.includes('Both twins are defeated. Trial won!'));
        assert.ok(!result.session.log.some(line => /floor \d+ cleared/i.test(line)));
    });
    test(`${village}: defeat and expired-session recovery cannot grant the chapter`, async () => {
        const { session, binding, character } = encounter(village);
        const b = session.huntCombat!.battle;
        b.actors[0].hp = 0;
        checkTowerWinner(b, b.encounterFloor!);
        projectHuntCombat(session);
        assert.equal(session.winner, 'enemy');
        assert.ok(session.log.includes('You were defeated. The trial is still open.'));
        assert.equal(validateCompletedStoryCombatSession({ binding, session, character, playerName: 'trial', now: NOW }).ok, false);
        let stored = encounter(village).session;
        const hp = stored.player.hp;
        const expiry = stored.expiresAt;
        const deps = { read: async () => stored, compareWrite: async (_before: typeof stored, next: typeof stored) => { stored = next; return true; },
            lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => expiry + 1,
            telemetry: { kv: { set: async () => null } as never } };
        await terminalizeLapsedSoloPveSession(stored.sessionId, deps);
        assert.equal(stored.huntCombat!.battle.status, 'done');
        assert.equal(stored.player.hp, hp - Math.floor(stored.player.maxHp * .1));
        assert.equal(stored.terminalEvidence?.lapsedAt, expiry);
        await terminalizeLapsedSoloPveSession(stored.sessionId, deps);
        assert.equal(stored.player.hp, hp - Math.floor(stored.player.maxHp * .1));
        const low = encounter(village).session;
        low.huntCombat!.battle.actors[0].hp = 3;
        projectHuntCombat(low);
        const abandoned = applySoloPveAction(low, { type: 'abandon' }).session;
        assert.equal(abandoned.player.hp, 0);
        assert.ok(abandoned.log.includes(`${low.player.name} leaves the trial, losing 3 HP.`), 'the log reports actual HP lost, capped by remaining health');
    });
    test(`${village}: malformed completion cannot hide a live or duplicate twin`, () => {
        const { session, binding, character } = encounter(village);
        const b = session.huntCombat!.battle;
        b.actors.filter(a => a.side === 'enemy').forEach(a => { a.hp = 0; });
        checkTowerWinner(b, b.encounterFloor!); projectHuntCombat(session);
        assert.equal(validateCompletedStoryCombatSession({ binding, session, character, playerName: 'trial', now: NOW }).ok, true);
        b.actors.push({ ...structuredClone(b.actors[1]), hp: 1 });
        assert.equal(validateCompletedStoryCombatSession({ binding, session, character, playerName: 'trial', now: NOW }).ok, false);
        b.actors.at(-1)!.hp = 0;
        assert.equal(validateCompletedStoryCombatSession({ binding, session, character, playerName: 'trial', now: NOW }).ok, false);
    });
}
test('ordinary village chapters remain single-opponent sessions', () => {
    const profile = storyBossEnemyTemplate({ village: 'Ashen Leaf Village', progressIndex: 4 });
    const s = buildSoloPveAiEncounter({ profile, save: { character: { level: 50, hp: 1000, maxHp: 1000 } }, playerName: 'trial', sessionId: 'single-story', now: NOW, admin: null });
    attachStoryTwinCombat(s);
    assert.equal(s.huntCombat, undefined);
});
