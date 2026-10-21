import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const warfrontSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/warfront.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const riteSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/rite.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const modelLifecycleSpec = readFileSync(new URL('../shinobij.client/e2e-warfront/model-resource-lifecycle.spec.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const occurrences = (needle) => workflow.split(needle).length - 1;
const responsiveShards = () => workflow.split('  e2e_responsive_matrix:\n')[1]?.split('\n  e2e_responsive_flows:\n')[0];
const responsiveFlows = () => workflow.split('  e2e_responsive_flows:\n')[1]?.split('\n  e2e_responsive:\n')[0];

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
    assert.match(workflow, /name: CI \/ e2e-responsive \/ \$\{\{ matrix\.shard \}\}-of-7/);
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
    assert.ok(workflow.includes('npm run test:e2e --prefix shinobij.client -- --shard=${{ matrix.shard }}/7'), 'responsive certification must run all seven Playwright shards');
    assert.ok(workflow.includes('node-version-file: .nvmrc'), 'CI must take its Node version from .nvmrc');
});

test('client release artifact requires the complete pet asset chain', () => {
    const quality = workflow.split('  client_quality:\n')[1]?.split('\n  release_artifact:\n')[0];
    assert.ok(quality, 'client quality job must exist');
    const build = quality.indexOf('run: npm run build --prefix shinobij.client');
    for (const command of [
        'npm run qa:pet-models --prefix shinobij.client',
        'npm run check:warfront-pet-lods --prefix shinobij.client',
        'npm run check:warfront-pet-impostors --prefix shinobij.client',
    ]) {
        const step = quality.split('      - name: ').find((value) => value.includes(`run: ${command}`));
        assert.ok(step, `missing pet asset release gate: ${command}`);
        assert.ok(quality.indexOf(`run: ${command}`) < build, `${command} must certify assets before the release build`);
        assert.doesNotMatch(step, /continue-on-error/, `${command} must fail the client quality job`);
    }
    assert.match(workflow, /release_artifact:\n[\s\S]*?needs: \[server_build_security, client_quality\]/);
});

test('responsive browser discovery installs runtime and direct QA build dependencies', () => {
    // A client-only install passes locally when an earlier root install exists,
    // but fails while discovering the ranked replay fixture on a fresh runner.
    const responsive = responsiveShards();
    assert.ok(responsive, 'the responsive shard job must exist');
    assert.match(responsive, /shard: \[1, 2, 3, 4, 5, 6, 7\]/, 'every responsive shard must be scheduled');
    const rootInstall = responsive.search(/run: npm ci 2>&1/);
    const browserRun = responsive.indexOf('run: npm run test:e2e --prefix shinobij.client');
    assert.ok(rootInstall >= 0 && browserRun > rootInstall,
        'fresh responsive shards must install root runtime and dev tooling before loading browser specs');
    const flows = responsiveFlows();
    assert.ok(flows, 'the responsive flow job must exist');
    assert.ok(flows.search(/run: npm ci 2>&1/) >= 0 && flows.search(/run: npm ci 2>&1/) < flows.indexOf('scripts/stronghold-browser-qa.mjs'),
        'Stronghold QA builds its fixture with the root tsx/esbuild tooling');
    const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const tool of ['tsx', 'esbuild']) assert.ok(rootPackage.devDependencies[tool], `${tool} must be a direct QA dependency`);
});

