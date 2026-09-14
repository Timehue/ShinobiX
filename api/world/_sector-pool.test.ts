import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-pool-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let pool: typeof import('./_sector-pool.js');
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let explore: Handler;
let openChest: Handler;

const SECTOR = 66;
const DAY_MS = 24 * 60 * 60 * 1000;
/*
 * FIXED CLOCK, deliberately. The pool row key is dated, and the handlers below
 * re-derive that date from their OWN clock read — so seeding a row from the wall
 * clock out here makes every handler test a race with UTC midnight (seed at
 * 23:59:59.9, handler reads 00:00:00.1, and the seeded row is simply a different
 * key). Freezing Date at NOW makes the explicit-`now` unit tests above and the
 * handler tests below address the same row. Only Date is mocked — the lock
 * backoff timers these tests exercise are real.
 */
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: NOW });
    ({ kv } = await import('../_storage.js'));
    pool = await import('./_sector-pool.js');
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    explore = (await import('./explore.js')).default as unknown as Handler;
    openChest = (await import('./open-chest.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of ['world:sector-pool:*', 'world:territory:*', 'save:poolplayer*', 'world-explore-receipt:poolplayer*', 'ratelimit:*poolplayer*', 'lock:*', 'pet-encounter:poolplayer*', 'pet-encounter-active:poolplayer*', 'pending-world-rewards:poolplayer*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('poolplayer')) onlineStore.remove(player.name);
    }
    delete process.env.DISABLE_VILLAGE_STORES;
});

after(() => {
    mock.timers.reset();
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.DISABLE_VILLAGE_STORES;
});

async function seedPool(explores: number, chests: number, now = NOW) {
    await kv.set(pool.sectorPoolKey(SECTOR, now), { explores, chests });
}

