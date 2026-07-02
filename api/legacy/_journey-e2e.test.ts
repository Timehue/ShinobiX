/*
 * Hermetic END-TO-END journey test: drives the REAL legacy handlers
 * (definitions, sage roll/accept, trial start/reroll/complete, stats) through
 * the full player arc — level-50 offer → permanent accept → stages 2..5 —
 * against an in-memory KV. No Supabase, no network, no mocks of the code
 * under test: the only substitution is the storage layer.
 *
 * This is the launch-gate "boot test" the unit suite can't provide: it locks
 * the cross-handler CONTRACTS (decorated trial objectives, accept idempotency,
 * the one-legacy NX, announcement matrix, hall/server-first NX entries, title
 * grants) as one flow. The node:test runner executes each test FILE in its own
 * process, so monkey-patching the exported kv object cannot leak into other
 * suites.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENABLE_LEGACY = '1';
process.env.ADMIN_PASSWORD = 'e2e-test-admin';
process.env.SUPABASE_URL ??= 'http://localhost:1'; // never contacted — kv is patched
process.env.SUPABASE_SERVICE_KEY ??= 'x';

// ── In-memory KV honoring nx (exactly what the NX seal + locks rely on) ─────
const store = new Map<string, unknown>();
const clone = (v: unknown) => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));

function fakeReq(method: string, body?: unknown, query: Record<string, string> = {}) {
    return {
        method, query, body: body ?? {},
        headers: { 'x-admin-password': 'e2e-test-admin', 'x-forwarded-for': '10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' },
    } as never;
}
function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res, status: (c: number) => { out.statusCode = c; return res; },
        json: (b: unknown) => { out.body = b; return res; }, end: () => res,
    };
    return { res: res as never, out };
}

// Loaded in before() — the CJS test build forbids top-level await.
let definitions: (req: never, res: never) => Promise<unknown>;
let sage: (req: never, res: never) => Promise<unknown>;
let trial: (req: never, res: never) => Promise<unknown>;
let statsEp: (req: never, res: never) => Promise<unknown>;
let LEGACY_BY_ID: ReadonlyMap<string, { title: string; rarity: string; category: string }>;

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((k) => k.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((k) => clone(store.get(k))) as never;
    kv.hgetall = async <T,>(key: string) => clone(store.get(key)) as T | null;
    (kv as unknown as Record<string, unknown>).hkeys = async (key: string) => Object.keys((store.get(key) as object) ?? {});
    (kv as unknown as Record<string, unknown>).hset = async (key: string, fields: Record<string, unknown>) => {
        store.set(key, { ...((store.get(key) as object) ?? {}), ...clone(fields) as object });
        return Object.keys(fields).length;
    };

    definitions = (await import('./definitions.js')).default as unknown as typeof definitions;
    sage = (await import('./sage.js')).default as unknown as typeof sage;
    trial = (await import('./trial.js')).default as unknown as typeof trial;
    statsEp = (await import('./stats.js')).default as unknown as typeof statsEp;
    LEGACY_BY_ID = (await import('../_legacy-defs.js')).LEGACY_BY_ID;

    store.set(`save:${P}`, {
        character: { name: P, level: 50, village: 'Stormveil Village', rank: 'Jonin', rankTitle: 'Jonin', earnedTitles: [] },
    });
    const bigStats: Record<string, number> = { updatedAt: Date.now(), bootstrappedAt: Date.now() };
    for (const key of ['pvpWins', 'pvpKills', 'rankedWins', 'sameRankWins', 'higherLevelWins', 'defensiveWins', 'comebackWins', 'bestKillStreak', 'warPvpKills', 'ninjutsuKills', 'ninjutsuDamage', 'genjutsuKills', 'genjutsuDamage', 'taijutsuKills', 'taijutsuDamage', 'bukijutsuKills', 'bukijutsuDamage', 'healingDone', 'shieldsApplied', 'damageBlocked', 'pveKills', 'eliteKills', 'missionCompletions', 'huntCompletions', 'raidsCompleted', 'hollowGateClears', 'dungeonClears', 'bossContribution', 'weeklyBossTop10', 'eventCompletions', 'firstClears', 'sectorDiscoveries', 'hiddenFinds', 'wandererQuests', 'villageDonations', 'warContribution', 'sectorCaptures', 'sectorDefenses', 'warsWon', 'villageTenureDays', 'petExpeditions', 'cardClashWins', 'tilesExplored', 'petDuelWins', 'endlessTowerBest', 'arenaTournaments']) {
        bigStats[key] = 5_000_000;
    }
    store.set(`legacy:stats:${P}`, bigStats);
});

const P = 'e2e-tester';

/** Bump the side-car by exactly the active trial's fresh-delta objectives. */
function satisfyActiveTrial() {
    const t = store.get(`legacy:trial:${P}`) as { objectives: Array<{ stat: string; delta: number }> };
    const s = store.get(`legacy:stats:${P}`) as Record<string, number>;
    for (const o of t.objectives) s[o.stat] = (s[o.stat] ?? 0) + o.delta;
    store.set(`legacy:stats:${P}`, s);
}

