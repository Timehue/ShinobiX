import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordBetaFunnelStep, betaFunnelSlug, type BetaFunnelDeps } from './_beta-funnel.js';
import { applyBetaMetric, type BetaMetricInput } from './_beta-metrics.js';

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
    const deps: BetaFunnelDeps = { kv, record: (input) => { recorded.push(input); } };
    return { recorded, kv, deps };
}

describe('beta onboarding funnel', () => {
    it('counts a first exactly once per player, however often it is retried', async () => {
        const { recorded, deps } = harness();
        const results = [];
        for (let i = 0; i < 4; i += 1) results.push(await recordBetaFunnelStep('training.first_started', 'Alice', deps));
        assert.deepEqual(results, [true, false, false, false]);
        assert.equal(recorded.length, 1);
    });

    it('treats the same player under different casing and padding as one player', async () => {
        const { recorded, deps } = harness();
        assert.equal(await recordBetaFunnelStep('combat.first_completed', 'Alice', deps), true);
        assert.equal(await recordBetaFunnelStep('combat.first_completed', '  ALICE  ', deps), false);
        assert.equal(recorded.length, 1, 'casing must not mint a second first');
    });

    it('counts different players separately', async () => {
        const { recorded, deps } = harness();
        assert.equal(await recordBetaFunnelStep('training.first_started', 'alice', deps), true);
        assert.equal(await recordBetaFunnelStep('training.first_started', 'bob', deps), true);
        assert.equal(recorded.length, 2);
    });

    it('lets a repeatable step count once per step, not once per player', async () => {
        const { recorded, deps } = harness();
        assert.equal(await recordBetaFunnelStep('academy.step.reached', 'alice', { ...deps, step: 'awaken' }), true);
        assert.equal(await recordBetaFunnelStep('academy.step.reached', 'alice', { ...deps, step: 'first-jutsu' }), true);
        assert.equal(await recordBetaFunnelStep('academy.step.reached', 'alice', { ...deps, step: 'awaken' }), false);
        assert.equal(recorded.length, 2);
    });

    it('never emits the player name, and nothing identifying survives aggregation', async () => {
        const { recorded, deps } = harness();
        await recordBetaFunnelStep('training.first_started', 'Alice', { ...deps, level: 12, source: 'ninjutsuOffense' });
        const [input] = recorded;
        assert.equal(input.playerName, undefined);
        const serialized = JSON.stringify(applyBetaMetric(null, input));
        assert.ok(!serialized.toLowerCase().includes('alice'), 'aggregated day must not contain the player');
        // the level is kept only as a band
        assert.ok(!serialized.includes('"12"'), 'raw level must not be stored');
    });

    it('refuses a name that could break or forge a gate key', async () => {
        const { recorded, kv, deps } = harness();
        for (const name of ['', '   ', 'a:b', 'alice bob', '../../etc', 'x'.repeat(80)]) {
            assert.equal(await recordBetaFunnelStep('training.first_started', name, deps), false, `should refuse ${JSON.stringify(name)}`);
        }
        assert.equal(recorded.length, 0);
        assert.equal(kv.keys.size, 0);
        assert.equal(betaFunnelSlug('a:b'), null);
        assert.equal(betaFunnelSlug('Alice'), 'alice');
    });

    it('is best-effort: a telemetry outage never surfaces into the request', async () => {
        const recorded: BetaMetricInput[] = [];
        const result = await recordBetaFunnelStep('training.first_started', 'alice', {
            kv: { async set() { throw new Error('kv down'); } },
            record: (i) => { recorded.push(i); },
        });
        assert.equal(result, false);
        assert.equal(recorded.length, 0);
    });
});

describe('beta funnel is wired to real transitions', () => {
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'api', ...parts), 'utf8');

    it('first training is emitted from the training start handler', () => {
        const start = read('training', 'start.ts');
        assert.match(start, /recordBetaFunnelStep\('training\.first_started'/);
    });

    it('first completed combat is emitted on the same edge as the session completion', () => {
        const service = read('solo-pve', '_action-service.ts');
        assert.match(service, /recordBetaFunnelStep\('combat\.first_completed'/);
        const edge = service.indexOf("session.status === 'active' && next.status === 'done'");
        const emit = service.indexOf("recordBetaFunnelStep('combat.first_completed'");
        assert.ok(edge !== -1 && emit > edge, 'the first-combat count must sit on the terminal edge');
    });
});
