import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * settleDueSectorWars announces the verdict to the World Herald exactly once —
 * the receipt is the war id, so the lazy poll, the declare path, and the daily
 * cron backstop can all re-run settlement without a second post.
 */

const SECTOR = 12;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:moonshadowvillage-vs-frostfangvillage`;
const CONTEST_KEY = `shared:sector-war:${CONTEST_ID}`;
const TERRITORY_KEY = `world:territory:${SECTOR}`;

let kv: typeof import('./_storage.js').kv;
let settle: typeof import('./_sector-war-settle.js');
let villageIntelKey: typeof import('./_village-intel.js').villageIntelKey;
let readVillageIntel: typeof import('./_village-intel.js').readVillageIntel;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    settle = await import('./_sector-war-settle.js');
    ({ villageIntelKey, readVillageIntel } = await import('./_village-intel.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: DEFENDER, hp: 20_000, updatedAt: Date.now() });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function dueWar(now: number, points: { attacker: number; defender: number }) {
    return {
        id: CONTEST_ID,
        sector: SECTOR,
        attackerVillage: ATTACKER,
        defenderVillage: DEFENDER,
        winCondition: 'combat',
        attackerPoints: points.attacker,
        defenderPoints: points.defender,
        startedAt: now - 73 * 60 * 60_000,
        endsAt: now - 60_000,
        updatedAt: now - 60_000,
        declarationGeneration: 1,
        flipped: false,
        appliedBattles: [],
    };
}

async function heraldFeed() {
    const feed = (await kv.get<Array<Record<string, unknown>>>('game:announcements')) ?? [];
    return feed.filter((a) => a.type === 'sector_war_resolved');
}

describe('sector-war settlement World Herald', { concurrency: false }, () => {
    it('heralds a flip exactly once across repeated settlement passes', async () => {
        const now = Date.now();
        await kv.set(CONTEST_KEY, dueWar(now, { attacker: 5, defender: 2 }));

        const first = await settle.settleDueSectorWars(now);
        assert.equal(first.length, 1);
        assert.equal(first[0].attackerWon, true);
        assert.equal((await kv.get<{ ownerVillage?: string }>(TERRITORY_KEY))?.ownerVillage, ATTACKER);

        // The cron backstop re-runs over the same (now settled) row.
        const second = await settle.settleDueSectorWars(now + 1_000);
        assert.equal(second.length, 0);

        const posts = await heraldFeed();
        assert.equal(posts.length, 1, JSON.stringify(posts));
        assert.equal(posts[0].importance, 'high');
        assert.equal(posts[0].title, `Sector ${SECTOR} Falls`);
        assert.equal(posts[0].message, `${ATTACKER} has taken Sector ${SECTOR} from ${DEFENDER} after a 72-hour war (5–2).`);
        assert.equal(posts[0].receiptId, `sector-war-resolved:${CONTEST_ID}`);
        const chat = (await kv.get<Array<Record<string, unknown>>>('chat:village:frostfang-village')) ?? [];
        assert.equal(chat.filter((m) => m.receiptId === posts[0].receiptId).length, 1);
    });

    it('heralds a hold (tie goes to the defender) exactly once', async () => {
        const now = Date.now();
        await kv.set(CONTEST_KEY, dueWar(now, { attacker: 3, defender: 3 }));

        const first = await settle.settleDueSectorWars(now);
        assert.equal(first.length, 1);
        assert.equal(first[0].attackerWon, false);
        assert.equal((await kv.get<{ ownerVillage?: string }>(TERRITORY_KEY))?.ownerVillage, DEFENDER);
        await settle.settleDueSectorWars(now + 1_000);

        const posts = await heraldFeed();
        assert.equal(posts.length, 1, JSON.stringify(posts));
        assert.equal(posts[0].title, `Sector ${SECTOR} Holds`);
        assert.equal(posts[0].message, `${DEFENDER} held Sector ${SECTOR} against ${ATTACKER}'s 72-hour siege (3–3).`);
    });

    it('a resolved war burns BOTH villages\' intel on the sector, and only that sector', async () => {
        const now = Date.now();
        const live = { lastAt: now, expiresAt: now + 7 * 24 * 60 * 60_000 };
        // Both belligerents hold intel on the contested sector; each also holds
        // intel on a sector the war has nothing to do with.
        await kv.set(villageIntelKey(ATTACKER), {
            village: ATTACKER,
            sectors: { [SECTOR]: { points: 600, ...live }, 30: { points: 120, ...live } },
        });
        await kv.set(villageIntelKey(DEFENDER), {
            village: DEFENDER,
            sectors: { [SECTOR]: { points: 250, ...live } },
        });
        // A third village that never entered the war keeps everything.
        await kv.set(villageIntelKey('Stormveil Village'), {
            village: 'Stormveil Village',
            sectors: { [SECTOR]: { points: 900, ...live } },
        });
        await kv.set(CONTEST_KEY, dueWar(now, { attacker: 5, defender: 2 }));

        assert.equal((await settle.settleDueSectorWars(now)).length, 1);

        assert.deepEqual(Object.keys((await readVillageIntel(ATTACKER, now)).sectors), ['30'],
            'the winner loses its intel on the sector it just took, and nothing else');
        assert.deepEqual((await readVillageIntel(DEFENDER, now)).sectors, {},
            'the loser\'s intel on the sector is gone too');
        assert.equal((await readVillageIntel('Stormveil Village', now)).sectors[String(SECTOR)]?.points, 900,
            'a village that was not in the war is untouched');

        // Idempotent: the cron backstop and a second poller both re-run over the
        // same row without throwing or resurrecting anything.
        await settle.settleDueSectorWars(now + 1_000);
        assert.deepEqual(Object.keys((await readVillageIntel(ATTACKER, now)).sectors), ['30']);
        assert.deepEqual((await readVillageIntel(DEFENDER, now)).sectors, {});
    });

    it('a defended HOLD burns the intel too — either verdict ends the scouting', async () => {
        const now = Date.now();
        const live = { lastAt: now, expiresAt: now + 7 * 24 * 60 * 60_000 };
        await kv.set(villageIntelKey(ATTACKER), { village: ATTACKER, sectors: { [SECTOR]: { points: 500, ...live } } });
        await kv.set(villageIntelKey(DEFENDER), { village: DEFENDER, sectors: { [SECTOR]: { points: 500, ...live } } });
        await kv.set(CONTEST_KEY, dueWar(now, { attacker: 3, defender: 3 }));

        const [verdict] = await settle.settleDueSectorWars(now);
        assert.equal(verdict.attackerWon, false);
        assert.deepEqual((await readVillageIntel(ATTACKER, now)).sectors, {});
        assert.deepEqual((await readVillageIntel(DEFENDER, now)).sectors, {});
    });

    it('credits a contributor who appears only past the in-row mirror, and copies every receipt out', async () => {
        const { commitSectorWarBattle, listSectorWarInstanceReceipts } = await import('./_sector-war-store.js');
        const { applySectorWarBattle, normalizeSectorWarSession } = await import('./_sector-war.js');
        process.env.ENABLE_LEGACY = '1';
        try {
            const now = Date.now();
            const live = { ...dueWar(now, { attacker: 0, defender: 0 }), endsAt: now + 60 * 60_000 };
            await kv.set(CONTEST_KEY, live);
            for (let i = 0; i < 205; i += 1) {
                const by = i < 200 ? 'mirrorhero' : 'overflowhero';
                const at = live.startedAt + 1000 + i;
                const r = await commitSectorWarBattle({
                    contestId: CONTEST_ID,
                    battleId: `b-${i}`,
                    now: () => at,
                    decide: (c) => ({
                        kind: 'score',
                        outcome: applySectorWarBattle(c, true, { now: at, roleSwing: 5, by }),
                        attackerWon: true, by, at,
                    }),
                });
                assert.equal(r.status, 'applied');
            }
            const row = await kv.get<Record<string, unknown>>(CONTEST_KEY);
            await kv.set(CONTEST_KEY, { ...row, endsAt: now - 60_000 }); // now due

            const [verdict] = await settle.settleDueSectorWars(now);
            assert.equal(verdict.attackerWon, true);
            assert.equal(verdict.attackerPoints, 205 * 5);
            const overflowHero = await kv.get<{ sectorCaptures?: number }>('legacy:stats:overflowhero');
            assert.equal(overflowHero?.sectorCaptures, 1, 'capture credit reaches the winner whose battles lie past the mirror');
            const mirrorHero = await kv.get<{ sectorCaptures?: number }>('legacy:stats:mirrorhero');
            assert.equal(mirrorHero?.sectorCaptures, 1);

            const settled = normalizeSectorWarSession((await kv.get(CONTEST_KEY)) as never)!;
            assert.equal(settled.flipped, true);
            assert.deepEqual(settled.battleLedger?.pending, []);
            assert.equal(settled.battleLedger?.mirrorExternalized, true);
            assert.equal((await listSectorWarInstanceReceipts(settled)).length, 205, 'all evidence outlives the row');
        } finally {
            delete process.env.ENABLE_LEGACY;
        }
    });

    it('a drain that cannot copy a receipt out leaves the war due for the next pass', async () => {
        const now = Date.now();
        const receipts = Array.from({ length: 20 }, (_, i) => ({ battleId: `legacy-${i}`, attackerWon: false, points: 1, by: 'holder', at: now - 72 * 60 * 60_000 + i })).reverse();
        await kv.set(CONTEST_KEY, { ...dueWar(now, { attacker: 0, defender: 20 }), appliedBattles: receipts });
        const original = kv.compareSet.bind(kv);
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (key.startsWith('shared:sector-war-battle:')) throw new Error('injected receipt-store outage');
            return original(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            assert.deepEqual(await settle.settleDueSectorWars(now), [], 'nothing settles while evidence cannot be copied');
        } finally {
            kv.compareSet = original as typeof kv.compareSet;
        }
        const stillDue = await kv.get<Record<string, unknown>>(CONTEST_KEY);
        assert.equal(stillDue?.expiredAt, undefined, 'the verdict was not stamped');
        const [verdict] = await settle.settleDueSectorWars(now + 1000);
        assert.equal(verdict.attackerWon, false, 'the next pass settles it');
        assert.equal((await kv.keys('shared:sector-war-battle:*')).length, 20);
    });

    it('copy helper names the right village for each verdict', () => {
        const war = { id: CONTEST_ID, sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER };
        assert.equal(settle.sectorWarResolutionAnnouncement(war, { attackerWon: true, attackerPoints: 1, defenderPoints: 0 }).village, ATTACKER);
        assert.equal(settle.sectorWarResolutionAnnouncement(war, { attackerWon: false, attackerPoints: 0, defenderPoints: 0 }).village, DEFENDER);
    });
});
