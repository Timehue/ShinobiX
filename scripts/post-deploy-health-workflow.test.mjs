import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * The post-deploy probe must never be able to hold up or cancel a Railway
 * rollout. Railway waits until every check suite on a commit is complete and
 * green, and a workflow run tied to that commit adds one. On 2026-09-14 the
 * probe, started by `workflow_run` and so tied to main's newest commit, waited
 * for the deploy while Railway waited for the probe. The probe timed out and
 * failed, and Railway cancelled the rollout of 100aa4218.
 *
 * These assertions pin the shape that makes that impossible: the probe starts
 * from Railway's own `success` deployment status, which Railway posts only
 * after the cutover, and it keeps #176's checks.
 */

const workflow = readFileSync(new URL('../.github/workflows/post-deploy-health.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The top-level `on:` block, up to the next top-level key. */
function triggerBlock() {
    const start = workflow.indexOf('\non:\n');
    assert.ok(start >= 0, 'the workflow declares an on: block');
    const rest = workflow.slice(start + '\non:\n'.length);
    const end = rest.search(/\n[A-Za-z_][\w-]*:/);
    return end >= 0 ? rest.slice(0, end) : rest;
}

const triggers = () => [...triggerBlock().matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);

test('the probe starts only from a deployment status or a manual dispatch', () => {
    assert.deepEqual(triggers().sort(), ['deployment_status', 'workflow_dispatch']);
    // Each of these ties its run to main's newest commit, the one Railway may
    // still be waiting on, which is how the deadlock happened.
    for (const forbidden of ['workflow_run', 'schedule', 'push', 'pull_request', 'check_suite', 'check_run']) {
        assert.ok(!triggers().includes(forbidden), `${forbidden} must not start the probe`);
    }
});

test('the probe acts only once Railway reports a production deployment as live', () => {
    const probe = workflow.slice(workflow.indexOf('\n  probe:\n'), workflow.indexOf('\n  deploy-failed:\n'));
    assert.match(probe, /github\.event\.deployment_status\.state == 'success'/);
    assert.match(probe, /endsWith\(github\.event\.deployment\.environment, '\/ production'\)/);
    // The expected commit is the deployed one, never main's newest commit.
    const expected = [...probe.matchAll(/^\s+EXPECTED_COMMIT: (.+)$/gm)].map((match) => match[1]);
    assert.equal(expected.length, 2, 'both the wait loop and the deep probe name the commit');
    for (const value of expected) {
        assert.match(value, /inputs\.commit \|\| github\.event\.deployment\.sha/);
        assert.doesNotMatch(value, /workflow_run|github\.sha/);
    }
});

test('an in_progress status for the next push cannot cancel the probe of the current deploy', () => {
    assert.match(workflow, /group: post-deploy-health-\$\{\{ github\.event\.deployment_status\.state \|\| github\.event_name \}\}/);
    assert.doesNotMatch(workflow, /group: post-deploy-health\n/, 'a single shared group would let any status event cancel the probe');
});

test('the #176 hardening still holds', () => {
    for (const flag of ['REQUIRE_KNOWN_COMMIT', 'REQUIRE_EXPECTED_COMMIT', 'REQUIRE_FRESH_BACKUP']) {
        assert.match(workflow, new RegExp(`${flag}: '1'`), `${flag} stays on`);
    }
    assert.match(workflow, /echo "configured=false" >> "\$GITHUB_OUTPUT"\n\s+echo "::error::[^\n]+"\n\s+exit 1/, 'missing secrets fail the run');
    assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/, 'a full intended SHA is required');
    assert.match(workflow, /node scripts\/release-health-check\.mjs "\$PRODUCTION_URL"/);
});

test('the header no longer claims the probe cannot block the cutover', () => {
    assert.doesNotMatch(workflow, /cannot block the cutover/i);
    assert.match(workflow, /must never be able to gate the cutover/);
});
