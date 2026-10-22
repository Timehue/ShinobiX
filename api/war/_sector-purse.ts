/*
 * The sector-war purse (2026-10 rebalance, framework #7 / section 2.9).
 *
 * A sector war used to pay its fighters nothing but the capture credit. Now each
 * fighter earns ryo for the battles they WON in it, at their level:
 *
 *   ryo = round(min(points, 200) x k x A(L) x WAR_PURSE_SCALE)
 *   points = 20 per credited win, k = 0.3 for the side that captured or held,
 *            0.12 for the side that failed; at least 30 points (two wins).
 *
 * Points are CREDITED WINS, not the war's role-weighted tally points: a single
 * Kage-on-Kage win scores 80 tally points and a villager felling a Kage 55, so
 * paying on tally points would let one fed fight reach most of the cap. 20 per
 * win matches what a village-campaign PvP win pays. A win over a mercenary band
 * counts a quarter and a garrison assault half, the same fractions their tally
 * points carry; a garrison holding the sector by itself counts for nobody.
 *
 * WHEN the purse exists. A captured or defended war ran its full 72 hours. A war
 * the attacking Kage abandons pays only if it ran at least 48 hours (framework
 * "needs >= 48 h of war"), the defenders at the hold rate: abandoning at hour 70
 * cannot cancel the defence's purse, and abandoning early pays nobody.
 *
 * HOW it is paid. Settlement must never wait on reward bookkeeping, so the purse
 * ledger is built AFTER the verdict is durable, from the war's battle receipts,
 * and written once to its own TTL'd row `shared:sector-war-purse:<id>:<instance>`
 * (the `-purse` suffix keeps it out of the `shared:sector-war:*` contest scan).
 * A failed write is retried by the sweep, which the 5-minute settlement tick
 * runs while the settled contest row still exists. A receipt that cannot be
 * read is skipped and logged ([sector-purse]), never thrown. The claim (api/war/claim-reward.ts,
 * kind 'sector') pays every unclaimed ledger the player has an entry in, once,
 * marked in the existing `claimedWarCrateIds` payout stamp: no save field is
 * added. There is no weekly cap (owner amendment A4: no ryo caps): a credited
 * win pays at most ~0.43 x A per fighting minute, well under the parity band,
 * so fed wins are a poor farm, and the per-war cap bounds a single war.
 */

import { kv, type KvLike } from '../_storage.js';
import { safeName } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import {
    GARRISON_POINTS_FRACTION,
    MERC_REPEL_POINTS_FRACTION,
    normalizeSectorWarSession,
    parseSectorWarExternalBattleReceipt,
    sectorWarBattleReceiptPrefix,
    sectorWarInstanceTag,
    type SectorWarBattleReceipt,
    type SectorWarSession,
} from '../_sector-war.js';
import { warAccountOldEnough, warPurseScale, type WarRewardCharacter } from './_reward.js';

export const SECTOR_PURSE_POINTS_PER_WIN = 20;
export const SECTOR_PURSE_POINT_CAP = 200;
export const SECTOR_PURSE_MIN_POINTS = 30;
export const SECTOR_PURSE_WIN_K = 0.3;
export const SECTOR_PURSE_LOSE_K = 0.12;
export const SECTOR_PURSE_MIN_WAR_MS = 48 * 60 * 60 * 1000;
export const SECTOR_PURSE_CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The claim window plus a day, so a ledger the sweep writes late still covers it. */
export const SECTOR_PURSE_TTL_SEC = 8 * 24 * 60 * 60;
export const SECTOR_PURSE_KEY_PREFIX = 'shared:sector-war-purse:';
const SECTOR_WAR_CONTEST_PREFIX = 'shared:sector-war:';
/** At most this many ledgers written per sweep (a backlog drains over passes). */
const SWEEP_WRITE_LIMIT = 20;

export type SectorWarPurseOutcome = 'captured' | 'defended' | 'abandoned';

export interface SectorWarPurseLedger {
    version: 1;
    contestId: string;
    instance: string;
    sector: number;
    outcome: SectorWarPurseOutcome;
    /** The side paid at the higher rate: the captor, or the defence that held. */
    winnerVillage: string;
    loserVillage: string;
    startedAt: number;
    endedAt: number;
    settledAt: number;
    /** safeName slug → purse points and the side they were won for. */
    entries: Record<string, { points: number; side: string }>;
}

