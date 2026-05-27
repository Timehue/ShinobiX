import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { reportMissionEvent, awardProfessionXp, type CompletedMissionInfo } from './_progress.js';
import { withKvLock } from '../_lock.js';

// Server-side Tamer XP for completed expeditions. Matches the client-side
// formula (5 XP/min base, +50% for >=1h, +100% for >=4h, x2 daily First
// Expedition, x1.2 if petEscortBonusReady is consumed).
const MIN_EXPEDITION_MINUTES = 10;
// Longest legitimate expedition is 4 hours. Anything claimed beyond that is
// either a bot or a buggy client — clip at 240 min so XP / Ryo formulas
// can't be inflated by a forged body.
const MAX_EXPEDITION_MINUTES = 240;
// Hard daily ceiling on claims, even with PET_CAP = 5 pets each running
// back-to-back short expeditions. Stops a 30s-spam attack from accumulating
// thousands of claims/day.
const MAX_EXPEDITIONS_PER_DAY = 12;
function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}
function tamerXpForExpedition(durationMinutes: number, opts: { isFirstToday: boolean; escortReady: boolean }): number {
    if (durationMinutes < MIN_EXPEDITION_MINUTES) return 0;
    const base = Math.floor(durationMinutes * 5);
    let mult = 1;
    if (durationMinutes >= 240) mult = 2;          // +100% for ≥4h
    else if (durationMinutes >= 60) mult = 1.5;    // +50% for ≥1h
    if (opts.isFirstToday) mult *= 2;
    if (opts.escortReady) mult *= 1.2;
    return Math.floor(base * mult);
}

// Pet Tamer mission progress reporter. Pet expedition/training state is
// currently client-side, so this endpoint trusts the client's event claim
// but is heavily rate-limited (1 per 30s per player) so it can't be spammed
// to inflate mission progress. Profession XP impact is small (~150 XP per
// mission completion); abuse risk is bounded by daily mission count + the
// per-save professionXp cap.
//
// When a server-side pet system exists, this endpoint should be replaced
// with direct hooks in the expedition/training-claim endpoints.

const VALID_EVENTS = ['expedition', 'long-expedition', 'pet-train'] as const;
type PetEvent = typeof VALID_EVENTS[number];

const EVENT_TO_KIND: Record<PetEvent, 'pet-tamer-expeditions' | 'pet-tamer-long-expeditions' | 'pet-tamer-pet-train'> = {
    'expedition': 'pet-tamer-expeditions',
    'long-expedition': 'pet-tamer-long-expeditions',
    'pet-train': 'pet-tamer-pet-train',
};

const VALID_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'] as const;
type ExpType = typeof VALID_EXPEDITION_TYPES[number];

// Per-type Ryo/drop tables (mirrors client formula in PetYard.collectExpedition).
const RYO_MULT: Record<ExpType, number> = { scout: 1.35, forage: 1.0, ruins: 1.1 };
const BONE_RATE: Record<ExpType, number> = { scout: 0.25, forage: 0.30, ruins: 0.40 };
const AURA_RATE: Record<ExpType, number> = { scout: 0.00, forage: 0.01, ruins: 0.01 };
const FATE_RATE: Record<ExpType, number> = { scout: 0.05, forage: 0.05, ruins: 0.10 };

