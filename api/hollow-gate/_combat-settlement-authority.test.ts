import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHollowGateCombatBinding } from './_combat-session.js';
import {
    appendHollowGateCombatSettlement,
    createHollowGateCombatPreparation,
    findHollowGateCombatSettlement,
    HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD,
    readHollowGateCombatPreparation,
    type HollowGateCombatReceipt,
} from './_combat-settlement-authority.js';

const NOW = 1_800_000_000_000;
const binding = createHollowGateCombatBinding({
    playerName: 'Alice',
    token: 'hollow-token',
    floor: 3,
    nodeId: 'floor:3:tile:9',
    kind: 'elite',
    runId: 'hollow-authority-run',
    now: NOW - 1_000,
});
const receipt: HollowGateCombatReceipt = {
    version: 3,
    won: true,
    reward: { xp: 100, ryo: 50, auraDust: 2, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 },
    elementalShards: 0,
    settledAt: NOW,
};

test('v4 preparation binds account, token, and run while tripping the legacy receipt path closed', () => {
    const preparation = createHollowGateCombatPreparation({
        playerName: 'Alice',
        token: 'hollow-token',
        binding,
        receipt,
        run: {
            playerName: 'Alice',
            mintedAt: NOW - 10_000,
            floorDepth: 5,
            currentFloor: 3,
            seed: 'authority-seed',
            entryCurrencies: { ryo: 0 },
            offeredAugmentIds: [],
            chosenAugmentId: null,
            dailyRunOrdinal: 1,
            activeEncounter: {
                runId: binding.runId,
                nodeId: binding.nodeId,
                floor: binding.floor,
                kind: binding.kind,
                enemyProfileId: binding.enemyProfileId,
                createdAt: binding.createdAt,
            },
            resolvedEncounterIds: [],
        },
        settlementSession: null,
        survivingHp: 100,
        petIds: [],
    });
    assert.equal(preparation.won, true);
    assert.equal(Object.hasOwn(preparation, 'reward'), false);
    assert.deepEqual(readHollowGateCombatPreparation(preparation, {
        playerName: 'Alice', token: 'hollow-token', runId: binding.runId,
    }), preparation);
    assert.equal(readHollowGateCombatPreparation(preparation, {
        playerName: 'Mallory', token: 'hollow-token', runId: binding.runId,
    }), 'invalid');
    assert.equal(readHollowGateCombatPreparation(preparation, {
        playerName: 'Alice', token: 'wrong-token', runId: binding.runId,
    }), 'invalid');
    assert.equal(readHollowGateCombatPreparation(preparation, {
        playerName: 'Alice', token: 'hollow-token', runId: 'wrong-run',
    }), 'invalid');

    const forged = structuredClone(preparation);
    forged.receipt.reward.ryo += 1;
    assert.equal(readHollowGateCombatPreparation(forged, {
        playerName: 'Alice', token: 'hollow-token', runId: binding.runId,
    }), 'invalid');

    const legacyProjection = { ...preparation, reward: structuredClone(receipt.reward) };
    assert.equal(readHollowGateCombatPreparation(legacyProjection, {
        playerName: 'Alice', token: 'hollow-token', runId: binding.runId,
    }), 'invalid', 'adding a legacy-visible reward would bypass the rolling-worker tripwire');
});

test('Hollow Gate settlement markers bind the full receipt and reject fingerprint forgery', () => {
    const appended = appendHollowGateCombatSettlement({
        character: { name: 'Alice' },
        playerName: 'Alice',
        token: 'hollow-token',
        binding,
        receipt,
        now: NOW,
    });
    assert.equal(appended.ok, true);
    if (!appended.ok) return;
    const found = findHollowGateCombatSettlement({
        character: appended.character,
        playerName: 'Alice',
        token: 'hollow-token',
        binding,
    });
    assert.notEqual(found, null);
    assert.notEqual(found, 'invalid');

    const forged = structuredClone(appended.character);
    const markers = forged[HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD] as Array<Record<string, unknown>>;
    markers[0] = { ...markers[0], fingerprint: 'f'.repeat(64) };
    assert.equal(findHollowGateCombatSettlement({
        character: forged,
        playerName: 'Alice',
        token: 'hollow-token',
        binding,
    }), 'invalid');
});

test('active recovery markers are never evicted by expired receipt churn', () => {
    const active = Array.from({ length: 260 }, (_, index) => ({
        version: 1,
        runId: `active-${index}`,
        fingerprint: String(index % 10).repeat(64),
        receipt,
        committedAt: NOW - 1_000,
        expiresAt: NOW + 60_000,
    }));
    const expired = Array.from({ length: 260 }, (_, index) => ({
        version: 1,
        runId: `expired-${index}`,
        fingerprint: String((index + 3) % 10).repeat(64),
        receipt,
        committedAt: NOW - 120_000,
        expiresAt: NOW - 60_000,
    }));
    const appended = appendHollowGateCombatSettlement({
        character: { [HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD]: [...active, ...expired] },
        playerName: 'Alice',
        token: 'hollow-token',
        binding,
        receipt,
        now: NOW,
    });
    assert.equal(appended.ok, true);
    if (!appended.ok) return;
    const markers = appended.character[HOLLOW_GATE_COMBAT_SETTLEMENTS_FIELD] as Array<{ runId: string }>;
    assert.equal(active.every(({ runId }) => markers.some((marker) => marker.runId === runId)), true);
    assert.equal(markers.filter(({ runId }) => runId.startsWith('expired-')).length, 199);
});
