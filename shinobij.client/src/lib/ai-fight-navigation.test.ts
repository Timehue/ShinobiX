import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { AiFightStart } from './ai-fight-api';
import { rememberCircuitCombatSession, forgetCircuitCombatSession, requestForResumedGenericFight } from './ai-fight-navigation';

test('Circuit reload recovery is scoped to the exact player and sealed practice session', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v), removeItem: (k: string) => entries.delete(k),
    } });
    try {
        const sealed = { sessionId: 'sealed-circuit', opponentId: 'dojo-challenger', opponentName: 'Server challenger', battleKind: 'practice', session: { enemy: { character: { level: 25 } } } } as AiFightStart;
        rememberCircuitCombatSession('Kaito', sealed.sessionId);
        assert.equal(requestForResumedGenericFight(sealed, 'kaito')?.returnScreen, 'dojoCircuit');
        assert.equal(requestForResumedGenericFight(sealed, 'Ren')?.returnScreen, undefined);
        assert.equal(requestForResumedGenericFight({ ...sealed, sessionId: 'ordinary-spar' }, 'Kaito')?.returnScreen, undefined);
        assert.equal(requestForResumedGenericFight({ ...sealed, battleKind: 'explore' }, 'Kaito')?.returnScreen, 'worldMap');
        forgetCircuitCombatSession('Kaito', 'another-session');
        assert.equal(requestForResumedGenericFight(sealed, 'Kaito')?.returnScreen, 'dojoCircuit');
        forgetCircuitCombatSession('Kaito', sealed.sessionId);
        assert.equal(requestForResumedGenericFight(sealed, 'Kaito')?.returnScreen, undefined);
    } finally { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else Reflect.deleteProperty(globalThis, 'sessionStorage'); }
});

test('recovery remains usable when browser storage is unavailable', () => {
    assert.doesNotThrow(() => rememberCircuitCombatSession('Kaito', 'id'));
    assert.equal(requestForResumedGenericFight({ opponentId: '' } as AiFightStart, 'Kaito'), null);
});

test('the real host remembers a launched Circuit session and uses player-scoped recovery', () => {
    const host = readFileSync(new URL('../components/AiFightHost.tsx', import.meta.url), 'utf8');
    assert.match(host, /rememberCircuitCombatSession\(originatingPlayerName, started.sessionId\)/);
    assert.match(host, /requestForResumedGenericFight\(generic, originatingPlayerName\)/);
    assert.match(host, /request.returnScreen === 'dojoCircuit'[^\n]+CircuitCombatResult/);
});
