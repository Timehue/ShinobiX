import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';

/*
 * /api/village/claim-daily-agenda  — POST only
 *
 * Server-authoritative VILLAGE-TREASURY half of the daily-agenda reward. The old
 * flow credited the shared village treasury (+15 honorSeals / +1500 ryo / +2
 * boneCharms) via the save blob, which the village-state validator could only
 * cap, not verify — a crafted client could credit arbitrary amounts or claim
 * repeatedly (#17 credit-without-debit on the shared pool).
 *
 * This endpoint credits the FIXED treasury amounts under the village-state lock,
 * at most once per player per UTC day, gated by a server-side NX idempotency
 * marker. It deliberately does NOT write the player save (so it can't race the
 * autosave version guard) and does NOT credit the PERSONAL reward — that's the
 * player's own currency, capped by the save sanitizer, and belongs to the broader
 * server-authoritative-rewards work (Stage 3), not the shared-pool hole #17 is
 * about. Task COMPLETION is not re-verified here either: the daily counters are
 * still client-incremented (also Stage 3). What this closes is the arbitrary-
 * amount + repeat vectors, which is the credit-without-debit hole.
 *
 * Body: { playerName, village }. Caller MUST be the player (or admin) and a
 * member of `village`. Rate-limited 30/min per actor.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
const AGENDA_TREASURY = { honorSeals: 15, ryo: 1500, boneCharms: 2 } as const;
const CLAIM_MARKER_TTL_SEC = 2 * 24 * 60 * 60; // 2 days — comfortably past one UTC day
const AUDIT_LOG_PREFIX = 'audit:village-agenda-claim:';

function villageSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function utcDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-agenda-claim', 30, 60_000, identity.name))) return;

        const slug = villageSlug(village);
        if (!slug) return res.status(400).json({ error: 'Invalid village name.' });
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${slug}`;

        // Membership: the caller's character must belong to this village (admin exempt).
        if (!identity.admin) {
            const donorRec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null) as Record<string, unknown> | null;
            if (!donorChar) return res.status(404).json({ error: 'Your save was not found.' });
            if (String(donorChar.village ?? '').trim() !== village) {
                return res.status(403).json({ error: 'You are not a member of this village.' });
            }
        }

        // One treasury credit per player per UTC day. NX reserve = authoritative
        // idempotency; no player-save write, so the autosave version guard is
        // untouched. If the marker already exists, the agenda was claimed today.
        const claimKey = `agenda-claimed:${slug}:${playerName.toLowerCase()}:${utcDate()}`;
        const reserved = await kv.set(claimKey, { ts: Date.now() }, { nx: true, ex: CLAIM_MARKER_TTL_SEC });
        if (reserved !== 'OK') {
            const state = await kv.get<Record<string, unknown>>(villageStateKey);
            return res.status(200).json({ ok: true, alreadyClaimed: true, treasury: (state?.treasury ?? {}) });
        }

        // NOT failClosed (unlike the donate/transfer/collect endpoints): the NX
        // marker above is the authoritative once-per-day idempotency guard and
        // it's already consumed at this point. Throwing on lock contention would
        // burn the marker without crediting → the player loses the day's reward.
        // Falling through to run the fixed-amount credit unlocked is the safer
        // choice; the only racy writers to this treasury (other agenda claims /
        // donations) are themselves serialized, so the window is negligible.
        const treasury = await withKvLock(villageStateKey, async () => {
            const state = (await kv.get<Record<string, unknown>>(villageStateKey)) ?? {};
            const prevT = (state.treasury ?? {}) as Record<string, unknown>;
            const nextT = {
                ...prevT,
                honorSeals: num(prevT.honorSeals) + AGENDA_TREASURY.honorSeals,
                ryo: num(prevT.ryo) + AGENDA_TREASURY.ryo,
                boneCharms: num(prevT.boneCharms) + AGENDA_TREASURY.boneCharms,
            };
            await kv.set(villageStateKey, { ...state, treasury: nextT });
            return nextT;
        });

        await kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            village,
            player: playerName,
            granted: AGENDA_TREASURY,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return res.status(200).json({ ok: true, treasury, granted: AGENDA_TREASURY });
    } catch (err) {
        console.error('[village/claim-daily-agenda]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
