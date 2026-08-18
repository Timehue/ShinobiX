import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    evaluateLaunchControl,
    newRegistrationsDisabled,
    presenceStateJobsDisabled,
    scheduledJobsDisabled,
} from './_launch-controls.js';

describe('emergency launch controls', () => {
    it('allows normal traffic when every switch is absent', () => {
        assert.deepEqual(evaluateLaunchControl({ path: '/save/alice', method: 'POST' }, {}), { allowed: true });
        assert.equal(newRegistrationsDisabled({}), false);
        assert.equal(presenceStateJobsDisabled({}), false);
        assert.equal(scheduledJobsDisabled({}), false);
    });

    it('maintenance mode pauses player reads and writes but preserves operator recovery', () => {
        const env = { MAINTENANCE_MODE: '1' };
        for (const request of [
            { path: '/player/roster', method: 'GET' },
            { path: '/api/save/alice', method: 'POST' },
            { path: '/player-auth', method: 'POST', body: { action: 'verify' } },
        ]) {
            const decision = evaluateLaunchControl(request, env);
            assert.equal(decision.allowed, false);
            if (!decision.allowed) assert.equal(decision.code, 'maintenance_mode');
        }
        for (const path of ['/admin-auth', '/admin/economy', '/cron/snapshot-saves', '/kv/get']) {
            assert.deepEqual(evaluateLaunchControl({ path, method: 'POST' }, env), { allowed: true });
        }
        assert.deepEqual(evaluateLaunchControl({ path: '/api/player/capabilities', method: 'GET' }, env), { allowed: true });
        assert.equal(evaluateLaunchControl({ path: '/player/capabilities', method: 'POST' }, env).allowed, false);
        assert.equal(newRegistrationsDisabled(env), true);
    });

    it('registration switch blocks only new account registration', () => {
        const env = { DISABLE_NEW_REGISTRATIONS: '1' };
        const blocked = evaluateLaunchControl({
            path: '/api/player-auth',
            method: 'POST',
            body: JSON.stringify({ action: 'register' }),
        }, env);
        assert.equal(blocked.allowed, false);
        if (!blocked.allowed) assert.equal(blocked.code, 'registrations_disabled');

        assert.deepEqual(evaluateLaunchControl({
            path: '/player-auth', method: 'POST', body: { action: 'verify' },
        }, env), { allowed: true });
        assert.deepEqual(evaluateLaunchControl({
            path: '/save/alice', method: 'POST',
        }, env), { allowed: true });
        assert.equal(newRegistrationsDisabled(env), true);
    });

    it('economy freeze blocks unsafe player HTTP methods while preserving reads and recovery', () => {
        const env = { FREEZE_ECONOMY_REWARDS: '1' };
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const decision = evaluateLaunchControl({ path: '/api/shop/settle', method }, env);
            assert.equal(decision.allowed, false);
            if (!decision.allowed) assert.equal(decision.code, 'gameplay_mutations_frozen');
        }
        assert.deepEqual(evaluateLaunchControl({ path: '/shop/settle', method: 'GET' }, env), { allowed: true });
        assert.deepEqual(evaluateLaunchControl({ path: '/weekly-boss', method: 'GET' }, env), { allowed: true });
        assert.deepEqual(evaluateLaunchControl({ path: '/world-state', method: 'GET' }, env), { allowed: true });
        // `recover` is credential recovery, so freezing it would mean the one
        // incident an operator most wants players able to work around is the
        // one where nobody can get back in.
        for (const action of ['verify', 'change', 'adminreset', 'guest-resume', 'recover', 'recovery-issue', 'admin-recovery']) {
            assert.deepEqual(evaluateLaunchControl({ path: '/player-auth', method: 'POST', body: { action } }, env), { allowed: true });
        }
        for (const body of [
            { action: 'register' },
            { action: 'delete' },
            { action: 'unknown' },
            {},
            '{malformed',
        ]) {
            const blocked = evaluateLaunchControl({ path: '/player-auth', method: 'POST', body }, env);
            assert.equal(blocked.allowed, false);
            if (!blocked.allowed) assert.equal(blocked.code, 'gameplay_mutations_frozen');
        }
        assert.deepEqual(evaluateLaunchControl({ path: '/admin/economy', method: 'POST' }, env), { allowed: true });
        assert.deepEqual(evaluateLaunchControl({ path: '/perf-beacon', method: 'POST' }, env), { allowed: true });
    });

    it('scheduled-job switch is explicit and fail-safe by default', () => {
        assert.equal(scheduledJobsDisabled({ DISABLE_SCHEDULED_JOBS: '1' }), true);
        assert.equal(scheduledJobsDisabled({ DISABLE_SCHEDULED_JOBS: '0' }), false);
        assert.equal(scheduledJobsDisabled({ DISABLE_SCHEDULED_JOBS: 'true' }), false);
    });

    it('presence/game-loop writer switch is exact and independent from sockets', () => {
        assert.equal(presenceStateJobsDisabled({ DISABLE_PRESENCE_STATE_JOBS: '1' }), true);
        assert.equal(presenceStateJobsDisabled({ DISABLE_PRESENCE_STATE_JOBS: '0' }), false);
        assert.equal(presenceStateJobsDisabled({ DISABLE_PRESENCE_STATE_JOBS: 'true' }), false);
        assert.equal(presenceStateJobsDisabled({ DISABLE_REALTIME: '1' }), false);
    });

    it('is wired into Express, direct registration, and the in-process scheduler', () => {
        const server = readFileSync('server.ts', 'utf8');
        const auth = readFileSync('api/player-auth.ts', 'utf8');
        const scheduler = readFileSync('api/cron/_scheduler.ts', 'utf8');
        assert.match(server, /evaluateLaunchControl\(\{/);
        assert.match(auth, /newRegistrationsDisabled\(\)/);
        assert.match(scheduler, /scheduledJobsDisabled\(\)/);
        assert.match(server, /presenceStateJobsDisabled\(\)/);
        assert.match(server, /presence snapshots and game loop disabled via DISABLE_PRESENCE_STATE_JOBS=1/);
    });
});
