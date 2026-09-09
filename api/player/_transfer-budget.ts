import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { ACCOUNT_AGE_MIN_MS } from '../pvp/_vanguard-rewards.js';
import { ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';
import { isUnclaimedGuest } from '../_guest-gate.js';
import type { TradeCurrency } from './_trade-core.js';

/*
 * Rolling SEND-side transfer budget.
 *
 * The per-transfer caps (TRADE_CAPS) read like a real limit and were not one:
 * at 20 calls per 60 s the effective ceiling was 4,000,000 ryo a minute. This
 * adds the aggregate the caps imply.
 *
 * WHY SEND-SIDE ONLY, AND WHY NOTHING IS ADDED TO RECEIVING
 *
 * RuneScape ran the other experiment. Its 2008 trade limit capped what players
 * could give away, broke legitimate play (merchanting, gifting, helping a
 * friend) and was removed in 2011 as a failure. The lesson the genre took is
 * that RMT controls belong on the SENDER and on untrusted accounts, never on
 * everyone: a real player receiving a gift has done nothing suspicious, and a
 * new player receiving help is the case you most want to work.
 *
 * So: a trusted sender's ceiling is set high enough that ordinary generosity
 * never touches it, an untrusted sender (guest / brand new / under level 10)
 * gets a much lower one, and receiving is untouched at every tier.
 *
 * WHY ROLLING, NOT A UTC DAY
 *
 * Every other daily cap here is UTC-day keyed, which is right for content. It
 * is wrong for an anti-abuse ceiling: a day boundary is doubled for free by
 * sending at 23:59 and again at 00:01, and a cap with a known workaround just
 * selects for the players who know the trick.
 *
 * No new magnitudes are invented. The trust thresholds are numbers the owner has
 * already blessed elsewhere (72 h account age from the Vanguard reward path,
 * level 10 from the PvP newcomer floor), and none of them can be bought.
 */

export const TRANSFER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A settled account: high enough that ordinary play never reaches it. */
export const TRUSTED_OUTBOUND: Record<TradeCurrency, number> = {
    ryo: 1_000_000, fateShards: 1_000, boneCharms: 1_000, auraStones: 1_000,
};

/** A guest, a brand-new account, or one below the PvP newcomer floor. */
export const RESTRICTED_OUTBOUND: Record<TradeCurrency, number> = {
    ryo: 25_000, fateShards: 25, boneCharms: 25, auraStones: 25,
};

export type TransferTier = 'trusted' | 'restricted';

type Stamp = [number, number];
type Ledger = { stamps: Stamp[] };

export function transferBudgetKey(slug: string, currency: TradeCurrency): string {
    return `xfer:out:${slug}:${currency}`;
}

export function outboundLimit(currency: TradeCurrency, tier: TransferTier): number {
    return (tier === 'restricted' ? RESTRICTED_OUTBOUND : TRUSTED_OUTBOUND)[currency];
}

/** Sum of what is still inside the rolling window, discarding what aged out. */
export function sumWindow(stamps: unknown, now: number): { spent: number; kept: Stamp[] } {
    const cutoff = now - TRANSFER_WINDOW_MS;
    const kept: Stamp[] = [];
    let spent = 0;
    if (Array.isArray(stamps)) {
        for (const raw of stamps) {
            if (!Array.isArray(raw) || raw.length < 2) continue;
            const at = Math.floor(Number(raw[0]));
            const amount = Math.floor(Number(raw[1]));
            if (!Number.isFinite(at) || !Number.isFinite(amount) || amount <= 0) continue;
            if (at <= cutoff) continue;
            kept.push([at, amount]);
            spent += amount;
        }
    }
    return { spent, kept };
}

/**
 * Which ceiling applies to this sender.
 *
 * Fails OPEN to 'trusted' on anything unknowable — a missing `createdAt` (legacy
 * saves predate it) or a storage error must never strand a real player's
 * transfer. That mirrors the `loserCreated > 0` guard the Vanguard path already
 * uses for the same reason.
 */
export async function senderTrustTier(slug: string, character: Record<string, unknown> | null): Promise<TransferTier> {
    try {
        if (await isUnclaimedGuest(slug)) return 'restricted';
    } catch { /* unknowable — fall through to the save-based checks */ }
    if (!character) return 'trusted';
    const level = Math.floor(Number(character.level ?? 0)) || 0;
    if (level > 0 && level < ATTACKABLE_MIN_LEVEL) return 'restricted';
    const createdAt = Math.floor(Number(character.createdAt ?? 0)) || 0;
    if (createdAt > 0 && Date.now() - createdAt < ACCOUNT_AGE_MIN_MS) return 'restricted';
    return 'trusted';
}

export type BudgetCheck =
    | { ok: true; spent: number; limit: number; remaining: number }
    | { ok: false; spent: number; limit: number; remaining: number; error: string };

export async function checkOutboundBudget(
    slug: string, currency: TradeCurrency, amount: number, tier: TransferTier, now = Date.now(),
): Promise<BudgetCheck> {
    const limit = outboundLimit(currency, tier);
    let spent = 0;
    try {
        const ledger = await kv.get<Ledger>(transferBudgetKey(slug, currency));
        spent = sumWindow(ledger?.stamps, now).spent;
    } catch {
        // A storage hiccup must not block a legitimate transfer; the debit path
        // below is still authoritative and the per-transfer cap still applies.
        return { ok: true, spent: 0, limit, remaining: limit };
    }
    const remaining = Math.max(0, limit - spent);
    if (amount > remaining) {
        return {
            ok: false, spent, limit, remaining,
            error: remaining > 0
                ? `You can send ${remaining.toLocaleString()} more ${currency} today.`
                : `You have reached today's ${currency} transfer limit. It frees up as your earlier transfers age out.`,
        };
    }
    return { ok: true, spent, limit, remaining: remaining - amount };
}

/** How many stamps a ledger row may hold before the oldest are coalesced. */
const MAX_STAMPS = 200;

/**
 * Bound the row WITHOUT losing spend.
 *
 * This used to be `kept.slice(-200)`, which dropped the oldest stamps outright
 * — and the oldest stamps are still INSIDE the 24h window, so their spend was
 * forgiven. That handed the budget a self-reset: at 30 calls/minute the cap is
 * reachable in about seven minutes of tiny transfers, after which every further
 * gift evicted one of the sender's own earlier (possibly very large) spends.
 *
 * Instead the overflow is merged into one aggregate stamp that preserves the
 * total. It is dated at the NEWEST timestamp in the merged group, never the
 * oldest, so the merge can only ever hold budget longer — it must not release
 * spend early, which is the failure being fixed.
 */
function boundStamps(kept: Stamp[]): Stamp[] {
    if (kept.length <= MAX_STAMPS) return kept;
    const merged = kept.slice(0, kept.length - (MAX_STAMPS - 1));
    let total = 0;
    let newest = 0;
    for (const [ts, amount] of merged) {
        total += amount;
        if (ts > newest) newest = ts;
    }
    return [[newest, total], ...kept.slice(kept.length - (MAX_STAMPS - 1))];
}

/**
 * Record a committed transfer against the window.
 *
 * Under the lock on the LEDGER key, because this is a read-modify-write on
 * shared state and all three send doors (/api/player/trade and both treasury
 * transfers) reach it. Unlocked, concurrent charges each read the same ledger
 * and the last write won, so a pipelined burst left roughly ONE stamp behind
 * and the 24h budget never accumulated at all — the cap read like a limit and
 * was not one, which is the exact failure this whole module was written to fix.
 *
 * ⚠ This lock must stay INNERMOST. /api/player/trade calls this while holding
 * the sender and recipient save locks, so anything that took the ledger lock
 * and then reached for a save lock would close a deadlock cycle. Nothing inside
 * here acquires another lock, and no caller should hold this one across a
 * settlement.
 *
 * Still best-effort on failure: the transfer has already committed by the time
 * this runs, so losing a stamp must never fail the transfer.
 */
export async function chargeOutboundBudget(
    slug: string, currency: TradeCurrency, amount: number, now = Date.now(),
): Promise<void> {
    const key = transferBudgetKey(slug, currency);
    try {
        await withKvLock(key, async () => {
            const ledger = await kv.get<Ledger>(key);
            const { kept } = sumWindow(ledger?.stamps, now);
            kept.push([now, Math.max(0, Math.floor(amount))]);
            await kv.set(key, { stamps: boundStamps(kept) }, { ex: Math.ceil((TRANSFER_WINDOW_MS * 2) / 1000) });
        }, { failClosed: true });
    } catch { /* the transfer already committed; losing the stamp is not worth failing it */ }
}
