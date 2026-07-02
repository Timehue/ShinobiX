import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { consumeSingleUseToken } from '../_single-use-token.js';

/*
 * /api/training/complete — POST only
 *
 * Redeems a stat-training token minted by /api/training/start. Verifies ownership
 * and the time-gate, then atomically consumes the single-use token (so a session
 * can't be collected twice) and returns the SEALED stat gain + XP for the client
 * to apply. `cancel: true` collects early, prorating the sealed reward by the
 * fraction of the tier that has elapsed (matches the client's "keep prorated
 * stats"). A not-yet-complete peek does NOT consume the token, so the player can
 * retry once the timer is up.
 *
 * Fail-open on a missing/spent token (returns ok:true, granted:false) so a stale
 * tab doesn't hard-error — the client falls back to its local (sanitizer-bounded)
 * gain in that case.
 *
 * Body: { playerName, token, cancel? }
 */

interface TrainingToken {
    playerName: string;
    stat: string;
    tierId: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'training-complete', 8, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
        const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
        const cancel = body.cancel === true;

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!token) return res.status(400).json({ error: 'Missing training token.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only complete your own training.' });
        }

        const tokenKey = `training-token:${playerName}:${token}`;
        // Peek first so a premature "collect" doesn't burn the token — only a real
        // grant consumes it.
        const peek = await kv.get<TrainingToken>(tokenKey);
        if (!peek) {
            return res.status(200).json({ ok: true, granted: false, reason: 'invalid-or-spent-token' });
        }
        if ((peek.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
            return res.status(403).json({ error: 'Training token does not belong to this player.' });
        }
        const now = Date.now();
        if (!cancel && now < peek.endsAt) {
            return res.status(200).json({ ok: true, granted: false, reason: 'not-yet-complete', remainingMs: peek.endsAt - now });
        }

        // Time-gate passed (or cancel) — atomically consume. The delete rowcount is
        // the real double-collect gate: a racing second call gets null here.
        const data = await consumeSingleUseToken<TrainingToken>(kv, tokenKey);
        if (!data) {
            return res.status(200).json({ ok: true, granted: false, reason: 'invalid-or-spent-token' });
        }

        let gain = Math.max(0, Math.floor(data.sealedGain));
        let xp = Math.max(0, Math.floor(data.sealedXp));
        if (cancel) {
            const totalMs = data.endsAt - data.startedAt;
            const frac = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
            gain = Math.floor(gain * frac);
            xp = Math.floor(xp * frac);
        }

        return res.status(200).json({ ok: true, granted: true, stat: data.stat, gain, xp });
    } catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
