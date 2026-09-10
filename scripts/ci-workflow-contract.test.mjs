import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const warfrontSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/warfront.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const riteSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/rite.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const modelLifecycleSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/model-resource-lifecycle.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const occurrences = (needle) => workflow.split(needle).length - 1;

test('split CI exposes stable required check names with bounded jobs', () => {
    const requiredNames = [
        'CI / server-contracts',
        'CI / server-build-security',
        'CI / client-quality',
        'CI / release-certification',
        'CI / concurrency-smoke',
        'CI / e2e-responsive',
        'CI / e2e-combat',
        'CI / e2e-warfront',
        'CI / e2e-village-stores',
        'CI / test-build',
    ];
    for (const name of requiredNames) {
        assert.equal(occurrences(`name: ${name}\n`), 1, `${name} must remain a unique stable check context`);
    }
    assert.match(workflow, /name: CI \/ e2e-responsive \/ \$\{\{ matrix\.shard \}\}-of-2/);
    assert.match(workflow, /name: CI \/ e2e-combat \/ \$\{\{ matrix\.shard \}\}/);
    const timeouts = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/g)].map((match) => Number(match[1]));
    assert.ok(timeouts.length >= requiredNames.length, 'every job must declare a timeout');
    // The ceiling exists to stop a runaway job holding a runner for an hour, not
    // to pin a specific number. It was 30 until 366afc50f gave both npm audit
    // steps a three-attempt retry: a single failing attempt costs ~5m of npm's
    // own internal retrying, so server-build-security needed 30 and
    // client-quality 35 to fit three of them. That commit raised the timeouts
    // with its reasoning written into ci.yml and left this bound at 30, which
    // reddened main on a contract test rather than on any product code — the
    // audit-flake fix tripping a guard that predated it. 36 clears the retry
    // budget and still fails a job that has genuinely run away.
    assert.ok(timeouts.every((minutes) => minutes > 0 && minutes < 36), `ordinary CI timeout escaped the sub-36-minute policy: ${timeouts.join(', ')}`);
});

test('split CI preserves every release gate and builds each artifact once', () => {
    const commands = [
        'npm run test:ci',
        'npm run check:deployment',
        'npm run check:rollback-readiness',
        'npm run test:backup',
        'npm run test:mission-eligibility',
        'npm run test:release-assets',
        'npm run test:pet-breeding-odds',
        'npm run check:tooling-handoffs',
        'npm audit --audit-level=high',
        'npm run lint --prefix shinobij.client',
        'npm run sizecheck',
        'npm run test:e2e:visual:size --prefix shinobij.client',
        'npm audit --prefix shinobij.client --audit-level=high',
        'npm run certify:release',
        'npm run soak:smoke',
        'npm run test:e2e --prefix shinobij.client',
        'npm run test:e2e:combat-layout --prefix shinobij.client',
        'npm run test:e2e:warfront --prefix shinobij.client',
        'npm run test:e2e:live --prefix shinobij.client',
    ];
    for (const command of commands) assert.ok(workflow.includes(command), `missing CI gate: ${command}`);
    assert.equal(occurrences('npm run build:server'), 1, 'server release artifact must be built exactly once');
    assert.equal(occurrences('npm run build --prefix shinobij.client'), 1, 'client release artifact must be built exactly once');
    assert.ok(workflow.includes('npm run test:e2e --prefix shinobij.client -- --shard=${{ matrix.shard }}/2'), 'responsive certification must run both Playwright shards');
    assert.match(workflow, /NODE_VERSION:\s*22\.23\.1/);
});

