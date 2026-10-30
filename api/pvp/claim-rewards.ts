import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { recordSectorDuelScar } from '../_sector-scars.js';
import { creditRankedOutcome, weightedRankedDelta } from '../_ranked-rating.js';
import { creditPvpWinBase, applyDerivedLevel } from '../_xp-engine.js';
import { patchBattleSettlement } from '../_receipts.js';
import {
    pvpCreditAuraDust,
    pvpCreditRules,
    pvpCreditRyo,
    pvpCreditView,
    pvpLossFrac,
    pvpLuckyActive,
    pvpMastery4049Enabled,
    pvpPairWeight,
    pvpPurseScale,
    rankedPurseRyo,
    readRankedWeightRow,
    resolvePvpFightCredit,
    type RankedWeightRow,
} from './_valid-fight.js';
import { recordEconomyTxn } from '../_economy.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { mutatePlayerSaveLocked } from '../save/_mutate-player-save.js';
import { computeCombatStatGrowth, PVP_CASUAL_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP } from '../_stat-growth.js';
import { boostMultiplier } from '../_boost-event.js';
import { creditPvpJutsuMastery } from './_jutsu-mastery-reward.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import {
    isPlayerRankedV2Session,
    pvpSessionMayGrantProgress,
    pvpSessionMayReward,
    sealedWorldRaidAttacker,
    type PvpSession,
} from './session.js';
import { pvpSettlementId, inspectPvpCredit, embedPvpSettlementReceipt } from './_reward-settlement.js';
import { addClanContrib } from '../_clan-contrib-month.js';
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
import { isCancelledUnstartedPvpDuel } from '../../shared/pvp-cancellation.js';
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
import { reserveCombatStatBudget } from './_combat-stat-budget.js';
import { dailyStatBudgetReply } from '../_daily-stat-budget.js';
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

// A completed duel normally makes a claim and a completion ACK for each
// participant. Recovery can legitimately repeat those idempotent requests, so
// this needs considerably more headroom than a one-shot reward endpoint.
// It is applied after authentication and keyed to the authenticated account;
// otherwise every player behind a shared IP spends the same tiny quota.
const PVP_REWARD_CLAIM_RATE_LIMIT = 120;
const PVP_REWARD_CLAIM_RATE_WINDOW_MS = 60_000;

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

/**
 * The two ranked answers a retry can never change. Everything else the ranked
 * saga throws is transient (a lock, a CAS race, a journal still settling —
 * including one whose gate admission was lost, which publication and the
 * server-side settlement sweep both finish) and stays a retryable 503.
 */
function playerRankedClaimRefusal(error: unknown): string | null {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('player-ranked-admission-cancelled')) {
        return 'This ranked match was cancelled as a no-contest.';
    }
    if (message.includes('player-ranked-admission-missing')) {
        // No terminal was ever sealed and no no-contest was recorded.
        return 'This ranked match has no recorded result to settle.';
    }
    return null;
}

/**
 * A ranked purse as the casual purse's credit view (pvpCreditView), so the
 * result screen words its repeat-opponent, short-fight, loss-engagement and
 * account-age reductions the same way (owner ruling A9). Pure; reads the sealed row.
 */
function rankedPurseCredit(row: RankedWeightRow, role: 'winner' | 'loser') {
    const blocked = Boolean(row.purseBlocked);
    const pairOrdinal = row.sharedPairOrdinal ?? row.pairOrdinal;
    return {
        credited: !blocked,
        ...(row.purseBlocked ? { reason: row.purseBlocked } : {}),
        kind: row.shortMult === 0 ? 'flee' as const : 'ko' as const,
        short: row.shortMult < 1,
        pairOrdinal: blocked ? 0 : pairOrdinal,
        pairWeight: blocked ? 0 : pvpPairWeight(pairOrdinal),
        sideMult: role === 'winner' ? row.shortMult : row.engaged && !row.lossPurseBlocked ? 1 : 0,
        ...(role === 'loser' && row.engaged && row.lossPurseBlocked ? { lossBlocked: row.lossPurseBlocked } : {}),
        rules: pvpCreditRules(),
    };
}

