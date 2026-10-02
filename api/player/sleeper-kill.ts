import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave, mutatePlayerSaves, type PlayerSavesSide } from '../save/_mutate-player-save.js';
import { onlineStore } from '../_realtime/online-store.js';
import { getTravelLease, travelLeaseReceipt } from '../_realtime/travel-lease.js';
import { computePvpWinGains, creditPvpWinBase } from '../_xp-engine.js';
import { previewPairWinDecay, recordPairWinAndDecay } from '../pvp/_reward-farm.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import {
    VANGUARD_SEALS_PER_KILL,
    DAILY_SEAL_CAP,
    PER_TARGET_DAILY_CAP,
    ACCOUNT_AGE_MIN_MS,
    levelGapMult,
    vanguardXpForLevel,
    rankFromXp,
} from '../pvp/_vanguard-rewards.js';
import { PVP_RAID_SHIELD_MS } from '../pvp/_vitals-settlement.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { battleLockFlagsForPlayers, settleSaveRecord } from '../_elapsed-state.js';
import { clearSleeperCamp, getSleeperCamp } from '../_realtime/sleeper-camps.js';
import type { OnlinePlayer } from '../_realtime/types.js';
import { pushOfflineNotice } from './_offline-notices.js';
import { announce } from '../_announce.js';
import { settleBountyForSessionlessKill } from '../pvp/_bounty-settle.js';

// "Sleeping target" KO. When a player logs out / closes the tab while standing
// in a WILD sector (currentSector >= 1) they don't vanish — they remain a
// visible, attackable camp there (see api/_realtime/sleeper-camps.ts and
// api/player/roster.ts). The camp is an explicit server record, not an inference
// from every offline player's last-saved sector.
// A logout in the village or Central hub leaves currentSector at 0 (App.tsx's
// !inField effect), so those players are NOT sleepers and stay safe.
//
// Per the owner's design call this is a FREE KILL (no fight, fully
// server-resolved → nothing is trusted from the client) that grants the
// attacker the SAME rewards as a live PvP win — base ryo+XP (with the existing
// repeat-opponent decay), a PvP kill credit, and Vanguard Honor Seals under the
// existing daily / per-target caps — and sends the victim to the hospital +
// back to the village. Anti-farm is structural: the KO relocates the victim to
// sector 0 so they immediately leave the sleeper pool and can't be re-killed
// until they log in, travel out, and log off again.
const HOSPITAL_DURATION_MS = 60_000;

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function monthKey(): string {
    return new Date().toISOString().slice(0, 7);
}

export type SleeperBlock = { status: 404 | 409; error: string };

// Pure gate predicate over a target's SAVE state (no I/O). The online check is
// done separately by the caller (it needs the presence store, not the save).
// Returns null when the KO may proceed.
//
// Per owner decision: ANY player classified as a sleeper is fair game,
// regardless of level. Academy protection (sub-Genin) is deliberately NOT
// applied on this path — it still protects new players in live/online PvP. The
// structural anti-farm bounds remain: a KO relocates the victim to the village
// (removing them from the sleeper pool), and rewards are anti-alt'd + daily /
// per-target capped.
export function sleeperTargetBlock(targetChar: Record<string, unknown> | undefined, sector: number, now: number = Date.now()): SleeperBlock | null {
    if (!targetChar) return { status: 404, error: 'Target not found.' };
    // Safe-zone gate: village / Central / any town screen saves currentSector 0.
    // Only a logout in a real wild sector (>= 1) leaves a sleeper.
    if (!(Number.isFinite(sector) && sector >= 1)) {
        return { status: 409, error: 'Target logged out in a safe zone and cannot be attacked.' };
    }
    if (isIncapacitated(targetChar, now)) {
        return { status: 409, error: 'Target has already been defeated.' };
    }
    // Field Recovery covers the offline path too. This file WRITES the shield on
    // a kill but used to be the one raid door that never read it, so a victim
    // who was KO'd in live PvP, discharged, and logged off could be sleeper-
    // killed again inside their own recovery window.
    if (Math.floor(Number(targetChar.pvpShieldUntil ?? 0)) > now) {
        return { status: 409, error: 'Target is recovering from a recent defeat.' };
    }
    return null;
}

