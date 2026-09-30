import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHuntCombatAction, type HuntFormation } from '../../shared/hunt-combat.js';
import type { PvpFighter } from '../pvp/session.js';
import { huntFormationFor } from '../missions/_hunt-trail.js';
import { startRound, checkTowerWinner } from '../towers/_engine.js';
import { activeActor } from '../towers/_tower-session.js';
import { createSoloPveSession } from './_session.js';
import { attachHuntCombat } from './_hunt-combat.js';
import { applySoloPveAction } from './_engine.js';
import { executeSoloPveAction, type SoloPveLock } from './_action-service.js';
import { terminalizeLapsedSoloPveSession } from './_abandon.js';
import { soloPveCombatUsage } from '../_combat-usage.js';

const NOW = 1_800_000_000_000;
const forms: HuntFormation[] = [
    { version: 1, kind: 'single', count: 1 },
    { version: 1, kind: 'waves', count: 2 },
    { version: 1, kind: 'waves', count: 3 },
    { version: 1, kind: 'pack', count: 2 },
    { version: 1, kind: 'pack', count: 3 },
];
function fighter(name: string): PvpFighter {
    return { name, hp: 1000, maxHp: 1000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        shield: 0, statuses: [], pos: 62,
        character: { level: 20, specialty: 'Taijutsu', stats: { taijutsuOffense: 1200, taijutsuDefense: 600 }, jutsu: [], pvpItems: [], equipment: {} } };
}
function session(formation = forms[4]!, blockedTiles: number[] = []) {
    const s = createSoloPveSession({ sessionId: 'hunt-test-session', ownerSlug: 'hunter',
        encounter: { kind: 'generic-ai', id: 'hunt-wild-boar', level: 20 },
        player: { ...fighter('Hunter'), hp: 740, chakra: 210, stamina: 220 }, enemy: fighter('Wild Boar'), now: NOW });
    s.environment.blockedTiles = blockedTiles;
    attachHuntCombat(s, { kind: 'hunt-target', sourceId: 'hunt-wild-boar', missionId: 'hunt-wild-boar',
        huntRunId: 'accepted-hunt-run', sector: 25, stage: 0, displayName: 'Wild Boar', huntFormation: formation });
    return s;
}

