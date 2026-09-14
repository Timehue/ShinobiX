import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createCharacter } from './create-character.ts';
import { createPlayerSaveCoordinator } from './player-save-coordinator.ts';
import { usePlayerSaveState } from './use-player-save-state.ts';
import { refreshPlayerSaveSnapshot } from './player-save-tracking.ts';
import { claimDailyLogin } from './daily-login-api.ts';
import { buildSaveVersionEventDetail } from '../authFetch.ts';

// Actual authenticated handlers and the actual client transport/coordinator,
// backed by disposable memory. No production store or provider calls.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'daily-login-regression-only-session-secret';
delete process.env.STRICT_RAW_SAVE_LEDGER;
const { kv } = await import('../../../api/_storage.ts');
const { issuePlayerToken } = await import('../../../api/_auth.ts');
const { default: daily } = await import('../../../api/player/daily-login.ts');
const { default: save } = await import('../../../api/save/[name].ts');
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
});

async function call(handler, name, token, body, method = 'POST') {
    const out = { status: 200, body: null };
    const res = {
        status(code) { out.status = code; return res; },
        json(value) { out.body = value; return res; },
        setHeader() {}, end() { return res; },
    };
    await handler({ method, headers: { 'x-player-token': token },
        body, query: { name }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return out;
}

let sequence = 0;
async function fixture(overrides = {}) {
    const name = `dailyrecovery${++sequence}`;
    const initial = { ...createCharacter(name, 'Stormveil Village', 'Ninjutsu', 'Ashen Eyes'),
        level: 10, levelLedgerMigrated: true, ryo: 1000, fateShards: 20, loginStreak: 6,
        lastLoginRewardDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        onboardingStep: 'done', ...overrides };
    await kv.set(`save:${name}`, { character: initial, _saveVersion: 10 });
    const token = issuePlayerToken(name);
    const characterRef = { current: initial };
    const currentAccountNameRef = { current: name };
    const storage = new Map();
    const visibleDrafts = [];
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    } });
    const owner = createPlayerSaveCoordinator({
        characterRef, currentAccountNameRef, saveSessionEpochRef: { current: 0 },
        pvpCreateScopeAbortRef: { current: new AbortController() },
        setCharacter: update => { characterRef.current = typeof update === 'function' ? update(characterRef.current) : update; },
        setSaveConflictDraft: draft => visibleDrafts.push(draft), setSaveBlocked() {}, applyServerSnapshot: () => true,
        storage: { getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    });
    let fields;
    function Probe() { fields = usePlayerSaveState(); return null; }
    renderToString(createElement(Probe));
    owner.saveAuthority.scopeToAccount(name);
    owner.latestSaveVersionRef.current = 10;
    owner.recordCharacterBaseline(initial);
    owner.prevCharRef.current = initial;
    refreshPlayerSaveSnapshot(initial, name, fields, owner);
    const request = (body = { playerName: name }) => call(daily, name, token, body);
    globalThis.fetch = async (url, init) => {
        assert.equal(url, '/api/player/daily-login');
        const result = await request(JSON.parse(init.body));
        return new Response(JSON.stringify(result.body), { status: result.status });
    };
    const claim = (isCurrent = () => true) => claimDailyLogin(name, owner.beginDailyLogin, isCurrent);
    const edit = changes => {
        characterRef.current = { ...characterRef.current, ...changes };
        refreshPlayerSaveSnapshot(characterRef.current, name, fields, owner);
    };
    return { name, token, initial, owner, characterRef, currentAccountNameRef, request, claim, edit, visibleDrafts };
}

async function persistCurrent(f) {
    const response = await call(save, f.name, f.token, {
        ...f.owner.latestSaveRef.current.payload, _baseSaveVersion: f.owner.latestSaveVersionRef.current,
    });
    assert.equal(response.status, 200);
    return kv.get(`save:${f.name}`);
}

