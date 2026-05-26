import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { reportMissionEvent, awardProfessionXp, type CompletedMissionInfo } from '../missions/_progress.js';

const HEAL_PER_TARGET_COOLDOWN_MS = 5 * 60 * 1000;
const HEALER_MAX_XP_PER_HEAL = 100;
// Healer assist synergy: +50% XP for healing a target who was hospitalized
// within the last 10 minutes (recent-fight proxy — players are hospitalized
// from PvP losses, so a fresh hospitalization means combat assist).
const HEALER_RAID_ASSIST_WINDOW_MS = 10 * 60 * 1000;
const HEALER_RAID_ASSIST_MULT = 1.5;
const HOSPITAL_DURATION_MS = 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const targetName = safeName(String(body.targetName ?? ''));
        const healerName = safeName(String(body.healerName ?? ''));
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
            // Original behavior: self-heal only after the hospital timer expires
            // (admins bypass). No profession XP awarded for self-heals.
            if (!targetHospitalized) return res.status(400).json({ error: 'Player is not hospitalized.' });
            const until = Number(targetChar.hospitalizedUntil ?? 0);
            if (!identity.admin && until && Date.now() < until) {
                return res.status(429).json({
                    error: 'Hospital timer not yet expired.',
                    retryAfterMs: until - Date.now(),
                });
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
                },
            };
            await kv.set(targetKey, mergePreservingImages(healed, targetRecord));
            return res.status(200).json({ ok: true, kind: 'self' });
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
        const healerRank = Number(healerChar.professionRank ?? 0);
        if (!identity.admin && !targetHospitalized) {
            if (healerRank < 10) {
                return res.status(400).json({ error: 'Target is not hospitalized. World-wide healing unlocks at Rank 10.' });
            }
            if (!targetInjured) {
                return res.status(400).json({ error: 'Target is at full HP — nothing to heal.' });
            }
        }

        // Per-target cooldown — any Healer touching the same target shares
        // the 5 min lockout (prevents two-Healer ping-pong farming).
        const cooldownKey = `heal:lastHealedAt:${targetName}`;
        const cooldownEntry = await kv.get<{ at: number; by: string }>(cooldownKey);
        if (!identity.admin && cooldownEntry?.at) {
            const elapsed = Date.now() - cooldownEntry.at;
            if (elapsed < HEAL_PER_TARGET_COOLDOWN_MS) {
                return res.status(429).json({
                    error: 'Target was healed recently. Try again later.',
                    retryAfterMs: HEAL_PER_TARGET_COOLDOWN_MS - elapsed,
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

        // Healer raid-assist synergy: +50% XP if the target was hospitalized
        // within the last 10 minutes (proxy for "fresh from a fight").
        const hospitalizedUntilTs = Number(targetChar.hospitalizedUntil ?? 0);
        const hospitalizedAt = hospitalizedUntilTs ? hospitalizedUntilTs - HOSPITAL_DURATION_MS : 0;
        const raidAssist = hospitalizedAt > 0 && (Date.now() - hospitalizedAt) < HEALER_RAID_ASSIST_WINDOW_MS;
        if (raidAssist) {
            xpGained = Math.floor(xpGained * HEALER_RAID_ASSIST_MULT);
        }

        // Restore target.
        const healedTarget = {
            ...targetRecord,
            character: {
                ...targetChar,
                hp: targetChar.maxHp,
                chakra: targetChar.maxChakra,
                stamina: targetChar.maxStamina,
                hospitalized: false,
                hospitalizedUntil: 0,
            },
        };
        await kv.set(targetKey, mergePreservingImages(healedTarget, targetRecord));

        // Award Healer XP for the heal itself (% HP restored).
        const heralded = await awardProfessionXp(actorName, 'healer', xpGained);

        // Stamp cooldown.
        await kv.set(cooldownKey, { at: Date.now(), by: actorName }, {
            ex: Math.ceil(HEAL_PER_TARGET_COOLDOWN_MS / 1000),
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