export function sleeperAttackerBlock(
    attacker: OnlinePlayer | null,
    campSector: number,
    now = Date.now(),
): SleeperBlock | null {
    if (!attacker) return { status: 409, error: 'Your world presence is not ready.' };
    if ((attacker.travelingUntil ?? 0) > now) return { status: 409, error: 'You cannot attack while traveling.' };
    if (attacker.inBattle) return { status: 409, error: 'You are already in a battle.' };
    if (attacker.sector !== campSector) return { status: 409, error: 'That camp is no longer in your sector.' };
    return null;
}

type SealGrant = { seals: number; xpGain: number; today: string; dailySoFar: number; nextByTarget: Record<string, number> };

// Mirrors the seal math in api/pvp/_vanguard-rewards.ts
// (grantVanguardRewardsForSession): level-gap softening, the daily cap, and the
// per-target daily cap — all keyed off the SAME exported table + constants so
// the numbers can't drift. Intentionally omits the two things that have no
// meaning for a no-fight KO: the pet-escort bonus and the 15s minimum-fight-
// duration gate. Anti-alt (same-device / too-young) is enforced by the caller.
export function computeSleeperSeals(
    winnerChar: Record<string, unknown>,
    loserChar: Record<string, unknown>,
    loserSlug: string,
): SealGrant | null {
    const spec = winnerChar.masterySpec;
    const rank = Math.max(1, Math.min(10, Number(winnerChar.professionRank ?? 1)));
    const baseSeals = VANGUARD_SEALS_PER_KILL[rank] ?? 0;
    const gapMult = levelGapMult(Number(winnerChar.level ?? 1), Number(loserChar.level ?? 1));
    const gapSoftenPct = Math.min(100, masteryBonus('vanguard', spec, 'sealGapSoftenPct'));
    const effectiveGapMult = gapMult + (1 - gapMult) * (gapSoftenPct / 100);
    let seals = Math.floor(baseSeals * effectiveGapMult);
    if (seals <= 0 && masteryHasCapstone('vanguard', spec, 'warmonger') && baseSeals > 0) seals = 1;
    if (seals <= 0) return null;

    const today = todayKey();
    const dailyActive = winnerChar.vanguardDailyResetDate === today;
    const dailySoFar = dailyActive ? Number(winnerChar.dailyHonorSealsEarned ?? 0) : 0;
    const byTarget: Record<string, number> = dailyActive
        ? ((winnerChar.dailyHonorSealsByTarget as Record<string, number>) ?? {})
        : {};
    const targetSoFar = byTarget[loserSlug] ?? 0;
    const dailyCap = DAILY_SEAL_CAP + Math.min(15, masteryBonus('vanguard', spec, 'sealDailyCapFlat'));
    seals = Math.min(seals, Math.max(0, dailyCap - dailySoFar));
    seals = Math.min(seals, Math.max(0, PER_TARGET_DAILY_CAP - targetSoFar));
    if (seals <= 0) return null;

    const baseXpGain = vanguardXpForLevel(Number(loserChar.level ?? 1));
    const xpGain = rank >= 2 ? Math.floor(baseXpGain * 1.1) : baseXpGain;
    return { seals, xpGain, today, dailySoFar, nextByTarget: { ...byTarget, [loserSlug]: targetSoFar + seals } };
}

export type SleeperKoSettled =
    | { status: 200; record: Record<string, unknown>; character: Record<string, unknown>; sector: number }
    | SleeperBlock;

export type SleeperKoDecision =
    | SleeperBlock
    | {
        status: 200;
        /** The victim's settled character before the KO: what a reward reads. */
        victim: Record<string, unknown>;
        /** The KO for the victim's save write. */
        character: Record<string, unknown>;
        recordPatch: Record<string, unknown>;
        sector: number;
    };

/**
 * Decide a sleeper KO against the victim's settled save. The caller holds the
 * victim's save lock (mutatePlayerSave / mutatePlayerSaves) and writes the
 * decision. Re-reads the camp under that lock, re-validates every sleeper
 * condition (camp still exists — and, when `expectSector` is given, is still in
 * that sector — a real wild sector, not already hospitalized, still offline),
 * then returns the ONE consequence a sleeper KO has for the victim: HP 0 + the
 * standard hospital stamp + relocation to the village (sector 0). The caller
 * clears the camp once it commits. It pays NOTHING — the player handler layers
 * its rewards on top; an NPC raid (api/_merc-auto.ts) has none.
 *
 * Once-per-camp by construction: clearing the camp and moving the victim to
 * sector 0 drops them out of the sleeper pool, so they cannot be hit again until
 * they log in, walk back out, and log off in the wild again — and a second
 * caller racing this one sees "no camp" / "already defeated" and stops.
 */
