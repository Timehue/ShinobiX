"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
process.env.ENABLE_LEGACY = '1';
process.env.ADMIN_PASSWORD = 'e2e-test-admin';
process.env.SUPABASE_URL ??= 'http://localhost:1'; // never contacted — kv is patched
process.env.SUPABASE_SERVICE_KEY ??= 'x';
// ── In-memory KV honoring nx (exactly what the NX seal + locks rely on) ─────
const store = new Map();
const clone = (v) => (v === undefined || v === null) ? null : JSON.parse(JSON.stringify(v));
function fakeReq(method, body, query = {}) {
    return {
        method, query, body: body ?? {},
        headers: { 'x-admin-password': 'e2e-test-admin', 'x-forwarded-for': '10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' },
    };
}
function fakeRes() {
    const out = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res, status: (c) => { out.statusCode = c; return res; },
        json: (b) => { out.body = b; return res; }, end: () => res,
    };
    return { res: res, out };
}
// Loaded in before() — the CJS test build forbids top-level await.
let definitions;
let sage;
let trial;
let statsEp;
let LEGACY_BY_ID;
(0, node_test_1.before)(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async (key) => clone(store.get(key));
    kv.set = async (key, value, options) => {
        if (options?.nx && store.has(key))
            return null;
        store.set(key, clone(value));
        return 'OK';
    };
    kv.del = async (...keys) => keys.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
    kv.incr = async (key) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((k) => k.startsWith(prefix));
    };
    kv.mget = async (...keys) => keys.map((k) => clone(store.get(k)));
    kv.hgetall = async (key) => clone(store.get(key));
    kv.hkeys = async (key) => Object.keys(store.get(key) ?? {});
    kv.hset = async (key, fields) => {
        store.set(key, { ...(store.get(key) ?? {}), ...clone(fields) });
        return Object.keys(fields).length;
    };
    definitions = (await import('./definitions.js')).default;
    sage = (await import('./sage.js')).default;
    trial = (await import('./trial.js')).default;
    statsEp = (await import('./stats.js')).default;
    LEGACY_BY_ID = (await import('../_legacy-defs.js')).LEGACY_BY_ID;
    store.set(`save:${P}`, {
        character: { name: P, level: 50, village: 'Stormveil Village', rank: 'Jonin', rankTitle: 'Jonin', earnedTitles: [] },
    });
    const bigStats = { updatedAt: Date.now(), bootstrappedAt: Date.now() };
    for (const key of ['pvpWins', 'pvpKills', 'rankedWins', 'sameRankWins', 'higherLevelWins', 'defensiveWins', 'comebackWins', 'bestKillStreak', 'warPvpKills', 'ninjutsuKills', 'ninjutsuDamage', 'genjutsuKills', 'genjutsuDamage', 'taijutsuKills', 'taijutsuDamage', 'bukijutsuKills', 'bukijutsuDamage', 'healingDone', 'shieldsApplied', 'damageBlocked', 'pveKills', 'eliteKills', 'missionCompletions', 'huntCompletions', 'raidsCompleted', 'hollowGateClears', 'dungeonClears', 'bossContribution', 'weeklyBossTop10', 'eventCompletions', 'firstClears', 'sectorDiscoveries', 'hiddenFinds', 'wandererQuests', 'villageDonations', 'warContribution', 'sectorCaptures', 'sectorDefenses', 'warsWon', 'villageTenureDays', 'petExpeditions', 'cardClashWins', 'tilesExplored', 'petDuelWins', 'endlessTowerBest', 'arenaTournaments']) {
        bigStats[key] = 5_000_000;
    }
    store.set(`legacy:stats:${P}`, bigStats);
});
const P = 'e2e-tester';
/** Bump the side-car by exactly the active trial's fresh-delta objectives. */
function satisfyActiveTrial() {
    const t = store.get(`legacy:trial:${P}`);
    const s = store.get(`legacy:stats:${P}`);
    for (const o of t.objectives)
        s[o.stat] = (s[o.stat] ?? 0) + o.delta;
    store.set(`legacy:stats:${P}`, s);
}
let offerIds = [];
let chosen = '';
const chosenDef = () => LEGACY_BY_ID.get(chosen);
(0, node_test_1.test)('flag-off canary: definitions 404s without ENABLE_LEGACY', async () => {
    delete process.env.ENABLE_LEGACY;
    const { res, out } = fakeRes();
    await definitions(fakeReq('GET'), res);
    strict_1.default.equal(out.statusCode, 404);
    process.env.ENABLE_LEGACY = '1';
});
(0, node_test_1.test)('definitions serves the full 100-legacy codex', async () => {
    const { res, out } = fakeRes();
    await definitions(fakeReq('GET'), res);
    strict_1.default.equal(out.statusCode, 200);
    strict_1.default.equal(out.body.legacies.length, 100);
});
(0, node_test_1.test)('forced sage roll spawns a multi-choice offer', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'roll', playerName: P, force: true, sector: 12 }), res);
    const b = out.body;
    strict_1.default.equal(b.spawn, true);
    offerIds = b.offer.offers.map((o) => o.legacyId);
    strict_1.default.ok(offerIds.length >= 2, `expected >=2 offers, got ${offerIds.length}`);
});
(0, node_test_1.test)('accept rejects a legacy that was not offered', async () => {
    const notOffered = [...LEGACY_BY_ID.keys()].find((id) => !offerIds.includes(id));
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: notOffered }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, false);
    strict_1.default.equal(b.reason, 'not-offered');
});
(0, node_test_1.test)('accept seals the path, auto-starts a DECORATED awaken trial, returns the intro', async () => {
    chosen = offerIds[0];
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.legacy.stage, 1);
    strict_1.default.equal(b.legacy.legacyId, chosen);
    // The legacy is stamped with the world era it was taken up in (>=1, and the
    // launch eras I-IV are unlocked so it lands at 4). Pins it to the timeline.
    strict_1.default.ok(typeof b.legacy.eraBorn === 'number' && b.legacy.eraBorn >= 1, 'accept must stamp the world era (eraBorn)');
    strict_1.default.equal(b.trial.kind, 'awaken');
    strict_1.default.equal(typeof b.trial.objectives[0]?.progress, 'number', 'objectives must be decorated with progress/done');
    strict_1.default.ok((b.intro ?? '').length > 50, 'the Sage narrative intro must ship with the trial');
    strict_1.default.ok(store.get(`legacy:accepted:${P}`), 'one-legacy NX marker must be sealed');
});
(0, node_test_1.test)('re-accepting the same legacy is idempotent — never a stage-1 reset', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.legacy.stage, 1);
    strict_1.default.equal(b.repaired, false);
});
(0, node_test_1.test)('accepting a DIFFERENT legacy after sealing → 409 sealed (one legacy forever)', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: offerIds[1] }), res);
    strict_1.default.equal(out.statusCode, 409);
    strict_1.default.equal(out.body.reason, 'sealed');
});
(0, node_test_1.test)('awaken trial completes → stage 2, base title granted, announcement matrix respected', async () => {
    satisfyActiveTrial();
    const { res, out } = fakeRes();
    await trial(fakeReq('POST', { action: 'complete', playerName: P }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.legacy.stage, 2);
    strict_1.default.equal(b.title, chosenDef().title);
    strict_1.default.ok(b.legacy.titles.includes(chosenDef().title));
    strict_1.default.ok((b.completion ?? '').length > 30, 'completion narrative must ship');
    const ann = store.get('game:announcements') ?? [];
    const loud = chosenDef().rarity === 'legendary' || chosenDef().rarity === 'mythic';
    if (loud)
        strict_1.default.ok(ann.length > 0, `${chosenDef().rarity} awakening must announce`);
    else
        strict_1.default.equal(ann.filter((a) => a.type === 'legacy_awakening').length, 0, 'basic/rare awakenings stay quiet');
    if (chosenDef().rarity === 'mythic') {
        const herald = [...store.keys()].filter((k) => k.startsWith('chat:village:'));
        strict_1.default.equal(herald.length, 4, 'mythic herald must reach all 4 village chats');
    }
});
(0, node_test_1.test)('re-accept AFTER progression still returns the CURRENT stage', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.legacy.stage, 2);
    strict_1.default.equal(b.legacy.titles.length, 1);
});
(0, node_test_1.test)('bind trial: start (variant 0) → reroll swaps the ask (attempt 2, variant 1) → stage 3', async () => {
    let r = fakeRes();
    await trial(fakeReq('POST', { action: 'start', playerName: P }), r.res);
    let b = r.out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.trial.kind, 'bind');
    strict_1.default.equal(b.trial.attempt, 1);
    strict_1.default.ok(b.trial.objectives.length >= 2, 'bind must add the cross-category secondary');
    const v0 = JSON.stringify(b.trial.objectives.map((o) => o.stat));
    r = fakeRes();
    await trial(fakeReq('POST', { action: 'reroll', playerName: P }), r.res);
    b = r.out.body;
    strict_1.default.equal(b.ok, true);
    strict_1.default.equal(b.trial.attempt, 2);
    strict_1.default.equal(b.trial.variant, 1);
    strict_1.default.notEqual(JSON.stringify(b.trial.objectives.map((o) => o.stat)), v0, 'reroll must change the ask');
    satisfyActiveTrial();
    r = fakeRes();
    await trial(fakeReq('POST', { action: 'complete', playerName: P }), r.res);
    strict_1.default.equal(r.out.body.legacy.stage, 3);
});
(0, node_test_1.test)('prove → stage 4 with the Proven title; mythic → stage 5 with the Eternal title', async () => {
    for (const [kind, stage, titlePrefix] of [['prove', 4, 'Proven '], ['mythic', 5, 'Eternal ']]) {
        let r = fakeRes();
        await trial(fakeReq('POST', { action: 'start', playerName: P }), r.res);
        strict_1.default.equal(r.out.body.trial.kind, kind);
        satisfyActiveTrial();
        r = fakeRes();
        await trial(fakeReq('POST', { action: 'complete', playerName: P }), r.res);
        const done = r.out.body;
        strict_1.default.equal(done.ok, true);
        strict_1.default.equal(done.legacy.stage, stage);
        strict_1.default.equal(done.title, `${titlePrefix}${chosenDef().title}`);
    }
});
(0, node_test_1.test)('the summit is permanent history: hall entries minted, no further trials', async () => {
    const hall = store.get('hall:entries') ?? [];
    strict_1.default.ok(hall.some((e) => e.entryType === 'legacy_summit'), 'summit hall entry must exist');
    strict_1.default.ok(hall.some((e) => e.entryType === 'server_first'), 'server-first summit must be recorded');
    const { res, out } = fakeRes();
    await trial(fakeReq('POST', { action: 'start', playerName: P }), res);
    const b = out.body;
    strict_1.default.equal(b.ok, false);
    strict_1.default.equal(b.reason, 'complete');
});
(0, node_test_1.test)('status endpoint reflects the finished journey (stage 5, 3 titles, category resolved)', async () => {
    const { res, out } = fakeRes();
    await statsEp(fakeReq('GET', undefined, { playerName: P }), res);
    const b = out.body;
    strict_1.default.equal(b.legacy.stage, 5);
    strict_1.default.equal(b.legacy.titles.length, 3);
    strict_1.default.equal(b.legacyCategory, chosenDef().category);
});
