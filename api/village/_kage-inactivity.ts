/*
 * Kage inactivity — an ABSENT Kage loses the seat (owner ruling 2026-08-22).
 *
 * Kage challenges are online-only (_kage-challenge.ts): the accept-obligation
 * clock only burns while BOTH the Kage and the challenger are online, so a Kage
 * who simply stops playing could hold the seat forever. This daily pass closes
 * that hole: if the seated Kage's save has not been written in
 * KAGE_INACTIVITY_DAYS (the player's autosave is their "last seen"), the reign
 * is closed with reason 'inactive' and the seat is left OPEN.
 *
 * Fail-safe by construction: a vacant seat is a no-op, and a Kage whose save is
 * missing or unreadable is NEVER dethroned (logged and skipped). The pure
 * threshold helpers live at the top so the cutoff is unit-testable without KV.
 */
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { closeCurrentReign, KAGE_DECLARE_RYO_COST, type KageChallenge, type KageStateLike } from './_kage-challenge.js';
import { kageKey } from './_kage-settle.js';

export const KAGE_INACTIVITY_DAYS = 10;
export const KAGE_INACTIVITY_MS = KAGE_INACTIVITY_DAYS * 24 * 60 * 60_000;

/** The moment a Kage last seen at `saveAt` forfeits the seat by absence. */
export function kageInactiveAt(saveAt: number): number {
    return saveAt + KAGE_INACTIVITY_MS;
}

/**
 * True once a Kage whose last autosave landed at `saveAt` has been absent for
 * the full KAGE_INACTIVITY_DAYS at `now`. A non-finite / non-positive `saveAt`
 * (no save, no stamp) is NEVER inactive — unknown activity fails safe.
 */
export function kageInactiveSince(saveAt: number, now: number): boolean {
    if (!Number.isFinite(saveAt) || saveAt <= 0 || !Number.isFinite(now)) return false;
    return now >= kageInactiveAt(saveAt);
}

