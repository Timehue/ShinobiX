#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_RAILWAY_DEPLOYMENT = Object.freeze({
  numReplicas: 1,
  startCommand: 'node dist/server.js',
  healthcheckPath: '/health',
  minDrainingSeconds: 60,
});

// The JSON type Railway's schema (https://railway.com/railway.schema.json)
// gives each deploy setting. Railway does not coerce: one setting of the wrong
// type makes it refuse the whole service config, before it builds anything.
// A quoted "60" for drainingSeconds failed every deploy from 2026-10-03 with
// "deploy.drainingSeconds: Invalid input: expected number, received string".
export const RAILWAY_DEPLOY_TYPES = Object.freeze({
  numReplicas: 'integer',
  preDeployTimeoutSeconds: 'integer',
  healthcheckTimeout: 'number',
  restartPolicyMaxRetries: 'number',
  overlapSeconds: 'number',
  drainingSeconds: 'number',
  sleepApplication: 'boolean',
  ipv6EgressEnabled: 'boolean',
  startCommand: 'string',
  healthcheckPath: 'string',
  runtime: 'string',
  cronSchedule: 'string',
  region: 'string',
  requiredMountPath: 'string',
});

function hasJsonType(value, type) {
  return type === 'integer' ? Number.isInteger(value) : typeof value === type;
}

export function deploymentConfigErrors(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['railway.json must contain an object'];
  }
  for (const [key, type] of Object.entries(RAILWAY_DEPLOY_TYPES)) {
    const value = config.deploy?.[key];
    // Railway's schema allows null, or the setting left out, for every one.
    if (value !== undefined && value !== null && !hasJsonType(value, type)) {
      errors.push(`deploy.${key} must be a JSON ${type}, not ${JSON.stringify(value)}: Railway refuses the whole config otherwise`);
    }
  }
  if (config.deploy?.numReplicas !== REQUIRED_RAILWAY_DEPLOYMENT.numReplicas) {
    errors.push(`deploy.numReplicas must be exactly ${REQUIRED_RAILWAY_DEPLOYMENT.numReplicas}`);
  }
  if (config.deploy?.startCommand !== REQUIRED_RAILWAY_DEPLOYMENT.startCommand) {
    errors.push(`deploy.startCommand must be exactly "${REQUIRED_RAILWAY_DEPLOYMENT.startCommand}"`);
  }
  if (config.deploy?.healthcheckPath !== REQUIRED_RAILWAY_DEPLOYMENT.healthcheckPath) {
    errors.push(`deploy.healthcheckPath must be exactly "${REQUIRED_RAILWAY_DEPLOYMENT.healthcheckPath}"`);
  }
  const drainingSeconds = config.deploy?.drainingSeconds;
  if (!Number.isSafeInteger(drainingSeconds) || drainingSeconds < REQUIRED_RAILWAY_DEPLOYMENT.minDrainingSeconds) {
    errors.push(`deploy.drainingSeconds must allow at least ${REQUIRED_RAILWAY_DEPLOYMENT.minDrainingSeconds} seconds for graceful shutdown`);
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
