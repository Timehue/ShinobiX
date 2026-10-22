import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

/*
 * Dojo Circuit seal purse (2026-10 economy rebalance, owner amendment A7):
 * earning a seal pays 0.5 x A(L) per active minute of the verified victory,
 * once per (event, discipline, player), in its own receipted save write.
 */
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'dojo-purse-test-full';
process.env.SESSION_SECRET = 'dojo-purse-test-session-secret-at-least-32-chars';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./event.js').default;
let store: typeof import('./_store.js');
let token: string;
const admin = { 'x-admin-password': 'dojo-purse-test-full' };
const player = () => ({ 'x-player-token': token, 'x-player-name': 'akira' });
const MINUTE = 60_000;

async function request(body?: Record<string, unknown>, headers: Record<string, string> = admin) {
    const out = { status: 200, body: {} as any };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: unknown) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: body ? 'POST' : 'GET', body, headers, query: {}, socket: { remoteAddress: '127.0.0.92' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./event.js')).default as unknown as typeof handler;
    store = await import('./_store.js');
    token = (await import('../_auth.js')).issuePlayerToken('akira')!;
});

let clockWindow = 0;
beforeEach(async (context) => {
    // A fresh clock window per test keeps the route's rate window clear.
    if (!('mock' in context)) throw new Error('Circuit fixtures require a per-test clock.');
    context.mock.timers.enable({ apis: ['Date'], now: Date.now() + (++clockWindow) * 60_001 });
    const keys = await kv.keys('game:dojo-circuit:*');
    if (keys.length) await kv.del(...keys);
    await kv.set('save:akira', { character: { name: 'akira', village: 'Stormveil Village', level: 25, ryo: 1_000, starterCardsClaimed: true, pets: [{ id: 'pet-a' }] } });
});

async function openTrial(discipline: 'cards' | 'combat') {
    assert.equal((await request({ action: 'toggle', enabled: true })).status, 200);
    const scheduled = await request({ action: 'schedule', name: 'The Lantern Gathering', startsAt: Date.now() - 100, days: 7, featured: 'combat' });
    const eventId = scheduled.body.event.id as string;
    assert.equal((await request({ action: 'join', eventId }, player())).status, 200);
    const begun = await request({ action: 'begin', eventId, discipline }, player());
    return { eventId, openedAt: begun.body.attempt.openedAt as number };
}

const ryo = async () => (await kv.get<any>('save:akira')).character.ryo;

test('a checked-in seal pays 0.5 x A(L) per minute of the victory and says so', async () => {
    const { eventId, openedAt } = await openTrial('cards');
    // A(25) = 120 ryo a minute; 10 minutes x 0.5 x 120 = 600.
    await store.recordCircuitPendingVictory('akira', 'cards', { matchId: 'card-win', startedAt: openedAt, finishedAt: openedAt + 10 * MINUTE });
    const checked = await request({ action: 'check', eventId }, player());
    assert.equal(checked.status, 200);
    assert.equal(checked.body.message, 'Seal earned. Your victory is on the world board. +600 ryo.');
    assert.equal(await ryo(), 1_600);
});

test('an auto-recorded combat seal pays once, however often the victory is reported', async () => {
    const { openedAt } = await openTrial('combat');
    await store.recordCircuitCombatVictory('akira', openedAt + 1, openedAt + 1 + 4 * MINUTE);
    await store.recordCircuitCombatVictory('akira', openedAt + 1, openedAt + 1 + 4 * MINUTE);
    assert.equal(await ryo(), 1_000 + 240);
});

test('the purse is capped at 20 minutes and is receipted per event and discipline', async () => {
    const { eventId } = await openTrial('cards');
    const first = await store.creditCircuitSealPurse('akira', eventId, 'cards', Date.now() - 3 * 60 * MINUTE, Date.now());
    assert.deepEqual([first.ryo, first.minutes, first.reason], [1_200, 20, undefined]);
    const again = await store.creditCircuitSealPurse('akira', eventId, 'cards', Date.now() - 3 * 60 * MINUTE, Date.now());
    assert.equal(again.reason, 'already-paid');
    assert.equal(await ryo(), 2_200);
});
