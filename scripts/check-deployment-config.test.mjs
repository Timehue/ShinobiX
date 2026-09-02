import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  checkRepositoryDeploymentConfig,
  deploymentConfigErrors,
} from './check-deployment-config.mjs';

const valid = {
  build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
  deploy: { numReplicas: 1, startCommand: 'node dist/server.js', healthcheckPath: '/health' },
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

test('deployment config requires the repository Dockerfile', () => {
  assert.match(
    deploymentConfigErrors({ ...valid, build: { builder: 'NIXPACKS' } })[0],
    /repository Dockerfile/,
  );
});

test('Docker build and runtime use the pinned Node 22 release toolchain', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  const images = [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+)\s+AS\s+(builder|runtime)$/gm)];
  assert.deepEqual(images.map((m) => [m[2], m[1]]), [
    ['builder', 'node:22.23.1-bookworm-slim'],
    ['runtime', 'node:22.23.1-bookworm-slim'],
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
