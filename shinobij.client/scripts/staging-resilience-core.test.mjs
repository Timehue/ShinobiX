import assert from 'node:assert/strict';
import test from 'node:test';
import { appOriginFingerprint } from '../../scripts/lib/maintenance-guards.mjs';
import {
  assertRestarted,
  durableSaveFingerprint,
  loadStagingResilienceConfig,
  playerLabel,
} from './staging-resilience-core.mjs';

function validEnv(overrides = {}) {
  return {
    SHINOBIX_DEPLOYMENT_TIER: 'staging',
    RESILIENCE_TARGET_URL: 'https://staging.example.test',
    RESILIENCE_CONFIRM_TARGET_HOST: 'staging.example.test',
    RESILIENCE_DENY_HOSTS: 'play.example.test',
    RESILIENCE_DISPOSABLE_SCENARIO: '1',
    RESILIENCE_PLAYER_A_NAME: 'stage-alpha',
    RESILIENCE_PLAYER_A_TOKEN: 'token-alpha',
    RESILIENCE_PLAYER_B_NAME: 'stage-bravo',
    RESILIENCE_PLAYER_B_TOKEN: 'token-bravo',
    RESILIENCE_MUTATION_CONFIRM: 'DISPOSABLE:stage-alpha:stage-bravo@staging.example.test',
    RESILIENCE_HEALTH_TOKEN: 'deep-health-token',
    STAGING_APP_FINGERPRINT: appOriginFingerprint('https://staging.example.test'),
    PRODUCTION_APP_FINGERPRINTS: appOriginFingerprint('https://play.example.test'),
    ...overrides,
  };
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail('expected an error');
}

test('staging resilience config requires an exact non-production target and two disposable identities', () => {
  const config = loadStagingResilienceConfig(validEnv());
  assert.equal(config.target.origin, 'https://staging.example.test');
  assert.equal(config.players.length, 2);
  assert.equal(config.runRestart, false);
  assert.ok(config.playerLabels.every((label) => /^[a-f0-9]{16}$/.test(label)));
  assert.equal(config.targetFingerprint, appOriginFingerprint('https://staging.example.test'));

  assert.throws(() => loadStagingResilienceConfig(validEnv({ SHINOBIX_DEPLOYMENT_TIER: '' })), /DEPLOYMENT_TIER=staging/);
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_CONFIRM_TARGET_HOST: '' })), /CONFIRM_TARGET_HOST/);
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_TARGET_URL: 'https://play.example.test', RESILIENCE_CONFIRM_TARGET_HOST: 'play.example.test' })), /production host/i);
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_DISPOSABLE_SCENARIO: '0' })), /disposable staging accounts/i);
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_PLAYER_B_NAME: 'stage-alpha' })), /different accounts/i);
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_PLAYER_B_TOKEN: 'token-alpha' })), /independently issued/i);
  const badConfirmation = captureError(
    () => loadStagingResilienceConfig(validEnv({ RESILIENCE_MUTATION_CONFIRM: 'yes' })),
  );
  assert.match(badConfirmation.message, /MUTATION_CONFIRM/);
  assert.doesNotMatch(badConfirmation.message, /stage-alpha|stage-bravo|token-alpha|token-bravo/i);
});

test('staging resilience binds the target origin to mandatory allow and production-deny fingerprints', () => {
  assert.throws(
    () => loadStagingResilienceConfig(validEnv({ STAGING_APP_FINGERPRINT: '' })),
    /STAGING_APP_FINGERPRINT/,
  );
  assert.throws(
    () => loadStagingResilienceConfig(validEnv({ PRODUCTION_APP_FINGERPRINTS: '' })),
    /PRODUCTION_APP_FINGERPRINTS/,
  );
  assert.throws(
    () => loadStagingResilienceConfig(validEnv({
      PRODUCTION_APP_FINGERPRINTS: appOriginFingerprint('https://staging.example.test'),
    })),
    /production fingerprint deny set/,
  );
});

test('restart mode needs a second exact acknowledgement and dedicated secret', () => {
  assert.throws(() => loadStagingResilienceConfig(validEnv({ RESILIENCE_RUN_RESTART: '1' })), /RESTART_TOKEN/);
  const badRestartConfirmation = captureError(() => loadStagingResilienceConfig(validEnv({
    RESILIENCE_RUN_RESTART: '1', RESILIENCE_RESTART_TOKEN: 'restart', RESILIENCE_RESTART_CONFIRM: 'wrong',
  })));
  assert.match(badRestartConfirmation.message, /RESTART_CONFIRM/);
  assert.doesNotMatch(badRestartConfirmation.message, /stage-alpha|stage-bravo|token-alpha|token-bravo/i);
  const config = loadStagingResilienceConfig(validEnv({
    RESILIENCE_RUN_RESTART: '1',
    RESILIENCE_RESTART_TOKEN: 'restart',
    RESILIENCE_RESTART_CONFIRM: 'RESTART:staging.example.test',
  }));
  assert.equal(config.runRestart, true);
});

test('durable save fingerprint ignores runtime vitals but catches economy, inventory, pets, and version drift', () => {
  const base = {
    _saveVersion: 7,
    currentSector: 40,
    character: {
      name: 'Stage-Alpha', level: 3, village: 'Ember', ryo: 200,
      hp: 50, chakra: 10, stamina: 5,
      inventory: ['kunai'], equipment: {}, pets: [{ id: 'pet-1', level: 2 }],
    },
  };
  const fingerprint = durableSaveFingerprint(base);
  assert.equal(durableSaveFingerprint({ ...base, character: { ...base.character, hp: 99, chakra: 99, stamina: 99 } }), fingerprint);
  assert.notEqual(durableSaveFingerprint({ ...base, character: { ...base.character, ryo: 201 } }), fingerprint);
  assert.notEqual(durableSaveFingerprint({ ...base, character: { ...base.character, inventory: [] } }), fingerprint);
  assert.notEqual(durableSaveFingerprint({ ...base, _saveVersion: 8 }), fingerprint);
  assert.notEqual(durableSaveFingerprint({ ...base, character: { ...base.character, pets: [] } }), fingerprint);
  assert.equal(playerLabel('Stage-Alpha'), playerLabel('stage-alpha'));
});

test('restart evidence requires a new worker on the same release', () => {
  assert.equal(assertRestarted(
    { ok: true, commit: 'abcdef123', startedAt: '2026-08-10T00:00:00.000Z' },
    { ok: true, commit: 'abcdef123', startedAt: '2026-08-10T00:01:00.000Z' },
  ), true);
  assert.throws(() => assertRestarted(
    { ok: true, commit: 'abcdef123', startedAt: 'same' },
    { ok: true, commit: 'abcdef123', startedAt: 'same' },
  ), /did not change/i);
  assert.throws(() => assertRestarted(
    { ok: true, commit: 'abcdef123', startedAt: 'one' },
    { ok: true, commit: '999999999', startedAt: 'two' },
  ), /commit changed/i);
});
