process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-merc-handler-test-secret-32-bytes!!';
delete process.env.DISABLE_VILLAGE_WAR;

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * /api/village/war-merc — the owner redesign of War Map mercenaries
 * (2026-10-08), driven through the mounted handler as real players:
 *   - a band is hired FOR one war: the village's all-out village war (Kage seat
 *     3 hires, each Elder seat 1, per war instance) or a Combat sector war the
 *     village DEFENDS (3 hires per contest, Kage or any Elder);
 *   - the attacking village can no longer hire for its siege;
 *   - the WR debit happens once, and a retried click replays without charging;
 *   - `list` returns the cost the server actually charges;
 *   - the defending Kage/Elders send a merc at ANY attacking-village player.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Session = import('../_sector-war.js').SectorWarSession;

const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const D_KAGE = 'dkage';
const D_ELDERS = ['delder1', 'delder2', 'delder3'];
const D_VILLAGER = 'dvillager';
const A_KAGE = 'akage';
const A_RAIDER = 'araider';
const SECTOR = 23;
const WAR_ID = 'frostfangvillage-vs-moonshadowvillage';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
let war: typeof import('../_sector-war.js');
let villageWarKey: typeof import('../_war-state.js').villageWarKey;
let handler: Handler;
let ipSeed = 0;
let requestSeq = 0;

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