test('lost seventh-day response → receipt retry → ordinary save preserves the five shards', async () => {
    const f = await fixture();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const committed = await realFetch(...args);
        assert.equal(committed.status, 200);
        throw new TypeError('synthetic response lost after server commit');
    };
    assert.equal(await f.claim(), null);
    assert.equal(f.characterRef.current.fateShards, 20);
    assert.equal(f.owner.latestSaveVersionRef.current, 10);
    globalThis.fetch = realFetch;
    const retry = await f.claim();
    assert.equal(retry.alreadyClaimed, true);
    assert.deepEqual(retry.granted, { ryo: 0, fateShards: 0 });
    assert.equal(buildSaveVersionEventDetail(retry, f.name, 'mutation'), null,
        'the interceptor must not publish a version independently of its character');
    assert.equal(f.characterRef.current.fateShards, 25);
    assert.equal(f.characterRef.current.loginStreak, 7);
    assert.equal(f.characterRef.current.lastLoginRewardDate, new Date().toISOString().slice(0, 10));
    assert.equal(f.owner.latestSaveVersionRef.current, 11);
    assert.equal(f.owner.latestSaveRef.current.character.fateShards, 25,
        'the next save payload must be updated synchronously, before a React render');
    const result = await call(save, f.name, f.token, {
        ...f.owner.latestSaveRef.current, _baseSaveVersion: f.owner.latestSaveVersionRef.current,
    });
    assert.equal(result.status, 200);
    const persisted = await kv.get(`save:${f.name}`);
    assert.equal(persisted.character.fateShards, 25);
    assert.equal(persisted.character.ryo, 2500);
    assert.equal(persisted._saveVersion, 12);
});

test('first claim and concurrent duplicate both return the same saved reward and version', async () => {
    const f = await fixture();
    const results = await Promise.all([f.request(), f.request({ playerName: f.name, fateShards: 999999 })]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(results.filter(r => !r.body.alreadyClaimed).length, 1);
    for (const { body } of results) {
        assert.equal(body.character.fateShards, 25);
        assert.equal(body.character.ryo, 2500);
        assert.equal(body._saveVersion, 11);
    }
    assert.equal((await f.claim()).alreadyClaimed, true);
    assert.equal(f.characterRef.current.fateShards, 25);
});

test('a delayed daily reply cannot roll back a newer authoritative character', async () => {
    const f = await fixture();
    const old = (await f.request()).body;
    const newer = { ...old.character, fateShards: 30 };
    await kv.set(`save:${f.name}`, { character: newer, _saveVersion: 12 });
    assert.equal(f.owner.commitVersionedCharacter(newer, 12), true);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(old));
    assert.equal(await f.claim(), null);
    assert.equal(f.characterRef.current.fateShards, 30);
    assert.equal(f.owner.latestSaveVersionRef.current, 12);
    globalThis.fetch = realFetch;
    assert.equal((await f.claim()).character.fateShards, 30);
});

test('account switch and unmounted requester cannot adopt a late daily reward', async () => {
    const f = await fixture();
    f.currentAccountNameRef.current = 'anotherplayer';
    assert.equal(await f.claim(), null);
    assert.equal(f.characterRef.current.fateShards, 20);
    f.currentAccountNameRef.current = f.name;
    assert.equal(await f.claim(() => false), null);
    assert.equal(f.owner.latestSaveVersionRef.current, 10);
    assert.equal(f.characterRef.current.fateShards, 20);
    assert.equal((await f.claim()).character.fateShards, 25);
});

test('foreign characters and missing versions are not successful client claims', async () => {
    const f = await fixture();
    const result = (await f.request()).body;
    for (const invalid of [
        { ...result, character: { ...result.character, name: 'anotherplayer' } },
        { ...result, character: undefined },
        { ...result, _saveVersion: undefined },
        { ...result, _saveVersion: 0 },
    ]) {
        globalThis.fetch = async () => new Response(JSON.stringify(invalid));
        assert.equal(await f.claim(), null);
        assert.equal(f.characterRef.current.fateShards, 20);
        assert.equal(f.owner.latestSaveVersionRef.current, 10);
    }
});

test('an ordinary player cannot claim another account daily reward', async () => {
    const f = await fixture();
    const result = await call(daily, f.name, issuePlayerToken('otherdailyplayer'), { playerName: f.name });
    assert.ok([401, 403].includes(result.status));
    assert.equal((await kv.get(`save:${f.name}`)).character.fateShards, 20);
});

