import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { PVP_OPPONENT_UNAVAILABLE } from '../../shared/pvp-cancellation.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-guard-challenge-test-secret';

const VILLAGE = 'Ashen Leaf Village';
const SECTOR = 18;
const RAIDER = 'guardraider';
const GUARD = 'guardposted';

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let challenge: Handler;
let session: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: issueToken } = await import('../_auth.js'));
    challenge = (await import('./challenge.js')).default as unknown as Handler;
    session = (await import('../pvp/session.js')).default as unknown as Handler;
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
});

let callIndex = 0;
async function call(handler: Handler, body: Record<string, unknown>) {
    const out = { status: 200, body: undefined as any };
    const res = {
        setHeader() { return res; },
        status(status: number) { out.status = status; return res; },
        json(value: unknown) { out.body = value; return res; },
        end() { return res; },
    };
    callIndex += 1;
    await handler({
        method: 'POST', body, query: {},
        headers: { 'x-player-token': issueToken(RAIDER), 'x-player-name': RAIDER, 'x-forwarded-for': `127.8.0.${callIndex}` },
        socket: { remoteAddress: `127.8.0.${callIndex}` },
    } as never, res as never);
    return out;
}

// The endpoint allows one call per 3 s per raider, which these tests are not about.
const raid = (extra: Record<string, unknown> = {}) => {
    resetRateLimits();
    return call(challenge, { attackerCharacter: { name: RAIDER }, village: VILLAGE, guardName: GUARD, ...extra });
};

beforeEach(async () => {
    resetRateLimits();
    await kv.del('world-boss-event:active', 'world-boss-event:guard-queue', 'world-boss-event:guard-queue:queue');
    for (const name of [RAIDER, GUARD]) online.remove(name);
    await kv.del(`challenges:${GUARD}`);
    await kv.set(`guard:${GUARD}`, { name: GUARD, village: VILLAGE, level: 40, lastSeen: Date.now() }, { ex: 300 });
    for (const name of [RAIDER, GUARD]) {
        await kv.set(`save:${name}`, { currentSector: SECTOR, character: { name, level: 40, village: VILLAGE, stats: {}, hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 } });
    }
    online.upsert({ name: RAIDER, sector: SECTOR, character: null });
});

test('an offline guard leaves the raid to the garrison, even inside their five-minute roster row', async () => {
    const result = await raid();
    assert.equal(result.status, 200);
    assert.equal(result.body.noGuard, true);
    assert.equal(result.body.guardCharacter, undefined);
});

test('a guard at home or in another sector is not a duel this raider can start', async () => {
    for (const sector of [0, SECTOR + 1]) {
        online.upsert({ name: GUARD, sector, character: null });
        const result = await raid();
        assert.equal(result.body.noGuard, true, `guard in sector ${sector}`);
        online.remove(GUARD);
    }
});

test('a guard standing in the raider\'s sector is named for the duel', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    const result = await raid();
    assert.equal(result.body.pvp, true);
    assert.equal(result.body.guardName, GUARD);
    assert.equal(result.body.guardCharacter.name, GUARD);
});

test('a guard already in a fight is not named', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    online.setInBattle(GUARD, true);
    assert.equal((await raid()).body.noGuard, true);
});

test('an online unconscious or shielded guard leaves the raid to the garrison', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    for (const extra of [{ hp: 0, hospitalized: true }, { hp: 100, pvpShieldUntil: Date.now() + 60_000 }]) {
        const save = await kv.get<Record<string, any>>(`save:${GUARD}`);
        await kv.set(`save:${GUARD}`, { ...save, character: { ...save!.character, hospitalized: false, ...extra } });
        assert.equal((await raid()).body.noGuard, true);
    }
});

test('Field Recovery refuses a direct duel definitively, without creating a session', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    const save = await kv.get<Record<string, any>>(`save:${GUARD}`);
    await kv.set(`save:${GUARD}`, { ...save, character: { ...save!.character, pvpShieldUntil: Date.now() + 60_000 } });
    const result = await call(session, {
        p1Character: { name: RAIDER }, p2Character: { name: GUARD },
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.errorCode, PVP_OPPONENT_UNAVAILABLE);
    assert.ok(result.body.retryAfterMs > 0);
    assert.equal(result.body.battleId, undefined);
});

test('guard eligibility projects earned recovery without changing the saved vitals', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    const save = await kv.get<Record<string, any>>(`save:${GUARD}`);
    const stored = { ...save, _regenAt: Date.now() - 60_000, character: { ...save!.character, hp: 0 } };
    await kv.set(`save:${GUARD}`, stored);
    assert.equal((await raid()).body.pvp, true, 'elapsed recovery makes this guard eligible');
    assert.deepEqual(await kv.get(`save:${GUARD}`), stored, 'selection is a read-only projection');
});

test('a boss-queue ticket without a battle lock excludes a guard and refuses the duel definitively', async () => {
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    const now = Date.now();
    const event = { eventId: 'guard-queue', bossId: 'hollow-beast', status: 'roaming', hp: 100, hpMax: 100,
        startedAt: now - 1000, roamEndsAt: now + 60_000, endsAt: now + 120_000, endedAt: null };
    await kv.set('world-boss-event:active', event.eventId);
    await kv.set('world-boss-event:guard-queue', event);
    await kv.set('world-boss-event:guard-queue:queue', { tickets: [{ slug: GUARD }], activeMatchIds: [], updatedAt: now });
    const { battleLockFlagsForPlayers } = await import('../_elapsed-state.js');
    assert.equal((await battleLockFlagsForPlayers([GUARD])).get(GUARD), false);
    assert.equal((await raid()).body.noGuard, true);
    const refused = await call(session, {
        p1Character: { name: RAIDER }, p2Character: { name: GUARD },
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true,
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.errorCode, PVP_OPPONENT_UNAVAILABLE);
    assert.match(refused.body.error, /world boss team/);
    await kv.set('world-boss-event:guard-queue', { ...event, status: 'stopped' });
    assert.equal((await raid()).body.pvp, true, 'a closed event ticket no longer blocks the healthy guard');
});

test('the notice for a duel that already started reaches a guard who has since moved', async () => {
    online.upsert({ name: GUARD, sector: 0, character: null });
    const result = await raid({ battleId: 'raid-duel-notice' });
    assert.equal(result.body.pvp, true);
    const inbox = await kv.get<Array<{ battleId?: string }>>(`challenges:${GUARD}`);
    assert.equal(inbox?.[0]?.battleId, 'raid-duel-notice');
});

test('a duel refused for where the opponent stands is marked as final, so no client retries it', async () => {
    const create = () => call(session, {
        p1Character: { name: RAIDER }, p2Character: { name: GUARD },
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true,
    });
    const offline = await create();
    assert.equal(offline.status, 404);
    assert.equal(offline.body.errorCode, PVP_OPPONENT_UNAVAILABLE);
    online.upsert({ name: GUARD, sector: 0, character: null });
    const home = await create();
    assert.equal(home.status, 409);
    assert.equal(home.body.errorCode, PVP_OPPONENT_UNAVAILABLE);
});

test('the creator\'s own presence not being ready stays retryable', async () => {
    online.remove(RAIDER);
    online.upsert({ name: GUARD, sector: SECTOR, character: null });
    const result = await call(session, {
        p1Character: { name: RAIDER }, p2Character: { name: GUARD },
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.errorCode, undefined);
});
