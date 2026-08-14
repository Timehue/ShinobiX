import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    recordTowerRunSettled,
    recordTowerRunStarted,
    towerTelemetrySource,
} from './_telemetry.js';
import type { BetaMetricInput } from '../_beta-metrics.js';
import type { TowerSession } from './_tower-session.js';

class MemoryGate {
    data = new Map<string, unknown>();
    async set(key: string, value: unknown, opts?: { nx?: boolean }): Promise<'OK' | null> {
        if (opts?.nx && this.data.has(key)) return null;
        this.data.set(key, value);
        return 'OK';
    }
}

function session(over: Partial<TowerSession> = {}): TowerSession {
    return {
        runId: 'tower-secret-run-id',
        towerId: 'celestial',
        floor: 5,
        partySize: 3,
        round: 8,
        winner: 'squad',
        log: [],
        actors: [{ ownerSlug: 'private-player-name' }],
        ...over,
    } as TowerSession;
}

describe('aggregate-only Tower lifecycle telemetry', () => {
    it('buckets mode/content/party/result/rounds without identity or run IDs', () => {
        const story = session();
        assert.equal(towerTelemetrySource(story, 'started'), 'story:floor-5:party-3');
        assert.equal(towerTelemetrySource(story, 'settled'), 'story:floor-5:party-3:win:rounds-6-10');
        assert.equal(towerTelemetrySource(session({ floor: 15 }), 'started'), 'story:floor-15:party-3');
        assert.equal(towerTelemetrySource(session({ floor: 999 }), 'started'), 'story:floor-15:party-3', 'malformed values clamp to the authored finale');

        const spire = session({
            towerId: 'endless-spire', floor: 17, ascensionTier: 17, partySize: 4, round: 21,
            winner: 'enemy', log: ['Round limit reached — floor failed.'],
            floorProvenance: { kind: 'spire-generated', mintedBy: 'tower-start', contentVersion: 'endless-spire-v1', tier: 17 },
        });
        assert.equal(towerTelemetrySource(spire, 'settled'), 'spire:tier-17:party-4:timeout:rounds-21-plus');
        assert.doesNotMatch(towerTelemetrySource(spire, 'settled'), /secret|private-player-name/);
        assert.equal(towerTelemetrySource(session({ winner: 'enemy', log: [] }), 'settled'), 'story:floor-5:party-3:wipe:rounds-6-10');
    });

    it('gates start and settle independently exactly once per run', async () => {
        const kv = new MemoryGate();
        const recorded: BetaMetricInput[] = [];
        const deps = { kv: kv as never, record: (input: BetaMetricInput) => { recorded.push(input); } };
        const value = session();
        assert.equal(await recordTowerRunStarted(value, deps), true);
        assert.equal(await recordTowerRunStarted(value, deps), false);
        assert.equal(await recordTowerRunSettled(value, deps), true);
        assert.equal(await recordTowerRunSettled(value, deps), false);
        assert.deepEqual(recorded, [
            { event: 'tower.run_started', source: 'story:floor-5:party-3' },
            { event: 'tower.run_settled', source: 'story:floor-5:party-3:win:rounds-6-10' },
        ]);
        assert.ok(recorded.every(input => input.playerName === undefined));
        assert.ok(recorded.every(input => !JSON.stringify(input).includes(value.runId)));
    });

    it('keeps gameplay call sites best-effort and settlement emission stability-gated', () => {
        const start = readFileSync(resolve(process.cwd(), 'api/towers/start.ts'), 'utf8');
        const settle = readFileSync(resolve(process.cwd(), 'api/towers/settle.ts'), 'utf8');
        assert.ok(start.indexOf('await writeSession(session)') < start.indexOf('await recordTowerRunStarted(session)'));
        const stable = settle.indexOf("authoritativeSession.rewardSettlementState === 'settled'");
        const record = settle.indexOf('await recordTowerRunSettled(authoritativeSession)', stable);
        assert.ok(stable > 0 && record > stable);
    });
});
