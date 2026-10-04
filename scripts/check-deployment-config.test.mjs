import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  RAILWAY_DEPLOY_TYPES,
  checkRepositoryDeploymentConfig,
  deploymentConfigErrors,
} from './check-deployment-config.mjs';

const valid = {
  build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
  deploy: { numReplicas: 1, startCommand: 'node dist/server.js', healthcheckPath: '/health', drainingSeconds: 60 },
};

test('repository Railway deployment remains single-instance and starts built server', async () => {
  const result = await checkRepositoryDeploymentConfig();
  assert.deepEqual(result.errors, []);
  assert.equal(result.passed, true);
});

test('deployment config rejects replica drift and source-server start commands', () => {
  assert.deepEqual(deploymentConfigErrors(valid), []);
  assert.match(
    deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, numReplicas: 2 } })[0],
    /numReplicas must be exactly 1/,
  );
  assert.match(
    deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, startCommand: 'tsx server.ts' } })[0],
    /node dist\/server\.js/,
  );
});

test('deployment config requires the unauthenticated shallow health endpoint', () => {
  const errors = deploymentConfigErrors({
    ...valid,
    deploy: { ...valid.deploy, healthcheckPath: '/health/db' },
  });
  assert.match(errors.join(' '), /healthcheckPath must be exactly "\/health"/);
});

test('deployment config rejects absent, disabled, invalid and insufficient shutdown grace', () => {
  for (const drainingSeconds of [undefined, null, false, [60], {}, '', 0, 50, 59, 60.5, NaN, Infinity, '0', '60', '90']) {
    const errors = deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, drainingSeconds } });
    assert.match(errors.join(' '), /drainingSeconds must allow at least 60 seconds/, `drainingSeconds ${String(drainingSeconds)}`);
  }
  assert.deepEqual(deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, drainingSeconds: 90 } }), []);
});

test('a quoted number is refused, because Railway refuses the whole config for one', () => {
  // The exact railway.json that failed every deploy from 2026-10-03 at
  // initialization: "deploy.drainingSeconds: Invalid input: expected number,
  // received string".
  assert.match(
    deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, drainingSeconds: '60' } }).join(' '),
    /deploy\.drainingSeconds must be a JSON number/,
  );
  const wrong = { integer: '1', number: '1', boolean: 'true', string: 1 };
  for (const [key, type] of Object.entries(RAILWAY_DEPLOY_TYPES)) {
    const errors = deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, [key]: wrong[type] } });
    assert.ok(
      errors.some((error) => error.startsWith(`deploy.${key} must be a JSON ${type}`)),
      `deploy.${key} = ${JSON.stringify(wrong[type])} must be refused: ${errors.join('; ')}`,
    );
  }
  assert.match(
    deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, preDeployTimeoutSeconds: 1.5 } }).join(' '),
    /deploy\.preDeployTimeoutSeconds must be a JSON integer/,
  );
  // Railway's schema allows null, or the setting left out, for each of them.
  for (const key of ['healthcheckTimeout', 'overlapSeconds', 'sleepApplication', 'region']) {
    assert.deepEqual(deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, [key]: null } }), []);
  }
  assert.deepEqual(
    deploymentConfigErrors({ ...valid, deploy: { ...valid.deploy, healthcheckTimeout: 120, restartPolicyMaxRetries: 10 } }),
    [],
  );
});

test('deployment config requires the repository Dockerfile', () => {
  assert.match(
    deploymentConfigErrors({ ...valid, build: { builder: 'NIXPACKS' } })[0],
    /repository Dockerfile/,
  );
});

test('Docker build and runtime use the exact Node release pinned in .nvmrc', async () => {
  // .nvmrc is the single source of truth: every workflow reads it through
  // `node-version-file`, and so do local dev and scripts/run-tests.mjs. A `FROM`
  // line cannot read a file, so the Dockerfile must repeat the version — and
  // that repetition is now the ONLY place drift can start. CI building on one
  // Node while Railway runs another is the failure this forecloses; before this
  // gate the version was copied into six files and .nvmrc disagreed with all of
  // them by carrying a floating major.
  const [dockerfile, pinned] = await Promise.all([
    readFile('Dockerfile', 'utf8'),
    readFile('.nvmrc', 'utf8'),
  ]);
  const expected = `node:${pinned.trim()}-bookworm-slim`;
  const images = [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+)\s+AS\s+(builder|runtime)$/gm)];
  assert.deepEqual(images.map((m) => [m[2], m[1]]), [
    ['builder', expected],
    ['runtime', expected],
  ]);
});

test('Railway exports the large client bundle as bounded portable layers', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  const clientBuild = await readFile('scripts/build-client.mjs', 'utf8');
  const clientLayers = [...dockerfile.matchAll(
    /^COPY --from=builder \/runtime-client\/(\d{2})\/ \.\/$/gm,
  )];

  assert.equal(clientLayers.length, 6);
  assert.deepEqual(clientLayers.map((match) => match[1]), ['01', '02', '03', '04', '05', '06']);
  assert.doesNotMatch(dockerfile, /--mount=type=cache/);
  assert.doesNotMatch(dockerfile, /COPY --link/);
  assert.doesNotMatch(dockerfile, /^# syntax=/m);
  assert.match(dockerfile, /SHINOBIX_CLIENT_DEPS_PREINSTALLED=1/);
  assert.match(clientBuild, /SHINOBIX_CLIENT_DEPS_PREINSTALLED === '1'/);
  assert.match(clientBuild, /!dependenciesPreinstalled && \(process\.env\.CI/);
});

test('Railway excludes test and review evidence from the Docker build context', async () => {
  const dockerignore = await readFile('.dockerignore', 'utf8');
  for (const pattern of [
    'docs',
    'release-audit',
    '**/*.test.*',
    '**/*.spec.*',
    'shinobij.client/e2e*',
    'shinobij.client/art-references',
    '**/test-results',
    '**/playwright-report',
    '**/.tmp',
    '.ci-evidence',
    '.ci-artifacts',
  ]) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(pattern),
      `.dockerignore must exclude ${pattern}`,
    );
  }
});

test('Railway Docker build can receive every client analytics gate', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  for (const name of [
    'VITE_PRODUCT_ANALYTICS_ENABLED',
    'VITE_PRODUCT_ANALYTICS_PROVIDER',
    'VITE_POSTHOG_KEY',
    'VITE_POSTHOG_HOST',
  ]) {
    assert.match(dockerfile, new RegExp(`^ARG ${name}=""$`, 'm'));
    assert.match(dockerfile, new RegExp(`${name}=\\$${name}`));
  }
});

test('production image gate reproduces every Railway client build argument', async () => {
  const workflow = await readFile('.github/workflows/production-image.yml', 'utf8');
  for (const name of [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SENTRY_DSN',
    'VITE_SENTRY_RELEASE',
    'VITE_BUILD_COMMIT',
    'VITE_PRODUCT_ANALYTICS_ENABLED',
    'VITE_PRODUCT_ANALYTICS_PROVIDER',
    'VITE_POSTHOG_KEY',
    'VITE_POSTHOG_HOST',
  ]) {
    assert.match(workflow, new RegExp(`^\\s+${name}: \\S`, 'm'));
    assert.match(workflow, new RegExp(`--build-arg ${name}\\b`));
  }
});
