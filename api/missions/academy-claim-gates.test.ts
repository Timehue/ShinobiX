import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'academy-claim-gates-test-secret-32b';
delete process.env.ENABLE_LEGACY;

/*
 * MDSA-05 (2026-10 rebalance): the Academy claims are server-gated. Before it,
 * the only gate was the claimed latch, so any freshly created character could
 * POST both claims for their whole grant. At 6,000 + 4,000 ryo that is a
 * 10,000-ryo faucet per throwaway account, so the Trial now needs the sealed
 * spar latch and the Checklist the server-owned checklist goals. Both pay
 * unboosted (a max Mission Hall must not lift a grant sized to the lessons).
 * Hunt claims roll their Fate Shard / Aura Stone drops (owner A2 / A3) on every
 * claim with no daily cap.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let claimHandler: Handler;
let catalog: typeof import('./_mission-catalog.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    claimHandler = (await import('./claim-mission.js')).default as unknown as Handler;
    catalog = await import('./_mission-catalog.js');
});

beforeEach(async () => {
    const { __resetRateLimitsForTest } = await import('../_ratelimit.js');
    __resetRateLimitsForTest();
    for (const pattern of ['save:academygate*', 'lock:*academygate*', 'combat-stat-count:academygate*', 'missions:newbie-daily:academygate*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await claimHandler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.77' },
    } as never, res as never);
    return out;
}

async function seed(playerName: string, character: Record<string, unknown>, record: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        acceptedMissionIds: [],
        missionProgress: {},
        ...record,
        character: {
            name: playerName, level: 1, rankTitle: 'Academy Student', village: 'Stormveil Village',
            hp: 100, maxHp: 100, stamina: 10, maxStamina: 100, ryo: 100, fateShards: 0,
            inventory: [], unspentStats: 0, ...character,
        },
    });
}

async function saved(playerName: string): Promise<Record<string, unknown>> {
    return (await kv.get<Record<string, unknown>>(`save:${playerName}`))!.character as Record<string, unknown>;
}

describe('Academy Trial needs the sealed spar', () => {
    it('refuses a fresh character that never won the spar, and pays nothing', async () => {
        const player = 'academygatefresh';
        await seed(player, { onboardingStep: 'firstMission' });
        const out = await post(player, { missionType: 'academy-trial', missionId: 'academy-trial' });
        assert.equal(out.body?.applied, false, JSON.stringify(out.body));
        assert.equal(out.body?.reason, 'not-yet-unlocked');
        const character = await saved(player);
        assert.equal(character.ryo, 100);
        assert.equal(character.academyTrialClaimed, undefined);
    });

    it('pays the spar winner exactly the unboosted grant once, even in a max Mission Hall village', async () => {
        const player = 'academygatespar';
        await seed(player, { onboardingStep: 'firstMission', academySparClaimed: true, villageUpgrades: { missionHall: 50 } });
        const out = await post(player, { missionType: 'academy-trial', missionId: 'academy-trial' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.applied, true, JSON.stringify(out.body));
        assert.equal((out.body?.reward as Record<string, unknown>).ryo, catalog.ACADEMY_TRIAL.ryo, 'no +25% Mission Hall bonus');
        assert.equal((await saved(player)).ryo, 100 + catalog.ACADEMY_TRIAL.ryo);
        const replay = await post(player, { missionType: 'academy-trial', missionId: 'academy-trial' });
        assert.equal(replay.body?.applied, false);
        assert.equal(replay.body?.reason, 'already-claimed');
        assert.equal((await saved(player)).ryo, 100 + catalog.ACADEMY_TRIAL.ryo);
    });

    it('the ACADEMY_TRIAL_RYO dial pulls the grant without a deploy', async () => {
        const player = 'academygatedial';
        await seed(player, { onboardingStep: 'firstMission', academySparClaimed: true });
        process.env.ACADEMY_TRIAL_RYO = '30';
        try {
            const out = await post(player, { missionType: 'academy-trial', missionId: 'academy-trial' });
            assert.equal((out.body?.reward as Record<string, unknown>).ryo, 30);
        } finally {
            delete process.env.ACADEMY_TRIAL_RYO;
        }
    });
});

describe('Academy Checklist needs the server-owned goals', () => {
    const goals = { jutsuMastery: [{ jutsuId: 'starter', level: 3, xp: 0 }], totalAiKills: 1, totalMissionsCompleted: 1 };

    it('refuses jutsu mastery Lv2, then pays 4,000 + 2 Fate Shards once at Lv3', async () => {
        const player = 'academygatechecklist';
        await seed(player, { ...goals, jutsuMastery: [{ jutsuId: 'starter', level: 2, xp: 0 }], villageUpgrades: { missionHall: 50 } });
        const early = await post(player, { missionType: 'academy-checklist', missionId: 'academy-checklist' });
        assert.equal(early.body?.applied, false, JSON.stringify(early.body));
        assert.equal(early.body?.reason, 'not-yet-unlocked');
        assert.equal((await saved(player)).ryo, 100);

        const record = (await kv.get<Record<string, unknown>>(`save:${player}`))!;
        await kv.set(`save:${player}`, { ...record, character: { ...(record.character as Record<string, unknown>), jutsuMastery: goals.jutsuMastery } });
        const paid = await post(player, { missionType: 'academy-checklist', missionId: 'academy-checklist' });
        assert.equal(paid.body?.applied, true, JSON.stringify(paid.body));
        const reward = paid.body?.reward as Record<string, unknown>;
        assert.equal(reward.ryo, catalog.ACADEMY_CHECKLIST.ryo, 'unboosted');
        assert.deepEqual(reward.currency, { fateShards: 2 });
        const character = await saved(player);
        assert.equal(character.ryo, 100 + catalog.ACADEMY_CHECKLIST.ryo);
        assert.equal(character.fateShards, 2);
        const replay = await post(player, { missionType: 'academy-checklist', missionId: 'academy-checklist' });
        assert.equal(replay.body?.reason, 'already-claimed');
    });

    it('a clan mission contribution satisfies the mission goal', async () => {
        const player = 'academygateclan';
        await seed(player, { ...goals, totalMissionsCompleted: 0, clanMissionContrib: 1 });
        const out = await post(player, { missionType: 'academy-checklist', missionId: 'academy-checklist' });
        assert.equal(out.body?.applied, true, JSON.stringify(out.body));
    });

    it('a character with no AI win is refused', async () => {
        const player = 'academygatenokill';
        await seed(player, { ...goals, totalAiKills: 0 });
        const out = await post(player, { missionType: 'academy-checklist', missionId: 'academy-checklist' });
        assert.equal(out.body?.reason, 'not-yet-unlocked');
    });

    it('the Academy grants are filed under their own economy sources', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'missions', 'claim-mission.ts'), 'utf8');
        assert.match(source, /'academy\.trial'/);
        assert.match(source, /'academy\.checklist'/);
    });
});

describe('hunt claims roll their drops on every claim (owner A2 / A3)', () => {
    const HUNT = 'hunt-ember-drake';
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;

    async function seedReadyHunt(player: string, proof: string, character: Record<string, unknown>) {
        const record = await kv.get<Record<string, unknown>>(`save:${player}`);
        const base = (record?.character as Record<string, unknown> | undefined) ?? {
            name: player, level: 55, rankTitle: 'Jonin', village: 'Stormveil Village', hp: 100, maxHp: 100,
            stamina: 10, maxStamina: 100, ryo: 0, fateShards: 0, auraStones: 0, inventory: [], unspentStats: 0,
            createdAt: old, ...character,
        };
        await kv.set(`save:${player}`, {
            ...(record ?? { _saveVersion: 1, missionProgress: {} }),
            acceptedMissionIds: [HUNT],
            character: { ...base, serverHuntTrails: { [HUNT]: { targetDefeated: true, targetProofId: proof } } },
        });
    }

    function withChances(fs: string, as: string, run: () => Promise<void>) {
        return (async () => {
            process.env.HUNT_FS_CHANCE = fs; process.env.HUNT_AS_CHANCE = as;
            try { await run(); } finally { delete process.env.HUNT_FS_CHANCE; delete process.env.HUNT_AS_CHANCE; }
        })();
    }

    it('five hunts in a day each pay their drop, and the catalog row is never mutated', async () => {
        const player = 'academygatehunter';
        const catalogRow = structuredClone(catalog.fieldMissionById(HUNT)!.currencyRewards);
        await withChances('1', '1', async () => {
            for (let i = 0; i < 5; i += 1) {
                const { __resetRateLimitsForTest } = await import('../_ratelimit.js');
                __resetRateLimitsForTest();
                await seedReadyHunt(player, `academygateproof${i}`, {});
                const out = await post(player, { missionType: 'hunt', missionId: HUNT });
                assert.equal(out.body?.applied, true, JSON.stringify(out.body));
                assert.deepEqual((out.body?.reward as Record<string, unknown>).currency, { ...catalogRow, fateShards: 1, auraStones: 1 });
            }
        });
        const character = await saved(player);
        assert.equal(character.fateShards, 5, 'no first-4 cap');
        assert.equal(character.auraStones, 5);
        assert.deepEqual(catalog.fieldMissionById(HUNT)!.currencyRewards, catalogRow);
    });

    it('a chance of 0 drops nothing, and a fresh account past L20 still rolls its Fate Shard', async () => {
        await withChances('0', '0', async () => {
            await seedReadyHunt('academygatedry', 'academygatedryproof', {});
            const dry = await post('academygatedry', { missionType: 'hunt', missionId: HUNT });
            assert.deepEqual((dry.body?.reward as Record<string, unknown>).currency, catalog.fieldMissionById(HUNT)!.currencyRewards);
        });
        await withChances('1', '0', async () => {
            await seedReadyHunt('academygatenew', 'academygatenewproof', { createdAt: Date.now() - 60 * 60 * 1000 });
            const young = await post('academygatenew', { missionType: 'hunt', missionId: HUNT });
            assert.equal(young.body?.applied, true, JSON.stringify(young.body));
            assert.equal(((young.body?.reward as Record<string, unknown>).currency as Record<string, unknown>).fateShards, 1, 'L20+ is established; no separate account-age gate (reset week pays)');
        });
    });
});
