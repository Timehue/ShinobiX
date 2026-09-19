import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

// The heartbeat returns the full sector roster only when the client needs it,
// and pushes the presence changes it makes to socket-connected sector-mates.

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
const PLAYER = 'rosterbeat';
const SAVE = `save:${PLAYER}`;
let kv: typeof import('../_storage.js').kv;
let presence: typeof import('../_realtime/online-store.js');
let broadcast: typeof import('../_realtime/presence-broadcast.js');
let heartbeat: Handler;
let token: string;
let ip = 0;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'heartbeat-roster-test-secret-with-plenty-of-entropy';
    ({ kv } = await import('../_storage.js'));
    presence = await import('../_realtime/online-store.js');
    broadcast = await import('../_realtime/presence-broadcast.js');
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    assert.ok(token);
    heartbeat = (await import('./heartbeat.js')).default as unknown as Handler;
});

after(() => {
    broadcast.setPresenceBroadcastIo(null);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    presence.onlineStore.remove(PLAYER);
    broadcast.setPresenceBroadcastIo(null);
    await kv.set(SAVE, {
        _saveVersion: 1, _saveAt: Date.now(), worldGeoV: 2, currentSector: 12, currentTile: 17,
        character: { name: PLAYER, level: 20, hp: 100, maxHp: 100 },
    });
});

async function beat(body: Json) {
    const out: { status: number; body?: Json } = { status: 200 };
    const res = { setHeader() {}, status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await heartbeat({ method: 'POST', body: { name: PLAYER, character: { name: PLAYER, level: 20 }, ...body },
        headers: { 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': `10.91.0.${++ip}` },
        socket: { remoteAddress: '10.91.1.1' } } as never, res as never);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    return out.body!;
}

function captureIo() {
    const emits: Array<{ room: string; event: string; payload: Json }> = [];
    const op = (room: string) => ({
        except: () => ({ emit: (event: string, payload: Json) => { emits.push({ room, event, payload }); return true; } }),
        emit: (event: string, payload: Json) => { emits.push({ room, event, payload }); return true; },
    });
    broadcast.setPresenceBroadcastIo({ to: op } as never);
    return emits;
}

test('a client without a live socket (or an older client) gets the roster on every beat', async () => {
    assert.ok(Array.isArray((await beat({ sector: 12 })).sectorMates));
    assert.ok(Array.isArray((await beat({ sector: 12 })).sectorMates));
});

test('a live-socket beat skips the roster once the player is placed and the sector agrees', async () => {
    const cold = await beat({ sector: 12, socketLive: true });
    assert.ok(Array.isArray(cold.sectorMates), 'a cold start still gets the roster');
    const warm = await beat({ sector: 12, socketLive: true });
    assert.equal('sectorMates' in warm, false);
    assert.equal(warm.sector, 12, 'the authoritative position still rides every beat');
    const resync = await beat({ sector: 12 });
    assert.ok(Array.isArray(resync.sectorMates), 'the periodic resync beat (no flag) gets it');
});

test('the roster comes back whenever the server corrects the client\'s sector', async () => {
    await beat({ sector: 12, socketLive: true });
    const corrected = await beat({ sector: 33, socketLive: true });
    assert.equal(corrected.sector, 12, 'a heartbeat cannot teleport');
    assert.ok(Array.isArray(corrected.sectorMates));
});

test('changes a beat makes are pushed to sector-mates: first appearance, battle flag, departure', async () => {
    const emits = captureIo();
    await beat({ sector: 12 });
    broadcast.flushPresenceUpdates();
    assert.deepEqual(emits.map((e) => [e.room, e.event]), [['sector:12', 'presence:updates']], 'a first appearance reaches peers');
    assert.equal(((emits[0].payload.players as Json[])[0]).name, PLAYER);

    emits.length = 0;
    await beat({ sector: 12 });
    broadcast.flushPresenceUpdates();
    assert.equal(emits.length, 0, 'a beat that changes nothing visible sends nothing');

    // A stale fight flag with no combat evidence behind it: the beat clears it,
    // and sector-mates must hear about that without waiting for a roster.
    presence.onlineStore.setInBattle(PLAYER, true);
    await beat({ sector: 12 });
    broadcast.flushPresenceUpdates();
    assert.deepEqual(emits.map((e) => e.event), ['presence:updates']);
    assert.equal(((emits[0].payload.players as Json[])[0]).inBattle, false);

    emits.length = 0;
    await beat({ sector: 0, enterTown: true });
    broadcast.flushPresenceUpdates();
    assert.deepEqual(emits.map((e) => [e.room, e.event]), [['sector:12', 'presence:leave'], ['sector:0', 'presence:updates']]);
});
