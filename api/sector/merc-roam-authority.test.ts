import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'merc-roam-authority-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

// The route stamps its own Date.now(), so the fixture clock must track the real
// one. A fixed future timestamp left the sector contest not yet started and the
// merc lease unreachable: every engage 409'd at "that mercenary is no longer
// here" before the deploy core ran, which made the authority test below
// unreachable and the forged-village test above pass for the wrong reason.
const NOW = Date.now();
const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const TRANSFERRED = 'Stormveil Village';
const PLAYER = 'target';
const HIRER = 'hirer';
const TIER = 'merc-ronin';
const MERC_ID = 'merc-moonshadowvillage-merc-ronin-0';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let sectorWarKey: typeof import('../_sector-war.js').sectorWarKey;
let newSectorWarSession: typeof import('../_sector-war.js').newSectorWarSession;
let villageWarKey: typeof import('../_war-state.js').villageWarKey;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorWarKey, newSectorWarSession } = await import('../_sector-war.js'));
    ({ villageWarKey } = await import('../_war-state.js'));
    const loaded = await import('./merc-roam.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default
        ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);

    const contest = newSectorWarSession({
        sector: SECTOR,
        attackerVillage: ATTACKER,
        defenderVillage: DEFENDER,
        winCondition: 'combat',
        now: NOW,
    });
    await kv.set(sectorWarKey(contest.id), contest);
    await kv.set(villageWarKey(ATTACKER), {
        warResources: 0,
        structures: {},
        sectors: {},
        mercLeases: [{ tierId: TIER, player: HIRER, expiresAt: NOW + 60_000, count: 2 }],
    });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function call(action: 'roster' | 'engage', bodyVillage: string): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: {
            action,
            playerName: PLAYER,
            village: bodyVillage,
            sector: SECTOR,
            ...(action === 'engage' ? { mercId: MERC_ID } : {}),
        },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

async function remainingBand(): Promise<number> {
    const row = await kv.get<{ mercLeases?: Array<{ tierId?: string; player?: string; count?: number }> }>(villageWarKey(ATTACKER));
    return Number(row?.mercLeases?.find((lease) => lease.tierId === TIER && lease.player === HIRER)?.count ?? 0);
}

describe('manual roaming-merc authority', { concurrency: false }, () => {
    it('ignores a body-forged village and cannot browse or burn its hostile band', async () => {
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: TRANSFERRED } });

        const roster = await call('roster', DEFENDER);
        assert.equal(roster.statusCode, 200);
        assert.deepEqual(roster.body?.mercs, []);

        const engage = await call('engage', DEFENDER);
        assert.equal(engage.statusCode, 409);
        assert.equal(await remainingBand(), 2);
        assert.equal(await kv.get(`merc:target-cd:${PLAYER}`), null);
    });

    it('revalidates target village under the save lock immediately before band spend', async () => {
        await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, village: DEFENDER } });
        const originalGet = kv.get.bind(kv);
        let targetReads = 0;
        kv.get = (async <T>(key: string) => {
            if (key === `save:${PLAYER}`) {
                targetReads += 1;
                if (targetReads === 2) {
                    // Admission saw a valid defender. Transfer lands before the
                    // deploy core's locked authority read; no merc may be spent.
                    await kv.set(key, { character: { name: PLAYER, village: TRANSFERRED } });
                }
            }
            return originalGet<T>(key);
        }) as typeof kv.get;

        let response: ResponseOut;
        try {
            response = await call('engage', DEFENDER);
        } finally {
            kv.get = originalGet as typeof kv.get;
        }

        assert.equal(targetReads, 2, 'the deploy core must re-read target authority after route admission');
        assert.equal(response.statusCode, 409);
        assert.equal(await remainingBand(), 2);
        assert.equal(await kv.get(`merc:target-cd:${PLAYER}`), null);
    });
});
