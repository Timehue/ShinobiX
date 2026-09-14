process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'heartbeat-ack-test-admin';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F18 — the heartbeat's offline notices and heal signal were consumed BEFORE
 * the response was acknowledged: a lost response lost the notice. Bodies that
 * declare `noticeAck: true` are delivered ids, nothing is consumed on delivery,
 * and `ackNotices` / `ackHeal` remove exactly what was shown. Bodies without
 * the flag keep the legacy consume-on-delivery behavior, so an old client is
 * never spammed with notices it cannot acknowledge.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let notices: typeof import('./_offline-notices.js');
let withNoticeIds: typeof import('./heartbeat.js').withNoticeIds;
let handler: Handler;

const PLAYER = 'ackbeatplayer';
const NOW = Date.UTC(2026, 8, 6, 6, 0, 0);
let ipSeed = 0;

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

async function post(body: Json) {
    const ip = `10.60.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { name: PLAYER, sector: 12, character: { level: 20 }, tile: 5, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

const inboxKey = () => notices.offlineNoticesKey(PLAYER);
const inbox = async () => notices.parseOfflineNotices(await kv.get(inboxKey()));
const healKey = `heal-signal:${PLAYER}`;

async function seed() {
    await kv.del(inboxKey());
    await notices.pushOfflineNotice(PLAYER, { kind: 'sleeper-kill', by: 'Raider', village: 'V', sector: 7, at: NOW });
    await notices.pushOfflineNotice(PLAYER, { kind: 'bounty-placed', by: 'Rival', sector: 0, at: NOW + 1, amount: 500, total: 500 });
    await kv.set(healKey, { by: 'Medic', at: NOW + 2 }, { ex: 120 });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    notices = await import('./_offline-notices.js');
    const beat = await import('./heartbeat.js');
    ({ withNoticeIds } = beat);
    handler = beat.default as unknown as Handler;
});

beforeEach(seed);

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('heartbeat notice acknowledgement', { concurrency: false }, () => {
    it('a legacy body keeps consume-on-delivery, exactly as before', async () => {
        const out = await post({});
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const delivered = out.body?.pendingNotices as Json[];
        assert.equal(delivered.length, 2);
        assert.equal(delivered[0].id, undefined, 'no ids for a client that cannot ack');
        assert.deepEqual(out.body?.pendingHeal, { by: 'Medic' }, 'the exact old shape');
        assert.deepEqual(await inbox(), [], 'consumed on delivery');
        assert.equal(await kv.get(healKey), null);
    });

    it('an ack-protocol body is delivered ids and consumes nothing until acknowledged', async () => {
        const first = await post({ noticeAck: true, ackNotices: [] });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const delivered = first.body?.pendingNotices as Array<Json & { id: string }>;
        assert.equal(delivered.length, 2);
        assert.ok(delivered.every((n) => typeof n.id === 'string' && n.id.length >= 4));
        assert.deepEqual(first.body?.pendingHeal, { by: 'Medic', id: String(NOW + 2) });
        assert.equal((await inbox()).length, 2, 'undelivered until acknowledged');
        assert.ok(await kv.get(healKey), 'the heal signal survives an unacknowledged delivery');

        // The response was lost: the next beat re-delivers the SAME ids.
        const again = await post({ noticeAck: true, ackNotices: [] });
        assert.deepEqual((again.body?.pendingNotices as Array<{ id: string }>).map((n) => n.id), delivered.map((n) => n.id));

        // Acknowledge one notice and the heal: exactly those are removed, and
        // the beat that acknowledges them does not deliver them again.
        const acked = await post({ noticeAck: true, ackNotices: [delivered[0].id], ackHeal: NOW + 2 });
        assert.equal(acked.statusCode, 200, JSON.stringify(acked.body));
        assert.deepEqual((acked.body?.pendingNotices as Array<{ id: string }>).map((n) => n.id), [delivered[1].id]);
        assert.equal(acked.body?.pendingHeal, null);
        assert.equal((await inbox()).length, 1);
        assert.equal(await kv.get(healKey), null, 'the heal signal is gone once its id came back');

        // A notice pushed meanwhile survives the final acknowledgement.
        await notices.pushOfflineNotice(PLAYER, { kind: 'merc-raid', by: 'Mist mercenaries', sector: 9, at: NOW + 3 });
        const last = await post({ noticeAck: true, ackNotices: [delivered[1].id] });
        const remaining = await inbox();
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].kind, 'merc-raid');
        assert.equal((last.body?.pendingNotices as Json[]).length, 1);
        assert.equal((last.body?.pendingNotices as Json[])[0].kind, 'merc-raid');
    });

    it('a wrong or stale ack removes nothing, and ids are stable per notice', async () => {
        const first = await post({ noticeAck: true });
        const ids = (first.body?.pendingNotices as Array<{ id: string }>).map((n) => n.id);
        await post({ noticeAck: true, ackNotices: ['not-a-real-id'], ackHeal: 12345 });
        assert.equal((await inbox()).length, 2);
        assert.ok(await kv.get(healKey));
        assert.deepEqual(withNoticeIds(await inbox()).map((n) => n.id), ids, 'ids are derived from the notice identity');
    });
});
