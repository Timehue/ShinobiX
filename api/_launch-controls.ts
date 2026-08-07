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

    if (
        path === '/player-auth'
        && method === 'POST'
        && actionFrom(req.body) === 'register'
        && enabled(env, 'DISABLE_NEW_REGISTRATIONS')
    ) {
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
    if (
        enabled(env, 'FREEZE_ECONOMY_REWARDS')
        && UNSAFE_METHODS.has(method)
        && path !== '/player-auth'
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