export async function decideSleeperKo(
    victim: { playerName: string; record: Record<string, unknown>; character: Record<string, unknown> },
    opts: { now?: number; expectSector?: number } = {},
): Promise<SleeperKoDecision> {
    const now = opts.now ?? Date.now();
    const targetSlug = victim.playerName;
    const tRec = victim.record;
    const tChar = victim.character;
    const lockedCamp = await getSleeperCamp(targetSlug);
    if (!lockedCamp) return { status: 409, error: 'Target no longer has a camp in the world.' };
    if (opts.expectSector != null && lockedCamp.sector !== opts.expectSector) {
        return { status: 409, error: 'That camp is no longer in this sector.' };
    }
    const reBlock = sleeperTargetBlock(tChar, lockedCamp.sector, now);
    if (reBlock) return reBlock;
    if (onlineStore.get(targetSlug)) return { status: 409, error: 'Target came online — use a normal attack.' };
    // A roster recovery may have exposed the destination before its save
    // committed. Never KO that camp while an unsettled arrival could later
    // relocate the hospitalized player back into the field. Read only here:
    // this caller already holds the save lock (travel settlement takes it too).
    const travel = await getTravelLease(targetSlug);
    if (travel && (travel.arrivalAt > now || travel.destinationSector !== lockedCamp.sector
        || tRec.worldTravelReceipt !== travelLeaseReceipt(travel))) {
        return { status: 409, error: 'Target arrival is still settling. Please retry.' };
    }

    // KO the victim: HP 0 + hospitalized for the standard duration, and
    // relocate to the village (sector 0). The save validator in
    // save/[name].ts enforces the hospital timer against the victim's
    // stale autosave on re-login, and currentSector:0 drops them from the
    // sleeper pool immediately.
    return {
        status: 200,
        victim: tChar,
        character: {
            ...tChar,
            hp: 0,
            hospitalized: true,
            hospitalizedUntil: now + HOSPITAL_DURATION_MS,
            hospitalizedAt: now,
            // Field Recovery, same as a live PvP defeat: sector 0 already drops them
            // from the sleeper pool, but this also covers them for the first moments
            // after they log back in and travel out again.
            pvpShieldUntil: now + PVP_RAID_SHIELD_MS,
        },
        recordPatch: { currentSector: 0, currentTile: null, pendingTravel: null },
        sector: lockedCamp.sector,
    };
}

/**
 * A sleeper KO with no attacker to pay: an NPC merc raid (api/_merc-auto.ts).
 * Commits decideSleeperKo through mutatePlayerSave and clears the camp under
 * the same save lock. `gate` runs first under that lock (false refuses the KO);
 * `afterKo` runs once the KO has committed, still under it.
 */
export async function settleSleeperKo(
    targetSlug: string,
    opts: { now?: number; expectSector?: number; gate?: () => Promise<boolean>; afterKo?: () => Promise<void> } = {},
): Promise<SleeperKoSettled> {
    const out = await mutatePlayerSave<SleeperKoSettled>(targetSlug, async (ctx) => {
        const untouched = (value: SleeperKoSettled) => ({ ok: true as const, write: false, character: ctx.character, value });
        if (opts.gate && !(await opts.gate())) return untouched({ status: 409, error: 'This camp cannot be raided right now.' });
        const ko = await decideSleeperKo(ctx, opts);
        if (ko.status !== 200) return untouched(ko);
        return {
            ok: true,
            character: ko.character,
            recordPatch: ko.recordPatch,
            value: { status: 200, record: ctx.record, character: ko.victim, sector: ko.sector },
            afterCommit: async () => {
                await clearSleeperCamp(targetSlug);
                if (opts.afterKo) await opts.afterKo();
            },
        };
    });
    return out.ok ? out.value : { status: 404, error: 'Target not found.' };
}

