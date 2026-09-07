process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'heartbeat-battle-test-admin';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter } from '../pvp/session.js';
import type { SoloPveSession } from '../solo-pve/_session.js';

/*
 * F01 — the heartbeat no longer takes `inBattle` from the client. It derives
 * the flag from what the combat stores prove and sets presence accordingly,
 * so a tampered beat can neither buy immunity nor clear a real fight.
 *
 * F08 — the same beat notices a Solo-PvE session that lapsed and terminalizes
 * it from its own evidence (abandon rule at the HP it lapsed with), settling
 * the physical consequence onto the save, without the client's cooperation.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let attackBlock: typeof import('../_realtime/presence-gating.js').attackBlock;
let createSoloPveSession: typeof import('../solo-pve/_session.js').createSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let battleStateKey: typeof import('../_realtime/battle-projection.js').battleStateKey;
let resetBattleAuthorityCacheForTests: typeof import('../_realtime/battle-projection.js').resetBattleAuthorityCacheForTests;
let resetLapseReconciliationForTests: typeof import('../_battle-lapse.js').resetLapseReconciliationForTests;
let PET_BREEDING_MIGRATION_VERSION: number;
let handler: Handler;

const PLAYER = 'battlebeatplayer';
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function beat(body: Json) {
    const ip = `10.61.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { name: PLAYER, sector: 12, character: { level: 20 }, tile: 5, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

function fighter(name: string, hp: number, maxHp = 100): PvpFighter {
    return {
        name, hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: name === 'Battler' ? 62 : 63,
        character: { name, level: 20, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function soloSession(sessionId: string, over: Partial<SoloPveSession> = {}): SoloPveSession {
    return {
        ...createSoloPveSession({
            sessionId, ownerSlug: PLAYER,
            encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: sessionId },
            player: fighter('Battler', 80), enemy: fighter('Enemy', 50), now: Date.now(),
        }),
        ...over,
    };
}

async function seedSave(hp: number) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: NOW,
        character: { name: PLAYER, level: 20, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, inventory: [] },
    });
}

async function character(): Promise<Json> {
    return (await kv.get<Json>(`save:${PLAYER}`))?.character as Json;
}

async function settleQueue() {
    // The lapse reconciliation is fire-and-forget off the hot path.
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ attackBlock } = await import('../_realtime/presence-gating.js'));
    ({ createSoloPveSession } = await import('../solo-pve/_session.js'));
    ({ writeSoloPveSession, readSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ battleStateKey, resetBattleAuthorityCacheForTests } = await import('../_realtime/battle-projection.js'));
    ({ resetLapseReconciliationForTests } = await import('../_battle-lapse.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./heartbeat.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    onlineStore.remove(PLAYER);
    resetBattleAuthorityCacheForTests();
    resetLapseReconciliationForTests();
});

after(async () => {
    onlineStore.remove(PLAYER);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('heartbeat — battle status is proven by the server, never claimed (F01)', { concurrency: false }, () => {
    it('a beat claiming inBattle buys no immunity when no store proves a fight', async () => {
        const out = await beat({ inBattle: true });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const presence = onlineStore.get(PLAYER);
        assert.ok(presence);
        assert.equal(presence.inBattle, undefined, 'the claim set nothing');
        assert.equal(attackBlock(presence), null, 'and the player is attackable');
    });

    it('a real Solo-PvE session makes the player in battle even while the client claims otherwise; its end clears it', async () => {
        await writeSoloPveSession(soloSession('beat-run-1'));
        onlineStore.remove(PLAYER); // the start hook only reaches a present row; the beat must prove it from the store
        const out = await beat({ inBattle: false });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(onlineStore.get(PLAYER)?.inBattle, true, 'proven from the session the projection names');
        assert.equal(attackBlock(onlineStore.get(PLAYER))?.status, 409, 'immunity follows the proof');

        await writeSoloPveSession({ ...soloSession('beat-run-1'), version: 2, status: 'done', winner: 'player', outcome: 'win' });
        assert.equal(await kv.get(battleStateKey(PLAYER)), null, 'the terminal write retires the projection');
        const after = await beat({ inBattle: true });
        assert.equal(after.statusCode, 200);
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined, 'and a claim cannot keep it alive');
    });

    it('a Tower lease proves a fight without a session read', async () => {
        await kv.set(`battle-lock:${PLAYER}`, { battleId: 'tower-1', kind: 'tower-battle', screen: 'towerBattle', startedAt: Date.now(), meta: { runId: 'tower-1' } }, { ex: 60 });
        await beat({});
        assert.equal(onlineStore.get(PLAYER)?.inBattle, true);
        await kv.del(`battle-lock:${PLAYER}`);
        resetBattleAuthorityCacheForTests();
        await beat({});
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined);
    });
});

describe('heartbeat — a lapsed Solo-PvE session is terminalized from its own evidence (F08)', { concurrency: false }, () => {
    it('terminalizes the lapse as an abandon at the HP it lapsed with and settles the save, without the client', async () => {
        await seedSave(100);
        const session = soloSession('beat-run-2', { player: fighter('Battler', 35) });
        await writeSoloPveSession(session);
        // Time passes: the fight lapses. Age the row and its projection in place.
        const lapsedAt = Date.now() - 60_000;
        await kv.set(`solo-pve:${session.sessionId}`, { ...session, expiresAt: lapsedAt });
        await kv.set(battleStateKey(PLAYER), { version: 1, kind: 'solo-pve', sessionId: session.sessionId, startedAt: session.createdAt, expiresAt: lapsedAt });
        onlineStore.remove(PLAYER);

        const out = await beat({ inBattle: true });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(onlineStore.get(PLAYER)?.inBattle, undefined, 'a lapsed fight grants no immunity');
        await settleQueue();

        const terminal = await readSoloPveSession(session.sessionId);
        assert.equal(terminal?.status, 'done');
        assert.equal(terminal?.outcome, 'loss');
        assert.equal(terminal?.terminalEvidence?.lapsedAt, lapsedAt);
        assert.equal(terminal?.player.hp, 25, 'the abandon cost from the HP the player last stood at');
        const char = await character();
        assert.equal(char.hp, 25, 'the physical consequence reached the save');
        assert.notEqual(char.hospitalized, true, 'no knockout was invented');
        assert.equal(await kv.get(battleStateKey(PLAYER)), null, 'the projection is retired');
    });
});
