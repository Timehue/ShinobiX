import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSoloBattleDebug, downloadRecordedSoloBattleDebug, downloadSoloBattleDebug, mergeSoloBattleDebug, SOLO_DEBUG_MAX_ROWS, soloBattleDebugText } from './solo-battle-debug';
import type { SoloPveCombatEvent, SoloPveSession } from './solo-pve-api';

function event(seq: number): SoloPveCombatEvent {
    const fighter = { hp: 100, maxHp: 100, chakra: 80, stamina: 70, shield: 0, pos: 2, statuses: [] };
    const snapshot = { player: fighter, enemy: fighter, ap: { player: 100, enemy: 100 }, cooldowns: { player: {}, enemy: { strike: 3 } }, groundEffects: [], itemCharges: {}, itemsUsed: {} };
    return { kind: 'action', seq, round: Math.ceil(seq / 4), actor: 'enemy', target: 'player', action: 'basicAttack',
        before: snapshot, after: { ...snapshot, player: { ...fighter, hp: 80 }, ap: { player: 100, enemy: 60 } },
        log: [`Attack ${seq}: 20 damage.`], vfx: [], status: 'active', winner: null, outcome: null };
}
function session(events: SoloPveCombatEvent[], eventSeq = events.at(-1)?.seq ?? 0): SoloPveSession {
    return { sessionId: 'test', ownerSlug: 'rill', player: { name: 'Rill' }, enemy: { name: 'Tsukika', character: { level: 75 } },
        events, eventSeq, status: 'active', outcome: null } as SoloPveSession;
}

test('a live journal preserves opening actions after the server rolling window passes 80 events', () => {
    const opening = mergeSoloBattleDebug(undefined, session(Array.from({ length: 80 }, (_, i) => event(i + 1))), 1);
    const later = mergeSoloBattleDebug(opening, session(Array.from({ length: 80 }, (_, i) => event(i + 21))), 2);
    assert.equal(later.complete, true);
    assert.equal(later.rows.length, 200);
    assert.equal(later.rows.filter(row => row.seq === 1).length, 2);
    assert.equal(later.rows.filter(row => row.seq === 100).length, 2);
    assert.match(soloBattleDebugText(later), /HP 100→80.*shield 0→0.*AP 100→60.*strike/);
});

test('late resume and sequence gaps explicitly export a partial history', () => {
    const late = mergeSoloBattleDebug(undefined, session([event(81), event(82)]), 1);
    assert.equal(late.complete, false);
    assert.match(soloBattleDebugText(late), /Partial action history: earlier events were unavailable/);
    const first = mergeSoloBattleDebug(undefined, session([event(1)]), 1);
    assert.equal(mergeSoloBattleDebug(first, session([event(3)]), 2).complete, false);
});

test('switching accounts cannot reuse another player journal with the same session id', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    // Leave these journals expired when the real clock is restored so the
    // module cache cannot affect the independent three-fight hydration test.
    const now = Date.now() - 8 * 24 * 60 * 60 * 1000;
    t.mock.method(Date, 'now', () => now);
    let stored = '[]';
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
    const rill = captureSoloBattleDebug({ ...session([event(1)]), sessionId: 'shared-account-session' });
    const buster = captureSoloBattleDebug({ ...session([event(81)]), sessionId: 'shared-account-session', player: { name: 'Buster' } });

    assert.equal(rill.complete, true);
    assert.equal(buster.player, 'Buster');
    assert.equal(buster.complete, false);
    assert.deepEqual(buster.rows.map(row => row.seq), [81, 81]);
    assert.equal(captureSoloBattleDebug({ ...session([event(1)]), sessionId: 'shared-account-session' }), rill);
    const sharedSessionRows = JSON.parse(stored).filter((record: { sessionId: string }) => record.sessionId === 'shared-account-session');
    assert.deepEqual(sharedSessionRows.map((record: { player: string }) => record.player).sort(), ['Buster', 'Rill']);
});

test('the local bound is explicit and keeps the ending without claiming completeness', () => {
    const log = mergeSoloBattleDebug(undefined, session(Array.from({ length: 2100 }, (_, i) => event(i + 1))), 1);
    assert.equal(log.rows.length, SOLO_DEBUG_MAX_ROWS);
    assert.equal(log.omittedRows, 4200 - SOLO_DEBUG_MAX_ROWS);
    assert.equal(log.complete, false);
    assert.equal(log.rows.at(-1)?.seq, 2100);
    assert.match(soloBattleDebugText(log), /4096-row \/ 1,000-character line bound/);
});