/** After a SUCCESSFUL player sleeper-kill: queue the "you were ambushed by X"
 *  notice the victim reads on their next heartbeat, and post a low-importance
 *  (feed-only, 3/day/attacker via announce's own limiter) world announcement.
 *  Best-effort — the KO has already settled, so nothing here may fail it. */
export async function notifySleeperKill(args: { attackerName: string; victimSlug: string; victimName: string; sector: number; now?: number }): Promise<void> {
    const at = args.now ?? Date.now();
    await Promise.all([
        pushOfflineNotice(args.victimSlug, { kind: 'sleeper-kill', by: args.attackerName, sector: args.sector, at })
            .catch((err) => console.error('[sleeper-kill] offline notice failed', err)),
        announce({
            type: 'sleeper_kill',
            importance: 'low',
            title: 'Camp Ambushed',
            message: `${args.attackerName} ambushed ${args.victimName}'s camp in Sector ${args.sector}.`,
            player: args.attackerName,
        }).catch(() => null),
    ]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // Per-actor rate limit — mirrors /api/player/attack. A KO is a deliberate,
    // one-off action; anything past a handful a minute is a spam/farm loop.
    if (!identity.admin && !enforceRateLimit(req, res, 'player-sleeper-kill', 6, 60_000, identity.name)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attackerName } = (body ?? {}) as { targetName?: string; attackerName?: string };
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });

        // Admins act on behalf of attackerName (they have no player identity of
        // their own); regular players are always the authed identity.
        const attackerSlug = identity.admin
            ? (attackerName ? safeName(String(attackerName)) : '')
            : identity.name;
        const targetSlug = safeName(String(targetName));
        if (!attackerSlug || !targetSlug) return res.status(400).json({ error: 'Invalid player name.' });
        if (attackerSlug === targetSlug) return res.status(400).json({ error: 'You cannot attack yourself.' });

        // Sleepers are OFFLINE by definition. A live (fresh-presence) player must
        // be fought through the normal interactive PvP attack flow.
        if (onlineStore.get(targetName)) {
            return res.status(409).json({ error: 'Target is online — use a normal attack.' });
        }

        const camp = await getSleeperCamp(targetSlug);
        if (!camp) return res.status(409).json({ error: 'Target no longer has a camp in the world.' });
        if (!identity.admin) {
            const attackerBlock = sleeperAttackerBlock(onlineStore.get(attackerSlug), camp.sector);
            if (attackerBlock) return res.status(attackerBlock.status).json({ error: attackerBlock.error });
        }

        const [targetRecordRaw, initialBattleLocks] = await Promise.all([
            kv.get<Record<string, unknown>>(`save:${targetSlug}`),
            battleLockFlagsForPlayers([targetSlug]),
        ]);
        const targetRecord = targetRecordRaw
            ? settleSaveRecord(targetRecordRaw, { battleLocked: initialBattleLocks.get(targetSlug) === true }).record
            : targetRecordRaw;
        const targetChar = targetRecord?.character as Record<string, unknown> | undefined;
        const targetSector = camp.sector;
        const preBlock = sleeperTargetBlock(targetChar, targetSector);
        if (preBlock) return res.status(preBlock.status).json({ error: preBlock.error });

        // Anti-alt: a shared recent IP / browser fingerprint means this is almost
        // certainly the attacker's own alt. Mirrors the Vanguard same-device rule
        // — the KO still lands, but it pays out NOTHING (no ryo/XP/kill/seals), so
        // there's no incentive to farm a sleeping alt. Computed outside the lock
        // (read-only) and fails OPEN so a KV hiccup never blocks a real KO.
        let rewardEligible = true;
        try {
            if (await hasRecentIpOrFpOverlap(attackerSlug, targetSlug)) rewardEligible = false;
        } catch { /* fail open */ }

        const targetTooYoung = (() => {
            const created = Number(targetChar?.createdAt ?? 0);
            return created > 0 && (Date.now() - created) < ACCOUNT_AGE_MIN_MS;
        })();

        // Both saves are locked in one sorted order — so two attackers racing the
        // same target (or the attacker's own concurrent autosave) can't
        // interleave or deadlock — and fail closed: a contended lock aborts (503)
        // rather than racing a currency / save write. The KO commits first, then
        // the attacker's credit. No conflict retry: the repeat-opponent counter
        // is recorded outside the saves.
        const outcome = await mutatePlayerSaves([targetSlug, attackerSlug], async (sides) => {
            // Re-read inside the locks so we settle against committed state.
            const lockedCamp = await getSleeperCamp(targetSlug);
            if (!lockedCamp) return { ok: false, status: 409, error: 'Target no longer has a camp in the world.' };
            if (!identity.admin) {
                const attackerBlock = sleeperAttackerBlock(onlineStore.get(attackerSlug), lockedCamp.sector);
                if (attackerBlock) return { ok: false, ...attackerBlock };
            }
            const aChar = sides[attackerSlug]!.character;

            // Re-validates the sleeper conditions (another attacker may have won
            // the race between our checks and the locks) and decides the KO —
            // the same decision an NPC merc raid commits.
            const ko = await decideSleeperKo(sides[targetSlug]!);
            if (ko.status !== 200) return { ok: false, status: ko.status, error: ko.error };
            const tChar = ko.victim;

            let updatedAttacker = aChar;
            // F5: Field Recovery is a shield, not a licence — raiding is the
            // aggressive act that ends it. Computed before any credit so the
            // clear also lands on the anti-alt branch, which pays nothing.
            const attackerShielded = (Math.floor(Number(aChar.pvpShieldUntil ?? 0)) || 0) > Date.now();
            if (attackerShielded) updatedAttacker = { ...updatedAttacker, pvpShieldUntil: 0 };
            let ryoGained = 0;
            const xpGained = 0; // character XP retired — kept in the response shape for old clients
            let sealsGained = 0;

            if (rewardEligible) {
                // Base ryo — same primitives the live PvP winner uses, scaled by
                // the existing repeat-opponent decay. (Character XP is retired;
                // sleeper kills deliberately grant NO stat growth — that stays a
                // serious-fight reward on the live claim path.) The win is priced
                // now and recorded only once the credit has committed (below).
                const { ryoGain } = computePvpWinGains(aChar as never, targetSector);
                const decay = await previewPairWinDecay(attackerSlug, targetSlug);
                ryoGained = Math.max(0, Math.floor(ryoGain * decay));
                const credit = creditPvpWinBase(aChar as never, ryoGained);
                updatedAttacker = credit.char as unknown as Record<string, unknown>;

                // PvP kill credit (server-side; the live path applies this on the
                // attacker's own client).
                const month = monthKey();
                const monthlyBase = updatedAttacker.pvpKillMonth === month ? Number(updatedAttacker.monthlyPvpKills ?? 0) : 0;
                updatedAttacker = {
                    ...updatedAttacker,
                    totalPvpKills: Number(updatedAttacker.totalPvpKills ?? 0) + 1,
                    monthlyPvpKills: monthlyBase + 1,
                    pvpKillMonth: month,
                };

                // Vanguard Honor Seals — capped, and skipped for a too-young
                // target (same as the live grant's account-age rule).
                if (updatedAttacker.profession === 'vanguard' && !targetTooYoung) {
                    const grant = computeSleeperSeals(updatedAttacker, tChar, targetSlug);
                    if (grant) {
                        const nextXp = Number(updatedAttacker.professionXp ?? 0) + grant.xpGain;
                        updatedAttacker = {
                            ...updatedAttacker,
                            honorSeals: Number(updatedAttacker.honorSeals ?? 0) + grant.seals,
                            professionXp: nextXp,
                            professionRank: rankFromXp(nextXp),
                            dailyHonorSealsEarned: grant.dailySoFar + grant.seals,
                            dailyHonorSealsByTarget: grant.nextByTarget,
                            vanguardDailyResetDate: grant.today,
                        };
                        sealsGained = grant.seals;
                    }
                }

            }

            // Persist when the KO PAID, or when this raid spent the attacker's
            // own Field Recovery shield. The anti-alt branch pays nothing and so
            // wrote nothing at all, which left the shield intact: lose on
            // purpose, discharge, then farm offline sleeper camps for the
            // remaining ~120 s while staying un-raidable yourself. attack.ts
            // already closes that on the online raid door; this is the other one.
            // The shared writer credits the elder win from the kill counter and
            // refreshes the public index (ANBU earned seats) in the same write.
            const attackerSide: PlayerSavesSide = rewardEligible || attackerShielded
                ? {
                    character: updatedAttacker,
                    // Record the win only once its credit has committed, so a
                    // KO or credit that never landed cannot decay the next one.
                    ...(rewardEligible ? { afterCommit: async () => { await recordPairWinAndDecay(attackerSlug, targetSlug); } } : {}),
                }
                : { write: false, character: aChar };
            return {
                ok: true,
                value: {
                    attackerName: String((aChar.name as string) ?? attackerSlug),
                    koSector: ko.sector,
                    reward: {
                        ryo: ryoGained,
                        xp: xpGained,
                        seals: sealsGained,
                        rewardEligible,
                        target: String((tChar.name as string) ?? targetName),
                    },
                },
                sides: {
                    [targetSlug]: { character: ko.character, recordPatch: ko.recordPatch, afterCommit: () => clearSleeperCamp(targetSlug) },
                    [attackerSlug]: attackerSide,
                },
            };
        });

        if (!outcome.ok) {
            if (outcome.code) {
                return res.status(404).json({ error: outcome.playerName === attackerSlug ? 'Attacker save not found.' : 'Target not found.' });
            }
            return res.status(outcome.status).json({ error: outcome.error });
        }
        const attackerSave = outcome.saves[attackerSlug]!;
        const settled = {
            ...outcome.value,
            character: attackerSave.character,
            // Hand the bumped version back so the caller can ADOPT it. Without
            // it the open tab keeps its pre-KO version, and the recovery is the
            // slow one save/_save-version.ts documents: the next autosave 409s and
            // refetchAfterSaveConflict re-pulls the credited snapshot. Stays null
            // when the KO pays nothing (anti-alt): no save write, no version moved.
            saveVersion: attackerSave.written ? attackerSave._saveVersion : null,
        };
        // Collect any bounty standing on that head. MUST run out here, after the
        // KO's save locks have released: the bounty path takes the board lock and
        // THEN save:<attacker>, so taking it while still holding the save would
        // invert bounty.ts's order and deadlock the two paths against each other.
        // Best-effort by construction — an unsettled bounty leaves the pool
        // claimable and never undoes a committed KO.
        const bounty = await settleBountyForSessionlessKill({
            attackerSlug,
            victimSlug: targetSlug,
            victimName: settled.reward.target,
            rewardEligible: settled.reward.rewardEligible,
        });
        if (bounty.amount > 0) {
            await Promise.all([
                pushOfflineNotice(targetSlug, {
                    kind: 'bounty-claimed',
                    by: settled.attackerName,
                    sector: settled.koSector,
                    amount: bounty.amount,
                    at: Date.now(),
                }).catch(() => null),
                announce({
                    type: 'bounty_claimed',
                    importance: 'high',
                    title: 'Bounty Collected',
                    message: `${settled.attackerName} collected the ${bounty.amount.toLocaleString('en-US')}-ryo bounty on ${settled.reward.target}.`,
                    player: settled.attackerName,
                    meta: { target: targetSlug, amount: bounty.amount, via: 'sleeper-ko' },
                }).catch(() => null),
            ]);
        }
        // Tell the victim who did it (next heartbeat) + feed the world. Outside
        // the save locks, best-effort, never fails the already-settled KO.
        await notifySleeperKill({
            attackerName: settled.attackerName,
            victimSlug: targetSlug,
            victimName: settled.reward.target,
            sector: settled.koSector,
        });
        // The bounty write is the LAST touch of the attacker's save, so its
        // version supersedes the KO's for the client to adopt.
        const finalSaveVersion = bounty.saveVersion ?? settled.saveVersion;
        return res.status(200).json({
            ok: true,
            koed: true,
            character: bounty.amount > 0
                ? { ...settled.character, ryo: Number(settled.character.ryo ?? 0) + bounty.amount }
                : settled.character,
            reward: { ...settled.reward, bounty: bounty.amount },
            ...(finalSaveVersion !== null ? { _saveVersion: finalSaveVersion } : {}),
        });
    } catch (err) {
        // failClosed lock contention surfaces here — signal "transient, retry".
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'Could not record the KO — please retry.' });
        }
        console.error('[sleeper-kill]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
