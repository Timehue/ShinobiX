/*
 * Village-War mercenaries — pure cost + lease math (Phase 5, §17.5 "Option B").
 *
 * Hiring a tier fields an AI shinobi band for ONE war (owner redesign
 * 2026-10-08): the village's all-out village war, or a Combat sector war the
 * village DEFENDS. This module is the IO-free economy core: the WR hire cost
 * (tier base × comeback discount × Barracks discount), the per-war hire
 * allowances, and the band (lease) helpers the /api/village/war-merc endpoint
 * and the deploy core mutate under a lock. The AI fighter and the headless
 * battle live in api/towers/_merc-fighters.ts.
 *
 * Its live endpoint is protected by the default-on Sector Map campaign gate.
 */
import {
    wrMercTierById,
    comebackCostMultiplier,
    mercBandSize,
    MERC_HIRES_PER_VILLAGE_WAR_KAGE,
    MERC_HIRES_PER_VILLAGE_WAR_ELDER,
    MERC_HIRES_PER_SECTOR_CONTEST,
} from './_war-economy.js';
import { mercCostMultiplier } from './_war-structures.js';
import { mercContextKey, type VillageWarRecord, type MercLease, type MercLeaseContext, type MercHireReceipt } from './_war-state.js';

// A merc contract lasts 2 days (the §6.3 "2-day contract").
export const MERC_LEASE_MS = 2 * 24 * 60 * 60 * 1000;
/** How long a hire receipt outlives its war, so a late retry still replays. */
export const MERC_HIRE_RECEIPT_GRACE_MS = 24 * 60 * 60 * 1000;

/** WR to hire `tierId` for a village holding `sectorsHeld` sectors: the tier's
 *  base cost × the comeback discount (0 sectors → free / 1 → 75% off / ≥2 → full)
 *  × the Barracks discount. Rounded, floored at 0. Returns 0 for an unknown tier
 *  (the caller rejects the hire before that matters). */
export function mercHireCost(tierId: string, sectorsHeld: number, record: VillageWarRecord): number {
    const tier = wrMercTierById(tierId);
    if (!tier) return 0;
    const afterComeback = tier.costWr * comebackCostMultiplier(sectorsHeld);
    const afterBarracks = afterComeback * mercCostMultiplier(record);
    return Math.max(0, Math.round(afterBarracks));
}

// The three helpers below address LEGACY (tier, hirer) leases — the shape hired
// before the 2026-10-08 redesign. They never touch a band bound to a war, even
// one with the same tier and hirer. The hire route no longer mints legacy leases.

/** Add (or refresh) a player's lease for a tier: a single active lease per
 *  (tier, player), its 2-day clock restarted on re-hire. Pure. */
export function addOrRefreshLease(leases: readonly MercLease[], tierId: string, player: string, now: number): MercLease[] {
    const key = `${tierId}:${player}`;
    const next = leases.filter((l) => mercBandKey(l) !== key);
    next.push({ tierId, player, expiresAt: now + MERC_LEASE_MS, count: mercBandSize(tierId) });
    return next;
}

/** Whether `player` holds an active (unexpired) lease for `tierId` at `now`. */
export function hasActiveLease(record: VillageWarRecord, tierId: string, player: string, now: number): boolean {
    const key = `${tierId}:${player}`;
    return record.mercLeases.some((l) => mercBandKey(l) === key && l.expiresAt > now);
}

/** Remove a player's lease for a tier (consumed after the merc fights). Pure. */
export function consumeLease(leases: readonly MercLease[], tierId: string, player: string): MercLease[] {
    const key = `${tierId}:${player}`;
    return leases.filter((l) => mercBandKey(l) !== key);
}

/** Claim ONE merc from the caller's active band for a deployment: decrement the
 *  band count, dropping the lease entirely when it hits 0. Each merc attack spends
 *  one merc (win, lose, or stall), so a 3-5 band = 3-5 attacks. Returns whether a
 *  merc was available + how many remain. Pure. Addresses a LEGACY (tier, hirer)
 *  band; a bound band is claimed by its key (claimMercFromBandKey). */
export function claimMercFromBand(
    leases: readonly MercLease[],
    tierId: string,
    player: string,
    now: number,
): { leases: MercLease[]; claimed: boolean; remaining: number } {
    return claimMercFromBandKey(leases, `${tierId}:${player}`, now);
}

// ── Bands (owner redesign 2026-10-08) ─────────────────────────────────────────

/** The key a band is addressed by: its id when it is bound to a war, else the
 *  legacy (tier, hirer) pair. Matches the normalizer's dedupe identity. */
export function mercBandKey(lease: Pick<MercLease, 'id' | 'context' | 'tierId' | 'player'>): string {
    return lease.id && lease.context ? `id:${lease.id}` : `${lease.tierId}:${lease.player}`;
}

/** Claim ONE merc from the band addressed by `bandKey` (see claimMercFromBand). Pure. */
export function claimMercFromBandKey(
    leases: readonly MercLease[],
    bandKey: string,
    now: number,
): { leases: MercLease[]; claimed: boolean; remaining: number } {
    const next = leases.map((l) => ({ ...l }));
    const lease = next.find((l) => mercBandKey(l) === bandKey && l.expiresAt > now);
    if (!lease || lease.count <= 0) return { leases: next, claimed: false, remaining: 0 };
    lease.count -= 1;
    const remaining = lease.count;
    const pruned = remaining > 0 ? next : next.filter((l) => mercBandKey(l) !== bandKey);
    return { leases: pruned, claimed: true, remaining };
}

