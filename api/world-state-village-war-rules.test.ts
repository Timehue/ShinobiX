import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { PvpSession } from './pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-war-rules-test-secret';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * The all-out village war's server rules after the 2026-10-08 war audit, each
 * driven through the real /api/world-state handler on the in-memory store:
 *
 *  - territory ownership and HP are server authority (no no-fight raids, no
 *    player claims, no village-war map flips);
 *  - a player can only spend a war-mission token on an existing war, and the
 *    server applies its sealed damage and ends the war at 0 HP;
 *  - declarations name real war villages, seal Ramparts HP and a neutral war
 *    ground, and settle the predecessor's spoils first;
 *  - decay is applied one day at a time, and every ending stamps MVPs;
 *  - spoils settle exactly once even when a write fails partway;
 *  - a verified PvP raid on the war ground grinds and captures it;
 *  - mercenaries never raise a fallen village; Ramparts bought mid-war raise HP;
 *  - the public GET never shows a hirer's personal Honor Seal balance.
 */

const LEAF = 'Ashen Leaf Village';
const MIST = 'Moonshadow Village';
const PAIR_ID = 'ashenleafvillage-vs-moonshadowvillage';
const WAR_KEY = `world:war:${PAIR_ID}`;
const DAY = 24 * 60 * 60 * 1_000;

let kv: typeof import('./_storage.js').kv;
let handler: typeof import('./world-state.js').default;
let world: typeof import('./world-state.js');
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let raidProgressionReceiptId: typeof import('./missions/_raid-progression.js').raidProgressionReceiptId;

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

let ip = 0;
async function call(player: string | null, body: Record<string, unknown> | null, method = 'POST') {
    const { out, res } = response();
    const addr = `10.91.0.${(++ip % 250) + 1}`;
    await handler({
        method,
        body: body ?? undefined,
        query: {},
        headers: {
            ...(player ? { 'x-player-token': issuePlayerToken(player) } : {}),
            'x-forwarded-for': addr,
        },
        socket: { remoteAddress: addr },
    } as never, res);
    return out;
}

function liveWar(overrides: Record<string, unknown> = {}) {
    const startedAt = Date.now() - 3 * 60 * 60 * 1_000;
    return {
        id: PAIR_ID,
        villages: [LEAF, MIST],
        hp: { [LEAF]: 5_000, [MIST]: 5_000 },
        warGroundSector: 47,
        warGroundHp: 1_000,
        startedAt,
        pendingUntil: startedAt + 60 * 60 * 1_000,
        updatedAt: startedAt,
        declarationGeneration: 1,
        warCrateId: `war-crate-${PAIR_ID}-g1`,
        contributions: {},
        ...overrides,
    };
}

async function mintMissionToken(id: string, player: string, village: string, damage = 30) {
    await kv.set(`war:mission-token:${id}`, { playerName: player, village, damage, expiresAt: Date.now() + 15 * 60_000 });
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ raidProgressionReceiptId } = await import('./missions/_raid-progression.js'));
    world = (await import('./world-state.js')) as unknown as typeof world;
    handler = world.default as unknown as typeof handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set('save:leafkage', { character: { name: 'Leaf Kage', village: LEAF } });
    await kv.set('save:mistkage', { character: { name: 'Mist Kage', village: MIST } });
    await kv.set('save:leafgenin', { character: { name: 'Leaf Genin', village: LEAF } });
    await kv.set('save:mistgenin', { character: { name: 'Mist Genin', village: MIST } });
    await kv.set('village:kage:ashen-leaf-village', { seatedKage: 'leafkage' });
    await kv.set('village:kage:moonshadow-village', { seatedKage: 'mistkage' });
});

describe('territory: ownership and HP are server authority', { concurrency: false }, () => {
    it('a warring villager cannot raid an enemy village sector down with no fight', async () => {
        await kv.set(WAR_KEY, liveWar());
        await kv.set('world:territory:18', { sector: 18, ownerVillage: MIST, hp: 20_000 });
        const raid = await call('leafgenin', { kind: 'territory', territory: { sector: 18, ownerVillage: MIST, hp: 19_000 } });
        assert.equal(raid.statusCode, 403, JSON.stringify(raid.body));
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 20_000);
    });

    it('a player cannot stamp their village onto an unowned sector', async () => {
        const claim = await call('leafgenin', { kind: 'territory', territory: { sector: 48, ownerVillage: LEAF } });
        assert.equal(claim.statusCode, 403);
        assert.equal(await kv.get('world:territory:48'), null);
    });

    it('owners keep editing their own sector, and an omitted hp keeps the stored value', async () => {
        await kv.set('world:territory:10', { sector: 10, ownerVillage: LEAF, hp: 7_500, guards: [] });
        const edit = await call('leafgenin', { kind: 'territory', territory: { sector: 10, weather: 'rain' } });
        assert.equal(edit.statusCode, 200, JSON.stringify(edit.body));
        const stored = await kv.get<Record<string, unknown>>('world:territory:10');
        assert.equal(stored?.weather, 'rain');
        assert.equal(stored?.hp, 7_500, 'a PATCH without hp must not reset the sector to full');
        const heal = await call('leafgenin', { kind: 'territory', territory: { sector: 10, hp: 8_500 } });
        assert.equal(heal.statusCode, 403, 'owners cannot repair HP through this route either');
    });
});

