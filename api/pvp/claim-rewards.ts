import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { recordSectorDuelScar } from '../_sector-scars.js';
import { creditRankedOutcome, rankedDelta } from '../_ranked-rating.js';
import { computePvpWinGains, creditPvpWinBase, applyDerivedLevel } from '../_xp-engine.js';
import { patchBattleSettlement } from '../_receipts.js';
import { recordPairWinAndDecay } from './_reward-farm.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { computeCombatStatGrowth, PVP_CASUAL_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP, statGainMultiplier } from '../_stat-growth.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import {
    isPlayerRankedV2Session,
    pvpSessionMayGrantProgress,
    pvpSessionMayReward,
    sealedWorldRaidAttacker,
    type PvpSession,
} from './session.js';
import { pvpSettlementId, inspectPvpCredit, embedPvpSettlementReceipt } from './_reward-settlement.js';
import {
    settlePlayerRankedJournal,
} from './_player-ranked-journal.js';
import { settlePvpConsumablesDurably } from './_consumable-settlement.js';
import { compactSettledPlayerRankedSession } from './_ranked-terminal-effects.js';
import { boundExactPvpSession } from './_session-mutation.js';
import { PVP_TERMINAL_REPLAY_TTL } from '../combat-core/constants.js';
import {
    MAX_RAID_REPORTS_PER_DAY,
    settleRaidProgressionWithDailyCap,
    type CappedRaidProgressionResult,
} from '../missions/_raid-progression.js';
import { replayCommittedPvpTerminalEffects } from './_committed-terminal-effects.js';
import type { PlayerRankedJournal } from './_player-ranked-journal.js';
import {
    acknowledgePvpRewardCompletion,
    markPvpRewardServerCreditsCompleted,
    pvpRewardCompletionSessionCreatedAt,
    reservePvpRewardCompletion,
} from './_reward-completion.js';
import {
    creditPvpWarGroundReward,
    PVP_WAR_GROUND_BOUNTY_FATE_SHARDS,
    PVP_WAR_GROUND_BOUNTY_RYO,
} from './_war-ground-reward.js';
import { settlePvpVillageWarContinuation } from '../world-state.js';
import {
    loadPvpRewardRecoverySnapshot,
    sealPvpRewardRecoverySnapshot,
} from './_reward-recovery.js';
import { pvpSessionPublicationTombstoneFor } from './_session-publication-tombstone.js';
import {
    clearPvpPendingSessionPointer,
    PVP_PENDING_SESSION_TTL_SECONDS,
    pvpRecoveryRemainingTtlSeconds,
    pvpTerminalRecoveryExpiresAt,
} from './_pending-session.js';
import { reservePvpCombatStatBudget } from './_combat-stat-budget.js';
import { CLAN_WAR_PVP_SCROLL_DROP_CHANCE } from '../clan/war/_war-points.js';
import type { CommittedPvpTerminalReplay } from './_committed-terminal-effects.js';

export { deductUsedItems } from './_consumable-settlement.js';

// One-shot idempotency gate for the CLIENT-side PvP reward payout.
//
// Server-side Vanguard rewards are already idempotent inside
// _vanguard-rewards.ts (vanguardRewardsGranted flag on the session). This
// endpoint covers the client-applied side: ryo, XP, monthlyPvpKills,
// totalPvpKills, ranked rating, ranked W/L counts, clan-war points, and
// the optional sector-raid damage tick. Without it, a refresh while the
// session is in 'done' state would re-mount PvpBattleScreen, reset the
// in-memory pvpRewardRef, fire the win effect again, and double-apply
// every one of those local grants.
//
// Contract:
//   POST { battleId, playerName, outcome: 'win' | 'loss' | 'draw', completionVersion: 1 }
//   → 200 { ok: true, alreadyClaimed: boolean, completionPending: boolean }
//   The claim receipt keeps completion pending until the authenticated browser
//   ACKs that its idempotent App callbacks finished. This survives a lost
//   claim response even when localStorage is unavailable.
//
// Storage: pvp:rewarded:<playerName>:<battleId>. Keep this at the same 48-hour
// horizon as the recovery proof and authenticated pending-session pointer.

const CLAIM_TTL_SECONDS = PVP_PENDING_SESSION_TTL_SECONDS;

function raidProgressionBody(result: CappedRaidProgressionResult | null) {
    if (!result) return undefined;
    return {
        capped: result.capped,
        replayed: result.replayed,
        fetchMissionsCredited: result.fetchMissionsCredited,
        missionsCompleted: result.settlement?.missionsCompleted ?? [],
        xpAwarded: result.settlement?.xpAwarded ?? 0,
        bonusRyo: result.settlement?.bonusRyo ?? 0,
        bonusSeals: result.settlement?.bonusSeals ?? 0,
        territoryDamage: result.territoryDamage,
        territoryDestroyed: result.territory.destroyed === true,
        territoryHpAfter: result.territory.hpAfter,
        sector: result.settlement?.sector ?? result.territory.sector,
    };
}

function claimKey(playerName: string, battleId: string): string {
    return `pvp:rewarded:${safeName(playerName)}:${battleId}`;
}

// Lock a set of save keys in a deterministic (sorted) order before running fn,
// so two concurrent claims that each touch BOTH fighters' saves (e.g. winner
// and loser claiming at the same instant) can't acquire the two locks in
// opposite orders and deadlock. failClosed: a contended lock aborts the whole
// settlement (caller returns 503 → client retries) rather than racing a
// currency/rating write. (#8)
async function withSavesLocked<T>(slugs: string[], fn: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(slugs.filter(Boolean))].sort();
    let run = fn;
    for (let i = ordered.length - 1; i >= 0; i--) {
        const slug = ordered[i];
        const next = run;
        run = () => withKvLock(`save:${slug}`, next, { failClosed: true });
    }
    return run();
}

