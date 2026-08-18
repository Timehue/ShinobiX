import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { isCleanText, sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { rejectUnclaimedGuest } from '../_guest-gate.js';
import {
    addSign,
    applySpark,
    isTraceSector,
    parseSigns,
    trailSignsKey,
    utcDayKey,
    TRAIL_SIGNS_PER_DAY,
    type TrailSign,
} from './_traces.js';

/*
 * /api/sector/trail-sign — POST only
 *
 * Leave a short trail sign at a tile in a wild sector, or "spark" (appreciate)
 * someone else's. Signs are name-attributed, moderated (reject + sanitize, the
 * village-chat pattern), and hard-capped so a sector can never accrete junk:
 * one active sign per player per sector (posting again replaces yours), oldest
 * evicted past the per-sector cap, 72h TTL, and a small per-day posting cap.
 * Pure social surface — no rewards flow through this endpoint in either
 * direction, so there is nothing to farm.
 *
 * Body: { playerName, sector, tile, text }                 → leave a sign
 *       { playerName, sector, action:'spark', signId }     → spark a sign
 * → { ok:true, signs:[…] } | { ok:false, reason } | { error }
 */

const SIGNS_KEY_TTL_SEC = 7 * 24 * 60 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const sector = Math.floor(Number(body.sector ?? NaN));
        if (!isTraceSector(sector)) return res.status(400).json({ error: 'Invalid sector.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'trail-sign', 8, 60_000, identity.name, { strict: true }))) return;

        const now = Date.now();
        const key = trailSignsKey(sector);
        const action = body.action === 'spark' ? 'spark' : 'leave';

        if (action === 'spark') {
            const signId = typeof body.signId === 'string' ? body.signId : '';
            if (!signId) return res.status(400).json({ error: 'Missing signId.' });
            const out = await withKvLock(key, async () => {
                const result = applySpark(parseSigns(await kv.get(key)), signId, playerName, now);
                if (!result.ok) return result;
                await kv.set(key, result.signs, { ex: SIGNS_KEY_TTL_SEC });
                return result;
            });
            if (!out.ok) return res.status(200).json({ ok: false, reason: out.reason });
            return res.status(200).json({ ok: true, sparks: out.sparks });
        }

        // A sign is name-attributed text left in the world for strangers to
        // read, so it carries the same guest lock as the tavern. Only `leave`
        // is gated: `spark` above is a wordless thumbs-up with nothing to
        // moderate, and letting a guest cheer someone's sign is exactly the
        // kind of thing a new player should be able to do on day one.
        if (await rejectUnclaimedGuest(res, identity)) return;

        // Leave a sign — moderate exactly like village chat: reject blocked content
        // outright, then sanitize (PII/profanity mask + length cap) what's stored.
        const rawText = typeof body.text === 'string' ? body.text.trim() : '';
        if (!rawText) return res.status(400).json({ error: 'Write something on the sign first.' });
        if (!identity.admin && !isCleanText(rawText)) return res.status(400).json({ error: 'Sign contains blocked content.' });
        const text = identity.admin ? rawText.slice(0, TEXT_LIMITS.trailSign) : sanitizeUserText(rawText, TEXT_LIMITS.trailSign);
        if (!text) return res.status(400).json({ error: 'Empty sign after moderation.' });
        const tileRaw = Math.floor(Number(body.tile));
        const tile = Number.isFinite(tileRaw) && tileRaw >= 0 && tileRaw <= 143 ? tileRaw : 77;

        if (!identity.admin) {
            const posted = await kv.incr(`trail-sign-day:${playerName}:${utcDayKey(now)}`, { ex: 25 * 60 * 60 });
            if (posted > TRAIL_SIGNS_PER_DAY) {
                return res.status(200).json({ ok: false, reason: 'daily-cap', signsPerDay: TRAIL_SIGNS_PER_DAY });
            }
        }

        const sign: TrailSign = {
            id: `ts-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: playerName,
            tile,
            text,
            at: now,
            sparks: 0,
            sparkedBy: [],
        };
        const signs = await withKvLock(key, async () => {
            const next = addSign(parseSigns(await kv.get(key)), sign, now);
            await kv.set(key, next, { ex: SIGNS_KEY_TTL_SEC });
            return next;
        });
        return res.status(200).json({
            ok: true,
            sign: { id: sign.id, name: sign.name, tile: sign.tile, text: sign.text, at: sign.at, sparks: 0 },
            signs: signs.map((s) => ({ id: s.id, name: s.name, tile: s.tile, text: s.text, at: s.at, sparks: s.sparks })),
        });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The trail post is busy — please retry.' });
        }
        console.error('[sector/trail-sign]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