test('Pet Gauntlet renderer regression runs as a dedicated source fixture in CI', () => {
    const playwrightConfig = readFileSync(new URL('../shinobij.client/playwright.config.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.match(playwrightConfig, /SOURCE_FIXTURE_SPECS\s*=\s*\[[^\]]*pet-gauntlet-board\.spec\.ts/,
        'the immutable production-preview suite must leave the Vite source fixture to its dedicated config');
    const flows = responsiveFlows();
    const step = flows?.split(/\n(?=      - name: )/).find((value) => value.startsWith('      - name: Pet Gauntlet playback and renderer recovery\n'));
    assert.ok(step, 'the required responsive job must execute the renderer recovery check');
    assert.match(step, /if: \$\{\{ matrix\.shard == 2 \}\}/, 'the expensive source fixture must run once');
    assert.match(step, /xvfb-run -a npm run test:e2e:gauntlet-render --prefix shinobij\.client/,
        'the headful WebGL regression needs a virtual display on the Linux CI runner');
    assert.match(step, /2>&1 \| tee \.ci-evidence\/e2e-responsive-.*\/gauntlet-render\.log/,
        'the result must be retained in responsive CI evidence');
});

test('built CSP and every Stronghold audit feed the required responsive gate with retained evidence', () => {
    const responsive = responsiveShards();
    const flows = responsiveFlows();
    // GitHub's implicit Bash shell does not enable pipefail. All these gates
    // pipe into tee, so preserving the explicit shell is part of enforcement.
    assert.match(workflow, /defaults:\n  run:\n    shell: bash\n/);
    assert.doesNotMatch(responsive, /^\s+shell:/m, 'responsive gates must inherit the explicit Bash shell');
    assert.doesNotMatch(flows, /^\s+shell:/m, 'responsive flow gates must inherit the explicit Bash shell');
    // The smoke shards run only their slice. Every other responsive gate runs
    // beside them in the flow job, so a slow slice cannot starve it of time.
    assert.deepEqual(
        responsive.split('\n').filter(line => /^      - name: /.test(line)).map(line => line.slice(14)),
        ['Initialize evidence', 'Require successful release artifact', 'Install server runtime and QA dependencies',
            'Install client dependencies', 'Download joined release artifact', 'Verify and extract exact release artifact',
            'Install release browsers', 'Cross-browser responsive and accessibility smoke', 'Retain responsive browser evidence'],
        'responsive smoke shards must not regain trailing suites',
    );
    const smoke = responsive.split('      - name: ').find(value => value.startsWith('Cross-browser responsive and accessibility smoke\n'));
    const stepTimeout = Number(smoke?.match(/timeout-minutes: (\d+)/)?.[1]);
    const jobTimeout = Number(responsive.match(/^    timeout-minutes: (\d+)/m)?.[1]);
    assert.ok(stepTimeout > 0 && stepTimeout < jobTimeout,
        'a hung smoke slice must fail before the job ceiling so its evidence still uploads');
    const steps = flows.split('      - name: ');
    const gates = [
        ['node --test scripts/check-http-security-browser.mjs', 1],
        ['node scripts/stronghold-browser-qa.mjs --output=', 1],
        ['node scripts/stronghold-browser-qa.mjs --dismissal --output=', 1],
        ['node scripts/stronghold-browser-qa.mjs --resources --output=', 1],
    ];
    for (const [command, shard] of gates) {
        const step = steps.find(value => value.includes(`run: ${command}`));
        assert.ok(step, `missing responsive gate: ${command}`);
        assert.ok(step.includes(`if: \${{ matrix.shard == ${shard} }}`), `${command} must run once on its assigned flow shard`);
        assert.doesNotMatch(step, /continue-on-error|--baseline/, `${command} must enforce its assertions`);
        assert.match(step, /2>&1 \| tee .*\.ci-evidence\/e2e-responsive-.*\.log/);
        if (command.includes('stronghold-browser')) {
            assert.match(step, /working-directory: shinobij\.client/);
            assert.match(step, /NODE_ENV: test/);
            assert.match(step, /SHINOBIX_QA_MEMORY_KV: '1'/);
        }
    }
    // Stronghold modes share one disposable fixture directory, so they must stay
    // sequential on one flow shard, in this order.
    const strongholdOrder = ['--output=', '--dismissal --output=', '--resources --output=']
        .map(flag => flows.indexOf(`run: node scripts/stronghold-browser-qa.mjs ${flag}`));
    assert.deepEqual([...strongholdOrder].sort((a, b) => a - b), strongholdOrder);
    assert.match(responsive, /name: Retain responsive browser evidence\n\s+if: always\(\)/);
    assert.match(flows, /name: Retain responsive flow evidence\n\s+if: always\(\)/);
    assert.match(flows, /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\]/, 'every responsive flow shard must be scheduled');
    for(let shard=1;shard<=8;shard++)assert(flows.includes(`lifeShard: ${shard}/8`),'every living-sector slice must be gated');
    assert.match(flows, /needs: release_artifact\n\s+if: \$\{\{ always\(\) \}\}/);
    const aggregate = workflow.split('  e2e_responsive:\n')[1]?.split('\n  e2e_combat_matrix:\n')[0];
    assert.match(aggregate, /needs: \[e2e_responsive_matrix, e2e_responsive_flows\]/);
    assert.ok(aggregate.includes('test "$RESPONSIVE_MATRIX" = success'));
    assert.ok(aggregate.includes('test "$RESPONSIVE_FLOWS" = success'), 'the required aggregate must fail when a flow shard fails');
});

