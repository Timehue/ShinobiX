/*
 * Print non-secret fingerprints for maintenance target allow/deny lists.
 * The underlying host, database, URL, usernames, and credentials are never
 * emitted. This script performs no network or storage access.
 */
import { loadProjectEnv } from './_load-env.mjs';
import {
    appOriginFingerprint,
    hasExternalStorageCredentials,
    selectedStorageIdentity,
} from './lib/maintenance-guards.mjs';

await loadProjectEnv();

const result = {};
try {
    if (hasExternalStorageCredentials(process.env)) {
        const identity = selectedStorageIdentity(process.env);
        result.storageKind = identity.kind;
        result.storageFingerprint = identity.fingerprint;
    }
    if (String(process.env.STAGING_BASE_URL ?? '').trim()) {
        result.appFingerprint = appOriginFingerprint(process.env.STAGING_BASE_URL);
    }
} catch (error) {
    console.error('[maintenance-fingerprint] Refused:', String(error?.message ?? 'invalid target configuration'));
    process.exit(2);
}

if (Object.keys(result).length === 0) {
    console.error('[maintenance-fingerprint] No storage URL or STAGING_BASE_URL is configured.');
    process.exit(2);
}
console.log(JSON.stringify(result, null, 2));
