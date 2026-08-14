import assert from 'node:assert/strict';
import test from 'node:test';
import {
    INTEGRITY_REPAIR_CONFIRMATION,
    PATREON_SMOKE_CONFIRMATION,
    assertIntegrityInvocation,
    assertPatreonSmokeInvocation,
    appOriginFingerprint,
    hasExternalStorageCredentials,
    presentCredentialNames,
    redactMaintenanceError,
    selectedStorageIdentity,
} from './maintenance-guards.mjs';

function stagingStorageEnv(extra = {}) {
    const env = {
        SHINOBIX_DEPLOYMENT_TIER: 'staging',
        DATABASE_URL: 'postgres://user:secret@staging-db.example.test:5432/shinobi_staging',
        PRODUCTION_STORAGE_FINGERPRINTS: '0123456789abcdef0123',
        ...extra,
    };
    env.STAGING_STORAGE_FINGERPRINT = selectedStorageIdentity(env).fingerprint;
    return env;
}

function stagingAppEnv(extra = {}) {
    const env = {
        SHINOBIX_DEPLOYMENT_TIER: 'staging',
        STAGING_BASE_URL: 'https://staging.example.test',
        STAGING_APP_FINGERPRINT: appOriginFingerprint('https://staging.example.test'),
        PRODUCTION_APP_FINGERPRINTS: 'abcdef0123456789abcd',
        ...extra,
    };
    return env;
}

test('external storage is detected by presence without exposing values', () => {
    assert.equal(hasExternalStorageCredentials({}), false);
    assert.equal(hasExternalStorageCredentials({ DATABASE_URL: 'postgres://secret' }), true);
    assert.deepEqual(
        presentCredentialNames({ A: 'secret', B: '', C: 'configured' }, ['A', 'B', 'C']),
        ['A', 'C'],
    );
});

test('integrity scans fail closed for production labels and implicit external targets', () => {
    assert.throws(
        () => assertIntegrityInvocation(['--target=production'], {}),
        /production is intentionally unsupported/,
    );
    assert.throws(
        () => assertIntegrityInvocation([], { DATABASE_URL: 'postgres://secret' }),
        /explicit --target=staging/,
    );
    assert.deepEqual(assertIntegrityInvocation([], {}).target, 'local');
});

test('integrity repair requires three independent staging acknowledgements', () => {
    const env = stagingStorageEnv();
    const argv = [
        '--repair',
        '--target=staging',
        `--confirm-storage=${env.STAGING_STORAGE_FINGERPRINT}`,
        `--confirm-additive-repair=${INTEGRITY_REPAIR_CONFIRMATION}`,
    ];
    assert.throws(() => assertIntegrityInvocation(argv, {}), /DEPLOYMENT_TIER=staging/);
    assert.throws(
        () => assertIntegrityInvocation(argv, env),
        /ALLOW_STAGING_INTEGRITY_REPAIR=1/,
    );
    const parsed = assertIntegrityInvocation(argv, { ...env, ALLOW_STAGING_INTEGRITY_REPAIR: '1' });
    assert.equal(parsed.repair, true);
});

test('storage confirmation binds host/database identity and rejects the production deny set', () => {
    const env = stagingStorageEnv();
    assert.throws(
        () => assertIntegrityInvocation(['--target=staging'], env),
        /--confirm-storage/,
    );
    assert.throws(
        () => assertIntegrityInvocation(
            ['--target=staging', `--confirm-storage=${env.STAGING_STORAGE_FINGERPRINT}`],
            { ...env, PRODUCTION_STORAGE_FINGERPRINTS: env.STAGING_STORAGE_FINGERPRINT },
        ),
        /production deny set/,
    );
    assert.throws(
        () => assertIntegrityInvocation(
            ['--target=staging', `--confirm-storage=${env.STAGING_STORAGE_FINGERPRINT}`],
            { ...env, DATABASE_URL: 'postgres://user:secret@different-db.example.test/shinobi_staging' },
        ),
        /does not match STAGING_STORAGE_FINGERPRINT/,
    );
    assert.throws(
        () => assertIntegrityInvocation(
            ['--target=staging', `--confirm-storage=${env.STAGING_STORAGE_FINGERPRINT}`],
            { ...env, PRODUCTION_STORAGE_FINGERPRINTS: '' },
        ),
        /must contain the canonical production storage identity/,
    );
});

