/*
 * Ranked 2v2 — rating settlement.
 *
 * The ONLY place the 2v2 ladder moves. The four-player engine that runs the
 * fight stays rating-free (asserted by api/towers/_pvp-contract.test.ts), so the
 * open Team Arena can share it without ever gaining a ladder — the same split
 * the clan-war adapter uses.
 *
 * RATING MODEL. Elo is computed ONCE from the two TEAM ratings sealed at match
 * time, then applied identically to both members of each side. That is the
 * standard duo-queue model and it has a specific property worth stating: your
 * result depends on your pair's combined strength, so carrying a lower-rated
 * partner earns less and beating a stronger pair earns more. Ratings are read
 * from the sealed binding rather than from live saves, so a rating that moved
 * during the fight cannot retroactively change what the match was worth.
 *
 * EXACTLY ONCE. All four players may settle, and any of them may retry. A
 * durable per-match receipt on each save makes every call after the first a
 * no-op rather than a second rating swing.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict, retryOnSaveVersionConflict } from '../save/_projected-write.js';
import { buildPublicPlayerIndexEntry, isPublicPlayerIndexKey, REGISTRY_KEY } from '../player/_public-index.js';
import { creditRankedOutcome, DEFAULT_RANKED_RATING, rankedDelta } from '../_ranked-rating.js';
import { towerPvpBindingOf, type TowerPvpTeamId } from '../../shared/tower-pvp.js';
import type { StoredTowerPvpMatch } from '../towers/_pvp-session.js';
import { clearRanked2v2Match } from './_ranked-2v2.js';

export type Ranked2v2Outcome = 'win' | 'loss' | 'draw';

function currentRating(character: Record<string, unknown>): number {
    const value = Number(character.ranked2v2Rating);
    return Number.isFinite(value) ? value : DEFAULT_RANKED_RATING;
}

async function projectRanked2v2LeaderboardSide(slug: string, character: Record<string, unknown>): Promise<void> {
    if (isPublicPlayerIndexKey(slug)) {
        await kv.hset(REGISTRY_KEY, { [slug]: buildPublicPlayerIndexEntry(character, slug) });
    }
}

export type Ranked2v2SettlementLine = {
    slug: string;
    teamId: TowerPvpTeamId;
    outcome: Ranked2v2Outcome;
    delta: number;
    newRating: number;
    /** Committed save version, so the caller's client can adopt it without a refetch. */
    saveVersion?: number;
};

/**
 * Per-player outcome from the sealed match. A cancelled match — ready-check
 * timeout, or someone leaving before the first turn — rates NOBODY: a duel that
 * never happened must not move a ladder, in either direction.
 */
export function ranked2v2Outcomes(match: StoredTowerPvpMatch): Array<{ slug: string; teamId: TowerPvpTeamId; outcome: Ranked2v2Outcome }> | null {
    if (match.status === 'cancelled') return null;
    if (match.status !== 'done') return null;
    const winner = match.winner;
    if (winner !== 'amber' && winner !== 'violet' && winner !== 'draw') return null;
    return match.roster.map(member => ({
        slug: member.slug,
        teamId: member.teamId,
        outcome: winner === 'draw' ? 'draw' as const : member.teamId === winner ? 'win' as const : 'loss' as const,
    }));
}

/**
 * The swing both teams share, derived from the sealed team ratings. A draw moves
 * nothing — the Elo formula has no draw term here and inventing one would be a
 * balance change, not a settlement.
 */
export function ranked2v2Delta(match: StoredTowerPvpMatch): number {
    const binding = towerPvpBindingOf(match);
    if (binding.kind !== 'ranked-2v2') return 0;
    if (match.winner !== 'amber' && match.winner !== 'violet') return 0;
    const winnerRating = match.winner === 'amber' ? binding.amberRating : binding.violetRating;
    const loserRating = match.winner === 'amber' ? binding.violetRating : binding.amberRating;
    return rankedDelta(winnerRating, loserRating);
}

/**
 * Apply the ladder result. Safe to call from all four players and safe to retry.
 * Returns the per-player lines for the response, or null for a non-ranked match.
 */