let offerIds: string[] = [];
let chosen = '';
const chosenDef = () => LEGACY_BY_ID.get(chosen)!;

test('flag-off canary: definitions 404s without ENABLE_LEGACY', async () => {
    delete process.env.ENABLE_LEGACY;
    const { res, out } = fakeRes();
    await definitions(fakeReq('GET'), res);
    assert.equal(out.statusCode, 404);
    process.env.ENABLE_LEGACY = '1';
});

test('definitions serves the full 100-legacy codex', async () => {
    const { res, out } = fakeRes();
    await definitions(fakeReq('GET'), res);
    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { legacies: unknown[] }).legacies.length, 100);
});

test('forced sage roll spawns a multi-choice offer', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'roll', playerName: P, force: true, sector: 12 }), res);
    const b = out.body as { spawn: boolean; offer?: { offers: Array<{ legacyId: string }> } };
    assert.equal(b.spawn, true);
    offerIds = b.offer!.offers.map((o) => o.legacyId);
    assert.ok(offerIds.length >= 2, `expected >=2 offers, got ${offerIds.length}`);
});

test('accept rejects a legacy that was not offered', async () => {
    const notOffered = [...LEGACY_BY_ID.keys()].find((id) => !offerIds.includes(id))!;
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: notOffered }), res);
    const b = out.body as { ok: boolean; reason?: string };
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'not-offered');
});

test('accept seals the path, auto-starts a DECORATED awaken trial, returns the intro', async () => {
    chosen = offerIds[0];
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body as { ok: boolean; legacy: { stage: number; legacyId: string; eraBorn?: number }; trial: { kind: string; objectives: Array<{ progress?: number; done?: boolean }> }; intro?: string };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 1);
    assert.equal(b.legacy.legacyId, chosen);
    // The legacy is stamped with the world era it was taken up in (>=1, and the
    // launch eras I-IV are unlocked so it lands at 4). Pins it to the timeline.
    assert.ok(typeof b.legacy.eraBorn === 'number' && b.legacy.eraBorn >= 1, 'accept must stamp the world era (eraBorn)');
    assert.equal(b.trial.kind, 'awaken');
    assert.equal(typeof b.trial.objectives[0]?.progress, 'number', 'objectives must be decorated with progress/done');
    assert.ok((b.intro ?? '').length > 50, 'the Sage narrative intro must ship with the trial');
    assert.ok(store.get(`legacy:accepted:${P}`), 'one-legacy NX marker must be sealed');
});

test('re-accepting the same legacy is idempotent — never a stage-1 reset', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body as { ok: boolean; legacy: { stage: number }; repaired?: boolean };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 1);
    assert.equal(b.repaired, false);
});

test('accepting a DIFFERENT legacy after sealing → 409 sealed (one legacy forever)', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: offerIds[1] }), res);
    assert.equal(out.statusCode, 409);
    assert.equal((out.body as { reason?: string }).reason, 'sealed');
});

