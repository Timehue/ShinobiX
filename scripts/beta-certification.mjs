#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateBetaCertification } from './beta-certification-lib.mjs';

const evidencePath = process.argv[2];
if (!evidencePath) {
  process.stderr.write('Usage: npm run beta:certify -- path/to/beta-certification.json\n');
  process.exit(2);
}

try {
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const errors = validateBetaCertification(evidence);
  const output = {
    schemaVersion: 'shinobix.beta-certification-result.v1',
    passed: errors.length === 0,
    evidencePath,
    deployment: evidence.deployment ?? null,
    accountMarker: evidence.account?.marker ?? null,
    completedSteps: Array.isArray(evidence.steps) ? evidence.steps.filter((step) => step?.status === 'pass').length : 0,
    safetyChecks: Array.isArray(evidence.safetyChecks) ? evidence.safetyChecks.filter((check) => check?.status === 'pass').length : 0,
    errors,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`[beta-certification] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
