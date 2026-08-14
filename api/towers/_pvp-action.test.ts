import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import type { TowerKv, TowerLock } from './_tower-store.js';
import { applyTowerPvpCommand } from './_pvp-action.js';
import {
    activateReadyTowerPvpMatch,
    createTowerPvpMatch,
    type StoredTowerPvpMatch,
    type TowerPvpFighterSeed,
} from './_pvp-session.js';
import {
    readTowerPvpMatch,
    towerPvpMatchKey,
    writeTowerPvpMatch,
    type TowerPvpStoreDeps,
} from './_pvp-store.js';
import { settleTowerPvpMatch, towerPvpState } from './_pvp-lifecycle.js';
import { TURN_AFK_MS } from './_tower-mp.js';

const NOW = 1_800_000_000_000;
const MATCH_ID = `tpvp-${'c'.repeat(32)}`;
const token = (label: string) => `tower-pvp-token-${label}-0001`;

function lock(): TowerLock {
    return async (_key, fn) => fn();
}

function fighter(slug: string, skill: number): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug.toUpperCase(),
        skill,
        character: {
            name: slug,
            level: 40,
            specialty: 'Ninjutsu',
            maxHp: 1_000,
            maxChakra: 100,
            maxStamina: 100,
            stats: { ninjutsuPower: 220, intelligence: 180, speed: 150, defense: 150 },
            jutsu: [{
                id: 'test-poison', name: 'Test Poison', type: 'Ninjutsu', effectPower: 20,
                ap: 40, range: 4, chakraCost: 0, staminaCost: 0, cooldown: 0,
                method: 'SINGLE', target: 'ENEMY', tags: [{ name: 'Poison', percent: 5 }],
            }],
            pvpItems: [],
        },
    };
}

function activeMatch(now = NOW): StoredTowerPvpMatch {
    const match = createTowerPvpMatch({
        matchId: MATCH_ID,
        fighters: [fighter('alpha', 400), fighter('bravo', 300), fighter('charlie', 200), fighter('delta', 100)],
        seed: 99,
        now,
    });
    match.roster.forEach(member => { member.ready = true; });
    activateReadyTowerPvpMatch(match, now);
    // Put alpha and the first violet opponent adjacent for focused action tests.
    match.combat.actors.find(actor => actor.id === 'amber-0')!.pos = 33;
    match.combat.actors.find(actor => actor.id === 'violet-0')!.pos = 34;
    return match;
}

function setup(now = NOW): TowerPvpStoreDeps & { kv: TowerKv; released: string[][]; clock: { now: number } } {
    const kv = _makeMemoryKv() as unknown as TowerKv;
    const released: string[][] = [];
    const clock = { now };
    return {
        kv,
        released,
        clock,
        lock: lock(),
        now: () => clock.now,
        claim: async (_matchId, members) => ({ ok: true, members: [...members], replayed: true }),
        release: async (_matchId, members) => { released.push([...members]); },
    };
}

async function publish(deps: TowerPvpStoreDeps, match = activeMatch()): Promise<StoredTowerPvpMatch> {
    await writeTowerPvpMatch(match, deps);
    return match;
}

