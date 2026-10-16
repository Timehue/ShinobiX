import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSoloBattleDebug, mergeSoloBattleDebug, SOLO_DEBUG_MAX_ROWS, soloBattleDebugText } from './solo-battle-debug';
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
