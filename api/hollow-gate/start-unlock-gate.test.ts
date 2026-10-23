import { after, before, beforeEach, test } from 'node:test';
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

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('the village Kage unlock is gated by the client, not refused by the start handler (owner 2026-10-22)', async () => {
    // The owner removed the server-side lock and its env switch: the Kage's
    // Town Hall purchase opens the Gate in the client, as before this rebalance.
    const startModule = await import('./start.js') as Record<string, unknown>;
    assert.equal(startModule.HOLLOW_GATE_UNLOCK_ENFORCED, undefined, 'no unlock switch exists');
    assert.equal(startModule.hollowGateUnlockEnforced, undefined, 'no unlock switch exists');
    await seedPlayer('hgunlockclient');
    await kv.set(VILLAGE_ROW, { hollowGateUnlockedUntil: Date.now() - 1 });
    const started = await post(start, 'hgunlockclient', { requestId: 'hg-unlock-client-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.ok(started.body?.token);
    assert.equal(await kv.get(countKey('hgunlockclient')), 1);
});

test('every run token seals the starting level for its ryo scale (rebalance #1, I-18)', async () => {
    await seedPlayer('hgentrylevel');
    const started = await post(start, 'hgentrylevel', { requestId: 'hg-entry-level-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const run = await kv.get<{ entryLevel?: number }>(`hg-run:hgentrylevel:${String(started.body?.token)}`);
    assert.equal(run?.entryLevel, 34);
});

test('an accepted rift run also seals its starting level', async () => {
    const playerName = 'hgentryrift';
    const rift = 'rift-hollow-stalker';
    await seedPlayer(playerName, { currentSector: riftTargetSector(playerName, rift) });
    const accepted = await post(riftQuest, playerName, { action: 'accept', riftId: rift });
    assert.equal(accepted.body?.ok, true, JSON.stringify(accepted.body));
    const started = await post(start, playerName, { variantId: rift, requestId: 'hg-entry-rift-1' });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const run = await kv.get<{ entryLevel?: number; variantId?: string }>(`hg-run:${playerName}:${String(started.body?.token)}`);
    assert.equal(run?.variantId, rift);
    assert.equal(run?.entryLevel, 34);
});
