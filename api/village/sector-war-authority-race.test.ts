import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-authority-race-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 23;
const ATTACKER_SECTOR = 24;
const ATTACKER = 'Moonshadow Village';
const OLD_DEFENDER = 'Frostfang Village';
const NEW_DEFENDER = 'Stormveil Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const ATTACKER_TERRITORY_KEY = `world:territory:${ATTACKER_SECTOR}`;
const ATTACKER_WR_KEY = 'shared:village-war:moonshadowvillage';
const CALLER_SAVE_KEY = 'save:authorityraceadmin';
const OLD_CONTEST_KEY = 'shared:sector-war:23:moonshadowvillage-vs-frostfangvillage';
const NEW_CONTEST_KEY = 'shared:sector-war:23:moonshadowvillage-vs-stormveilvillage';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const loaded = await import('./sector-war.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default
        ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: OLD_DEFENDER, hp: 20_000, updatedAt: Date.now() });
    await kv.set(ATTACKER_TERRITORY_KEY, { sector: ATTACKER_SECTOR, ownerVillage: ATTACKER, hp: 20_000, updatedAt: Date.now() });
    await kv.set(ATTACKER_WR_KEY, { warResources: 1_000, structures: {}, sectors: {} });
    await kv.set('shared:village-war:frostfangvillage', { warResources: 1_000, structures: {}, sectors: {} });
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