test('an oversized source line is shortened explicitly instead of claiming a full log', () => {
    const source = event(1);
    source.log = ['x'.repeat(2000)];
    const log = mergeSoloBattleDebug(undefined, session([source]), 1);
    assert.equal(log.complete, false);
    assert.equal(log.shortenedRows, 1);
    assert.equal(log.rows[1].text.length, 1000);
    assert.match(soloBattleDebugText(log), /1 rows shortened/);
});

test('a new fight after reload retains the prior recent journals within the three-fight bound', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const earlier = ['old-fight-a', 'old-fight-b'].map((id, index) => mergeSoloBattleDebug(undefined,
        { ...session([event(1)]), sessionId: id }, Date.now() - 1000 - index));
    let stored = JSON.stringify(earlier);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    } });
    try {
        captureSoloBattleDebug({ ...session([]), sessionId: 'new-fight' });
        assert.deepEqual(JSON.parse(stored).map((record: { sessionId: string }) => record.sessionId), ['new-fight', 'old-fight-a', 'old-fight-b']);
    } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('an unchanged expired cache starts a new partial observation without resurrecting old rows', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let now = 2_000_000_000_000;
    let stored = '[]';
    t.mock.method(Date, 'now', () => now);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
    const initial = captureSoloBattleDebug({ ...session(Array.from({ length: 81 }, (_, i) => event(i + 1))), sessionId: 'expired-capture' });
    assert.equal(initial.complete, true);
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    const resumed = captureSoloBattleDebug({ ...session([event(81)]), sessionId: 'expired-capture' });
    assert.notEqual(resumed, initial);
    assert.equal(resumed.updatedAt, now);
    assert.equal(resumed.complete, false);
    assert.deepEqual(resumed.rows.map(row => row.seq), [81, 81]);
    assert.match(soloBattleDebugText(resumed), /Partial action history/);
    assert.deepEqual(JSON.parse(stored), [resumed]);
});

test('direct recorded export expires old memory and persisted journals even without another capture', t => {
    const previous = Object.getOwnPropertyDescriptors(globalThis);
    let now = 2_100_000_000_000;
    let stored = '[]';
    let downloads = 0;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(URL, 'createObjectURL', () => 'blob:test');
    t.mock.method(URL, 'revokeObjectURL', () => undefined);
    Object.defineProperties(globalThis, {
        localStorage: { configurable: true, value: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } } },
        document: { configurable: true, value: { createElement: () => ({ click: () => { downloads++; } }) } },
        window: { configurable: true, value: { setTimeout: (callback: () => void) => callback() } },
    });
    t.after(() => { for (const key of ['localStorage', 'document', 'window']) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);
    } });
    captureSoloBattleDebug({ ...session([event(1)]), sessionId: 'expired-export' });
    downloadRecordedSoloBattleDebug('expired-export', 'Rill');
    assert.equal(downloads, 1, 'a current journal still downloads');
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    downloadRecordedSoloBattleDebug('expired-export', 'Rill');
    assert.equal(downloads, 1, 'expired memory must not download');
    assert.deepEqual(JSON.parse(stored), [], 'expired persisted history is removed');
});

test('a held live export expires at the seven-day boundary even when browser storage is denied', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let now = 2_200_000_000_000;
    t.mock.method(Date, 'now', () => now);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('storage denied'); } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
    const held = captureSoloBattleDebug({ ...session([event(1)]), sessionId: 'expired-held-export' });
    now += 7 * 24 * 60 * 60 * 1000;
    const createUrl = t.mock.method(URL, 'createObjectURL', () => { throw new Error('expired export must not create a download'); });
    assert.doesNotThrow(() => downloadSoloBattleDebug(held));
    assert.equal(createUrl.mock.callCount(), 0);
    const observed = captureSoloBattleDebug({ ...session([event(81)]), sessionId: 'expired-held-export' });
    assert.equal(observed.complete, false);
    assert.deepEqual(observed.rows.map(row => row.seq), [81, 81]);
});

test('hydrating an unchanged current journal removes expired stored rows before the fast path', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const now = 2_300_000_000_000;
    t.mock.method(Date, 'now', () => now);
    const expired = mergeSoloBattleDebug(undefined, { ...session([event(1)]), sessionId: 'expired-persisted' }, now - 7 * 24 * 60 * 60 * 1000);
    const current = mergeSoloBattleDebug(undefined, { ...session([event(81)]), sessionId: 'fresh-persisted' }, now - 1000);
    let stored = JSON.stringify([current, expired]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; },
    } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
    assert.deepEqual(captureSoloBattleDebug({ ...session([event(81)]), sessionId: 'fresh-persisted' }), current);
    assert.deepEqual(JSON.parse(stored), [current]);
});