export async function settleRanked2v2Match(
    match: StoredTowerPvpMatch,
): Promise<Ranked2v2SettlementLine[] | null> {
    if (towerPvpBindingOf(match).kind !== 'ranked-2v2') return null;
    const outcomes = ranked2v2Outcomes(match);
    if (!outcomes) {
        // Terminal but unrated (a cancel). Free the pointers so the duo can
        // queue again rather than sitting on a match that will never rate.
        if (match.status === 'cancelled') await clearRanked2v2Match(match).catch(() => undefined);
        return [];
    }

    const requestId = `r2v2_${match.matchId}`;
    const fingerprint = `ranked-2v2-rating:${match.matchId}`;
    const lines: Ranked2v2SettlementLine[] = [];

    for (const entry of outcomes) {
        const slug = safeName(entry.slug);
        if (!slug) continue;
        // A lost commit race (another writer saved this player after our read)
        // writes nothing: re-run once (it re-reads; the receipt prevents a second
        // swing), and if it loses again treat it like a busy save — this
        // participant stays owed, the match is not cleared below, and the
        // receipt makes the next settle call exact. mutatePlayerSave also keeps
        // the idle recovery each player earned since their last save; the other
        // three are usually offline, and a raw write discarded theirs.
        const settled = await retryOnSaveVersionConflict(() => mutatePlayerSave<Omit<Ranked2v2SettlementLine, 'saveVersion'> | null>(slug, async ({ character }) => {
            const inspection = inspectSettlementReceipt(character, requestId, fingerprint);
            if (inspection.status === 'conflict' || inspection.status === 'invalid') {
                return { ok: true, value: null, character, write: false };
            }
            if (inspection.status === 'replay') {
                // Already rated. Report the standing value rather than moving it.
                // Projection may have failed after the save receipt was written;
                // retrying settlement repairs that public leaderboard row.
                await projectRanked2v2LeaderboardSide(slug, character);
                return {
                    ok: true,
                    value: { slug, teamId: entry.teamId, outcome: entry.outcome, delta: 0, newRating: currentRating(character) },
                    character,
                    write: false,
                };
            }

            const binding = towerPvpBindingOf(match);
            const amberRating = binding.kind === 'ranked-2v2' ? binding.amberRating : 0;
            const violetRating = binding.kind === 'ranked-2v2' ? binding.violetRating : 0;
            const winnerRating = match.winner === 'amber' ? amberRating : violetRating;
            const loserRating = match.winner === 'amber' ? violetRating : amberRating;
            // A draw moves nothing: the shared Elo formula has no draw term and
            // inventing one here would be a balance change, not a settlement.
            // The receipt is still stamped so the match settles exactly once.
            const credited = entry.outcome === 'draw'
                ? { patch: {} as Record<string, number>, newRating: currentRating(character), delta: 0 }
                : creditRankedOutcome(character, {
                    role: entry.outcome === 'win' ? 'winner' : 'loser',
                    winnerRating,
                    loserRating,
                    kind: 'team2v2',
                });
            const stamped = appendSettlementReceipt(
                { ...character, ...credited.patch },
                inspection.receipts,
                {
                    requestId,
                    fingerprint,
                    value: { kind: 'ranked-2v2-rating', matchId: match.matchId, outcome: entry.outcome, delta: credited.delta },
                    settledAt: Date.now(),
                },
            );
            return {
                ok: true,
                value: {
                    slug,
                    teamId: entry.teamId,
                    outcome: entry.outcome,
                    delta: entry.outcome === 'draw' ? 0 : credited.delta,
                    newRating: credited.newRating,
                },
                character: stamped,
                afterCommit: async (committed) => { await projectRanked2v2LeaderboardSide(slug, committed.character); },
            };
        })).catch((error: unknown) => {
            if (isPlayerSaveVersionConflict(error)) return null;
            throw error;
        });
        // A missing save stays owed, like a busy one.
        if (settled?.ok && settled.value) lines.push({ ...settled.value, saveVersion: settled._saveVersion });
    }

    // A temporarily missing or busy save must remain recoverable. All four
    // receipts are required before the duo is freed for its next match.
    if (lines.length === match.roster.length) await clearRanked2v2Match(match);
    return lines;
}
