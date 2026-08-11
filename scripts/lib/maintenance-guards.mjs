import { createHash } from 'node:crypto';
import { databaseConnectionFingerprint } from './database-identity.mjs';

const EXTERNAL_STORAGE_KEYS = [
    'DATABASE_URL',
    'SUPABASE_POSTGRES_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
];
const CANONICAL_PRODUCTION_APP_HOSTS = new Set([
    'shinobijourney.com',
    'www.shinobijourney.com',
    'theravensark.com',
    'www.theravensark.com',
]);

export const INTEGRITY_REPAIR_CONFIRMATION = 'ADD_SIDE_CARS_ONLY';
export const PATREON_SMOKE_CONFIRMATION = 'CREATE_DISPOSABLE_PATREON_FIXTURES';

function valueFor(argv, prefix) {
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? '';
}

export function hasExternalStorageCredentials(env = process.env) {
    return EXTERNAL_STORAGE_KEYS.some((key) => String(env[key] ?? '').trim().length > 0);
}

export function deploymentTier(env = process.env) {
    return String(env.SHINOBIX_DEPLOYMENT_TIER ?? '').trim().toLowerCase();
}

export function parseMaintenanceArgs(argv = process.argv.slice(2)) {
    return {
        target: valueFor(argv, '--target=').trim().toLowerCase() || 'local',
        repair: argv.includes('--repair'),
        executeFixtures: argv.includes('--execute-fixtures'),
        integrityConfirmation: valueFor(argv, '--confirm-additive-repair='),
        patreonConfirmation: valueFor(argv, '--confirm-fixtures='),
        storageConfirmation: valueFor(argv, '--confirm-storage=').trim().toLowerCase(),
        appConfirmation: valueFor(argv, '--confirm-app=').trim().toLowerCase(),
    };
}