// Remove `used[id]` copies of each item from a save character — draining the
// counted itemStacks first, then legacy inventory[] copies. Pure: returns a new
// character. Backs the server-authoritative PvP consumable deduction below.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Tight rate-limit — a legit win path calls this once. Anything beyond
    // a handful per minute is either a bug loop or someone hammering for
    // a race-condition window.
    if (!(await enforceRateLimitKv(req, res, 'pvp-claim-rewards', 30, 60_000))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body?.playerName ?? ''));
        const battleId = String(body?.battleId ?? '').trim();
        const outcome = String(body?.outcome ?? '').trim();
        const clientCompletionVersion = body?.completionVersion === 1;
        const completionAck = body?.completionAck === true;
        if (!playerName || !battleId) {
            return res.status(400).json({ error: 'Missing playerName or battleId.' });
        }
        if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'draw') {
            return res.status(400).json({ error: "outcome must be 'win', 'loss', or 'draw'." });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own rewards.' });
        }

        const key = claimKey(playerName, battleId);
        if (completionAck) {
            if (!clientCompletionVersion) {
                return res.status(400).json({ error: 'Unsupported completion acknowledgement.' });
            }
            try {
                const receiptGeneration = pvpRewardCompletionSessionCreatedAt(
                    await kv.get<unknown>(key),
                );
                const ack = await acknowledgePvpRewardCompletion(
                    kv,
                    key,
                    outcome,
                    CLAIM_TTL_SECONDS,
                    Date.now(),
                    receiptGeneration ?? undefined,
                );
                if (ack === 'missing') {
                    return res.status(409).json({ error: 'Reward claim must be confirmed before completion.' });
                }
                if (ack === 'not-ready') {
                    return res.status(409).json({ error: 'Authoritative reward credits are still pending.' });
                }
                if (receiptGeneration !== null) {
                    await clearPvpPendingSessionPointer(
                        kv,
                        playerName,
                        battleId,
                        receiptGeneration,
                    );
                }
                // The exact player+battle+outcome receipt authorizes this ACK even
                // after the terminal combat row expires. No gameplay authority is
                // created here; only an existing pending obligation is completed.
                return res.status(200).json({ ok: true, completionPending: false });
            } catch (error) {
                if (error instanceof Error && error.message.includes('outcome-conflict')) {
                    return res.status(409).json({ error: 'Reward completion outcome does not match the claim.' });
                }
                throw error;
            }
        }

        // Authoritative outcome check — load the actual session and verify
        // that the caller really is the recorded winner/loser. Without this,
        // a malicious client could POST { battleId: '<any-old-id>',
        // outcome: 'win' } and the NX reserve alone would let it pass,
        // unlocking the client-applied ryo / XP / ranked-rating / clan-war
        // grants on the next save flush. Mirrors the verification regime
        // already used by api/missions/report-pvp-win.ts.
        const liveRow = await kv.get<PvpSession>(`pvp:${battleId}`);
        // A publication fence is not a session. Read it as absence so the
        // durable terminal snapshot still answers, exactly as it did when a
        // rolled-back publication deleted the row outright.
        const liveSession = pvpSessionPublicationTombstoneFor(liveRow, battleId) ? null : liveRow;
        let session = liveSession
            ?? await loadPvpRewardRecoverySnapshot(kv, battleId);
        if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
        if (session.status !== 'done' || !session.winner) {
            return res.status(409).json({ error: 'Battle not yet decided.' });
        }
        const exactPlayerRankedV2Terminal = isPlayerRankedV2Session(session);
        const durableCompletionAuthority = session.pvpCompletionAuthorityVersion === 1;
        if (session.pvpCompletionAuthorityVersion === 1 && !clientCompletionVersion) {
            return res.status(409).json({
                error: 'This battle requires the durable reward-completion protocol.',
            });
        }
        const completionVersion = clientCompletionVersion
            || session.pvpCompletionAuthorityVersion === 1;
        const terminalIsDraw = session.winner === 'draw';
        const winnerName = terminalIsDraw
            ? ''
            : (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
        const loserName = terminalIsDraw
            ? ''
            : (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
        // winnerName/loserName are stored DISPLAY names (may contain spaces);
        // canonicalize through safeName to compare with the slug `playerName`.
        const expectedSide = outcome === 'win' ? winnerName : outcome === 'loss' ? loserName : '';
        const drawParticipant = terminalIsDraw
            && [safeName(session.p1.name), safeName(session.p2.name)].includes(playerName);
        if (terminalIsDraw !== (outcome === 'draw')) {
            return res.status(409).json({ error: 'Claim outcome does not match the terminal battle.' });
        }
        if (!identity.admin && !(drawParticipant || safeName(expectedSide) === playerName)) {
            return res.status(403).json({
                error: outcome === 'draw'
                    ? 'Only a participant may confirm this drawn battle.'
                    : `Recorded ${outcome === 'win' ? 'winner' : 'loser'} of this battle is not you.`,
            });
        }
        const rewardEventAt = Number(session.endedAt);
        if (!Number.isSafeInteger(rewardEventAt)
            || rewardEventAt <= 0
            || rewardEventAt < Number(session.createdAt)
            || rewardEventAt > Date.now() + 60_000) {
            return res.status(409).json({ error: 'Battle terminal time is invalid.' });
        }
        let recoveryExpiresAt: number;
        let claimTtlSeconds: number;
        try {
            recoveryExpiresAt = pvpTerminalRecoveryExpiresAt(session)
                ?? (() => { throw new Error('pvp-terminal-recovery-deadline-missing'); })();
            claimTtlSeconds = pvpRecoveryRemainingTtlSeconds(recoveryExpiresAt);
        } catch {
            return res.status(409).json({ error: 'Battle recovery window has expired.' });
        }

        // Seal the exact terminal evidence before any consumable, progression,
        // claim receipt, or credit write. The immutable 48-hour recovery row
        // matches the claim/pointer horizon, so a crash after reservation can
        // help-forward even if the live combat row has since expired.
        if (liveSession) {
            try {
                session = await sealPvpRewardRecoverySnapshot(kv, battleId, liveSession);
            } catch (error) {
                console.error('[pvp/claim-rewards] recovery snapshot pending', error);
                return res.status(503).json({ error: 'Battle recovery proof is still finalizing. Retry this claim.' });
            }
        }

        const rewardAuthorized = pvpSessionMayReward(session);
        const progressionAuthorized = pvpSessionMayGrantProgress(session);
        const playerRankedV2Claim = exactPlayerRankedV2Terminal
            && (session.winner === 'p1' || session.winner === 'p2');
        let playerRankedJournal: PlayerRankedJournal | undefined;
        let committedTerminalReplay: CommittedPvpTerminalReplay = {};

        // Draws have no personal payout callback, but they still own mandatory
        // server terminal effects (notably an accepted Kage duel, where a draw
        // is an incumbent defense). Give each real participant the same durable
        // completion/ACK barrier instead of clearing their recovery pointer as
        // soon as a terminal frame arrives.
        if (terminalIsDraw) {
            const reservation = await reservePvpRewardCompletion(
                kv,
                key,
                'draw',
                completionVersion,
                claimTtlSeconds,
                Date.now(),
                true,
                recoveryExpiresAt,
                session.createdAt,
            );
            try {
                if (reservation.serverCreditsPending) {
                    if (exactPlayerRankedV2Terminal) {
                        // Ranked V2 owns consumable confirmation inside its
                        // durable terminal journal. Calling the legacy drain
                        // first would reject the draw because no journal had
                        // been published yet. Replay the committed terminal
                        // saga first and require its exact draw journal.
                        committedTerminalReplay = await replayCommittedPvpTerminalEffects(session);
                        if (!committedTerminalReplay.playerRankedJournal) {
                            throw new Error('player-ranked-draw-terminal-journal-missing');
                        }
                    } else {
                        await settlePvpConsumablesDurably(
                            kv,
                            session,
                            (saveKey, action) => withKvLock(saveKey, action, { failClosed: true }),
                            { legacyPlayerName: playerName },
                        );
                        await replayCommittedPvpTerminalEffects(session);
                    }
                    const marked = await markPvpRewardServerCreditsCompleted(
                        kv,
                        key,
                        'draw',
                        claimTtlSeconds,
                        Date.now(),
                        session.createdAt,
                    );
                    if (marked !== 'completed') throw new Error('draw-server-credits-unconfirmed');
                }
            } catch (error) {
                console.error('[pvp/claim-rewards] draw terminal settlement pending', error);
                return res.status(503).json({
                    error: 'Draw settlement is still finalizing. Retry this claim.',
                });
            }
            if (!reservation.completionPending) {
                await clearPvpPendingSessionPointer(kv, playerName, battleId, session.createdAt);
            }
            return res.status(200).json({
                ok: true,
                alreadyClaimed: reservation.alreadyClaimed,
                completionPending: reservation.completionPending,
                rewardAuthorized: false,
                progressionAuthorized: false,
            });
        }

        // ── Server-authoritative PvP consumable deduction ───────────────────
        // Remove the throwables / consumables / potions the SERVER recorded each
        // fighter spending this fight (session.itemsUsed — sealed at create time
        // and decremented per use in move.ts) from their own save. Runs for EVERY
        // pvp fight (ranked AND casual), independent of the rating/base-reward
        // block below. Settled for BOTH fighters from EITHER player's claim —
        // mirroring the two-sided rating settle — so a fighter can no longer
        // keep what they spent by simply never claiming. Each side is idempotent
        // via its own per-(player,battle) in-save NX receipt, so any mix of
        // claims/retries deducts each save exactly once. Only sides stamped
        // realFighters at create are touched (an NPC sharing a real player's
        // name must never trigger a deduction); legacy sessions without the
        // stamp fall back to settling the authenticated claimer only.
        try {
            const saveLock = <T>(saveKey: string, action: () => Promise<T>): Promise<T> => (
                withKvLock(saveKey, action, { failClosed: true })
            );
            if (playerRankedV2Claim) {
                // A claim may be the first retry after terminal-session CAS and
                // process death. Replay every post-CAS terminal effect; the
                // ranked helper propagates until its journal is fully durable.
                committedTerminalReplay = await replayCommittedPvpTerminalEffects(session);
                playerRankedJournal = committedTerminalReplay.playerRankedJournal;
                if (!playerRankedJournal) throw new Error('player-ranked-terminal-journal-missing');
            } else {
                await settlePvpConsumablesDurably(
                    kv,
                    session,
                    saveLock,
                    { legacyPlayerName: playerName },
                );
                // Legacy terminal effects are individually idempotent and can be
                // repaired by either participant's claim after a move lost its
                // post-CAS continuation.
                committedTerminalReplay = await replayCommittedPvpTerminalEffects(session);
            }
        } catch (error) {
            console.error('[pvp/claim-rewards] consumable settlement pending', error);
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('admission-cancelled') || message.includes('admission-missing')) {
                return res.status(409).json({ error: 'This ranked match was cancelled as a season-close no-contest.' });
            }
            return res.status(503).json({
                error: 'The ranked result is still being confirmed. Retry this claim.',
            });
        }

        const clanWarScrollDrop = outcome === 'win'
            && committedTerminalReplay.clanWarSettlement?.outcome === 'applied'
            ? {
                awarded: committedTerminalReplay.clanWarSettlement.territoryScrollsByPlayer[playerName] ?? 0,
                chancePercent: Math.round(CLAN_WAR_PVP_SCROLL_DROP_CHANCE * 100),
            }
            : undefined;
        const clanWarPoints = committedTerminalReplay.clanWarSettlement?.outcome === 'applied'
            ? committedTerminalReplay.clanWarSettlement.pointsByPlayer[playerName] ?? 0
            : 0;
        const sectorWarPoints = outcome === 'win'
            && committedTerminalReplay.sectorWarSettlement?.outcome === 'applied'
            ? committedTerminalReplay.sectorWarSettlement.points
            : 0;
        const warPoints = clanWarPoints > 0
            ? { awarded: clanWarPoints, kind: 'clan' as const }
            : sectorWarPoints > 0
                ? { awarded: sectorWarPoints, kind: 'sector' as const }
                : undefined;

        // Settle world-raid progression from the canonical PvP reward claim so
        // a dropped response cannot lose the client-enqueued report callback.
        let worldRaidProgression: CappedRaidProgressionResult | null = null;
        const raidSector = Math.floor(Number(session.rewardSector));
        const worldAttacker = sealedWorldRaidAttacker(session);
        if (worldAttacker?.side === session.winner
            && worldAttacker.name === safeName(winnerName)
            && rewardAuthorized
            && session.rewardAuthority === 'world'
            && pvpSessionMayGrantProgress(session)
            && Number.isSafeInteger(raidSector)
            && raidSector >= 1
            && raidSector <= 66) {
            try {
                worldRaidProgression = await settleRaidProgressionWithDailyCap({
                    playerName: worldAttacker.name,
                    proofId: `pvp-raid:${battleId}`,
                    proofAt: rewardEventAt,
                    sector: raidSector,
                    dailyLimit: MAX_RAID_REPORTS_PER_DAY,
                    ...(session.worldTerritoryEvidence
                        ? { territoryEvidence: session.worldTerritoryEvidence }
                        : {}),
                });
            } catch (error) {
                console.error('[pvp/claim-rewards] world raid progression pending', error);
                return res.status(503).json({
                    error: 'The raid settlement is still finalizing. Retry this claim.',
                });
            }
        }
        const worldRaidProgressionForCaller = worldAttacker?.name === playerName
            ? worldRaidProgression
            : null;

        // Either participant's claim help-forwards village-war settlement on the
        // server; personal war-ground save credit remains winner-only below.
        // That settlement derives its delta from the sealed battle, publishes it
        // under the war-row CAS, and returns the canonical ground-reward verdict.
        // No process-local client cache or unlocked speculative war read is part
        // of this authority boundary.
        const warGroundRewardAt = rewardEventAt;
        const shouldSettleVillageWar = pvpSessionMayGrantProgress(session)
            && session.rewardAuthority !== 'admin'
            && !(session.ranked === true && session.rankedKind === 'pet');
        if (shouldSettleVillageWar) {
            if (!Number.isSafeInteger(warGroundRewardAt)
                || warGroundRewardAt <= 0
                || warGroundRewardAt < Number(session.createdAt)
                || warGroundRewardAt > Date.now() + 60_000) {
                return res.status(409).json({ error: 'Battle terminal time is invalid; village-war reward was not settled.' });
            }
        }

        // ── Server-credited paths (audit #7 / Stage 3, + #8 two-sided settle) ──
        // Two server-authoritative credits can apply to a claim:
        //   • RANKED rating — when the session was stamped ranked at creation,
        //     the SERVER owns the Elo change (pre-match snapshot + verified
        //     winner). Settled for BOTH fighters from EITHER player's claim, each
        //     exactly once via a per-player `pvp:ranked-rating:<slug>:<battleId>`
        //     NX receipt — so a loser can no longer dodge the rating drop by
        //     simply never claiming (#8). Draws skip (Elo is win/loss only).
        //   • BASE ryo + XP — when the session was stamped baseRewards AND this is
        //     the WINNER's own claim, computed from the verbatim gainXp port on
        //     the winner's save (Death's Gate sector-99 2× via rewardSector).
        // `alreadyClaimed` tracks ONLY the caller's own claim receipt (`key`),
        // which gates the client's local self-apply — kept INDEPENDENT of the
        // rating settlement, so the winner pre-settling the loser's RATING does
        // not suppress the loser's own later local grants. A contention abort
        // (failClosed → 503) leaves the relevant NX receipts unplaced so a retry
        // settles cleanly without ever double-crediting. Casual, non-baseRewards
        // sessions keep the unchanged NX-only path below.
        const isRankedClaim = playerRankedV2Claim
            || (rewardAuthorized
                && session.ranked === true
                && (session.rankedKind === 'player' || session.rankedKind === 'pet')
                && (session.winner === 'p1' || session.winner === 'p2'));
        const creditBase = rewardAuthorized && session.baseRewards === true && outcome === 'win';
        if (isRankedClaim || creditBase || shouldSettleVillageWar) {
            const kind: 'player' | 'pet' = session.rankedKind === 'pet' ? 'pet' : 'player';
            const ratingField = kind === 'pet' ? 'petRankedRating' : 'rankedRating';
            const winnerRating = Number((session.winner === 'p1' ? session.p1Rating : session.p2Rating) ?? 1000);
            const loserRating = Number((session.winner === 'p1' ? session.p2Rating : session.p1Rating) ?? 1000);
            const winnerSlug = safeName(winnerName);
            const loserSlug = safeName(loserName);
            const claimerSlug = playerName; // already safeName()'d above
            type RatingOut = { field: string; value: number; delta: number };
            type BaseOut = ReturnType<typeof creditPvpWinBase>['summary'] & {
                auraDust?: number;
                inventory?: unknown[];
                totalPvpKills?: number;
                monthlyPvpKills?: number;
                pvpKillMonth?: string;
                reward?: { ryo: number; combatGrowth: number; auraDust: number };
            };
            type WarGroundOut = {
                fresh: boolean;
                bountyCredited: boolean;
                raidProgress: number;
                ryoAwarded: number;
                fateShardsAwarded: number;
            };

            // Ladder-integrity guard (audit #2): when the two fighters share a
            // recent IP or browser fingerprint, this ranked match is almost
            // certainly two alts (or a same-household boost), so we do NOT move
            // either player's Elo — the win/loss simply doesn't count for the
            // ladder. Mirrors the same-device rule already enforced for Vanguard
            // Honor-Seals (_vanguard-rewards.ts). The base ryo/XP path is left
            // alone here — it has its own repeat-opponent decay (#1), which has
            // no device false-positives — so only the LADDER is protected.
            // Computed OUTSIDE the save lock (read-only key scan). Fails OPEN: a
            // KV hiccup must never block a legitimate rating settlement.
            let playerRankedRatingOut: RatingOut | undefined;
            if (playerRankedV2Claim) {
                try {
                    const journal = playerRankedJournal;
                    if (!journal) throw new Error('player-ranked-journal-missing');
                    const settled = await settlePlayerRankedJournal(kv, journal, Date.now());
                    // A settled terminal compacts to the ordinary session lease;
                    // anything still unproven keeps the discoverable replay
                    // horizon so the other side's claim can help it forward.
                    if (!await compactSettledPlayerRankedSession(kv, session, settled.journal)) {
                        await boundExactPvpSession(kv, `pvp:${battleId}`, session, PVP_TERMINAL_REPLAY_TTL);
                    }
                    const side = claimerSlug === journal.terminal.a ? 'a'
                        : claimerSlug === journal.terminal.b ? 'b'
                            : null;
                    if (side) {
                        const value = settled.ratings[side];
                        const winnerSnapshot = journal.terminal.winner === 'a'
                            ? journal.terminal.aRating
                            : journal.terminal.bRating;
                        const loserSnapshot = journal.terminal.winner === 'a'
                            ? journal.terminal.bRating
                            : journal.terminal.aRating;
                        const delta = journal.terminal.rankedEligible && journal.terminal.winner !== 'draw'
                            ? rankedDelta(winnerSnapshot, loserSnapshot)
                            : 0;
                        playerRankedRatingOut = { field: 'rankedRating', value, delta };
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (message.includes('admission-cancelled') || message.includes('admission-missing')) {
                        return res.status(409).json({ error: 'This ranked match was cancelled as a season-close no-contest.' });
                    }
                    throw error;
                }
            }
            let rankedEligible = isRankedClaim && !playerRankedV2Claim;
            if (rankedEligible) {
                try {
                    if (await hasRecentIpOrFpOverlap(winnerName, loserName)) rankedEligible = false;
                } catch { /* legacy pet path retains its existing fail-open policy */ }
            }

            // Apply ONE fighter's once-per-battle ranked-rating delta and return
            // that fighter's resulting rating. Exactly-once AND atomic: the rating
            // patch and its idempotency receipt are written together in ONE kv.set
            // (the receipt lives in the same save via serverSettlementReceipts), so
            // a crash can never place the receipt without the credit. The old
            // separate-key receipt COULD be placed while the save write was lost —
            // and the retry then skipped, permanently losing the Elo change.
            const settleRatingFor = async (slug: string, role: 'winner' | 'loser'): Promise<RatingOut | undefined> => {
                if (!rankedEligible) return undefined;
                if (!slug) throw new Error(`ranked-${role}-identity-missing`);
                const saveKey = `save:${slug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) throw new Error(`ranked-${role}-save-missing`);
                const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind });
                const sid = pvpSettlementId('rating', battleId);
                const decision = inspectPvpCredit(char, sid, `rating-${role}`);
                if (decision.fresh) {
                    const credited = embedPvpSettlementReceipt({ ...char, ...r.patch }, decision.receipts, sid, `rating-${role}`, Date.now());
                    await writeVersionedPlayerSave(saveKey, record, credited);
                    return { field: ratingField, value: r.newRating, delta: r.delta };
                }
                if (decision.needsBackfill) {
                    const backfilled = embedPvpSettlementReceipt(
                        char,
                        decision.receipts,
                        sid,
                        `rating-${role}`,
                        Date.now(),
                    );
                    await writeVersionedPlayerSave(saveKey, record, backfilled);
                }
                // Already settled — return the stored authoritative rating.
                const cur = Number(char[ratingField]);
                return { field: ratingField, value: Number.isFinite(cur) ? cur : r.newRating, delta: r.delta };
            };

            // Credit the winner's base ryo+XP exactly once, ATOMICALLY: the credit
            // and its idempotency receipt (serverSettlementReceipts) are written in
            // ONE kv.set, so a crash between the two can't permanently lose the
            // payout the way the old separate-receipt `key` gate did. Re-reads the
            // save so a rating patch applied just above is preserved.
            const settleBaseForWinner = async (): Promise<BaseOut | undefined> => {
                const saveKey = `save:${winnerSlug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) throw new Error('pvp-base-winner-save-missing');
                // #1A settlement-side guard (defense in depth): base ryo/XP is a
                // PvP-win reward, so re-verify AT THE MONEY-MOVING STEP that the
                // loser was a real player with an authoritative save — session
                // creation is not the only enforcement point. A fabricated no-save
                // NPC opponent (or any legacy session stamped baseRewards before
                // the session-side gate landed) never pays out. Fails closed on a
                // transient loser-save read miss; the winner can retry the claim.
                const loserRecord = loserSlug ? await kv.get<Record<string, unknown>>(`save:${loserSlug}`) : null;
                if (!loserRecord?.character) throw new Error('pvp-base-loser-save-missing');
                const { ryoGain, growthMult } = computePvpWinGains(char, session.rewardSector);
                const sid = pvpSettlementId('base', battleId);
                const decision = inspectPvpCredit(char, sid, 'base');
                if (decision.fresh) {
                    // Repeat-opponent decay (audit #1): scale this win's base
                    // reward down by how many times the winner already banked a
                    // win over THIS loser in the last hour. The in-save receipt
                    // makes the PAYOUT exactly-once; the decay counter + daily stat
                    // budget below are separate rows, so in the rare case of a
                    // crash AFTER these advance but BEFORE the atomic save write,
                    // the retry advances them once more. That only ever shrinks a
                    // FUTURE reward (fails toward less, never a mint), and is
                    // strictly better than the old bug where the whole payout was
                    // lost. The loser is a confirmed real player (guarded above),
                    // so the pair-decay always applies.
                    const decay = await recordPairWinAndDecay(winnerSlug, loserSlug);
                    const dRyo = Math.max(0, Math.floor(ryoGain * decay));
                    const credit = creditPvpWinBase(char, dRyo);
                    let finalChar: Record<string, unknown> = credit.char;
                    let summary: BaseOut = credit.summary;
                    let combatGrowthAwarded = 0;
                    // Stage 4: casual PvP grants a small, daily-capped combat stat
                    // reward into the unspent POOL (ranked = 0, skill-pure — this branch
                    // only runs when !isRankedClaim). Pool-only keeps this write clean:
                    // the summary's unspentStats, mirrored by the client via
                    // applyServerBaseReward, carries it with no stat clobber. Shares the
                    // `combat-stat-count` daily budget with AI-fight wins.
                    if (!isRankedClaim) {
                        // Serious (non-ranked, non-spar) PvP win → combat-use stat growth:
                        // auto-grow the stats you fought with + a free-pool share, hard-
                        // capped per day. Spars never reach here (baseRewards=false → no
                        // creditBase). Ranked = 0 (skill-pure). The client mirrors the
                        // allocated stats via summary.statGrowth and the pool via
                        // summary.unspentStats (applyServerBaseReward + applyStatGrowth).
                        const statsNow = (finalChar.stats ?? {}) as Record<string, number>;
                        // The slice ledger charges BASE points; boosts multiply the
                        // payout after slice accounting (map §4.1): the retired Swift
                        // +25% / Death's Gate ×2 XP bonuses (growthMult) and the era
                        // dial scale what's granted, not what's charged.
                        const statBudget = await reservePvpCombatStatBudget(kv, {
                            playerName: winnerSlug,
                            battleId,
                            eventAt: rewardEventAt,
                            requested: PVP_CASUAL_STAT_POINTS_PER_WIN,
                            cap: DAILY_COMBAT_STAT_CAP,
                        });
                        const baseEarned = statBudget.points;
                        const boosted = Math.round(baseEarned * growthMult * statGainMultiplier());
                        const g = computeCombatStatGrowth(statsNow, Number(finalChar.level) || 1, boosted, boosted);
                        combatGrowthAwarded = g.spent;
                        if (baseEarned > 0 && g.spent > 0) {
                            const newStats: Record<string, number> = { ...statsNow };
                            for (const [k, v] of Object.entries(g.allocated)) newStats[k] = (Number(newStats[k]) || 0) + (v ?? 0);
                            const newUnspent = (Number(finalChar.unspentStats) || 0) + g.unspentGain;
                            finalChar = { ...finalChar, stats: newStats, unspentStats: newUnspent };
                            // Stat growth moved the earned ledger — recompute the
                            // derived level (rise-only) so a boundary crossing lands
                            // in the same atomic write.
                            finalChar = applyDerivedLevel(finalChar) as Record<string, unknown>;
                            summary = {
                                ...summary,
                                level: Number(finalChar.level) || summary.level,
                                rankTitle: typeof finalChar.rankTitle === 'string' ? finalChar.rankTitle : summary.rankTitle,
                                maxHp: Number(finalChar.maxHp) || summary.maxHp,
                                maxChakra: Number(finalChar.maxChakra) || summary.maxChakra,
                                maxStamina: Number(finalChar.maxStamina) || summary.maxStamina,
                                unspentStats: newUnspent,
                                statGrowth: { allocated: g.allocated as Record<string, number>, unspentGain: g.unspentGain },
                            };
                        }
                    }
                    const eventMonth = new Date(rewardEventAt).toISOString().slice(0, 7);
                    const storedMonth = typeof finalChar.pvpKillMonth === 'string' ? finalChar.pvpKillMonth : '';
                    const preserveNewerMonth = /^\d{4}-\d{2}$/.test(storedMonth) && storedMonth > eventMonth;
                    const month = preserveNewerMonth ? storedMonth : eventMonth;
                    const monthlyKills = preserveNewerMonth
                        ? Math.max(0, Math.floor(Number(finalChar.monthlyPvpKills) || 0))
                        : storedMonth === eventMonth
                            ? Math.max(0, Math.floor(Number(finalChar.monthlyPvpKills) || 0)) + 1
                            : 1;
                    finalChar = {
                        ...finalChar,
                        auraDust: Math.max(0, Number(finalChar.auraDust) || 0) + 6,
                        totalPvpKills: Math.max(0, Math.floor(Number(finalChar.totalPvpKills) || 0)) + 1,
                        monthlyPvpKills: monthlyKills,
                        pvpKillMonth: month,
                    };
                    summary = {
                        ...summary,
                        reward: { ryo: dRyo, combatGrowth: combatGrowthAwarded, auraDust: 6 },
                        auraDust: Number(finalChar.auraDust),
                        inventory: finalChar.inventory,
                        totalPvpKills: Number(finalChar.totalPvpKills),
                        monthlyPvpKills: Number(finalChar.monthlyPvpKills),
                        pvpKillMonth: month,
                    } as typeof summary;
                    // Embed the idempotency receipt INTO the credited character so
                    // the payout and its marker persist together in one atomic write.
                    const credited = embedPvpSettlementReceipt(finalChar, decision.receipts, sid, 'base', Date.now());
                    await writeVersionedPlayerSave(saveKey, record, credited);
                    return summary;
                }
                if (decision.needsBackfill) {
                    const backfilled = embedPvpSettlementReceipt(
                        char,
                        decision.receipts,
                        sid,
                        'base',
                        Date.now(),
                    );
                    await writeVersionedPlayerSave(saveKey, record, backfilled);
                }
                return {
                    ryo: Number(char.ryo) || 0,
                    xp: Number(char.xp) || 0,
                    level: Number(char.level) || 0,
                    rankTitle: typeof char.rankTitle === 'string' ? char.rankTitle : '',
                    maxHp: Number(char.maxHp) || 0,
                    maxChakra: Number(char.maxChakra) || 0,
                    maxStamina: Number(char.maxStamina) || 0,
                    unspentStats: Number(char.unspentStats) || 0,
                    auraDust: Number(char.auraDust) || 0,
                    inventory: Array.isArray(char.inventory) ? char.inventory : [],
                    totalPvpKills: Number(char.totalPvpKills) || 0,
                    monthlyPvpKills: Number(char.monthlyPvpKills) || 0,
                    pvpKillMonth: typeof char.pvpKillMonth === 'string' ? char.pvpKillMonth : '',
                };
            };

            const settleWarGroundForWinner = async (creditWarGround: boolean): Promise<WarGroundOut | undefined> => {
                if (!creditWarGround) return undefined;
                const saveKey = `save:${winnerSlug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) throw new Error('war-ground-winner-save-missing');
                const credited = creditPvpWarGroundReward(char, battleId, warGroundRewardAt);
                if (credited.writeRequired) {
                    await writeVersionedPlayerSave(saveKey, record, credited.character);
                }
                return {
                    fresh: credited.fresh,
                    bountyCredited: credited.bountyCredited,
                    raidProgress: credited.raidProgress,
                    ryoAwarded: credited.fresh && credited.bountyCredited ? PVP_WAR_GROUND_BOUNTY_RYO : 0,
                    fateShardsAwarded: credited.fresh && credited.bountyCredited ? PVP_WAR_GROUND_BOUNTY_FATE_SHARDS : 0,
                };
            };

            try {
                // Lock every save we may write — claimer + opponent for a ranked
                // settlement, winner-only for a casual base reward.
                const locks = isRankedClaim ? [winnerSlug, loserSlug] : [winnerSlug];
                const out = await withSavesLocked(locks, async () => {
                    // Caller's own claim receipt — gates the client's local
                    // self-apply (alreadyClaimed). Distinct from the per-player
                    // rating receipts below.
                    const reservation = await reservePvpRewardCompletion(
                        kv,
                        key,
                        outcome,
                        completionVersion,
                        claimTtlSeconds,
                        Date.now(),
                        true,
                        recoveryExpiresAt,
                        session.createdAt,
                    );
                    const already = reservation.alreadyClaimed;
                    // The server-credit phase is independent from the browser
                    // continuation phase. A lost browser ACK keeps completion
                    // pending but must not replay credits after their bounded
                    // in-save receipts churn. Legacy callers retain their old
                    // help-forward behavior after a failed credit attempt.
                    const helpForwardServerCredits = !completionVersion || reservation.serverCreditsPending;
                    let creditWarGround = false;
                    if (helpForwardServerCredits && shouldSettleVillageWar) {
                        const warSettlement = await settlePvpVillageWarContinuation(
                            battleId,
                            winnerSlug,
                            session,
                            worldRaidProgression?.territory,
                        );
                        if (warSettlement.status !== 200) {
                            throw new Error(String(
                                warSettlement.body.error
                                ?? `pvp-village-war-settlement-${warSettlement.status}`,
                            ));
                        }
                        creditWarGround = warSettlement.body.warGroundRewardEligible === true;
                    }

                    // Settle BOTH ratings (each exactly once across the battle).
                    const winnerRatingOut = playerRankedV2Claim || !helpForwardServerCredits
                        ? undefined
                        : await settleRatingFor(winnerSlug, 'winner');
                    const loserRatingOut = playerRankedV2Claim || !helpForwardServerCredits
                        ? undefined
                        : (loserSlug && loserSlug !== winnerSlug)
                            ? await settleRatingFor(loserSlug, 'loser')
                            : undefined;

                    // Winner base reward — only when the WINNER is the caller. Its
                    // own in-save receipt gates the credit now (not `already`), so
                    // a crash that placed `key` but lost the payout is RECOVERED on
                    // retry instead of being permanently skipped.
                    const warGround = (helpForwardServerCredits && creditWarGround && claimerSlug === winnerSlug)
                        ? await settleWarGroundForWinner(creditWarGround)
                        : undefined;
                    const base = (helpForwardServerCredits && creditBase && claimerSlug === winnerSlug)
                        ? await settleBaseForWinner()
                        : undefined;

                    const rating = playerRankedRatingOut
                        ?? (claimerSlug === winnerSlug ? winnerRatingOut
                        : claimerSlug === loserSlug ? loserRatingOut
                        : undefined);
                    if (reservation.serverCreditsPending) {
                        const sealed = await markPvpRewardServerCreditsCompleted(
                            kv,
                            key,
                            outcome,
                            claimTtlSeconds,
                            Date.now(),
                            session.createdAt,
                        );
                        if (sealed === 'missing') throw new Error('pvp-reward-server-credit-receipt-missing');
                    }
                    return { already, completionPending: reservation.completionPending, rating, base, warGround };
                });
                // Record the server-credited settlement on the durable battle
                // receipt (Priority 4 visibility). Best-effort: never blocks or
                // fails the claim. `rating.delta` is the authoritative Elo change;
                // base ryo+XP is flagged via a note (the summary returns totals,
                // not the per-battle gain, so we don't mislabel it as the reward).
                await patchBattleSettlement(battleId, {
                    ratingDelta: out.rating?.delta,
                    note: creditBase ? 'base ryo+XP credited to winner' : undefined,
                });
                const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
                const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
                if (!out.completionPending) {
                    await clearPvpPendingSessionPointer(kv, playerName, battleId, session.createdAt);
                }
                if (!out.already) {
                    await recordBetaMetric({
                        event: 'pvp.settled',
                        playerName,
                        level: Number(finalChar?.level ?? 0),
                        source: `${playerRankedV2Claim ? 'ranked-player-v2' : session.ranked ? `ranked-${session.rankedKind ?? 'player'}` : session.baseRewards ? 'base' : 'verified'}:${outcome}`,
                    });
                }
                return res.status(200).json({
                    ok: true,
                    alreadyClaimed: out.already,
                    completionPending: out.completionPending,
                    rewardAuthorized,
                    progressionAuthorized,
                    ...(out.rating ? { rating: out.rating } : {}),
                    ...(out.base ? { base: out.base } : {}),
                    ...(out.warGround ? { warGroundReward: out.warGround } : {}),
                    ...(warPoints ? { warPoints } : {}),
                    ...(worldRaidProgressionForCaller ? { raidProgression: raidProgressionBody(worldRaidProgressionForCaller) } : {}),
                    ...(clanWarScrollDrop ? { clanWarScrollDrop } : {}),
                    ...(finalChar ? { character: finalChar } : {}),
                    _saveVersion: Number(finalSave?._saveVersion ?? 0),
                });
            } catch (creditErr) {
                // Lock contention/outage (failClosed) — receipts NOT placed, so
                // the client can safely retry. 503 signals "transient, retry".
                console.error('[pvp/claim-rewards] server credit failed', creditErr);
                return res.status(503).json({ error: 'Could not record battle result — please retry.' });
            }
        }

        // ── Casual path (unchanged) ─────────────────────────────────────────
        // Atomic NX reserve. If the key already exists, we lost the race
        // (or a duplicate call) — return alreadyClaimed so the caller
        // skips the local grant entirely.
        //
        // Fail-open is scoped to JUST this reserve step (audit #7): if the
        // NX write throws because KV is briefly down, we still let the
        // legitimate, already-verified winner pay out (one possible duplicate
        // during an outage beats denying a real winner). The outer try/catch
        // used to swallow EVERYTHING — including auth/session-verification
        // failures above — into a misleading ok:true. Those now fall through
        // to the outer catch and surface as a real 500, so a broken request
        // can't masquerade as a successful claim.
        let alreadyClaimed = false;
        try {
            const reservation = await reservePvpRewardCompletion(
                kv,
                key,
                outcome,
                completionVersion,
                claimTtlSeconds,
                Date.now(),
                false,
                recoveryExpiresAt,
                session.createdAt,
            );
            alreadyClaimed = reservation.alreadyClaimed;
            const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
            const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
            if (!reservation.completionPending) {
                await clearPvpPendingSessionPointer(kv, playerName, battleId, session.createdAt);
            }
            if (!alreadyClaimed) {
                await recordBetaMetric({
                    event: 'pvp.settled',
                    playerName,
                    level: Number(finalChar?.level ?? 0),
                    source: `casual:${outcome}`,
                });
            }
            // The ground remembers this fight (shared/sector-scars). Written
            // from the WINNER's own first claim so one duel leaves one mark,
            // and from `session.rewardSector` — the sector the server itself
            // confirmed both fighters were standing in, never a client's claim
            // about where it happened. Fire-and-forget by design: a scar is a
            // display record nothing reads back, so it must not be able to
            // delay or fail a settled reward (same posture as creditSectorIntel
            // on the explore receipt).
            if (outcome === 'win' && !alreadyClaimed && Number.isSafeInteger(raidSector)) {
                void recordSectorDuelScar(raidSector, winnerName, loserName).catch(() => undefined);
            }
            return res.status(200).json({
                ok: true,
                alreadyClaimed,
                completionPending: reservation.completionPending,
                rewardAuthorized,
                progressionAuthorized,
                ...(worldRaidProgressionForCaller ? { raidProgression: raidProgressionBody(worldRaidProgressionForCaller) } : {}),
                ...(warPoints ? { warPoints } : {}),
                ...(clanWarScrollDrop ? { clanWarScrollDrop } : {}),
                ...(finalChar ? { character: finalChar } : {}),
                _saveVersion: Number(finalSave?._saveVersion ?? 0),
            });
        } catch (reserveErr) {
            // Completion-aware clients only run their durable settlement
            // callbacks after this reservation is confirmed. Returning 200
            // without a receipt would let a storage-denied browser run those
            // callbacks, fail its ACK, then run them again when a later retry
            // creates the reservation. Keep that ambiguity retryable. Legacy
            // callers retain the historical casual fail-open behavior.
            if (completionVersion) {
                console.error('[pvp/claim-rewards] completion reservation failed', reserveErr);
                return res.status(503).json({ error: 'Could not reserve battle settlement — please retry.' });
            }
            console.error('[pvp/claim-rewards] reserve failed (legacy fail-open)', reserveErr);
            const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
            return res.status(200).json({
                ok: true,
                alreadyClaimed: false,
                rewardAuthorized,
                progressionAuthorized,
                degraded: true,
                _saveVersion: Number(finalSave?._saveVersion ?? 0),
            });
        }
    } catch (err) {
        console.error('[pvp/claim-rewards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