test('lost daily reply → bank interest → actual autosave preserves and reconciles the shard credit', async () => {
    const { default: bankInterest } = await import('../../../api/bank/claim-interest.ts');
    const f = await fixture({ bankRyo: 10000, villageUpgrades: { bank: 10 }, lastBankInterestAt: 0 });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        await realFetch(...args);
        throw new TypeError('response lost after the daily credit');
    };
    assert.equal(await f.claim(), null);
    assert.equal((await kv.get(`save:${f.name}`)).character.fateShards, 25);
    const bank = await call(bankInterest, f.name, f.token, { playerName: f.name });
    assert.equal(bank.status, 200);
    assert.equal(bank.body.claimed, 10);
    const event = buildSaveVersionEventDetail(bank.body, f.name, 'mutation');
    assert.equal(f.owner.saveAuthority.acceptExternalVersion(event.version, f.name), 'accepted');
    const local = { ...f.characterRef.current, bankRyo: bank.body.bankRyo, lastBankInterestAt: bank.body.lastBankInterestAt };
    f.characterRef.current = local;
    f.owner.latestSaveRef.current = { ...f.owner.latestSaveRef.current, character: local,
        payload: { ...f.owner.latestSaveRef.current.payload, character: local } };
    let writes = 0;
    globalThis.fetch = async (url, init) => {
        assert.equal(url, `/api/save/${f.name}`);
        writes += 1;
        const result = await call(save, f.name, f.token, JSON.parse(init.body));
        assert.equal(result.status, 200);
        assert.equal(result.body.fateShards, 25);
        return Response.json(result.body);
    };
    await f.owner.persistSave(f.owner.latestSaveRef.current);
    assert.equal(writes, 1);
    assert.equal(f.characterRef.current.fateShards, 25);
    const stored = await kv.get(`save:${f.name}`);
    assert.equal(stored.character.fateShards, 25);
    assert.equal(stored.character.bankRyo, 10010);
    assert.equal(stored._saveVersion, 13);
});

test('a genuine paid profile action after daily credit remains paid through receipt retry and stale save', async () => {
    const { default: profile } = await import('../../../api/profile/settle.ts');
    const f = await fixture();
    await f.request(); // The reply may be lost; the server still owns the 25 shards.
    const purchase = { playerName: f.name, action: { type: 'purchase-title', title: 'Dawn Scout' } };
    const bought = await call(profile, f.name, f.token, purchase);
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    assert.equal(bought.body.character.fateShards, 15);
    const repeated = await call(profile, f.name, f.token, purchase);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.cost, 0);
    assert.equal(repeated.body.character.fateShards, 15);
    const dailyRetry = await f.request();
    assert.equal(dailyRetry.body.alreadyClaimed, true);
    assert.equal(dailyRetry.body.character.fateShards, 15);
    const saved = await call(save, f.name, f.token, {
        character: { ...f.initial, fateShards: 25 }, _baseSaveVersion: dailyRetry.body._saveVersion,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.fateShards, 15, 'the stale pre-purchase wallet cannot undo a real debit');
    assert.equal((await kv.get(`save:${f.name}`)).character.customTitle, 'Dawn Scout');
});

for (const timing of ['before request', 'during request']) {
    test(`pending profile, equipment and allocated stats survive a daily claim: ${timing}`, async () => {
        const f = await fixture({ inventory: ['shinobi-vest'], equipment: {}, unspentStats: 10,
            nindo: 'Original creed', nindoBg: '' });
        const pending = { nindo: 'My pending creed', nindoBg: 'ember', equipment: { body: 'shinobi-vest' },
            stats: { ...f.initial.stats, strength: f.initial.stats.strength + 2 }, unspentStats: 8 };
        if (timing === 'before request') f.edit(pending);
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (...args) => {
            const result = await realFetch(...args);
            if (timing === 'during request') f.edit(pending);
            return result;
        };
        assert.ok(await f.claim());
        for (const key of Object.keys(pending)) assert.deepEqual(f.characterRef.current[key], pending[key], key);
        assert.equal(f.visibleDrafts.filter(Boolean).length, 0, 'ordinary pending edits need no recovery prompt');
        const stored = await persistCurrent(f);
        for (const key of Object.keys(pending)) assert.deepEqual(stored.character[key], pending[key], key);
        assert.equal(stored.character.fateShards, 25);
        assert.equal(stored.character.ryo, 2500);
    });
}

