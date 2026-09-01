import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let settleRaidProgressionWithDailyCap: typeof import('./_raid-progression.js').settleRaidProgressionWithDailyCap;

/*
 * The caller-level half of the 2026-09-01 victory-screen incident.
 *
 * `api/pvp/claim-rewards.ts` settles a world-PvP win through
 * settleRaidProgressionWithDailyCap, and a throw there is a 503 the player can
 * only answer with Retry. When the raid's sector had no `world:territory:<n>`
 * row the throw was deterministic, so the claim could never succeed and both
 * fighters were pinned on the result screen.
 *
 * Every pre-existing raid test seeded an OWNED territory row first
 * (raid-authority-integration.test.ts), so a virgin sector was never exercised —
 * which is how 8,786 green tests coexisted with 34 of 66 sectors being
 * unsettleable in production. These cases pin the untested state.
 */
const VIRGIN_SECTOR = 59;
const PLAYER = 'raidprogvirgin';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleRaidProgressionWithDailyCap } = await import('./_raid-progression.js'));
});

beforeEach(async () => {
    const stale = [
        ...(await kv.keys('raid-territory-proof:*')),
        ...(await kv.keys(`raid-report-*:${PLAYER}*`)),
        ...(await kv.keys('lock:*')),
        `world:territory:${VIRGIN_SECTOR}`,
        `save:${PLAYER}`,
        `legacy:stats:${PLAYER}`,
    ];
    await kv.del(...stale);
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        currentSector: VIRGIN_SECTOR,
        acceptedMissionIds: [],
        missionProgress: {},
        character: {
            name: PLAYER,
            level: 20,
            rankTitle: 'Genin',
            profession: 'healer',
            professionRank: 1,
            professionXp: 0,
            village: 'Leaf',
            clan: 'LeafClan',
            hp: 100,
            maxHp: 100,
            stamina: 100,
            maxStamina: 100,
            ryo: 0,
            inventory: [],
        },
    });
});

describe('settleRaidProgressionWithDailyCap — the claim-rewards entry point', () => {
    it('settles a world-PvP win in a sector that has no territory row', async () => {
        assert.equal(await kv.get(`world:territory:${VIRGIN_SECTOR}`), null);

        const result = await settleRaidProgressionWithDailyCap({
            playerName: PLAYER,
            proofId: 'pvp-raid:pvp-virgin-claim',
            proofAt: 1788284888806,
            sector: VIRGIN_SECTOR,
            dailyLimit: 60,
            territoryEvidence: {
                version: 1,
                sector: VIRGIN_SECTOR,
                ownerClan: '',
                ownerVillage: '',
                raidDamage: 0,
                observedAt: 1788284833633,
            },
        });

        assert.equal(result.capped, false);
        assert.equal(result.replayed, false);
        assert.ok(result.settlement, 'the raid receipt must be written into the save');
        assert.equal(result.settlement?.proofId, 'pvp-raid:pvp-virgin-claim');
        assert.equal(result.territoryDamage, 0);
        assert.ok(await kv.get(`world:territory:${VIRGIN_SECTOR}`), 'the sector row must now exist');
    });

    it('is idempotent across the retries a 503 would have produced', async () => {
        const params = {
            playerName: PLAYER,
            proofId: 'pvp-raid:pvp-virgin-retry',
            proofAt: 1788284888806,
            sector: VIRGIN_SECTOR,
            dailyLimit: 60,
        };
        const first = await settleRaidProgressionWithDailyCap(params);
        const second = await settleRaidProgressionWithDailyCap(params);

        assert.equal(first.replayed, false);
        assert.equal(second.replayed, true, 'a retry must replay, not double-credit');
        assert.equal(second.settlement?.proofId, first.settlement?.proofId);

        const save = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        const character = save?.character as Record<string, unknown>;
        const receipts = character.raidProgressionSettlements as unknown[];
        assert.equal(
            receipts.filter((r) => (r as { proofId?: string }).proofId === params.proofId).length,
            1,
            'exactly one receipt per proof, however many times the claim was retried',
        );
    });
});