export function sectorWarPurseKey(contestId: string, instance: string): string {
    return `${SECTOR_PURSE_KEY_PREFIX}${contestId}:${instance}`;
}

/** The claim marker in `claimedWarCrateIds`. */
export function sectorPurseMarker(ledger: Pick<SectorWarPurseLedger, 'contestId' | 'instance'>): string {
    return `sector-purse:${ledger.contestId}:${ledger.instance}`;
}

/** How much one battle receipt counts toward its winner's purse, in wins. */
export function sectorPurseWinWeight(receipt: Pick<SectorWarBattleReceipt, 'battleId' | 'attackerWon' | 'points' | 'by' | 'garrison'>): number {
    if (!(Number(receipt.points) > 0) || !safeName(String(receipt.by ?? ''))) return 0;
    // A garrison that held the sector by itself: an AI won it, no player did.
    if (receipt.garrison && !receipt.attackerWon) return 0;
    if (receipt.garrison) return GARRISON_POINTS_FRACTION;
    if (String(receipt.battleId).startsWith('merc:')) return MERC_REPEL_POINTS_FRACTION;
    return 1;
}

/** The verdict a terminal contest row pays on, or null when it pays no purse. */
function purseVerdict(session: SectorWarSession): { outcome: SectorWarPurseOutcome; winner: string; loser: string; endedAt: number; settledAt: number } | null {
    if (session.flipped) {
        return { outcome: 'captured', winner: session.attackerVillage, loser: session.defenderVillage, endedAt: session.endsAt, settledAt: Number(session.updatedAt) || session.endsAt };
    }
    const expiredAt = Number(session.expiredAt);
    if (!(expiredAt > 0)) return null;
    if (session.expiredReason === 'abandoned') {
        if (expiredAt - session.startedAt < SECTOR_PURSE_MIN_WAR_MS) return null;
        return { outcome: 'abandoned', winner: session.defenderVillage, loser: session.attackerVillage, endedAt: expiredAt, settledAt: expiredAt };
    }
    return { outcome: 'defended', winner: session.defenderVillage, loser: session.attackerVillage, endedAt: session.endsAt, settledAt: expiredAt };
}

/** The purse ledger of a settled war from its receipts (deduped by battle id), or null when the war pays no purse. Pure. */
export function buildSectorWarPurseLedger(session: SectorWarSession, receipts: readonly SectorWarBattleReceipt[]): SectorWarPurseLedger | null {
    const verdict = purseVerdict(session);
    if (!verdict) return null;
    const wins = new Map<string, { wins: number; side: string }>();
    const seen = new Set<string>();
    for (const receipt of receipts) {
        if (!receipt || seen.has(receipt.battleId)) continue;
        seen.add(receipt.battleId);
        const weight = sectorPurseWinWeight(receipt);
        if (weight <= 0) continue;
        const slug = safeName(receipt.by);
        const side = receipt.attackerWon ? session.attackerVillage : session.defenderVillage;
        const prior = wins.get(slug);
        // A fighter's wins count for the side they won them for; a player who
        // changed sides mid-war keeps the side of their first credited win.
        if (prior && prior.side !== side) continue;
        wins.set(slug, { wins: (prior?.wins ?? 0) + weight, side });
    }
    const entries: SectorWarPurseLedger['entries'] = {};
    for (const [slug, entry] of wins) {
        Object.defineProperty(entries, slug, {
            value: { points: Math.round(entry.wins * SECTOR_PURSE_POINTS_PER_WIN), side: entry.side },
            enumerable: true, writable: true, configurable: true,
        });
    }
    return {
        version: 1,
        contestId: session.id,
        instance: sectorWarInstanceTag(session),
        sector: session.sector,
        outcome: verdict.outcome,
        winnerVillage: verdict.winner,
        loserVillage: verdict.loser,
        startedAt: session.startedAt,
        endedAt: verdict.endedAt,
        settledAt: verdict.settledAt,
        entries,
    };
}