test('dedicated world suites run once without sharing living-sector job budgets', () => {
    const flows = responsiveFlows();
    const matrix = flows.split('    steps:')[0];
    const entries = [...matrix.matchAll(/^          - shard: (\d+)\n((?:            [^\n]+\n)*)/gm)]
        .map((match) => ({ shard: Number(match[1]), body: match[2] }));
    assert.deepEqual(entries.filter((entry) => entry.body.includes('lifeShard:'))
        .map((entry) => [entry.shard, entry.body.match(/lifeShard: (\d+\/8)/)?.[1]]),
        Array.from({ length: 8 }, (_, index) => [index + 3, `${index + 1}/8`]));
    assert.deepEqual(entries.filter((entry) => entry.body.includes('groundProject:'))
        .map((entry) => [entry.shard, entry.body.match(/groundProject: (\w+)/)?.[1]]),
        [[5, 'desktop'], [7, 'phone']]);
    assert.deepEqual(entries.filter((entry) => entry.body.includes('dockProject:'))
        .map((entry) => [entry.shard, entry.body.match(/dockProject: (\w+)/)?.[1]]),
        [[11, 'desktop'], [12, 'phone']]);
    const steps = flows.split('      - name: ');
    const life = steps.find((step) => step.startsWith('Living sectors, weather and native actor routines\n'));
    const wildlife = steps.find((step) => step.startsWith('Pet-inspired ground wildlife and pause behavior\n'));
    const dock = steps.find((step) => step.startsWith('Dock shipment delivery and cached aftermath\n'));
    assert.ok(life?.includes('if: ${{ matrix.shard >= 3 && matrix.shard <= 10 }}'));
    assert.ok(wildlife?.includes('if: ${{ matrix.shard == 5 || matrix.shard == 7 }}'));
    assert.ok(dock?.includes('if: ${{ matrix.shard == 11 || matrix.shard == 12 }}'));
    assert.doesNotMatch(dock, /continue-on-error|--grep|--max-failures/);
    for (const [name, shard] of [['Painted terrain resource placement', 12], ['Chronicle stop and daytime handover', 11]]) {
        const step = steps.find((value) => value.startsWith(`${name}\n`));
        assert.ok(step?.includes(`if: \${{ matrix.shard == ${shard} }}`));
        assert.doesNotMatch(step, /continue-on-error|--project|--grep|--shard|--max-failures/);
    }
    assert.match(flows, /^    timeout-minutes: 29$/m);
});

