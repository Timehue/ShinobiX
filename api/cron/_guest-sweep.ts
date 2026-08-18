/**
 * Reclaim guest accounts nobody came back for.
 *
 * Guest play hands out a real account with no owner attached, which is only a
 * reasonable trade if abandoned ones do not pile up forever. After
 * GUEST_INACTIVITY_MS of silence the account and its save are deleted.
 *
 * Two properties this leans on, both deliberate:
 *
 *  - **Liveness costs nothing.** Activity is read from `player:registry.lastSeen`,
 *    which the save path already writes for every player — one hash read covers
 *    the whole server. There is no per-heartbeat "touch" write anywhere, and in
 *    particular nothing that would make the hottest endpoint in the game take
 *    the auth lock. A guest who registered but never saved falls back to their
 *    record's `createdAt`.
 *  - **Only a CREDENTIAL-LESS guest is reclaimable.** The selector is
 *    `isCredentialLessGuest` (player-auth.ts), shared with the tavern lock so
 *    "belongs to nobody" has one definition. The `guest` flag alone is NOT
 *    enough: linking Google clears it, but setting a first password does not,
 *    and deleting the character of someone who chose a password is the worst
 *    thing this cron could do. A password or Google account is unreachable
 *    from here no matter what else is wrong.
 *
 * Runs in dry-run mode unless GUEST_SWEEP_ENABLED=1, so the first cycles report
 * what they would have taken and take nothing.
 */
import { kv } from './../_storage.js';
import { safeName } from './../_utils.js';
import { GUEST_INACTIVITY_MS, isCredentialLessGuest, type AuthRecord } from './../player-auth.js';
import { deletePlayerAccount } from './../_delete-player-account.js';
import { REGISTRY_KEY } from './../player/_public-index.js';

const AUTH_PREFIX = 'auth:';

export type GuestSweepResult = {
    /** False while GUEST_SWEEP_ENABLED is unset — nothing was deleted. */
    enabled: boolean;
    scanned: number;
    guests: number;
    /** Slugs deleted, or that would have been deleted in a dry run. */
    expired: string[];
    failures: string[];
};

/** Whether the sweep actually deletes, or only reports. */
export function guestSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.GUEST_SWEEP_ENABLED === '1';
}

function parseLastSeen(raw: unknown): number {
    if (!raw) return 0;
    // Registry values come back either already-parsed or as JSON text,
    // depending on which storage backend answered.
    let entry: unknown = raw;
    if (typeof entry === 'string') {
        try { entry = JSON.parse(entry); } catch { return 0; }
    }
    if (!entry || typeof entry !== 'object') return 0;
    const lastSeen = Number((entry as { lastSeen?: unknown }).lastSeen);
    return Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : 0;
}

export async function runGuestSweep(now: number = Date.now()): Promise<GuestSweepResult> {
    const result: GuestSweepResult = { enabled: guestSweepEnabled(), scanned: 0, guests: 0, expired: [], failures: [] };

    let authKeys: string[];
    let registry: Record<string, unknown>;
    try {
        [authKeys, registry] = await Promise.all([
            kv.keys(`${AUTH_PREFIX}*`),
            kv.hgetall<Record<string, unknown>>(REGISTRY_KEY).then((r) => r ?? {}),
        ]);
    } catch (err) {
        result.failures.push(`scan: ${(err as Error).message}`);
        return result;
    }

    // `auth:*` also matches `auth-session:` / `auth-google:` on a plain prefix
    // scan, so filter to real account rows before reading any of them.
    const accountKeys = authKeys.filter((key) => key.startsWith(AUTH_PREFIX) && !key.slice(AUTH_PREFIX.length).includes(':'));
    result.scanned = accountKeys.length;

    const cutoff = now - GUEST_INACTIVITY_MS;
    for (const key of accountKeys) {
        const slug = safeName(key.slice(AUTH_PREFIX.length));
        if (!slug) continue;

        let record: AuthRecord | null;
        try {
            record = await kv.get<AuthRecord>(key);
        } catch (err) {
            result.failures.push(`${key}: ${(err as Error).message}`);
            continue;
        }
        // NOT `record.guest` alone. Setting a first password keeps that flag
        // (player-auth `change` spreads the record), so the old check deleted
        // characters belonging to players who had chosen a real password and
        // could sign back in from any device — the single worst outcome this
        // cron can produce. `isCredentialLessGuest` is shared with the tavern
        // lock so "belongs to nobody" has exactly one definition.
        // `record` is tested explicitly: isCredentialLessGuest returns a plain
        // boolean on purpose (a type predicate there would be unsound), so this
        // is what narrows away the null before `record.createdAt` below.
        if (!record || !isCredentialLessGuest(record)) continue;
        result.guests += 1;

        const lastActive = Math.max(parseLastSeen(registry[slug]), Number(record.createdAt) || 0);
        // A guest with no timestamp at all is not evidence of abandonment — it
        // is evidence of missing data. Leave it rather than guess.
        if (!lastActive || lastActive >= cutoff) continue;

        result.expired.push(slug);
        if (!result.enabled) continue;

        try {
            const deleted = await deletePlayerAccount(slug);
            result.failures.push(...deleted.failures.map((f) => `${slug}: ${f}`));
        } catch (err) {
            result.failures.push(`${slug} delete: ${(err as Error).message}`);
        }
    }

    return result;
}
