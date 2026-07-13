import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  checkRepositoryDeploymentConfig,
  deploymentConfigErrors,
} from './check-deployment-config.mjs';

const valid = {
  build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
  deploy: { numReplicas: 1, startCommand: 'node dist/server.js' },
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
