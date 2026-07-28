import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { creditRankedOutcome } from '../_ranked-rating.js';
import { computePvpWinGains, creditPvpWinBase, applyDerivedLevel } from '../_xp-engine.js';
import { patchBattleSettlement } from '../_receipts.js';
import { recordPairWinAndDecay } from './_reward-farm.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { computeCombatStatGrowth, PVP_CASUAL_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP, statGainMultiplier } from '../_stat-growth.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import type { PvpSession } from './session.js';
import { grantTerritoryScrollsToInventory } from '../missions/_mission-catalog.js';
import { pvpSettlementId, inspectPvpCredit, embedPvpSettlementReceipt } from './_reward-settlement.js';

// Session-replay window — tightened from 24h to 2h. Sessions themselves
// have a 15-min KV TTL (see pvp/session.ts), so a 24h claim window outlived
// the evidence by 23+ hours. 2 hours gives players with bad connections,
// background-tab freezes, and mobile-app-switch delays plenty of headroom
// while closing most of the reward-shifting gap.
const SESSION_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;

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
//   POST { battleId, playerName, outcome: 'win' | 'loss' }
//   → 200 { ok: true, alreadyClaimed: boolean }
//   The caller MUST skip its local reward grant when alreadyClaimed is true.
//
// Storage: pvp:rewarded:<playerName>:<battleId>  (24h TTL — well past the
// 60-min session TTL, so even a slow re-mount can't slip past.)

