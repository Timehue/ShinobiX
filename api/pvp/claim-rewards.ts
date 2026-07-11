import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { creditRankedOutcome } from '../_ranked-rating.js';
import { computePvpWinGains, creditPvpWinBase } from '../_xp-engine.js';
import { patchBattleSettlement } from '../_receipts.js';
import { recordPairWinAndDecay } from './_reward-farm.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { computeCombatStatGrowth, PVP_CASUAL_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP } from '../_stat-growth.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import type { PvpSession } from './session.js';
import { grantVanguardRewardsForSession } from './_vanguard-rewards.js';
import {
    abortEconomicReceipt,
    commitEconomicReceipt,
    isEconomicReceiptStorageError,
    reserveEconomicReceipt,
} from '../_economic-receipt.js';

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
        if (session.winner !== 'p1' && session.winner !== 'p2') {
            return res.status(409).json({ error: 'Drawn battles do not have win/loss rewards.' });
        }
        const sessionAge = Date.now() - Number(session.createdAt ?? 0);
        if (sessionAge > SESSION_REPLAY_WINDOW_MS) {
            return res.status(409).json({ error: 'Battle session is too old to claim.' });
        }
        const winnerName = (session.winner === 'p1' ? session.p1.name : session.p2.name) ?? '';
        const loserName = (session.winner === 'p1' ? session.p2.name : session.p1.name) ?? '';
        // winnerName/loserName are stored DISPLAY names (may contain spaces);
        // canonicalize through safeName to compare with the slug `playerName`.
        const playerIsWinner = safeName(winnerName) === playerName;
        const playerIsLoser = safeName(loserName) === playerName;
        if (!playerIsWinner && !playerIsLoser) {
            return res.status(403).json({
                error: 'This player did not participate in the recorded battle.',
            });
        }
        const authoritativeOutcome = playerIsWinner ? 'win' : 'loss';
        if (outcome !== authoritativeOutcome) {
            return res.status(409).json({ error: 'Reported outcome conflicts with the server battle result.' });
        }

        const key = claimKey(playerName, battleId);

        // ── Server-authoritative PvP consumable deduction ───────────────────
        // Remove the throwables / consumables / potions the SERVER recorded this
        // fighter spending this fight (session.itemsUsed — sealed at create time
        // and decremented per use in move.ts) from their own save. Runs for EVERY
        // pvp fight (ranked AND casual), independent of the rating/base-reward
        // block below, and is idempotent via a per-(player,battle) NX receipt so a
        // claim retry can't double-deduct. Receipt or deduction ambiguity fails
        // the whole reward claim closed; a fighter who never claims keeps what
        // they spent (the server-sealed cap already bounded their use).
        const claimerRole: 'p1' | 'p2' | null =
            playerName === safeName(session.p1?.name ?? '') ? 'p1'
            : playerName === safeName(session.p2?.name ?? '') ? 'p2'
            : null;
        const usedByClaimer: Record<string, number> = (claimerRole && session.itemsUsed?.[claimerRole]) || {};
        if (claimerRole && Object.keys(usedByClaimer).length > 0) {
            try {
                await withSavesLocked([playerName], async () => {
                    // Reserve a durable fingerprint before mutating inventory.
                    // A KV failure denies the whole claim; an identical retry is
                    // a no-op, and conflicting server item-use snapshots fail.
                    const consumedKey = `pvp:items-consumed:${playerName}:${battleId}`;
                    const itemUseFingerprint = Object.entries(usedByClaimer)
                        .map(([id, count]) => [id, Math.max(0, Math.floor(Number(count) || 0))] as const)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([id, count]) => `${id}:${count}`)
                        .join(',');
                    const reservation = await reserveEconomicReceipt(kv, {
                        key: consumedKey,
                        fingerprint: `pvp-items:${playerName}:${battleId}:${itemUseFingerprint}`,
                        ttlSeconds: CLAIM_TTL_SECONDS,
                        metadata: { playerName, battleId },
                    });
                    if (reservation.status === 'conflict') {
                        throw new Error(`Conflicting item-use receipt for battle ${battleId}.`);
                    }
                    if (reservation.status === 'replay') return;
                    const saveKey = `save:${playerName}`;
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const char = record?.character as Record<string, unknown> | undefined;
                    if (!record || !char) {
                        await abortEconomicReceipt(kv, consumedKey, reservation);
                        return;
                    }
                    const updated = deductUsedItems(char, usedByClaimer);
                    const next = bumpSaveVersion({ ...record, character: updated });
                    // Never abort after a protected write attempt: the remote
                    // store may have applied it before an acknowledgement failed.
                    await kv.set(saveKey, mergePreservingImages(next, record));
                    await commitEconomicReceipt(kv, consumedKey, reservation, CLAIM_TTL_SECONDS);
                });
            } catch (itemErr) {
                console.error('[pvp/claim-rewards] consumable settlement failed', itemErr);
                return res.status(503).json({ error: 'Could not settle battle consumables. Please retry.' });
            }
        }

        // The terminal move attempts this grant first, but the verified claim
        // is its durable retry path after lock or storage contention.
        try {
            await grantVanguardRewardsForSession(session);
        } catch (vanguardError) {
            console.error('[pvp/claim-rewards] Vanguard reward retry failed', vanguardError);
            return res.status(503).json({ error: 'Could not settle Vanguard rewards. Please retry.' });
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
            type BaseOut = ReturnType<typeof creditPvpWinBase>['summary'];

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

            // Apply ONE fighter's once-per-battle ranked-rating delta (guarded by
            // its own NX receipt) and return that fighter's resulting rating. A
            // re-settle (receipt already placed) reads back the stored value.
            const settleRatingFor = async (slug: string, role: 'winner' | 'loser'): Promise<RatingOut | undefined> => {
                if (!rankedEligible || !slug) return undefined;
                const saveKey = `save:${slug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) return undefined;
                const ratingReceiptKey = `pvp:ranked-rating:${slug}:${battleId}`;
                const reservation = await reserveEconomicReceipt(kv, {
                    key: ratingReceiptKey,
                    fingerprint: `pvp-rating:${battleId}:${winnerSlug}:${loserSlug}:${kind}:${slug}:${role}`,
                    ttlSeconds: CLAIM_TTL_SECONDS,
                    metadata: { battleId, slug, role, kind },
                });
                if (reservation.status === 'conflict') {
                    throw new Error(`Conflicting ranked settlement for ${battleId}/${slug}.`);
                }
                const r = creditRankedOutcome(char, { role, winnerRating, loserRating, kind });
                if (reservation.status === 'reserved') {
                    const next = bumpSaveVersion({ ...record, character: { ...char, ...r.patch } });
                    await kv.set(saveKey, mergePreservingImages(next, record));
                    await commitEconomicReceipt(kv, ratingReceiptKey, reservation, CLAIM_TTL_SECONDS);
                    return { field: ratingField, value: r.newRating, delta: r.delta };
                }
                const cur = Number(char[ratingField]);
                return { field: ratingField, value: Number.isFinite(cur) ? cur : r.newRating, delta: r.delta };
            };

            // Credit the winner's base ryo+XP (once), gated on `alreadyForWinner`
            // (the winner's own claim receipt). Re-reads the save so a rating
            // patch applied just above is preserved.
            const settleBaseForWinner = async (alreadyForWinner: boolean): Promise<BaseOut | undefined> => {
                const saveKey = `save:${winnerSlug}`;
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = (record?.character ?? null) as Record<string, unknown> | null;
                if (!record || !char) return undefined;
                const { xpGain, ryoGain } = computePvpWinGains(char, session.rewardSector);
                if (!alreadyForWinner) {
                    // Repeat-opponent decay (audit #1): scale this win's base
                    // reward down by how many times the winner already banked a
                    // win over THIS loser in the last hour. Recorded exactly once
                    // here — on the single real credit (the `!alreadyForWinner`
                    // branch), never on a replay — so the farm counter advances
                    // per banked win, not per claim retry. SCOPED to genuine
                    // player-vs-player: an AI raid boss / NPC loser has no save,
                    // so PvE grind (sector raids vs bosses) keeps its full reward.
                    const loserRecord = loserSlug ? await kv.get<Record<string, unknown>>(`save:${loserSlug}`) : null;
                    const decay = loserRecord?.character ? await recordPairWinAndDecay(winnerSlug, loserSlug) : 1;
                    const dXp = Math.max(0, Math.floor(xpGain * decay));
                    const dRyo = Math.max(0, Math.floor(ryoGain * decay));
                    const credit = creditPvpWinBase(char, dXp, dRyo);
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
                        const g = computeCombatStatGrowth(statsNow, Number(finalChar.level) || 1, PVP_CASUAL_STAT_POINTS_PER_WIN, remaining);
                        if (g.spent > 0) {
                            await kv.set(budgetKey, spentToday + g.spent, { ex: 25 * 60 * 60 }).catch(() => undefined);
                            const newStats: Record<string, number> = { ...statsNow };
                            for (const [k, v] of Object.entries(g.allocated)) newStats[k] = (Number(newStats[k]) || 0) + (v ?? 0);
                            const newUnspent = (Number(finalChar.unspentStats) || 0) + g.unspentGain;
                            finalChar = { ...finalChar, stats: newStats, unspentStats: newUnspent };
                            summary = { ...summary, unspentStats: newUnspent, statGrowth: { allocated: g.allocated as Record<string, number>, unspentGain: g.unspentGain } };
                        }
                    }
                    const next = bumpSaveVersion({ ...record, character: finalChar });
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
                };
            };

            try {
                // Lock every save we may write — claimer + opponent for a ranked
                // settlement, winner-only for a casual base reward.
                const locks = isRankedClaim ? [winnerSlug, loserSlug] : [winnerSlug];
                const out = await withSavesLocked(locks, async () => {
                    // Validate both ranked participants before the first rating
                    // receipt or save write. Without this preflight, a missing
                    // loser save could commit the winner's Elo and then silently
                    // skip the other half forever.
                    if (isRankedClaim) {
                        const participants = [...new Set([winnerSlug, loserSlug].filter(Boolean))];
                        if (participants.length !== 2) throw new Error('Ranked settlement requires two distinct player saves.');
                        const records = await Promise.all(participants.map((slug) => kv.get<Record<string, unknown>>(`save:${slug}`)));
                        if (records.some((record) => !record || !record.character || typeof record.character !== 'object')) {
                            throw new Error('Both ranked participant saves must exist before rating settlement.');
                        }
                    }
                    // Caller's own claim receipt — gates the client's local
                    // self-apply (alreadyClaimed). Distinct from the per-player
                    // rating receipts below.
                    const selfReservation = await reserveEconomicReceipt(kv, {
                        key,
                        fingerprint: `pvp-claim:${playerName}:${battleId}:${authoritativeOutcome}`,
                        ttlSeconds: CLAIM_TTL_SECONDS,
                        metadata: { playerName, battleId, outcome: authoritativeOutcome },
                    });
                    if (selfReservation.status === 'conflict') {
                        throw new Error(`Conflicting PvP claim receipt for ${battleId}/${playerName}.`);
                    }
                    const already = selfReservation.status === 'replay';
                    let protectedMutationAttempted = false;
                    try {

                    // Settle BOTH ratings (each exactly once across the battle).
                    if (rankedEligible) protectedMutationAttempted = true;
                    const winnerRatingOut = await settleRatingFor(winnerSlug, 'winner');
                    const loserRatingOut = (loserSlug && loserSlug !== winnerSlug)
                        ? await settleRatingFor(loserSlug, 'loser')
                        : undefined;

                    // Winner base reward — only when the WINNER is the caller.
                    if (creditBase && claimerSlug === winnerSlug && !already) protectedMutationAttempted = true;
                    const base = (creditBase && claimerSlug === winnerSlug)
                        ? await settleBaseForWinner(already)
                        : undefined;

                    const rating = claimerSlug === winnerSlug ? winnerRatingOut
                        : claimerSlug === loserSlug ? loserRatingOut
                        : undefined;
                    await commitEconomicReceipt(kv, key, selfReservation, CLAIM_TTL_SECONDS);
                    return { already, rating, base };
                    } catch (error) {
                        if (!protectedMutationAttempted) {
                            await abortEconomicReceipt(kv, key, selfReservation).catch(() => false);
                        }
                        throw error;
                    }
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

        // ── Casual path ─────────────────────────────────────────────────────
        // Atomic NX reserve. If the key already exists, we lost the race
        // (or a duplicate call) — return alreadyClaimed so the caller
        // skips the local grant entirely.
        //
        // Receipt storage is part of the authorization boundary. An unavailable
        // or ambiguous store returns 503; it never tells the client to apply a
        // reward without a durable replay guard.
        const reservation = await reserveEconomicReceipt(kv, {
            key,
            fingerprint: `pvp-claim:${playerName}:${battleId}:${authoritativeOutcome}`,
            ttlSeconds: CLAIM_TTL_SECONDS,
            metadata: { playerName, battleId, outcome: authoritativeOutcome },
        });
        if (reservation.status === 'conflict') {
            return res.status(409).json({ error: 'A conflicting reward claim already exists for this battle.' });
        }
        try {
            await commitEconomicReceipt(kv, key, reservation, CLAIM_TTL_SECONDS);
        } catch (error) {
            // This path authorizes a later client callback but has not mutated
            // the player save yet. Release our owned reservation after a failed
            // commit so a transient storage error cannot strand the reward.
            await abortEconomicReceipt(kv, key, reservation).catch(() => false);
            throw error;
        }
        const alreadyClaimed = reservation.status === 'replay';
        const finalSave = await kv.get<Record<string, unknown>>(`save:${playerName}`).catch(() => null);
        const finalChar = (finalSave?.character ?? null) as Record<string, unknown> | null;
        if (!alreadyClaimed) {
            await recordBetaMetric({
                event: 'pvp.settled',
                playerName,
                level: Number(finalChar?.level ?? 0),
                source: `casual:${authoritativeOutcome}`,
            });
        }
        return res.status(200).json({ ok: true, alreadyClaimed, _saveVersion: Number(finalSave?._saveVersion ?? 0) });
    } catch (err) {
        console.error('[pvp/claim-rewards]', err);
        if (isEconomicReceiptStorageError(err)) {
            return res.status(503).json({ error: 'Could not reserve the battle reward receipt. Please retry.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
