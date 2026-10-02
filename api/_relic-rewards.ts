import { createHmac, randomBytes } from 'node:crypto';
import { grantRelic, RELIC_ROSTER } from '../shared/relics.js';

export type RelicRollProof = {
    kind: 'pvp' | 'tower'; id: string; eventAt: number; level: number;
    opponent?: string; floor?: number;
};
export type RelicRollOutcome = { itemId?: string; fateShards?: number; reason?: string };
type LedgerEntry = RelicRollOutcome & { id: string; opponent?: string };
type LedgerDay = { day: string; pvp: LedgerEntry[]; tower: LedgerEntry[] };
export const RELIC_DAILY_ROLL_CAP = { pvp: 10, tower: 5 } as const;
const DAY_MS = 86_400_000;
// Battle IDs are public (and PvP accepts client-generated UUIDs). Keep the roll
// unknowable before settlement. The ledger, not this process key, preserves the
// committed outcome across restarts or settlement on a different worker.
const RELIC_ROLL_KEY = randomBytes(32);

/** One weighted roll across every unlocked source; each configured chance is
 * absolute, so adding another source never dilutes an existing relic's odds. */
export function relicDropPool(kind: 'pvp' | 'tower' | 'war-crate', level: number, floor?: number) {
    return RELIC_ROSTER.flatMap(item => {
        if (!Number.isFinite(level) || level < item.levelReq) return [];
        const source = [item.source, ...(item.extraSources ?? [])].find(source => source.kind === kind
            && (source.kind !== 'tower' || (Number.isFinite(floor) && Number(floor) >= source.minFloor)));
        return source && 'chance' in source ? [{ item, chance: source.chance }] : [];
    });
}

export function relicForDropRoll(pool: ReturnType<typeof relicDropPool>, roll: number): string | undefined {
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return undefined;
    let boundary = 0;
    return pool.find(entry => { boundary += entry.chance; return roll < boundary; })?.item.id;
}

export function relicRewardRoll(proof: RelicRollProof, player: string): number {
    return createHmac('sha256', RELIC_ROLL_KEY).update(`relic-v1:${proof.kind}:${proof.id}:${player}`).digest().readUInt32BE(0) / 0x1_0000_0000;
}

/** Caller holds the save lock. The exact outcome and payout commit in one write.
 * Keep three UTC days so retries across midnight work. Older proofs expire before
 * their receipts can be discarded. No repeat-opponent or loss farming. */
export function applyEarnedRelicRoll(
    character: Record<string, unknown>, proof: RelicRollProof, roll: number, now = Date.now(),
): { character: Record<string, unknown>; changed: boolean; outcome: RelicRollOutcome } {
    const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
    if (!proof.id || !Number.isSafeInteger(proof.eventAt) || proof.eventAt < todayStart - 2 * DAY_MS
        || proof.eventAt > now + 60_000 || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
        return { character, changed: false, outcome: { reason: 'expired-or-invalid-proof' } };
    }
    const day = new Date(proof.eventAt).toISOString().slice(0, 10);
    const cutoff = new Date(todayStart - 2 * DAY_MS).toISOString().slice(0, 10);
    const raw = character.relicRewardLedger;
    if (raw !== undefined && !Array.isArray(raw)) throw new Error('Invalid relic reward ledger');
    const ledger: LedgerDay[] = ((raw ?? []) as LedgerDay[]).filter(row => row.day >= cutoff).map(row => ({
        ...row, pvp: [...row.pvp], tower: [...row.tower],
    }));
    const row = ledger.find(entry => entry.day === day) ?? { day, pvp: [], tower: [] };
    const previous = row[proof.kind].find(entry => entry.id === proof.id);
    if (previous) return { character, changed: false, outcome: previous };
    if (row[proof.kind].length >= RELIC_DAILY_ROLL_CAP[proof.kind]) return { character, changed: false, outcome: { reason: 'daily-cap' } };
    if (proof.kind === 'pvp' && (!proof.opponent || row.pvp.some(entry => entry.opponent === proof.opponent))) {
        return { character, changed: false, outcome: { reason: 'repeat-opponent' } };
    }
    const pool = relicDropPool(proof.kind, proof.level, proof.floor);
    if (!pool.length) return { character, changed: false, outcome: { reason: 'below-relic-tier' } };
    const winner = relicForDropRoll(pool, roll);
    const granted = winner ? grantRelic(character, winner) : { character };
    const outcome: RelicRollOutcome = { ...(granted.itemId ? { itemId: granted.itemId } : {}), ...(granted.fateShards ? { fateShards: granted.fateShards } : {}) };
    row[proof.kind].push({ id: proof.id, ...(proof.opponent ? { opponent: proof.opponent } : {}), ...outcome });
    if (!ledger.some(entry => entry.day === day)) ledger.push(row);
    return { character: { ...granted.character, relicRewardLedger: ledger }, changed: true, outcome };
}