// Every claim-side replay runs after the claim has sealed (or loaded) the exact
// terminal row's recovery snapshot, so the barrier may skip re-proving it.
const SEALED_TERMINAL_REPLAY = { recoverySnapshotSealed: true } as const;

// Lock a set of save keys in a deterministic (sorted) order before running fn,
// so two concurrent claims that each touch BOTH fighters' saves (e.g. winner
// and loser claiming at the same instant) can't acquire the two locks in
// opposite orders and deadlock. failClosed: a contended lock aborts the whole
// settlement (caller returns 503 → client retries) rather than racing a
// currency/rating write. (#8)
//
// Both fighters' claims join the same terminal saga, resume in the same tick,
// and then lock the WINNER's save (a casual claim locks only the winner's).
// The winner's credit section holds it ~0.5s in production, longer than the
// default ~0.4s acquire budget, so the second claim used to 503 and redo the
// whole claim from the top (2026-10-13: +0.9s on the loser's result card).
// Two more attempts (the next waits 400ms, then 800ms) let it queue behind the
// holder instead. Still fail-closed, still well inside the 5s lock lease.
const CLAIM_SAVE_LOCK_ATTEMPTS = 7;
async function withSavesLocked<T>(slugs: string[], fn: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(slugs.filter(Boolean))].sort();
    let run = fn;
    for (let i = ordered.length - 1; i >= 0; i--) {
        const slug = ordered[i];
        const next = run;
        run = () => withKvLock(`save:${slug}`, next, { failClosed: true, maxAttempts: CLAIM_SAVE_LOCK_ATTEMPTS });
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

        // Account-scoped after authentication. enforceRateLimitKv also applies
        // its much higher IP backstop, preserving abuse protection without
        // making players on a shared connection throttle one another.
        const rateLimitIdentity = identity.admin ? playerName : identity.name;
        if (!(await enforceRateLimitKv(
            req,
            res,
            'pvp-claim-rewards',
            PVP_REWARD_CLAIM_RATE_LIMIT,
            PVP_REWARD_CLAIM_RATE_WINDOW_MS,
            rateLimitIdentity,
        ))) return;

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
        // Timed boost event (api/_boost-event.ts), judged by when the battle
        // ENDED so a claim made just after the event still gets it. Read once,
        // before any save lock; fails neutral (1).
        const growthEventBoost = await boostMultiplier('growth', rewardEventAt);
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
        // From here `session` IS the sealed recovery row (just sealed above, or
        // loaded from that seal), so every replay below passes
        // SEALED_TERMINAL_REPLAY and the barrier need not re-prove the seal.

        if (isCancelledUnstartedPvpDuel(session)) {
            await replayCommittedPvpTerminalEffects(session, SEALED_TERMINAL_REPLAY);
            return res.status(200).json({
                ok: true,
                alreadyClaimed: false,
                completionPending: false,
                rewardAuthorized: false,
                progressionAuthorized: false,
            });
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
                        committedTerminalReplay = await replayCommittedPvpTerminalEffects(session, SEALED_TERMINAL_REPLAY);
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
                        await replayCommittedPvpTerminalEffects(session, SEALED_TERMINAL_REPLAY);
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
                const refusal = exactPlayerRankedV2Terminal ? playerRankedClaimRefusal(error) : null;
                if (refusal) return res.status(409).json({ error: refusal });
                return res.status(503).json({
                    error: 'Draw settlement is still finalizing. Retry this claim.',
                });
            }
            if (!reservation.completionPending) {
                await clearPvpPendingSessionPointer(kv, playerName, battleId, session.createdAt);
            }
            const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
            return res.status(200).json({
                ok: true,
                alreadyClaimed: reservation.alreadyClaimed,
                completionPending: reservation.completionPending,
                rewardAuthorized: false,
                progressionAuthorized: false,
                ...(finalChar ? { character: finalChar, _saveVersion: Number(finalSave?._saveVersion ?? 0) } : {}),
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
                committedTerminalReplay = await replayCommittedPvpTerminalEffects(session, SEALED_TERMINAL_REPLAY);
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
                committedTerminalReplay = await replayCommittedPvpTerminalEffects(session, SEALED_TERMINAL_REPLAY);
            }
        } catch (error) {
            console.error('[pvp/claim-rewards] consumable settlement pending', error);
            const refusal = playerRankedClaimRefusal(error);
            if (refusal) return res.status(409).json({ error: refusal });
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
        const rememberDuel=(already:boolean)=>{
            const sector=session.duelGround?.sector??raidSector;
            if(outcome==='win'&&!already&&Number.isSafeInteger(sector))
                void recordSectorDuelScar(sector,winnerName,loserName,Date.now(),session.duelGround?.tile,session.duelGround?.witnesses).catch(()=>undefined);
        };
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
                // The terminal barrier just settled this exact proof (same
                // attacker, proof id, terminal time, sector and evidence) and a
                // replay returns the same in-save receipt. Reuse its result; only
                // when the barrier deferred it does the claim settle it here.
                worldRaidProgression = committedTerminalReplay.worldSettlement?.raid ?? await settleRaidProgressionWithDailyCap({
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
        //   • BASE purse — when the session was stamped baseRewards AND this is
        //     the WINNER's own claim (or, with the anchored purse on, the engaged
        //     LOSER's), priced by api/pvp/_valid-fight.ts from the sealed session
        //     (Death's Gate / Obsidian multiplier via rewardSector + stamp).
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
        // Loss credit (2026-10 rebalance #2 / #23): an engaged loser earns 0.4 of
        // the win purse and, on Lv40-49 rows, loss mastery XP. Each half has its
        // own switch, so turning loss ryo off (purse or loss dial at 0) keeps the
        // mastery XP; with both off the loser's claim keeps its old path and never
        // locks its own save.
        const creditLoss = rewardAuthorized
            && session.baseRewards === true
            && outcome === 'loss'
            && !isRankedClaim
            && ((pvpPurseScale() > 0 && pvpLossFrac() > 0) || pvpMastery4049Enabled());
        if (isRankedClaim || creditBase || creditLoss || shouldSettleVillageWar) {
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
                reward?: {
                    ryo: number;
                    combatGrowth: number;
                    auraDust: number;
                    jutsuXp?: number;
                    /** How this fight was credited (repeat opponent, short fight), for the result card. */
                    credit?: ReturnType<typeof pvpCreditView>;
                };
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
            // Honor-Seals (_vanguard-rewards.ts). The base purse is left alone
            // here — it has its own unordered daily pair weights
            // (_valid-fight.ts), which have no device false-positives — so only
            // the LADDER is protected.
            // Computed OUTSIDE the save lock (read-only key scan). Fails OPEN: a
            // KV hiccup must never block a legitimate rating settlement.
            let playerRankedRatingOut: RatingOut | undefined;
            let playerRankedPurseOut: { ryo: number; reason?: 'too-young'; credit: ReturnType<typeof rankedPurseCredit> } | undefined;
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
                        // The result card shows the Elo the journal credited,
                        // at the match's sealed repeat/short-fight weight (I-3).
                        const weightRow = journal.terminal.rankedEligible
                            ? await readRankedWeightRow(kv, journal.terminal.matchId).catch(() => null)
                            : null;
                        const weight = weightRow?.weight ?? 1;
                        const delta = journal.terminal.rankedEligible && journal.terminal.winner !== 'draw'
                            ? weightedRankedDelta(winnerSnapshot, loserSnapshot, weight) * (side === journal.terminal.winner ? 1 : -1)
                            : 0;
                        playerRankedRatingOut = { field: 'rankedRating', value, delta };
                        // And the ranked purse the journal paid from the same row
                        // (owner ruling A9: no silent wallet change).
                        if (weightRow && journal.terminal.winner !== 'draw') {
                            const role = side === journal.terminal.winner ? 'winner' as const : 'loser' as const;
                            const claimer = (await kv.get<{ character?: Record<string, unknown> }>(`save:${claimerSlug}`).catch(() => null))?.character;
                            playerRankedPurseOut = {
                                ryo: rankedPurseRyo(weightRow, { role, lucky: pvpLuckyActive(claimer) }),
                                ...(weightRow.purseBlocked ? { reason: weightRow.purseBlocked }
                                    : role === 'loser' && weightRow.lossPurseBlocked ? { reason: weightRow.lossPurseBlocked } : {}),
                                credit: rankedPurseCredit(weightRow, role),
                            };
                        }
                    }
                } catch (error) {
                    const refusal = playerRankedClaimRefusal(error);
                    if (refusal) return res.status(409).json({ error: refusal });
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
            //
            // Each credit below runs as a decision under the save lock
            // withSavesLocked already holds (mutatePlayerSaveLocked), so it
            // keeps the idle recovery the fighter earned since their last save.
            // A raw write discarded it: a loser who walked away after the
            // fight, whose rating the winner's claim settles, came back to the
            // vitals they left with.
            const settleRatingFor = async (slug: string, role: 'winner' | 'loser'): Promise<RatingOut | undefined> => {
                if (!rankedEligible) return undefined;
                if (!slug) throw new Error(`ranked-${role}-identity-missing`);
                const out = await mutatePlayerSaveLocked<RatingOut>(slug, ({ character: char }) => {
                    const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind });
                    const sid = pvpSettlementId('rating', battleId);
                    const decision = inspectPvpCredit(char, sid, `rating-${role}`);
                    const delta = role === 'winner' ? r.delta : -r.delta;
                    if (decision.fresh) {
                        const credited = embedPvpSettlementReceipt({ ...char, ...r.patch }, decision.receipts, sid, `rating-${role}`, Date.now());
                        return { ok: true, value: { field: ratingField, value: r.newRating, delta }, character: credited };
                    }
                    // Already settled — return the stored authoritative rating.
                    const cur = Number(char[ratingField]);
                    const settled = { field: ratingField, value: Number.isFinite(cur) ? cur : r.newRating, delta };
                    if (!decision.needsBackfill) return { ok: true, value: settled, character: char, write: false };
                    const backfilled = embedPvpSettlementReceipt(
                        char,
                        decision.receipts,
                        sid,
                        `rating-${role}`,
                        Date.now(),
                    );
                    return { ok: true, value: settled, character: backfilled };
                });
                if (!out.ok) throw new Error(out.status === 404 ? `ranked-${role}-save-missing` : out.error);
                return out.value;
            };

            // Credit the winner's base ryo+XP exactly once, ATOMICALLY: the credit
            // and its idempotency receipt (serverSettlementReceipts) are written in
            // ONE kv.set, so a crash between the two can't permanently lose the
            // payout the way the old separate-receipt `key` gate did. Re-reads the
            // save so a rating patch applied just above is preserved.
            // The ryo this claim freshly committed, for the economy telemetry row
            // written after the save commit (never from inside the decision, which
            // can run more than once).
            let committedPvpRyo: { player: string; delta: number; txnId: string; source: 'pvp.win' | 'pvp.loss' } | null = null;
            const settleBaseForWinner = async (): Promise<BaseOut | undefined> => {
                const out = await mutatePlayerSaveLocked<BaseOut>(winnerSlug, async ({ character: char }) => {
                    committedPvpRyo = null;
                    // #1A settlement-side guard (defense in depth): base ryo/XP is a
                    // PvP-win reward, so re-verify AT THE MONEY-MOVING STEP that the
                    // loser was a real player with an authoritative save — session
                    // creation is not the only enforcement point. A fabricated no-save
                    // NPC opponent (or any legacy session stamped baseRewards before
                    // the session-side gate landed) never pays out. Fails closed on a
                    // transient loser-save read miss; the winner can retry the claim.
                    const loserRecord = loserSlug ? await kv.get<Record<string, unknown>>(`save:${loserSlug}`) : null;
                    if (!loserRecord?.character) throw new Error('pvp-base-loser-save-missing');
                    const sid = pvpSettlementId('base', battleId);
                    const decision = inspectPvpCredit(char, sid, 'base');
                    if (decision.fresh) {
                        // One valid-fight rule set (api/pvp/_valid-fight.ts): the
                        // lower level prices the purse, a >20-level stomp or a
                        // loser under 72 h old pays nothing, the unordered pair's
                        // fights today weigh 1/1/0.5/0.25/0, and a short flee/AFK
                        // win pays 0 (a short KO half). The in-save receipt makes
                        // the PAYOUT exactly-once; the pair slot is assigned once
                        // per battle, so a retry or the loser's claim reads the
                        // same ordinal and the counter moves once.
                        const fight = await resolvePvpFightCredit(kv, {
                            session,
                            battleId,
                            winnerSlug,
                            loserSlug,
                            winnerChar: char,
                            loserChar: loserRecord.character as Record<string, unknown>,
                            terminalAt: rewardEventAt,
                            role: 'win',
                        });
                        const dRyo = pvpCreditRyo(fight, {
                            role: 'win',
                            lucky: pvpLuckyActive(char),
                            sector: session.rewardSector,
                            stronghold: session.rewardStronghold,
                        });
                        const dDust = pvpCreditAuraDust(fight);
                        const credit = creditPvpWinBase(char, dRyo);
                        let finalChar: Record<string, unknown> = credit.char;
                        const mastery = creditPvpJutsuMastery(finalChar, session, fight.factor, 'win');
                        finalChar = mastery.character;
                        let summary: BaseOut = credit.summary;
                        let combatGrowthAwarded = 0;
                        // Eligible player-versus-player wins grant small, daily-capped
                        // combat stat growth. Spars and pet-only ranked matches do not
                        // reach this player-character reward path. Modern ranked player
                        // matches settle growth in the ranked journal. A fight that
                        // pays no ryo (uncredited, pair exhausted, short flee/AFK)
                        // reserves nothing from the shared daily stat budget.
                        const shouldGrowPlayer = (!isRankedClaim
                            || (!playerRankedV2Claim && session.rankedKind === 'player'))
                            && fight.factor > 0;
                        if (shouldGrowPlayer) {
                            const statsNow = (finalChar.stats ?? {}) as Record<string, number>;
                            // Combat wins never take the era dial (2026-07-27 ruling,
                            // docs/leveling-without-xp-map.md §11 item 7), nor trait or
                            // encounter boosts. The admin growth event scales the
                            // REQUEST; the shared daily stat-point budget then bounds what
                            // is credited, so an event fills the budget sooner but never
                            // raises it (I-12). A replayed reservation returns the stored,
                            // already event-scaled points.
                            const requestedGrowth = Math.round(PVP_CASUAL_STAT_POINTS_PER_WIN * growthEventBoost);
                            const statBudget = await reserveCombatStatBudget(kv, {
                                playerName: winnerSlug,
                                battleId,
                                eventAt: rewardEventAt,
                                requested: requestedGrowth,
                                cap: DAILY_COMBAT_STAT_CAP,
                            });
                            const earned = statBudget.points;
                            const g = computeCombatStatGrowth(statsNow, Number(finalChar.level) || 1, earned, earned);
                            combatGrowthAwarded = g.spent;
                            if (earned > 0 && g.spent > 0) {
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
                            auraDust: Math.max(0, Number(finalChar.auraDust) || 0) + dDust,
                            totalPvpKills: Math.max(0, Math.floor(Number(finalChar.totalPvpKills) || 0)) + 1,
                            monthlyPvpKills: monthlyKills,
                            pvpKillMonth: month,
                            // +1 clan battle contribution per PvP win, the source the
                            // save sanitizer budgets for. Nothing wrote it, so the
                            // "Win 20 Battles" clan mission and the Clan Patriot
                            // achievement could never be reached. A win from an
                            // earlier month than the stored stamp counts toward none.
                            ...addClanContrib(finalChar, 'clanBattleContrib', eventMonth),
                        };
                        summary = {
                            ...summary,
                            reward: {
                                ryo: dRyo,
                                combatGrowth: combatGrowthAwarded,
                                auraDust: dDust,
                                jutsuXp: mastery.awarded,
                                credit: pvpCreditView(fight),
                            },
                            auraDust: Number(finalChar.auraDust),
                            inventory: finalChar.inventory,
                            totalPvpKills: Number(finalChar.totalPvpKills),
                            monthlyPvpKills: Number(finalChar.monthlyPvpKills),
                            pvpKillMonth: month,
                        } as typeof summary;
                        // Embed the idempotency receipt INTO the credited character so
                        // the payout and its marker persist together in one atomic write.
                        const credited = embedPvpSettlementReceipt(finalChar, decision.receipts, sid, 'base', Date.now());
                        committedPvpRyo = { player: winnerSlug, delta: dRyo, txnId: sid, source: 'pvp.win' };
                        return { ok: true, value: summary, character: credited };
                    }
                    const totals: BaseOut = {
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
                    if (!decision.needsBackfill) return { ok: true, value: totals, character: char, write: false };
                    const backfilled = embedPvpSettlementReceipt(
                        char,
                        decision.receipts,
                        sid,
                        'base',
                        Date.now(),
                    );
                    return { ok: true, value: totals, character: backfilled };
                });
                if (!out.ok) throw new Error(out.status === 404 ? 'pvp-base-winner-save-missing' : out.error);
                return out.value;
            };

            // Credit an engaged loser's loss pay exactly once (in-save receipt,
            // like the winner's base). It shares the battle's pair slot with the
            // winner's claim. Being beaten without engaging (short fight, flee,
            // AFK, under 15% of the winner's HP dealt) or past the pair's 4th
            // fight today pays nothing. Stat points and Aura Dust stay win-only.
            const settleBaseForLoser = async (): Promise<BaseOut | undefined> => {
                const out = await mutatePlayerSaveLocked<BaseOut>(loserSlug, async ({ character: char }) => {
                    committedPvpRyo = null;
                    // Fails closed on a transient read miss: the loser can retry.
                    const winnerRecord = winnerSlug ? await kv.get<Record<string, unknown>>(`save:${winnerSlug}`) : null;
                    if (!winnerRecord?.character) throw new Error('pvp-loss-winner-save-missing');
                    const sid = pvpSettlementId('loss', battleId);
                    const decision = inspectPvpCredit(char, sid, 'loss');
                    const totals = (c: Record<string, unknown>): BaseOut => ({
                        ryo: Number(c.ryo) || 0,
                        xp: Number(c.xp) || 0,
                        level: Number(c.level) || 0,
                        rankTitle: typeof c.rankTitle === 'string' ? c.rankTitle : '',
                        maxHp: Number(c.maxHp) || 0,
                        maxChakra: Number(c.maxChakra) || 0,
                        maxStamina: Number(c.maxStamina) || 0,
                        unspentStats: Number(c.unspentStats) || 0,
                    });
                    if (decision.fresh) {
                        const fight = await resolvePvpFightCredit(kv, {
                            session,
                            battleId,
                            winnerSlug,
                            loserSlug,
                            winnerChar: winnerRecord.character as Record<string, unknown>,
                            loserChar: char,
                            terminalAt: rewardEventAt,
                            role: 'loss',
                        });
                        const lossRyo = pvpCreditRyo(fight, {
                            role: 'loss',
                            sector: session.rewardSector,
                            stronghold: session.rewardStronghold,
                        });
                        let finalChar: Record<string, unknown> = lossRyo > 0
                            ? { ...char, ryo: (Number(char.ryo) || 0) + lossRyo }
                            : char;
                        const mastery = creditPvpJutsuMastery(finalChar, session, fight.factor, 'loss');
                        finalChar = mastery.character;
                        const summary: BaseOut = {
                            ...totals(finalChar),
                            reward: {
                                ryo: lossRyo,
                                combatGrowth: 0,
                                auraDust: 0,
                                jutsuXp: mastery.awarded,
                                credit: pvpCreditView(fight),
                            },
                        };
                        const credited = embedPvpSettlementReceipt(finalChar, decision.receipts, sid, 'loss', Date.now());
                        committedPvpRyo = { player: loserSlug, delta: lossRyo, txnId: sid, source: 'pvp.loss' };
                        return { ok: true, value: summary, character: credited };
                    }
                    if (!decision.needsBackfill) return { ok: true, value: totals(char), character: char, write: false };
                    const backfilled = embedPvpSettlementReceipt(char, decision.receipts, sid, 'loss', Date.now());
                    return { ok: true, value: totals(char), character: backfilled };
                });
                if (!out.ok) throw new Error(out.status === 404 ? 'pvp-loss-loser-save-missing' : out.error);
                return out.value;
            };

            const settleWarGroundForWinner = async (creditWarGround: boolean): Promise<WarGroundOut | undefined> => {
                if (!creditWarGround) return undefined;
                const out = await mutatePlayerSaveLocked<WarGroundOut>(winnerSlug, ({ character: char }) => {
                    const credited = creditPvpWarGroundReward(char, battleId, warGroundRewardAt);
                    const value: WarGroundOut = {
                        fresh: credited.fresh,
                        bountyCredited: credited.bountyCredited,
                        raidProgress: credited.raidProgress,
                        ryoAwarded: credited.fresh && credited.bountyCredited ? PVP_WAR_GROUND_BOUNTY_RYO : 0,
                        fateShardsAwarded: credited.fresh && credited.bountyCredited ? PVP_WAR_GROUND_BOUNTY_FATE_SHARDS : 0,
                    };
                    return credited.writeRequired
                        ? { ok: true, value, character: credited.character }
                        : { ok: true, value, character: char, write: false };
                });
                if (!out.ok) throw new Error(out.status === 404 ? 'war-ground-winner-save-missing' : out.error);
                return out.value;
            };

            try {
                // Lock every save we may write — claimer + opponent for a ranked
                // settlement or a loser's loss pay, winner-only for a casual win.
                // Sorted lock order keeps the two fighters' claims deadlock-free.
                const locks = isRankedClaim || creditLoss ? [winnerSlug, loserSlug] : [winnerSlug];
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
                        : (helpForwardServerCredits && creditLoss && claimerSlug === loserSlug && loserSlug !== winnerSlug)
                            ? await settleBaseForLoser()
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
                // PvP purse telemetry (I-19): only a credit this claim committed,
                // after the commit. Best-effort; never blocks the claim.
                const pvpTxn = committedPvpRyo as { player: string; delta: number; txnId: string; source: string } | null;
                if (pvpTxn && pvpTxn.delta > 0) {
                    void recordEconomyTxn({ ...pvpTxn, currency: 'ryo', ts: rewardEventAt });
                }
                // Record the server-credited settlement on the durable battle
                // receipt (Priority 4 visibility). Best-effort: never blocks or
                // fails the claim. The shared receipt stores the unsigned Elo
                // movement; each fighter's claim keeps its signed delta.
                // base ryo+XP is flagged via a note (the summary returns totals,
                // not the per-battle gain, so we don't mislabel it as the reward).
                await patchBattleSettlement(battleId, {
                    ...(out.rating ? { ratingDelta: Math.abs(out.rating.delta) } : {}),
                    ...(creditBase ? { note: 'base ryo+XP credited to winner' } : {}),
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
                rememberDuel(out.already);
                return res.status(200).json({
                    ok: true,
                    alreadyClaimed: out.already,
                    completionPending: out.completionPending,
                    rewardAuthorized,
                    progressionAuthorized,
                    ...(out.rating ? { rating: out.rating } : {}),
                    ...(playerRankedPurseOut ? { rankedPurse: playerRankedPurseOut } : {}),
                    ...(out.base ? { base: out.base } : {}),
                    ...(out.warGround ? { warGroundReward: out.warGround } : {}),
                    ...(warPoints ? { warPoints } : {}),
                    ...(worldRaidProgressionForCaller ? { raidProgression: raidProgressionBody(worldRaidProgressionForCaller) } : {}),
                    ...(clanWarScrollDrop ? { clanWarScrollDrop } : {}),
                    ...(outcome === 'win' ? await dailyStatBudgetReply(kv, playerName) : {}),
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
            // from the sealed battle-start ground (sector-only reward metadata
            // for older sessions), never a client's claim about where it
            // happened. Fire-and-forget by design: a scar is a
            // display record nothing reads back, so it must not be able to
            // delay or fail a settled reward (same posture as creditSectorIntel
            // on the explore receipt).
            rememberDuel(alreadyClaimed);
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
