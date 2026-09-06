process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'fight-outcome-test-admin';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter } from '../pvp/session.js';
import type { SoloPveSession } from '../solo-pve/_session.js';

/*
 * /api/pve/fight-outcome — N03 / N04 / F06, driven through the mounted handler
 * over the in-memory KV.
 *
 *   N04  a storage failure is an outage (503, retryable), not "no fight";
 *        genuine absence is still the documented 200 `unknown`.
 *   N03  an ACTIVE Solo-PvE session is abandoned in the owning store FIRST
 *        (engine transition, sealed evidence), then settled; an active Tower
 *        session gets no premature physical receipt.
 *   F06  in a shared Tower run every human settles their OWN actor, and a
 *        legacy `pve-outcome:<runId>` marker written for a teammate does not
 *        suppress this player's consequence.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let createSoloPveSession: typeof import('../solo-pve/_session.js').createSoloPveSession;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let pveOutcomeReceiptKey: typeof import('./_fight-outcome-settlement.js').pveOutcomeReceiptKey;
let PET_BREEDING_MIGRATION_VERSION: number;

const NOW = 1_800_000_000_000;

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

async function post(playerName: string, runId: string) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName, runId },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.92' },
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res);
    return out;
}

function fighter(name: string, hp: number, maxHp = 100): PvpFighter {
    return {
        name, hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: name === 'Rill' ? 62 : 63,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

async function seedSave(slug: string, hp: number) {
    await kv.set(`save:${slug}`, {
        _saveVersion: 1,
        _saveAt: NOW,
        character: { name: slug, level: 10, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, inventory: [] },
    });
}

async function character(slug: string): Promise<Json> {
    return (await kv.get<Json>(`save:${slug}`))?.character as Json;
}

function towerSession(runId: string, over: Json = {}): Json {
    return {
        towerId: 'story-tower',
        runId,
        floor: 1,
        status: 'done',
        winner: 'enemy',
        actors: [
            { id: 'sq-0', side: 'squad', name: 'Rill', ownerSlug: 'rill', ai: false, hp: 40, maxHp: 100, statuses: [] },
            { id: 'sq-1', side: 'squad', name: 'Dopey', ownerSlug: 'dopey', ai: false, hp: 0, maxHp: 100, statuses: [] },
            { id: 'e-0', side: 'enemy', name: 'Boss', ownerSlug: null, ai: true, hp: 10, maxHp: 100, statuses: [] },
        ],
        ...over,
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ createSoloPveSession } = await import('../solo-pve/_session.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ pveOutcomeReceiptKey } = await import('./_fight-outcome-settlement.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./fight-outcome.js')).default as unknown as Handler;
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('/api/pve/fight-outcome', { concurrency: false }, () => {
    it('N04: a session-store failure is a retryable 503 that keeps the obligation, never a harmless unknown', async () => {
        await seedSave('rill', 100);
        const originalGet = kv.get;
        (kv as { get: unknown }).get = async (key: string) => {
            if (key.startsWith('solo-pve:')) throw new Error('storage-down');
            return originalGet.call(kv, key);
        };
        try {
            const out = await post('rill', 'outage-run');
            assert.equal(out.statusCode, 503, JSON.stringify(out.body));
            assert.equal(out.body?.retryable, true);
            assert.equal(out.body?.runId, 'outage-run', 'the pending identity rides the failure');
            assert.notEqual(out.body?.ok, true, 'must never look like a finished obligation');
        } finally {
            (kv as { get: unknown }).get = originalGet;
        }
        assert.equal((await character('rill')).hp, 100, 'an outage writes nothing');
    });

    it('N04: genuine absence stays the documented no-fabrication 200 unknown', async () => {
        await seedSave('rill', 100);
        const out = await post('rill', 'never-existed');
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.outcome, 'unknown');
        assert.equal(out.body?.applied, false);
        assert.equal((await character('rill')).hp, 100);
    });

    for (const kind of ['generic-ai', 'mission'] as const) {
        it(`N03: an ACTIVE ${kind} session is abandoned in the owning store first, then settled exactly once`, async () => {
            await seedSave('rill', 100);
            const runId = `active-${kind}-run`;
            const session = createSoloPveSession({
                sessionId: runId,
                ownerSlug: 'rill',
                encounter: { kind, id: kind === 'mission' ? 'combat-e-drill' : 'rival', ...(kind === 'mission' ? { bindingId: runId } : {}) },
                player: fighter('Rill', 100),
                enemy: fighter('Enemy', 50),
                now: NOW,
            });
            await writeSoloPveSession(session);

            const out = await post('rill', runId);
            assert.equal(out.statusCode, 200, JSON.stringify(out.body));
            assert.equal(out.body?.outcome, 'loss', 'an abandon is the engine\'s sealed loss, not a live-HP "forfeit"');
            assert.equal(out.body?.applied, true);

            const stored = await readSoloPveSession(runId);
            assert.equal(stored?.status, 'done', 'the owning store holds the terminal session');
            assert.equal(stored?.outcome, 'loss');
            assert.ok(stored?.terminalEvidence, 'terminal evidence was sealed before settlement read it');
            assert.equal(stored?.version, session.version + 1);

            const after = await character('rill');
            assert.equal(after.hp, 90, 'the engine\'s 10% abandon cost is what the body carries');
            assert.equal(after.hospitalized, undefined, 'a standing fighter is not admitted');

            // Replay: nothing moves again, and the session cannot be re-abandoned.
            const replay = await post('rill', runId);
            assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
            assert.equal(replay.body?.replayed, true);
            assert.equal((await character('rill')).hp, 90);
            assert.equal((await readSoloPveSession(runId))?.version, session.version + 1, 'no second transition');
        });
    }

    it('N03: an ACTIVE Tower session gets no premature physical receipt', async () => {
        await seedSave('rill', 100);
        await kv.set('tower:active-tower-run', towerSession('active-tower-run', { status: 'active', winner: null }));
        const out = await post('rill', 'active-tower-run');
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.reason, 'session-active');
        const after = await character('rill');
        assert.equal(after.hp, 100);
        assert.equal(after.serverSettlementReceipts, undefined, 'no receipt may be stamped');
        assert.equal(await kv.get(pveOutcomeReceiptKey('active-tower-run')), null);
    });

    it('F06: each human in a shared Tower run settles their OWN actor, and a teammate\'s legacy marker proves nothing', async () => {
        await seedSave('rill', 100);
        await seedSave('dopey', 100);
        await kv.set('tower:shared-tower-run', towerSession('shared-tower-run'));
        // A marker the previous generation wrote for the FIRST teammate.
        await kv.set(pveOutcomeReceiptKey('shared-tower-run'), { runId: 'shared-tower-run', playerName: 'rill', outcome: 'loss', at: NOW });

        const dopey = await post('dopey', 'shared-tower-run');
        assert.equal(dopey.statusCode, 200, JSON.stringify(dopey.body));
        assert.equal(dopey.body?.applied, true, 'rill\'s marker must not suppress dopey\'s outcome');
        const dopeyAfter = await character('dopey');
        assert.equal(dopeyAfter.hp, 0);
        assert.equal(dopeyAfter.hospitalized, true, 'dopey went down — dopey is admitted');

        const rill = await post('rill', 'shared-tower-run');
        assert.equal(rill.statusCode, 200, JSON.stringify(rill.body));
        const rillAfter = await character('rill');
        assert.equal(rillAfter.hospitalized, undefined, 'rill stood at 40 HP — not admitted on a teammate\'s knockout');
        // The marker named rill as already settled, so this replays without
        // moving HP — the body keeps what the save held (legacy behavior kept).
        assert.equal(rill.body?.replayed, true);

        const stranger = await post('nobody', 'shared-tower-run');
        assert.equal(stranger.statusCode, 403, 'membership is still the gate for a client-supplied runId');
    });
});
