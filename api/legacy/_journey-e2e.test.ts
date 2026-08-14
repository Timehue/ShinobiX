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
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
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
let acceptedVersion = 0;
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
    const b = out.body as {
        ok: boolean;
        legacy: { stage: number; legacyId: string; eraBorn?: number; acceptanceReceipt?: { id: string; auraStones: number } };
        trial: { id: string; kind: string; objectives: Array<{ progress?: number; done?: boolean }> };
        intro?: string;
        character?: { auraStones?: number };
        _saveVersion?: number;
    };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 1);
    assert.equal(b.legacy.legacyId, chosen);
    // The legacy is stamped with the world era it was taken up in (>=1, and the
    // launch eras I-IV are unlocked so it lands at 4). Pins it to the timeline.
    assert.ok(typeof b.legacy.eraBorn === 'number' && b.legacy.eraBorn >= 1, 'accept must stamp the world era (eraBorn)');
    // Accept grants the Aura Stones boon and its exact-once receipt in the SAME
    // player-save commit. No external marker may land ahead of the balance.
    const savedChar = (store.get(`save:${P}`) as { character?: { auraStones?: number; legacy?: { acceptanceReceipt?: unknown } }; _saveVersion?: number });
    assert.ok((savedChar.character?.auraStones ?? 0) >= 3, 'accept must grant the Aura Stones boon');
    assert.ok(savedChar.character?.legacy?.acceptanceReceipt, 'the atomic in-save acceptance receipt must exist');
    assert.equal(store.get(`legacy:aura-granted:${P}`), undefined, 'new accepts must not create the retired pre-save marker');
    assert.equal(b.character?.auraStones, savedChar.character?.auraStones, 'accept must return the authoritative character');
    assert.equal(b._saveVersion, savedChar._saveVersion, 'accept must echo the committed save version');
    acceptedVersion = b._saveVersion ?? 0;
    assert.ok(acceptedVersion > 0);
    assert.equal(
        b.legacy.acceptanceReceipt?.id,
        `legacy-accept:${P}:${chosen}`,
        'shared audit/announcement receipts must include player identity',
    );
    assert.ok(b.trial.id, 'the trial must carry a stable completion identity');
    assert.equal(b.trial.kind, 'awaken');
    assert.equal(typeof b.trial.objectives[0]?.progress, 'number', 'objectives must be decorated with progress/done');
    assert.ok((b.intro ?? '').length > 50, 'the Sage narrative intro must ship with the trial');
    assert.ok(store.get(`legacy:accepted:${P}`), 'one-legacy NX marker must be sealed');
});

test('re-accepting the same legacy is idempotent — never a stage-1 reset', async () => {
    const before = store.get(`save:${P}`) as { character: { auraStones?: number }; _saveVersion?: number };
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: chosen }), res);
    const b = out.body as { ok: boolean; legacy: { stage: number }; character?: { auraStones?: number }; _saveVersion?: number; repaired?: boolean };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 1);
    assert.equal(b.repaired, false);
    assert.equal(b.character?.auraStones, before.character.auraStones);
    assert.equal(b._saveVersion, before._saveVersion, 'a pure acceptance replay must not manufacture a save version');
});

test('accepting a DIFFERENT legacy after sealing → 409 sealed (one legacy forever)', async () => {
    const { res, out } = fakeRes();
    await sage(fakeReq('POST', { action: 'accept', playerName: P, legacyId: offerIds[1] }), res);
    assert.equal(out.statusCode, 409);
    assert.equal((out.body as { reason?: string }).reason, 'sealed');
});

