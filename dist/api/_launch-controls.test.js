"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const _launch_controls_js_1 = require("./_launch-controls.js");
(0, node_test_1.describe)('emergency launch controls', () => {
    (0, node_test_1.it)('allows normal traffic when every switch is absent', () => {
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/save/alice', method: 'POST' }, {}), { allowed: true });
        node_assert_1.strict.equal((0, _launch_controls_js_1.newRegistrationsDisabled)({}), false);
        node_assert_1.strict.equal((0, _launch_controls_js_1.scheduledJobsDisabled)({}), false);
    });
    (0, node_test_1.it)('maintenance mode pauses player reads and writes but preserves operator recovery', () => {
        const env = { MAINTENANCE_MODE: '1' };
        for (const request of [
            { path: '/player/roster', method: 'GET' },
            { path: '/api/save/alice', method: 'POST' },
            { path: '/player-auth', method: 'POST', body: { action: 'verify' } },
        ]) {
            const decision = (0, _launch_controls_js_1.evaluateLaunchControl)(request, env);
            node_assert_1.strict.equal(decision.allowed, false);
            if (!decision.allowed)
                node_assert_1.strict.equal(decision.code, 'maintenance_mode');
        }
        for (const path of ['/admin-auth', '/admin/economy', '/cron/snapshot-saves', '/kv/get']) {
            node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path, method: 'POST' }, env), { allowed: true });
        }
        node_assert_1.strict.equal((0, _launch_controls_js_1.newRegistrationsDisabled)(env), true);
    });
    (0, node_test_1.it)('registration switch blocks only new account registration', () => {
        const env = { DISABLE_NEW_REGISTRATIONS: '1' };
        const blocked = (0, _launch_controls_js_1.evaluateLaunchControl)({
            path: '/api/player-auth',
            method: 'POST',
            body: JSON.stringify({ action: 'register' }),
        }, env);
        node_assert_1.strict.equal(blocked.allowed, false);
        if (!blocked.allowed)
            node_assert_1.strict.equal(blocked.code, 'registrations_disabled');
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({
            path: '/player-auth', method: 'POST', body: { action: 'verify' },
        }, env), { allowed: true });
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({
            path: '/save/alice', method: 'POST',
        }, env), { allowed: true });
        node_assert_1.strict.equal((0, _launch_controls_js_1.newRegistrationsDisabled)(env), true);
    });
    (0, node_test_1.it)('economy freeze blocks every gameplay mutation while preserving reads and recovery', () => {
        const env = { FREEZE_ECONOMY_REWARDS: '1' };
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const decision = (0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/api/shop/settle', method }, env);
            node_assert_1.strict.equal(decision.allowed, false);
            if (!decision.allowed)
                node_assert_1.strict.equal(decision.code, 'gameplay_mutations_frozen');
        }
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/shop/settle', method: 'GET' }, env), { allowed: true });
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/player-auth', method: 'POST' }, env), { allowed: true });
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/admin/economy', method: 'POST' }, env), { allowed: true });
        node_assert_1.strict.deepEqual((0, _launch_controls_js_1.evaluateLaunchControl)({ path: '/perf-beacon', method: 'POST' }, env), { allowed: true });
    });
    (0, node_test_1.it)('scheduled-job switch is explicit and fail-safe by default', () => {
        node_assert_1.strict.equal((0, _launch_controls_js_1.scheduledJobsDisabled)({ DISABLE_SCHEDULED_JOBS: '1' }), true);
        node_assert_1.strict.equal((0, _launch_controls_js_1.scheduledJobsDisabled)({ DISABLE_SCHEDULED_JOBS: '0' }), false);
        node_assert_1.strict.equal((0, _launch_controls_js_1.scheduledJobsDisabled)({ DISABLE_SCHEDULED_JOBS: 'true' }), false);
    });
    (0, node_test_1.it)('is wired into Express, direct registration, and the in-process scheduler', () => {
        const server = (0, node_fs_1.readFileSync)('server.ts', 'utf8');
        const auth = (0, node_fs_1.readFileSync)('api/player-auth.ts', 'utf8');
        const scheduler = (0, node_fs_1.readFileSync)('api/cron/_scheduler.ts', 'utf8');
        node_assert_1.strict.match(server, /evaluateLaunchControl\(\{/);
        node_assert_1.strict.match(auth, /newRegistrationsDisabled\(\)/);
        node_assert_1.strict.match(scheduler, /scheduledJobsDisabled\(\)/);
    });
});