function fingerprint(value) {
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

function parsedUrl(raw, label) {
    try {
        return new URL(String(raw));
    } catch {
        throw new Error(`${label} is not a valid URL; no target was accessed.`);
    }
}

export function selectedStorageIdentity(env = process.env) {
    if (env.SHINOBIX_QA_MEMORY_KV === '1') return { kind: 'memory', fingerprint: fingerprint('memory:qa') };
    const onVercel = Boolean(env.VERCEL);
    const forcePg = env.FORCE_PG_KV === '1';
    const pgRaw = String(env.DATABASE_URL ?? env.SUPABASE_POSTGRES_URL ?? '').trim();
    const usePg = forcePg || (Boolean(pgRaw) && !onVercel);
    if (usePg) {
        if (!pgRaw) throw new Error('The selected Postgres backend has no connection URL; no target was accessed.');
        const url = parsedUrl(pgRaw, 'The selected Postgres connection');
        const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
        if (!url.hostname || !database) throw new Error('The selected Postgres identity needs both a host and database name.');
        return {
            kind: 'postgres',
            fingerprint: databaseConnectionFingerprint(pgRaw),
        };
    }
    const restRaw = String(env.SUPABASE_URL ?? '').trim();
    if (!restRaw) throw new Error('The selected Supabase REST backend has no URL; no target was accessed.');
    const url = parsedUrl(restRaw, 'The selected Supabase REST endpoint');
    if (!url.hostname) throw new Error('The selected Supabase REST identity needs a host.');
    return {
        kind: 'supabase-rest',
        fingerprint: fingerprint(`supabase-rest:${url.hostname.toLowerCase()}:${url.port || '443'}${url.pathname.replace(/\/$/, '')}`),
    };
}

export function appOriginFingerprint(raw) {
    const url = parsedUrl(raw, 'STAGING_BASE_URL');
    if (url.username || url.password) throw new Error('STAGING_BASE_URL must not contain credentials.');
    return fingerprint(`app:${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`);
}

function fingerprintsFrom(raw) {
    return new Set(String(raw ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function assertStorageIdentity(parsed, env) {
    if (env.DISK_KV_DIR || env.KV_PROXY_URL) {
        throw new Error('Staging maintenance refuses disk/proxy overlays because one confirmation cannot cover multiple stores.');
    }
    const actual = selectedStorageIdentity(env).fingerprint;
    const expected = String(env.STAGING_STORAGE_FINGERPRINT ?? '').trim().toLowerCase();
    if (!expected || expected !== actual) {
        throw new Error('The selected storage database identity does not match STAGING_STORAGE_FINGERPRINT.');
    }
    const denied = fingerprintsFrom(env.PRODUCTION_STORAGE_FINGERPRINTS);
    if (denied.size === 0) throw new Error('PRODUCTION_STORAGE_FINGERPRINTS must contain the canonical production storage identity.');
    if (denied.has(actual)) throw new Error('The selected storage identity is in the production deny set.');
    if (parsed.storageConfirmation !== actual) {
        throw new Error('The CLI must confirm the exact selected storage fingerprint with --confirm-storage.');
    }
}

function assertAppIdentity(parsed, env) {
    const appUrl = parsedUrl(env.STAGING_BASE_URL, 'STAGING_BASE_URL');
    if (CANONICAL_PRODUCTION_APP_HOSTS.has(appUrl.hostname.toLowerCase())) {
        throw new Error('STAGING_BASE_URL names a canonical production host.');
    }
    const actual = appOriginFingerprint(env.STAGING_BASE_URL);
    const expected = String(env.STAGING_APP_FINGERPRINT ?? '').trim().toLowerCase();
    if (!expected || expected !== actual) {
        throw new Error('STAGING_BASE_URL does not match STAGING_APP_FINGERPRINT.');
    }
    const denied = fingerprintsFrom(env.PRODUCTION_APP_FINGERPRINTS);
    if (denied.size === 0) throw new Error('PRODUCTION_APP_FINGERPRINTS must contain the canonical production app origin.');
    if (denied.has(actual)) throw new Error('STAGING_BASE_URL is in the production deny set.');
    if (parsed.appConfirmation !== actual) {
        throw new Error('The CLI must confirm the exact staging app fingerprint with --confirm-app.');
    }
}

function assertKnownTarget(target) {
    if (!['local', 'staging'].includes(target)) {
        throw new Error('Maintenance tools accept only --target=local or --target=staging; production is intentionally unsupported.');
    }
}

function assertStagingIdentity(env) {
    if (deploymentTier(env) !== 'staging') {
        throw new Error('Staging access requires SHINOBIX_DEPLOYMENT_TIER=staging on the target service.');
    }
}

export function assertIntegrityInvocation(argv = process.argv.slice(2), env = process.env) {
    const parsed = parseMaintenanceArgs(argv);
    assertKnownTarget(parsed.target);

    if (hasExternalStorageCredentials(env) && parsed.target !== 'staging') {
        throw new Error('External storage credentials require an explicit --target=staging acknowledgement.');
    }
    if (parsed.target === 'staging') {
        assertStagingIdentity(env);
        assertStorageIdentity(parsed, env);
    }

    if (parsed.repair) {
        if (parsed.target !== 'staging') {
            throw new Error('Additive repair is permitted only against an explicitly identified staging target.');
        }
        if (env.ALLOW_STAGING_INTEGRITY_REPAIR !== '1') {
            throw new Error('Additive repair requires ALLOW_STAGING_INTEGRITY_REPAIR=1.');
        }
        if (parsed.integrityConfirmation !== INTEGRITY_REPAIR_CONFIRMATION) {
            throw new Error(`Additive repair requires --confirm-additive-repair=${INTEGRITY_REPAIR_CONFIRMATION}.`);
        }
    }

    return parsed;
}

export function assertPatreonSmokeInvocation(argv = process.argv.slice(2), env = process.env) {
    const parsed = parseMaintenanceArgs(argv);
    assertKnownTarget(parsed.target);
    if (parsed.target !== 'staging') {
        throw new Error('The Patreon certification harness runs only with --target=staging.');
    }
    assertStagingIdentity(env);
    assertAppIdentity(parsed, env);

    if (parsed.executeFixtures) {
        if (!hasExternalStorageCredentials(env)) {
            throw new Error('Fixture execution requires staging storage credentials in the service environment.');
        }
        assertStorageIdentity(parsed, env);
        if (env.ALLOW_STAGING_PATREON_SMOKE !== '1') {
            throw new Error('Fixture execution requires ALLOW_STAGING_PATREON_SMOKE=1.');
        }
        if (parsed.patreonConfirmation !== PATREON_SMOKE_CONFIRMATION) {
            throw new Error(`Fixture execution requires --confirm-fixtures=${PATREON_SMOKE_CONFIRMATION}.`);
        }
    }

    return parsed;
}

export function presentCredentialNames(env, names) {
    return names.filter((name) => String(env[name] ?? '').trim().length > 0);
}

function literalCandidates(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    const candidates = new Set([raw]);
    try {
        const url = new URL(raw);
        for (const part of [url.hostname, url.username, url.password, decodeURIComponent(url.pathname.replace(/^\//, ''))]) {
            if (part) candidates.add(part);
        }
    } catch {
        // Opaque tokens and secrets are still scrubbed as exact literals.
    }
    return [...candidates]
        .filter((entry) => entry.length >= 5)
        .sort((left, right) => right.length - left.length);
}

/**
 * Produce a bounded operator-safe error without echoing credentials, target
 * URLs/hosts, or player save keys. Callers decide whether an explicitly
 * requested restricted report may retain player identifiers.
 */
export function redactMaintenanceError(error, {
    includeIdentifiers = false,
    sensitiveValues = [],
    maxLength = 700,
} = {}) {
    let message = String(error?.message ?? error ?? 'unknown error');
    for (const value of sensitiveValues.flatMap(literalCandidates)) {
        message = message.split(value).join('[REDACTED]');
    }
    message = message
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[REDACTED_URL]')
        .replace(/((?:password|secret|token|key|code|state)=)[^\s&]+/gi, '$1[REDACTED]')
        .replace(/([?&]playerName=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:fixture-member-)?qa-pat(?:reon)?-[a-z0-9-]+\b/gi, '[FIXTURE]');
    if (!includeIdentifiers) {
        message = message.replace(/\bsave:[^\s;,'")\]}]+/gi, 'save:[REDACTED]');
    }
    return message.slice(0, Math.max(1, Number(maxLength) || 700));
}
