import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveHollowGateStepState } from './step.js';
import { hollowGateCombatReceiptNeedsRecovery } from './combat-settle.js';
import { hollowGateEventNeedsSaveRecovery } from './event.js';

const source = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

test('Hollow Gate end settlement accepts action intent, never client haul or outcome', () => {
    const api = source('api', 'hollow-gate', 'settle.ts');
    const client = source('shinobij.client', 'src', 'lib', 'hollow-gate-server.ts');
    assert.equal(api.includes('body.haul'), false);
    assert.equal(api.includes('body.outcome'), false);
    assert.equal(api.includes('maxHaulForDepth'), false);
    assert.equal(api.includes("../towers/"), false);
    assert.match(api, /body\.action === 'abandon'/);
    assert.match(client, /action: outcome === "death" \? "abandon" : "extract"/);
    assert.equal(client.includes('computeHollowGateHaul'), false);
    assert.equal(client.includes('applyHollowGateRunEndLocal'), false);
});

test('run start is idempotent across a lost response and persists the run before charging the save', () => {
    const api = source('api', 'hollow-gate', 'start.ts');
    const client = source('shinobij.client', 'src', 'lib', 'hollow-gate-server.ts');
    assert.match(api, /body\.requestId/);
    assert.match(api, /lastHollowGateStart/);
    assert.match(api, /priorStart\?\.requestId === requestId/);
    assert.match(api, /hollowGateRun: \{/);
    assert.match(api, /pendingFloorSeal: true/);
    assert.ok(
        api.indexOf('await kv.set(hollowGateRunKey(playerName, token), runToken)')
            < api.indexOf('lastHollowGateStart: { requestId, token'),
        'the durable run must be written before the paid character mutation is committed',
    );
    assert.match(client, /for \(let attempt = 0; attempt < 2/);
    assert.match(client, /JSON\.stringify\(\{ playerName, floorDepth, variantId, requestId \}\)/);
    const app = source('shinobij.client', 'src', 'App.tsx');
    assert.match(app, /character\.lastHollowGateStart\?\.requestId/);
    assert.match(app, /pending\.requestId/);
    assert.match(source('api', 'hollow-gate', 'settle.ts'), /delete next\.lastHollowGateStart/);
});

test('all live Hollow Gate reward sources feed the exact server ledger', () => {
    const event = source('api', 'hollow-gate', 'event.ts');
    const combat = source('api', 'hollow-gate', 'combat-settle.ts');
    for (const action of ['chest', 'shard-vein', 'hidden-tablet', 'hidden-relic', 'locked-door']) {
        assert.ok(event.includes(`'${action}'`), `missing server event ${action}`);
    }
    assert.match(event, /creditHollowGateLedger\(run, sourceId/);
    assert.match(event, /action === 'keeper-heal' && run\.chosenAugmentId === 'treasure-sense'/);
    assert.match(combat, /creditHollowGateLedger\(run, `combat:/);
    for (const itemId of ['dungeon-legendary-fragment', 'veil-of-the-hollow', 'elemental-shard']) {
        assert.ok(source('api', 'hollow-gate', '_ledger.ts').includes(`'${itemId}'`));
    }
});

test('event and movement routes are live and have browser callers; legacy locked roll is fail-closed', () => {
    const server = source('server.ts');
    const tile = source('shinobij.client', 'src', 'lib', 'hollow-gate-tile.ts');
    const app = source('shinobij.client', 'src', 'App.tsx');
    assert.match(server, /route\('\/hollow-gate\/event'/);
    assert.match(server, /route\('\/hollow-gate\/step'/);
    assert.match(tile, /resolveHollowGateServerEvent/);
    assert.match(app, /sealHollowGateStep/);
    assert.match(source('api', 'hollow-gate', 'locked-door.ts'), /status\(410\)/);
});

test('server step derivation owns ward, darkness pressure, and final-floor boss ambush', () => {
    const warded = deriveHollowGateStepState({ torch: 5, threat: 20, wardSteps: 1, stepVersion: 0, currentFloor: 1, floorDepth: 5 }, false);
    assert.equal(warded.threat, 20);
    assert.equal(warded.wardSteps, 0);

    const dark = deriveHollowGateStepState({ torch: 0, threat: 92, wardSteps: 0, stepVersion: 9, currentFloor: 4, floorDepth: 5 }, false);
    assert.equal(dark.threat, 100);
    assert.deepEqual(dark.pendingAmbush, { nodeId: 'floor:4:ambush:threat-v10', kind: 'ambush' });

    const boss = deriveHollowGateStepState({ torch: 1, threat: 96, wardSteps: 0, stepVersion: 4, currentFloor: 5, floorDepth: 5 }, true);
    assert.equal(boss.torch, 0);
    assert.deepEqual(boss.pendingAmbush, { nodeId: 'floor:5:ambush:threat-v5', kind: 'boss' });
});

test('every shipped Hollow Gate shard relic uses the idempotent server run path', () => {
    const api = source('api', 'hollow-gate', 'use-consumable.ts');
    const client = source('shinobij.client', 'src', 'components', 'HollowGateShardBar.tsx');
    const fetcher = source('shinobij.client', 'src', 'lib', 'hollow-gate-server.ts');
    for (const action of ['reignite', 'skeleton-key', 'hollow-ward', 'diviner-eye', 'sanctify', 'arm-second-wind']) {
        assert.ok(api.includes(`'${action}'`), `missing server consumable ${action}`);
        assert.ok(client.includes(action), `missing client server action ${action}`);
    }
    assert.doesNotMatch(client, /import[^\n]+applyShardConsumable/);
    assert.match(api, /recentConsumableIds/);
    assert.match(api, /requestId/);
    assert.match(fetcher, /JSON\.stringify\(\{ playerName, token, action, requestId \}\)/);
    assert.equal(api.includes('consume-second-wind'), false);
});

test('augment choice is run-locked and gameplay cannot race ahead of it', () => {
    const choose = source('api', 'hollow-gate', 'choose-augment.ts');
    assert.match(choose, /withKvLock\(key/);
    assert.match(choose, /const chosenAugment = augmentDisplay\(AUGMENT_CATALOG\[chosenAugmentId\]\)/);
    assert.match(choose, /hollowGateRun:\s*\{[\s\S]*?\.\.\.savedRun,[\s\S]*?chosenAugment,[\s\S]*?\}/,
        'the canonical augment display must be committed into the locked run');
    for (const file of ['step.ts', 'event.ts', 'combat-start.ts', 'descend.ts', 'use-consumable.ts']) {
        assert.match(source('api', 'hollow-gate', file), /!run\.chosenAugmentId/, `${file} must require the sealed choice`);
    }
});

test('reserved receipts recover only when their matching save marker is absent', () => {
    assert.equal(hollowGateCombatReceiptNeedsRecovery({ version: 2 }, [], 'combat-1'), true);
    assert.equal(hollowGateCombatReceiptNeedsRecovery({ version: 2 }, ['combat-1'], 'combat-1'), false);
    assert.equal(hollowGateCombatReceiptNeedsRecovery({}, [], 'legacy-combat'), false);
    assert.equal(hollowGateEventNeedsSaveRecovery(true, [], 'event-1'), true);
    assert.equal(hollowGateEventNeedsSaveRecovery(true, ['event-1'], 'event-1'), false);
    assert.equal(hollowGateEventNeedsSaveRecovery(false, [], 'event-1'), false);
});