/** Whether a band serves `context`. A legacy (unbound) band keeps serving its own
 *  village's all-out village war, as before the redesign, and never a sector war. */
export function leaseServes(lease: Pick<MercLease, 'context'>, context: MercLeaseContext): boolean {
    if (!lease.context) return context.kind === 'village';
    return mercContextKey(lease.context) === mercContextKey(context);
}

/** The bands that act in `context` right now: unexpired, not empty, bound to it. */
export function bandsServing(leases: readonly MercLease[], context: MercLeaseContext, now: number): MercLease[] {
    return leases.filter((l) => l.expiresAt > now && l.count > 0 && leaseServes(l, context));
}

/** A hire's id from the client's per-click request id: the same click retried
 *  after a lost response maps to the same hire, which then replays. */
export function mercHireId(requestId: unknown): string | null {
    const raw = String(requestId ?? '').trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? `mh_${raw}` : null;
}

/** Hire receipts still worth keeping at `now` (their war could still be live,
 *  or a late retry could still ask for them). */
export function pruneMercHires(receipts: readonly MercHireReceipt[], now: number): MercHireReceipt[] {
    return receipts.filter((r) => r.keepUntil > now);
}

/** Hire allowance of one seat in an all-out village war. */
export function villageWarSeatLimit(seat: string): number {
    return seat === 'kage' ? MERC_HIRES_PER_VILLAGE_WAR_KAGE : MERC_HIRES_PER_VILLAGE_WAR_ELDER;
}

export interface MercHireAllowance {
    /** The seat the next hire would spend, or null when every allowance is used. */
    seat: string | null;
    /** Hires already made in this war (all seats). */
    used: number;
    /** The war's total allowance (village war: Kage 3 + 3 Elder seats). */
    limit: number;
    /** How many more hires THIS caller may make. */
    callerLeft: number;
    /** Village war only: per-seat use, for display. */
    seats?: Array<{ seat: string; used: number; limit: number }>;
}

/**
 * Who may still hire for a war, and against which allowance.
 *
 * Village war — PER SEAT, not per person: the Kage seat 3, each Elder seat 1.
 * The Kage re-appoints the First Elder at will, so a per-person count would let
 * a Kage mint a fresh hire with every appointment; a seat keeps its count for
 * the whole war whoever holds it. A leader holding two seats spends the Kage
 * allowance first.
 *
 * Sector contest — 3 hires in all, by the Kage or any Elder of the defender.
 *
 * `callerSeats` are the seats the caller holds ('kage', 'elder-1'..'elder-3');
 * empty for a non-leader, who can never hire. Pure.
 */
export function mercHireAllowance(
    receipts: readonly MercHireReceipt[],
    context: MercLeaseContext,
    callerSeats: readonly string[],
): MercHireAllowance {
    const key = mercContextKey(context);
    const inWar = receipts.filter((r) => r.context === key);
    if (context.kind === 'sector') {
        const left = Math.max(0, MERC_HIRES_PER_SECTOR_CONTEST - inWar.length);
        const callerLeft = callerSeats.length ? left : 0;
        return { seat: callerLeft > 0 ? callerSeats[0] : null, used: inWar.length, limit: MERC_HIRES_PER_SECTOR_CONTEST, callerLeft };
    }
    const allSeats = ['kage', 'elder-1', 'elder-2', 'elder-3'];
    const seats = allSeats.map((seat) => ({ seat, used: inWar.filter((r) => r.seat === seat).length, limit: villageWarSeatLimit(seat) }));
    const mine = seats.filter((s) => callerSeats.includes(s.seat));
    const open = mine.find((s) => s.used < s.limit) ?? null;
    return {
        seat: open?.seat ?? null,
        used: inWar.length,
        limit: seats.reduce((n, s) => n + s.limit, 0),
        callerLeft: mine.reduce((n, s) => n + Math.max(0, s.limit - s.used), 0),
        seats,
    };
}

/**
 * The band + receipt for one hire. The lease runs the 2-day contract, but never
 * past its war's own end (`contextEndsAt`): a band only serves the war it was
 * hired for, so it has nothing to do afterwards and no reason to keep eating
 * the village's rations. Pure.
 */
export function newBoundBand(args: {
    id: string;
    tierId: string;
    player: string;
    seat: string;
    context: MercLeaseContext;
    contextEndsAt: number;
    cost: number;
    now: number;
}): { lease: MercLease; receipt: MercHireReceipt } {
    const expiresAt = Math.min(args.now + MERC_LEASE_MS, Math.max(args.now + 1, args.contextEndsAt));
    const lease: MercLease = {
        tierId: args.tierId,
        player: args.player,
        expiresAt,
        count: mercBandSize(args.tierId),
        id: args.id,
        context: args.context,
    };
    const receipt: MercHireReceipt = {
        id: args.id,
        context: mercContextKey(args.context),
        seat: args.seat,
        player: args.player,
        tierId: args.tierId,
        cost: Math.max(0, Math.floor(args.cost)),
        at: args.now,
        expiresAt,
        keepUntil: Math.max(expiresAt, args.contextEndsAt) + MERC_HIRE_RECEIPT_GRACE_MS,
    };
    return { lease, receipt };
}