const CLAIM_TTL_SECONDS = 24 * 60 * 60;

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
export function deductUsedItems(char: Record<string, unknown>, used: Record<string, number>): Record<string, unknown> {
    const stacks = Array.isArray(char.itemStacks)
        ? (char.itemStacks as Array<Record<string, unknown>>).map((s) => ({ ...s }))
        : [];
    const inv = Array.isArray(char.inventory) ? [...(char.inventory as unknown[])] : [];
    for (const [id, rawN] of Object.entries(used)) {
        let n = Math.max(0, Math.floor(Number(rawN) || 0));
        if (n <= 0) continue;
        for (const s of stacks) {
            if (n <= 0) break;
            if (s.itemId !== id) continue;
            const c = Math.max(0, Math.floor(Number(s.count) || 0));
            const take = Math.min(c, n);
            s.count = c - take;
            n -= take;
        }
        while (n > 0) {
            const idx = inv.indexOf(id);
            if (idx < 0) break;
            inv.splice(idx, 1);
            n -= 1;
        }
    }
    return { ...char, itemStacks: stacks.filter((s) => Math.floor(Number(s.count) || 0) > 0), inventory: inv };
}

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
        if (!playerName || !battleId) {
            return res.status(400).json({ error: 'Missing playerName or battleId.' });
        }
        if (outcome !== 'win' && outcome !== 'loss') {
            return res.status(400).json({ error: "outcome must be 'win' or 'loss'." });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own rewards.' });
        }

        // Authoritative outcome check — load the actual session and verify
        // that the caller really is the recorded winner/loser. Without this,
        // a malicious client could POST { battleId: '<any-old-id>',
        // outcome: 'win' } and the NX reserve alone would let it pass,
        // unlocking the client-applied ryo / XP / ranked-rating / clan-war
        // grants on the next save flush. Mirrors the verification regime
        // already used by api/missions/report-pvp-win.ts.
        const session = await kv.get<PvpSession>(`pvp:${battleId}`);
        if (!session) return res.status(404).json({ error: 'Battle session not found or expired.' });
        if (session.status !== 'done' || !session.winner) {
            return res.status(409).json({ error: 'Battle not yet decided.' });
        }
        const sessionAge = Date.now() - Number(session.createdAt ?? 0);
        if (sessionAge > SESSION_REPLAY_WINDOW_MS) {
            return res.status(409).json({ error: 'Battle session is too old to claim.' });
        }
        const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
        const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
        // winnerName/loserName are stored DISPLAY names (may contain spaces);
        // canonicalize through safeName to compare with the slug `playerName`.
        const expectedSide = outcome === 'win' ? winnerName : loserName;
        if (!identity.admin && safeName(expectedSide) !== playerName) {
            return res.status(403).json({
                error: `Recorded ${outcome === 'win' ? 'winner' : 'loser'} of this battle is not you.`,
            });
        }

        const key = claimKey(playerName, battleId);

        // ── Server-authoritative PvP consumable deduction ───────────────────
        // Remove the throwables / consumables / potions the SERVER recorded this
        // fighter spending this fight (session.itemsUsed — sealed at create time
        // and decremented per use in move.ts) from their own save. Runs for EVERY
        // pvp fight (ranked AND casual), independent of the rating/base-reward
        // block below, and is idempotent via a per-(player,battle) NX receipt so a
        // claim retry can't double-deduct. Best-effort: a fighter who never claims
        // keeps what they spent (the server-sealed cap already bounded their use).
        const claimerRole: 'p1' | 'p2' | null =
            playerName === safeName(session.p1?.name ?? '') ? 'p1'
            : playerName === safeName(session.p2?.name ?? '') ? 'p2'
            : null;
        const usedByClaimer: Record<string, number> = (claimerRole && session.itemsUsed?.[claimerRole]) || {};
        if (claimerRole && Object.keys(usedByClaimer).length > 0) {
            try {
                await withSavesLocked([playerName], async () => {
                    // Exactly-once AND atomic: the idempotency receipt lives IN the
                    // deducted save (serverSettlementReceipts), so the deduction and
                    // its receipt land in ONE kv.set. The old two-key pattern set the
                    // receipt in a SEPARATE write after the save, so a crash between
                    // them could re-deduct on retry; now a crash before the write
                    // re-deducts (fresh) and a crash after skips (replay) — no gap.
                    // Serialized by the save lock so concurrent claims can't double.
                    const saveKey = `save:${playerName}`;
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const char = record?.character as Record<string, unknown> | undefined;
                    if (!record || !char) return;
                    const sid = pvpSettlementId('items', battleId);
                    const decision = inspectPvpCredit(char, sid, 'items');
                    if (!decision.fresh) return; // already deducted on a prior claim
                    const deducted = deductUsedItems(char, usedByClaimer);
                    const withReceipt = embedPvpSettlementReceipt(deducted, decision.receipts, sid, 'items', Date.now());
                    const next = bumpSaveVersion({ ...record, character: withReceipt });
                    await kv.set(saveKey, mergePreservingImages(next, record));
                });
            } catch { /* lock contention (failClosed) → skip; a later claim retry settles */ }
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
        const isRankedClaim =
            session.ranked === true &&
            (session.rankedKind === 'player' || session.rankedKind === 'pet') &&
            (session.winner === 'p1' || session.winner === 'p2');
        const creditBase = session.baseRewards === true && outcome === 'win';
        if (isRankedClaim || creditBase) {
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
            let rankedEligible = isRankedClaim;
            if (isRankedClaim) {
                try {
                    if (await hasRecentIpOrFpOverlap(winnerName, loserName)) rankedEligible = false;
                } catch { /* fail open */ }
            }

            // Apply ONE fighter's once-per-battle ranked-rating delta and return
            // that fighter's resulting rating. Exactly-once AND atomic: the rating
            // patch and its idempotency receipt are written together in ONE kv.set
            // (the receipt lives in the same save via serverSettlementReceipts), so
            // a crash can never place the receipt without the credit. The old
            // separate-key receipt COULD be placed while the save write was lost —
            // and the retry then skipped, permanently losing the Elo change.
            const settleRatingFor = async (slug: string, role: 'winner' | 'loser'): Promise<RatingOut | undefined> => {
                if (!rankedEligible || !slug) return undefined;
                const saveKey = `save:${slug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) return undefined;
                const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind });
                const sid = pvpSettlementId('rating', battleId);
                const decision = inspectPvpCredit(char, sid, `rating-${role}`);
                if (decision.fresh) {
                    const credited = embedPvpSettlementReceipt({ ...char, ...r.patch }, decision.receipts, sid, `rating-${role}`, Date.now());
                    const next = bumpSaveVersion({ ...record, character: credited });
                    await kv.set(saveKey, mergePreservingImages(next, record));
                    return { field: ratingField, value: r.newRating, delta: r.delta };
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
                if (!record || !char) return undefined;
                // #1A settlement-side guard (defense in depth): base ryo/XP is a
                // PvP-win reward, so re-verify AT THE MONEY-MOVING STEP that the
                // loser was a real player with an authoritative save — session
                // creation is not the only enforcement point. A fabricated no-save
                // NPC opponent (or any legacy session stamped baseRewards before
                // the session-side gate landed) never pays out. Fails closed on a
                // transient loser-save read miss; the winner can retry the claim.
                const loserRecord = loserSlug ? await kv.get<Record<string, unknown>>(`save:${loserSlug}`) : null;
                if (!loserRecord?.character) return undefined;
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
                    let summary = credit.summary;
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
                        const budgetKey = `combat-stat-count:${winnerSlug}:${new Date().toISOString().slice(0, 10)}`;
                        const spentToday = Number((await kv.get<number>(budgetKey)) ?? 0);
                        const remaining = Math.max(0, DAILY_COMBAT_STAT_CAP - spentToday);
                        const statsNow = (finalChar.stats ?? {}) as Record<string, number>;
                        // The slice ledger charges BASE points; boosts multiply the
                        // payout after slice accounting (map §4.1): the retired Swift
                        // +25% / Death's Gate ×2 XP bonuses (growthMult) and the era
                        // dial scale what's granted, not what's charged.
                        const baseEarned = Math.max(0, Math.min(PVP_CASUAL_STAT_POINTS_PER_WIN, remaining));
                        const boosted = Math.round(baseEarned * growthMult * statGainMultiplier());
                        const g = computeCombatStatGrowth(statsNow, Number(finalChar.level) || 1, boosted, boosted);
                        if (baseEarned > 0 && g.spent > 0) {
                            await kv.set(budgetKey, spentToday + baseEarned, { ex: 25 * 60 * 60 }).catch(() => undefined);
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
                    const month = new Date().toISOString().slice(0, 7);
                    const monthlyKills = finalChar.pvpKillMonth === month ? Number(finalChar.monthlyPvpKills) || 0 : 0;
                    finalChar = {
                        ...finalChar,
                        auraDust: Math.max(0, Number(finalChar.auraDust) || 0) + 6,
                        inventory: grantTerritoryScrollsToInventory(finalChar, 5),
                        totalPvpKills: Math.max(0, Math.floor(Number(finalChar.totalPvpKills) || 0)) + 1,
                        monthlyPvpKills: monthlyKills + 1,
                        pvpKillMonth: month,
                    };
                    summary = {
                        ...summary,
                        auraDust: Number(finalChar.auraDust),
                        inventory: finalChar.inventory,
                        totalPvpKills: Number(finalChar.totalPvpKills),
                        monthlyPvpKills: Number(finalChar.monthlyPvpKills),
                        pvpKillMonth: month,
                    } as typeof summary;
                    // Embed the idempotency receipt INTO the credited character so
                    // the payout and its marker persist together in one atomic write.
                    const credited = embedPvpSettlementReceipt(finalChar, decision.receipts, sid, 'base', Date.now());
                    const next = bumpSaveVersion({ ...record, character: credited });
                    await kv.set(saveKey, mergePreservingImages(next, record));
                    return summary;
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

            try {
                // Lock every save we may write — claimer + opponent for a ranked
                // settlement, winner-only for a casual base reward.
                const locks = isRankedClaim ? [winnerSlug, loserSlug] : [winnerSlug];
                const out = await withSavesLocked(locks, async () => {
                    // Caller's own claim receipt — gates the client's local
                    // self-apply (alreadyClaimed). Distinct from the per-player
                    // rating receipts below.
                    const placedSelf = await kv.set(key, { outcome, ts: Date.now() }, { nx: true, ex: CLAIM_TTL_SECONDS } as never);
                    const already = !placedSelf;

                    // Settle BOTH ratings (each exactly once across the battle).
                    const winnerRatingOut = await settleRatingFor(winnerSlug, 'winner');
                    const loserRatingOut = (loserSlug && loserSlug !== winnerSlug)
                        ? await settleRatingFor(loserSlug, 'loser')
                        : undefined;

                    // Winner base reward — only when the WINNER is the caller. Its
                    // own in-save receipt gates the credit now (not `already`), so
                    // a crash that placed `key` but lost the payout is RECOVERED on
                    // retry instead of being permanently skipped.
                    const base = (creditBase && claimerSlug === winnerSlug)
                        ? await settleBaseForWinner()
                        : undefined;

                    const rating = claimerSlug === winnerSlug ? winnerRatingOut
                        : claimerSlug === loserSlug ? loserRatingOut
                        : undefined;
                    return { already, rating, base };
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
                if (!out.already) {
                    await recordBetaMetric({
                        event: 'pvp.settled',
                        playerName,
                        level: Number(finalChar?.level ?? 0),
                        source: `${session.ranked ? `ranked-${session.rankedKind ?? 'player'}` : session.baseRewards ? 'base' : 'verified'}:${outcome}`,
                    });
                }
                return res.status(200).json({
                    ok: true,
                    alreadyClaimed: out.already,
                    ...(out.rating ? { rating: out.rating } : {}),
                    ...(out.base ? { base: out.base } : {}),
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
            const placed = await kv.set(key, { outcome, ts: Date.now() }, { nx: true, ex: CLAIM_TTL_SECONDS } as never);
            alreadyClaimed = !placed;
            const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
            const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
            if (!alreadyClaimed) {
                await recordBetaMetric({
                    event: 'pvp.settled',
                    playerName,
                    level: Number(finalChar?.level ?? 0),
                    source: `casual:${outcome}`,
                });
            }
            return res.status(200).json({ ok: true, alreadyClaimed, _saveVersion: Number(finalSave?._saveVersion ?? 0) });
        } catch (reserveErr) {
            console.error('[pvp/claim-rewards] reserve failed (fail-open)', reserveErr);
            const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
            return res.status(200).json({ ok: true, alreadyClaimed: false, degraded: true, _saveVersion: Number(finalSave?._saveVersion ?? 0) });
        }
    } catch (err) {
        console.error('[pvp/claim-rewards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
