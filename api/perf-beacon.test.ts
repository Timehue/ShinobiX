import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let handler: (req: unknown, res: unknown) => Promise<unknown>;
let sessionRecord: typeof import('./perf-beacon.js').sessionPerformanceRecord;
before(async () => {
    const module = await import('./perf-beacon.js');
    handler = module.default as unknown as typeof handler;
    sessionRecord = module.sessionPerformanceRecord;
});

function response() {
    const out = { status: 200, headers: {} as Record<string, unknown>, body: undefined as unknown };
    const res = {
        setHeader(key: string, value: unknown) { out.headers[key] = value; return res; },
        status(code: number) { out.status = code; return res; },
        json(body: unknown) { out.body = body; return res; },
        end() { return res; },
    };
    return { out, res };
}

function validSession() {
    return {
        kind: 'session', reason: 'interval', windowMs: 60_000,
        transitionCount: 4, slowTransitionCount: 1, maxScreenTransition: 301.2,
        longTaskSupported: true, longTaskCount: 2, longTaskTotal: 350.6, longTaskMax: 200.3,
        eventTimingSupported: true, eventCount: 6, maxEventDuration: 128,
        layoutShiftSupported: true, layoutShiftTotal: 0.1251234,
    };
}

test('session beacon logs only bounded numeric diagnostics, without identifiers or KV work', async t => {
    const { kv } = await import('./_storage.js');
    const noStorage = [t.mock.method(kv, 'get'), t.mock.method(kv, 'set'), t.mock.method(kv, 'incr'), t.mock.method(kv, 'mget')];
    const logged: unknown[][] = [];
    t.mock.method(console, 'log', (...args: unknown[]) => { logged.push(args); });
    const reply = response();
    const body = { ...validSession(), name: 'PRIVATE_NAME', accountId: 'PRIVATE_ACCOUNT', route: '/private-route',
        target: { id: 'PRIVATE_ELEMENT' }, token: 'PRIVATE_TOKEN', url: 'https://private.invalid',
        interactionId: 991122, net: 'PRIVATE_NETWORK', release: 'PRIVATE_RELEASE' };
    await handler({ method: 'POST', headers: {}, ip: '198.51.100.211', body }, reply.res);
    assert.equal(reply.out.status, 204); assert.equal(reply.out.headers['Cache-Control'], 'no-store');
    assert.equal(logged.length, 1); assert.equal(logged[0][0], '[perf]');
    const record = JSON.parse(String(logged[0][1]));
    assert.deepEqual(record, { ...validSession(), maxScreenTransition: 301, longTaskTotal: 351, longTaskMax: 200, layoutShiftTotal: 0.125123 });
    const serialized = String(logged[0][1]);
    for (const forbidden of ['PRIVATE', 'private-route', 'private.invalid', '991122', 'interactionId', 'accountId']) assert.ok(!serialized.includes(forbidden));
    for (const mock of noStorage) assert.equal(mock.mock.callCount(), 0);
});

test('session fields reject coercion, nonfinite/negative/absurd values, and hostile enums', () => {
    for (const value of [null, '', '12', true, [], {}, NaN, Infinity, -1, 600_000_001]) {
        const record = sessionRecord({ ...validSession(), transitionCount: value, eventCount: value,
            longTaskTotal: value, layoutShiftTotal: value, maxScreenTransition: value, windowMs: value });
        assert.equal(record.transitionCount, null); assert.equal(record.eventCount, null);
        assert.equal(record.longTaskTotal, null); assert.equal(record.layoutShiftTotal, null);
        assert.equal(record.maxScreenTransition, null); assert.equal(record.windowMs, null);
    }
    assert.equal(sessionRecord({ ...validSession(), windowMs: 59_999 }).windowMs, null);
    assert.equal(sessionRecord({ ...validSession(), reason: 'PRIVATE_REASON' }).reason, 'unknown');
    assert.equal(sessionRecord({ ...validSession(), eventTimingSupported: 'true' }).eventCount, null);
});

test('unsupported session metrics remain null even when the body supplies zero or forged observations', () => {
    const record = sessionRecord({ ...validSession(), longTaskSupported: false, eventTimingSupported: false,
        layoutShiftSupported: false, longTaskCount: 0, eventCount: 500, layoutShiftTotal: 0 });
    assert.deepEqual([record.longTaskCount, record.longTaskTotal, record.longTaskMax, record.eventCount,
        record.maxEventDuration, record.layoutShiftTotal], [null, null, null, null, null, null]);
    assert.equal(record.longTaskSupported, false); assert.equal(record.eventTimingSupported, false);
    assert.equal(record.layoutShiftSupported, false);
});

test('legacy boot record retains its existing fields, coercion, and response behavior', async t => {
    const logged: unknown[][] = [];
    t.mock.method(console, 'log', (...args: unknown[]) => { logged.push(args); });
    const reply = response();
    await handler({ method: 'POST', headers: {}, ip: '198.51.100.212', body: {
        kind: 'refresh', ttfb: 11.4, fcp: 22, lcp: 33, dcl: 44, load: 55,
        tFirstScreen: 66, tRestore: 77, tPlayable: 88, slowTransitionCount: 1, maxScreenTransition: 99,
        longTaskCount: 2, longTaskTotal: 222, longTaskMax: 111,
        htmlBytes: '100', jsBytes: 200, cssBytes: 300, imgBytes: 400, apiImgBytes: 500, apiImgCount: 6, totalBytes: 1500,
        net: '4g', vw: 390, vh: 844, dpr: 2.625, name: 'PRIVATE_NAME', eventCount: 900,
    } }, reply.res);
    assert.equal(reply.out.status, 204);
    assert.deepEqual(JSON.parse(String(logged[0][1])), {
        kind: 'refresh', ttfb: 11, fcp: 22, lcp: 33, dcl: 44, load: 55,
        tFirstScreen: 66, tRestore: 77, tPlayable: 88, slowTransitionCount: 1, maxScreenTransition: 99,
        longTaskCount: 2, longTaskTotal: 222, longTaskMax: 111,
        htmlBytes: 100, jsBytes: 200, cssBytes: 300, imgBytes: 400, apiImgBytes: 500, apiImgCount: 6, totalBytes: 1500,
        net: '4g', vw: 390, vh: 844, dpr: 2.63,
    });
});

test('malformed beacons never echo JSON body fragments into error logs', async t => {
    const logged: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
    const reply = response();
    await handler({ method: 'POST', headers: {}, ip: '198.51.100.213', body: '{"kind":"session","name":"PRIVATE_NAME",broken' }, reply.res);
    assert.equal(reply.out.status, 204);
    assert.deepEqual(logged, [['[perf-beacon] bad payload']]);
});

test('session beacons retain the existing unauthenticated 60-per-minute IP limit and method policy', async t => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 16, 12));
    for (const [method, expected] of [['OPTIONS', 200], ['GET', 405]] as const) {
        const reply = response(); await handler({ method, headers: {}, ip: '198.51.100.214' }, reply.res);
        assert.equal(reply.out.status, expected);
    }
    for (let i = 1; i <= 61; i += 1) {
        const reply = response();
        await handler({ method: 'POST', headers: {}, ip: '198.51.100.214', body: validSession() }, reply.res);
        assert.equal(reply.out.status, i <= 60 ? 204 : 429, `request ${i}`);
    }
});
