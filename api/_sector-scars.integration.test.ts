/*
 * Storage integration for sector scars and contract progress.
 *
 * The pure shapes are unit-tested; this pins that the WRITES reach real storage
 * under the real keys, and that the read paths the endpoints use find them
 * again. Runs the shipped code against the in-memory KV backend — no database,
 * no secrets.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contractSectorsForDay, sectorContractFor, utcDayOf } from '../shared/sector-contracts.js';
import { MAX_SCARS_PER_SECTOR } from '../shared/sector-scars.js';
import { WILD_SECTOR_IDS } from '../shared/sector-geo.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let scars: typeof import('./_sector-scars.js');
let contracts: typeof import('./_sector-contracts.js');

const SECTOR = 12;
const PLAYER = 'scarred';
const DAY = utcDayOf(Date.now());
const BOARD = contractSectorsForDay(DAY);
// Pick by CONDITION, never by position. Taking BOARD[0] blindly lands on a
// night-only posting on some days, and then the plain progress assertions fail
// against a gate that is doing its job — which is exactly how this fixture
// first went red.
const POSTED = BOARD.find((sector) => !sectorContractFor(sector, DAY)!.nightOnly)!;
const NIGHT_POSTED = BOARD.find((sector) => sectorContractFor(sector, DAY)!.nightOnly);
const UNPOSTED = WILD_SECTOR_IDS.find((sector) => !BOARD.includes(sector))!;

// Fixed instants on TODAY (the day the board belongs to), so the contract
// lookup inside the credit path resolves to the same posting either way.
const midday = new Date(Date.now());
const NOON = Date.UTC(midday.getUTCFullYear(), midday.getUTCMonth(), midday.getUTCDate(), 12);
const MIDNIGHT = Date.UTC(midday.getUTCFullYear(), midday.getUTCMonth(), midday.getUTCDate(), 23);

before(async () => {
    ({ kv } = await import('./_storage.js'));
    scars = await import('./_sector-scars.js');
    contracts = await import('./_sector-contracts.js');
});

beforeEach(async () => {
    for (const key of await kv.keys('world:scars:*')) await kv.del(key);
    for (const key of await kv.keys('world:contract*')) await kv.del(key);
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

describe('sector scars in storage', () => {
    it('a recorded duel is readable back under the sector key', async () => {
        await scars.recordSectorDuelScar(SECTOR, 'Kaze', 'Rin');
        const found = await scars.readSectorScars(SECTOR);
        assert.equal(found.length, 1);
        assert.equal(found[0].victor, 'Kaze');
        assert.equal(found[0].fallen, 'Rin');
        assert.ok(found[0].at > 0);
        // ...and it lands on the key the row is documented to use.
        assert.ok(await kv.get(scars.sectorScarsKey(SECTOR)), 'world:scars:<sector> must hold the row');
    });

    it('a sector nobody has fought in reads empty, not undefined', async () => {
        assert.deepEqual(await scars.readSectorScars(SECTOR + 1), []);
    });

    it('refuses to mark an off-board sector or a nameless victor', async () => {
        await scars.recordSectorDuelScar(99, 'Kaze', 'Rin');       // Death's Gate is not a trace sector
        await scars.recordSectorDuelScar(0, 'Kaze', 'Rin');
        await scars.recordSectorDuelScar(SECTOR, '   ', 'Rin');
        assert.deepEqual(await scars.readSectorScars(99), []);
        assert.deepEqual(await scars.readSectorScars(SECTOR), []);
    });

    it('one victor holds one line no matter how many times they win here', async () => {
        for (let i = 0; i < MAX_SCARS_PER_SECTOR + 4; i++) {
            await scars.recordSectorDuelScar(SECTOR, 'Kaze', `Victim${i}`);
        }
        const found = await scars.readSectorScars(SECTOR);
        assert.equal(found.length, 1, 'farming one sector must not fill the board');
        assert.equal(found[0].fallen, `Victim${MAX_SCARS_PER_SECTOR + 3}`);
    });

    it('keeps at most the cap, newest first, across many victors', async () => {
        for (let i = 0; i < MAX_SCARS_PER_SECTOR + 5; i++) {
            await scars.recordSectorDuelScar(SECTOR, `Fighter${i}`, 'Rin');
        }
        const found = await scars.readSectorScars(SECTOR);
        assert.equal(found.length, MAX_SCARS_PER_SECTOR);
        for (let i = 1; i < found.length; i++) assert.ok(found[i].at <= found[i - 1].at);
    });
});

describe('contract progress in storage', () => {
    it('an explore on a posted sector ticks progress and reports it back', async () => {
        const first = await contracts.creditSectorContractProgress(PLAYER, POSTED, NOON);
        assert.equal(first?.progress, 1);
        const second = await contracts.creditSectorContractProgress(PLAYER, POSTED, NOON);
        assert.equal(second?.progress, 2);
        assert.equal((await contracts.readSectorContractStatus(PLAYER, POSTED, NOON)).progress, 2);
    });

    it('an explore on an unposted sector writes nothing at all', async () => {
        assert.equal(await contracts.creditSectorContractProgress(PLAYER, UNPOSTED, NOON), null);
        assert.equal(await kv.get(contracts.contractProgressKey(PLAYER, UNPOSTED, DAY)), null);
    });

    it('progress becomes claimable exactly at the target', async () => {
        const contract = sectorContractFor(POSTED, DAY)!;
        for (let i = 0; i < contract.target; i++) {
            const status = await contracts.creditSectorContractProgress(PLAYER, POSTED, NOON);
            assert.equal(status?.claimable, i + 1 >= contract.target, `after ${i + 1} of ${contract.target}`);
        }
    });

    // The gate that makes "which sector" into "which sector, right now", proved
    // in the real write path rather than only against the pure helper.
    it('a night posting does not tick in daylight, and does after dark', async (t) => {
        if (NIGHT_POSTED === undefined) return t.skip('no night posting on this board');

        const daylight = await contracts.creditSectorContractProgress(PLAYER, NIGHT_POSTED, NOON);
        assert.equal(daylight?.progress, 0, 'daylight work must not count');
        assert.equal(daylight?.acceptingWork, false);
        assert.equal(await kv.get(contracts.contractProgressKey(PLAYER, NIGHT_POSTED, DAY)), null,
            'a refused tick must not even create the row');

        const afterDark = await contracts.creditSectorContractProgress(PLAYER, NIGHT_POSTED, MIDNIGHT);
        assert.equal(afterDark?.progress, 1, 'night work must count');
        assert.equal(afterDark?.acceptingWork, true);
    });

    // Banked work is collectable at any hour: the window gates EARNING, not
    // collecting, so nobody is told to wake up to be paid.
    it('night progress stays claimable when the sun comes up', async (t) => {
        if (NIGHT_POSTED === undefined) return t.skip('no night posting on this board');
        const contract = sectorContractFor(NIGHT_POSTED, DAY)!;
        for (let i = 0; i < contract.target; i++) {
            await contracts.creditSectorContractProgress(PLAYER, NIGHT_POSTED, MIDNIGHT);
        }
        const byDay = await contracts.readSectorContractStatus(PLAYER, NIGHT_POSTED, NOON);
        assert.equal(byDay.claimable, true, 'banked night work must claim in daylight');
        assert.equal(byDay.acceptingWork, false, '...while no NEW work counts');
    });

    it('the incident valve makes the hook a no-op that writes nothing', async () => {
        process.env.DISABLE_SECTOR_CONTRACTS = '1';
        try {
            assert.equal(await contracts.creditSectorContractProgress(PLAYER, POSTED, NOON), null);
            assert.deepEqual(await contracts.readSectorContractStatus(PLAYER, POSTED, NOON), contracts.NO_CONTRACT);
            assert.equal(await kv.get(contracts.contractProgressKey(PLAYER, POSTED, DAY)), null);
        } finally {
            delete process.env.DISABLE_SECTOR_CONTRACTS;
        }
    });
});