/** Strict reader; null for anything that is not a v1 ledger. */
export function parseSectorWarPurseLedger(raw: unknown): SectorWarPurseLedger | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    if (v.version !== 1 || typeof v.contestId !== 'string' || typeof v.instance !== 'string'
        || !['captured', 'defended', 'abandoned'].includes(String(v.outcome))
        || typeof v.winnerVillage !== 'string' || typeof v.loserVillage !== 'string'
        || !Number.isFinite(Number(v.settledAt)) || !Number.isFinite(Number(v.endedAt))
        || !v.entries || typeof v.entries !== 'object' || Array.isArray(v.entries)) return null;
    const entries: SectorWarPurseLedger['entries'] = {};
    for (const [slug, entry] of Object.entries(v.entries as Record<string, unknown>)) {
        const e = entry as { points?: unknown; side?: unknown } | null;
        const points = Math.floor(Number(e?.points));
        if (!e || !Number.isSafeInteger(points) || points <= 0 || typeof e.side !== 'string') continue;
        Object.defineProperty(entries, slug, { value: { points, side: e.side }, enumerable: true, writable: true, configurable: true });
    }
    return {
        version: 1,
        contestId: v.contestId,
        instance: v.instance,
        sector: Math.floor(Number(v.sector) || 0),
        outcome: v.outcome as SectorWarPurseOutcome,
        winnerVillage: v.winnerVillage,
        loserVillage: v.loserVillage,
        startedAt: Math.floor(Number(v.startedAt) || 0),
        endedAt: Number(v.endedAt),
        settledAt: Number(v.settledAt),
        entries,
    };
}

export type SectorPursePaid = { id: string; ryo: number; sector: number; outcome: SectorWarPurseOutcome; contestId: string; instance: string };

/** Pay every unclaimed sector-war purse in `ledgers` this character earned. Pure. */
export function settleSectorWarPurses(
    character: WarRewardCharacter,
    ledgers: readonly SectorWarPurseLedger[],
    now: number,
    dials: { purseScale: number } = { purseScale: warPurseScale() },
): { character: WarRewardCharacter; granted: boolean; purses: SectorPursePaid[]; ryo: number } {
    const village = String(character.village ?? '').trim();
    const slug = safeName(String(character.name ?? ''));
    const claimed = new Set((character.claimedWarCrateIds ?? []).map(String));
    const purses: SectorPursePaid[] = [];
    if (!(dials.purseScale > 0) || !village || !slug) return { character, granted: false, purses, ryo: 0 };
    const level = Number(character.level);
    for (const ledger of ledgers) {
        const marker = sectorPurseMarker(ledger);
        if (claimed.has(marker) || now - ledger.settledAt > SECTOR_PURSE_CLAIM_WINDOW_MS || now < ledger.settledAt) continue;
        const entry = Object.prototype.hasOwnProperty.call(ledger.entries, slug) ? ledger.entries[slug] : null;
        // Paid to the side the wins were for, and only while the fighter is
        // still in that village: a defector does not collect the old side's purse.
        if (!entry || entry.side !== village || entry.points < SECTOR_PURSE_MIN_POINTS) continue;
        if (!warAccountOldEnough(character, ledger.endedAt)) continue;
        const k = ledger.winnerVillage === village ? SECTOR_PURSE_WIN_K : SECTOR_PURSE_LOSE_K;
        const ryo = Math.round(Math.min(entry.points, SECTOR_PURSE_POINT_CAP) * k * anchorRyoPerMinute(level) * dials.purseScale);
        if (ryo <= 0) continue;
        claimed.add(marker);
        purses.push({ id: marker, ryo, sector: ledger.sector, outcome: ledger.outcome, contestId: ledger.contestId, instance: ledger.instance });
    }
    if (!purses.length) return { character, granted: false, purses, ryo: 0 };
    const total = purses.reduce((sum, p) => sum + p.ryo, 0);
    const ryoNow = Number(character.ryo);
    return {
        character: {
            ...character,
            ryo: (Number.isFinite(ryoNow) ? ryoNow : 0) + total,
            claimedWarCrateIds: [...(character.claimedWarCrateIds ?? []).map(String), ...purses.map((p) => p.id)],
        },
        granted: true,
        purses,
        ryo: total,
    };
}

// ── IO ───────────────────────────────────────────────────────────────────────

type PurseStore = Pick<KvLike, 'get' | 'set' | 'keys' | 'mget'>;

/** Every battle receipt of the war, from the row's mirror and the external
 *  copies, skipping (and logging) any that cannot be read. Never throws for a
 *  bad receipt: reward bookkeeping must not hold anything up. */
