import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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
    assert.ok(timeouts.every((minutes) => minutes > 0 && minutes < 30), `ordinary CI timeout escaped the sub-30-minute policy: ${timeouts.join(', ')}`);
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
    assert.ok(occurrences('if: ${{ always() }}') >= 6, 'dependent jobs must fail closed instead of disappearing');
    assert.ok(workflow.includes('.playwright-mcp/aaa-adaptive/'));
    assert.ok(!workflow.includes('shinobij.client/.playwright-mcp/aaa-adaptive/'));
});
