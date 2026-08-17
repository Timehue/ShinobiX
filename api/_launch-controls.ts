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
// The /player-auth actions that let an EXISTING player back in: password
// sign-in and credential recovery (`verify`, `change`, `adminreset`) plus guest
// resume, which hands back an already-created guest character. Account creation
// (`register`, `register-google`, `guest`) and `delete` are deliberately absent
// — see the freeze rationale below.
const PLAYER_AUTH_SIGN_IN_ACTIONS = new Set(['verify', 'change', 'adminreset', 'guest-resume']);

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

    // This deliberately rejects every unsafe-method player HTTP action at the
    // shared route boundary. It is not a process/storage quiescence fence: GET
    // settlement, cron, realtime, and other in-process writers need independent
    // controls and verification.
    //
    // SIGNING IN IS EXEMPT, because freezing it would lock every player out of
    // the game during exactly the incident an operator is trying to inspect.
    // That exemption is drawn per ACTION rather than per path, which is the one
    // place this differs from a blanket `/player-auth` carve-out:
    //
    //   - `verify` / `change` / `adminreset` — password sign-in and credential
    //     recovery. Already exempt.
    //   - `guest-resume` — resumes an EXISTING guest character (it looks the
    //     owner up and hands back their record; it creates nothing). It is a
    //     sign-in, so exempting it is what keeps the policy coherent: without it
    //     a password player could get in during a freeze and a guest could not.
    //   - `/auth/google/*` — the whole server-side authorization-code flow is
    //     sign-in and never touches the economy.
    //
    // Everything else on /player-auth stays frozen, deliberately. `register`,
    // `register-google` and `guest` are account CREATION and follow the same
    // public gameplayMutations gate as the client. `delete` is a multi-resource
    // mutation (save + auth record), and allowing that half while the save
    // DELETE is frozen can orphan the save and lock the player out — which is
    // why this cannot simply exempt the path.
    const isGoogleAuthPath = path.startsWith('/auth/google/');
    const isSignInAction = path === '/player-auth'
        && PLAYER_AUTH_SIGN_IN_ACTIONS.has(actionFrom(req.body) ?? '');
    if (
        enabled(env, 'FREEZE_ECONOMY_REWARDS')
        && UNSAFE_METHODS.has(method)
        && !isGoogleAuthPath
        && !isSignInAction
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

/** Stops the in-process presence snapshot and one-second game-loop writers.
 * Socket.IO has its own DISABLE_REALTIME switch because HTTP presence can
 * normally keep using these jobs when websocket transport alone is disabled. */
export function presenceStateJobsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return enabled(env, 'DISABLE_PRESENCE_STATE_JOBS');
}