async function post(player: string, body: Json) {
    const ip = `10.61.${Math.floor(++ipSeed / 250)}.${ipSeed % 250}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: player, ...body },
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-player-name': player,
            'x-player-token': issuePlayerToken(player)!,
            'x-forwarded-for': ip,
        },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

const newRequestId = () => `test-click-${String(++requestSeq).padStart(6, '0')}`;

function hire(player: string, village: string, context: Json, tierId = 'merc-ronin', requestId = newRequestId()) {
    return post(player, { action: 'hire', village, tierId, requestId, ...context });
}

async function record(village: string): Promise<Json & { warResources: number; mercLeases: Json[]; mercHires?: Json[] }> {
    return (await kv.get(villageWarKey(village))) as never;
}

async function seedPlayers() {
    const save = (name: string, village: string) => kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: { name, village, level: 40, hp: 300, maxHp: 300, stats: {}, jutsu: [], equipment: {} },
    });
    for (const name of [D_KAGE, ...D_ELDERS, D_VILLAGER]) await save(name, DEFENDER);
    for (const name of [A_KAGE, A_RAIDER]) await save(name, ATTACKER);
    await kv.set('village:kage:frostfang-village', { seatedKage: D_KAGE });
    await kv.set('village:kage:moonshadow-village', { seatedKage: A_KAGE });
    const now = Date.now();
    await kv.set('village:elder-council:frostfangvillage', {
        version: 1, startedAt: now - 86_400_000, nextSelectionAt: now + 20 * 86_400_000, seats: D_ELDERS, winningScores: [0, 0],
    });
    await kv.set('village:elder-council:moonshadowvillage', {
        version: 1, startedAt: now - 86_400_000, nextSelectionAt: now + 20 * 86_400_000, seats: ['', '', ''], winningScores: [0, 0],
    });
    for (const village of [DEFENDER, ATTACKER]) {
        await kv.set(villageWarKey(village), { warResources: 2_000, structures: {}, sectors: {}, mercLeases: [] });
    }
    // Hires also cost treasury ryo (2026-10 rebalance): a well-funded treasury.
    await kv.set(TREASURY_KEY, { treasury: { ryo: TREASURY_RYO, honorSeals: 0 } });
    await kv.set('game:village-state:moonshadowvillage', { treasury: { ryo: TREASURY_RYO } });
}

const TREASURY_KEY = 'game:village-state:frostfangvillage';
const TREASURY_RYO = 2_000_000;

async function treasuryRyo(): Promise<number> {
    return Number(((await kv.get(TREASURY_KEY)) as { treasury?: { ryo?: number } } | null)?.treasury?.ryo);
}

/** Run `fn` with the treasury-ryo dial at 0: the WR-only prices, where an Elder
 *  hires exactly as before the rebalance. */
async function withWrOnlyHires<T>(fn: () => Promise<T>): Promise<T> {
    process.env.WAR_RYO_PER_WR = '0';
    try {
        return await fn();
    } finally {
        delete process.env.WAR_RYO_PER_WR;
    }
}

async function seedVillageWar(generation = 2) {
    const now = Date.now();
    await kv.set(`world:war:${WAR_ID}`, {
        id: WAR_ID,
        villages: [DEFENDER, ATTACKER],
        hp: { [DEFENDER]: 5_000, [ATTACKER]: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: now - 2 * 3_600_000,
        pendingUntil: now - 3_600_000,
        updatedAt: now - 3_600_000,
        declarationGeneration: generation,
    });
}

async function seedContest(winCondition: 'combat' | 'card' = 'combat', sector = SECTOR): Promise<Session> {
    const session: Session = {
        ...war.newSectorWarSession({ sector, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition, now: Date.now() - 60_000 }),
        declarationGeneration: 1,
    };
    await kv.set(war.sectorWarKey(session.id), session);
    return session;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    war = await import('../_sector-war.js');
    ({ villageWarKey } = await import('../_war-state.js'));
    const loaded = await import('./war-merc.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    // Every case hires as the same few leaders; the per-name hire budget is not under test here.
    resetRateLimits();
    await seedPlayers();
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('village-war hires: Kage seat 3, each Elder seat 1, per war instance', { concurrency: false }, () => {
    it('enforces the seat allowances and binds every band to the war', () => withWrOnlyHires(async () => {
        await seedVillageWar(2);
        for (let i = 0; i < 3; i += 1) {
            const ok = await hire(D_KAGE, DEFENDER, { context: 'village' });
            assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
            assert.equal(ok.body?.hiresLeft, 2 - i);
        }
        const fourth = await hire(D_KAGE, DEFENDER, { context: 'village' });
        assert.equal(fourth.statusCode, 409);
        assert.match(String(fourth.body?.error), /Kage seat hires 3/);

        assert.equal((await hire(D_ELDERS[0], DEFENDER, { context: 'village' })).statusCode, 200);
        assert.equal((await hire(D_ELDERS[0], DEFENDER, { context: 'village' })).statusCode, 409, 'one hire per Elder seat');
        assert.equal((await hire(D_ELDERS[1], DEFENDER, { context: 'village' })).statusCode, 200);
        const villager = await hire(D_VILLAGER, DEFENDER, { context: 'village' });
        assert.equal(villager.statusCode, 403);

        const rec = await record(DEFENDER);
        assert.equal(rec.warResources, 2_000 - 5 * 60, 'five ronin bands at full price');
        assert.equal(rec.mercLeases.length, 5);
        for (const lease of rec.mercLeases) {
            assert.deepEqual(lease.context, { kind: 'village', warId: WAR_ID, generation: 2 });
            assert.match(String(lease.id), /^mh_test-click-/);
            assert.equal(lease.count, 3);
        }
        assert.deepEqual((rec.mercHires ?? []).map((h) => h.seat), ['kage', 'kage', 'kage', 'elder-1', 'elder-2']);
        assert.equal(await treasuryRyo(), TREASURY_RYO, 'WR-only hires leave the treasury alone');
    }));

    it('the next war between the same villages starts a fresh allowance', async () => {
        await seedVillageWar(2);
        for (let i = 0; i < 3; i += 1) assert.equal((await hire(D_KAGE, DEFENDER, { context: 'village' })).statusCode, 200);
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'village' })).statusCode, 409);
        await seedVillageWar(3); // the rematch reuses the row with the next generation
        const fresh = await hire(D_KAGE, DEFENDER, { context: 'village' });
        assert.equal(fresh.statusCode, 200);
        const rec = await record(DEFENDER);
        assert.deepEqual(rec.mercLeases.at(-1)?.context, { kind: 'village', warId: WAR_ID, generation: 3 });
    });

    it('no village war → no village-war hire', async () => {
        const out = await hire(D_KAGE, DEFENDER, { context: 'village' });
        assert.equal(out.statusCode, 409);
        assert.equal((await record(DEFENDER)).warResources, 2_000);
    });
});

describe('sector-war hires: the DEFENDER only, 3 per contest', { concurrency: false }, () => {
    it('refuses a hire when its contest settles while the quote is being prepared', async (t) => {
        const contest = await seedContest();
        const before = await record(DEFENDER);
        const keys = kv.keys.bind(kv);
        let ended = false;
        t.mock.method(kv, 'keys', async (pattern: string) => {
            if (pattern === 'world:territory:*' && !ended) {
                ended = true;
                await kv.set(war.sectorWarKey(contest.id), { ...contest, expiredAt: Date.now(), defended: true });
            }
            return keys(pattern);
        });
        const out = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id });
        assert.equal(ended, true);
        assert.equal(out.statusCode, 409);
        assert.deepEqual(await record(DEFENDER), before, 'a band that can no longer serve must cost nothing');
    });
    it('never charges or lists HP mercenaries for a five-day score campaign', async () => {
        await seedVillageWar();
        const row = await kv.get<Json>(`world:war:${WAR_ID}`);
        const { createVillageCampaign } = await import('../_village-war-campaign.js');
        await kv.set(`world:war:${WAR_ID}`, { ...row, campaign: createVillageCampaign([DEFENDER, ATTACKER], Date.now() - 1000, 47) });
        const before = await record(DEFENDER);
        const out = await hire(D_KAGE, DEFENDER, { context: 'village' });
        assert.equal(out.statusCode, 409);
        assert.deepEqual(await record(DEFENDER), before);
        const list = await post(D_KAGE, { action: 'list', village: DEFENDER });
        assert.equal(list.statusCode, 200);
        assert.deepEqual(list.body?.contexts, []);
    });
    it('lets the defending Kage and Elders hire 3 in all, and refuses the attacker', () => withWrOnlyHires(async () => {
        const contest = await seedContest();
        const refused = await hire(A_KAGE, ATTACKER, { context: 'sector', contestId: contest.id });
        assert.equal(refused.statusCode, 403);
        assert.match(String(refused.body?.error), /Attacking villages can no longer hire/);
        assert.equal((await record(ATTACKER)).warResources, 2_000, 'the attacker paid nothing');

        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id })).statusCode, 200);
        assert.equal((await hire(D_ELDERS[2], DEFENDER, { context: 'sector', contestId: contest.id })).statusCode, 200);
        const third = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id }, 'merc-warlord');
        assert.equal(third.statusCode, 200);
        assert.equal(third.body?.hiresLeft, 0);
        const fourth = await hire(D_ELDERS[0], DEFENDER, { context: 'sector', contestId: contest.id });
        assert.equal(fourth.statusCode, 409);
        assert.match(String(fourth.body?.error), /already has its 3 mercenary hires/);

        const rec = await record(DEFENDER);
        assert.equal(rec.warResources, 2_000 - 60 - 60 - 420);
        const instance = war.sectorWarInstanceTag(contest);
        assert.ok(rec.mercLeases.every((l) => (l.context as Json)?.kind === 'sector'
            && (l.context as Json)?.contestId === contest.id && (l.context as Json)?.instance === instance));
    }));

    it('refuses a Card contest and a contest of another village', async () => {
        const card = await seedContest('card');
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: card.id })).statusCode, 409);
        const theirs = await kv.get(war.sectorWarKey(card.id));
        assert.ok(theirs);
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: '24:nobody-vs-noone' })).statusCode, 409);
    });

    it('a lease never outlives its contest', async () => {
        // 60 of the 72 hours gone: the contest ends before a 2-day contract would.
        const late: Session = {
            ...war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: Date.now() - 60 * 3_600_000 }),
            declarationGeneration: 1,
        };
        await kv.set(war.sectorWarKey(late.id), late);
        const out = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: late.id });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.expiresAt, late.endsAt);

        // A fresh contest: the 2-day contract ends first.
        const fresh = await seedContest('combat', SECTOR + 1);
        const early = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: fresh.id });
        assert.ok(Number(early.body?.expiresAt) < fresh.endsAt);
        assert.ok(Number(early.body?.expiresAt) <= Date.now() + 2 * 86_400_000);
    });
});

describe('the WR debit happens once; a retried click replays', { concurrency: false }, () => {
    it('replays the same hire for the same request id, without charging', async () => {
        await seedVillageWar(2);
        const requestId = 'lost-response-click-0001';
        const first = await hire(D_KAGE, DEFENDER, { context: 'village' }, 'merc-oni', requestId);
        const retry = await hire(D_KAGE, DEFENDER, { context: 'village' }, 'merc-oni', requestId);
        assert.equal(first.statusCode, 200);
        assert.equal(retry.statusCode, 200);
        assert.equal(retry.body?.replayed, true);
        assert.equal(retry.body?.hireId, first.body?.hireId);
        assert.equal(retry.body?.cost, 280);
        assert.equal(first.body?.treasuryRyo, 70_000, '280 WR x 250 treasury ryo');
        assert.equal(retry.body?.treasuryRyo, 70_000, 'the replay reports what the proof says was paid');
        assert.equal(await treasuryRyo(), TREASURY_RYO - 70_000, 'the treasury was charged once');
        const rec = await record(DEFENDER);
        assert.equal(rec.warResources, 2_000 - 280, 'charged once');
        assert.equal(rec.mercLeases.length, 1);
        assert.equal((rec.mercHires ?? []).length, 1);

        // The allowance counted it once too: two more Kage hires fit, not one.
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'village' })).statusCode, 200);
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'village' })).statusCode, 200);

        // Someone else reusing the id is not a replay of THEIR hire.
        assert.equal((await hire(D_ELDERS[0], DEFENDER, { context: 'village' }, 'merc-oni', requestId)).statusCode, 409);
    });

    it('a retry still replays after the war has ended', async () => {
        await seedVillageWar(2);
        const requestId = 'late-retry-click-000001';
        assert.equal((await hire(D_KAGE, DEFENDER, { context: 'village' }, 'merc-ronin', requestId)).statusCode, 200);
        await kv.del(`world:war:${WAR_ID}`);
        const retry = await hire(D_KAGE, DEFENDER, { context: 'village' }, 'merc-ronin', requestId);
        assert.equal(retry.statusCode, 200);
        assert.equal(retry.body?.replayed, true);
        assert.equal((await record(DEFENDER)).warResources, 2_000 - 60);
    });

    it('needs a request id, and refuses an unaffordable hire without writing', async () => {
        await seedVillageWar(2);
        const noId = await post(D_KAGE, { action: 'hire', village: DEFENDER, tierId: 'merc-ronin', context: 'village' });
        assert.equal(noId.statusCode, 400);
        await kv.set(villageWarKey(DEFENDER), { warResources: 100, structures: {}, sectors: {}, mercLeases: [] });
        const poor = await hire(D_KAGE, DEFENDER, { context: 'village' }, 'merc-warlord');
        assert.equal(poor.statusCode, 402);
        const rec = await record(DEFENDER);
        assert.equal(rec.warResources, 100);
        assert.deepEqual(rec.mercLeases, []);
        assert.equal(rec.mercHires, undefined);
    });
});

describe('list: the effective price, the wars to hire for, the allowance left', { concurrency: false }, () => {
    it('quotes the comeback-discounted cost the server then charges', async () => {
        await seedVillageWar(2);
        const contest = await seedContest();
        // The defender holds a single sector → 75% off (60 → 15 for a Rōnin band).
        await kv.set('world:territory:1', { sector: 1, ownerVillage: DEFENDER });
        const list = await post(D_KAGE, { action: 'list', village: DEFENDER });
        assert.equal(list.statusCode, 200);
        const tiers = list.body?.tiers as Array<{ id: string; costWr: number; cost: number }>;
        // The treasury ryo follows the discounted WR: 15 x 250.
        assert.deepEqual(tiers.find((t) => t.id === 'merc-ronin'), { id: 'merc-ronin', level: 75, costWr: 60, cost: 15, treasuryRyo: 3_750, band: 3,
            combatProfile: { classification: 'special-npc', role: 'Ronin', tactics: 'Veteran duelist: damage focus sets up elemental strikes, with Wound and Poison to pressure recovery.' } });
        assert.equal(list.body?.treasuryRyo, TREASURY_RYO, 'the members see the treasury the hires spend');
        assert.equal(list.body?.ryoPerWr, 250);
        const contexts = list.body?.contexts as Array<Json>;
        assert.deepEqual(contexts.map((c) => [c.kind, c.enemy, c.hiresLimit, c.callerHiresLeft]), [
            ['village', ATTACKER, 6, 3],
            ['sector', ATTACKER, 3, 3],
        ]);
        assert.equal(contexts[1].contestId, contest.id);
        assert.deepEqual(list.body?.viewer, { role: 'kage', seats: ['kage'], canHire: true, canDeploy: true, canSpendTreasury: true });

        const hired = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id });
        assert.equal(hired.body?.cost, 15, 'the charge matches the quote');
        assert.equal(hired.body?.treasuryRyo, 3_750);
        assert.equal((await record(DEFENDER)).warResources, 2_000 - 15);
        assert.equal(await treasuryRyo(), TREASURY_RYO - 3_750);
    });

    it('shows the attacker its siege as unhireable and refuses a non-member', async () => {
        await seedContest();
        const attacker = await post(A_KAGE, { action: 'list', village: ATTACKER });
        assert.equal(attacker.statusCode, 200);
        assert.deepEqual(attacker.body?.contexts, []);
        assert.equal((attacker.body?.attacking as Json[]).length, 1);
        const outsider = await post(A_KAGE, { action: 'list', village: DEFENDER });
        assert.equal(outsider.statusCode, 403);
        const villager = await post(D_VILLAGER, { action: 'list', village: DEFENDER });
        assert.deepEqual(villager.body?.viewer, { role: 'none', seats: [], canHire: false, canDeploy: false, canSpendTreasury: false });
        const elder = await post(D_ELDERS[0], { action: 'list', village: DEFENDER });
        const elderView = elder.body?.viewer as Json | undefined;
        assert.equal(elderView?.canHire, true);
        assert.equal(elderView?.canSpendTreasury, false, 'an Elder hires only bands that cost the treasury nothing');
    });
});

// 2026-10 rebalance (#6): a hire also costs treasury ryo per WR charged.
describe('treasury ryo on a hire', { concurrency: false }, () => {
    it('debits WR and treasury ryo in one commit and writes a payment proof', async () => {
        const contest = await seedContest();
        const out = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id }, 'merc-reaver');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.cost, 110);
        assert.equal(out.body?.treasuryRyo, 27_500);
        assert.equal(out.body?.remainingTreasuryRyo, TREASURY_RYO - 27_500);
        assert.equal((await record(DEFENDER)).warResources, 2_000 - 110);
        const state = (await kv.get(TREASURY_KEY)) as { treasury: { ryo: number }; settlementReceipts: Array<Json & { purchase?: Json }> };
        assert.equal(state.treasury.ryo, TREASURY_RYO - 27_500);
        const proof = state.settlementReceipts.find((r) => r.purchase?.kind === 'merc');
        assert.equal(proof?.resource, 'ryo');
        assert.equal(proof?.amount, 27_500);
        assert.deepEqual(proof?.purchase, { kind: 'merc', village: DEFENDER, ref: String(out.body?.hireId), ryo: 27_500, boneCharms: 0 });
    });

    it('a short treasury refuses with 402 and moves nothing', async () => {
        const contest = await seedContest();
        await kv.set(TREASURY_KEY, { treasury: { ryo: 100_000 } });
        const before = await record(DEFENDER);
        const out = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id }, 'merc-warlord');
        assert.equal(out.statusCode, 402);
        assert.equal(out.body?.error, 'treasury-ryo');
        assert.equal(out.body?.need, 105_000);
        assert.equal(out.body?.have, 100_000);
        assert.match(String(out.body?.message), /treasury is short — 105,000 ryo/);
        assert.deepEqual(await record(DEFENDER), before);
        assert.equal(await treasuryRyo(), 100_000);
    });

    it('an Elder may not spend the treasury: a paid band is refused, nothing moves', async () => {
        const contest = await seedContest();
        const before = await record(DEFENDER);
        const out = await hire(D_ELDERS[0], DEFENDER, { context: 'sector', contestId: contest.id });
        assert.equal(out.statusCode, 403);
        assert.equal(out.body?.error, 'kage-only');
        assert.match(String(out.body?.message), /only the seated Kage can spend the treasury/);
        assert.deepEqual(await record(DEFENDER), before);
        assert.equal(await treasuryRyo(), TREASURY_RYO);
    });

    it('a free comeback band costs the treasury nothing, so an Elder may still hire it', async () => {
        const contest = await seedContest();
        // The defender holds no war sector at all: comeback hires are free.
        await kv.set('world:territory:1', { sector: 1, ownerVillage: ATTACKER });
        const out = await hire(D_ELDERS[0], DEFENDER, { context: 'sector', contestId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.cost, 0);
        assert.equal(out.body?.treasuryRyo, 0);
        assert.equal(await treasuryRyo(), TREASURY_RYO);
    });

    it('a commit that loses its compare-and-set answers 503 and moves nothing', async () => {
        const contest = await seedContest();
        const before = await record(DEFENDER);
        const original = kv.compareSetMany;
        kv.compareSetMany = async () => false;
        let out: Awaited<ReturnType<typeof hire>>;
        try { out = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id }); }
        finally { kv.compareSetMany = original; }
        assert.equal(out.statusCode, 503);
        assert.deepEqual(await record(DEFENDER), before);
        assert.equal(await treasuryRyo(), TREASURY_RYO);
    });

    it('concurrent retries of one click debit both pools once', async () => {
        const contest = await seedContest();
        const requestId = 'concurrent-click-000001';
        const answers = await Promise.all(Array.from({ length: 4 }, () => hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id }, 'merc-shadow', requestId)));
        assert.ok(answers.some((a) => a.statusCode === 200), JSON.stringify(answers.map((a) => a.statusCode)));
        assert.ok(answers.every((a) => a.statusCode === 200 || a.statusCode === 503), JSON.stringify(answers.map((a) => [a.statusCode, a.body])));
        assert.equal((await record(DEFENDER)).warResources, 2_000 - 170);
        assert.equal(await treasuryRyo(), TREASURY_RYO - 42_500);
        assert.equal(((await record(DEFENDER)).mercHires ?? []).length, 1);
    });
});

describe('attack: the defending leaders send a merc at any attacker, anywhere', { concurrency: false }, () => {
    it('resolves a defender band against an attacking-village player in another sector', async () => {
        const contest = await seedContest();
        // The Kage hires (a paid band spends the treasury); any leader may send it.
        const hired = await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id });
        const bandId = String(hired.body?.hireId);
        const out = await post(D_ELDERS[1], { action: 'attack', village: DEFENDER, bandId, targetPlayer: A_RAIDER });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.mercsRemaining, 2);
        const after = war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(contest.id))) as never)!;
        assert.equal(after.lastLiveBattleAt, undefined, 'an AI battle');
        assert.ok(after.attackerPoints + after.defenderPoints >= 0);
    });

    it('refuses a non-leader, a defender target, and a village-war band', async () => {
        const contest = await seedContest();
        const bandId = String((await hire(D_KAGE, DEFENDER, { context: 'sector', contestId: contest.id })).body?.hireId);
        assert.equal((await post(D_VILLAGER, { action: 'attack', village: DEFENDER, bandId, targetPlayer: A_RAIDER })).statusCode, 403);
        assert.equal((await post(D_KAGE, { action: 'attack', village: DEFENDER, bandId, targetPlayer: D_VILLAGER })).statusCode, 403);

        await seedVillageWar(2);
        await kv.del(war.sectorWarKey(contest.id));
        const villageBand = String((await hire(D_KAGE, DEFENDER, { context: 'village' })).body?.hireId);
        const out = await post(D_KAGE, { action: 'attack', village: DEFENDER, bandId: villageBand, targetPlayer: A_RAIDER });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /hunt on their own/);
        const ended = await post(D_KAGE, { action: 'attack', village: DEFENDER, bandId, targetPlayer: A_RAIDER });
        assert.equal(ended.statusCode, 409, 'the band\'s contest is gone');
        assert.match(String(ended.body?.error), /is over/);
    });
});
