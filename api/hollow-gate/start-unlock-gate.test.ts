import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hollow-gate-start-unlock-gate-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let start: Handler;
let riftQuest: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let riftTargetSector: typeof import('../sector/_rift-quest.js').riftTargetSector;

const VILLAGE = 'Ashen Leaf Village';
const VILLAGE_ROW = 'game:village-state:ashenleafvillage';
const DAY = 24 * 60 * 60 * 1000;

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { ...body, playerName },
        headers: { 'content-type': 'application/json', 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function seedPlayer(playerName: string, extra: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        ...extra,
        character: {
            name: playerName, level: 34, village: VILLAGE, hp: 500, maxHp: 500,
            itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }],
        },
    });
}

const countKey = (playerName: string) => `hg-runs:${playerName}:${new Date().toISOString().slice(0, 10)}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ riftTargetSector } = await import('../sector/_rift-quest.js'));
    start = (await import('./start.js')).default as unknown as Handler;
    riftQuest = (await import('../sector/rift-quest.js')).default as unknown as Handler;
});

beforeEach(async (context) => {
    // hollow-gate/start keys its daily counter on a no-argument `new Date()`;
    // freeze it so a run that straddles UTC midnight reads the same key.
    if (!('mock' in context)) throw new Error('needs a per-test clock');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

afterEach(() => { delete process.env.HOLLOW_GATE_UNLOCK_ENFORCED; });

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('the unlock switch defaults off: a standard start without an open seal still runs', async () => {
    const { HOLLOW_GATE_UNLOCK_ENFORCED, hollowGateUnlockEnforced } = await import('./start.js');
    assert.equal(HOLLOW_GATE_UNLOCK_ENFORCED, false);
    assert.equal(hollowGateUnlockEnforced(), false);
    await seedPlayer('hgunlockoff');
    const started = await post(start, 'hgunlockoff', { requestId: 'hg-unlock-off-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.ok(started.body?.token);
});

test('every run token seals the starting level for its ryo scale (rebalance #1, I-18)', async () => {
    await seedPlayer('hgentrylevel');
    const started = await post(start, 'hgentrylevel', { requestId: 'hg-entry-level-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const run = await kv.get<{ entryLevel?: number }>(`hg-run:hgentrylevel:${String(started.body?.token)}`);
    assert.equal(run?.entryLevel, 34);
});

test('when enforced, a standard start without an open seal is refused before the key or a daily slot is spent', async () => {
    process.env.HOLLOW_GATE_UNLOCK_ENFORCED = '1';
    await seedPlayer('hgunlocksealed');
    await kv.set(VILLAGE_ROW, { hollowGateUnlockedUntil: Date.now() - 1 });
    const refused = await post(start, 'hgunlocksealed', { requestId: 'hg-unlock-sealed-1' });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.body?.error, 'hollow-gate-sealed');
    const save = await kv.get<{ character: { itemStacks: unknown } }>('save:hgunlocksealed');
    assert.deepEqual(save?.character.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }], 'the key is kept');
    assert.equal(await kv.get(countKey('hgunlocksealed')), null, 'no daily slot is spent');
    assert.deepEqual(await kv.keys('hg-run:hgunlocksealed:*'), [], 'no run token is minted');
});

test('when enforced, an open village seal admits the run', async () => {
    process.env.HOLLOW_GATE_UNLOCK_ENFORCED = 'on';
    await seedPlayer('hgunlockopen');
    await kv.set(VILLAGE_ROW, { hollowGateUnlockedUntil: Date.now() + DAY });
    const started = await post(start, 'hgunlockopen', { requestId: 'hg-unlock-open-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.equal(await kv.get(countKey('hgunlockopen')), 1);
});

test('the kill value 0 turns enforcement off', async () => {
    process.env.HOLLOW_GATE_UNLOCK_ENFORCED = '0';
    await seedPlayer('hgunlockkill');
    const started = await post(start, 'hgunlockkill', { requestId: 'hg-unlock-kill-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
});

test('when enforced, an event gate needs the seal only if its config asks', async () => {
    process.env.HOLLOW_GATE_UNLOCK_ENFORCED = '1';
    const publish = (requiresUnlock: boolean) => kv.set('save:admin1', { hollowGateEventConfig: {
        id: 'event-festival', active: true, maxFloor: 2, keyCost: 0, requiresUnlock, updatedAt: Date.now(),
    } });
    await publish(false);
    await seedPlayer('hgunlockevent');
    const open = await post(start, 'hgunlockevent', { variantId: 'event-festival', requestId: 'hg-unlock-event-1' });
    assert.equal(open.statusCode, 200, JSON.stringify(open.body));

    await publish(true);
    await seedPlayer('hgunlockevent2');
    const sealed = await post(start, 'hgunlockevent2', { variantId: 'event-festival', requestId: 'hg-unlock-event-2' });
    assert.equal(sealed.statusCode, 409);
    assert.equal(sealed.body?.error, 'hollow-gate-sealed');
});

test('when enforced, an accepted rift never needs the village seal', async () => {
    process.env.HOLLOW_GATE_UNLOCK_ENFORCED = '1';
    const playerName = 'hgunlockrift';
    const rift = 'rift-hollow-stalker';
    await seedPlayer(playerName, { currentSector: riftTargetSector(playerName, rift) });
    const accepted = await post(riftQuest, playerName, { action: 'accept', riftId: rift });
    assert.equal(accepted.body?.ok, true, JSON.stringify(accepted.body));
    const started = await post(start, playerName, { variantId: rift, requestId: 'hg-unlock-rift-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const run = await kv.get<{ entryLevel?: number; variantId?: string }>(`hg-run:${playerName}:${String(started.body?.token)}`);
    assert.equal(run?.variantId, rift);
    assert.equal(run?.entryLevel, 34);
});
