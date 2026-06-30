import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { gainXp, type XpCharacter } from '../_xp-engine.js';
import { aiFightReward, AI_FIGHT_DAILY_COUNT_TTL_SECONDS } from './_ai-fight-reward.js';

// P0.2b — server-authoritative AI-fight reward with a daily soft-cap.
//
// The client reports the base XP/ryo it computed for an AI win; the server clamps
// it, applies the soft-cap from an AUTHORITATIVE date-keyed counter (so a tampered
// client can't bypass the cap by lying about its daily count), and credits XP (via
// the shared gainXp leveling — respecting exam gates + stat budget) and ryo under
// the save lock. This governs ONLY the XP+ryo faucet that breaks the 90-day curve;
// currency drops / kill counters / territory stay on the client save path (those
// are P0.2c's mint-token surface).
//
// Gated by AI_FIGHT_SERVER_AUTH (env). Default OFF → the endpoint is an inert
// no-op that credits nothing, so registering it can't add a credit path on top of
// the still-active client grant. It activates together with the client rewire
// (aiFightServerAuth.v1), which stops the local grant and applies this result.

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own fights.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'report-ai-fight', 30, 60_000, identity.name))) return;

        // Inert until the feature is enabled — never credits on the default path,
        // so it can't double-grant on top of the (still-active) client reward.
        if (process.env.AI_FIGHT_SERVER_AUTH !== '1') {
            return res.status(200).json({ ok: true, disabled: true, grantedXp: 0, grantedRyo: 0 });
        }

        const claimedXp = Number(body.xp ?? 0);
        const claimedRyo = Number(body.ryo ?? 0);
        const key = `save:${playerName}`;

        const result = await withKvLock(key, async () => {
            const record = await kv.get<Record<string, unknown>>(key);
            if (!record) return { status: 404 as const, body: { error: 'Player not found.' } };
            const char = record.character as Record<string, unknown> | undefined;
            if (!char) return { status: 404 as const, body: { error: 'Character not found.' } };

            // Authoritative daily count (atomic incr; TTL so date keys self-evict).
            const dailyCount = await kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
            const reward = aiFightReward(claimedXp, claimedRyo, dailyCount);

            const leveled = gainXp({ ...(char as unknown as XpCharacter) }, reward.xp) as unknown as Record<string, unknown>;
            leveled.ryo = Math.max(0, Number(char.ryo ?? 0)) + reward.ryo;
            const updated = { ...record, character: leveled };
            bumpSaveVersion(updated);
            await kv.set(key, mergePreservingImages(updated, record));

            return {
                status: 200 as const,
                body: {
                    ok: true,
                    grantedXp: reward.xp,
                    grantedRyo: reward.ryo,
                    capped: reward.capped,
                    dailyCount,
                    level: leveled.level,
                    xp: leveled.xp,
                    ryo: leveled.ryo,
                },
            };
        }, { failClosed: true });
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
