/**
 * Vendor-neutral privacy boundary for third-party error reporting.
 *
 * Keep this module free of browser, Node, and Sentry imports so the same rules
 * protect the server and the client's error-only lazy chunk.
 */

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LENGTH = 4_000;

const OMIT_KEYS = new Set([
    'authorization',
    'cookie',
    'cookies',
    'setcookie',
    'xplayertoken',
    'xplayerpassword',
    'xadminpassword',
    'xadmintoken',
    'sessionsecret',
    'sessiontoken',
    'password',
    'passwordconfirmation',
    'confirmpassword',
    'requestbody',
    'responsebody',
    'rawrequestbody',
    'rawresponsebody',
    'playersave',
    'playersaves',
    'rawsave',
    'inventory',
    'inventorydump',
    'chat',
    'chatcontent',
    'messagecontent',
    'report',
    'reportcontent',
    'visualnoveltext',
    'imageprompt',
    'prompt',
    'apikey',
    'externalapikey',
    'openaiapikey',
    'posthogprojectkey',
]);

const OMIT_CONTAINERS = new Set(['request', 'response', 'body', 'data', 'user']);

function normalizedKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sensitiveKey(key: string, path: readonly string[]): boolean {
    const normalized = normalizedKey(key);
    if (OMIT_KEYS.has(normalized)) return true;
    if (/(?:password|passwd|secret|privatekey|accesstoken|refreshtoken)$/.test(normalized)) return true;
    if (/(?:api|project|service|admin)key$/.test(normalized)) return true;

    // Request/response containers are useful Sentry defaults but are too easy
    // to populate with raw bodies, cookies, query strings, or identifying URLs.
    // Route templates and request IDs are attached separately as bounded tags.
    if (path.length === 0 && OMIT_CONTAINERS.has(normalized)) return true;
    return false;
}

function scrubString(value: string): string {
    return value
        .slice(0, MAX_STRING_LENGTH)
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|phc|sentry|posthog)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED_KEY]')
        .replace(/((?:authorization|cookie|x-player-token|x-player-password|x-admin-password|x-admin-token|password|session[_-]?secret|api[_-]?key)\s*[=:]\s*)[^\s,;}&]+/gi, '$1[REDACTED]')
        .replace(/("(?:password|passwordConfirmation|confirmPassword|authorization|cookie|x-player-token|x-player-password|x-admin-password|x-admin-token|sessionSecret|apiKey)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
}

function sanitize(
    value: unknown,
    path: readonly string[],
    seen: WeakSet<object>,
    depth: number,
): unknown {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return scrubString(value);
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (depth >= MAX_DEPTH) return '[TRUNCATED]';
    if (typeof value !== 'object') return scrubString(String(value));
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);

    if (value instanceof Error) {
        return {
            name: scrubString(value.name || 'Error'),
            message: scrubString(value.message || 'Error'),
            ...(value.stack ? { stack: scrubString(value.stack) } : {}),
        };
    }
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((entry, index) =>
            sanitize(entry, [...path, String(index)], seen, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
        if (sensitiveKey(key, path)) continue;
        const sanitized = sanitize(entry, [...path, key], seen, depth + 1);
        if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
}

export function sanitizeTelemetryValue<T>(value: T): T {
    return sanitize(value, [], new WeakSet(), 0) as T;
}

/** Sentry beforeSend-compatible event scrubber. */
export function sanitizeSentryEvent<T>(event: T): T | null {
    if (!event || typeof event !== 'object') return null;
    return sanitizeTelemetryValue(event);
}

const SAFE_CONTEXT_KEYS = new Set([
    'source',
    'screen',
    'screenId',
    'subsystem',
    'battleMode',
    'featureFlag',
    'browserRuntime',
    'errorCategory',
    'filename',
    'line',
    'column',
    'componentStack',
]);

/** Reduce caught-error context to explicitly approved diagnostic fields. */
export function safeDiagnosticContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!context) return undefined;
    const allowed = Object.fromEntries(Object.entries(context).filter(([key]) => SAFE_CONTEXT_KEYS.has(key)));
    const sanitized = sanitizeTelemetryValue(allowed);
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/** Reporting is always best-effort and must never throw into gameplay. */
export function invokeSafeCapture(
    capture: (error: unknown, hint?: { extra?: Record<string, unknown> }) => unknown,
    error: unknown,
    context?: Record<string, unknown>,
): boolean {
    try {
        const extra = safeDiagnosticContext(context);
        capture(error, extra ? { extra } : undefined);
        return true;
    } catch {
        return false;
    }
}
