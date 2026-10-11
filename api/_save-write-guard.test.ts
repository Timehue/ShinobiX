import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
    _resetSaveWriteGuardForTest,
    inPlayerSaveCommit,
    isGuardedPlayerSaveKey,
    observePlayerSaveWrite,
    withinPlayerSaveCommit,
} from './_save-write-guard.js';

/*
 * The runtime guard behind the AST ratchet: a player-save write made outside
 * the commit helper is reported once per call site, and never affected.
 */

beforeEach(() => _resetSaveWriteGuardForTest());

function captureWarnings(fn: () => void): string[] {
    const original = console.warn;
    const lines: string[] = [];
    console.warn = (...parts: unknown[]) => { lines.push(parts.map(String).join(' ')); };
    try { fn(); } finally { console.warn = original; }
    return lines;
}

test('only player saves are guarded', () => {
    assert.equal(isGuardedPlayerSaveKey('save:rill'), true);
    assert.equal(isGuardedPlayerSaveKey('save:clan-stormpetals'), false);
    assert.equal(isGuardedPlayerSaveKey('save:admin1'), false);
    assert.equal(isGuardedPlayerSaveKey('save:Admin2'), false);
    assert.equal(isGuardedPlayerSaveKey('save:health-probe-7'), false);
    assert.equal(isGuardedPlayerSaveKey('save-snapshot:rill:1'), false);
    assert.equal(isGuardedPlayerSaveKey('ledger:currency:rill'), false);
    assert.equal(isGuardedPlayerSaveKey('save:'), false);
});

test('a write outside the commit helper is reported once per call site', () => {
    const rawWriter = () => observePlayerSaveWrite('save:rill', 'set');
    const lines = captureWarnings(() => { rawWriter(); rawWriter(); });
    assert.equal(lines.length, 1, 'the same site is reported once');
    assert.match(lines[0], /\[currency-ledger\] raw save write \(set\) outside the commit helper at /);
    assert.match(lines[0], /_save-write-guard\.test\./, 'the report names the caller, not the storage layer');
});

test('a write inside the commit helper scope is silent, and the scope follows awaits', async () => {
    assert.equal(inPlayerSaveCommit(), false);
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...parts: unknown[]) => { lines.push(parts.map(String).join(' ')); };
    try {
        await withinPlayerSaveCommit(async () => {
            await Promise.resolve();
            assert.equal(inPlayerSaveCommit(), true);
            observePlayerSaveWrite('save:rill', 'compareSetMany');
        });
    } finally {
        console.warn = original;
    }
    assert.deepEqual(lines, []);
    assert.equal(inPlayerSaveCommit(), false, 'the scope ends with the commit');
});

test('non-player keys never cost a stack capture or a report', () => {
    const lines = captureWarnings(() => {
        observePlayerSaveWrite('save:clan-storm', 'set');
        observePlayerSaveWrite('telemetry:currency-ledger:raw-save-write:2026-10-10', 'incr');
    });
    assert.deepEqual(lines, []);
});
