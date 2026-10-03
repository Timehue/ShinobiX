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

describe('settleRaidTerritoryDamage — writes read back from Postgres', () => {
    // A raid that lands after a breach deadline settles the breach first, which
    // leaves breachedAt and breachEndsAt explicitly undefined on the row it then
    // hits and pins. A Postgres read-back is the JSON form without those keys, so
    // a deep-equal judged each of these three writes lost after a lost reply.
    for (const [lostWrite, label] of [[1, 'breach settlement'], [2, 'pinned hit'], [3, 'pin clear']] as const) {
        it(`settles a raid whose ${label} landed but lost its reply`, async (t) => {
            const now = Date.now();
            await kv.set(TERRITORY_KEY, {
                sector: VIRGIN_SECTOR,
                ownerClan: 'Storm Clan',
                ownerVillage: 'Stormveil Village',
                controlScore: 75_000,
                hp: 5_000,
                terrainBuffStat: 'bukijutsuOffense',
                guards: [],
                warSupply: 0,
                lastSupplyAt: now - 1_000,
                updatedAt: now - 1_000,
                breachedAt: now - 13 * 60 * 60 * 1_000,
                breachEndsAt: now - 60_000,
            });
            const realGet = kv.get.bind(kv);
            const realCompareSet = kv.compareSet.bind(kv);
            t.mock.method(kv, 'get', async (key: string) => {
                const value = await realGet(key);
                return value === null ? null : JSON.parse(JSON.stringify(value));
            });
            let territoryWrites = 0;
            t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
                const landed = await realCompareSet(key, expected, value, options);
                if (key === TERRITORY_KEY && landed && ++territoryWrites === lostWrite) {
                    throw new Error('Connection terminated unexpectedly');
                }
                return landed;
            });
            const params = {
                playerName: 'breachraider',
                proofId: `pvp-raid:pvp-json-form-${lostWrite}`,
                sector: VIRGIN_SECTOR,
                eventAt: now,
                evidence: {
                    version: 1 as const,
                    sector: VIRGIN_SECTOR,
                    ownerClan: 'Storm Clan',
                    ownerVillage: 'Stormveil Village',
                    raidDamage: 250,
                    observedAt: now - 1_000,
                },
            };

            const settled = await settleRaidTerritoryDamage(params);
            assert.ok(territoryWrites >= lostWrite, 'the targeted write landed and only its reply was lost');
            assert.equal(settled.amount, 250);
            assert.equal(settled.replayed, false);
            const row = await kv.get<Record<string, unknown>>(TERRITORY_KEY);
            assert.equal(row?.hp, 4_750);
            assert.equal(Object.prototype.hasOwnProperty.call(row, 'breachEndsAt'), false, 'the breach settled');
            const again = await settleRaidTerritoryDamage(params);
            assert.equal(again.replayed, true);
            assert.equal(again.amount, 250, 'the hit is applied once');
        });
    }
});
