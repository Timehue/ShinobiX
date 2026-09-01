import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let settleRaidTerritoryDamage: typeof import('./_raid-territory.js').settleRaidTerritoryDamage;
let raidTerritoryProofKey: typeof import('./_raid-territory.js').raidTerritoryProofKey;

// A sector with no `world:territory:<n>` row at all. Sectors 34-66 shipped in
// the 2026-07-29 expansion and were never seeded, so this is the LIVE state of
// more than half the map — not a synthetic edge case.
const VIRGIN_SECTOR = 59;
const TERRITORY_KEY = `world:territory:${VIRGIN_SECTOR}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleRaidTerritoryDamage, raidTerritoryProofKey } = await import('./_raid-territory.js'));
});

beforeEach(async () => {
    for (const pattern of [TERRITORY_KEY, 'raid-territory-proof:*', 'lock:*']) {
        const keys = pattern.includes('*') ? await kv.keys(pattern) : [pattern];
        if (keys.length) await kv.del(...keys);
    }
});

describe('settleRaidTerritoryDamage — sector with no territory row yet', () => {
    it('creates the row instead of CAS-ing against a row that was never stored', async () => {
        assert.equal(await kv.get(TERRITORY_KEY), null, 'precondition: sector row is absent');

        // Regression: the default row is a PROJECTION, not a stored predecessor.
        // Passing it as the CAS `expected` compiles to `UPDATE ... WHERE value =
        // ?`, which matches nothing on an absent key, so this threw
        // raid-territory-row-conflict on every attempt — permanently 503-ing the
        // PvP reward claim and pinning both fighters on the victory screen.
        const result = await settleRaidTerritoryDamage({
            playerName: 'virginsector',
            proofId: 'pvp-raid:pvp-virgin-sector-battle',
            sector: VIRGIN_SECTOR,
            eventAt: 1788284888806,
            evidence: {
                version: 1,
                sector: VIRGIN_SECTOR,
                ownerClan: '',
                ownerVillage: '',
                raidDamage: 0,
                observedAt: 1788284833633,
            },
        });

        assert.equal(result.replayed, false);
        assert.equal(result.amount, 0, 'an unowned sector takes no territory damage');
        assert.equal(result.sector, VIRGIN_SECTOR);

        const row = await kv.get<Record<string, unknown>>(TERRITORY_KEY);
        assert.ok(row, 'the settle must have created the sector row');
        assert.equal(row.hp, 20_000);
        assert.equal(row.sector, VIRGIN_SECTOR);
        assert.ok(
            !Object.prototype.hasOwnProperty.call(row, 'serverRaidDamagePending'),
            'the pending pin must be cleared once the durable receipt is published',
        );

        const durable = await kv.get(raidTerritoryProofKey('pvp-raid:pvp-virgin-sector-battle'));
        assert.ok(durable, 'the per-proof terminal receipt must be published');
    });

    it('replays the same proof idempotently once the row exists', async () => {
        const params = {
            playerName: 'virginsector',
            proofId: 'pvp-raid:pvp-virgin-sector-replay',
            sector: VIRGIN_SECTOR,
            eventAt: 1788284888806,
        };
        const first = await settleRaidTerritoryDamage(params);
        const second = await settleRaidTerritoryDamage(params);

        assert.equal(first.replayed, false);
        assert.equal(second.replayed, true);
        assert.equal(second.amount, first.amount);
        assert.equal(second.hpAfter, first.hpAfter);
    });

    it('still settles with no sealed evidence (the AI-raid path)', async () => {
        const result = await settleRaidTerritoryDamage({
            playerName: 'virginsector',
            proofId: 'raid-token:virgin-sector-ai',
            sector: VIRGIN_SECTOR,
            eventAt: 1788284888806,
        });

        // No ownerClan on a virgin row, so there is nothing to damage — but it
        // must RESOLVE rather than throw the claim into a permanent retry loop.
        assert.equal(result.amount, 0);
        assert.ok(await kv.get(TERRITORY_KEY), 'the sector row must exist afterwards');
    });
});
