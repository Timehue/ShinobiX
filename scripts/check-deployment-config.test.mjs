import assert from 'node:assert/strict';
import test from 'node:test';
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