test('clearing a profile/background and unequipping survive a receipt retry', async () => {
    const f = await fixture({ nindo: 'Old creed', nindoBg: 'ember',
        inventory: ['shinobi-vest'], equipment: { body: 'shinobi-vest' } });
    await f.request(); // committed response was lost
    f.edit({ nindo: '', nindoBg: '', equipment: {} });
    assert.equal((await f.claim()).alreadyClaimed, true);
    const stored = await persistCurrent(f);
    assert.equal(stored.character.nindo, '');
    assert.equal(stored.character.nindoBg, '');
    assert.deepEqual(stored.character.equipment, {});
    assert.deepEqual(stored.character.inventory, ['shinobi-vest']);
    assert.equal(stored.character.fateShards, 25);
});

test('unchanged stale preferences do not overwrite another device; a conflicting edit is protected', async () => {
    const f = await fixture({ nindo: 'Old', nindoBg: '' });
    const saved = { character: { ...f.initial, nindo: 'Other device', nindoBg: 'frost' }, _saveVersion: 11 };
    await kv.set(`save:${f.name}`, saved);
    f.edit({ nindo: 'Unsaved local draft' });
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.nindo, 'Other device');
    assert.equal(f.characterRef.current.nindoBg, 'frost');
    const draft = await f.owner.rehydrateSaveConflictDraft(f.name, f.owner.latestSaveRef.current.payload);
    assert.equal(draft.revisions.at(-1).payload.character.nindo, 'Unsaved local draft');
    assert.equal((await persistCurrent(f)).character.nindo, 'Other device');
});

test('an allocation conserves a newly earned point pool and is not applied twice on retry', async () => {
    const f = await fixture({ unspentStats: 10 });
    f.edit({ stats: { ...f.initial.stats, strength: f.initial.stats.strength + 2 }, unspentStats: 8 });
    await kv.set(`save:${f.name}`, { character: { ...f.initial, unspentStats: 15 }, _saveVersion: 11 });
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.unspentStats, 13);
    assert.equal(f.characterRef.current.stats.strength, f.initial.stats.strength + 2);
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.unspentStats, 13);
    const stored = await persistCurrent(f);
    assert.equal(stored.character.unspentStats, 13);
    assert.equal(stored.character.stats.strength, f.initial.stats.strength + 2);
    f.owner.latestSaveVersionRef.current = stored._saveVersion;
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.stats.strength, f.initial.stats.strength + 2);
});

test('new client recovers an older balance-only reply before publishing its version', async () => {
    const f = await fixture({ nindo: 'Old' });
    f.edit({ nindo: 'Pending' });
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push(url);
        if (url === '/api/player/daily-login') {
            const data = await (await realFetch(url, init)).json();
            delete data.character;
            assert.equal(buildSaveVersionEventDetail(data, f.name, 'mutation', url), null);
            assert.equal(f.owner.latestSaveVersionRef.current, 10);
            return Response.json(data);
        }
        assert.equal(url, `/api/save/${f.name}`);
        const stored = await call(save, f.name, f.token, undefined, 'GET');
        assert.equal(stored.status, 200);
        return Response.json(stored.body);
    };
    assert.ok(await f.claim());
    assert.deepEqual(calls, ['/api/player/daily-login', `/api/save/${f.name}`]);
    assert.equal(f.characterRef.current.fateShards, 25);
    assert.equal(f.characterRef.current.nindo, 'Pending');
    assert.equal((await persistCurrent(f)).character.fateShards, 25);
});

test('an in-flight response is rejected after switching A → B → A, even while mounted', async () => {
    const f = await fixture();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const response = await realFetch(...args);
        f.currentAccountNameRef.current = 'anotherplayer';
        f.owner.saveAuthority.scopeToAccount('anotherplayer');
        f.currentAccountNameRef.current = f.name;
        f.owner.saveAuthority.scopeToAccount(f.name);
        f.owner.latestSaveVersionRef.current = 10;
        f.owner.recordCharacterBaseline(f.initial);
        return response;
    };
    assert.equal(await f.claim(), null);
    assert.equal(f.characterRef.current.fateShards, 20);
    assert.equal(f.owner.latestSaveVersionRef.current, 10);
    globalThis.fetch = realFetch;
    assert.equal((await f.claim()).alreadyClaimed, true);
    assert.equal(f.characterRef.current.fateShards, 25);
});

