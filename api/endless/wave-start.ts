import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import type { EndlessRun } from './_run.js';
import {
    buildEndlessWaveEncounter,
    createEndlessWaveBinding,
    endlessActiveWaveKey,
    endlessWaveBindingKey,
    endlessWaveRunId,
    ENDLESS_WAVE_TTL_SECONDS,
} from './_wave-session.js';

/**
 * Seal the CURRENT wave of the caller's in-flight Endless Tower run.
 * Body: { playerName, runToken }.
 *
 * The wave number is read from the save's own run record, never from the
 * request — a client-chosen wave is a client-chosen reward, since the per-wave
 * payout scales with it. The opponent is generated from the run token + wave +
 * the save's level (api/endless/_wave-opponent.ts), so the request carries no
 * opponent, level or stats either. Mirrors api/story/spar-start.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!enforceRateLimit(req, res, 'endless-wave-start', 40, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your tower run.' });
        if (!identity.admin && await findTowerBattleStartConflict([playerName])) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }

        const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
        const char = save?.character as Record<string, unknown> | undefined;
        if (!save || !char) return res.status(404).json({ error: 'Player save not found.' });

        const runToken = typeof body.runToken === 'string' && /^[A-Za-z0-9]{16,96}$/.test(body.runToken) ? body.runToken : '';
        const run = char.endlessTowerRun && typeof char.endlessTowerRun === 'object' ? char.endlessTowerRun as EndlessRun : null;
        if (!run || !runToken || run.runToken !== runToken) {
            return res.status(409).json({ error: 'No matching Endless Tower run.' });
        }
        const wave = Math.max(1, Math.floor(Number(run.wave) || 1));

        const activeKey = endlessActiveWaveKey(playerName, runToken);
        const started = await withKvLock(activeKey, async () => {
            const active = await kv.get<{ runId: string; wave: number }>(activeKey);
            if (active?.runId && active.wave === wave) {
                const priorBinding = await kv.get<ReturnType<typeof createEndlessWaveBinding>>(endlessWaveBindingKey(active.runId));
                const priorSession = await readSoloPveSession(active.runId);
                if (priorBinding?.status === 'active' && priorSession) {
                    return { ok: true as const, runId: active.runId, wave, session: priorSession, resumed: true };
                }
            }

            const runId = endlessWaveRunId();
            const now = Date.now();
            const built = buildEndlessWaveEncounter({
                playerName,
                save,
                runToken,
                wave,
                playerLevel: Math.max(1, Math.floor(Number(char.level) || 1)),
                runId,
                now,
                admin: await loadAdminCombatContent(),
            });
            if (!built) return { ok: false as const, error: 'No Endless Tower opponent could be sealed.' };

            await writeSoloPveSession(built.session);
            await kv.set(
                endlessWaveBindingKey(runId),
                createEndlessWaveBinding({ runId, playerName, runToken, wave, opponentId: built.opponentId, now }),
                { ex: ENDLESS_WAVE_TTL_SECONDS },
            );
            await kv.set(activeKey, { runId, wave }, { ex: ENDLESS_WAVE_TTL_SECONDS });
            return { ok: true as const, runId, wave, session: built.session, resumed: false };
        }, { failClosed: true });
        if (!started.ok) return res.status(409).json({ error: started.error });
        return res.status(200).json(started);
    } catch (err) {
        console.error('[endless/wave-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