test('storage confirmation distinguishes Supabase projects sharing one pooler', () => {
    const shared = 'aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    const production = selectedStorageIdentity({
        DATABASE_URL: `postgres://postgres.productionref1:secret@${shared}`,
    }).fingerprint;
    const stagingEnv = stagingStorageEnv({
        DATABASE_URL: `postgres://postgres.stagingref1234:secret@${shared}`,
        PRODUCTION_STORAGE_FINGERPRINTS: production,
    });
    assert.notEqual(stagingEnv.STAGING_STORAGE_FINGERPRINT, production);
    assert.equal(
        assertIntegrityInvocation(
            ['--target=staging', `--confirm-storage=${stagingEnv.STAGING_STORAGE_FINGERPRINT}`],
            stagingEnv,
        ).target,
        'staging',
    );
    assert.throws(
        () => selectedStorageIdentity({ DATABASE_URL: `postgres://postgres:secret@${shared}` }),
        /project discriminator/i,
    );
});

test('Patreon preflight is read-only but fixture execution needs explicit staging guards', () => {
    const appEnv = stagingAppEnv();
    const appArgs = ['--target=staging', `--confirm-app=${appEnv.STAGING_APP_FINGERPRINT}`];
    assert.equal(
        assertPatreonSmokeInvocation(appArgs, appEnv).executeFixtures,
        false,
    );
    const storageEnv = stagingStorageEnv();
    const argv = [
        ...appArgs,
        '--execute-fixtures',
        `--confirm-storage=${storageEnv.STAGING_STORAGE_FINGERPRINT}`,
        `--confirm-fixtures=${PATREON_SMOKE_CONFIRMATION}`,
    ];
    assert.throws(
        () => assertPatreonSmokeInvocation(argv, appEnv),
        /storage credentials/,
    );
    const parsed = assertPatreonSmokeInvocation(argv, {
        ...appEnv,
        ...storageEnv,
        ALLOW_STAGING_PATREON_SMOKE: '1',
    });
    assert.equal(parsed.executeFixtures, true);
});

test('Patreon staging preflight hard-denies canonical live hosts', () => {
    const env = stagingAppEnv({ STAGING_BASE_URL: 'https://shinobijourney.com' });
    env.STAGING_APP_FINGERPRINT = appOriginFingerprint(env.STAGING_BASE_URL);
    assert.throws(
        () => assertPatreonSmokeInvocation(
            ['--target=staging', `--confirm-app=${env.STAGING_APP_FINGERPRINT}`],
            env,
        ),
        /canonical production host/,
    );
});

test('maintenance errors redact target identity, credentials, and player names', () => {
    const databaseUrl = 'postgres://operator:super-secret@private-db.example.test:5432/shinobi_staging';
    const message = redactMaintenanceError(
        new Error(`Bearer abcdefghijk failed for save:RealPlayer at private-db.example.test/shinobi_staging?token=abcdefghi`),
        { sensitiveValues: [databaseUrl, 'abcdefghijk'] },
    );
    assert.doesNotMatch(message, /RealPlayer|private-db|shinobi_staging|abcdefghijk|abcdefghi/);
    assert.match(message, /save:\[REDACTED\]/);
    assert.match(message, /Bearer \[REDACTED\]/);

    const fixture = redactMaintenanceError(new Error('save:qa-pat-123456789abc-base cleanup failed'));
    assert.doesNotMatch(fixture, /qa-pat|123456789abc/);
});
