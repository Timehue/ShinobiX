/*
 * Activity purses (2026-10 economy rebalance, owner amendment A7).
 *
 * Group and event modes that paid no ryo now pay a purse sized by the anchor
 * A(L) (shared/economy-anchor.ts) per active minute of a server-settled
 * outcome:
 *   - Endless Spire: 1.5 x A(L) per minute of a cleared tier, to each squad
 *     member (credited inside the clear itself, api/towers/_tower-store.ts);
 *   - Dojo Circuit seals, the public Team Arena, tournament matches and the
 *     L80 world crisis: 0.5 x A(L) per minute (creditActivityPurse below).
 *
 * Minutes run on the outcome's own server clock (session or match start to
 * its terminal write) and are capped per outcome, so an idle fight cannot
 * stretch its pay. A player holds one fight at a time, so per real minute a
 * purse never pays more than its multiple of the anchor. Nothing here is
 * read from a client: the callers pass sealed session or match fields.
 *
 * Dials (env, read at call time; a bad value falls back to the default):
 *   SPIRE_PURSE_SCALE      default 1, range 0-2; 0 turns the Spire purse off
 *   SIDE_MODE_PURSE_SCALE  default 1, range 0-2; 0 turns the side-mode purses off
 */
import { createHash } from 'node:crypto';
import { anchorRyoPerMinute } from '../shared/economy-anchor.js';
import { economyDial } from './_economy-dials.js';
import { recordEconomyTxn } from './_economy.js';
import { appendSettlementReceipt, inspectSettlementReceipt, SERVER_SETTLEMENT_RECEIPT_LIMIT } from './_settlement-receipts.js';
import { receiptAbsenceProvable } from './_save-debit-saga.js';
import { mutatePlayerSave } from './save/_mutate-player-save.js';
import { retryOnSaveVersionConflict } from './save/_projected-write.js';

export type ActivityPurseMode = 'spire' | 'dojo' | 'arena' | 'tournament' | 'crisis80';

/** The Spire purse, as a multiple of A(L) per active minute of a cleared tier. */
export const SPIRE_PURSE_A_MULT = 1.5;
/** The side-mode purse (Dojo Circuit, Team Arena, tournaments, L80 crisis). */
export const SIDE_MODE_PURSE_A_MULT = 0.5;
/** Minutes one outcome can credit, however long it was held open. */
export const ACTIVITY_PURSE_MAX_MINUTES = 20;

/** SPIRE_PURSE_SCALE (default 1, range 0-2). */
export function spirePurseScale(): number {
    return economyDial('SPIRE_PURSE_SCALE', 1, { min: 0, max: 2 });
}

/** SIDE_MODE_PURSE_SCALE (default 1, range 0-2). */
export function sideModePurseScale(): number {
    return economyDial('SIDE_MODE_PURSE_SCALE', 1, { min: 0, max: 2 });
}

/** The current multiple of A(L) one active minute of this mode pays. */
export function activityPurseAMult(mode: ActivityPurseMode): number {
    return mode === 'spire'
        ? SPIRE_PURSE_A_MULT * spirePurseScale()
        : SIDE_MODE_PURSE_A_MULT * sideModePurseScale();
}

/** Active minutes between two server timestamps, capped; garbage or a reversed clock is 0. */
export function activityPurseMinutes(startedAt: unknown, endedAt: unknown): number {
    const start = Number(startedAt);
    const end = Number(endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) return 0;
    return Math.min(ACTIVITY_PURSE_MAX_MINUTES, (end - start) / 60_000);
}

/**
 * The purse for `minutes` at `level`, times `factor` (a caller's 0-1
 * anti-farm weight, such as a short-fight or repeat-opponent share).
 */
export function activityPurseRyo(mode: ActivityPurseMode, level: unknown, minutes: number, factor = 1): number {
    const mins = Number.isFinite(minutes) ? Math.max(0, Math.min(ACTIVITY_PURSE_MAX_MINUTES, minutes)) : 0;
    const f = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 0;
    return Math.max(0, Math.floor(activityPurseAMult(mode) * anchorRyoPerMinute(Number(level)) * mins * f));
}

const PURSE_SOURCES: Readonly<Record<ActivityPurseMode, string>> = {
    spire: 'spire.purse',
    dojo: 'dojo.purse',
    arena: 'arena.purse',
    tournament: 'tournament.purse',
    crisis80: 'crisis80.purse',
};

/**
 * Economy telemetry for one committed purse (I-19). Callers run it from the
 * credit's afterCommit only, and it is never awaited, so a replay or a lost
 * compare-and-set logs nothing and telemetry never holds the save lock.
 */
