import { readFile } from 'node:fs/promises';

const PRODUCTION_HOSTS = new Set([
    'shinobijourney.com',
    'www.shinobijourney.com',
    'theravensark.com',
    'www.theravensark.com',
]);
export const MAX_LOAD_DURATION_SECONDS = 600;
export const MAX_EMIT_INTERVAL_MS = 60_000;

function configuredRemoteOrigins(env) {
    return new Set(String(env.LOAD_TARGET_ALLOWLIST ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin));
}

export function percentile(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
    return sorted[index];
}

export function summarizeLatencies(values) {
    if (!values.length) return { min: null, p50: null, p95: null, p99: null, max: null };
    return {
        min: Math.min(...values),
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
        max: Math.max(...values),
    };
}

export function assertLoadSafety({ baseUrl, clients, durationSeconds, env = process.env }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Load target must use HTTP or HTTPS.');
    if (url.username || url.password) throw new Error('Load target must not contain URL credentials.');
    if (!Number.isInteger(clients) || clients < 1) throw new Error('Client count must be a positive integer.');
    if (!Number.isFinite(durationSeconds) || durationSeconds < 5) throw new Error('Duration must be at least 5 seconds.');
    if (durationSeconds > MAX_LOAD_DURATION_SECONDS) {
        throw new Error(`Duration must not exceed ${MAX_LOAD_DURATION_SECONDS} seconds.`);
    }

    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const production = PRODUCTION_HOSTS.has(url.hostname.toLowerCase());
    if (production) {
        if (env.ALLOW_PRODUCTION_LOAD !== '1') {
            throw new Error('Refusing a production load target without ALLOW_PRODUCTION_LOAD=1.');
        }
        if (clients > 25 || durationSeconds > 60) {
            throw new Error('Production safety cap is 25 clients for 60 seconds. Use a disposable target for larger tests.');
        }
    } else if (!local) {
        if (env.ALLOW_REMOTE_LOAD !== '1') {
            throw new Error('Refusing a remote load target without ALLOW_REMOTE_LOAD=1.');
        }
        if (!configuredRemoteOrigins(env).has(url.origin)) {
            throw new Error('Remote load target origin must be listed exactly in LOAD_TARGET_ALLOWLIST.');
        }
    }
    return { url, local, production };
}

export async function readAccountManifest(file, requestedClients) {
    if (!file) throw new Error('Pass --accounts <path> containing disposable player tokens.');
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Account manifest must be a JSON array.');
    const accounts = parsed.map((entry, index) => {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const token = typeof entry?.token === 'string' ? entry.token.trim() : '';
        if (!name || !token) throw new Error(`Account ${index + 1} must contain non-empty name and token fields.`);
        return { name, token };
    });
    if (new Set(accounts.map((entry) => entry.name.toLowerCase())).size !== accounts.length) {
        throw new Error('Account manifest contains duplicate player names.');
    }
    if (accounts.length < requestedClients) {
        throw new Error(`Account manifest has ${accounts.length} entries but ${requestedClients} clients were requested.`);
    }
    return accounts.slice(0, requestedClients);
}

export function parseArgs(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}.`);
        values.set(token, value);
        index += 1;
    }
    const integer = (name, fallback) => {
        const raw = values.get(name);
        if (raw === undefined) return fallback;
        const parsed = Number(raw);
        if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
        return parsed;
    };
    const number = (name, fallback) => {
        const raw = values.get(name);
        if (raw === undefined) return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric.`);
        return parsed;
    };
    return {
        baseUrl: values.get('--base-url') ?? '',
        accountsFile: values.get('--accounts') ?? '',
        evidenceOut: values.get('--evidence-out') ?? '',
        clients: integer('--clients', 25),
        durationSeconds: integer('--duration-seconds', 30),
        emitMs: integer('--emit-ms', 2_000),
        sector: integer('--sector', 40),
        reconnectFraction: number('--reconnect-fraction', 0.25),
    };
}

export function validateRunOptions(options) {
    if (!options.baseUrl) throw new Error('Pass --base-url <url>.');
    if (options.emitMs < 1_000) throw new Error('--emit-ms must be at least 1000 to respect server throttling.');
    if (options.emitMs > MAX_EMIT_INTERVAL_MS) {
        throw new Error(`--emit-ms must not exceed ${MAX_EMIT_INTERVAL_MS}.`);
    }
    if (options.sector < 0 || options.sector > 10_000) throw new Error('--sector is outside the supported test range.');
    if (options.reconnectFraction < 0 || options.reconnectFraction > 1) {
        throw new Error('--reconnect-fraction must be between 0 and 1.');
    }
    return { ...options, emitMs: Math.min(options.emitMs, MAX_EMIT_INTERVAL_MS) };
}