describe('declaration', { concurrency: false }, () => {
    it('refuses a war on a village that does not exist', async () => {
        const out = await call('leafkage', { kind: 'war', war: { villages: [LEAF, 'Nobody Village'], warGroundSector: 9 } });
        assert.equal(out.statusCode, 400);
        assert.equal((await kv.keys('world:war:*')).length, 0);
    });

    it('seals Ramparts HP per village and picks a neutral central war ground', async () => {
        await kv.set('world:territory:1', { sector: 1, ownerVillage: 'Stormveil Village' });
        await kv.set('shared:village-war:ashenleafvillage', { warResources: 2_000, structures: { ramparts: 10 } });
        await kv.set('shared:village-war:moonshadowvillage', { warResources: 0, structures: { ramparts: 10 }, dormant: true });
        const out = await call('leafkage', { kind: 'war', war: { villages: [LEAF, MIST], warGroundSector: 9 } });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const war = out.body?.war;
        assert.deepEqual(war.hpMax, { [LEAF]: 5_750, [MIST]: 5_000 }, 'L10 Ramparts = +15%; dormant Ramparts give nothing');
        assert.deepEqual(war.hp, war.hpMax);
        assert.ok([47, 48, 49, 50].includes(war.warGroundSector), `war ground ${war.warGroundSector} must be a central keep sector`);
        assert.notEqual(war.warGroundSector, 9, 'the client may not pick its own gate as the war ground');
    });

    it('settles the previous war\'s spoils before a rematch replaces it', async () => {
        await kv.set('world:territory:1', { sector: 1, ownerVillage: 'Stormveil Village' });
        await kv.set('shared:village-war:ashenleafvillage', { warResources: 2_000 });
        await kv.set('game:village-state:moonshadowvillage', { treasury: { ryo: 100_000, honorSeals: 200, fateShards: 50 } });
        await kv.set('game:village-state:ashenleafvillage', { treasury: { ryo: 0 } });
        const endedAt = Date.now() - 8 * DAY;
        await kv.set(WAR_KEY, liveWar({ endedAt, winnerVillage: LEAF, startedAt: endedAt - DAY, pendingUntil: endedAt - DAY + 60_000, updatedAt: endedAt }));
        const rematch = await call('leafkage', { kind: 'war', war: { villages: [LEAF, MIST] } });
        assert.equal(rematch.statusCode, 200, JSON.stringify(rematch.body));
        assert.equal((await kv.get<Record<string, any>>('game:village-state:ashenleafvillage'))?.treasury?.ryo, 5_000);
        assert.equal((await kv.get<Record<string, any>>('game:village-state:moonshadowvillage'))?.treasury?.ryo, 95_000);
    });
});

