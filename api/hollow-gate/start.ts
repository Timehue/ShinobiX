import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { randomUUID } from 'node:crypto';
import {
    rollAugmentOffers,
    augmentDisplay,
    HG_CLAWBACK_KEYS,
    type HollowGateRunToken,
    type HgCurrencyKey,
} from './_run-token.js';

/*
 * /api/hollow-gate/start  — POST only  (docs/hollow-gate-augments.md)
 *
 * Mints a server-sealed run token for a Hollow Gate dive: seals the entry
 * currency snapshot + dive depth, rolls 3 augment offers (the client can't pick
 * the pool), and increments a SERVER daily-run counter (independent of the
 * client's lastDailyReset — closes the backdated-reset extra-dive exploit, #7).
 * Settle later credits min(claimed, sealed ceiling). Body: { playerName, floorDepth }.
 *
 * Inert until the client run loop is wired to it (a later pass, flag-gated), so
 * the existing no-token client path keeps working (token-first invariant).
 */

const DEFAULT_DAILY_RUN_CAP = 2; // base 2/day; attunement raises it in the client-wiring pass
// Hollow Gate runs are RESUMABLE across sessions (the run persists on the save), so
// the token must outlive a dive the player walks away from and finishes later. 24h
// comfortably covers any same-day resume; a run older than that has already crossed
// the UTC daily-cap reset, and an expired token just reverts that run to the
// client-authoritative path (settle no-ops gracefully — never a save break).
const RUN_TTL_SEC = 24 * 60 * 60;

function utcDateKey(): string { return new Date().toISOString().slice(0, 10); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const floorDepth = Math.max(1, Math.min(20, Math.floor(Number(body.floorDepth ?? 5)) || 5));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only start your own dive.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-start', 20, 60_000, identity.name))) return;

        const rec = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (rec?.character ?? null) as Record<string, unknown> | null;
        if (!char) return res.status(404).json({ error: 'Your save was not found.' });

        // Server-stamped daily-run cap (fixes #7 — not derived from client state).
        const cap = DEFAULT_DAILY_RUN_CAP + Math.max(0, Math.floor(Number(char.hollowGateRunBonus ?? 0)));
        const ord = await kv.incr(`hg-runs:${playerName}:${utcDateKey()}`, { ex: 25 * 60 * 60 });
        if (ord > cap) return res.status(200).json({ ok: true, reason: 'daily-cap', token: null });

        // Seal the entry snapshot of the clawback-eligible currencies.
        const entry = {} as Partial<Record<HgCurrencyKey, number>>;
        for (const k of HG_CLAWBACK_KEYS) entry[k] = Math.max(0, Math.floor(Number(char[k]) || 0));

        const offers = rollAugmentOffers(3);
        const token = randomUUID().replace(/-/g, '');
        const runToken: HollowGateRunToken = {
            playerName,
            mintedAt: Date.now(),
            floorDepth,
            seed: randomUUID(),
            entryCurrencies: entry,
            offeredAugmentIds: offers.map((o) => o.id),
            chosenAugmentId: null,
            dailyRunOrdinal: ord,
        };
        await kv.set(`hg-run:${playerName}:${token}`, runToken, { ex: RUN_TTL_SEC });

        return res.status(200).json({ ok: true, token, seed: runToken.seed, augmentOffers: offers.map(augmentDisplay) });
    } catch (err) {
        console.error('[hollow-gate/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
