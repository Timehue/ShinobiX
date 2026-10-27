import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { saveUnchangedSince } from '../save/_save-unchanged.js';
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

        // The single-use war-damage token for the HP half is minted INSIDE the
        // decision, under the save lock and BEFORE the mission commits. The
        // world-state war write refuses damage that isn't backed by a won battle,
        // a breached war ground, or a token like this one, so the mission's 30 HP
        // has to be authorized here, where the raid count is actually verified.
        //
        // Minted after the commit, a failed mint left the mission paid and spent
        // (a retry is refused as out-of-order) with its 30 war HP lost for good.
        // Minted first, a failed mint throws before anything is written, so the
        // claim simply fails and the retry is a fresh one. A token whose mission
        // does not commit is deleted again (onConflict, and onUnconfirmedWrite
        // while the save provably did not move); an unconfirmed write that may
        // have landed keeps it, so a mission that paid is never left without its
        // damage. The token is not usable by anyone until the reply hands its id
        // over, and it still dies on use or after WAR_MISSION_TOKEN_TTL_SEC.
        let warMissionToken: string | undefined;
        const result = await mutatePlayerSave(playerName, async ({ character, record, saveKey }) => {
            const applied = applyVillageWarMissionClaim(character, body.missionIndex, today, month);
            if (!applied.ok) {
                return { ok: false as const, status: REFUSAL_STATUS[applied.reason] ?? 409, error: applied.reason };
            }
            const village = String((character as { village?: string })?.village ?? '').trim();
            let tokenKey = '';
            if (village) {
                const tokenId = `${playerName}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
                const token: WarMissionToken = {
                    playerName,
                    village,
                    damage: VILLAGE_WAR_MISSION_DAMAGE,
                    expiresAt: Date.now() + WAR_MISSION_TOKEN_TTL_SEC * 1000,
                };
                tokenKey = warMissionTokenKey(tokenId);
                await kv.set(tokenKey, token, { ex: WAR_MISSION_TOKEN_TTL_SEC } as never);
                warMissionToken = tokenId;
            }
            const dropToken = async () => {
                warMissionToken = undefined;
                if (tokenKey) await kv.del(tokenKey);
            };
            return {
                ok: true as const,
                character: applied.character,
                value: { completed: applied.completed },
                onConflict: dropToken,
                onUnconfirmedWrite: async () => {
                    if (await saveUnchangedSince(saveKey, record)) await dropToken();
                },
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, warMissionToken, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error('[village/war-mission]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
