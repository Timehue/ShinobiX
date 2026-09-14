import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'story-field-authority-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Result = { status: number; body: Record<string, unknown> };
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
const player = 'rpgfieldplayer', questId = 'story-reckoning-mira-marker';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    handler = (await import('./story-reckoning.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [`*${player}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    online.remove(player);
    await kv.set(`save:${player}`, { character: {
        name: player, level: 30, storyVillage: 'Stormveil Village', storyProgress: 3,
        storyTraits: [], ryo: 100, fateShards: 0, inventory: [], totalTilesExplored: 10,
    } });
    online.upsert({ name: player, sector: 1, character: null });
});

after(() => { online.remove(player); });

async function post(action: string, extra: Record<string, unknown> = {}): Promise<Result> {
    const result: Result = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { result.status = code; return this; }, json(body: Record<string, unknown>) { result.body = body; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { 'x-player-token': token(player) }, body: { playerName: player, questId, action, ...extra }, socket: { remoteAddress: '127.5.6.7' } } as never, res as never);
    return result;
}

async function act(pointId: string, choiceId: string, sector: number) {
    // Fixture a settled arrival. Heartbeat upserts deliberately cannot move an
    // existing player between sectors without the travel-lease flow.
    online.remove(player);
    online.upsert({ name: player, sector, character: null });
    return post('field-act', { pointId, choiceId });
}

function standIn(sector: number) {
    online.remove(player);
    online.upsert({ name: player, sector, character: null });
}

test('accept requires live, settled presence at the named giver', async () => {
    online.remove(player);
    assert.equal((await post('accept')).body.reason, 'presence');
    standIn(2);
    assert.equal((await post('accept')).body.reason, 'wrong-place');
    standIn(1);
    online.startTravel(player, 2, Date.now() + 60_000, 1);
    assert.equal((await post('accept')).body.reason, 'traveling');
    standIn(1);
    online.setInBattle(player, true);
    assert.equal((await post('accept')).body.reason, 'in-battle');
    online.setInBattle(player, false);
    const accepted = await post('accept');
    assert.equal(accepted.body.ok, true);
    standIn(2);
    const replay = await post('accept');
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.replayed, true);
    assert.equal(((replay.body.character as Record<string, unknown>).activeStoryReckoning as Record<string, unknown>).id, questId);
});

test('field recovery requires the sealed route; retries cannot rewrite choices or pay twice', async () => {
    const accepted = await post('accept');
    assert.equal(accepted.body.ok, true);
    const active = accepted.body.activeStoryReckoning as Record<string, unknown>;
    assert.deepEqual(active.fieldWork, { version: 1, visits: [] });
    // Arbitrary exploration cannot finish a new field route.
    const rec = (await kv.get(`save:${player}`)) as { character: Record<string, unknown> };
    rec.character.totalTilesExplored = 1000;
    await kv.set(`save:${player}`, rec);
    assert.equal((await post('report')).body.reason, 'incomplete');
    assert.equal((await act('sv-signal-cairn', 'sv-signal-cairn-recover', 4)).body.reason, 'out-of-order');
    assert.equal((await act('sv-ridge-gate', 'sv-take-high-line', 4)).body.reason, 'wrong-place');
    assert.equal((await act('sv-ridge-gate', 'sv-take-high-line', 1)).body.ok, true);
    assert.equal((await act('sv-ridge-gate', 'sv-follow-picker-road', 1)).body.reason, 'choice-locked');
    assert.equal((await post('field-act', { pointId: 'sv-ridge-gate', choiceId: 'sv-take-high-line' })).body.replayed, true);
    assert.equal((await act('sv-broken-cable-span', 'sv-broken-cable-span-continue', 2)).body.ok, true);
    const finished = await act('sv-signal-cairn', 'sv-signal-cairn-recover', 4);
    assert.equal(finished.body.complete, true);
    assert.equal((finished.body.character as Record<string, unknown>).ryo, 100);
    assert.deepEqual((finished.body.character as Record<string, unknown>).inventory, ['event-kesa-marker']);
    assert.deepEqual((finished.body.character as Record<string, unknown>).storyTraits, ['sf-sv-high-line']);
    assert.equal((await post('field-act', { pointId: 'sv-signal-cairn', choiceId: 'sv-signal-cairn-recover' })).body.replayed, true);
    assert.equal((await post('turn-in')).body.reason, 'wrong-place');
    standIn(1);
    online.startTravel(player, 2, Date.now() + 60_000, 1);
    assert.equal((await post('turn-in')).body.reason, 'traveling');
    standIn(1);
    online.setInBattle(player, true);
    assert.equal((await post('turn-in')).body.reason, 'in-battle');
    online.setInBattle(player, false);
    const claimed = await post('turn-in');
    assert.equal(claimed.body.ok, true);
    assert.equal(claimed.body.ryo, 760);
    standIn(4);
    const replay = await post('turn-in');
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.totalRyo, claimed.body.totalRyo);
});

