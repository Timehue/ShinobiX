#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_RAILWAY_DEPLOYMENT = Object.freeze({
  numReplicas: 1,
  startCommand: 'node dist/server.js',
});

export function deploymentConfigErrors(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['railway.json must contain an object'];
  }
  if (config.deploy?.numReplicas !== REQUIRED_RAILWAY_DEPLOYMENT.numReplicas) {
    errors.push(`deploy.numReplicas must be exactly ${REQUIRED_RAILWAY_DEPLOYMENT.numReplicas}`);
  }
  if (config.deploy?.startCommand !== REQUIRED_RAILWAY_DEPLOYMENT.startCommand) {
    errors.push(`deploy.startCommand must be exactly "${REQUIRED_RAILWAY_DEPLOYMENT.startCommand}"`);
  }
  if (config.build?.builder !== 'DOCKERFILE' || config.build?.dockerfilePath !== 'Dockerfile') {
    errors.push('build must use the repository Dockerfile');
  }
  return errors;
}

export async function checkRepositoryDeploymentConfig() {
  const path = fileURLToPath(new URL('../railway.json', import.meta.url));
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return {
      passed: false,
      path,
      errors: [`railway.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const errors = deploymentConfigErrors(config);
  return { passed: errors.length === 0, path, errors };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await checkRepositoryDeploymentConfig();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'shinobix.railway-config-check.v1',
    ...result,
    required: REQUIRED_RAILWAY_DEPLOYMENT,
  }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}