test('awaken trial completes → stage 2, base title granted, announcement matrix respected', async () => {
    satisfyActiveTrial();
    const { res, out } = fakeRes();
    await trial(fakeReq('POST', { action: 'complete', playerName: P }), res);
    const b = out.body as { ok: boolean; legacy: { stage: number; titles: string[] }; title?: string; completion?: string };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 2);
    assert.equal(b.title, chosenDef().title);
    assert.ok(b.legacy.titles.includes(chosenDef().title));
    assert.ok((b.completion ?? '').length > 30, 'completion narrative must ship');
    const ann = (store.get('game:announcements') as Array<{ type: string }> | undefined) ?? [];
    const loud = chosenDef().rarity === 'legendary' || chosenDef().rarity === 'mythic';
    if (loud) assert.ok(ann.length > 0, `${chosenDef().rarity} awakening must announce`);
    else assert.equal(ann.filter((a) => a.type === 'legacy_awakening').length, 0, 'basic/rare awakenings stay quiet');
    if (chosenDef().rarity === 'mythic') {
        const herald = [...store.keys()].filter((k) => k.startsWith('chat:village:'));
        assert.equal(herald.length, 4, 'mythic herald must reach all 4 village chats');
    }
});

test('re-accept AFTER progression still returns the CURRENT stage', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body as { ok: boolean; legacy: { stage: number; titles: string[] } };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 2);
    assert.equal(b.legacy.titles.length, 1);
});

test('bind trial: start (variant 0) → reroll swaps the ask (attempt 2, variant 1) → stage 3', async () => {
    let r = fakeRes();
    await trial(fakeReq('POST', { action: 'start', playerName: P }), r.res);
    let b = r.out.body as { ok: boolean; trial: { kind: string; attempt: number; variant?: number; objectives: Array<{ stat: string }> } };
    assert.equal(b.ok, true);
    assert.equal(b.trial.kind, 'bind');
    assert.equal(b.trial.attempt, 1);
    assert.ok(b.trial.objectives.length >= 2, 'bind must add the cross-category secondary');
    const v0 = JSON.stringify(b.trial.objectives.map((o) => o.stat));

    r = fakeRes();
    await trial(fakeReq('POST', { action: 'reroll', playerName: P }), r.res);
    b = r.out.body as typeof b;
    assert.equal(b.ok, true);
    assert.equal(b.trial.attempt, 2);
    assert.equal(b.trial.variant, 1);
    assert.notEqual(JSON.stringify(b.trial.objectives.map((o) => o.stat)), v0, 'reroll must change the ask');

    satisfyActiveTrial();
    r = fakeRes();
    await trial(fakeReq('POST', { action: 'complete', playerName: P }), r.res);
    assert.equal((r.out.body as { legacy: { stage: number } }).legacy.stage, 3);
});

test('prove → stage 4 with the Proven title; mythic → stage 5 with the Eternal title', async () => {
    for (const [kind, stage, titlePrefix] of [['prove', 4, 'Proven '], ['mythic', 5, 'Eternal ']] as const) {
        let r = fakeRes();
        await trial(fakeReq('POST', { action: 'start', playerName: P }), r.res);
        assert.equal((r.out.body as { trial: { kind: string } }).trial.kind, kind);
        satisfyActiveTrial();
        r = fakeRes();
        await trial(fakeReq('POST', { action: 'complete', playerName: P }), r.res);
        const done = r.out.body as { ok: boolean; legacy: { stage: number }; title?: string | null };
        assert.equal(done.ok, true);
        assert.equal(done.legacy.stage, stage);
        assert.equal(done.title, `${titlePrefix}${chosenDef().title}`);
    }
});

test('the summit is permanent history: hall entries minted, no further trials', async () => {
    const hall = (store.get('hall:entries') as Array<{ entryType: string }> | undefined) ?? [];
    assert.ok(hall.some((e) => e.entryType === 'legacy_summit'), 'summit hall entry must exist');
    assert.ok(hall.some((e) => e.entryType === 'server_first'), 'server-first summit must be recorded');
    const { res, out } = fakeRes();
    await trial(fakeReq('POST', { action: 'start', playerName: P }), res);
    const b = out.body as { ok: boolean; reason?: string };
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'complete');
});

test('status endpoint reflects the finished journey (stage 5, 3 titles, category resolved)', async () => {
    const { res, out } = fakeRes();
    await statsEp(fakeReq('GET', undefined, { playerName: P }), res);
    const b = out.body as { legacy: { stage: number; titles: string[] }; legacyCategory?: string };
    assert.equal(b.legacy.stage, 5);
    assert.equal(b.legacy.titles.length, 3);
    assert.equal(b.legacyCategory, chosenDef().category);
});
