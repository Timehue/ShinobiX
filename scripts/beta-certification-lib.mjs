import { basename, resolve } from 'node:path';

export const REQUIRED_JOURNEY_STEPS = Object.freeze([
  'register', 'login', 'character-create', 'first-save', 'reload', 'intro-academy',
  'starter-companion', 'stat-training', 'jutsu-equip', 'item-equip', 'academy-spar',
  'hospital-heal', 'first-reward', 'logbook', 'sector-enter', 'village-return',
  'logout', 'login-again', 'final-restore-check',
]);

export const REQUIRED_SAFETY_CHECKS = Object.freeze([
  'duplicate-reward', 'wrong-account', 'expired-token', 'retry-idempotency',
]);

const REQUIRED_FINAL_STATE = Object.freeze([
  'progression', 'inventory', 'training', 'companion', 'missionState', 'position', 'currencies',
]);

const SAFE_EVIDENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/;

export function betaCertificationEvidencePath(fileName, root = process.cwd()) {
  const safeFile = String(fileName ?? '');
  if (!SAFE_EVIDENCE_FILE.test(safeFile) || basename(safeFile) !== safeFile) {
    throw new Error('Pass a JSON filename stored under release-audit/evidence (no path separators).');
  }
  return resolve(root, 'release-audit', 'evidence', safeFile);
}

export function validateBetaCertification(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Certification evidence must be a JSON object.'];
  if (input.schemaVersion !== 'shinobix.beta-certification.v1') errors.push('schemaVersion must be shinobix.beta-certification.v1.');
  if (!['staging', 'isolated-test'].includes(input.environment?.kind)) errors.push('environment.kind must be staging or isolated-test.');
  if (input.account?.dedicatedTestRecord !== true) errors.push('account.dedicatedTestRecord must be true.');
  if (!String(input.account?.marker ?? '').startsWith('beta-cert-')) errors.push('account.marker must start with beta-cert-.');
  if (!String(input.deployment?.commit ?? '').match(/^[0-9a-f]{7,40}$/i)) errors.push('deployment.commit must be a git commit SHA.');
  if (input.deployment?.saveStore !== 'base-store') errors.push('deployment.saveStore must be base-store.');

  const steps = new Map((Array.isArray(input.steps) ? input.steps : []).map((step) => [step?.id, step]));
  for (const id of REQUIRED_JOURNEY_STEPS) {
    const step = steps.get(id);
    if (!step) errors.push(`Missing journey step: ${id}.`);
    else if (step.status !== 'pass') errors.push(`Journey step ${id} did not pass.`);
    else if (!step.requestId && ['first-save', 'first-reward'].includes(id)) errors.push(`Journey step ${id} requires a requestId.`);
  }

  const checks = new Map((Array.isArray(input.safetyChecks) ? input.safetyChecks : []).map((check) => [check?.id, check]));
  for (const id of REQUIRED_SAFETY_CHECKS) {
    const check = checks.get(id);
    if (!check) errors.push(`Missing safety check: ${id}.`);
    else if (check.status !== 'pass') errors.push(`Safety check ${id} did not pass.`);
  }

  const finalState = input.finalState;
  if (!finalState || typeof finalState !== 'object' || Array.isArray(finalState)) {
    errors.push('finalState is required.');
  } else {
    for (const key of REQUIRED_FINAL_STATE) if (!(key in finalState)) errors.push(`finalState.${key} is required.`);
    if (!Number.isInteger(finalState.saveVersion) || finalState.saveVersion < 1) errors.push('finalState.saveVersion must be a positive integer.');
  }
  if (input.account?.cleanupStatus === 'unknown') errors.push('account.cleanupStatus must be retained-and-labeled or deleted.');
  return errors;
}