test('ordinary stats GET repairs an expired marker-only accept exactly once across save, trial, Chronicle, and world receipts', async () => {
    const player = 'e2e-aura-repair';
    store.set(`save:${player}`, {
        character: {
            name: player,
            level: 50,
            village: 'Stormveil Village',
            rank: 'Jonin',
            rankTitle: 'Jonin',
            earnedTitles: [],
            auraStones: 0,
            starterCardsClaimed: true,
            tileCards: [],
        },
    });
    store.set(`legacy:stats:${player}`, clone(store.get(`legacy:stats:${P}`)));
    let response = fakeRes();
    await sage(fakeReq('POST', { action: 'roll', playerName: player, force: true, sector: 12 }), response.res);
    const offered = (response.out.body as { offer: { offers: Array<{ legacyId: string }> } }).offer.offers[0].legacyId;

    const storage = await import('../_storage.js');
    const kv = storage.kv;
    const originalSet = kv.set;
    let failSave = true;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (failSave && key === `save:${player}`) {
            failSave = false;
            throw new Error('injected acceptance save failure');
        }
        return originalSet(key, value, options);
    };
    response = fakeRes();
    try {
        await sage(fakeReq('POST', { action: 'accept', playerName: player, legacyId: offered }), response.res);
    } finally {
        kv.set = originalSet;
    }
    assert.equal(response.out.statusCode, 500);
    assert.ok(store.get(`legacy:accepted:${player}`), 'the permanent choice remains sealed for repair');
    assert.equal(store.get(`legacy:aura-granted:${player}`), undefined, 'no pre-save payout marker is created');
    store.delete(`legacy:sage-offer:${player}`); // the seven-day offer expires before the player returns

    response = fakeRes();
    await statsEp(fakeReq('GET', undefined, { playerName: player }), response.res);
    const repaired = response.out.body as {
        legacy: { legacyId: string; acceptanceReceipt?: { id: string; auraStones: number; chronicleCards: string[] } };
        trial: { legacyId: string; kind: string };
        character: { auraStones: number; tileCards: string[]; legacy: { acceptanceReceipt?: { auraStones: number } } };
        _saveVersion: number;
        repaired: boolean;
        effectsPending: boolean;
        offer: unknown;
    };
    const rarity = LEGACY_BY_ID.get(offered)!.rarity;
    assert.equal(rarity, 'mythic', 'the repair fixture must exercise announcement and Hall delivery');
    const expected = ({ mythic: 10, legendary: 8, rare: 5, basic: 3 } as Record<string, number>)[rarity];
    assert.equal(response.out.statusCode, 200);
    assert.equal(repaired.repaired, true, 'the read reports that it completed a stranded transaction');
    assert.equal(repaired.effectsPending, false, 'all durable acceptance effects were delivered');
    assert.equal(repaired.offer, null, 'recovery does not depend on or resurrect the expired offer');
    assert.equal(repaired.legacy.legacyId, offered);
    assert.equal(repaired.trial.legacyId, offered);
    assert.equal(repaired.trial.kind, 'awaken');
    assert.equal(repaired.character.auraStones, expected);
    assert.equal(repaired.character.legacy.acceptanceReceipt?.auraStones, expected);
    assert.equal(repaired.character.tileCards.filter((id) => id === 'story-wandering-sage').length, 1);
    assert.deepEqual(repaired.legacy.acceptanceReceipt?.chronicleCards, ['story-wandering-sage']);
    const repairVersion = repaired._saveVersion;
    assert.ok(repairVersion > 0, 'the repair returns its authoritative save version');

    const receiptId = `legacy-accept:${player}:${offered}`;
    const acceptanceEvents = () => ((store.get(`legacy:events:${player}`) as Array<{ receiptId?: string }> | undefined) ?? [])
        .filter((event) => event.receiptId === `${receiptId}:event`);
    const acceptanceAudits = () => ((store.get('audit:legacy') as Array<{ receiptId?: string }> | undefined) ?? [])
        .filter((entry) => entry.receiptId === `${receiptId}:audit`);
    const acceptanceAnnouncements = () => ((store.get('game:announcements') as Array<{ receiptId?: string }> | undefined) ?? [])
        .filter((entry) => entry.receiptId === `${receiptId}:announcement`);
    const acceptanceHallEntries = () => ((store.get('hall:entries') as Array<{ meta?: { hallNxKey?: string } }> | undefined) ?? [])
        .filter((entry) => entry.meta?.hallNxKey === `mythic-claim:${offered}:${player}`);
    assert.equal(acceptanceEvents().length, 1);
    assert.equal(acceptanceAudits().length, 1);
    if (rarity === 'mythic') {
        assert.equal(acceptanceAnnouncements().length, 1);
        assert.equal(acceptanceHallEntries().length, 1);
    } else {
        assert.equal(acceptanceAnnouncements().length, 0);
        assert.equal(acceptanceHallEntries().length, 0);
    }

    response = fakeRes();
    await sage(fakeReq('GET', undefined, { playerName: player }), response.res);
    const replay = response.out.body as { repaired: boolean; character?: unknown; _saveVersion?: number };
    const replaySave = store.get(`save:${player}`) as { _saveVersion: number; character: { auraStones: number; tileCards: string[] } };
    assert.equal(replay.repaired, false, 'an already settled read is not mislabeled as another repair');
    assert.equal(replay.character, undefined, 'unchanged status reads must not overwrite newer unsaved client state');
    assert.equal(replay._saveVersion, undefined, 'unchanged status reads need no snapshot version');
    assert.equal(replaySave.character.auraStones, expected, 'accept replay must not pay twice');
    assert.equal(replaySave.character.tileCards.filter((id) => id === 'story-wandering-sage').length, 1, 'read repair must not duplicate the Chronicle card');
    assert.equal(replaySave._saveVersion, repairVersion, 'accept replay must not bump an unchanged save');
    assert.equal(acceptanceEvents().length, 1, 'acceptance event is exact-once across ordinary reads');
    assert.equal(acceptanceAudits().length, 1, 'acceptance audit is exact-once across ordinary reads');
    if (rarity === 'mythic') {
        assert.equal(acceptanceAnnouncements().length, 1, 'acceptance announcement is exact-once across ordinary reads');
        assert.equal(acceptanceHallEntries().length, 1, 'acceptance Hall entry is exact-once across ordinary reads');
    }
});

