import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { computePvpWinGains, creditPvpWinBase } from '../_xp-engine.js';
import { recordPairWinAndDecay } from '../pvp/_reward-farm.js';
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
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { bumpSaveVersion } from '../save/_save-version.js';
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
export function sleeperTargetBlock(targetChar: Record<string, unknown> | undefined, sector: number): SleeperBlock | null {
    if (!targetChar) return { status: 404, error: 'Target not found.' };
    // Safe-zone gate: village / Central / any town screen saves currentSector 0.
    // Only a logout in a real wild sector (>= 1) leaves a sleeper.
    if (!(Number.isFinite(sector) && sector >= 1)) {
        return { status: 409, error: 'Target logged out in a safe zone and cannot be attacked.' };
    }
    if (targetChar.hospitalized) {
        return { status: 409, error: 'Target has already been defeated.' };
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

/**
 * Settle a sleeper KO against the target's COMMITTED save. The caller MUST hold
 * the `save:<targetSlug>` lock (failClosed). Re-reads the save + camp under that
 * lock, re-validates every sleeper condition (camp still exists — and, when
 * `expectSector` is given, is still in that sector — a real wild sector, not
 * already hospitalized, still offline), then applies the ONE consequence a
 * sleeper KO has for the victim: HP 0 + the standard hospital stamp + relocation
 * to the village (sector 0) + the camp cleared. It pays NOTHING — the player
 * handler layers its rewards on top; an NPC raid (api/_merc-auto.ts) has none.
 *
 * Once-per-camp by construction: clearing the camp and moving the victim to
 * sector 0 drops them out of the sleeper pool, so they cannot be hit again until
 * they log in, walk back out, and log off in the wild again — and a second
 * caller racing this one sees "no camp" / "already defeated" and stops.
 */
export async function settleSleeperKoLocked(
    targetSlug: string,
    opts: { now?: number; expectSector?: number } = {},
): Promise<SleeperKoSettled> {
    const now = opts.now ?? Date.now();
    const [tRecRaw, lockedBattleFlags] = await Promise.all([
        kv.get<Record<string, unknown>>(`save:${targetSlug}`),
        battleLockFlagsForPlayers([targetSlug]),
    ]);
    const tRec = tRecRaw
        ? settleSaveRecord(tRecRaw, { battleLocked: lockedBattleFlags.get(targetSlug) === true }).record
        : tRecRaw;
    const tChar = tRec?.character as Record<string, unknown> | undefined;
    const lockedCamp = await getSleeperCamp(targetSlug);
    if (!lockedCamp) return { status: 409, error: 'Target no longer has a camp in the world.' };
    if (opts.expectSector != null && lockedCamp.sector !== opts.expectSector) {
        return { status: 409, error: 'That camp is no longer in this sector.' };
    }
    const reBlock = sleeperTargetBlock(tChar, lockedCamp.sector);
    if (reBlock) return reBlock;
    if (onlineStore.get(targetSlug)) return { status: 409, error: 'Target came online — use a normal attack.' };
    if (!tRec || !tChar) return { status: 404, error: 'Target not found.' };

    // KO the victim: HP 0 + hospitalized for the standard duration, and
    // relocate to the village (sector 0). The save validator in
    // save/[name].ts enforces the hospital timer against the victim's
    // stale autosave on re-login, and currentSector:0 drops them from the
    // sleeper pool immediately.
    const koChar = {
        ...tChar,
        hp: 0,
        hospitalized: true,
        hospitalizedUntil: now + HOSPITAL_DURATION_MS,
        hospitalizedAt: now,
    };
    const targetKoRecord = bumpSaveVersion({ ...tRec, currentSector: 0, character: koChar });
    await kv.set(`save:${targetSlug}`, mergePreservingImages(targetKoRecord, tRec));
    await clearSleeperCamp(targetSlug);
    return { status: 200, record: tRec, character: tChar, sector: lockedCamp.sector };
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

// Lock both fighters' saves in a deterministic (sorted) order — same pattern as
// pvp/claim-rewards.ts — so two attackers racing the same target (or the
// attacker's own concurrent autosave) can't interleave their read-modify-write
// or deadlock. failClosed: a contended lock aborts (caller returns 503) rather
// than racing a currency / save write.
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

        const settled = await withSavesLocked([attackerSlug, targetSlug], async () => {
            // Re-read inside the lock so we settle against committed state.
            const lockedCamp = await getSleeperCamp(targetSlug);
            if (!lockedCamp) return { status: 409 as const, error: 'Target no longer has a camp in the world.' };
            if (!identity.admin) {
                const attackerBlock = sleeperAttackerBlock(onlineStore.get(attackerSlug), lockedCamp.sector);
                if (attackerBlock) return attackerBlock;
            }
            const aRec = await kv.get<Record<string, unknown>>(`save:${attackerSlug}`);
            const aChar = aRec?.character as Record<string, unknown> | undefined;
            if (!aRec || !aChar) return { status: 404 as const, error: 'Attacker save not found.' };

            // Re-validates the sleeper conditions (another attacker may have won
            // the race between our checks and the lock) and applies the KO —
            // the same settlement an NPC merc raid uses.
            const ko = await settleSleeperKoLocked(targetSlug);
            if (ko.status !== 200) return ko;
            const tChar = ko.character;

            let updatedAttacker = aChar;
            // Stays null when the KO pays nothing (anti-alt): no save write, so no
            // version moved and the caller has nothing to adopt.
            let attackerSaveVersion: number | null = null;
            let ryoGained = 0;
            const xpGained = 0; // character XP retired — kept in the response shape for old clients
            let sealsGained = 0;

            if (rewardEligible) {
                // Base ryo — same primitives the live PvP winner uses, scaled by
                // the existing repeat-opponent decay. (Character XP is retired;
                // sleeper kills deliberately grant NO stat growth — that stays a
                // serious-fight reward on the live claim path.)
                const { ryoGain } = computePvpWinGains(aChar as never, targetSector);
                const decay = await recordPairWinAndDecay(attackerSlug, targetSlug);
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

                const attackerRecord = bumpSaveVersion({ ...aRec, character: updatedAttacker });
                // Hand the bumped version back so the caller can ADOPT it. Without
                // it the open tab keeps its pre-KO version, and the recovery is the
                // slow one bumpSaveVersion documents: the next autosave 409s and
                // refetchAfterSaveConflict re-pulls the credited snapshot. Correct
                // either way — this just skips the round trip, matching every other
                // server credit (api/battle/lock.ts, the dungeon run mutations).
                const nextVersion = Number(attackerRecord._saveVersion);
                if (Number.isFinite(nextVersion)) attackerSaveVersion = nextVersion;
                await kv.set(`save:${attackerSlug}`, mergePreservingImages(attackerRecord, aRec));
            }

            return {
                status: 200 as const,
                character: updatedAttacker,
                attackerName: String((aChar.name as string) ?? attackerSlug),
                koSector: ko.sector,
                saveVersion: attackerSaveVersion,
                reward: {
                    ryo: ryoGained,
                    xp: xpGained,
                    seals: sealsGained,
                    rewardEligible,
                    target: String((tChar.name as string) ?? targetName),
                },
            };
        });

        if (settled.status !== 200) {
            return res.status(settled.status).json({ error: settled.error });
        }
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
