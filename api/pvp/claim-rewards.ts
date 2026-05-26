import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';

// One-shot idempotency gate for the CLIENT-side PvP reward payout.
//
// Server-side Vanguard rewards are already idempotent inside
// _vanguard-rewards.ts (vanguardRewardsGranted flag on the session). This
// endpoint covers the client-applied side: ryo, XP, monthlyPvpKills,
// totalPvpKills, ranked rating, ranked W/L counts, clan-war points, and
// the optional sector-raid damage tick. Without it, a refresh while the
// session is in 'done' state would re-mount PvpBattleScreen, reset the
// in-memory pvpRewardRef, fire the win effect again, and double-apply
// every one of those local grants.
//
// Contract:
//   POST { battleId, playerName, outcome: 'win' | 'loss' }
//   → 200 { ok: true, alreadyClaimed: boolean }
//   The caller MUST skip its local reward grant when alreadyClaimed is true.
//
// Storage: pvp:rewarded:<playerName>:<battleId>  (24h TTL — well past the
// 60-min session TTL, so even a slow re-mount can't slip past.)

const CLAIM_TTL_SECONDS = 24 * 60 * 60;

function claimKey(playerName: string, battleId: string): string {
    return `pvp:rewarded:${playerName.toLowerCase()}:${battleId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Tight rate-limit — a legit win path calls this once. Anything beyond
    // a handful per minute is either a bug loop or someone hammering for
    // a race-condition window.
    if (!(await enforceRateLimitKv(req, res, 'pvp-claim-rewards', 30, 60_000))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body?.playerName ?? ''));
        const battleId = String(body?.battleId ?? '').trim();
        const outcome = String(body?.outcome ?? '').trim();
        if (!playerName || !battleId) {
            return res.status(400).json({ error: 'Missing playerName or battleId.' });
        }
        if (outcome !== 'win' && outcome !== 'loss') {
            return res.status(400).json({ error: "outcome must be 'win' or 'loss'." });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName.toLowerCase()) {
            return res.status(403).json({ error: 'Can only claim your own rewards.' });
        }

        const key = claimKey(playerName, battleId);

        // Atomic NX reserve. If the key already exists, we lost the race
        // (or a duplicate call) — return alreadyClaimed so the caller
        // skips the local grant entirely.
        const placed = await kv.set(key, { outcome, ts: Date.now() }, { nx: true, ex: CLAIM_TTL_SECONDS } as never);
        const alreadyClaimed = !placed;
        return res.status(200).json({ ok: true, alreadyClaimed });
    } catch (err) {
        console.error('[pvp/claim-rewards]', err);
        // Fail open: returning ok=true with alreadyClaimed=false means the
        // legitimate first-time claim still pays out if KV is briefly down.
        // The risk of a one-time double-grant during an outage is preferable
        // to denying a legitimate winner their reward.
        return res.status(200).json({ ok: true, alreadyClaimed: false, degraded: true });
    }
}