describe('Tower MPvP authoritative action and settlement', () => {
    it('requires an idempotency token and exact optimistic version', async () => {
        const deps = setup();
        await publish(deps);
        const missing = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'alpha', type: 'wait', moveToken: '', expectedVersion: 1,
        }, deps);
        assert.equal(missing.status, 400);
        assert.equal(missing.reason, 'invalid-move-token');
        const stale = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'alpha', type: 'wait', moveToken: token('stale'), expectedVersion: 0,
        }, deps);
        assert.equal(stale.status, 409);
        assert.equal(stale.reason, 'stale-version');
        assert.equal((await readTowerPvpMatch(MATCH_ID, deps))?.version, 1);
    });

    it('derives the active actor from its server-owned controller', async () => {
        const deps = setup();
        await publish(deps);
        const stolen = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'bravo', type: 'wait', moveToken: token('stolen'), expectedVersion: 1,
        }, deps);
        assert.equal(stolen.status, 409);
        assert.equal(stolen.reason, 'not-your-turn');
        assert.equal(stolen.match?.combat.activeIndex, 0);
    });

    it('uses the canonical Tower/PvP reducer for damage and tags', async () => {
        const deps = setup();
        await publish(deps);
        const result = await applyTowerPvpCommand({
            matchId: MATCH_ID,
            slug: 'alpha',
            type: 'jutsu',
            jutsuId: 'test-poison',
            targetId: 'violet-0',
            moveToken: token('poison'),
            expectedVersion: 1,
        }, deps);
        assert.equal(result.applied, true);
        const target = result.match?.combat.actors.find(actor => actor.id === 'violet-0');
        assert.equal(target?.statuses.some(status => status.name === 'Poison'), true);
        assert.equal(result.match?.version, 2);
    });

    it('rejects same-team targeting before applying damage', async () => {
        const deps = setup();
        const match = await publish(deps);
        match.combat.actors.find(actor => actor.id === 'amber-1')!.pos = 34;
        await writeTowerPvpMatch(match, deps);
        const result = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'alpha', type: 'attack', targetId: 'amber-1',
            moveToken: token('friendly'), expectedVersion: 1,
        }, deps);
        assert.equal(result.applied, false);
        assert.equal(result.reason, 'friendly-fire');
        assert.equal(result.match?.combat.actors.find(actor => actor.id === 'amber-1')?.hp, 1_000);
    });

    it('acknowledges a lost action response without applying it twice', async () => {
        const deps = setup();
        await publish(deps);
        const command = {
            matchId: MATCH_ID, slug: 'alpha', type: 'wait' as const,
            moveToken: token('replay'), expectedVersion: 1,
        };
        const first = await applyTowerPvpCommand(command, deps);
        assert.equal(first.applied, true);
        assert.equal(first.replayed, false);
        assert.equal(first.match?.combat.activeIndex, 1);
        const replay = await applyTowerPvpCommand(command, deps);
        assert.equal(replay.applied, true);
        assert.equal(replay.replayed, true);
        assert.equal(replay.match?.combat.activeIndex, 1);
        assert.equal(replay.match?.version, 2);
    });

    it('lets a teammate continue after one forfeit and resolves after the second', async () => {
        const deps = setup();
        await publish(deps);
        const first = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'alpha', type: 'forfeit',
            moveToken: token('forfeit-a'), expectedVersion: 1,
        }, deps);
        assert.equal(first.applied, true);
        assert.equal(first.match?.status, 'active');
        assert.equal(first.match?.combat.actors.find(actor => actor.ownerSlug === 'alpha')?.hp, 0);
        assert.equal(first.match?.combat.actors.find(actor => actor.ownerSlug === 'delta')?.hp, 1_000);

        const second = await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'delta', type: 'forfeit',
            moveToken: token('forfeit-d'), expectedVersion: 2,
        }, deps);
        assert.equal(second.applied, true);
        assert.equal(second.match?.status, 'done');
        assert.equal(second.match?.winner, 'violet');
        assert.ok(deps.released.length >= 1);
    });

    it('mutates an expired human turn during authenticated state polling', async () => {
        const deps = setup();
        await publish(deps);
        deps.clock.now = NOW + TURN_AFK_MS + 1;
        const state = await towerPvpState(MATCH_ID, 'alpha', deps);
        assert.equal(state.ok, true);
        if (!state.ok) return;
        assert.equal(state.match.afkStrikes.alpha, 1);
        assert.equal(state.match.combat.activeIndex, 1);
        assert.equal(state.match.version, 2);
    });

    it('forbids nonmembers from state, action and settlement', async () => {
        const deps = setup();
        const match = await publish(deps);
        assert.equal((await towerPvpState(MATCH_ID, 'outsider', deps)).ok, false);
        assert.equal((await applyTowerPvpCommand({
            matchId: MATCH_ID, slug: 'outsider', type: 'wait',
            moveToken: token('outsider'), expectedVersion: 1,
        }, deps)).status, 403);
        match.status = 'done';
        match.combat.status = 'done';
        await writeTowerPvpMatch(match, deps);
        assert.equal((await settleTowerPvpMatch(MATCH_ID, 'outsider', deps)).ok, false);
    });

    it('settles as an idempotent zero-reward acknowledgement with no save write', async () => {
        const deps = setup();
        const match = await publish(deps);
        match.status = 'done';
        match.winner = 'amber';
        match.combat.status = 'done';
        match.combat.winner = 'squad';
        await writeTowerPvpMatch(match, deps);
        const first = await settleTowerPvpMatch(MATCH_ID, 'alpha', deps);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.deepEqual(first.response.rewards, { ryo: 0, xp: 0, fateShards: 0, rating: 0 });
        assert.equal(first.response.progressionApplied, false);
        assert.equal(first.response.replayed, false);
        const replay = await settleTowerPvpMatch(MATCH_ID, 'alpha', deps);
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.response.replayed, true);
        assert.equal(await deps.kv.get('save:alpha'), null);
        assert.ok(await deps.kv.get(towerPvpMatchKey(MATCH_ID)));
    });
});