test('awaken completion survives save→delete and delete→effects failures, then replays exactly once', async () => {
    satisfyActiveTrial();
    const active = store.get(`legacy:trial:${P}`) as { id: string };
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    const originalDel = kv.del;
    let failDelete = true;
    kv.del = async (...keys: string[]) => {
        if (failDelete && keys.includes(`legacy:trial:${P}`)) {
            failDelete = false;
            throw new Error('injected trial delete failure');
        }
        return originalDel(...keys);
    };

    let first = fakeRes();
    try {
        await trial(fakeReq('POST', { action: 'complete', playerName: P, trialId: active.id }), first.res);
    } finally {
        kv.del = originalDel;
    }
    assert.equal(first.out.statusCode, 500, 'a failed active-trial delete must surface as retryable failure');
    const committed = store.get(`save:${P}`) as {
        _saveVersion?: number;
        character: { legacy: { stage: number; trialCompletionReceipts?: Array<{ id: string }> } };
    };
    assert.equal(committed.character.legacy.stage, 2, 'the player advancement committed before the injected crash');
    assert.equal(committed.character.legacy.trialCompletionReceipts?.[0]?.id, active.id);
    assert.ok(store.get(`legacy:trial:${P}`), 'the active trial remains until its receipt can drive cleanup');
    const committedVersion = committed._saveVersion ?? 0;
    assert.ok(committedVersion > acceptedVersion);

    // Second attempt consumes the active trial, then fails the first
    // exact-once Era contribution. The in-save receipt must still make the
    // third attempt successful even though the active proof is now gone.
    const originalHset = kv.hset;
    let remainingEraFailures = 2;
    kv.hset = async (key: string, fields: Record<string, unknown>) => {
        if (remainingEraFailures > 0 && key === 'era:contrib-receipts:legaciesAwakened') {
            remainingEraFailures -= 1;
            throw new Error('injected world-effect failure');
        }
        return originalHset(key, fields);
    };
    const second = fakeRes();
    try {
        await trial(fakeReq('POST', { action: 'complete', playerName: P, trialId: active.id }), second.res);
        assert.equal(second.out.statusCode, 503);
        assert.equal(store.get(`legacy:trial:${P}`), undefined, 'receipt exists before active trial deletion');

        // A normal Legacy page reload must pump the durable receipt even though
        // there is no longer an active trial or client-held retry token. Keep the
        // injected outage alive for this first GET to prove the receipt remains
        // pending rather than being falsely acknowledged or lost.
        const pendingReload = fakeRes();
        await statsEp(fakeReq('GET', undefined, { playerName: P }), pendingReload.res);
        const pendingBody = pendingReload.out.body as {
            effectsPending?: boolean;
            effectsRepaired?: boolean;
            character?: unknown;
            _saveVersion?: number;
        };
        assert.equal(pendingReload.out.statusCode, 200);
        assert.equal(pendingBody.effectsPending, true);
        assert.equal(pendingBody.effectsRepaired, false);
        assert.equal(pendingBody.character, undefined, 'effect-only repair must not hydrate a routine GET snapshot');
        assert.equal(pendingBody._saveVersion, undefined, 'effect-only repair must not manufacture save authority');
    } finally {
        kv.hset = originalHset;
    }
    const hallEntryIdsBeforeRepair = new Set(
        ((store.get('hall:entries') as Array<{ id?: number }> | undefined) ?? []).map((entry) => entry.id),
    );

    // The trial GET is the emissary/profile reload path. It must finish the same
    // outbox without a POST, preserve account attribution, and leave the save
    // version untouched because all character rewards already committed.
    const repairedReload = fakeRes();
    await trial(fakeReq('GET', undefined, { playerName: P }), repairedReload.res);
    const repairedReloadBody = repairedReload.out.body as {
        legacy?: { stage?: number };
        effectsPending?: boolean;
        effectsRepaired?: boolean;
        character?: unknown;
        _saveVersion?: number;
    };
    assert.equal(repairedReload.out.statusCode, 200);
    assert.equal(repairedReloadBody.legacy?.stage, 2);
    assert.equal(repairedReloadBody.effectsPending, false);
    assert.equal(repairedReloadBody.effectsRepaired, true);
    assert.equal(repairedReloadBody.character, undefined);
    assert.equal(repairedReloadBody._saveVersion, undefined);

    const third = fakeRes();
    await trial(fakeReq('POST', { action: 'complete', playerName: P, trialId: active.id }), third.res);
    const b = third.out.body as {
        ok: boolean;
        legacy: { stage: number; titles: string[] };
        title?: string;
        completion?: string;
        character?: { legacy?: { stage?: number } };
        _saveVersion?: number;
        receiptId?: string;
    };
    assert.equal(b.ok, true);
    assert.equal(b.legacy.stage, 2);
    assert.equal(b.title, chosenDef().title);
    assert.ok(b.legacy.titles.includes(chosenDef().title));
    assert.ok((b.completion ?? '').length > 30, 'completion narrative must ship');
    assert.equal(b.character?.legacy?.stage, 2, 'completion returns the authoritative character');
    assert.equal(b._saveVersion, committedVersion, 'delivery retries must not manufacture save versions');
    assert.equal(b.receiptId, active.id);
    const ann = (store.get('game:announcements') as Array<{ type: string }> | undefined) ?? [];
    const loud = chosenDef().rarity === 'legendary' || chosenDef().rarity === 'mythic';
    if (loud) assert.ok(ann.length > 0, `${chosenDef().rarity} awakening must announce`);
    else assert.equal(ann.filter((a) => a.type === 'legacy_awakening').length, 0, 'basic/rare awakenings stay quiet');
    if (chosenDef().rarity === 'mythic') {
        const herald = [...store.keys()].filter((k) => k.startsWith('chat:village:'));
        assert.equal(herald.length, 4, 'mythic herald must reach all 4 village chats');
    }

    const eventsBeforeReplay = JSON.stringify(store.get(`legacy:events:${P}`));
    const auditBeforeReplay = JSON.stringify(store.get('audit:legacy'));
    const eraBeforeReplay = JSON.stringify(store.get('era:contrib-receipts:legaciesAwakened'));
    const fourth = fakeRes();
    await statsEp(fakeReq('GET', undefined, { playerName: P }), fourth.res);
    const fourthBody = fourth.out.body as { effectsPending?: boolean; effectsRepaired?: boolean; character?: unknown; _saveVersion?: number };
    assert.equal(fourth.out.statusCode, 200);
    assert.equal(fourthBody.effectsPending, false);
    assert.equal(fourthBody.effectsRepaired, false);
    assert.equal(fourthBody.character, undefined);
    assert.equal(fourthBody._saveVersion, undefined);
    assert.equal(JSON.stringify(store.get(`legacy:events:${P}`)), eventsBeforeReplay, 'event delivery is exact-once');
    assert.equal(JSON.stringify(store.get('audit:legacy')), auditBeforeReplay, 'audit delivery is exact-once');
    assert.equal(JSON.stringify(store.get('era:contrib-receipts:legaciesAwakened')), eraBeforeReplay, 'Era contribution is exact-once');
    const attributedAudits = ((store.get('audit:legacy') as Array<{ receiptId?: string; actor?: string }> | undefined) ?? [])
        .filter((entry) => entry.receiptId === `legacy-trial:${P}:${active.id}:audit`);
    assert.equal(attributedAudits.length, 1);
    assert.equal(attributedAudits[0]?.actor, P, 'reload repair must never attribute the receipt to another account');
    const attributedHall = ((store.get('hall:entries') as Array<{ id?: number; player?: string }> | undefined) ?? [])
        .filter((entry) => !hallEntryIdsBeforeRepair.has(entry.id));
    assert.ok(attributedHall.every((entry) => entry.player === P), 'reload repair must preserve Hall ownership');
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
