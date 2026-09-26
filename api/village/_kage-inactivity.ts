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
import { hollowGateCreditBasis, recordHollowGateExternalCredits } from '../hollow-gate/_external-credits.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { closeCurrentReign, KAGE_DECLARE_RYO_COST, type KageChallenge, type KageStateLike } from './_kage-challenge.js';
import { kageKey } from './_kage-settle.js';
import { recordAudit } from '../_audit.js';
import { settlementFingerprint, settlementTransactionId } from '../_durable-settlement.js';
import { appendSettlementReceipt, inspectSettlementReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT } from '../_settlement-receipts.js';
import { receiptAbsenceProvable } from '../_save-debit-saga.js';

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
 * The drain pays under the save lock with an in-save receipt per entry, and
 * only then removes the paid entries from the queue. It used to claim the
 * queue by deleting it first and re-park on failure, which lost the debt when
 * the process died in between, and paid it twice when a credit write landed
 * but reported an error (the re-parked entry was paid again). Now every
 * failure leaves the entry queued, and a receipt stops any second payment.
 */
export type PendingStakeRefund = {
    /** `kage-stake:<village>:<challengeId>` — dedupes a re-parked/re-run refund. */
    id: string;
    village: string;
    amount: number;
    at: number;
    chargedHollowGateCreditBasis?: NonNullable<ReturnType<typeof hollowGateCreditBasis>>;
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
        const rawBasis = v.chargedHollowGateCreditBasis;
        const basis = rawBasis && typeof rawBasis === 'object' && !Array.isArray(rawBasis)
            ? rawBasis as Record<string, unknown> : null;
        const chargedHollowGateCreditBasis = basis
            && typeof basis.runToken === 'string' && basis.runToken.length > 0
            && typeof basis.checkpointVersion === 'number' && Number.isSafeInteger(basis.checkpointVersion) && basis.checkpointVersion >= 0
            ? { runToken: basis.runToken, checkpointVersion: basis.checkpointVersion } : null;
        out.push({ id, village: String(v.village ?? ''), amount, at,
            ...(chargedHollowGateCreditBasis ? { chargedHollowGateCreditBasis } : {}),
        });
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

/** The in-save receipt that proves one parked refund was paid. */
function stakeRefundReceipt(entry: PendingStakeRefund): { requestId: string; fingerprint: string } {
    return {
        requestId: settlementTransactionId('kage-stake-refund', entry.id),
        fingerprint: settlementFingerprint({ operation: 'kage-stake-refund', id: entry.id, amount: entry.amount }),
    };
}

/**
 * Credit every parked refund into the player's save, then clear the paid
 * entries from the queue. Returns the ryo this call paid: 0 when nothing was
 * owed, when the credit could not commit (the entries stay queued for the next
 * drain), or when an earlier drain had already paid them.
 *
 * The queue stays the record of the debt until the payment has committed, and
 * each payment writes an in-save receipt in the same write. A drain that dies
 * after reading the queue leaves it intact; a credit that lands and then
 * throws is found by its receipt on the next drain and removed without paying
 * twice; two drains racing (a heartbeat and the daily pass) serialize on the
 * save lock, and the second finds the first one's receipts.
 */
export async function drainKageStakeRefunds(slug: string, now: number = Date.now()): Promise<number> {
    const safe = safeName(slug);
    if (!safe) return 0;
    const key = kageStakeRefundKey(safe);
    const owed = parsePendingStakeRefunds(await kv.get(key));
    if (owed.length === 0) return 0;

    const saveKey = `save:${safe}`;
    let outcome: { paid: PendingStakeRefund[]; settled: PendingStakeRefund[] } | null;
    try {
        outcome = await withKvLock(saveKey, async () => {
            const rec = await kv.get<Record<string, unknown>>(saveKey);
            const c = (rec?.character ?? null) as Record<string, unknown> | null;
            // No save to credit yet (a fresh device, a mid-migration read):
            // the debt stays owed and the next beat tries again.
            if (!rec || !c) return null;
            const paid: PendingStakeRefund[] = [];
            const settled: PendingStakeRefund[] = [];
            let nextChar = c;
            for (const entry of owed) {
                const { requestId, fingerprint } = stakeRefundReceipt(entry);
                const receipt = inspectSettlementReceipt(nextChar, requestId, fingerprint);
                if (receipt.status === 'replay') {
                    settled.push(entry);
                    continue;
                }
                if (receipt.status !== 'fresh') {
                    console.error(`[kage-inactivity] stake refund ${entry.id} for ${safe} left queued: the save's settlement receipts are ${receipt.status}.`);
                    continue;
                }
                if (!receiptAbsenceProvable(receipt.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', entry.at)) {
                    console.error(`[kage-inactivity] stake refund ${entry.id} for ${safe} left queued: whether it was paid can no longer be proven.`);
                    continue;
                }
                const currentBasis = hollowGateCreditBasis(nextChar);
                const chargedBasis = entry.chargedHollowGateCreditBasis;
                const sameBasis = chargedBasis && currentBasis
                    && chargedBasis.runToken === currentBasis.runToken
                    && chargedBasis.checkpointVersion === currentBasis.checkpointVersion;
                nextChar = appendSettlementReceipt(recordHollowGateExternalCredits(
                    nextChar,
                    { ...nextChar, ryo: num(nextChar.ryo) + entry.amount },
                    sameBasis ? 'run' : 'external',
                ), receipt.receipts, { requestId, fingerprint, value: { amount: entry.amount, village: entry.village }, settledAt: now });
                paid.push(entry);
                settled.push(entry);
            }
            if (paid.length > 0) {
                // Each refund's provenance was folded above; the final stamp has
                // zero wallet delta and preserves it in the single paying write.
                const nextRec = bumpSaveVersion({ ...rec, character: nextChar }, { previousCharacter: nextChar });
                await kv.set(saveKey, mergePreservingImages(nextRec, rec));
            }
            return { paid, settled };
        }, { failClosed: true });
    } catch (err) {
        console.warn(`[kage-inactivity] stake refund for ${safe} deferred:`, (err as Error).message);
        return 0;
    }
    if (!outcome) return 0;

    // Only now leave the queue, and only the entries this drain settled:
    // anything parked meanwhile stays. If this fails, the next drain finds the
    // receipts and removes them without paying again.
    if (outcome.settled.length > 0) {
        const done = new Set(outcome.settled.map((e) => e.id));
        try {
            await withKvLock(key, async () => {
                const current = parsePendingStakeRefunds(await kv.get(key));
                await writePendingStakeRefunds(key, current.filter((e) => !done.has(e.id)));
            }, { failClosed: true });
        } catch (err) {
            console.warn(`[kage-inactivity] paid stake refunds for ${safe} stay queued until the next drain:`, (err as Error).message);
        }
    }

    for (const e of outcome.paid) {
        try {
            await pushOfflineNotice(safe, { kind: 'kage-challenge-refunded', by: 'inactivity', village: e.village, sector: 0, at: now, amount: e.amount });
        } catch { /* the ryo already landed; the note is best-effort */ }
    }
    return outcome.paid.reduce((sum, e) => sum + e.amount, 0);
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
        ...(challenge.chargedHollowGateCreditBasis ? { chargedHollowGateCreditBasis: challenge.chargedHollowGateCreditBasis } : {}),
    };
    // The dethrone already dropped the challenge, so the queue is the only
    // record of this debt. Parking is idempotent per id: retry it, and if the
    // queue stays unwritable, leave a durable audit entry an operator can pay
    // from rather than a console line.
    let parked = false;
    let lastError = '';
    for (let attempt = 0; attempt < 3 && !parked; attempt += 1) {
        try {
            await parkKageStakeRefund(slug, entry);
            parked = true;
        } catch (err) {
            lastError = (err as Error).message;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }
    if (!parked) {
        console.error(`[kage-inactivity] ${village}: could not park the stake refund for ${slug}.`, lastError);
        await recordAudit({
            receiptId: `unparked-${entry.id}`,
            actor: 'system',
            domain: 'reward',
            action: 'kage-stake-refund.unparked',
            entityType: 'player',
            entityId: slug,
            after: { ...entry, owedTo: slug },
            reason: `Owed ${entry.amount} ryo for a Kage challenge cleared by inactivity; the refund queue could not be written (${lastError}). Pay it by hand.`,
        });
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
