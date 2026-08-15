import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-garrison-retired-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'retiredgarrison';
const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:moonshadowvillage-vs-frostfangvillage`;
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const CONTEST_KEY = `shared:sector-war:${CONTEST_ID}`;
const SAVE_KEY = `save:${PLAYER}`;
const REWARD_KEY = `pvp:rewarded:${PLAYER}:retired-garrison-sentinel`;
const SENTINEL_KEYS = [TERRITORY_KEY, CONTEST_KEY, SAVE_KEY, REWARD_KEY] as const;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./sector-war.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await Promise.all(SENTINEL_KEYS.map((key) => kv.del(key)));
});

after(async () => {
    await Promise.all(SENTINEL_KEYS.map((key) => kv.del(key)));
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

async function postGarrison(): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: { action: 'garrison', playerName: PLAYER, sector: SECTOR },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('Sector Combat garrison retirement', { concurrency: false }, () => {
    it('fails closed before contest, territory, save, or reward state can mutate', async () => {
        const now = Date.now();
        const startedAt = now - 3 * 60 * 60 * 1000;
        const sentinels = {
            [TERRITORY_KEY]: { sector: SECTOR, ownerVillage: DEFENDER, revision: 7 },
            [CONTEST_KEY]: {
                id: CONTEST_ID,
                sector: SECTOR,
                attackerVillage: ATTACKER,
                defenderVillage: DEFENDER,
                winCondition: 'combat',
                attackerPoints: 12,
                defenderPoints: 8,
                startedAt,
                endsAt: startedAt + 72 * 60 * 60 * 1000,
                updatedAt: startedAt,
                lastLiveBattleAt: startedAt,
                flipped: false,
                appliedBattles: [],
            },
            [SAVE_KEY]: {
                _saveVersion: 11,
                character: { name: PLAYER, village: ATTACKER, level: 40, ryo: 4321, xp: 99 },
            },
            [REWARD_KEY]: { state: 'reserved', amount: 55 },
        };
        await Promise.all(Object.entries(sentinels).map(([key, value]) => kv.set(key, value)));

        const response = await postGarrison();

        assert.equal(response.statusCode, 410);
        assert.match(String(response.body?.error), /PvP runtime owns their resolution/);
        for (const [key, value] of Object.entries(sentinels)) {
            assert.deepEqual(await kv.get(key), value, `${key} must remain byte-for-byte equivalent`);
        }
    });

    it('has no Tower resolver reachability while retaining authoritative human PvP actions', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'village', 'sector-war.ts'), 'utf8');

        assert.doesNotMatch(source, /towers\/_merc-fighters|\bresolveMercBattle\b|\bsealTowerFighter\b|\bdoGarrison\b/);
        assert.match(source, /case 'garrison': return res\.status\(410\)/);
        assert.match(source, /case 'attack': return await doAttack\(/);
        assert.match(source, /case 'resolve': return await doResolve\(/);
        assert.match(source, /`pvp:\$\{battleId\}`/);
        assert.match(source, /battle\.rewardAuthority !== 'world'/);
        assert.match(source, /pvpSessionMayReward\(battle\)/);
    });
});