describe('the war-mission lane', { concurrency: false }, () => {
    it('applies the token\'s sealed damage against stored HP, even from a stale cached row', async () => {
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 5_000, [MIST]: 4_000 } }));
        await mintMissionToken('mission-1', 'leafgenin', LEAF);
        // The client's cache still thinks Mist is at 4,100 (it missed a fight).
        const stale = liveWar({ hp: { [LEAF]: 5_000, [MIST]: 4_070 } });
        const out = await call('leafgenin', { kind: 'war', war: stale, warMissionToken: 'mission-1' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.war?.hp?.[MIST], 3_970);
        assert.equal(out.body?.war?.contributions?.leafgenin?.damage, 30);
        const replay = await call('leafgenin', { kind: 'war', war: stale, warMissionToken: 'mission-1' });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.replayed, true);
        assert.equal((await kv.get<Record<string, any>>(WAR_KEY))?.hp?.[MIST], 3_970, 'a token is spent once');
    });

    it('a mission that takes the enemy to 0 ends the war for the actor\'s village', async () => {
        await kv.set(WAR_KEY, liveWar({
            hp: { [LEAF]: 5_000, [MIST]: 20 },
            contributions: { misthero: { damage: 90, raids: 1, pvpKills: 1, side: MIST, name: 'Mist Hero' } },
        }));
        await mintMissionToken('mission-2', 'leafgenin', LEAF);
        const out = await call('leafgenin', { kind: 'war', war: liveWar(), warMissionToken: 'mission-2' });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const war = out.body?.war;
        assert.equal(war?.hp?.[MIST], 0);
        assert.equal(war?.winnerVillage, LEAF);
        assert.ok(Number(war?.endedAt) > 0);
        assert.equal(war?.loserCrateId, `loser-crate-${PAIR_ID}-g1`);
        assert.deepEqual(war?.mvpByVillage, { [LEAF]: 'Leaf Genin', [MIST]: 'Mist Hero' });
    });

    it('refuses every other player write: damage without a token, captures, winners and ends', async () => {
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 5_000, [MIST]: 50 } }));
        for (const war of [
            liveWar({ hp: { [LEAF]: 5_000, [MIST]: 0 } }),
            liveWar({ capturedBy: LEAF }),
            liveWar({ winnerVillage: LEAF, endedAt: Date.now() }),
        ]) {
            const out = await call('leafgenin', { kind: 'war', war });
            assert.equal(out.statusCode, 403, JSON.stringify(out.body));
        }
        const stored = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(stored?.hp?.[MIST], 50);
        assert.equal(stored?.capturedBy, undefined);
        assert.equal(stored?.endedAt, undefined);
    });

    it('a war-ground capture can no longer be ping-ponged with an account in the enemy village', async () => {
        // The old lane counted a capture as "earned" from the territory row alone,
        // so with the war ground at 0 HP a player and an alt in the enemy village
        // could flip `capturedBy` back and forth, each flip authorizing up to 100
        // damage to the enemy village with no fight at all.
        await kv.set(WAR_KEY, liveWar({ warGroundSector: 47 }));
        await kv.set('world:territory:47', { sector: 47, hp: 0 });
        for (let i = 0; i < 3; i++) {
            const mine = await call('leafgenin', { kind: 'war', war: liveWar({ capturedBy: LEAF, hp: { [LEAF]: 5_000, [MIST]: 4_900 } }) });
            assert.equal(mine.statusCode, 403, JSON.stringify(mine.body));
            const alt = await call('mistgenin', { kind: 'war', war: liveWar({ capturedBy: MIST }) });
            assert.equal(alt.statusCode, 403, JSON.stringify(alt.body));
        }
        const stored = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(stored?.hp?.[MIST], 5_000);
        assert.equal(stored?.capturedBy, undefined);
    });
});

describe('the war clock', { concurrency: false }, () => {
    it('applies owed decay one day at a time, so the side still standing wins', async () => {
        const start = Date.now() - 10 * DAY;
        const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
        await kv.set(WAR_KEY, liveWar({
            hp: { [LEAF]: 300, [MIST]: 900 },
            startedAt: start,
            pendingUntil: start + 60_000,
            lastDecayDate: twoDaysAgo,
        }));
        const out = await call('leafkage', { kind: 'war-command', command: 'propose-peace', villages: [LEAF, MIST] });
        assert.equal(out.statusCode, 409, 'decay ended the war before the offer landed');
        assert.equal(out.body?.war?.winnerVillage, MIST, 'lumping both days together used to call this a draw');
        assert.equal(out.body?.war?.hp?.[MIST], 400);
    });

    it('ends a war already decided on HP before anything else acts on it', async () => {
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 1_200, [MIST]: 0 } }));
        const out = await call('mistkage', { kind: 'war-command', command: 'propose-peace', villages: [LEAF, MIST] });
        assert.equal(out.statusCode, 409);
        assert.equal(out.body?.war?.winnerVillage, LEAF);
    });

    it('a timed-out war still stamps its MVPs', async () => {
        const start = Date.now() - 20 * DAY;
        await kv.set(WAR_KEY, liveWar({
            startedAt: start,
            pendingUntil: start + 60_000,
            lastDecayDate: new Date().toISOString().slice(0, 10),
            contributions: { leafhero: { damage: 400, raids: 2, pvpKills: 2, side: LEAF, name: 'Leaf Hero' } },
        }));
        const out = await call('leafkage', { kind: 'war-command', command: 'surrender', villages: [LEAF, MIST] });
        assert.equal(out.statusCode, 409);
        assert.equal(out.body?.war?.winnerVillage, undefined, 'a timeout has no winner');
        assert.deepEqual(out.body?.war?.mvpByVillage, { [LEAF]: 'Leaf Hero' });
    });
});