export function recordActivityPurse(mode: ActivityPurseMode, player: string, outcomeId: string, ryo: number): void {
    if (!(ryo > 0)) return;
    void recordEconomyTxn({ txnId: `purse:${mode}:${outcomeId}:${player}`.slice(0, 120), player, currency: 'ryo', delta: ryo, source: PURSE_SOURCES[mode] });
}

export type ActivityPurseResult = {
    ryo: number;
    minutes: number;
    /** Why nothing (or nothing new) was paid. */
    reason?: 'off' | 'nothing-earned' | 'already-paid' | 'no-save' | 'invalid-receipt' | 'receipt-unprovable' | 'contended';
};

/** A credit's result plus the payee's save as it now stands, for the route to hand back. */
export type ActivityPurseCredit = ActivityPurseResult & {
    save?: { character: Record<string, unknown>; _saveVersion: number };
};

/** The purse as a reply shows it: the save travels separately, never inside the purse. */
export function publicActivityPurse<T extends { save?: unknown }>(credit: T): Omit<T, 'save'> {
    const { save: _save, ...view } = credit;
    return view;
}

function purseReceipt(mode: ActivityPurseMode, outcomeId: string, slug: string): { requestId: string; fingerprint: string } {
    const digest = createHash('sha256').update(`${mode}\u0000${outcomeId}\u0000${slug}`).digest('hex');
    return { requestId: `purse_${digest.slice(0, 40)}`, fingerprint: `activity-purse:${mode}:${digest}` };
}

/**
 * Credit one player's side-mode purse for one settled outcome, exactly once.
 * The ryo and its receipt commit in one save write; a retry answers from the
 * receipt. `startedAt` is the outcome's own start: a receipt that would have
 * been written after it and is no longer in the save's receipt ring could
 * have been evicted, so the credit refuses rather than risk paying twice.
 *
 * `level` overrides the payee's own level (the Team Arena pays every member
 * at the lowest fighter's level, so an alt pays alt money).
 */
export async function creditActivityPurse(o: {
    mode: Exclude<ActivityPurseMode, 'spire'>;
    playerSlug: string;
    outcomeId: string;
    startedAt: number;
    minutes: number;
    factor?: number;
    level?: number;
    now?: number;
}): Promise<ActivityPurseCredit> {
    const minutes = Math.max(0, Math.min(ACTIVITY_PURSE_MAX_MINUTES, Number(o.minutes) || 0));
    if (activityPurseAMult(o.mode) <= 0) return { ryo: 0, minutes, reason: 'off' };
    const identity = purseReceipt(o.mode, o.outcomeId, o.playerSlug);
    try {
        const out = await retryOnSaveVersionConflict(() => mutatePlayerSave<ActivityPurseResult>(o.playerSlug, ({ character }) => {
            const inspected = inspectSettlementReceipt(character, identity.requestId, identity.fingerprint);
            const unwritten = (value: ActivityPurseResult) => ({ ok: true as const, write: false, character, value });
            if (inspected.status === 'replay') {
                return unwritten({ ryo: Math.max(0, Math.floor(Number(inspected.receipt.value.ryo) || 0)), minutes, reason: 'already-paid' });
            }
            if (inspected.status !== 'fresh') return unwritten({ ryo: 0, minutes, reason: 'invalid-receipt' });
            if (!receiptAbsenceProvable(inspected.receipts, SERVER_SETTLEMENT_RECEIPT_LIMIT, 'settledAt', o.startedAt)) {
                return unwritten({ ryo: 0, minutes, reason: 'receipt-unprovable' });
            }
            const ryo = activityPurseRyo(o.mode, o.level ?? character.level, minutes, o.factor ?? 1);
            if (ryo <= 0) return unwritten({ ryo: 0, minutes, reason: 'nothing-earned' });
            const now = o.now ?? Date.now();
            return {
                ok: true,
                character: appendSettlementReceipt(
                    { ...character, ryo: Math.max(0, Number(character.ryo) || 0) + ryo },
                    inspected.receipts,
                    { ...identity, value: { mode: o.mode, outcomeId: o.outcomeId, ryo, minutes }, settledAt: now },
                ),
                value: { ryo, minutes },
                afterCommit: () => recordActivityPurse(o.mode, o.playerSlug, o.outcomeId, ryo),
            };
        }));
        return out.ok
            ? { ...out.value, save: { character: out.character, _saveVersion: out._saveVersion } }
            : { ryo: 0, minutes, reason: 'no-save' };
    } catch {
        // The outcome stays settleable; the next settle request retries the purse.
        return { ryo: 0, minutes, reason: 'contended' };
    }
}