async function declare(): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: { action: 'declare', playerName: 'authorityraceadmin', village: ATTACKER, sector: SECTOR },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('sector-war declaration territory authority race', { concurrency: false }, () => {
    it('rebinds owner inside the publication lock and refuses a stale defender without debit or contest', async () => {
        const originalGet = kv.get.bind(kv);
        let territoryReads = 0;
        kv.get = (async <T>(key: string) => {
            if (key === TERRITORY_KEY) {
                territoryReads += 1;
                if (territoryReads === 2) {
                    // Deterministic interleave: the first admission read sealed
                    // Frostfang, then the authoritative row flips before the
                    // declaration's locked publication-time read.
                    await kv.set(TERRITORY_KEY, {
                        sector: SECTOR,
                        ownerVillage: NEW_DEFENDER,
                        hp: 20_000,
                        updatedAt: Date.now(),
                    });
                }
            }
            return originalGet<T>(key);
        }) as typeof kv.get;

        let response: ResponseOut;
        try {
            response = await declare();
        } finally {
            kv.get = originalGet as typeof kv.get;
        }

        assert.ok(territoryReads >= 2, 'the route must re-read territory authority at publication');
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body?.error), /changed owners/i);
        assert.equal((await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY))?.warResources, 1_000);
        assert.equal(await kv.get(OLD_CONTEST_KEY), null);
        assert.equal(await kv.get(NEW_CONTEST_KEY), null);
        const reservationKeys = await kv.keys('world:village-war-reservation:*');
        for (const key of reservationKeys) {
            const row = await kv.get<{ status?: string }>(key);
            assert.notEqual(row?.status, 'reserved', `${key} must not retain a live reservation`);
        }
    });

    // The hidden `funding` row is published before the two village rows are
    // promoted. When the promotion lost its race, the route answered "conflict"
    // and walked away from that row: it kept both villages blocked, from village
    // wars and from every other sector war on the defender, until this exact
    // attacker happened to declare on this sector again.
    it('aborts its unpaid declaration row when the village rows cannot be bound to it', async () => {
        const { villageWarReservationBlocks } = await import('../_war-village-reservation.js');
        const originalCompareSet = kv.compareSet.bind(kv);
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: unknown) => {
            if (key.startsWith('world:village-war-reservation:')
                && (value as { state?: string } | null)?.state === 'reserved') {
                return false; // a competing writer wins every promotion attempt
            }
            return originalCompareSet(key, expected as never, value as never, options as never);
        }) as typeof kv.compareSet;

        let response: ResponseOut;
        try {
            response = await declare();
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }

        assert.notEqual(response.statusCode, 200, JSON.stringify(response.body));
        const row = await kv.get<{ declarationFunding?: { status?: string } }>(OLD_CONTEST_KEY);
        assert.equal(row?.declarationFunding?.status, 'aborted', 'the unpaid row is aborted, not left funding');
        assert.equal((await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY))?.warResources, 1_000, 'nothing was spent');
        assert.equal(await villageWarReservationBlocks(kv, ATTACKER, Date.now()), false, 'the attacker is free');
        assert.equal(await villageWarReservationBlocks(kv, OLD_DEFENDER, Date.now()), false, 'and so is the defender');

        const retry = await declare();
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    });

    // A war past its whistle waits out the settlement grace before its verdict
    // is stamped, and that verdict may still flip the sector. Until it lands,
    // the sector is not open to a new declaration.
    it('refuses a new declaration while the last war on the sector awaits its verdict', async () => {
        const now = Date.now();
        const settlingId = `${SECTOR}:stormveilvillage-vs-frostfangvillage`;
        await kv.set(`shared:sector-war:${settlingId}`, {
            id: settlingId, sector: SECTOR, attackerVillage: NEW_DEFENDER, defenderVillage: OLD_DEFENDER,
            winCondition: 'combat', attackerPoints: 9, defenderPoints: 0,
            startedAt: now - 72 * 60 * 60 * 1000 - 60_000, endsAt: now - 60_000, updatedAt: now - 60_000,
            flipped: false, declarationGeneration: 1,
        });
        const blocked = await declare();
        assert.equal(blocked.statusCode, 409, JSON.stringify(blocked.body));
        assert.match(String(blocked.body?.error), /still being settled/);
        assert.equal((await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY))?.warResources, 1_000, 'nothing was spent');
        assert.equal(await kv.get(OLD_CONTEST_KEY), null, 'nothing was published');
    });

    // The debit lands on the attacker's War Resource record, which merc hires
    // and ticks, the daily stores pass and ANBU skims rewrite whole under that
    // record's lock. A declaration that debited without the lock could have its
    // debit, and the receipt that proves it, erased by such a rewrite.
    it('debits only while holding the lock every other War Resource writer uses', async () => {
        const lockKey = `lock:${ATTACKER_WR_KEY}`;
        await kv.set(lockKey, 'a-merc-hire-in-progress', { nx: true, ex: 30 });
        let blocked: ResponseOut;
        try {
            blocked = await declare();
        } finally {
            await kv.del(lockKey);
        }
        assert.equal(blocked.statusCode, 503, JSON.stringify(blocked.body));
        assert.equal((await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY))?.warResources, 1_000, 'nothing was spent');
        assert.equal(await kv.get(OLD_CONTEST_KEY), null, 'nothing was published');

        const retry = await declare();
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    });
});

/*
 * Why this route returns no `_saveVersion` (see api/save/_version-echo-coverage.test.ts):
 * a sector declaration spends the VILLAGE's War Resource pool, never a player's
 * Honor Seals, so _war-declaration-funding.ts takes its `war-resources` branch
 * and no player save is opened or versioned. There is no committed save version
 * to thread out. If this ever changes, the declaring player must be told.
 */
