import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { reportMissionEvent, awardProfessionXp, type CompletedMissionInfo } from './_progress.js';

// Server-side Tamer XP for completed expeditions. Matches the client-side
// formula (5 XP/min base, +50% for >=1h, +100% for >=4h, x2 daily First
// Expedition, x1.2 if petEscortBonusReady is consumed).
const MIN_EXPEDITION_MINUTES = 10;
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
        const durationMinutes = Math.max(0, Math.min(60 * 24, Math.floor(Number(body.durationMinutes ?? 0))));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own events.' });
        }

        // Verify the player is actually a Pet Tamer.
        const saveKey = `save:${playerName}`;
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'petTamer') {
            return res.status(200).json({ ok: true, petTamer: false });
        }

        // For expedition events, server computes and grants Tamer XP using the
        // canonical formula. Daily First Expedition bonus + petEscortBonusReady
        // tracked server-side via character fields. Long-expedition fires both
        // counters AND grants XP for the underlying expedition.
        let expeditionXp = 0;
        const isExpedition = event === 'expedition' || event === 'long-expedition';
        if (isExpedition && durationMinutes > 0) {
            const today = utcDateKey();
            const sameDay = char.lastExpeditionClaimDate === today;
            const claimedToday = sameDay ? Number(char.expeditionsClaimedToday ?? 0) : 0;
            const isFirstToday = claimedToday === 0;
            const escortReady = !!char.petEscortBonusReady;

            expeditionXp = tamerXpForExpedition(durationMinutes, { isFirstToday, escortReady });

            // Stamp daily tracking + consume escort bonus.
            const updated = {
                ...record,
                character: {
                    ...char,
                    lastExpeditionClaimDate: today,
                    expeditionsClaimedToday: claimedToday + 1,
                    ...(escortReady ? { petEscortBonusReady: false } : {}),
                },
            };
            await kv.set(saveKey, mergePreservingImages(updated, record));

            // Grant XP (subject to per-save cap and Rank-2 multiplier).
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
