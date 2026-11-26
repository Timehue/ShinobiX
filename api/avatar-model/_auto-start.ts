import { getActiveBan } from '../admin/moderation.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { kv, type KvCasOp } from '../_storage.js';
import { safeLogValue } from '../_safe-log.js';
import { admitModelJob, modelCreationPolicy } from './_admission.js';
import { checkPlayerPortrait, READ_PATIENCE_MS } from './read.js';

/**
 * A player who presses Check portrait may close the window: the model loop finishes the check and starts
 * the model by itself (owner, 2026-11-20). An open page still advances the same check under the same lock and
 * starts it with the same idempotency key (the read token), so the page and the loop can never make two models.
 */
const listKey = 'avatar-model:checks';
export const checkResultKey = (owner: string) => 'avatar-model:check-result:' + owner;
export type CheckResult = 'declined' | 'failed';
type Waiting = { owner: string; since: number; errors?: number };
// A minute short of the check's own two-hour patience, so the loop never starts a second check. Read at call
// time: read.ts imports this module, so READ_PATIENCE_MS is not yet set while this one first loads.
const giveUpMs = () => READ_PATIENCE_MS - 60_000;
const RESULT_TTL_SEC = 7 * 86400;

async function rewrite(change: (list: Waiting[]) => Waiting[], extra: (list: Waiting[]) => Promise<KvCasOp[]> = async () => []) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const list = await kv.get<Waiting[]>(listKey);
        const current = Array.isArray(list) ? list : [];
        const next = change(current);
        const ops: KvCasOp[] = next.length === current.length && next.every((w, i) => w === current[i]) ? []
            : [next.length ? { op: 'cas', key: listKey, expected: list, value: next } : { op: 'delete', key: listKey, expected: list }];
        ops.push(...await extra(current));
        if (!ops.length || await kv.compareSetMany?.(ops)) return;
    }
    throw new Error('Portrait check list busy');
}

/** The player asked for a model: keep finishing their check even if they leave. */
export async function awaitPortraitCheck(owner: string, now = Date.now()) {
    await rewrite(list => list.some(w => w.owner === owner) ? list : [...list, { owner, since: now }],
        async list => {
            if (list.some(w => w.owner === owner)) return [];
            const prior = await kv.get(checkResultKey(owner));
            return prior == null ? [] : [{ op: 'delete', key: checkResultKey(owner), expected: prior }];
        });
}

/** Whether the loop is still finishing this player's check, and how the last one ended. */
export async function portraitCheckStatus(owner: string): Promise<'checking' | CheckResult | null> {
    const [list, result] = await Promise.all([kv.get<Waiting[]>(listKey), kv.get<CheckResult>(checkResultKey(owner))]);
    if (Array.isArray(list) && list.some(w => w.owner === owner)) return 'checking';
    return result === 'declined' || result === 'failed' ? result : null;
}

/** End a player's waiting check: off the list, and the result (if any) kept for the panel. */
export async function endPortraitCheck(owner: string, result: CheckResult | null) {
    await rewrite(list => list.filter(w => w.owner !== owner),
        async () => result ? [{ op: 'cas', key: checkResultKey(owner), expected: await kv.get(checkResultKey(owner)),
            value: result, ex: RESULT_TTL_SEC }] : []);
}
const settle = endPortraitCheck;

type Ports = { check: typeof checkPlayerPortrait; admit: typeof admitModelJob; banned: (owner: string) => Promise<boolean> };
const defaults: Ports = { check: checkPlayerPortrait, admit: admitModelJob,
    banned: async owner => Boolean(await getActiveBan(owner)) };
// A check that throws this many passes in a row (not a busy lock) will not recover: fail it now rather than show
// "checking" for two hours.
const MAX_ERRORS = 5;

/** One step for one waiting player: done (started, declined, failed) or still waiting. */
export async function advancePortraitCheck(waiting: Waiting, ports = defaults, now = Date.now()) {
    const { owner } = waiting;
    if (now - waiting.since >= giveUpMs()) return settle(owner, 'failed');
    // Every player endpoint refuses a banned account (authedPlayer); the loop must not finish their model either.
    if (await ports.banned(owner)) return settle(owner, null);
    let result;
    try {
        // Resume only: the loop never starts (or pays for) a check of its own.
        result = await withKvLock('avatar-model:screen-owner:' + owner, () => ports.check(owner, undefined, { resumeOnly: true }),
            { ttlSec: 180, failClosed: true });
    } catch (error) {
        if (error instanceof LockContendedError) return; // The open page holds the check this minute.
        const errors = (waiting.errors ?? 0) + 1;
        console.warn('[avatar-model] Portrait check pass failed for', safeLogValue(owner), 'error', errors, 'of', MAX_ERRORS,
            safeLogValue(error));
        if (errors >= MAX_ERRORS) return settle(owner, 'failed');
        return rewrite(list => list.map(w => w.owner === owner ? { ...w, errors } : w));
    }
    if (waiting.errors) await rewrite(list => list.map(w => w.owner === owner ? { owner: w.owner, since: w.since } : w));
    if ('error' in result && result.error) {
        // quota: the model has started (the page or an earlier pass).
        if (result.error === 'quota') return settle(owner, null);
        // The check ended (failed), lapsed (expired), or the player may no longer make models (entitlement).
        if (result.error === 'failed' || result.error === 'expired' || result.error === 'entitlement') return settle(owner, 'failed');
        // disabled, unavailable (a model reset or a storage blip), limit: wait for the next pass, up to the patience.
        return;
    }
    if (result.state === 'pending') return;
    if (result.state === 'declined') return settle(owner, 'declined');
    const started = await ports.admit(owner, result.readToken!, result.readToken!, modelCreationPolicy());
    if ('jobId' in started || started.error === 'quota') return settle(owner, null);
    // Busy, switched off or out of budget for now: the accepted check stays valid, so try again next pass.
    if (started.error === 'busy' || started.error === 'disabled' || started.error === 'budget' || started.error === 'daily') return;
    return settle(owner, 'failed');
}

/** Run by the model loop every minute, within a time budget so model jobs behind it are never held up for long. */
export async function tickPortraitChecks(ports = defaults, budgetMs = 4 * 60_000) {
    const until = Date.now() + budgetMs;
    const list = await kv.get<Waiting[]>(listKey);
    for (const waiting of Array.isArray(list) ? list : []) {
        if (Date.now() > until) break;
        try { await advancePortraitCheck(waiting, ports); }
        catch (error) { console.warn('[avatar-model] Unable to finish a portrait check for', safeLogValue(waiting?.owner), safeLogValue(error)); }
    }
}