test('401/409/429/5xx and malformed replies leave edits/version intact and allow retry', async () => {
    const f = await fixture();
    f.edit({ nindo: 'Keep this edit' });
    const realFetch = globalThis.fetch;
    for (const status of [401, 409, 429, 500, 503]) {
        globalThis.fetch = async () => Response.json({ error: 'synthetic rejection' }, { status });
        assert.equal(await f.claim(), null);
        assert.equal(f.characterRef.current.nindo, 'Keep this edit');
        assert.equal(f.owner.latestSaveVersionRef.current, 10);
    }
    globalThis.fetch = async () => new Response('not JSON');
    assert.equal(await f.claim(), null);
    globalThis.fetch = realFetch;
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.nindo, 'Keep this edit');
});

test('a stalled request times out without freezing claim retry', async t => {
    const f = await fixture();
    const realFetch = globalThis.fetch;
    let started;
    const sent = new Promise(resolve => { started = resolve; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        started();
    });
    const pending = f.claim();
    await sent;
    t.mock.timers.tick(15_001);
    assert.equal(await pending, null);
    assert.equal(f.owner.latestSaveVersionRef.current, 10);
    t.mock.timers.reset();
    globalThis.fetch = realFetch;
    assert.ok(await f.claim());
});

test('daily claims across UTC midnight advance once per date without duplicating the shard bonus', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T23:59:59.000Z') });
    const f = await fixture();
    assert.equal((await f.claim()).streak, 7);
    t.mock.timers.setTime(Date.parse('2026-09-15T00:00:01.000Z'));
    assert.equal((await f.claim()).streak, 8);
    assert.equal((await f.claim()).alreadyClaimed, true);
    const stored = await persistCurrent(f);
    assert.equal(stored.character.fateShards, 25);
    assert.equal(stored.character.ryo, 4000);
    assert.equal(stored.character.lastLoginRewardDate, '2026-09-15');
});

test('all daily request representations withhold balance-only versions while other mutations still publish', () => {
    for (const request of ['/api/player/daily-login?retry=1',
        new URL('https://shinobijourney.com/api/player/daily-login'),
        new Request('https://shinobijourney.com/api/player/daily-login', { method: 'POST' })]) {
        assert.equal(buildSaveVersionEventDetail({ _saveVersion: 9 }, 'owner', 'mutation', request), null);
    }
    assert.equal(buildSaveVersionEventDetail({ _saveVersion: 9 }, 'owner', 'mutation',
        '/api/bank/claim-interest').version, 9);
});

test('acknowledged edits become the baseline, while an edit made during that write stays pending', async t => {
    const f = await fixture({ nindo: 'Original', nindoBg: '' });
    const realFetch = globalThis.fetch;
    f.edit({ nindo: 'Saved on this device' });
    globalThis.fetch = async (url, init) => {
        assert.equal(url, `/api/save/${f.name}`);
        const result = await call(save, f.name, f.token, JSON.parse(init.body));
        assert.equal(result.status, 200);
        f.edit({ nindoBg: 'ember' });
        return Response.json(result.body);
    };
    await f.owner.persistSave(f.owner.latestSaveRef.current);
    // Respect the real per-player save cadence without making the test sleep.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 3100 });
    const saved = await kv.get(`save:${f.name}`);
    await kv.set(`save:${f.name}`, { ...saved,
        character: { ...saved.character, nindo: 'Later other-device edit' }, _saveVersion: saved._saveVersion + 1 });
    globalThis.fetch = realFetch;
    assert.ok(await f.claim());
    assert.equal(f.characterRef.current.nindo, 'Later other-device edit', 'a saved value is not an unsaved conflict');
    assert.equal(f.characterRef.current.nindoBg, 'ember', 'a newer local edit remains pending');
    assert.equal(f.owner.saveConflictStoreRef.current.load(f.name), null, 'no spurious draft or recovery prompt');
    const final = await persistCurrent(f);
    assert.equal(final.character.nindoBg, 'ember');
    assert.equal(final.character.fateShards, 25);
});