function petTamerExpeditionMultFromRank(rank: number, profession: unknown): number {
    if (profession !== 'petTamer') return 1;
    const r = Math.max(0, Math.min(10, rank));
    return 1 + (10 + r * 1.5) / 100;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // 1 report per 30 s per player. Rate limit BEFORE auth check so spam
    // attempts at unknown names also get throttled.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'report-pet-event', 1, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const event = String(body.event ?? '') as PetEvent;
        const durationMinutes = Math.max(0, Math.min(MAX_EXPEDITION_MINUTES, Math.floor(Number(body.durationMinutes ?? 0))));
        const expType = (body.expType && VALID_EXPEDITION_TYPES.includes(body.expType) ? body.expType : null) as ExpType | null;
        const petLevel = Math.max(1, Math.min(100, Math.floor(Number(body.petLevel ?? 1))));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own events.' });
        }

        // Verify the player is actually a Pet Tamer. Cheap pre-lock peek; the
        // authoritative read happens under the lock below.
        const saveKey = `save:${playerName}`;
        const preCheck = await kv.get<Record<string, unknown>>(saveKey);
        const preChar = preCheck?.character as Record<string, unknown> | undefined;
        if (preChar?.profession !== 'petTamer') {
            return res.status(200).json({ ok: true, petTamer: false });
        }

        // For expedition events, server computes Tamer XP AND the Ryo + drop
        // currencies (previously client-trusted). Pet stat/XP gains stay
        // client-side since they're per-pet state not global currency.
        let expeditionXp = 0;
        let ryoEarned = 0;
        let foundBone = 0;
        let foundAura = 0;
        let foundFate = 0;
        let dailyCapHit = false;
        const isExpedition = event === 'expedition' || event === 'long-expedition';
        if (isExpedition && durationMinutes > 0) {
            // ── withKvLock: the daily-cap check + write must be atomic ────
            // Two concurrent expedition claims (multi-tab race) used to both
            // read the same `expeditionsClaimedToday`, both pass the cap
            // check, and both grant ryo/drops/Tamer XP. The lock serializes
            // them so the second sees the updated counter and short-circuits.
            await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!char) return; // race: save deleted mid-call

                const today = utcDateKey();
                const sameDay = char.lastExpeditionClaimDate === today;
                const claimedToday = sameDay ? Number(char.expeditionsClaimedToday ?? 0) : 0;
                if (claimedToday >= MAX_EXPEDITIONS_PER_DAY) {
                    dailyCapHit = true;
                    return;
                }
                const isFirstToday = claimedToday === 0;
                const escortReady = !!char.petEscortBonusReady;
                const rank = Number(char.professionRank ?? 1);

                expeditionXp = tamerXpForExpedition(durationMinutes, { isFirstToday, escortReady });

                // Ryo + drop calculation (mirrors client formula). Requires expType.
                if (expType) {
                    const durationHours = Math.max(1, durationMinutes / 60);
                    const tamerMult = petTamerExpeditionMultFromRank(rank, char.profession);
                    const firstBonus = isFirstToday ? 2 : 1;
                    const dropBonus = (tamerMult - 1) + (isFirstToday ? 0.5 : 0);

                    ryoEarned = Math.round((90 * durationHours * RYO_MULT[expType] + petLevel * 6) * tamerMult * firstBonus);
                    foundBone = Math.random() < (BONE_RATE[expType] + dropBonus) ? 1 : 0;
                    foundAura = Math.random() < (AURA_RATE[expType] + dropBonus * 0.1) ? 1 : 0;
                    foundFate = Math.random() < (FATE_RATE[expType] + dropBonus * 0.1) ? 1 : 0;
                }

                // Stamp daily tracking + consume escort bonus + apply currencies.
                const updated = {
                    ...record,
                    character: {
                        ...char,
                        lastExpeditionClaimDate: today,
                        expeditionsClaimedToday: claimedToday + 1,
                        ryo: Number(char.ryo ?? 0) + ryoEarned,
                        boneCharms: Number(char.boneCharms ?? 0) + foundBone,
                        auraStones: Number(char.auraStones ?? 0) + foundAura,
                        fateShards: Number(char.fateShards ?? 0) + foundFate,
                        ...(escortReady ? { petEscortBonusReady: false } : {}),
                    },
                };
                await kv.set(saveKey, mergePreservingImages(updated, record));
            });

            // Daily cap reached — short-circuit cleanly with the same shape
            // the pre-lock cap check used to return.
            if (dailyCapHit) {
                return res.status(200).json({
                    ok: true,
                    petTamer: true,
                    reason: 'daily-expedition-cap',
                    expeditionXp: 0,
                    ryoEarned: 0,
                    foundBone: 0,
                    foundAura: 0,
                    foundFate: 0,
                    missionsCompleted: [],
                });
            }

            // Grant Tamer XP (subject to per-save cap and Rank-2 multiplier).
            // awardProfessionXp acquires its own lock — kept outside the
            // expedition-counter lock above so we don't nest lock acquires.
            if (expeditionXp > 0) {
                await awardProfessionXp(playerName, 'petTamer', expeditionXp);
            }
        }

        const kind = EVENT_TO_KIND[event];
        const result = await reportMissionEvent({
            playerName,
            profession: 'petTamer',
            kind,
        });
        const missionsCompleted: CompletedMissionInfo[] = result.missionsCompleted;

        // For long-expedition events also fire the regular expedition counter
        // (a 4hr+ expedition counts as both a "completed expedition" and a
        // "long expedition" toward the relevant missions).
        let extraCompleted: CompletedMissionInfo[] = [];
        if (event === 'long-expedition') {
            const extra = await reportMissionEvent({
                playerName,
                profession: 'petTamer',
                kind: 'pet-tamer-expeditions',
            });
            extraCompleted = extra.missionsCompleted;
        }

        // Re-read for the final post-grant state.
        const finalRecord = await kv.get<Record<string, unknown>>(saveKey);
        const finalChar = finalRecord?.character as Record<string, unknown> | undefined;

        return res.status(200).json({
            ok: true,
            petTamer: true,
            expeditionXp,
            ryoEarned,
            foundBone,
            foundAura,
            foundFate,
            missionXpAwarded: result.xpAwarded,
            missionsCompleted: [...missionsCompleted, ...extraCompleted],
            professionXp: Number(finalChar?.professionXp ?? 0),
            professionRank: Number(finalChar?.professionRank ?? 1),
        });
    } catch (err) {
        console.error('[missions/report-pet-event]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