test('living-world source fixtures have dedicated gates instead of running on the immutable preview',()=>{
    const flows=responsiveFlows();
    const playwrightConfig=readFileSync(new URL('../shinobij.client/playwright.config.ts',import.meta.url),'utf8');
    for(const name of ['sector-life','resource-surface','chronicle-stop','ground-wildlife','dock-shipment']){
        assert(playwrightConfig.includes(`**/${name}.spec.ts`),`${name} must be classified as a source fixture`);
        assert(flows.includes(`--config playwright.${name}.config.ts`),`${name} needs its own source server`);
    }
    assert.match(flows,/--config playwright\.sector-life\.config\.ts --fully-parallel --shard=\$\{\{ matrix\.lifeShard \}\} --forbid-only/);
    assert.match(flows,/groundProject: desktop/);
    assert.match(flows,/groundProject: phone/);
    assert.match(flows,/--config playwright\.ground-wildlife\.config\.ts --project=\$\{\{ matrix\.groundProject \}\} --forbid-only/);
    assert(flows.includes('output/living-world/wildlife/browser/'));
    assert.match(flows,/dockProject: desktop/);
    assert.match(flows,/dockProject: phone/);
    assert.match(flows,/--config playwright\.dock-shipment\.config\.ts --project=\$\{\{ matrix\.dockProject \}\} --forbid-only/);
    assert(flows.includes('output/living-world/shipment/browser/'));
    assert(playwrightConfig.includes('**/local-fauna.spec.ts'));
    const localFaunaConfig=readFileSync(new URL('../shinobij.client/playwright.sector-life.config.ts',import.meta.url),'utf8');
    assert(localFaunaConfig.includes('local-fauna.spec.ts'),'local lamp/shore fauna must run in the life shards');
    assert(localFaunaConfig.includes('regional-training.spec.ts'),'native training and cached crew closure must run in the life shards');
    assert(playwrightConfig.includes('**/regional-training.spec.ts'));
    assert(localFaunaConfig.includes('regional-winter.spec.ts'),'the supplied winter scene and cached protected departure must run in the life shards');
    assert(playwrightConfig.includes('**/regional-winter.spec.ts'));
    assert(localFaunaConfig.includes('shrine-work.spec.ts'),'the real keeper sweep and cached night closure must run in the life shards');
    assert(playwrightConfig.includes('**/shrine-work.spec.ts'));
    assert(localFaunaConfig.includes('shrine-traffic.spec.ts'),'cached shrine departure and independent next-wave arrival must run in the life shards');
    assert(playwrightConfig.includes('**/shrine-traffic.spec.ts'));
    assert(localFaunaConfig.includes('midlands-field.spec.ts'),'the actual painted field, courier circuit and missing-floor fallback must run in the life shards');
    assert(playwrightConfig.includes('**/midlands-field.spec.ts'));
    assert(localFaunaConfig.includes('festival-work.spec.ts'),'the staffed counter, paired square steps and cached closure must run in the life shards');
    assert(playwrightConfig.includes('**/festival-work.spec.ts'));
    assert(localFaunaConfig.includes('road-visits.spec.ts'));
    assert(playwrightConfig.includes('**/road-visits.spec.ts'));
    assert(localFaunaConfig.includes('frontier-work.spec.ts'));
    assert(playwrightConfig.includes('**/frontier-work.spec.ts'));
    assert(flows.includes('output/living-world/local-fauna/browser/'));
    assert(flows.includes('output/living-world/training/browser/'));
    assert(flows.includes('output/living-world/winter/browser/'));
    assert(flows.includes('output/living-world/leaf-work/browser/'));
    assert(flows.includes('output/living-world/shrine-traffic/browser/'));
    assert(flows.includes('output/living-world/field-work/browser/'));
    assert(flows.includes('output/living-world/festival/browser/'));
    assert(flows.includes('output/living-world/road-visits/browser/'));
    assert(flows.includes('output/living-world/frontier/browser/'));
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

test('the storage adapter meets a real Postgres, fails closed, and gates the compatibility aggregate', () => {
    // kv.compareSetMany carries every currency-moving save write, and its unit
    // tests drive only a JS shim of pg.Pool. This job is the one place the
    // adapter meets real jsonb equality, ON CONFLICT, FOR SHARE and rollback.
    assert.equal(occurrences('name: CI / pg-integration\n'), 1, 'CI / pg-integration must remain a unique stable check context');
    const job = workflow.split('\n  pg_integration:\n')[1]?.split(/\n  [a-z_]+:\n/)[0];
    assert.ok(job, 'the pg_integration job must exist');
    assert.match(job, /services:\n\s+postgres:\n\s+image: postgres:16\n/);
    assert.match(job, /--health-cmd "pg_isready /, 'no step may start before Postgres accepts connections');
    assert.match(job, /node-version-file: \.nvmrc/);
    const step = job.split('      - name: ').find((value) => value.includes('run: node --import tsx --test api/_storage-compare-set-many.pg-integration.test.ts'));
    assert.ok(step, 'the job must run the Postgres integration suite');
    assert.match(step, /PG_INTEGRATION_DATABASE_URL: postgresql:\/\/\S+@127\.0\.0\.1:5432\//);
    assert.match(step, /PG_INTEGRATION_REQUIRED: '1'/, 'a missing URL must fail the job instead of skipping every test');
    assert.match(step, /2>&1 \| tee \.ci-evidence\/pg-integration\//);
    assert.doesNotMatch(step, /continue-on-error/);
    assert.match(job, /name: Retain pg integration evidence\n\s+if: always\(\)/);
    const suite = readFileSync(new URL('../api/_storage-compare-set-many.pg-integration.test.ts', import.meta.url), 'utf8');
    for (const name of ['PG_INTEGRATION_DATABASE_URL', 'PG_INTEGRATION_REQUIRED']) {
        assert.ok(suite.includes(`process.env.${name}`), `the suite must read ${name}, the variable this job sets`);
    }
    // Required through the aggregate branch protection already lists, so it
    // gates merges without a protection change that could strand PRs at "Expected".
    const aggregate = workflow.split('\n  test_build:\n')[1];
    assert.match(aggregate, /needs:\n(?:\s+- \w+\n)*?\s+- pg_integration\n/, 'CI / test-build must wait for it');
    assert.ok(aggregate.includes('test "$PG_INTEGRATION" = success'), 'and must fail unless it succeeded');
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

test('live Express CI keeps the Exchange and sector-war player journeys isolated and evidenced', () => {
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const command = job.split('\n').find(line => line.trim().startsWith('run:') && line.includes('sunscar-exchange-express.spec.ts'));
    assert.ok(command, 'the required live Express job must execute the Exchange journey');
    assert.ok(command.includes('sector-war-express.spec.ts'), 'the same built release must execute the sector-war journey');
    assert.ok(command.includes('--project=chromium-desktop-live'));
    assert.ok(command.includes('--output=test-results/economy-war-journeys-ci'), 'the journey run must not overwrite earlier Playwright evidence');
    assert.ok(command.includes('.ci-evidence/e2e-village-stores/economy-war-journeys.log'));
});

test('required live Express CI runs the two-client sector presence journey on a realtime server of its own', () => {
    // It sat outside CI, so when the sector became the continuous world it broke
    // on main and nothing noticed. The spec refuses to run without realtime.
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const step = job.split('\n      - name: ').find(block => block.includes('connected-sector-presence.spec.ts'));
    assert.ok(step, 'the required live Express job must execute the two-client presence journey');
    const command = step.split('\n').find(line => line.trim().startsWith('run:'));
    assert.ok(command?.includes('connected-sector-presence.spec.ts'), 'the spec must be in the step command, not a comment');
    // The tavern push journey skips itself without realtime, so it is only a
    // gate while it rides this step's LIVE_E2E_REALTIME server.
    assert.ok(command.includes('tavern-chat-push.spec.ts'), 'the two-client tavern push journey must run on the realtime server');
    assert.match(step, /LIVE_E2E_REALTIME: '1'/, 'both clients need the real Socket.IO transport');
    assert.ok(command.includes('--project=chromium-desktop-live'), 'the desktop project runs a desktop mover and the spec\'s own phone observer');
    assert.ok(!command.includes('first-defeat-recovery-express.spec.ts'), 'it must not share a server with the recovery matrix');
    assert.ok(command.includes('--output=test-results/sector-presence-ci'), 'it must not overwrite earlier journey evidence');
    assert.ok(command.includes('.ci-evidence/e2e-village-stores/sector-presence.log'));
    assert.doesNotMatch(command, /--grep/);
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

test('required live Express CI runs defeat recovery on desktop and mobile without replacing earlier evidence', () => {
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const commands = job.split('\n').filter(line => line.trim().startsWith('run:') && line.includes('first-defeat-recovery-express.spec.ts'));
    assert.equal(commands.length, 2, 'both complete recovery projects must execute');
    for (const project of ['desktop', 'mobile']) {
        const command = commands.find(line => line.includes(`--project=chromium-${project}-live`));
        assert.ok(command, `${project} recovery must be covered`);
        assert.ok(command.includes(`--output=test-results/defeat-recovery-ci-${project}`), 'each invocation must retain earlier journey evidence');
        assert.ok(command.includes(`.ci-evidence/e2e-village-stores/defeat-recovery-${project}.log`));
        assert.doesNotMatch(command, /--grep/, 'all recovery paths must run');
    }
});

test('required live Express CI runs the hospital ward and roaming Weekly Boss journeys on a server of their own', () => {
    // Neither had browser coverage — which is how the roaming boss's "Stand &
    // Fight" shipped as a loop that never started a fight. Its own step means its
    // own server: recovery fixtures and these journeys must each respect the
    // 25 accounts per IP that registration allows in 15 minutes.
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const command = job.split('\n').find(line => line.trim().startsWith('run:') && line.includes('mmorpg-behaviors-express.spec.ts'));
    assert.ok(command, 'the required live Express job must execute the MMO behaviour spec');
    assert.ok(command.includes('--project=chromium-desktop-live') && command.includes('--project=chromium-mobile-live'));
    assert.ok(!command.includes('first-defeat-recovery-express.spec.ts'), 'it must not share a server with the recovery matrix');
    assert.ok(command.includes('--output=test-results/mmo-behaviors-ci'), 'it must not overwrite earlier journey evidence');
    assert.doesNotMatch(command, /--grep/);
});

test('required live Express CI binds a real wild companion on desktop and mobile', () => {
    // The journey sat outside CI, so when the sector became the continuous
    // world its tile click timed out on every run and nothing noticed.
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const command = job.split('\n').find(line => line.trim().startsWith('run:') && line.includes('wild-binding-express.spec.ts'));
    assert.ok(command, 'the required live Express job must execute the wild-binding journey');
    assert.ok(command.includes('--project=chromium-desktop-live') && command.includes('--project=chromium-mobile-live'));
    assert.ok(!command.includes('first-defeat-recovery-express.spec.ts'), 'it must not share a server with the recovery matrix');
    assert.doesNotMatch(command, /--grep/);
});

test('required live Express CI runs the Hollow Gate pet duel on desktop and mobile', () => {
    // The journey sat outside CI, so when PR #347 put hunting wanderers on the
    // first floor it failed 2 runs of 4 and nothing noticed for two days. A
    // retry would hide the next flake the same way.
    const job = workflow.slice(workflow.indexOf('\n  e2e_village_stores_matrix:'), workflow.indexOf('\n  test_build:'));
    const command = job.split('\n').find(line => line.trim().startsWith('run:') && line.includes('hollow-gate-pet-duel-express.spec.ts'));
    assert.ok(command, 'the required live Express job must execute the Hollow Gate pet duel');
    assert.ok(command.includes('--project=chromium-desktop-live') && command.includes('--project=chromium-mobile-live'));
    for (const flag of ['--workers=1', '--retries=0', '--forbid-only']) {
        assert.ok(command.includes(flag), `the Hollow Gate pet duel must run with ${flag}`);
    }
    assert.ok(!command.includes('first-defeat-recovery-express.spec.ts'), 'it must not share a server with the recovery matrix');
    assert.ok(command.includes('--output=test-results/hollow-gate-pet-duel-ci'), 'it must not overwrite earlier journey evidence');
    assert.ok(command.includes('.ci-evidence/e2e-village-stores/hollow-gate-pet-duel.log'));
    assert.doesNotMatch(command, /--grep/);
});

/*
 * The Node pin lives in exactly ONE place: .nvmrc.
 *
 * It used to live in six — ci.yml's env, three other workflows, and both
 * Dockerfile stages — while .nvmrc itself carried only the floating major `22`.
 * Nothing compared them, so the file a developer's version manager reads
 * disagreed with the version CI and Railway actually ran, and `engines: >=22`
 * silently welcomed anything newer. An operator drifted to Node 24 that way and
 * lost time to a note blaming the Node version for an unrelated failure.
 */
const workflowDir = new URL('../.github/workflows/', import.meta.url);
const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();

test('the Node pin is an exact version, not a floating major', () => {
    // A bare major resolves to whatever the local version manager happens to
    // have, which is not what CI installs — the drift this file exists to stop.
    assert.match(nvmrc, /^\d+\.\d+\.\d+$/, `.nvmrc must pin major.minor.patch, got "${nvmrc}"`);
});

test('every workflow takes its Node version from .nvmrc', () => {
    const files = readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
    assert.ok(files.length > 0, 'no workflow files found');
    for (const file of files) {
        const body = readFileSync(new URL(file, workflowDir), 'utf8').replace(/\r\n/g, '\n');
        // A literal here is the drift: it is invisible to .nvmrc and to every
        // version manager, so it goes stale the moment the pin moves.
        const literals = [...body.matchAll(/^\s*node-version:\s*(\S+)$/gm)].map((match) => match[1]);
        assert.deepEqual(literals, [], `${file} hardcodes a Node version (${literals.join(', ')}) instead of node-version-file: .nvmrc`);
        assert.doesNotMatch(body, /^\s*NODE_VERSION:/m, `${file} reintroduces a NODE_VERSION env copy of the pin`);
        if (body.includes('actions/setup-node')) {
            assert.match(body, /node-version-file: \.nvmrc/, `${file} sets up Node without reading .nvmrc`);
        }
    }
});

test('named forge and Chronicle packs run every dedicated project in required CI', () => {
    const flows = responsiveFlows();
    for (const [label, config, shard, log] of [
        ['Named forge purchase and recovery', 'playwright.named-forge.config.ts', 2, 'named-forge.log'],
        ['Chronicle pack purchase and recovery', 'playwright.chronicle-packs.config.ts', 2, 'chronicle-packs.log'],
        ['Rally renderer recovery', 'playwright.rally-recovery.config.ts', 2, 'rally-recovery.log'],
    ]) {
        const step = flows?.split('      - name: ').find(value => value.startsWith(`${label}\n`));
        assert.ok(step, `${label} must run in the required responsive job`);
        assert.ok(step.includes(`matrix.shard == ${shard}`));
        assert.ok(step.includes(`--config ${config} --retries=0 --forbid-only`));
        assert.ok(step.includes(log), 'retain the dedicated suite output');
        assert.doesNotMatch(step, /continue-on-error|--project|--grep|--shard/);
    }
});


test('responsive matrix schedules each slice exactly once with matching evidence and denominator', () => {
    const responsive = responsiveShards();
    const shards = JSON.parse(responsive.match(/shard: (\[[^\]]+\])/)?.[1]);
    const denominator = Number(responsive.match(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/)?.[1]);
    assert.deepEqual(shards, Array.from({length: denominator}, (_, index) => index + 1));
    assert.equal(denominator, 7);
    const evidenceTotals = [...responsive.matchAll(/-of-(\d+)/g)].map(match => Number(match[1]));
    assert.ok(evidenceTotals.length >= 8);
    assert.ok(evidenceTotals.every(total => total === denominator));
    assert.doesNotMatch(responsive, /--grep|--project|--max-failures/, 'splitting must retain the complete browser suite');
});

test('live Express sharding preserves ten exclusive invocations and a fail-closed stable aggregate', () => {
 const matrix=workflow.split('  e2e_village_stores_matrix:\n')[1]?.split('\n  e2e_village_stores:')[0];
 assert.ok(matrix);assert.match(matrix,/shard: \[1, 2, 3\]/);assert.match(matrix,/fail-fast: false/);
 const steps=matrix.split('      - name: ').filter(step=>step.includes('run: npm run test:e2e:live'));
 assert.equal(steps.length,10);const groups=steps.map(step=>Number(step.match(/if: \$\{\{ matrix\.shard == ([123]) \}\}/)?.[1]));
 assert.deepEqual(groups,[1,1,2,3,3,3,2,3,3,3]);for(const step of steps)assert.doesNotMatch(step,/continue-on-error|--grep|--shard|--max-failures/);
 assert.match(matrix,/name: evidence-e2e-village-stores-\$\{\{ matrix\.shard \}\}-of-3/);
 const aggregate=workflow.split('  e2e_village_stores:\n')[1]?.split('\n  test_build:')[0];assert.ok(aggregate);
 assert.match(aggregate,/needs: e2e_village_stores_matrix/);assert.ok(aggregate.includes('if: ${{ always() }}'));assert.ok(aggregate.includes('test "$VILLAGE_SHARDS" = success'));
 assert.match(workflow.split('  test_build:\n')[1],/- e2e_village_stores\n/);
});