describe('shared sector gathering pool', () => {
    it('is generous by default and sized above the per-player ceilings', () => {
        assert.equal(pool.SECTOR_EXPLORE_POOL_PER_DAY, 1500);
        assert.equal(pool.SECTOR_CHEST_POOL_PER_DAY, 225);
        assert.equal(pool.OWNER_VILLAGE_POOL_BONUS, 0.5);
        assert.equal(pool.sectorPoolKey(SECTOR, NOW), 'world:sector-pool:66:2026-08-22');
    });

    it('reserves one slot per call and refuses at the cap without moving the counter', async () => {
        const first = await pool.reserveSectorPool(SECTOR, 'explores', 'Leaf', NOW);
        assert.equal(first.ok, true);
        assert.equal(first.used, 1);
        assert.equal(first.cap, 1500);
        assert.equal(first.view.exploresUsed, 1);
        assert.equal(first.view.chestsUsed, 0);

        await seedPool(1500, 0);
        const refused = await pool.reserveSectorPool(SECTOR, 'explores', 'Leaf', NOW);
        assert.equal(refused.ok, false);
        assert.equal(refused.used, 1500);
        assert.deepEqual(pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))), { explores: 1500, chests: 0 });
        // Chest pool is an independent counter on the same row.
        const chest = await pool.reserveSectorPool(SECTOR, 'chests', 'Leaf', NOW);
        assert.equal(chest.ok, true);
        assert.equal(chest.cap, 225);
        assert.deepEqual(pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))), { explores: 1500, chests: 1 });
    });

    it('gives the owning village a 50% larger pool, and only that village', async () => {
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: 'Leaf', ownerClan: 'Roots' });
        await seedPool(1500, 225);
        const outsider = await pool.reserveSectorPool(SECTOR, 'explores', 'Sand', NOW);
        assert.equal(outsider.ok, false);
        assert.equal(outsider.cap, 1500);
        const owner = await pool.reserveSectorPool(SECTOR, 'explores', 'Leaf', NOW);
        assert.equal(owner.ok, true);
        assert.equal(owner.cap, 2250);
        const ownerChest = await pool.reserveSectorPool(SECTOR, 'chests', 'Leaf', NOW);
        assert.equal(ownerChest.ok, true);
        assert.equal(ownerChest.cap, 337);
        const view = await pool.readSectorPool(SECTOR, 'Sand', NOW);
        assert.deepEqual(view, { exploresUsed: 1501, exploresCap: 1500, chestsUsed: 226, chestsCap: 225 });
    });

    it('rolls over at the UTC day boundary', async () => {
        await seedPool(1500, 225);
        const refused = await pool.reserveSectorPool(SECTOR, 'explores', undefined, NOW);
        assert.equal(refused.ok, false);
        const tomorrow = await pool.reserveSectorPool(SECTOR, 'explores', undefined, NOW + DAY_MS);
        assert.equal(tomorrow.ok, true);
        assert.equal(tomorrow.used, 1);
        const usage = await pool.readAllSectorPoolUsage(NOW + DAY_MS);
        assert.deepEqual(usage, { [SECTOR]: { explores: 1, chests: 0 } });
        assert.deepEqual(await pool.readAllSectorPoolUsage(NOW), { [SECTOR]: { explores: 1500, chests: 225 } });
    });

    it('serializes concurrent reservations: two racing at cap-1 admit exactly one', async () => {
        await seedPool(1499, 0);
        const [a, b] = await Promise.all([
            pool.reserveSectorPool(SECTOR, 'explores', undefined, NOW),
            pool.reserveSectorPool(SECTOR, 'explores', undefined, NOW),
        ]);
        assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
        assert.deepEqual(pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))), { explores: 1500, chests: 0 });
    });

    it('takes a pre-resolved owner so the territory read stays OUT of the save lock', async () => {
        // `reserveSectorPool` runs nested inside `lock:save:<name>` (5s TTL).
        // Reading world:territory there spent that lock's budget on a KV
        // round-trip under exactly the crowd the pool exists for, so the caller
        // loads the frame once, before the lock, and passes it down.
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: 'Leaf' });
        const frame = await pool.loadSectorPoolFrame(SECTOR, NOW);
        assert.equal(frame.owner.ownerVillage, 'Leaf');
        assert.equal(pool.sectorPoolHasRoom(frame, 'chests', 'Leaf'), true);
        // The frame is authoritative for the whole request even if the row moves.
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: 'Sand' });
        const cached = await pool.reserveSectorPool(SECTOR, 'explores', 'Leaf', NOW, frame.owner);
        assert.equal(cached.cap, 2250, 'the cached owner is used, with no second read');
        const live = await pool.reserveSectorPool(SECTOR, 'explores', 'Leaf', NOW);
        assert.equal(live.cap, 1500, 'and without a frame it still resolves live');
    });

    it('reports no room once a frame snapshot is at the cap', async () => {
        await seedPool(1500, 225);
        const frame = await pool.loadSectorPoolFrame(SECTOR, NOW);
        assert.equal(pool.sectorPoolHasRoom(frame, 'explores', undefined), false);
        assert.equal(pool.sectorPoolHasRoom(frame, 'chests', undefined), false);
    });

    it('waits longer under contention than the default, but still inside the save lock', () => {
        const { maxAttempts, baseBackoffMs, ttlSec, failClosed } = pool.SECTOR_POOL_LOCK;
        assert.equal(failClosed, true, 'two explorers must never both win the last slot');
        assert.ok(maxAttempts > 5, 'more attempts than withKvLock default');
        // withLockCore backs off base * 2^attempt plus up to `base` of jitter.
        const worstCaseMs = Array.from({ length: maxAttempts }, (_, i) => baseBackoffMs * 2 ** i + baseBackoffMs)
            .reduce((sum, ms) => sum + ms, 0);
        assert.ok(worstCaseMs > 775, `worst-case wait ${worstCaseMs}ms must beat the old 5 x 25ms budget (775ms)`);
        assert.ok(worstCaseMs < 5_000, `worst-case wait ${worstCaseMs}ms must fit inside lock:save:<name>'s 5s TTL`);
        assert.ok(ttlSec >= 10, 'and the pool row lock itself gets generous headroom');
    });

    it('releases a reserved slot and never goes below zero', async () => {
        const taken = await pool.reserveSectorPool(SECTOR, 'chests', undefined, NOW);
        assert.equal(taken.ok, true);
        if (taken.ok) await taken.release();
        assert.deepEqual(pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))), { explores: 0, chests: 0 });
        await pool.releaseSectorPool(SECTOR, 'chests', NOW);
        assert.deepEqual(pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))), { explores: 0, chests: 0 });
    });
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.3.0.${playerName.length}` },
    } as never, output.res);
    // An exploration that rolls a BATTLE is an obligation (api/world/_pending-battle.ts):
    // the next exploration is refused until the fight is started. The client starts it
    // through ai-fight-start, which claims the one-use marker; these tests only measure
    // the pool, so claim the marker here exactly as a started fight would.
    const outcome = output.out.body?.outcome as Record<string, unknown> | undefined;
    if (outcome?.kind === 'battle' && typeof body.requestId === 'string') {
        const { exploreBattleMarkerKey } = await import('../missions/_generic-ai-fight-authority.js');
        await kv.set(exploreBattleMarkerKey(playerName, body.requestId), { playerName, token: 'fixture', sessionId: 'fixture', at: Date.now() });
    }
    return output.out;
}

async function seedPlayer(playerName: string, character: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: SECTOR,
        character: {
            name: playerName, village: 'Leaf', level: 50, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100,
            ryo: 0, inventory: [], itemStacks: [], ...character,
        },
    });
    onlineStore.upsert({ name: playerName, sector: SECTOR, character: { name: playerName, hp: 100, maxHp: 100 } });
}

const today = () => new Date(NOW).toISOString().slice(0, 10);
const ryoOf = async (playerName: string) => Number((await kv.get<{ character: { ryo: number } }>(`save:${playerName}`))?.character.ryo ?? 0);

describe('explore and chest settle against the shared sector pool', () => {
    it('explore pays normally and reports the pool, then refuses at the cap without paying', async () => {
        const player = 'poolplayerexplore';
        await seedPlayer(player);
        const paid = await post(explore, player, { sector: SECTOR, requestId: 'poolexplore00001', credit: 'full' });
        assert.equal(paid.statusCode, 200);
        const sectorPool = paid.body?.sectorPool as Record<string, number>;
        assert.equal(sectorPool.exploresUsed, 1);
        assert.equal(sectorPool.exploresCap, 1500);
        assert.equal(sectorPool.chestsCap, 225);
        // The payout itself depends on the (random) outcome — a discovered chest
        // defers its loot to open-chest — so prove settlement via the per-player
        // counter, which advances for every admitted tile regardless of outcome.
        const afterFirst = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
        assert.equal(afterFirst?.character.serverExploresToday, 1, 'the first explore settled');
        const ryoAfterFirst = await ryoOf(player);

        await kv.set(pool.sectorPoolKey(SECTOR, Date.now()), { explores: 1500, chests: 0 });
        const refused = await post(explore, player, { sector: SECTOR, requestId: 'poolexplore00002', credit: 'full' });
        assert.equal(refused.statusCode, 409);
        assert.equal(refused.body?.error, 'sector-depleted');
        assert.equal(refused.body?.reason, 'sector-depleted');
        assert.equal((refused.body?.sectorPool as Record<string, number>).exploresUsed, 1500);
        assert.equal(await ryoOf(player), ryoAfterFirst, 'a depleted sector pays nothing');
        const save = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
        assert.equal(save?.character.serverExploresToday, 1, 'the per-player count did not advance either');
        assert.equal(await kv.get(`world-explore-receipt:${player}:poolexplore00002`), null);

        // A replay of the paid receipt does not take a second slot.
        await kv.set(pool.sectorPoolKey(SECTOR, Date.now()), { explores: 7, chests: 0 });
        const replay = await post(explore, player, { sector: SECTOR, requestId: 'poolexplore00001', credit: 'full' });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.replayed, true);
        assert.equal((replay.body?.sectorPool as Record<string, number>).exploresUsed, 7);
    });

    it('a DISCOVERED chest always opens, even with the sector chest pool at its cap', async () => {
        // The regression this locks: open-chest used to reserve the shared chest
        // slot, so a chest the player already held — already counted against
        // their own daily chest limit at discovery — could be refused 409
        // forever. The client outbox classifies 409 as definitive and retires
        // the entry while the server-side pending mirror keeps re-importing it,
        // so the player got "picked clean for today" on a loop for loot that
        // could never be collected. Discovery reserves; open never refuses.
        const player = 'poolplayerchest';
        const discovery = (id: string, poolReserved: boolean) => ({
            id, sector: SECTOR, reward: { sector: SECTOR, xp: 0, ryo: 0 },
            outcome: { kind: 'chest', reservationDate: today(), reservationOrdinal: 1, ...(poolReserved ? { poolReserved: true } : {}) },
            at: Date.now(),
        });
        await seedPlayer(player, {
            redeemedSectorExplorations: [discovery('poolchestdisc0001', true), discovery('poolchestdisc0002', false)],
        });
        // A chest sealed by the new explore path already paid the pool at
        // discovery, so opening must NOT debit it a second time.
        await kv.set(pool.sectorPoolKey(SECTOR, Date.now()), { explores: 0, chests: 225 });
        const opened = await post(openChest, player, { sector: SECTOR, requestId: 'poolchestop00001', worldExploreRequestId: 'poolchestdisc0001' });
        assert.equal(opened.statusCode, 200, 'a pool-reserved chest opens at the cap');
        assert.equal((opened.body?.sectorPool as Record<string, number>).chestsUsed, 225, 'and takes no second slot');
        assert.equal((opened.body?.sectorPool as Record<string, number>).chestsCap, 225);
        const ryoAfterFirst = await ryoOf(player);
        assert.ok(ryoAfterFirst > 0);

        // A LEGACY discovery (sealed before the cutover) still tries to debit,
        // but a depleted pool is an over-draw, never a refusal.
        const legacy = await post(openChest, player, { sector: SECTOR, requestId: 'poolchestop00002', worldExploreRequestId: 'poolchestdisc0002' });
        assert.equal(legacy.statusCode, 200, 'a legacy chest is never stranded either');
        assert.ok(await ryoOf(player) > ryoAfterFirst, 'and it pays out');
        const save = await kv.get<{ character: { redeemedAncientChests?: unknown[] } }>(`save:${player}`);
        assert.equal(save?.character.redeemedAncientChests?.length, 2);
    });

    it('a legacy chest opened with room still debits exactly one shared slot', async () => {
        const player = 'poolplayerchestroom';
        await seedPlayer(player, {
            redeemedSectorExplorations: [{
                id: 'poolchestdisc0003', sector: SECTOR, reward: { sector: SECTOR, xp: 0, ryo: 0 },
                outcome: { kind: 'chest', reservationDate: today(), reservationOrdinal: 1 }, at: Date.now(),
            }],
        });
        const opened = await post(openChest, player, { sector: SECTOR, requestId: 'poolchestop00003', worldExploreRequestId: 'poolchestdisc0003' });
        assert.equal(opened.statusCode, 200);
        assert.equal((opened.body?.sectorPool as Record<string, number>).chestsUsed, 1);
    });

    it('an externalProof explore settles even in a fully depleted sector', async () => {
        // BLOCKER regression: the wild-pet / free-dungeon probes COMMIT server
        // state (a pet-encounter pointer with a 32-day TTL) BEFORE the explore
        // that settles them. Refusing that settle for `sector-depleted` left the
        // pointer uncleared, and every later explore in EVERY sector then
        // answered `pending-pet-discovery` — one discovery in a picked-clean
        // sector soft-locked exploring for the rest of the day.
        const player = 'poolplayerexternal';
        await seedPlayer(player);
        const token = 'petpooltoken0001';
        await kv.set(`pet-encounter:${player}:${token}`, { playerName: player, token, sector: SECTOR, mintedAt: Date.now(), pet: { id: 'wolf' } });
        await kv.set(pool.sectorPoolKey(SECTOR, Date.now()), { explores: 1500, chests: 225 });
        const settled = await post(explore, player, {
            sector: SECTOR, requestId: 'poolexternal0001', credit: 'tile',
            externalOutcomeProof: { kind: 'pet', token },
        });
        assert.equal(settled.statusCode, 200, 'a committed discovery must always be able to settle');
        assert.equal((settled.body?.outcome as Record<string, unknown>)?.kind, 'external');
        assert.deepEqual(
            pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, Date.now()))),
            { explores: 1500, chests: 225 },
            'and the exempt settle takes no slot rather than over-drawing the pool',
        );
        const save = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
        assert.equal(save?.character.serverExploresToday, 1, 'the tile still counts against the PLAYER limit');
        // The pointer is now bound to this receipt, so the next ordinary explore
        // is no longer blocked by a pending discovery.
        const bound = await kv.get<Record<string, unknown>>(`pet-encounter:${player}:${token}`);
        assert.equal(bound?.exploreReceiptId, 'poolexternal0001');
    });

    it('reserves the chest slot at DISCOVERY and stops rolling chests once it is spent', async () => {
        const player = 'poolplayerdiscovery';
        await seedPlayer(player);
        let chests = 0;
        for (let i = 0; i < 40; i++) {
            const out = await post(explore, player, { sector: SECTOR, requestId: `pooldiscover${String(i).padStart(5, '0')}`, credit: 'full' });
            assert.equal(out.statusCode, 200);
            const outcome = out.body?.outcome as Record<string, unknown> | undefined;
            if (outcome?.kind !== 'chest') continue;
            chests += 1;
            assert.equal(outcome.poolReserved, true, 'every discovered chest seals its shared slot');
            assert.equal((out.body?.sectorPool as Record<string, number>).chestsUsed, chests);
        }
        assert.deepEqual(
            pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, Date.now()))),
            { explores: 40, chests },
            'the chest counter tracks discoveries exactly, so nothing is owed at open',
        );

        // With the chest pool spent, the tile degrades to battle/quiet exactly
        // as it already does at the per-player chest ceiling — never refused,
        // and never minting a chest the pool cannot back.
        const spent = 'poolplayerspent';
        await seedPlayer(spent);
        await kv.set(pool.sectorPoolKey(SECTOR, Date.now()), { explores: 0, chests: 225 });
        for (let i = 0; i < 40; i++) {
            const out = await post(explore, spent, { sector: SECTOR, requestId: `poolspent000${String(i).padStart(4, '0')}`, credit: 'full' });
            assert.equal(out.statusCode, 200, 'a chest-spent sector still explores');
            assert.notEqual((out.body?.outcome as Record<string, unknown> | undefined)?.kind, 'chest');
        }
        assert.equal(
            pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, Date.now()))).chests, 225,
            'and the chest pool never over-draws',
        );
    });
    it('reserves NOTHING while the Village Stores kill switch is on', async () => {
        // api/_release-flags.ts promises DISABLE_VILLAGE_STORES turns every new
        // path into a no-op, and api/world-state.ts already drops the pool from
        // the world document. explore/open-chest used to debit the pool anyway,
        // so the switch left a contested cap silently throttling gathering — and
        // refusing tiles with `sector-depleted` — while showing players nothing.
        const player = 'poolplayerdisabled';
        await seedPlayer(player, {
            redeemedSectorExplorations: [{
                id: 'pooldisabledchest1', sector: SECTOR, reward: { sector: SECTOR, xp: 0, ryo: 0 },
                outcome: { kind: 'chest', reservationDate: today(), reservationOrdinal: 1 }, at: Date.now(),
            }],
        });
        // A pool that is already at BOTH caps: with the feature on, the explore
        // below would be refused 409 and the legacy chest would over-draw.
        await seedPool(1500, 225);
        process.env.DISABLE_VILLAGE_STORES = '1';

        const explored = await post(explore, player, { sector: SECTOR, requestId: 'pooldisabled00001', credit: 'full' });
        assert.equal(explored.statusCode, 200, 'a depleted sector cannot refuse while the feature is off');
        assert.equal(explored.body?.sectorPool, undefined, 'and the pool is not reported either');

        const opened = await post(openChest, player, { sector: SECTOR, requestId: 'pooldisabledop001', worldExploreRequestId: 'pooldisabledchest1' });
        assert.equal(opened.statusCode, 200);
        assert.equal(opened.body?.sectorPool, undefined);

        assert.deepEqual(
            pool.cleanSectorPoolRow(await kv.get(pool.sectorPoolKey(SECTOR, NOW))),
            { explores: 1500, chests: 225 },
            'no reservation and no release touched the row',
        );
        const save = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
        assert.equal(save?.character.serverExploresToday, 1, 'the PLAYER-side daily limit still applies');
    });
});