test('a durable redemption repairs a stale return without paying twice or requiring presence', async () => {
    await post('accept');
    await act('sv-ridge-gate', 'sv-take-high-line', 1);
    await act('sv-broken-cable-span', 'sv-broken-cable-span-continue', 2);
    await act('sv-signal-cairn', 'sv-signal-cairn-recover', 4);
    standIn(1);
    const claimed = await post('turn-in');
    assert.equal(claimed.body.ok, true);
    const paidRyo = (claimed.body.character as Record<string, unknown>).ryo;

    const rec = (await kv.get(`save:${player}`)) as { _saveVersion: number; character: Record<string, unknown>; activeStoryReckoningSeal?: unknown };
    const completed = ((rec.character.storyFieldRecords as Record<string, unknown>)[questId]);
    rec.character.storyTraits = ['sf-sv-high-line'];
    rec.character.activeStoryReckoning = {
        id: questId, stage: 'return', metric: 'totalTilesExplored', baseline: 10,
        target: 12, dropItemId: 'event-kesa-marker', fieldWork: completed,
    };
    rec.activeStoryReckoningSeal = { id: questId, stage: 'return', baseline: 10, at: 99, fieldWork: completed };
    await kv.set(`save:${player}`, rec);
    await kv.set(`story-reckoning:${player}`, rec.activeStoryReckoningSeal);
    standIn(4);

    const replay = await post('turn-in');
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.replayed, true);
    assert.equal((replay.body.character as Record<string, unknown>).ryo, paidRyo);
    assert.equal((replay.body.character as Record<string, unknown>).activeStoryReckoning, null);
    assert.ok(((replay.body.character as Record<string, unknown>).storyTraits as string[]).includes('svr-mira-marker-set'));
    assert.ok(Number(replay.body._saveVersion) > rec._saveVersion);
    const healed = (await kv.get(`save:${player}`)) as { character: Record<string, unknown>; activeStoryReckoningSeal?: unknown };
    assert.equal(healed.activeStoryReckoningSeal, null);
    assert.equal(healed.character.activeStoryReckoning, null);
    assert.equal((healed.character.redeemedStoryReckonings as unknown[]).length, 1);
    assert.equal((await post('accept')).body.reason, 'ineligible');

    const otherId = 'story-reckoning-vanta-ninth';
    const unrelatedSeal = { id: otherId, stage: 'task', baseline: 4, at: 123 };
    const unrelatedMirror = { id: otherId, stage: 'task', metric: 'totalAiKills', baseline: 4, target: 1, dropItemId: 'event-kesa-storm-seal' };
    const withOther = (await kv.get(`save:${player}`)) as { character: Record<string, unknown>; activeStoryReckoningSeal?: unknown };
    withOther.activeStoryReckoningSeal = { id: questId, stage: 'return', baseline: 10, at: 99, fieldWork: completed };
    withOther.character.activeStoryReckoning = {
        id: questId, stage: 'return', metric: 'totalTilesExplored', baseline: 10,
        target: 12, dropItemId: 'event-kesa-marker', fieldWork: completed,
    };
    await kv.set(`save:${player}`, withOther);
    await kv.set(`story-reckoning:${player}`, unrelatedSeal);
    const preserved = await post('turn-in');
    assert.equal(((preserved.body.activeStoryReckoning as Record<string, unknown>).id), otherId);
    assert.equal(((preserved.body.character as Record<string, unknown>).activeStoryReckoning as Record<string, unknown>).id, otherId);
    assert.deepEqual(((await kv.get(`save:${player}`)) as { activeStoryReckoningSeal: unknown }).activeStoryReckoningSeal, unrelatedSeal);
    assert.deepEqual(await kv.get(`story-reckoning:${player}`), unrelatedSeal);
    assert.deepEqual((preserved.body.character as Record<string, unknown>).activeStoryReckoning, unrelatedMirror);
});

test('leaving a field quest keeps its exact route for a later return', async () => {
    await post('accept');
    await act('sv-ridge-gate', 'sv-follow-picker-road', 1);
    await post('abandon');
    const resumed = await post('accept');
    const active = resumed.body.activeStoryReckoning as { fieldWork: { visits: unknown[] } };
    assert.deepEqual(active.fieldWork.visits, [{ pointId: 'sv-ridge-gate', choiceId: 'sv-follow-picker-road' }]);
    assert.equal((await act('sv-broken-cable-span', 'sv-broken-cable-span-continue', 2)).body.reason, 'out-of-order');
});

test('an existing pre-expansion collect seal still completes through its original counter', async () => {
    const rec = (await kv.get(`save:${player}`)) as { character: Record<string, unknown>; activeStoryReckoningSeal?: unknown };
    rec.activeStoryReckoningSeal = { id: questId, stage: 'task', baseline: 10, at: 1 };
    rec.character.activeStoryReckoning = { id: questId, stage: 'task', metric: 'totalTilesExplored', baseline: 10, target: 12, dropItemId: 'event-kesa-marker' };
    rec.character.totalTilesExplored = 22;
    await kv.set(`save:${player}`, rec);
    const reported = await post('report');
    assert.equal(reported.body.ok, true);
    assert.deepEqual((reported.body.character as Record<string, unknown>).inventory, ['event-kesa-marker']);
    assert.equal((reported.body.character as Record<string, unknown>).storyFieldRecords, undefined);
});

test('malformed field authority does not downgrade to the legacy counter', async () => {
    await post('accept');
    const rec = (await kv.get(`save:${player}`)) as { character: Record<string, unknown>; activeStoryReckoningSeal: Record<string, unknown> };
    rec.activeStoryReckoningSeal.fieldWork = { version: 1, visits: [{ pointId: 'sv-signal-cairn', choiceId: 'sv-signal-cairn-recover' }] };
    rec.character.totalTilesExplored = 5000;
    await kv.set(`save:${player}`, rec);
    await kv.del(`story-reckoning:${player}`);
    assert.equal((await post('report')).body.ok, false);
    assert.deepEqual(((await kv.get(`save:${player}`)) as { character: { inventory: unknown[] } }).character.inventory, []);
});