async function readPurseReceipts(session: SectorWarSession, store: PurseStore): Promise<SectorWarBattleReceipt[]> {
    const out: SectorWarBattleReceipt[] = [...(session.appliedBattles ?? [])];
    const prefix = sectorWarBattleReceiptPrefix(session);
    const keys = (await store.keys(`${prefix}*`)).filter((key) => key.startsWith(prefix));
    if (!keys.length) return out;
    const raws = await store.mget<unknown[]>(...keys);
    raws.forEach((raw, index) => {
        if (raw === null) return;
        const parsed = parseSectorWarExternalBattleReceipt(raw);
        if (!parsed || parsed.contestId !== session.id || `${prefix}${parsed.receipt.battleId}` !== keys[index]) {
            console.warn('[sector-purse] skipped an unreadable battle receipt', safeLogValue(keys[index], 160));
            return;
        }
        out.push(parsed.receipt);
    });
    return out;
}

/**
 * Write the purse ledger of a settled war once. Idempotent (NX): a retry, or the
 * sweep after a settlement that already wrote it, changes nothing; receipts are
 * immutable, so any attempt would write the same ledger. Never throws.
 */
export async function recordSectorWarPurseLedger(session: SectorWarSession, store: PurseStore = kv): Promise<'written' | 'exists' | 'none' | 'failed'> {
    try {
        if (!purseVerdict(session)) return 'none';
        const key = sectorWarPurseKey(session.id, sectorWarInstanceTag(session));
        if (await store.get(key)) return 'exists';
        const ledger = buildSectorWarPurseLedger(session, await readPurseReceipts(session, store));
        if (!ledger) return 'none';
        const placed = await store.set(key, ledger, { nx: true, ex: SECTOR_PURSE_TTL_SEC });
        return placed === 'OK' ? 'written' : 'exists';
    } catch (error) {
        console.error('[sector-purse] ledger write failed; the sweep retries it', safeLogValue(session.id, 160), safeLogValue(error));
        return 'failed';
    }
}

/**
 * Write the ledger of every settled war that still lacks one: a settlement
 * whose ledger write failed, and abandoned wars, which settle outside the
 * settlement pass. Runs while the settled contest rows still exist (a defended
 * or abandoned row lives 24 h, a captured one 7 days). Never throws.
 */
export async function sweepSectorWarPurseLedgers(store: PurseStore = kv): Promise<number> {
    try {
        const keys = await store.keys(`${SECTOR_WAR_CONTEST_PREFIX}*`);
        if (!keys.length) return 0;
        const raws = await store.mget<unknown[]>(...keys);
        const settled: SectorWarSession[] = [];
        raws.forEach((raw) => {
            if (!raw) return;
            try {
                const session = normalizeSectorWarSession(raw as Partial<SectorWarSession>);
                if (session && purseVerdict(session)) settled.push(session);
            } catch { /* an unreadable contest row is the contest scans' to report */ }
        });
        if (!settled.length) return 0;
        const ledgerKeys = settled.map((s) => sectorWarPurseKey(s.id, sectorWarInstanceTag(s)));
        const existing = await store.mget<unknown[]>(...ledgerKeys);
        let written = 0;
        for (let i = 0; i < settled.length && written < SWEEP_WRITE_LIMIT; i += 1) {
            if (existing[i]) continue;
            if (await recordSectorWarPurseLedger(settled[i], store) === 'written') written += 1;
        }
        return written;
    } catch (error) {
        console.error('[sector-purse] sweep failed', safeLogValue(error));
        return 0;
    }
}

/** Every live purse ledger (the TTL keeps this to the last ~8 days of sector wars). */
export async function listSectorWarPurseLedgers(store: Pick<KvLike, 'keys' | 'mget'> = kv): Promise<SectorWarPurseLedger[]> {
    const keys = (await store.keys(`${SECTOR_PURSE_KEY_PREFIX}*`)).filter((key) => key.startsWith(SECTOR_PURSE_KEY_PREFIX));
    if (!keys.length) return [];
    const raws = await store.mget<unknown[]>(...keys);
    return raws.flatMap((raw) => {
        const ledger = parseSectorWarPurseLedger(raw);
        return ledger ? [ledger] : [];
    });
}
