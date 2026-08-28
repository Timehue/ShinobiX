import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { recordSoloPveLifecycle, soloPveTelemetrySource, type SoloPveTelemetryDeps } from './_telemetry.js';
import type { BetaMetricInput } from '../_beta-metrics.js';
import { applyBetaMetric } from '../_beta-metrics.js';
import type { SoloPveSession } from './_session.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* A structural stand-in: recordSoloPveLifecycle reads only sessionId, encounter
 * and outcome, so building a full engine session here would test the engine. */
function session(over: Record<string, unknown> = {}): SoloPveSession {
    return {
        sessionId: 'sess-1',
        encounter: { kind: 'generic-ai', id: 'academy-rival', level: 20 },
        outcome: 'win',
        ...over,
    } as unknown as SoloPveSession;
}

/** nx-honouring fake: `set` with nx returns 'OK' only for an unheld key. */
function gateKv() {
    const keys = new Set<string>();
    return {
        keys,
        async set(key: string, _v: unknown, opts?: { nx?: boolean }) {
            if (opts?.nx && keys.has(key)) return null;
            keys.add(key);
            return 'OK';
        },
    };
}

function harness() {
    const recorded: BetaMetricInput[] = [];
    const kv = gateKv();
    const deps: SoloPveTelemetryDeps = { kv, record: (input) => { recorded.push(input); } };
    return { recorded, kv, deps };
}

describe('solo-pve lifecycle telemetry', () => {
    it('records a transition once per session no matter how often it is retried', async () => {
        const { recorded, deps } = harness();
        const s = session();
        const results = [];
        for (let i = 0; i < 5; i += 1) results.push(await recordSoloPveLifecycle('combat.session_settled', s, deps));
        assert.deepEqual(results, [true, false, false, false, false]);
        assert.equal(recorded.length, 1, 'a replayed settlement must not add a second count');
    });

    it('gates each lifecycle event separately, and each session separately', async () => {
        const { recorded, deps } = harness();
        const s = session();
        for (const event of ['combat.session_created', 'combat.session_completed', 'combat.session_settled'] as const) {
            assert.equal(await recordSoloPveLifecycle(event, s, deps), true);
        }
        assert.equal(await recordSoloPveLifecycle('combat.session_created', session({ sessionId: 'sess-2' }), deps), true);
        assert.deepEqual(recorded.map((r) => r.event), [
            'combat.session_created', 'combat.session_completed', 'combat.session_settled', 'combat.session_created',
        ]);
    });

    it('emits no player identifier, and nothing identifying survives aggregation', async () => {
        const { recorded, deps } = harness();
        await recordSoloPveLifecycle('combat.session_settled', session({ ownerSlug: 'alice' }), deps);
        const [input] = recorded;
        assert.equal(input.playerName, undefined, 'lifecycle telemetry is aggregate-only');
        const serialized = JSON.stringify(applyBetaMetric(null, input));
        for (const identifier of ['alice', 'sess-1', 'academy-rival']) {
            assert.ok(!serialized.includes(identifier), `aggregated day must not contain ${identifier}`);
        }
    });

    it('buckets the source and never carries the free-form encounter id', () => {
        assert.equal(soloPveTelemetrySource(session(), 'combat.session_created'), 'generic-ai:lvl-16-29');
        assert.equal(soloPveTelemetrySource(session(), 'combat.session_settled'), 'generic-ai:lvl-16-29:win');
        // level bands, not raw levels
        assert.match(soloPveTelemetrySource(session({ encounter: { kind: 'mission', id: 'x', level: 90 } }), 'combat.session_created'), /lvl-80-plus$/);
        assert.match(soloPveTelemetrySource(session({ encounter: { kind: 'mission', id: 'x' } }), 'combat.session_created'), /lvl-unknown$/);
    });

    it('refuses hostile encounter kinds and outcomes rather than passing them through', () => {
        const hostile = session({ encounter: { kind: 'Mission Name With Spaces', id: 'x', level: 5 }, outcome: 'w'.repeat(80) });
        const source = soloPveTelemetrySource(hostile, 'combat.session_settled');
        assert.equal(source, 'unknown:lvl-1-15:outcome-unknown');
    });

    it('is best-effort: a telemetry outage is swallowed, never surfaced into combat', async () => {
        const recorded: BetaMetricInput[] = [];
        const exploding = { async set() { throw new Error('kv down'); } };
        const result = await recordSoloPveLifecycle('combat.session_completed', session(), {
            kv: exploding, record: (i) => { recorded.push(i); },
        });
        assert.equal(result, false);
        assert.equal(recorded.length, 0);
    });

    it('ignores a session with no id instead of writing a garbage gate key', async () => {
        const { recorded, kv, deps } = harness();
        assert.equal(await recordSoloPveLifecycle('combat.session_created', session({ sessionId: '  ' }), deps), false);
        assert.equal(recorded.length, 0);
        assert.equal(kv.keys.size, 0);
    });
});

/*
 * The unit tests above prove the recorder behaves; they cannot prove it is
 * CONNECTED. These pin the four call sites, because an emitter that is wired
 * nowhere is exactly the failure this whole change was fixing: the daily
 * report's unresolved-session alert read a counter with no emitter for months
 * and looked like working coverage.
 */
describe('solo-pve lifecycle telemetry is wired to real transitions', () => {
    // cwd-relative, not import.meta: api/ compiles to CommonJS for the server build.
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'api', ...parts), 'utf8');

    it('session creation is emitted from the single store write path', () => {
        const store = read('solo-pve', '_store.ts');
        assert.match(store, /recordSoloPveLifecycle\('combat\.session_created'/);
        // Guarded on the created-shape, or every later write would re-count.
        assert.match(store, /session\.version === 1 && session\.status === 'active'/);
    });

    it('completion is emitted on the active -> done edge, after the write', () => {
        const service = read('solo-pve', '_action-service.ts');
        assert.match(service, /recordSoloPveLifecycle\('combat\.session_completed'/);
        assert.match(service, /session\.status === 'active' && next\.status === 'done'/);
        const write = service.indexOf('await write(next)');
        const emit = service.indexOf("recordSoloPveLifecycle('combat.session_completed'");
        assert.ok(write !== -1 && emit > write, 'completion must be recorded after the session persists');
    });

    it('settlement and unresolved are emitted from the outcome settler', () => {
        const settler = read('pve', '_fight-outcome-settlement.ts');
        assert.match(settler, /recordSoloPveLifecycle\('combat\.session_unresolved'/);
        assert.match(settler, /recordSoloPveLifecycle\('combat\.session_settled'/);
        // Settled only on a first application: a replay is already durable.
        assert.match(settler, /mutation\.value\.applied && !mutation\.value\.replayed/);
    });

    it('the report alert that had no emitter now has one', () => {
        const report = read('_beta-report.ts');
        assert.match(report, /events\['combat\.session_unresolved'\]/);
        assert.match(read('pve', '_fight-outcome-settlement.ts'), /combat\.session_unresolved/);
    });
});
