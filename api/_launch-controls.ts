export type LaunchControlCode =
    | 'maintenance_mode'
    | 'registrations_disabled'
    | 'gameplay_mutations_frozen';

export type LaunchControlDecision =
    | { allowed: true }
    | {
        allowed: false;
        status: 503;
        code: LaunchControlCode;
        error: string;
        retryAfterSeconds: number;
    };

type LaunchControlRequest = {
    path: string;
    method?: string;
    body?: unknown;
};

const ALLOWED: LaunchControlDecision = { allowed: true };
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function enabled(env: NodeJS.ProcessEnv, name: string): boolean {
    return env[name] === '1';
}

function normalizedPath(path: string): string {
    const clean = String(path || '/').split('?', 1)[0] || '/';
    return clean.startsWith('/api/') ? clean.slice(4) : clean;
}

function actionFrom(body: unknown): string | null {
    let parsed = body;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const action = (parsed as Record<string, unknown>).action;
    return typeof action === 'string' ? action : null;
}

function isOperatorRecoveryPath(path: string): boolean {
    return path === '/admin-auth'
        || path.startsWith('/admin/')
        || path === '/cron/snapshot-saves'
        || path.startsWith('/kv/');
}

function isPublicStatusPath(path: string, method: string): boolean {
    return path === '/player/capabilities' && (method === 'GET' || method === 'OPTIONS');
}

/**
 * Every way a brand-new account can come into existence.
 *
 * There is more than one door now: the original password register, Google
 * signup, and guest play. DISABLE_NEW_REGISTRATIONS is an incident switch, so
 * missing a door means the switch silently does not hold. Any future signup path
 * belongs on this list the day it is added.
 */
const ACCOUNT_CREATING_ACTIONS = new Set(['register', 'register-google', 'guest']);

function isAccountCreatingRequest(path: string, method: string, body: unknown): boolean {
    if (method !== 'POST') return false;
    if (path === '/player-auth') return ACCOUNT_CREATING_ACTIONS.has(actionFrom(body) ?? '');
    // Starting a Google sign-in in login mode can end in a new account, and the
    // flow is long enough that blocking at the last step wastes the player's
    // time. Link mode targets an account that already exists, so it stays open.
    if (path === '/auth/google/start') return actionModeFrom(body) !== 'link';
    return false;
}

/** The `mode` field of an OAuth start request, when present. */
function actionModeFrom(body: unknown): string | null {
    let parsed = body;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const mode = (parsed as Record<string, unknown>).mode;
    return typeof mode === 'string' ? mode : null;
}

/** Emergency controls evaluated at the single Express route boundary. */
export function evaluateLaunchControl(
    req: LaunchControlRequest,
    env: NodeJS.ProcessEnv = process.env,
): LaunchControlDecision {
    const path = normalizedPath(req.path);
    const method = String(req.method || 'GET').toUpperCase();

    // Operator recovery must remain reachable so an incident can be inspected
    // and repaired while player traffic is paused.
    if (isOperatorRecoveryPath(path)) return ALLOWED;
    if (isPublicStatusPath(path, method)) return ALLOWED;

    if (enabled(env, 'MAINTENANCE_MODE')) {
        return {
            allowed: false,
            status: 503,
            code: 'maintenance_mode',
            error: 'ShinobiX is temporarily in maintenance mode.',
            retryAfterSeconds: 60,
        };
    }

    if (enabled(env, 'DISABLE_NEW_REGISTRATIONS') && isAccountCreatingRequest(path, method, req.body)) {
        return {
            allowed: false,
            status: 503,
            code: 'registrations_disabled',
            error: 'New registrations are temporarily disabled.',
            retryAfterSeconds: 300,
        };
    }

    // This deliberately freezes every gameplay mutation, not just known reward
    // routes. During an economy incident, a broad stop is safer than maintaining
    // a fragile allow/deny list that can miss a newly added settlement endpoint.
    // Signing in is not an economy mutation. Freezing it would lock every player
    // out of the game during exactly the incident an operator is trying to
    // inspect — so the auth paths are exempt, the same as /player-auth.
    const isAuthPath = path === '/player-auth' || path.startsWith('/auth/google/');
    if (
        enabled(env, 'FREEZE_ECONOMY_REWARDS')
        && UNSAFE_METHODS.has(method)
        && !isAuthPath
        && path !== '/perf-beacon'
    ) {
        return {
            allowed: false,
            status: 503,
            code: 'gameplay_mutations_frozen',
            error: 'Gameplay mutations are temporarily paused.',
            retryAfterSeconds: 60,
        };
    }

    return ALLOWED;
}

export function newRegistrationsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return enabled(env, 'DISABLE_NEW_REGISTRATIONS') || enabled(env, 'MAINTENANCE_MODE');
}

export function scheduledJobsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return enabled(env, 'DISABLE_SCHEDULED_JOBS');
}
