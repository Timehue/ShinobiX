import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateNearbyTraveler, openHollowGateTraveler, openHollowGateKeeper, hollowGateNpcCanTalk } from './hollow-gate-wanderer-event';
import { hollowGateStepInteraction } from './hollow-gate-step-api';
import type { HollowGateShrineRun } from '../types/character';
import type { HollowGateEventModal, HollowGateTileCtx } from './hollow-gate-tile';

function board(): HollowGateShrineRun {
    return { width: 5, height: 3, playerX: 1, playerY: 1, floor: 1, runToken: 'token', threat: 0, torch: 3, keys: 0, completed: false,
        tiles: Array.from({ length: 15 }, () => ({ kind: 'empty', revealed: true, resolved: true })),
        wanderers: [{ role: 'medic', origin: 7, tile: 7, nodeId: 'floor:1:tile:7' }, { role: 'bandit', origin: 8, tile: 9, nodeId: 'floor:1:tile:8' }] };
}
test('nearby travelers can be reopened from their pin; remote or spent travelers cannot', () => {
    const run = board(); assert.equal(hollowGateNearbyTraveler(run, 7)?.role, 'medic');
    run.playerX = 4; assert.equal(hollowGateNearbyTraveler(run, 7), undefined);
    run.playerX = 2; run.wanderers![0].spent = true; assert.equal(hollowGateNearbyTraveler(run, 7), undefined);
});
test('step contacts a traveler even on a resolved floor tile; hunter origin never fires a second fixed fight', () => {
    const run = board();
    const fx = { wallBump: false, torchSputtered: false, ambushImmediate: false, justResolved: null };
    assert.equal(hollowGateStepInteraction(run, { ok: true, position: { x: 2, y: 1 }, wanderers: run.wanderers }, fx)?.tile.kind, 'npc');
    const battleFx = { ...fx, justResolved: { tile: { ...run.tiles[8], kind: 'battle' as const }, nx: 3, ny: 1 } };
    assert.equal(hollowGateStepInteraction(run, { ok: true, position: { x: 3, y: 1 }, wanderers: run.wanderers }, battleFx), null);
    assert.equal(hollowGateStepInteraction(run, { ok: true, position: { x: 2, y: 1 }, ambush: { nodeId: 'floor:1:ambush:threat-v25', kind: 'ambush' } }, fx), null);
});
test('a failed gift remains retryable; double clicks issue one request and a stale reply preserves newer counters', async () => {
    let run: HollowGateShrineRun | null = board(), event: HollowGateEventModal = null;
    const logs: string[] = [];
    const ctx = { character: { name: 'scout' }, hollowGateRun: run, setHollowGateRun: update => { run = typeof update === 'function' ? update(run) : update; },
        setHollowGateEvent: update => { event = typeof update === 'function' ? update(event) : update; }, onVersionedCharacter: () => false, pushHollowGateLog: line => logs.push(line) } as HollowGateTileCtx;
    const original = globalThis.fetch; let attempts = 0, release: (() => void) | undefined;
    globalThis.fetch = (async () => {
        attempts++; if (attempts === 1) return new Response(JSON.stringify({ error: 'try again' }), { status: 503 });
        await new Promise<void>(resolve => { release = resolve; });
        return new Response(JSON.stringify({ ok: true, character: { name: 'scout' }, runState: { keys: 0, torch: 1, threat: 0, secondWindArmed: false } }));
    }) as typeof fetch;
    try {
        openHollowGateTraveler(run!.wanderers![0], ctx);
        event!.choices[0].onSelect(); await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(event!.pending, false); assert.equal(event!.error, 'try again');
        assert.equal(run!.wanderers![0].spent, undefined); assert.equal(logs[0], 'try again');
        event!.choices[0].onSelect(); event!.choices[0].onSelect(); assert.equal(attempts, 2);
        assert.equal(event!.pending, true); assert.equal(event!.error, undefined);
        release!(); await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(run!.wanderers![0].spent, true); assert.equal(run!.torch, 3, 'a refused stale character reply cannot rewind resources'); assert.equal(event, null);
    } finally { globalThis.fetch = original; }
});
test('a gift response from an exited run does not adopt a character, close a newer dialog or emit a success log', async () => {
    const run = board(); let event: HollowGateEventModal = null, active = true, commits = 0, updates = 0;
    const ctx = { character: { name: 'scout' }, hollowGateRun: run, isCurrentRun: () => active,
        setHollowGateRun: () => { updates++; }, setHollowGateEvent: update => { event = typeof update === 'function' ? update(event) : update; },
        onVersionedCharacter: () => { commits++; return true; }, pushHollowGateLog: () => { updates++; } } as HollowGateTileCtx;
    const original = globalThis.fetch; let release: ((response: Response) => void) | undefined;
    globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
    try {
        openHollowGateTraveler(run.wanderers![0], ctx); event!.choices[0].onSelect();
        active = false; event = { title: 'New run', body: 'Keep this dialog', kind: 'npc', choices: [] };
        release!(new Response(JSON.stringify({ ok: true, character: { name: 'scout' } }))); await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(event.title, 'New run'); assert.equal(commits, 0); assert.equal(updates, 0);
    } finally { globalThis.fetch = original; }
});
test('the static Keeper stays unresolved through skip and network failure, then seals once after a successful gift', async () => {
    let run: HollowGateShrineRun | null = board(), event: HollowGateEventModal = null;
    run.tiles[6] = { kind: 'npc', revealed: true, resolved: false };
    const ctx = { character: { name: 'scout' }, hollowGateRun: run,
        setHollowGateRun: update => { run = typeof update === 'function' ? update(run) : update; },
        setHollowGateEvent: update => { event = typeof update === 'function' ? update(event) : update; }, onVersionedCharacter: () => true, pushHollowGateLog: () => {} } as HollowGateTileCtx;
    const original = globalThis.fetch; let attempt = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify(++attempt === 1 ? { error: 'connection dropped' } : { ok: true, runState: { keys: 1, torch: 3, threat: 0, secondWindArmed: false } }), { status: attempt === 1 ? 503 : 200 })) as typeof fetch;
    try {
        assert(hollowGateNpcCanTalk(run, 6)); openHollowGateKeeper(6, 'A quiet alcove.', ctx);
        event!.onDismiss!(); assert.equal(event, null); assert.equal(run.tiles[6].resolved, false);
        openHollowGateKeeper(6, '', ctx); event!.choices[2].onSelect(); await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(run.tiles[6].resolved, false); assert(event!.error);
        event!.choices[2].onSelect(); await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(run!.tiles[6].resolved, true); assert.equal(run!.keys, 1); assert.equal(event, null);
    } finally { globalThis.fetch = original; }
});
