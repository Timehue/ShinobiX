import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import {
    reportMissionEvent,
    awardProfessionXp,
    professionRankForXp,
    healerHealXpBonusPct,
    healerPerTargetCooldownMs,
    healerHospitalTimerMs,
    HEALER_WORLDWIDE_RANK,
    type CompletedMissionInfo,
} from '../missions/_progress.js';

// Per-target cooldown is now rank-scaled via healerPerTargetCooldownMs(rank).
// Baseline (rank 1) is 5 min; rank 10 is 1.5 min. See api/missions/_progress.ts.
const HEALER_MAX_XP_PER_HEAL = 100;
// Healer assist synergy: +50% XP for healing a target who was hospitalized
// within the last 10 minutes (recent-fight proxy — players are hospitalized
// from PvP losses, so a fresh hospitalization means combat assist).
const HEALER_RAID_ASSIST_WINDOW_MS = 10 * 60 * 1000;
const HEALER_RAID_ASSIST_MULT = 1.5;
const HOSPITAL_DURATION_MS = 60_000;
// Pay-to-skip discharge cost (matches client-side dischargeCost in Hospital.tsx).
// Charged server-side when paySkip=true and the hospital timer hasn't expired.
const PAY_SKIP_DISCHARGE_COST = 2500;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const targetName = safeName(String(body.targetName ?? ''));
        const healerName = safeName(String(body.healerName ?? ''));
        const paySkip = body.paySkip === true;
        if (!targetName) return res.status(400).json({ error: 'Invalid target name.' });

        // Caller identity. For self-heal, identity must match targetName.
        // For cross-player heal (Healer profession), identity matches healerName.
        const identityCandidate = healerName || targetName;
        const identity = await authedPlayerOrAdmin(req, identityCandidate);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        const isSelfHeal = identity.admin || identity.name === targetName;
        const actorName = identity.admin ? (healerName || targetName) : identity.name;

        // Fetch target.
        const targetKey = `save:${targetName}`;
        const targetRecord = await kv.get<Record<string, unknown>>(targetKey);
        if (!targetRecord) return res.status(404).json({ error: 'Player not found.' });
        const targetChar = targetRecord.character as Record<string, unknown> | undefined;
        if (!targetChar) return res.status(404).json({ error: 'Character not found.' });

        // Self-heals and Healer-rank-<10 cross-heals require the target to be
        // hospitalized. Rank-10 Healers can also heal merely-injured (non-
        // hospitalized) same-village players anywhere in the world.
        const targetHospitalized = !!targetChar.hospitalized;
        const targetHp = Number(targetChar.hp ?? 0);
        const targetMaxHp = Number(targetChar.maxHp ?? 0);
        const targetInjured = targetMaxHp > 0 && targetHp < targetMaxHp;

        if (isSelfHeal) {
            // Self-heal / hospital checkout. Three flavors:
            //   (a) Healer's free checkout — Healers always discharge free.
            //   (b) Wait-out checkout — anyone, after hospital timer expires.
            //   (c) Pay-skip discharge — pay PAY_SKIP_DISCHARGE_COST ryo to
            //       skip the remaining timer. Charged SERVER-side here.
            //       Previously this was a client-only flow that deducted ryo
            //       locally but the save validator reverted the discharge,
            //       so players paid ryo for nothing. Now the server applies
            //       both the charge AND the discharge in one transaction.
            if (!targetHospitalized) return res.status(400).json({ error: 'Player is not hospitalized.' });
            const until = Number(targetChar.hospitalizedUntil ?? 0);
            const timerExpired = !until || Date.now() >= until;
            const selfIsHealer = targetChar.profession === 'healer';
            let chargedRyo = 0;
            if (!identity.admin && !timerExpired) {
                if (selfIsHealer) {
                    // Healer rank-scaled timer: r1=60s, r10=15s. If the
                    // healer's shortened timer also hasn't expired, fall
                    // through to the pay-skip / wait-it-out checks.
                    const xp = Number(targetChar.professionXp ?? 0);
                    const healerRank = professionRankForXp('healer', xp);
                    const fullTimer = HOSPITAL_DURATION_MS;
                    const healerTimer = healerHospitalTimerMs(healerRank);
                    const healerEligibleAt = until - fullTimer + healerTimer;
                    if (Date.now() >= healerEligibleAt) {
                        // Healer rank-shortened timer is satisfied — let it discharge for free.
                    } else if (paySkip) {
                        // Pay to skip the remaining (already-shortened) wait.
                        const curRyo = Number(targetChar.ryo ?? 0);
                        if (curRyo < PAY_SKIP_DISCHARGE_COST) {
                            return res.status(402).json({ error: `Need ${PAY_SKIP_DISCHARGE_COST} ryo to pay-skip discharge.` });
                        }
                        chargedRyo = PAY_SKIP_DISCHARGE_COST;
                    } else {
                        return res.status(429).json({
                            error: 'Hospital timer not yet expired.',
                            retryAfterMs: healerEligibleAt - Date.now(),
                        });
                    }
                } else if (paySkip) {
                    const curRyo = Number(targetChar.ryo ?? 0);
                    if (curRyo < PAY_SKIP_DISCHARGE_COST) {
                        return res.status(402).json({ error: `Need ${PAY_SKIP_DISCHARGE_COST} ryo to pay-skip discharge.` });
                    }
                    chargedRyo = PAY_SKIP_DISCHARGE_COST;
                } else {
                    return res.status(429).json({
                        error: 'Hospital timer not yet expired.',
                        retryAfterMs: until - Date.now(),
                    });
                }
            }
            const healed = {
                ...targetRecord,
                character: {
                    ...targetChar,
                    hp: targetChar.maxHp,
                    chakra: targetChar.maxChakra,
                    stamina: targetChar.maxStamina,
                    hospitalized: false,
                    hospitalizedUntil: 0,
                    hospitalizedAt: 0,
                    ryo: Math.max(0, Number(targetChar.ryo ?? 0) - chargedRyo),
                },
            };
            await kv.set(targetKey, mergePreservingImages(healed, targetRecord));
            return res.status(200).json({ ok: true, kind: 'self', chargedRyo });
        }

        // Cross-player heal — requires Healer profession.
        const healerKey = `save:${actorName}`;
        const healerRecord = await kv.get<Record<string, unknown>>(healerKey);
        if (!healerRecord) return res.status(404).json({ error: 'Healer not found.' });
        const healerChar = healerRecord.character as Record<string, unknown> | undefined;
        if (!healerChar) return res.status(404).json({ error: 'Healer character not found.' });

        if (!identity.admin && healerChar.profession !== 'healer') {
            return res.status(403).json({ error: 'Only Healers can heal other players.' });
        }

        // Same-village requirement (admins exempt).
        if (!identity.admin && healerChar.village !== targetChar.village) {
            return res.status(403).json({ error: 'Healer and target must be in the same village.' });
        }

        // Hospital vs world-wide rules:
        //   Rank 1-9: target must be hospitalized.
        //   Rank 10+: target may be merely injured (HP < maxHp) anywhere in the
        //             world (same-village gate above still applies).
        // Rank derived from professionXp via the canonical threshold table —
        // never from the saved professionRank field (which a corrupted save
        // or admin edit could trivially set to 10).
        const healerRank = professionRankForXp('healer', Number(healerChar.professionXp ?? 0));
        if (!identity.admin && !targetHospitalized) {
            if (healerRank < HEALER_WORLDWIDE_RANK) {
                return res.status(400).json({ error: `Target is not hospitalized. World-wide healing unlocks at Rank ${HEALER_WORLDWIDE_RANK}.` });
            }
            if (!targetInjured) {
                return res.status(400).json({ error: 'Target is at full HP — nothing to heal.' });
            }
        }

        // Per-target cooldown — any Healer touching the same target shares
        // the same lockout (prevents two-Healer ping-pong farming). Rank-
        // scaled: r1=5min, r10=1.5min. Higher-rank Healers can ping-pong
        // a single target faster (still bounded so they can't farm one
        // hospitalized friend for unlimited XP).
        const cooldownKey = `heal:lastHealedAt:${targetName}`;
        const cooldownEntry = await kv.get<{ at: number; by: string }>(cooldownKey);
        const effectiveCooldownMs = healerPerTargetCooldownMs(healerRank);
        if (!identity.admin && cooldownEntry?.at) {
            const elapsed = Date.now() - cooldownEntry.at;
            if (elapsed < effectiveCooldownMs) {
                return res.status(429).json({
                    error: 'Target was healed recently. Try again later.',
                    retryAfterMs: effectiveCooldownMs - elapsed,
                });
            }
        }

        // No healing during active battle — presence:{name} carries an
        // inBattle flag stamped by heartbeat while a PvP session is open.
        // This is mainly relevant at Rank 10 (where targets aren't required
        // to be hospitalized); Rank 1-9 heals are blocked earlier by the
        // hospitalized check (KO'd players aren't in a live battle).
        if (!identity.admin) {
            const presence = await kv.get<{ inBattle?: boolean }>(`presence:${targetName}`);
            if (presence?.inBattle) {
                return res.status(409).json({ error: 'Target is in an active battle.' });
            }
        }

        // Compute XP from % HP restored (cap 100 XP/heal). HP is restored to
        // full, so XP = (1 - currentHp/maxHp) * 100.
        const curHp = Number(targetChar.hp ?? 0);
        const maxHp = Number(targetChar.maxHp ?? 1);
        const pctHealed = maxHp > 0 ? Math.max(0, Math.min(1, 1 - curHp / maxHp)) : 0;
        let xpGained = Math.min(HEALER_MAX_XP_PER_HEAL, Math.floor(pctHealed * 100));

        // Rank-scaled heal XP bonus: r2=+5%, r3=+10%, …, r10=+50%. Applied
        // BEFORE the raid-assist multiplier so the two perks stack cleanly.
        const xpBonusPct = healerHealXpBonusPct(healerRank);
        if (xpBonusPct > 0) {
            xpGained = Math.floor(xpGained * (1 + xpBonusPct / 100));
        }

        // Healer raid-assist synergy: +50% XP if the target was hospitalized
        // within the last 10 minutes (proxy for "fresh from a fight").
        // Prefer the directly-stamped hospitalizedAt timestamp (added by the
        // save endpoint when a player flips into hospitalization); fall back
        // to reconstructing it from hospitalizedUntil for older saves that
        // pre-date the dedicated stamp.
        const hospitalizedAtStamp = Number(targetChar.hospitalizedAt ?? 0);
        const hospitalizedUntilTs = Number(targetChar.hospitalizedUntil ?? 0);
        const hospitalizedAt = hospitalizedAtStamp > 0
            ? hospitalizedAtStamp
            : (hospitalizedUntilTs ? hospitalizedUntilTs - HOSPITAL_DURATION_MS : 0);
        const raidAssist = hospitalizedAt > 0 && (Date.now() - hospitalizedAt) < HEALER_RAID_ASSIST_WINDOW_MS;
        if (raidAssist) {
            xpGained = Math.floor(xpGained * HEALER_RAID_ASSIST_MULT);
        }

        // Restore target. Clear hospitalizedAt alongside hospitalizedUntil
        // so a freshly-healed target isn't still "fresh from a fight" for
        // raid-assist purposes.
        const healedTarget = {
            ...targetRecord,
            character: {
                ...targetChar,
                hp: targetChar.maxHp,
                chakra: targetChar.maxChakra,
                stamina: targetChar.maxStamina,
                hospitalized: false,
                hospitalizedUntil: 0,
                hospitalizedAt: 0,
            },
        };
        await kv.set(targetKey, mergePreservingImages(healedTarget, targetRecord));

        // Award Healer XP for the heal itself (% HP restored).
        const heralded = await awardProfessionXp(actorName, 'healer', xpGained);

        // Stamp cooldown. TTL matches the rank-scaled lockout above so the
        // KV row self-expires; the in-handler comparison still wins if a
        // late-firing TTL hasn't reaped the row yet.
        await kv.set(cooldownKey, { at: Date.now(), by: actorName }, {
            ex: Math.max(1, Math.ceil(effectiveCooldownMs / 1000)),
        });

        // Report daily mission progress (best-effort — don't fail the heal
        // if mission storage hiccups). Auto-grants additional XP onto the
        // healer if a mission completes. Both helpers re-read the character
        // each time so XP stacks correctly.
        let missionXpAwarded = 0;
        let missionsCompleted: CompletedMissionInfo[] = [];
        try {
            const countResult = await reportMissionEvent({
                playerName: actorName,
                profession: 'healer',
                kind: 'healer-heal-count',
            });
            const uniqueResult = await reportMissionEvent({
                playerName: actorName,
                profession: 'healer',
                kind: 'healer-heal-unique',
                targetName: targetName.toLowerCase(),
            });
            missionXpAwarded = countResult.xpAwarded + uniqueResult.xpAwarded;
            missionsCompleted = [...countResult.missionsCompleted, ...uniqueResult.missionsCompleted];
        } catch (err) {
            console.error('[heal] mission progress failed', err);
        }

        // Re-read after mission grants to return the truly final state.
        const finalRecord = await kv.get<Record<string, unknown>>(healerKey);
        const finalChar = finalRecord?.character as Record<string, unknown> | undefined;
        const finalXp = Number(finalChar?.professionXp ?? heralded?.xp ?? 0);
        const finalRank = Number(finalChar?.professionRank ?? heralded?.rank ?? 1);

        return res.status(200).json({
            ok: true,
            kind: 'healer',
            xpGained,
            raidAssist,
            missionXpAwarded,
            missionsCompleted,
            professionXp: finalXp,
            professionRank: finalRank,
        });
    } catch (err) {
        console.error('[heal]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
