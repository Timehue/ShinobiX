import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { applyVillageWarMissionClaim } from './_war-mission.js';
import { warMissionTokenKey, WAR_MISSION_TOKEN_TTL_SEC, type WarMissionToken } from '../_war-battle-receipt.js';

// War-HP damage a settled daily mission authorizes. KEEP IN SYNC with
// shinobij.client/src/lib/world-state.ts VILLAGE_WAR_MISSION_DAMAGE.
const VILLAGE_WAR_MISSION_DAMAGE = 30;

/*
 * /api/village/war-mission — POST only. Settles one village-war daily mission.
 *
 * The reward (villageWarMissionsCompleted, clanMissionContrib,
 * totalMissionsCompleted) is entirely server-owned in the save sanitizer, so
 * the old client-side claim paid nothing while still burning the day's stamp.
 * This commits it under lock:save:<name> via mutatePlayerSave.
 *
 * Idempotent by construction: the claim requires missionIndex === the stored
 * completed count, so a replay of the same index refuses with out-of-order.
 *
 * Body: { playerName, missionIndex }.
 */

const REFUSAL_STATUS: Record<string, number> = {
    'invalid-mission': 400,
    'no-village': 409,
    'out-of-order': 409,
    'not-enough-raids': 409,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your mission.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-mission', 30, 60_000, identity.name))) return;

        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const month = now.toISOString().slice(0, 7);

        let village = '';
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            const applied = applyVillageWarMissionClaim(character, body.missionIndex, today, month);
            if (!applied.ok) {
                return { ok: false as const, status: REFUSAL_STATUS[applied.reason] ?? 409, error: applied.reason };
            }
            village = String((character as { village?: string })?.village ?? '').trim();
            return { ok: true as const, character: applied.character, value: { completed: applied.completed } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        // Mint the single-use war-damage token for the HP half. The world-state
        // war write refuses damage that isn't backed by a won battle, a breached
        // war ground, or a token like this one — so the mission's 30 HP has to be
        // authorized here, where the raid count was actually verified.
        let warMissionToken: string | undefined;
        if (village) {
            const tokenId = `${playerName}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
            const token: WarMissionToken = {
                playerName,
                village,
                damage: VILLAGE_WAR_MISSION_DAMAGE,
                expiresAt: Date.now() + WAR_MISSION_TOKEN_TTL_SEC * 1000,
            };
            try {
                await kv.set(warMissionTokenKey(tokenId), token, { ex: WAR_MISSION_TOKEN_TTL_SEC } as never);
                warMissionToken = tokenId;
            } catch (mintError) {
                // Non-fatal: the mission reward is already committed. The war HP
                // simply doesn't land, rather than the claim failing after payout.
                console.error('[village/war-mission] token mint failed', safeLogValue(mintError));
            }
        }
        return res.status(200).json({ ok: true, ...result.value, warMissionToken, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[village/war-mission]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
