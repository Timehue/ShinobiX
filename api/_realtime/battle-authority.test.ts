import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { createSoloPveSession } from '../solo-pve/_session.js';
import type { PvpFighter } from '../pvp/session.js';
import {
    battleAuthorityKeys,
    battleEvidenceFrom,
    resolveBattleAuthority,
    type BattleEvidence,
} from './battle-authority.js';
import {
    BATTLE_AUTHORITY_CACHE_MS,
    invalidateBattleAuthority,
    resetBattleAuthorityCacheForTests,
    type BattleStateProjection,
} from './battle-projection.js';

/*
 * F01 — `inBattle` is derived from what the combat stores can PROVE. A client
 * claim is never evidence; a live session, a Tower lease, a fresh PvP
 * reservation, an active PvP session, or a running pet duel is.
 */

const NOW = 1_800_000_000_000;
const SLUG = 'rill';

function fighter(name: string, hp: number): PvpFighter {
    return {
        name, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: 62,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function soloSession(sessionId: string, over: Record<string, unknown> = {}) {
    return {
        ...createSoloPveSession({
            sessionId, ownerSlug: SLUG,
            encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: sessionId },
            player: fighter('Rill', 80), enemy: fighter('Enemy', 50), now: NOW,
        }),
        ...over,
    };
}

function projection(sessionId: string, over: Partial<BattleStateProjection> = {}): BattleStateProjection {
    return { version: 1, kind: 'solo-pve', sessionId, startedAt: NOW, expiresAt: NOW + 30 * 60_000, ...over };
}

function evidence(over: Partial<BattleEvidence> = {}): BattleEvidence {
    return { battleState: null, battleLock: null, pvpPointer: null, aiFightPointer: null, petBattleActive: null, ...over };
}

function pointer(battleId: string, over: Record<string, unknown> = {}): string {
    return JSON.stringify({ version: 1, playerName: SLUG, battleId, role: 'p1', createdAt: NOW - 1_000, phase: 'active', ...over });
}

describe('battle authority — presence immunity is proven, never claimed', () => {
    let kv: ReturnType<typeof _makeMemoryKv>;
    let reads: string[];
    const deps = () => ({
        kv: { get: async <T,>(key: string) => { reads.push(key); return kv.get<T>(key); } },
        now: () => NOW,
        petDuelFor: () => null,
    });

    beforeEach(() => {
        kv = _makeMemoryKv();
        reads = [];
        resetBattleAuthorityCacheForTests();
    });

    it('names the five keys the heartbeat rides on its existing mget', () => {
        assert.deepEqual(battleAuthorityKeys('Rill'), [
            'battle-state:rill', 'battle-lock:rill', 'pvp:pending-session:rill', 'ai-fight-active:rill', 'pet:battle-active:rill',
        ]);
        const ev = battleEvidenceFrom([{ a: 1 }, undefined, 'p', null, 'tok']);
        assert.deepEqual(ev, { battleState: { a: 1 }, battleLock: null, pvpPointer: 'p', aiFightPointer: null, petBattleActive: 'tok' });
    });

    it('no evidence → not in battle, and nothing is read', async () => {
        const verdict = await resolveBattleAuthority(SLUG, evidence(), deps());
        assert.deepEqual(verdict, { inBattle: false, source: null });
        assert.deepEqual(reads, []);
    });

    it('a Tower lease or the legacy lock marker proves a fight without a read', async () => {
        const lease = { battleId: 'tower-1', kind: 'tower-battle', screen: 'towerBattle', startedAt: NOW, meta: { runId: 'tower-1' } };
        const tower = await resolveBattleAuthority(SLUG, evidence({ battleLock: lease }), deps());
        assert.equal(tower.inBattle, true);
        assert.deepEqual(reads, []);
        invalidateBattleAuthority(SLUG);
        const legacy = await resolveBattleAuthority(SLUG, evidence({ battleLock: { battleId: 'old', kind: 'arena' } }), deps());
        assert.deepEqual(legacy, { inBattle: true, source: 'legacy-lock' });
    });

    it('a Solo-PvE projection proves a fight only while its session is active and unexpired', async () => {
        await kv.set('solo-pve:run-1', soloSession('run-1'));
        const live = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-1') }), deps());
        assert.deepEqual(live, { inBattle: true, source: 'solo-pve' });
        assert.deepEqual(reads, ['solo-pve:run-1']);

        invalidateBattleAuthority(SLUG);
        await kv.set('solo-pve:run-1', soloSession('run-1', { status: 'done', winner: 'player', outcome: 'win' }));
        const done = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-1') }), deps());
        assert.equal(done.inBattle, false, 'a finished session grants no immunity even if the projection lingers');

        invalidateBattleAuthority(SLUG);
        await kv.set('solo-pve:run-1', soloSession('run-1', { expiresAt: NOW - 1 }));
        const lapsed = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-1') }), deps());
        assert.equal(lapsed.inBattle, false, 'a session past its gameplay expiry grants no immunity');
        assert.deepEqual(lapsed.lapsed, { kind: 'solo-pve', sessionId: 'run-1' }, 'and is reported for terminalization (F08)');
    });

    it('a Tower or PvP hint past its own clock is reported lapsed without a read; a Solo-PvE fight is judged by its session', async () => {
        const verdict = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('tower-2', { kind: 'tower', expiresAt: NOW - 1 }) }), deps());
        assert.equal(verdict.inBattle, false);
        assert.deepEqual(verdict.lapsed, { kind: 'tower', sessionId: 'tower-2' });
        assert.deepEqual(reads, []);

        // A long fight refreshes its own expiry on every action while the hint
        // keeps the creation-time one: the session is the verdict, never the hint.
        invalidateBattleAuthority(SLUG);
        await kv.set('solo-pve:run-2', soloSession('run-2', { expiresAt: NOW + 60_000 }));
        const long = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-2', { expiresAt: NOW - 1 }) }), deps());
        assert.deepEqual(long, { inBattle: true, source: 'solo-pve' }, 'still immune an hour into the fight');
        assert.deepEqual(reads, ['solo-pve:run-2']);

        // A projection whose session is gone is stale: reported so that it retires.
        invalidateBattleAuthority(SLUG);
        await kv.del('solo-pve:run-2');
        const gone = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-2') }), deps());
        assert.equal(gone.inBattle, false);
        assert.deepEqual(gone.lapsed, { kind: 'solo-pve', sessionId: 'run-2' });
    });

    it('a Chronicle card duel is proven by its session row for each duelist while the match is live', async () => {
        const duel = (over: Record<string, unknown> = {}) => ({ p1Name: 'Rill', p2Name: 'Kaede', status: 'active', ...over });
        const cardProjection = () => projection('cc-freeplay:m1', { kind: 'card-clash' });
        await kv.set('cc-freeplay:m1', duel());
        const live = await resolveBattleAuthority(SLUG, evidence({ battleState: cardProjection() }), deps());
        assert.deepEqual(live, { inBattle: true, source: 'card-clash' });
        assert.deepEqual(reads, ['cc-freeplay:m1']);

        invalidateBattleAuthority(SLUG);
        await kv.set('cc-freeplay:m1', { p1Name: 'Rill', status: 'awaiting-opponent' });
        const waiting = await resolveBattleAuthority(SLUG, evidence({ battleState: cardProjection() }), deps());
        assert.equal(waiting.inBattle, false, 'an open seat is not a fight — a challenge is never a roaming shield');

        invalidateBattleAuthority(SLUG);
        await kv.set('cc-freeplay:m1', duel({ status: 'done' }));
        const done = await resolveBattleAuthority(SLUG, evidence({ battleState: cardProjection() }), deps());
        assert.equal(done.inBattle, false);
        assert.deepEqual(done.lapsed, { kind: 'card-clash', sessionId: 'cc-freeplay:m1' }, 'a finished duel only retires its projection');

        invalidateBattleAuthority(SLUG);
        await kv.set('cc-freeplay:m1', duel({ p1Name: 'Kaede', p2Name: 'Sora' }));
        const stranger = await resolveBattleAuthority(SLUG, evidence({ battleState: cardProjection() }), deps());
        assert.equal(stranger.inBattle, false, 'a duel between others proves nothing for this player');
    });

    it('a PvP reservation proves a fight while fresh; an active pointer needs its session active', async () => {
        const fresh = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-1', { phase: 'reserving', reservedUntil: NOW + 10_000 }) }), deps());
        assert.deepEqual(fresh, { inBattle: true, source: 'pvp' });
        invalidateBattleAuthority(SLUG);
        const stale = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-1', { phase: 'reserving', reservedUntil: NOW - 1 }) }), deps());
        assert.equal(stale.inBattle, false, 'an expired reservation is not a fight');

        invalidateBattleAuthority(SLUG);
        await kv.set('pvp:duel-1', { battleId: 'duel-1', status: 'active', createdAt: NOW - 5_000, lastMoveAt: NOW - 1_000, rewardAuthority: 'world' });
        const active = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-1') }), deps());
        assert.deepEqual(active, { inBattle: true, source: 'pvp' });
        assert.deepEqual(reads, ['pvp:duel-1']);

        invalidateBattleAuthority(SLUG);
        await kv.set('pvp:duel-1', { battleId: 'duel-1', status: 'done', winner: 'p1', createdAt: NOW - 5_000 });
        const done = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-1') }), deps());
        assert.equal(done.inBattle, false);
    });

    it('a PvP pointer that already carries its terminal recovery deadline is a finished duel — no read', async () => {
        const verdict = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-9', { recoveryExpiresAt: NOW + 48 * 3_600_000 }) }), deps());
        assert.equal(verdict.inBattle, false);
        assert.deepEqual(reads, []);
    });

    it('a lapsed PvP session (nobody touched it for a whole session TTL) grants no immunity and is reported', async () => {
        await kv.set('pvp:duel-2', { battleId: 'duel-2', status: 'active', createdAt: NOW - 60 * 60_000, lastMoveAt: NOW - 20 * 60_000, rewardAuthority: 'world' });
        const verdict = await resolveBattleAuthority(SLUG, evidence({ pvpPointer: pointer('duel-2') }), deps());
        assert.equal(verdict.inBattle, false);
        assert.deepEqual(verdict.lapsed, { kind: 'pvp', sessionId: 'duel-2' });
    });

    it('the generic AI-fight pointer proves a live session that predates the projection', async () => {
        await kv.set('solo-pve:run-3', soloSession('run-3'));
        const verdict = await resolveBattleAuthority(SLUG, evidence({ aiFightPointer: { playerName: SLUG, token: 't', sessionId: 'run-3' } }), deps());
        assert.deepEqual(verdict, { inBattle: true, source: 'solo-pve' });
    });

    it('a pet duel proves a fight while it runs, and while pending for the side that has committed', async () => {
        const running = await resolveBattleAuthority(SLUG, evidence(), { ...deps(), petDuelFor: () => ({ status: 'running' }) });
        assert.deepEqual(running, { inBattle: true, source: 'pet-duel' });

        const invite = { status: 'pending', p1: { name: SLUG, ready: true }, p2: { name: 'mira', ready: false } };
        const challenger = await resolveBattleAuthority(SLUG, evidence(), { ...deps(), petDuelFor: () => invite });
        assert.deepEqual(challenger, { inBattle: true, source: 'pet-duel' }, 'the challenger is committed from the moment the invite goes out');
        const target = await resolveBattleAuthority('mira', evidence(), { ...deps(), petDuelFor: () => invite });
        assert.equal(target.inBattle, false, 'a target who has not answered is not in a fight');
        const accepted = { status: 'pending', p1: { name: SLUG, ready: true }, p2: { name: 'Mira', ready: true } };
        const acceptedTarget = await resolveBattleAuthority('mira', evidence(), { ...deps(), petDuelFor: () => accepted });
        assert.deepEqual(acceptedTarget, { inBattle: true, source: 'pet-duel' }, 'accepting commits the target, display casing notwithstanding');

        const noSides = await resolveBattleAuthority(SLUG, evidence(), { ...deps(), petDuelFor: () => ({ status: 'pending' }) });
        assert.equal(noSides.inBattle, false, 'a pending entry naming nobody proves nothing');
        const over = await resolveBattleAuthority(SLUG, evidence(), { ...deps(), petDuelFor: () => ({ status: 'finished', p1: { name: SLUG, ready: true } }) });
        assert.equal(over.inBattle, false);
    });

    it('a Hollow Gate dive is proven by its run key for as long as the key exists, whatever the projection clock says', async () => {
        await kv.set('hg-run:rill:tok-1', { mintedAt: NOW });
        const live = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('tok-1', { kind: 'hollow-gate' }) }), deps());
        assert.deepEqual(live, { inBattle: true, source: 'hollow-gate' });
        assert.deepEqual(reads, ['hg-run:rill:tok-1']);

        invalidateBattleAuthority(SLUG);
        const stale = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('tok-1', { kind: 'hollow-gate', expiresAt: NOW - 1 }) }), deps());
        assert.equal(stale.inBattle, true, 'the hint expiring does not end a dive that is still live');

        invalidateBattleAuthority(SLUG);
        await kv.del('hg-run:rill:tok-1'); // settled or died
        const over = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('tok-1', { kind: 'hollow-gate' }) }), deps());
        assert.equal(over.inBattle, false);
        assert.deepEqual(over.lapsed, { kind: 'hollow-gate', sessionId: 'tok-1' }, 'the stale projection is reported so it can be retired');
    });

    it('a pet showdown is proven by its unfinished session; a finished one grants nothing', async () => {
        await kv.set('pet:showdown:rill:sd-1', { sessionId: 'sd-1', playerName: SLUG, finished: false });
        const live = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('sd-1', { kind: 'pet-showdown' }) }), deps());
        assert.deepEqual(live, { inBattle: true, source: 'pet-showdown' });

        invalidateBattleAuthority(SLUG);
        await kv.set('pet:showdown:rill:sd-1', { sessionId: 'sd-1', playerName: SLUG, finished: true, outcome: 'win' });
        const done = await resolveBattleAuthority(SLUG, evidence({ battleState: projection('sd-1', { kind: 'pet-showdown' }) }), deps());
        assert.equal(done.inBattle, false);
        assert.deepEqual(done.lapsed, { kind: 'pet-showdown', sessionId: 'sd-1' });
    });

    it('a legacy pet battle is proven by its active pointer AND the sealed token it names', async () => {
        const dangling = await resolveBattleAuthority(SLUG, evidence({ petBattleActive: 'tok-9' }), deps());
        assert.equal(dangling.inBattle, false, 'a pointer whose token is gone proves nothing');

        invalidateBattleAuthority(SLUG);
        await kv.set('pet:battle-token:rill:tok-9', { playerName: SLUG, seed: 7 });
        const live = await resolveBattleAuthority(SLUG, evidence({ petBattleActive: 'tok-9' }), deps());
        assert.deepEqual(live, { inBattle: true, source: 'pet-battle' });

        invalidateBattleAuthority(SLUG);
        await kv.set('pet:battle-token:rill:tok-9', { playerName: SLUG, seed: 7, settledAt: NOW });
        const settled = await resolveBattleAuthority(SLUG, evidence({ petBattleActive: 'tok-9' }), deps());
        assert.equal(settled.inBattle, false, 'a tombstoned token is a finished fight');
    });

    it('caches a verdict per player for the same evidence, and re-reads on new evidence or invalidation', async () => {
        await kv.set('solo-pve:run-4', soloSession('run-4'));
        const ev = evidence({ battleState: projection('run-4') });
        await resolveBattleAuthority(SLUG, ev, deps());
        await resolveBattleAuthority(SLUG, ev, deps());
        assert.deepEqual(reads, ['solo-pve:run-4'], 'one read serves both beats');
        await resolveBattleAuthority(SLUG, ev, { ...deps(), now: () => NOW + BATTLE_AUTHORITY_CACHE_MS + 1 });
        assert.equal(reads.length, 2, 'the cache expires');
        await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-5') }), deps());
        assert.equal(reads.length, 3, 'different evidence is never served from cache');
        invalidateBattleAuthority(SLUG);
        await resolveBattleAuthority(SLUG, evidence({ battleState: projection('run-5') }), deps());
        assert.equal(reads.length, 4, 'a fight-start/terminal hook invalidates');
    });
});