describe('spoils settlement', { concurrency: false }, () => {
    it('finishes a settlement that failed partway, without debiting the loser twice', async (t) => {
        await kv.set('world:territory:1', { sector: 1, ownerVillage: 'Stormveil Village' });
        await kv.set('shared:village-war:ashenleafvillage', { warResources: 2_000 });
        await kv.set('game:village-state:moonshadowvillage', { treasury: { ryo: 100_000, honorSeals: 200, fateShards: 50 } });
        await kv.set('game:village-state:ashenleafvillage', { treasury: { ryo: 0 } });
        const endedAt = Date.now() - 8 * DAY;
        await kv.set(WAR_KEY, liveWar({ endedAt, winnerVillage: LEAF, startedAt: endedAt - DAY, pendingUntil: endedAt - DAY + 60_000, updatedAt: endedAt }));

        const realSet = kv.set.bind(kv);
        let failures = 1;
        t.mock.method(kv, 'set', async (key: string, ...rest: unknown[]) => {
            if (key === 'game:village-state:ashenleafvillage' && failures > 0) {
                failures -= 1;
                throw new Error('simulated storage failure on the winner write');
            }
            return (realSet as (...args: unknown[]) => Promise<unknown>)(key, ...rest);
        });

        const first = await call('leafkage', { kind: 'war', war: { villages: [LEAF, MIST] } });
        assert.equal(first.statusCode, 503, 'the rematch waits for the settlement it could not finish');
        assert.equal((await kv.get<Record<string, any>>('game:village-state:moonshadowvillage'))?.treasury?.ryo, 95_000, 'the loser was debited once');
        assert.equal(await kv.get(`war:settled:${PAIR_ID}-g1`), null, 'nothing is marked done until every part lands');

        const retry = await call('leafkage', { kind: 'war', war: { villages: [LEAF, MIST] } });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal((await kv.get<Record<string, any>>('game:village-state:moonshadowvillage'))?.treasury?.ryo, 95_000, 'the retry does not debit again');
        assert.equal((await kv.get<Record<string, any>>('game:village-state:ashenleafvillage'))?.treasury?.ryo, 5_000, 'the winner is credited exactly once');
        assert.ok(await kv.get(`war:settled:${PAIR_ID}-g1`));
        const standing = await kv.get<Record<string, any>>('village:war-standing:ashenleafvillage');
        assert.equal(standing?.wins, 1);
    });
});

describe('war-ground raids through real fights', { concurrency: false }, () => {
    function raid(battleId: string, endedAt: number, sector = 47): PvpSession {
        return {
            battleId,
            p1: { name: 'leafgenin', character: { village: LEAF } },
            p2: { name: 'mistgenin', character: { village: MIST } },
            status: 'done',
            winner: 'p1',
            rewardAuthority: 'world',
            baseRewards: true,
            joined: { p1: true, p2: true },
            worldAttacker: { side: 'p1', name: 'leafgenin' },
            worldTerritoryEvidence: { version: 1, sector, ownerClan: '', ownerVillage: '', raidDamage: 0, observedAt: endedAt - 60_000 },
            rewardSector: sector,
            round: 3,
            log: [],
            createdAt: endedAt - 60_000,
            endedAt,
        } as unknown as PvpSession;
    }

    function proofFor(battleId: string, endedAt: number) {
        return { proofId: raidProgressionReceiptId(`pvp-raid:${battleId}`), playerName: 'leafgenin', amount: 0, sector: 47, at: endedAt, replayed: false };
    }

    it('grinds the war ground with a verified raid in an unowned sector', async () => {
        await kv.set(WAR_KEY, liveWar({ warGroundHp: 1_000 }));
        const endedAt = Date.now() - 1_000;
        const result = await world.settlePvpVillageWarContinuation('pvp-ground-0', 'leafgenin', raid('pvp-ground-0', endedAt), proofFor('pvp-ground-0', endedAt) as never);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.warGroundRewardEligible, true, 'a real war-ground win earns the daily war-ground bounty');
        const war = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(war?.warGroundHp, 995, 'a villager raid wears the ground down by its role value');
        assert.equal(war?.hp?.[MIST], 4_990, 'the win and the war-ground raid both land');
    });

    it('captures the war ground when a real fight takes it to 0', async () => {
        await kv.set(WAR_KEY, liveWar({ warGroundHp: 4 }));
        const endedAt = Date.now() - 1_000;
        const result = await world.settlePvpVillageWarContinuation('pvp-ground-1', 'leafgenin', raid('pvp-ground-1', endedAt), proofFor('pvp-ground-1', endedAt) as never);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const war = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(war?.capturedBy, LEAF, 'the ground fell to a real fight');
        assert.equal(war?.warGroundHp, 500, 'the ground resets for the other side');
        assert.equal(war?.hp?.[MIST], 5_000 - 5 - 5 - 100, 'win + raid + the capture bonus');
    });

    it('a win outside the war-ground sector is an ordinary win', async () => {
        await kv.set(WAR_KEY, liveWar({ warGroundHp: 1_000 }));
        const endedAt = Date.now() - 1_000;
        const elsewhere = { ...raid('pvp-ground-2', endedAt, 48) };
        const proof = { ...proofFor('pvp-ground-2', endedAt), sector: 48 };
        const result = await world.settlePvpVillageWarContinuation('pvp-ground-2', 'leafgenin', elsewhere, proof as never);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.warGroundRewardEligible, false);
        const war = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(war?.warGroundHp, 1_000);
        assert.equal(war?.hp?.[MIST], 4_995);
    });
});

