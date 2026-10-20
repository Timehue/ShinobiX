import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openHollowGateDescent } from './hollow-gate-descent';
import { HollowGateDescentError } from './hollow-gate-combat-api';
import type { HollowGateEventModal, HollowGateTileCtx } from './hollow-gate-tile';
import type { Character, HollowGateShrineRun } from '../types/character';

function fixture() {
    let event: HollowGateEventModal = null, active = true;
    let run = { floor: 1, width: 5, height: 3, playerX: 1, playerY: 1, tiles: [], runToken: 'sealed', serverSeed: 'fixed',
        keys: 2, torch: 4, threat: 100, completed: false, variant: { id: 'event', label: 'Mirror Trial', maxFloor: 3 } } as HollowGateShrineRun;
    const log: string[] = [], calls: string[] = [];
    const ctx: HollowGateTileCtx = { character: { name: 'Runner' } as Character, hollowGateRun: run,
        setHollowGateEvent: update => { event = typeof update === 'function' ? update(event) : update; },
        setHollowGateRun: update => { run = (typeof update === 'function' ? update(run) : update)!; },
        setHollowGateHiddenChamber: () => {}, onVersionedCharacter: () => true, pushHollowGateLog: line => log.push(line),
        buildHollowGateRunSummary: () => '', startHollowGateBattle: () => {}, leaveHollowGateShrine: () => {},
        isCurrentRun: () => active, onPendingAmbush: pending => calls.push(`ambush:${pending.nodeId}`) };
    const deps = { loadGenerator: async () => ({ generateHollowGateShrineRun: (floor: number) => ({ ...run, floor, threat: 0 }) }),
        descend: async () => { calls.push('descend'); return 2; }, seal: async () => { calls.push('seal'); return { ok: true }; } };
    const open = () => openHollowGateDescent(ctx, 'Stairs.', deps as never);
    return { ctx, deps, open, calls, log, event: () => event!, run: () => run, stale: () => { active = false; } };
}

test('staircase shows loading, deduplicates clicks and carries the sealed variant to the next floor', async () => {
    const f = fixture(); let release!: () => void;
    f.deps.descend = async () => { f.calls.push('descend'); await new Promise<void>(resolve => { release = resolve; }); return 2; };
    f.open(); const click = f.event().choices[0].onSelect;
    const first = click(); assert.equal(f.event().pending, true);
    await click(); await Promise.resolve(); assert.deepEqual(f.calls, ['descend']);
    release(); await first;
    assert.equal(f.event(), null); assert.equal(f.run().floor, 2); assert.equal(f.run().torch, 8);
    assert.equal(f.run().variant?.label, 'Mirror Trial'); assert.deepEqual(f.calls, ['descend', 'seal']);
});

test('failed descent remains visible and retryable; lost replies replay the original fromFloor', async () => {
    const f = fixture(); let attempt = 0;
    f.deps.descend = async (params?: { fromFloor: number }) => {
        assert.equal(params?.fromFloor, 1); if (++attempt === 1) throw Error('Connection lost. Retry.'); return 2;
    };
    f.open(); const click = f.event().choices[0].onSelect; await click();
    assert.equal(f.event().pending, false); assert.match(f.event().error!, /Connection lost/); assert.equal(f.run().floor, 1);
    await click(); assert.equal(f.run().floor, 2); assert.equal(attempt, 2);
});

test('pending-ambush rejection closes the staircase and opens the exact encounter', async () => {
    const f = fixture(); f.deps.descend = async () => { throw new HollowGateDescentError('Finish the encounter first.', { kind: 'ambush', nodeId: 'floor:1:ambush:threat-v3' }); };
    f.open(); await f.event().choices[0].onSelect();
    assert.equal(f.event(), null); assert.equal(f.run().floor, 1);
    assert.deepEqual(f.calls, ['ambush:floor:1:ambush:threat-v3']);
});

test('late staircase reply cannot overwrite a changed account, run or floor', async () => {
    const f = fixture(); let release!: () => void;
    f.deps.descend = async () => { await new Promise<void>(resolve => { release = resolve; }); return 2; };
    f.open(); const pending = f.event().choices[0].onSelect(); await Promise.resolve();
    f.stale(); release(); await pending;
    assert.equal(f.run().floor, 1); assert.deepEqual(f.calls, []);
});

test('chunk/seal errors remain inline and cannot adopt an unsealed floor', async () => {
    for (const failure of ['chunk', 'seal']) {
        const f = fixture();
        if (failure === 'chunk') f.deps.loadGenerator = async () => { throw Error('Floor unavailable.'); };
        else f.deps.seal = async () => ({ ok: false, error: 'Floor unavailable.' });
        f.open(); await f.event().choices[0].onSelect();
        assert.equal(f.run().floor, 1); assert.match(f.event().error!, /Floor unavailable/); assert.equal(f.event().pending, false);
        assert.equal(f.calls.includes('descend'), failure === 'seal');
    }
});
