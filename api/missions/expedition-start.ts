import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { masteryBonus } from '../_profession-mastery.js';

/*
 * /api/missions/expedition-start  — POST only
 *
 * Mints a single-use token for a pet expedition. Pet expeditions are otherwise
 * entirely client-driven, so /api/missions/report-pet-event used to grant Ryo +
 * premium drops (Fate Shards) + Tamer XP purely on the client's claim — a
 * zero-effort farm bounded only by the daily cap. This endpoint couples the
 * reward to a real expedition: the client must mint a token at launch (consuming
 * a daily-mint slot) and can only redeem it after the expedition's real duration
 * has elapsed (see report-pet-event's time-gate), turning "12 free fabricated
 * claims/day" into "12 actually-run expeditions/day".
 *
 * The reward-relevant fields (expType, duration, petLevel) are sealed into the
 * token here so the redeemer can't tamper with them. Crucially the duration is
 * DERIVED from expType server-side, so a client can't pair scout's high Ryo
 * multiplier with ruins' 4h duration.
 *
 * Token: `pet-exp-token:<player>:<uuid>` = { playerName, petId, expType,
 * durationMinutes, petLevel, mintedAt, endsAt }, TTL = 5h (covers the 4h max
 * expedition + collect slack). Single-use: report-pet-event deletes it on redeem.
 *
 * Body: { playerName, petId?, expType, petLevel? }
 *
 * Rate limited 5 per 30s (a Tamer can launch up to PET_CAP=5 pets back-to-back)
 * + a hard 12/day mint cap (matches report-pet-event's MAX_EXPEDITIONS_PER_DAY).
 */

const VALID_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'] as const;
type ExpType = typeof VALID_EXPEDITION_TYPES[number];

// Canonical duration per expedition type (minutes). DERIVED here, never taken
// from the client — mirrors petExpeditionOptions in shinobij.client/src/data/
// pet-config.ts (45m / 2h / 4h). Keep in sync with that table.
const EXP_DURATION_MINUTES: Record<ExpType, number> = { scout: 45, forage: 120, ruins: 240 };

// Matches report-pet-event.MAX_EXPEDITIONS_PER_DAY — the daily reward ceiling.
const MAX_EXPEDITION_STARTS_PER_DAY = 12;
// 7 days: must comfortably outlast the longest expedition (4h) PLUS however
// long a player takes to come back and collect (they may close the game for
// days). The endsAt time-gate, single-use deletion, and 12/day mint cap are the
// real bounds — a generous TTL just avoids voiding a legitimately-earned reward.
const EXPEDITION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Pre-auth rate limit so spam at unknown names also throttles.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'expedition-start', 5, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const expType = (body.expType && VALID_EXPEDITION_TYPES.includes(body.expType) ? body.expType : null) as ExpType | null;
        const petIdRaw = typeof body.petId === 'string' ? body.petId.trim().slice(0, 64) : '';
        const petId = /^[A-Za-z0-9:_-]+$/.test(petIdRaw) ? petIdRaw : '';
        const petLevel = Math.max(1, Math.min(100, Math.floor(Number(body.petLevel ?? 1))));

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!expType) return res.status(400).json({ error: 'Invalid expedition type.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own expeditions.' });
        }

        // Only Pet Tamers earn expedition currency/Tamer rewards, so only they
        // need a token. Non-Tamers can still run expeditions client-side (pet
        // XP/stats), they just never call report-pet-event. Return 200, no token.
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        if (char?.profession !== 'petTamer') {
            return res.status(200).json({ ok: true, petTamer: false, token: null });
        }

        // Daily mint cap (separate counter from report-pet-event's claim cap;
        // a mint without a redeem still counts so the two can't be played off
        // each other).
        const today = utcDateKey();
        const dailyKey = `pet-exp-start-count:${playerName}:${today}`;
        // Read-check-increment under a lock so concurrent -start calls can't both
        // read N and both write N+1, slipping past the cap on the boundary
        // (mirrors report-raid.ts). Defense-in-depth only — the real currency
        // payout in report-pet-event has its own locked claim cap — so the default
        // fall-through policy is right here (no failClosed): a rare over-mint
        // costs nothing, and we'd rather mint than 500 a launch under contention.
        const capCheck = await withKvLock(dailyKey, async () => {
            const startedToday = Number((await kv.get<number>(dailyKey)) ?? 0);
            if (startedToday >= MAX_EXPEDITION_STARTS_PER_DAY) {
                return { capped: true as const };
            }
            await kv.set(dailyKey, startedToday + 1, { ex: 25 * 60 * 60 }).catch(() => undefined);
            return { capped: false as const };
        });
        if (capCheck.capped) {
            return res.status(200).json({ ok: true, petTamer: true, reason: 'daily-mint-cap', token: null });
        }

        const durationMinutes = EXP_DURATION_MINUTES[expType];
        const mintedAt = Date.now();
        const endsAt = mintedAt + durationMinutes * 60_000;

        // Seal the Pet Tamer mastery reward multipliers (Expeditioner path) into
        // the token so the redeemer can't tamper with them and they're fixed at
        // launch-time spec. PvE currency only.
        const expRewardMult = 1 + masteryBonus(char?.profession, char?.masterySpec, 'expRewardPct') / 100;
        const expMaterialMult = 1 + masteryBonus(char?.profession, char?.masterySpec, 'expMaterialPct') / 100;

        const tokenId = randomUUID().replace(/-/g, '');
        const tokenKey = `pet-exp-token:${playerName}:${tokenId}`;
        await kv.set(tokenKey, {
            playerName,
            petId: petId || undefined,
            expType,
            durationMinutes,
            petLevel,
            mintedAt,
            endsAt,
            expRewardMult,
            expMaterialMult,
        }, { ex: EXPEDITION_TOKEN_TTL_SECONDS });

        return res.status(200).json({ ok: true, petTamer: true, token: tokenId, durationMinutes, endsAt });
    } catch (err) {
        console.error('[missions/expedition-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
