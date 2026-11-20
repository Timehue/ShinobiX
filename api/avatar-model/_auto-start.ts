import { withKvLock } from '../_lock.js';
import { kv, type KvCasOp } from '../_storage.js';
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
type Waiting = { owner: string; since: number };
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

async function settle(owner: string, result: CheckResult | null) {
    await rewrite(list => list.filter(w => w.owner !== owner),
        async () => result ? [{ op: 'cas', key: checkResultKey(owner), expected: await kv.get(checkResultKey(owner)),
            value: result, ex: RESULT_TTL_SEC }] : []);
}

type Ports = { check: typeof checkPlayerPortrait; admit: typeof admitModelJob };
const defaults: Ports = { check: checkPlayerPortrait, admit: admitModelJob };

/** One step for one waiting player: done (started, declined, failed) or still waiting. */
export async function advancePortraitCheck(waiting: Waiting, ports = defaults, now = Date.now()) {
    const { owner } = waiting;
    if (now - waiting.since >= giveUpMs()) return settle(owner, 'failed');
    let result;
    try {
        result = await withKvLock('avatar-model:screen-owner:' + owner, () => ports.check(owner), { ttlSec: 180, failClosed: true });
    } catch { return; } // The page holds the check this minute, or a provider blipped: try on the next pass.
    if ('error' in result && result.error) {
        // quota: the model has started (the page or an earlier pass). disabled: switched off for now, keep waiting.
        if (result.error === 'quota') return settle(owner, null);
        if (result.error === 'disabled') return;
        return settle(owner, 'failed');
    }
    if (result.state === 'pending') return;
    if (result.state === 'declined') return settle(owner, 'declined');
    const started = await ports.admit(owner, result.readToken!, result.readToken!, modelCreationPolicy());
    if ('jobId' in started || started.error === 'quota') return settle(owner, null);
    if (started.error === 'busy') return;
    return settle(owner, 'failed');
}

/** Run by the model loop every minute. */
export async function tickPortraitChecks(ports = defaults) {
    const list = await kv.get<Waiting[]>(listKey);
    for (const waiting of Array.isArray(list) ? list : []) {
        try { await advancePortraitCheck(waiting, ports); }
        catch { console.warn('[avatar-model] Unable to finish a portrait check'); }
    }
}