describe('mercenaries and Ramparts', { concurrency: false }, () => {
    it('a merc hit never raises a village that has already fallen', async () => {
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 5_000, [MIST]: 0 } }));
        const result = await world.applyMercVillageWarDamage(LEAF, MIST, 50);
        assert.equal(result?.enemyHp ?? 0, 0);
        assert.equal((await kv.get<Record<string, any>>(WAR_KEY))?.hp?.[MIST], 0);
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 5_000, [MIST]: 120 } }));
        assert.equal((await world.applyMercVillageWarDamage(LEAF, MIST, 50))?.enemyHp, 70);
    });

    it('a merc never chips a war past its 14-day limit: the war ends instead', async () => {
        const startedAt = Date.now() - 15 * 24 * 60 * 60 * 1_000;
        await kv.set(WAR_KEY, liveWar({
            startedAt,
            pendingUntil: startedAt + 60 * 60 * 1_000,
            updatedAt: startedAt,
            // Decay is paid up, so only the time limit can end this war.
            lastDecayDate: new Date().toISOString().slice(0, 10),
            hp: { [LEAF]: 5_000, [MIST]: 3_000 },
        }));
        assert.equal(await world.applyMercVillageWarDamage(LEAF, MIST, 50), null);
        const war = await kv.get<Record<string, any>>(WAR_KEY);
        assert.ok(war?.endedAt, 'the timed-out war is ended');
        assert.equal(war?.winnerVillage, undefined, 'a timeout has no winner');
        assert.equal(war?.hp?.[MIST], 3_000, 'and the merc chipped nothing');
    });

    it('Ramparts bought mid-war raise that village\'s max and current war HP once', async () => {
        await kv.set(WAR_KEY, liveWar({ hp: { [LEAF]: 4_000, [MIST]: 5_000 }, hpMax: { [LEAF]: 5_000, [MIST]: 5_000 } }));
        await kv.set('shared:village-war:ashenleafvillage', { warResources: 0, structures: { ramparts: 4 } });
        assert.equal(await world.raiseVillageWarRampartsHp(LEAF), 1);
        const raised = await kv.get<Record<string, any>>(WAR_KEY);
        assert.equal(raised?.hpMax?.[LEAF], 5_300, '+1.5% per level');
        assert.equal(raised?.hp?.[LEAF], 4_300, 'current HP rises by the same 300');
        assert.equal(await world.raiseVillageWarRampartsHp(LEAF), 0, 'nothing more to raise');
    });
});

describe('the public GET', { concurrency: false }, () => {
    it('never shows a mercenary hirer\'s personal Honor Seal balance', async () => {
        await kv.set(WAR_KEY, liveWar({
            mercenaryHireReceipts: { 'hire-1': { version: 1, state: 'applied', balanceAfter: 9_999, dealt: 120 } },
        }));
        const out = await call(null, null, 'GET');
        assert.equal(out.statusCode, 200);
        const war = (out.body?.wars as Array<Record<string, any>>).find((w) => w.id === PAIR_ID);
        assert.ok(war, 'the war is listed');
        assert.equal(war?.mercenaryHireReceipts?.['hire-1']?.dealt, 120);
        assert.equal(war?.mercenaryHireReceipts?.['hire-1']?.balanceAfter, undefined);
    });
});