describe('sector-war declaration funding source', { concurrency: false }, () => {
    it('debits the village War Resource pool and versions no player save', async () => {
        const callerSave = {
            _saveVersion: 3,
            _saveAt: Date.now() - 1_000,
            character: { name: 'Authority Race Admin', village: ATTACKER, honorSeals: 800 },
        };
        await kv.set(CALLER_SAVE_KEY, callerSave);

        const response = await declare();
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));

        const pool = await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY);
        assert.ok(
            (pool?.warResources ?? 1_000) < 1_000,
            'the declaration must spend the attacking village’s War Resources',
        );

        const funding = (await kv.get<Record<string, unknown>>(OLD_CONTEST_KEY))?.declarationFunding as
            { status?: string; source?: { kind?: string; recordKey?: string } } | undefined;
        assert.equal(funding?.status, 'active');
        assert.equal(funding?.source?.kind, 'war-resources');
        assert.equal(funding?.source?.recordKey, ATTACKER_WR_KEY);

        // No `save:` row was touched at all, so the 200 has no save version to
        // echo and cannot strand a stale `_baseSaveVersion` on the client.
        assert.deepEqual(await kv.keys('save:*'), [CALLER_SAVE_KEY]);
        assert.deepEqual(await kv.get(CALLER_SAVE_KEY), callerSave);
    });

    it('pins an idempotent 72-hour siege warning for the owning clan', async () => {
        await kv.set(TERRITORY_KEY, {
            sector: SECTOR,
            ownerVillage: OLD_DEFENDER,
            ownerClan: 'Frost Wolves',
            hp: 20_000,
            updatedAt: Date.now(),
        });
        const clanKey = 'save:clan-frostwolves';
        await kv.set(clanKey, { name: 'Frost Wolves', notices: [] });

        const response = await declare();
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const clan = await kv.get<Record<string, unknown>>(clanKey);
        const notices = clan?.notices as Array<Record<string, unknown>>;
        assert.equal(notices.length, 1);
        assert.equal(notices[0]?.pinned, true);
        assert.match(String(notices[0]?.title), /Sector 23 is under siege/);
        assert.match(String(notices[0]?.body), /72-hour sector war/);

    });
});

describe('sector-war declaration World Herald', { concurrency: false }, () => {
    it('announces War Drums exactly once, even when the declaration is replayed', async () => {
        await kv.set(CALLER_SAVE_KEY, {
            _saveVersion: 3,
            _saveAt: Date.now() - 1_000,
            character: { name: 'Authority Race Admin', village: ATTACKER, honorSeals: 800 },
        });

        const first = await declare();
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        // A second identical declaration is refused (the contest is already
        // live) and must not re-announce. The announcement receipt is keyed on
        // the contest + generation, so a recovered/replayed activation of the
        // SAME declaration cannot post twice either.
        const second = await declare();
        assert.equal(second.statusCode, 409, JSON.stringify(second.body));

        const feed = (await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? [];
        const drums = feed.filter((a) => a.type === 'sector_war_declared');
        assert.equal(drums.length, 1, JSON.stringify(feed));
        assert.equal(drums[0].importance, 'high');
        assert.equal(drums[0].title, 'War Drums');
        assert.equal(
            drums[0].message,
            `${ATTACKER} has declared war on Sector ${SECTOR}, held by ${OLD_DEFENDER}. The contest runs 72 hours.`,
        );
        assert.match(String(drums[0].receiptId), /^sector-war-declared:23:moonshadowvillage-vs-frostfangvillage:g1\.s\d+$/);

        // High importance also lands as one herald line per village chat.
        const chat = (await kv.get<Array<Record<string, unknown>>>('chat:village:stormveil-village')) ?? [];
        assert.equal(chat.filter((m) => m.receiptId === drums[0].receiptId).length, 1);
    });

    // A defended war's record ages out a day after it settles, and the next
    // siege of that sector starts again at generation 1. Its drums (and the
    // holding clan's siege notice) used to be keyed `:g1` too, so the old war's
    // entries still in the capped feeds silently swallowed the new war's.
    it('beats the drums again for a new siege once the last war record has aged out', async () => {
        await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: OLD_DEFENDER, ownerClan: 'Frost Wolves', hp: 20_000, updatedAt: Date.now() });
        const clanKey = 'save:clan-frostwolves';
        await kv.set(clanKey, { name: 'Frost Wolves', notices: [] });

        const first = await declare();
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        await kv.del(OLD_CONTEST_KEY); // fought, settled, and expired
        const second = await declare();
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));

        const feed = (await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? [];
        assert.equal(feed.filter((a) => a.type === 'sector_war_declared').length, 2, 'each siege gets its own drums');
        const notices = ((await kv.get<Record<string, unknown>>(clanKey))?.notices ?? []) as Array<Record<string, unknown>>;
        assert.equal(notices.filter((n) => String(n.title).includes('under siege')).length, 2, 'and its own clan warning');
    });
});