/** Read the seated Kage's `_saveAt` (last autosave). `null` when unknown. */
export function saveAtFromRecord(save: unknown): number | null {
    if (!save || typeof save !== 'object') return null;
    const raw = Number((save as { _saveAt?: unknown })._saveAt);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

export type KageInactivityVillageResult =
    | { village: string; outcome: 'vacant' }
    | { village: string; outcome: 'active'; kage: string; lastActiveAt: number }
    | { village: string; outcome: 'skipped-unreadable'; kage: string }
    | { village: string; outcome: 'dethroned'; kage: string; lastActiveAt: number };

export type KageInactivityPassResult = {
    processed: number;
    dethroned: string[];
    results: KageInactivityVillageResult[];
};

/**
 * One village: decide outside the lock (cheap reads), then re-check and commit
 * under the SAME kage-key lock the kage endpoints use, so a concurrent duel
 * settlement / admin seat change can never be clobbered by a stale dethrone.
 */
async function processVillage(village: string, now: number): Promise<KageInactivityVillageResult> {
    const key = kageKey(village);
    const state = await kv.get<KageStateLike>(key);
    const kage = String(state?.seatedKage ?? '').trim();
    if (!state?.kageSystemUnlocked || !kage) return { village, outcome: 'vacant' };

    let save: unknown;
    try {
        save = await kv.get<unknown>(`save:${safeName(kage)}`);
    } catch (err) {
        console.warn(`[kage-inactivity] ${village}: save for ${kage} unreadable — skipping.`, (err as Error).message);
        return { village, outcome: 'skipped-unreadable', kage };
    }
    const lastActiveAt = saveAtFromRecord(save);
    if (lastActiveAt == null) {
        console.warn(`[kage-inactivity] ${village}: save for ${kage} missing or has no _saveAt — skipping.`);
        return { village, outcome: 'skipped-unreadable', kage };
    }
    if (!kageInactiveSince(lastActiveAt, now)) return { village, outcome: 'active', kage, lastActiveAt };

    let seatedAt = 0;
    let clearedChallenge: KageChallenge | null = null;
    const committed = await withKvLock<boolean>(key, async () => {
        const fresh = await kv.get<KageStateLike>(key);
        if (!fresh?.kageSystemUnlocked || safeName(fresh.seatedKage ?? '') !== safeName(kage)) return false;
        // Re-read the save under the lock: a Kage who logged in between the
        // outside read and now keeps the seat.
        const freshSaveAt = saveAtFromRecord(await kv.get<unknown>(`save:${safeName(kage)}`));
        if (freshSaveAt == null || !kageInactiveSince(freshSaveAt, now)) return false;
        seatedAt = fresh.seatedAt ?? fresh.unlockedAt ?? 0;
        clearedChallenge = fresh.challenge ?? null;
        const closed = closeCurrentReign(fresh, village, now, 'inactive');
        // Seat OPEN: no Kage, no live challenge (it was against the absentee),
        // no grace window. History keeps the closed reign.
        const next: KageStateLike = {
            ...closed,
            seatedKage: undefined,
            seatedAt: undefined,
            defenseCount: 0,
            challenge: null,
            postDefenseGraceUntil: undefined,
        };
        await kv.set(key, JSON.parse(JSON.stringify(next)));
        return true;
    }, { failClosed: true });
    if (!committed) return { village, outcome: 'active', kage, lastActiveAt };

    // World herald (exact-once via receipt — a re-run after a lost ack never
    // re-posts) + a "while you were away" line for the former Kage. Both
    // best-effort: the seat change above is already durable.
    try {
        await announce({
            type: 'kage_inactive',
            importance: 'high',
            title: 'The Seat Stands Empty',
            message: `${kage} has not been seen in ${village} for ${KAGE_INACTIVITY_DAYS} days. The Kage seat is open to any challenger.`,
            player: kage,
            village,
        }, { receiptId: `kage-inactive:${village}:${seatedAt}` });
    } catch { /* best-effort */ }
    try {
        // `tenureMs` lets the notice say what the absence actually cost. It is
        // omitted (not zero) for a legacy reign with no recorded seatedAt.
        await pushOfflineNotice(kage, {
            kind: 'kage-seat-lost',
            by: 'inactivity',
            village,
            sector: 0,
            at: now,
            ...(seatedAt > 0 ? { tenureMs: Math.max(0, now - seatedAt) } : {}),
        });
    } catch (err) {
        console.warn(`[kage-inactivity] ${village}: offline notice for ${kage} failed.`, (err as Error).message);
    }
    // A challenge that was open against the absentee dies with the reign. The
    // challenger did nothing wrong: refund the declare stake (the exact
    // KAGE_DECLARE_RYO_COST debit kage-challenge.ts applied) under their save
    // lock, tell them, and apply NO cooldown.
    if (clearedChallenge) await refundClearedChallenge(village, clearedChallenge, now);
    console.log(`[kage-inactivity] ${village}: ${kage} absent since ${new Date(lastActiveAt).toISOString()} — seat declared open.`);
    return { village, outcome: 'dethroned', kage, lastActiveAt };
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// ── Durable stake compensation ─────────────────────────────────────────────
/*
 * The dethrone commits the seat change and DROPS the open challenge in one CAS,
 * so by the time the refund runs there is no row left to retry from. If the
 * challenger's save is missing, their save lock is contended, or KV hiccups, the
 * 250,000-ryo stake used to be destroyed with nothing but a console line.
 *
 * It is now PARKED as a durable pending compensation keyed per challenge, which
 * the player's next heartbeat drains (api/player/heartbeat.ts) — the same
 * "while you were away" shape as the offline-notice inbox next to it. The pass
 * itself also drains before it parks, so an earlier failure settles the moment
 * the player is reachable again.
 *
 * The drain CLAIMS the parked entries before crediting and RE-PARKS them if the
 * credit does not commit. That ordering is deliberate: a refund can never be
 * paid twice (which would mint ryo), and every failure the audit named —
 * contention, a missing save, a KV error — is fully recoverable because the
 * entry goes straight back on the queue.
 */
export type PendingStakeRefund = {
    /** `kage-stake:<village>:<challengeId>` — dedupes a re-parked/re-run refund. */
    id: string;
    village: string;
    amount: number;
    at: number;
};

export const KAGE_STAKE_REFUND_CAP = 20;
export const KAGE_STAKE_REFUND_TTL_SEC = 60 * 24 * 60 * 60;

export function kageStakeRefundKey(slug: string): string {
    return `kage-stake-refund:${safeName(slug)}`;
}

export function parsePendingStakeRefunds(raw: unknown): PendingStakeRefund[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: PendingStakeRefund[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const v = entry as Record<string, unknown>;
        const id = typeof v.id === 'string' ? v.id.trim() : '';
        const amount = Math.floor(Number(v.amount) || 0);
        const at = Math.floor(Number(v.at) || 0);
        if (!id || seen.has(id) || amount <= 0 || at <= 0) continue;
        seen.add(id);
        out.push({ id, village: String(v.village ?? ''), amount, at });
    }
    return out.slice(-KAGE_STAKE_REFUND_CAP);
}

async function writePendingStakeRefunds(key: string, entries: PendingStakeRefund[]): Promise<void> {
    if (entries.length === 0) await kv.del(key);
    else await kv.set(key, entries, { ex: KAGE_STAKE_REFUND_TTL_SEC });
}

/** Park a refund the player is owed. Idempotent per `id`. */
export async function parkKageStakeRefund(slug: string, entry: PendingStakeRefund): Promise<void> {
    const key = kageStakeRefundKey(slug);
    await withKvLock(key, async () => {
        const current = parsePendingStakeRefunds(await kv.get(key));
        if (current.some((e) => e.id === entry.id)) return;
        await writePendingStakeRefunds(key, [...current, entry].slice(-KAGE_STAKE_REFUND_CAP));
    }, { failClosed: true });
}

/** Read the parked compensations without claiming them (heartbeat peek). */
export async function readPendingKageStakeRefunds(slug: string): Promise<PendingStakeRefund[]> {
    return parsePendingStakeRefunds(await kv.get(kageStakeRefundKey(slug)));
}

/**
 * Credit every parked refund into the player's save and clear the queue.
 * Returns the ryo actually paid (0 when there was nothing owed, or when the
 * credit could not commit — in which case the entries are put back untouched).
 */
export async function drainKageStakeRefunds(slug: string, now: number = Date.now()): Promise<number> {
    const safe = safeName(slug);
    if (!safe) return 0;
    const key = kageStakeRefundKey(safe);

    // Claim: take the queue in one locked read+clear so two concurrent drains
    // (a heartbeat racing the daily pass) can never both pay the same entries.
    const claimed = await withKvLock<PendingStakeRefund[]>(key, async () => {
        const current = parsePendingStakeRefunds(await kv.get(key));
        if (current.length === 0) return [];
        await kv.del(key);
        return current;
    }, { failClosed: true });
    if (claimed.length === 0) return 0;

    const total = claimed.reduce((sum, e) => sum + e.amount, 0);
    const saveKey = `save:${safe}`;
    try {
        const credited = await withKvLock<boolean>(saveKey, async () => {
            const rec = await kv.get<Record<string, unknown>>(saveKey);
            const c = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !c) return false;
            const nextChar = { ...c, ryo: num(c.ryo) + total };
            const nextRec = bumpSaveVersion({ ...rec, character: nextChar });
            await kv.set(saveKey, mergePreservingImages(nextRec, rec));
            return true;
        }, { failClosed: true });
        if (!credited) {
            // No save to credit yet (a fresh device, a mid-migration read) —
            // the debt stays owed and the next beat tries again.
            await parkAll(key, claimed);
            return 0;
        }
    } catch (err) {
        await parkAll(key, claimed);
        console.warn(`[kage-inactivity] stake refund for ${safe} deferred:`, (err as Error).message);
        return 0;
    }

    for (const e of claimed) {
        try {
            await pushOfflineNotice(safe, { kind: 'kage-challenge-refunded', by: 'inactivity', village: e.village, sector: 0, at: now, amount: e.amount });
        } catch { /* the ryo already landed; the note is best-effort */ }
    }
    return total;
}

/** Put claimed entries back on the queue (merging anything parked meanwhile). */
async function parkAll(key: string, entries: readonly PendingStakeRefund[]): Promise<void> {
    try {
        await withKvLock(key, async () => {
            const current = parsePendingStakeRefunds(await kv.get(key));
            const ids = new Set(current.map((e) => e.id));
            const merged = [...entries.filter((e) => !ids.has(e.id)), ...current];
            await writePendingStakeRefunds(key, merged.slice(-KAGE_STAKE_REFUND_CAP));
        }, { failClosed: true });
    } catch (err) {
        console.error('[kage-inactivity] could not re-park stake refunds:', (err as Error).message);
    }
}

async function refundClearedChallenge(village: string, challenge: KageChallenge, now: number): Promise<void> {
    const slug = safeName(challenge.challenger);
    if (!slug) return;
    // Park first, pay second. The queue entry is the durable record of the debt,
    // so every failure below leaves the stake owed rather than destroyed.
    const entry: PendingStakeRefund = {
        id: `kage-stake:${village}:${challenge.challengeId}`,
        village,
        amount: KAGE_DECLARE_RYO_COST,
        at: now,
    };
    try {
        await parkKageStakeRefund(slug, entry);
    } catch (err) {
        console.error(`[kage-inactivity] ${village}: could not park the stake refund for ${slug}.`, (err as Error).message);
        return;
    }
    try {
        await drainKageStakeRefunds(slug, now);
    } catch (err) {
        console.warn(`[kage-inactivity] ${village}: stake refund for ${slug} stays pending.`, (err as Error).message);
    }
}

/** Daily pass over the four villages. Idempotent; never throws per village. */
export async function runKageInactivityPass(now: number = Date.now()): Promise<KageInactivityPassResult> {
    const results: KageInactivityVillageResult[] = [];
    for (const village of WAR_VILLAGES) {
        try {
            results.push(await processVillage(village, now));
        } catch (err) {
            console.error(`[kage-inactivity] ${village}: pass threw — skipping.`, (err as Error).message);
        }
    }
    return {
        processed: results.length,
        dethroned: results.filter((r) => r.outcome === 'dethroned').map((r) => r.village),
        results,
    };
}