test('artifact consumers verify immutable provenance and failure evidence stays reachable', () => {
    const uploadCount = occurrences('actions/upload-artifact@v7');
    assert.ok(uploadCount >= 10);
    assert.equal(occurrences('include-hidden-files: true'), uploadCount, 'scoped dot-directory evidence must not be silently excluded');
    assert.ok(occurrences('actions/download-artifact@v8') >= 7);
    assert.ok(occurrences('${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}') >= 10);
    assert.ok(occurrences('sha256sum -c') >= 7);
    assert.ok(occurrences('grep -Fx "sha=$GITHUB_SHA" provenance.txt') >= 7);
    assert.ok(occurrences('grep -Fx "run_id=$GITHUB_RUN_ID" provenance.txt') >= 7);
    assert.ok(occurrences("artifact_attempt=\"$(sed -n 's/^run_attempt=//p' provenance.txt)\"") >= 7);
    assert.ok(occurrences('[[ "$artifact_attempt" =~ ^[1-9][0-9]*$ ]]') >= 7);
    assert.ok(occurrences('(( artifact_attempt <= GITHUB_RUN_ATTEMPT ))') >= 7);
    assert.equal(
        occurrences('grep -Fx "run_attempt=$GITHUB_RUN_ATTEMPT" provenance.txt'),
        0,
        'artifact consumers must accept exact SHA/run artifacts produced by an earlier rerun attempt',
    );
    assert.ok(occurrences('if: ${{ always() }}') >= 6, 'dependent jobs must fail closed instead of disappearing');
    assert.ok(workflow.includes('.playwright-mcp/aaa-adaptive/'));
    assert.ok(!workflow.includes('shinobij.client/.playwright-mcp/aaa-adaptive/'));
});

test('live Express CI includes persistence and route integration regressions', () => {
    const command = workflow.match(/run: (npm run test:e2e:live[^\n]+)/)?.[1];
    assert.ok(command, 'live Express CI command must exist');
    for (const spec of [
        'village-stores-express.spec.ts',
        'first-session-onboarding-express.spec.ts',
        'server-route-smoke-express.spec.ts',
    ]) {
        assert.ok(command.split(/\s+/).includes(spec), `${spec} must run against the joined release artifact in CI`);
    }
    assert.ok(command.includes('--project=chromium-desktop-live'), 'the full Academy cases require the desktop live project');
});

test('current Warfront coverage keeps low-cost interactions and real renderer audits', () => {
    // Check the fixture's behavior, without pinning retired lane-mode variable
    // names or command windows that the current Rite no longer exposes.
    const fixtures = (source) => [...source.matchAll(/\/petvfx\.html\?[^"'`\s]+/g)]
        .map(([url]) => new URL(url, 'https://warfront.invalid').searchParams);
    assert.ok(fixtures(warfrontSpec).some((params) => params.get('warfront') === '1' && params.get('petQuality') === 'low'),
        'saved Warfront links must be tested through the low-cost migration fixture');
    assert.match(warfrontSpec, /\.wf3-shell[\s\S]*toHaveCount\(0\)/,
        'the migration check must keep the retired lane renderer unreachable');
    const riteFixtures = fixtures(riteSpec).filter((params) => params.get('rite') === '1');
    assert.ok(riteFixtures.some((params) => params.get('petQuality') === 'low' && !params.has('ritespeed')),
        'current formation interactions must retain the low-cost fixture');
    assert.ok(riteFixtures.some((params) => params.get('petQuality') === 'low' && params.get('ritespeed') === '12' && params.get('riteqa') === '1'),
        'report and rematch checks must use accelerated deterministic playback');
    assert.ok(riteFixtures.some((params) => params.get('petQuality') === 'high' && params.get('riteforce3d') === '1'),
        'the production renderer audit must explicitly exercise real high-quality rigs');
    assert.match(riteSpec, /data-rite-actor-render-mode[\s\S]*skinned-3d/);
    assert.match(riteSpec, /scrollWidth - document\.documentElement\.clientWidth/,
        'the current responsive report must retain its viewport overflow check');
    assert.ok(fixtures(modelLifecycleSpec).some((params) => params.get('modelresources') === '1'),
        'GPU lifecycle coverage must continue loading the real model resource harness');
});
