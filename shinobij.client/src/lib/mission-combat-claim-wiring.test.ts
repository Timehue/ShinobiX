import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { queueCombatMissionClaim } from './mission-combat-claim';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the queue client publishes the exact server run authority', { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                queued: true,
                _saveVersion: 17,
                character: { name: 'Rill', level: 20, ryo: 100, inventory: [] },
            }),
        } as Response;
    }) as typeof fetch;
    try {
        const result = await queueCombatMissionClaim('Rill', 'combat-c-patrol', 'mission-run-17', 1);
        assert.deepEqual(requestBody, {
            playerName: 'Rill',
            missionId: 'combat-c-patrol',
            runId: 'mission-run-17',
        });
        assert.equal(result?.queued, true);
        assert.equal(result?.disposition, 'accepted');
        assert.equal(result?.saveVersion, 17);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('the sealed mission screen parks before sending and removes only after a decision', () => {
    const missions = source('../screens/Missions.tsx');
    const start = missions.indexOf('async function settleAuthoritativeMission');
    const end = missions.indexOf('function reportMissionFightOutcome', start);
    assert.ok(start >= 0 && end > start, 'the sealed settlement callback must remain wired');
    const settle = missions.slice(start, end);
    const park = settle.indexOf('enqueueClaim(playerName, missionId, runId)');
    const send = settle.indexOf('queueCombatMissionClaim(playerName, missionId, runId, 1)');
    const unknown = settle.indexOf('data.disposition === "retryable"');
    const remove = settle.indexOf('removeClaim(playerName, missionId, runId)');
    assert.ok(park >= 0 && send > park, 'the durable run-bound entry must precede the network request');
    assert.ok(unknown > send && remove > unknown, 'an unknown response must leave the outbox entry parked');
});

test('the queue client classifies auth/rate/conflict/server failures as retryable', { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const [status, reason] of [[401, 'auth-401'], [403, 'auth-403'], [409, 'conflict-409'], [429, 'rate-limit-429'], [500, 'server-500']] as const) {
            globalThis.fetch = (async () => ({
                ok: false,
                status,
                json: async () => ({}),
            }) as Response) as typeof fetch;
            const result = await queueCombatMissionClaim('Rill', 'combat-c-patrol', 'mission-run-status', 1);
            assert.equal(result.disposition, 'retryable');
            assert.equal(result.reason, reason);
            assert.equal(result.httpStatus, status);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('only a validated safe 200 decision becomes terminal', { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ queued: false, reason: 'combat-claim-already-pending' }),
        }) as Response) as typeof fetch;
        const pending = await queueCombatMissionClaim('Rill', 'combat-c-patrol', 'mission-run-pending', 1);
        assert.equal(pending.disposition, 'retryable');

        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ queued: false, reason: 'expired' }),
        }) as Response) as typeof fetch;
        const expired = await queueCombatMissionClaim('Rill', 'combat-c-patrol', 'mission-run-expired', 1);
        assert.equal(expired.disposition, 'terminal');

        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                queued: true,
                _saveVersion: 18,
                character: { name: 'Rill' },
            }),
        }) as Response) as typeof fetch;
        const incompleteSuccess = await queueCombatMissionClaim(
            'Rill',
            'combat-c-patrol',
            'mission-run-incomplete-success',
            1,
        );
        assert.equal(incompleteSuccess.disposition, 'retryable');
        assert.equal(incompleteSuccess.reason, 'authoritative-snapshot-missing');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('App quarantines the legacy local-Arena claim callback and clears its route flag', () => {
    const app = source('../App.tsx');
    assert.doesNotMatch(app, /settleCombatMissionClaim|onQueueCombatClaim=\{/);
    assert.match(app, /onMissionBattleResolved=\{\(\) => setMissionBattleActive\(false\)\}/);
    assert.match(app, /activeName !== snapshot\.playerName\.toLowerCase\(\)/);
    assert.match(app, /snapshot\.character\.name\.toLowerCase\(\)/);
    assert.match(app, /snapshot\.saveVersion/);
    assert.match(app, /snapshot\.saveVersion < latestSaveVersionRef\.current/);
});