describe('Tower-powered hunt encounters', () => {
    it('seals all five formations deterministically for the accepted run', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            const form = huntFormationFor(`accepted-${i}`, 'hunt-target');
            assert.deepEqual(form, huntFormationFor(`accepted-${i}`, 'hunt-target'));
            seen.add(`${form.kind}:${form.count}`);
        }
        assert.deepEqual([...seen].sort(), forms.map(f => `${f.kind}:${f.count}`).sort());
    });

    for (const form of forms) it(`preserves vitals and total health in ${form.kind}:${form.count}`, () => {
        const s = session(form);
        const b = s.huntCombat!.battle;
        const all = [...b.actors, ...(b.pendingEnemyWaves ?? []).flatMap(w => w.actors)];
        const enemies = all.filter(a => a.side === 'enemy');
        assert.equal(enemies.length, form.count);
        assert.equal(enemies.reduce((total, a) => total + a.maxHp, 0), 1000);
        assert.equal(enemies.filter(a => a.character.huntContractTarget).length, 1);
        assert.equal(s.player.hp, 740);
        assert.equal(s.player.chakra, 210);
        assert.equal(s.player.stamina, 220);
        assert.equal(activeActor(b)?.id, 'player');
        assert.equal(new Set(all.map(a => a.pos)).size, all.length);
        assert.equal(applySoloPveAction(s, { type: 'basicAttack' }).reason, 'hunt-action-required');
    });

    it('avoids blocked spawn tiles', () => {
        const s = session(forms[4], [62, 33, 57, 81]);
        for (const actor of s.huntCombat!.battle.actors) assert.ok(!s.environment.blockedTiles.includes(actor.pos));
    });

    for (const form of forms) it(`plays ${form.kind}:${form.count} to one terminal victory through real commands`, () => {
        let s = session(form);
        const b = s.huntCombat!.battle;
        b.actors[0]!.character.jutsu = [{ id: 'finisher', name: 'Finisher', type: 'Taijutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 5000, ap: 100, range: 30, chakraCost: 0, staminaCost: 0, cooldown: 0, tags: [] }];
        for (const a of [...b.actors, ...(b.pendingEnemyWaves ?? []).flatMap(w => w.actors)]) if (a.side === 'enemy') a.hp = 1;
        let casts = 0;
        for (let step = 0; s.status === 'active' && step < 20; step++) {
            const battle = s.huntCombat!.battle;
            const enemy = battle.actors.find(a => a.side === 'enemy' && a.hp > 0);
            const action = enemy && battle.activeAp >= 100
                ? { type: 'jutsu' as const, jutsuId: 'finisher', targetId: enemy.id }
                : { type: 'wait' as const };
            const next = applySoloPveAction(s, { type: 'huntAction', action });
            assert.equal(next.applied, true, next.reason ?? 'command accepted');
            if (action.type === 'jutsu') casts++;
            s = next.session;
        }
        assert.equal(s.status, 'done');
        assert.equal(s.outcome, 'win');
        assert.equal(s.huntCombat!.battle.winner, 'squad');
        assert.equal(s.huntCombat!.battle.pendingEnemyWaves?.length ?? 0, 0);
        assert.equal(s.huntCombat!.battle.actors.filter(a => a.side === 'enemy' && a.hp > 0).length, 0);
        if (form.kind === 'waves') assert.equal(casts, form.count);
    });

    it('deploys only one sequential wave after a clear and keeps victory locked until the last', () => {
        const s = session(forms[2]);
        const b = s.huntCombat!.battle;
        const floor = b.encounterFloor!;
        b.round = 5;
        startRound(b);
        assert.equal(b.actors.filter(a => a.side === 'enemy').length, 1, 'waiting does not deploy waves');
        for (let cleared = 1; cleared <= 3; cleared++) {
            b.actors.filter(a => a.side === 'enemy').forEach(a => { a.hp = 0; });
            checkTowerWinner(b, floor);
            assert.equal(b.status, cleared === 3 ? 'done' : 'active');
            if (cleared < 3) {
                startRound(b);
                assert.equal(b.actors.filter(a => a.side === 'enemy' && a.hp > 0).length, 1);
                assert.equal(b.pendingEnemyWaves?.length ?? 0, 2 - cleared);
            }
        }
        assert.equal(b.winner, 'squad');
    });

    it('resolves selected targets and AoE through Tower combat and rejects forged targets', () => {
        let s = session();
        const b = s.huntCombat!.battle;
        b.actors[0]!.pos = 62;
        b.actors[1]!.pos = 63;
        b.actors[2]!.pos = 64;
        b.actors[3]!.pos = 75;
        for (const targetId of ['player', 'missing-enemy']) {
            const rejected = applySoloPveAction(s, { type: 'huntAction', action: { type: 'attack', targetId } });
            assert.equal(rejected.applied, false);
            assert.deepEqual(rejected.session, s);
        }
        const attack = applySoloPveAction(s, { type: 'huntAction', action: { type: 'attack', targetId: 'hunt-enemy-0' } });
        assert.equal(attack.applied, true, attack.reason ?? 'attack accepted');
        assert.ok(attack.session.huntCombat!.battle.actors[1]!.hp < b.actors[1]!.hp);
        assert.equal(attack.session.huntCombat!.battle.actors[2]!.hp, b.actors[2]!.hp);
        assert.equal(attack.session.status, 'active', 'one dead target cannot clear the pack');

        s = session();
        const battle = s.huntCombat!.battle;
        battle.actors[0]!.pos = 0;
        battle.actors.slice(1).forEach((a, i) => { a.pos = i + 1; });
        battle.actors[0]!.character.jutsu = [{ id: 'hunt-burst', name: 'Hunt burst', type: 'Taijutsu', target: 'OPPONENT',
            method: 'AOE_BURST', effectPower: 25, ap: 60, range: 4, chakraCost: 25, staminaCost: 10, cooldown: 4,
            tags: [{ name: 'Wound', percent: 20 }] }];
        const cast = applySoloPveAction(s, { type: 'huntAction', action: { type: 'jutsu', jutsuId: 'hunt-burst', targetId: 'hunt-enemy-1' } });
        assert.equal(cast.applied, true, cast.reason ?? 'cast accepted');
        const after = cast.session.huntCombat!.battle;
        assert.ok(after.actors.slice(1).filter((a, i) => a.hp < battle.actors[i + 1]!.hp).length >= 2);
        assert.ok(after.actors.slice(1).some(a => a.statuses.some(status => status.name === 'Wound')));
        assert.equal(cast.session.player.chakra, after.actors[0]!.chakra);
        assert.ok(cast.session.player.chakra < s.player.chakra);
        assert.deepEqual(cast.session.huntCombat!.usedJutsuIds, ['hunt-burst']);
        const terminal = applySoloPveAction(cast.session, { type: 'abandon' }).session;
        assert.deepEqual(soloPveCombatUsage(terminal)?.[0]?.usedJutsu, ['hunt-burst']);
    });

    it('strips client authority and validates intent coordinates', () => {
        assert.deepEqual(parseHuntCombatAction({ type: 'attack', targetId: 'hunt-enemy-2', actorId: 'enemy', damage: 9999 }), { type: 'attack', targetId: 'hunt-enemy-2' });
        assert.equal(parseHuntCombatAction({ type: 'dash', tile: 120 }), null);
        assert.equal(parseHuntCombatAction({ type: 'move', tile: 1.5 }), null);
        assert.equal(parseHuntCombatAction({ type: 'attack' }), null);
    });

    it('projects item charges and companion usage for the existing settlement authority', () => {
        const s = session();
        const b = s.huntCombat!.battle;
        b.actors[0]!.character.pvpItems = [{ id: 'hunt-potion', name: 'Potion', slot: 'potion', restoreChakra: 50 }];
        b.actors[0]!.character.equipment = { potion: 'hunt-potion' };
        b.actors[0]!.itemCharges = { 'hunt-potion': 1 };
        const used = applySoloPveAction(s, { type: 'huntAction', action: { type: 'item', itemId: 'hunt-potion' } });
        assert.equal(used.applied, true, used.reason ?? 'item accepted');
        assert.equal(used.session.itemsUsed['hunt-potion'], 1);
        assert.equal(used.session.itemCharges['hunt-potion'], 0);
        assert.equal(applySoloPveAction(used.session, { type: 'huntAction', action: { type: 'item', itemId: 'hunt-potion' } }).applied, false);
        const seal = { petId: 'pet-1', name: 'Fang', hp: 300, damage: 120, happiness: 100, loyal: true, moves: [], pveGearId: '', consumableId: 'pet-treat' };
        used.session.pendingCompanion = seal;
        used.session.huntCombat!.battle.pendingCompanion = seal;
        const summoned = applySoloPveAction(used.session, { type: 'huntAction', action: { type: 'summon' } });
        assert.equal(summoned.applied, true, summoned.reason ?? 'summon accepted');
        assert.deepEqual(summoned.session.companionUsage, { petId: 'pet-1', consumableId: 'pet-treat' });
        assert.equal(summoned.session.pendingCompanion, undefined);
        assert.ok(summoned.session.player.hp > used.session.player.hp);
        assert.equal(applySoloPveAction(summoned.session, { type: 'huntAction', action: { type: 'summon' } }).applied, false);
        const terminal = applySoloPveAction(summoned.session, { type: 'abandon' }).session;
        assert.deepEqual(terminal.companionUsage, summoned.session.companionUsage);
        assert.equal(terminal.itemsUsed['hunt-potion'], 1);
    });

    it('enforces ownership/version and charges a replayed retreat only once', async () => {
        let saved = session();
        let writes = 0;
        const deps = { read: async () => structuredClone(saved), write: async (s: typeof saved) => { saved = s; writes++; },
            lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => NOW + 1,
            telemetry: { kv: { set: async () => null } as never } };
        const command = { sessionId: saved.sessionId, ownerSlug: saved.ownerSlug, expectedVersion: saved.version,
            moveToken: 'retreat-once-123', action: { type: 'abandon' as const } };
        assert.equal((await executeSoloPveAction({ ...command, ownerSlug: 'intruder' }, deps)).status, 403);
        assert.equal((await executeSoloPveAction({ ...command, expectedVersion: 999 }, deps)).status, 409);
        const result = await executeSoloPveAction(command, deps);
        assert.equal(result.body.applied, true);
        assert.equal(saved.player.hp, 640);
        assert.equal(saved.huntCombat!.battle.status, 'done');
        assert.equal(saved.terminalEvidence?.outcome, 'loss');
        const replay = await executeSoloPveAction(command, deps);
        assert.equal(replay.body.duplicate, true);
        assert.equal(saved.player.hp, 640);
        assert.equal(writes, 1);
    });

    it('terminalizes an expired hunt on the same board and preserves its final evidence', async () => {
        let saved = session(forms[2]);
        const deps = { read: async () => saved, compareWrite: async (_before: typeof saved, next: typeof saved) => { saved = next; return true; },
            lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => saved.expiresAt + 1,
            telemetry: { kv: { set: async () => null } as never } };
        const result = await terminalizeLapsedSoloPveSession(saved.sessionId, deps);
        assert.equal(result.ok, true);
        assert.equal(saved.player.hp, 640);
        assert.equal(saved.huntCombat!.battle.status, 'done');
        assert.equal(saved.terminalEvidence?.outcome, 'loss');
        const evidence = structuredClone(saved.terminalEvidence);
        await terminalizeLapsedSoloPveSession(saved.sessionId, deps);
        assert.deepEqual(saved.terminalEvidence, evidence);
        assert.equal(saved.player.hp, 640);
    });
});
