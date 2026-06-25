import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { kickPlayer } from '../_realtime/notify.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
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

// Server-side mirror of the client hospital-discount math
// (shinobij.client/src/lib/village-upgrades.ts getHospitalDiscountPercent +
// clan-upgrades.ts clanUpgradeEffectPercent('medicalWing')). The Hospital UI
// shows a discounted discharge price; without mirroring it here the server
// charged/required a flat 2500 — overcharging upgraded players and hard-blocking
// anyone holding between the discounted price and 2500 ryo. Keep these constants
// in sync with the client (village hospital perLevel 1%, max 50 levels; clan
// Medical Wing 0.3%/level capped at 15%; medics clan doctrine 5%). The doctrine
// component was previously missing here, so the Hospital UI showed a medics-clan
// discount the server never actually applied. Pinned by _cross-build-parity.test.
const VILLAGE_HOSPITAL_MAX_LEVEL = 50;
const VILLAGE_HOSPITAL_PCT_PER_LEVEL = 1;
const CLAN_MEDICAL_WING_PCT_PER_LEVEL = 0.3;
const CLAN_MEDICAL_WING_MAX_PCT = 15;
// Mirror of DOCTRINE_HOSPITAL_DISCOUNT in shinobij.client/src/lib/clan-doctrines.ts.
const DOCTRINE_HOSPITAL_DISCOUNT_PCT = 5;
function hospitalDiscountPct(char: Record<string, unknown>): number {
    const upgrades = (char.villageUpgrades ?? {}) as Record<string, unknown>;
    const hospLvl = Math.min(VILLAGE_HOSPITAL_MAX_LEVEL, Math.max(0, Math.floor(Number(upgrades.hospital ?? 0))));
    const villagePct = hospLvl * VILLAGE_HOSPITAL_PCT_PER_LEVEL;
    const clanLevels = (char.clanUpgradeLevels ?? {}) as Record<string, unknown>;
    const medLvl = Math.max(0, Math.floor(Number(clanLevels.medicalWing ?? 0)));
    const clanPct = Math.min(CLAN_MEDICAL_WING_MAX_PCT, CLAN_MEDICAL_WING_PCT_PER_LEVEL * medLvl);
    const doctrinePct = char.clanDoctrine === 'medics' ? DOCTRINE_HOSPITAL_DISCOUNT_PCT : 0;
    return villagePct + clanPct + doctrinePct;
}
// discountCost(PAY_SKIP_DISCHARGE_COST, pct), mirroring lib/village-upgrades.ts.
function discountedDischargeCost(char: Record<string, unknown>): number {
    const pct = hospitalDiscountPct(char);
    return Math.max(1, Math.floor(PAY_SKIP_DISCHARGE_COST * Math.max(0, 1 - pct / 100)));
}

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

        // Fetch target. The full self-heal / cross-heal flow below does
        // read-modify-write on save:<target>; that's serialized under a
        // lock further down to keep a concurrent auto-save from clobbering
        // the heal write. The initial read here is fine outside the lock
        // because we re-read inside before mutating.
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
            // Discounted discharge fee (Town Hall Hospital + clan Medical Wing),
            // matching the price shown in the Hospital UI.
            const dischargeCost = discountedDischargeCost(targetChar);
            let chargedRyo = 0;
            if (!identity.admin && !timerExpired) {
                if (selfIsHealer) {
                    // Healer rank-scaled timer: r1=60s, r10=15s. If the
                    // healer's shortened timer also hasn't expired, fall
                    // through to the pay-skip / wait-it-out checks.
                    const xp = Number(targetChar.professionXp ?? 0);
                    const healerRank = professionRankForXp('healer', xp);
                    const fullTimer = HOSPITAL_DURATION_MS;
                    // Mastery (Quick Discharge): shorten the Healer's own timer further.
                    const dischargePct = Math.min(80, masteryBonus('healer', targetChar.masterySpec, 'healDischargePct'));
                    const healerTimer = Math.round(healerHospitalTimerMs(healerRank) * (1 - dischargePct / 100));
                    const healerEligibleAt = until - fullTimer + healerTimer;
                    if (Date.now() >= healerEligibleAt) {
                        // Healer rank-shortened timer is satisfied — let it discharge for free.
                    } else if (paySkip) {
                        // Pay to skip the remaining (already-shortened) wait.
                        const curRyo = Number(targetChar.ryo ?? 0);
                        if (curRyo < dischargeCost) {
                            return res.status(402).json({ error: `Need ${dischargeCost} ryo to pay-skip discharge.` });
                        }
                        chargedRyo = dischargeCost;
                    } else {
                        return res.status(429).json({
                            error: 'Hospital timer not yet expired.',
                            retryAfterMs: healerEligibleAt - Date.now(),
                        });
                    }
                } else if (paySkip) {
                    const curRyo = Number(targetChar.ryo ?? 0);
                    if (curRyo < dischargeCost) {
                        return res.status(402).json({ error: `Need ${dischargeCost} ryo to pay-skip discharge.` });
                    }
                    chargedRyo = dischargeCost;
                } else {
                    return res.status(429).json({
                        error: 'Hospital timer not yet expired.',
                        retryAfterMs: until - Date.now(),
                    });
                }
            }
            // Wrap the discharge write under the save lock. Without it a
            // concurrent /api/save POST (auto-save fired in the same tick
            // as the discharge button press) can wipe the ryo charge or
            // re-set the hospitalized flag using its stale snapshot. We
            // re-read inside the lock to fold in any fresh ryo gains.
            await withKvLock(targetKey, async () => {
                const fresh = await kv.get<Record<string, unknown>>(targetKey) ?? targetRecord;
                const freshChar = (fresh.character as Record<string, unknown> | undefined) ?? targetChar;
                const healed = {
                    ...fresh,
                    character: {
                        ...freshChar,
                        hp: freshChar.maxHp,
                        chakra: freshChar.maxChakra,
                        stamina: freshChar.maxStamina,
                        hospitalized: false,
                        hospitalizedUntil: 0,
                        hospitalizedAt: 0,
                        ryo: Math.max(0, Number(freshChar.ryo ?? 0) - chargedRyo),
                    },
                };
                await kv.set(targetKey, mergePreservingImages(healed, fresh));
            });
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
        // Mastery capstone (Village Lifeline) also grants the world-wide / any-
        // sector heal, even before the Rank-10 unlock.
        const hasLifeline = masteryHasCapstone('healer', healerChar.masterySpec, 'village-lifeline');
        if (!identity.admin && !targetHospitalized) {
            if (healerRank < HEALER_WORLDWIDE_RANK && !hasLifeline) {
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
        //
        // Use NX-set-with-TTL as the cooldown gate instead of get-then-set:
        // the previous pattern let two healers (or one healer firing twice)
        // both pass the "no entry" check and both heal before either
        // stamped the cooldown. NX-set is atomic in Redis/our KV shim, so
        // exactly one of N racing healers wins the reservation; the others
        // see placed=false and get 429'd. Admins bypass the gate.
        const cooldownKey = `heal:lastHealedAt:${targetName}`;
        // Mastery: Field Triage / Tireless / Vigil reduce the per-target cooldown;
        // Full Recovery removes it entirely (heal anyone, anytime).
        const cdReductionPct = Math.min(80, masteryBonus('healer', healerChar.masterySpec, 'healCooldownPct'));
        const hasFullRecovery = masteryHasCapstone('healer', healerChar.masterySpec, 'full-recovery');
        const effectiveCooldownMs = hasFullRecovery ? 0 : Math.round(healerPerTargetCooldownMs(healerRank) * (1 - cdReductionPct / 100));
        if (!identity.admin && effectiveCooldownMs > 0) {
            const placed = await kv.set(
                cooldownKey,
                { at: Date.now(), by: actorName },
                { nx: true, ex: Math.max(1, Math.ceil(effectiveCooldownMs / 1000)) } as never,
            );
            if (!placed) {
                // Reservation lost — read the existing entry to compute the
                // retry-after hint. If the key has already vanished (TTL
                // expired between NX-fail and this read), we must NOT return
                // retryAfterMs=0 because the client treats 0 as "ready" and
                // retries immediately, defeating the cooldown. Floor the
                // hint at half the cooldown so the client always waits.
                const existing = await kv.get<{ at: number; by: string }>(cooldownKey);
                const elapsed = existing?.at ? Date.now() - existing.at : 0;
                const computed = effectiveCooldownMs - elapsed;
                const retryAfterMs = existing
                    ? Math.max(250, computed)
                    : Math.max(250, Math.floor(effectiveCooldownMs / 2));
                return res.status(429).json({
                    error: 'Target was healed recently. Try again later.',
                    retryAfterMs,
                });
            }
        }

        // No healing during active battle — presence:{name} carries an
        // inBattle flag stamped by heartbeat while a PvP session is open.
        // This is mainly relevant at Rank 10 (where targets aren't required
        // to be hospitalized); Rank 1-9 heals are blocked earlier by the
        // hospitalized check (KO'd players aren't in a live battle).
        if (!identity.admin) {
            if (onlineStore.get(targetName)?.inBattle) {
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
        // Mastery (Diligent Care / Wandering Medic): extra heal XP, faster progression.
        const healXpMasteryPct = masteryBonus('healer', healerChar.masterySpec, 'healXpPct');
        if (healXpMasteryPct > 0) {
            xpGained = Math.floor(xpGained * (1 + healXpMasteryPct / 100));
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

        // Healing costs the Healer chakra: 25% of the HP restored (10% with the
        // Chakra Conduit capstone). Blocked if they can't pay. Deducted under the
        // Healer's save lock; on failure we refund the cooldown reservation so a
        // no-chakra attempt doesn't lock the Healer out of that target. Admins exempt.
        const amountToHeal = Math.max(0, maxHp - curHp);
        const chakraRate = masteryHasCapstone('healer', healerChar.masterySpec, 'chakra-conduit') ? 0.10 : 0.25;
        const chakraCost = Math.ceil(amountToHeal * chakraRate);
        if (!identity.admin && chakraCost > 0) {
            const paid = await withKvLock<{ ok: boolean }>(healerKey, async () => {
                const fresh = await kv.get<Record<string, unknown>>(healerKey);
                const fChar = fresh?.character as Record<string, unknown> | undefined;
                if (!fresh || !fChar) return { ok: false };
                const have = Number(fChar.chakra ?? 0);
                if (have < chakraCost) return { ok: false };
                await kv.set(healerKey, mergePreservingImages({ ...fresh, character: { ...fChar, chakra: have - chakraCost } }, fresh));
                return { ok: true };
            });
            if (!paid.ok) {
                await kv.del(cooldownKey).catch(() => undefined);
                return res.status(400).json({ error: `Not enough chakra — healing costs ${chakraCost} chakra.`, chakraCost });
            }
        }

        // Restore target under the save lock. The cross-heal write is just
        // as race-prone as the self-heal discharge above — a concurrent
        // auto-save of the target could wipe our hp/chakra/stamina/hosp
        // restore using its stale snapshot. Re-read inside the lock and
        // merge on top so any genuine concurrent gains survive.
        await withKvLock(targetKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(targetKey) ?? targetRecord;
            const freshChar = (fresh.character as Record<string, unknown> | undefined) ?? targetChar;
            const healedTarget = {
                ...fresh,
                character: {
                    ...freshChar,
                    hp: freshChar.maxHp,
                    chakra: freshChar.maxChakra,
                    stamina: freshChar.maxStamina,
                    hospitalized: false,
                    hospitalizedUntil: 0,
                    hospitalizedAt: 0,
                },
            };
            await kv.set(targetKey, mergePreservingImages(healedTarget, fresh));
        });

        // If this heal actually discharged a hospitalized player, queue a one-shot
        // "you were healed" signal for them. Their next heartbeat delivers+clears it
        // (api/player/heartbeat.ts) and the client auto-exits the hospital with a
        // "Healed by {healer}" toast instead of being stuck on the admitted screen
        // until a manual refresh. kickPlayer nudges an immediate heartbeat so it
        // lands within ~1s on the live (socket) host; the HTTP poll is the fallback.
        if (targetHospitalized) {
            await kv.set(`heal-signal:${targetName}`, { by: actorName, at: Date.now() }, { ex: 120 } as never);
            kickPlayer(targetName, 'heal');
        }

        // Award Healer XP for the heal itself (% HP restored).
        const heralded = await awardProfessionXp(actorName, 'healer', xpGained);

        // Cooldown was already placed by the NX-reservation above (admin
        // path took no reservation, so no stamp is needed either — admins
        // bypass the gate). Nothing further to write here.

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
            chakraCost,
        });
    } catch (err) {
        console.error('[heal]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
