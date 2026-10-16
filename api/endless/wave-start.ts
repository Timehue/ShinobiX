import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { readSoloPveSession, repairSoloPveSessionPublication, soloPveRowTtlSeconds, soloPveSessionKey } from '../solo-pve/_store.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { settleHeldFights } from '../pve/_held-fights.js';
import type { EndlessRun } from './_run.js';
import {
    buildEndlessWaveEncounter,
    createEndlessWaveBinding,
    endlessActiveWaveKey,
    endlessWaveBindingKey,
    endlessWaveRunId,
    endlessSealedWaveKey,
    endlessWaveBindingMatches,
    endlessWaveSessionMatches,
    unsettledWaveVerdict,
    ENDLESS_SEALED_WAVE_TTL_SECONDS,
    ENDLESS_WAVE_TTL_SECONDS,
    type EndlessSealedWave,
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
        if (!enforceRateLimit(req, res, 'endless-wave-start-preauth', (40) * 20, 60_000)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your tower run.' });
        if (!enforceRateLimit(req, res, 'endless-wave-start', 40, 60_000, identity.admin ? playerName : identity.name)) return;
        if (!identity.admin && await findTowerBattleStartConflict([playerName])) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }

        const runToken = typeof body.runToken === 'string' && /^[A-Za-z0-9]{16,96}$/.test(body.runToken) ? body.runToken : '';
        const saveKey = `save:${playerName}`;
        const changed = () => ({ ok: false as const, error: 'Your tower run changed. Please retry.', errorCode: 'endless-wave-conflict' });
        // The run mutator takes this same save lock. Read its current run only
        // after acquiring it, then take the wave lock in save -> wave order.
        // Solo-PvE action/abandon releases its session lock before save settlement.
        const started = await withKvLock(saveKey, async () => {
            const rawSave = await kv.get<Record<string, unknown>>(saveKey);
            const save = await augmentSaveWithForgedDefs(rawSave);
            const char = save?.character as Record<string, unknown> | undefined;
            if (!save || !char) return { ok: false as const, status: 404, error: 'Player save not found.' };
            const run = char.endlessTowerRun && typeof char.endlessTowerRun === 'object' ? char.endlessTowerRun as EndlessRun : null;
            if (!run || !runToken || run.runToken !== runToken) return { ok: false as const, error: 'No matching Endless Tower run.' };
            const wave = Math.max(1, Math.floor(Number(run.wave) || 1));
            const activeKey = endlessActiveWaveKey(playerName, runToken);
            const sealedKey = endlessSealedWaveKey(playerName, runToken);
            return withKvLock(activeKey, async () => {
                const active = await kv.get<{ runId: string; wave: number }>(activeKey);
                const sealed = await kv.get<EndlessSealedWave>(sealedKey);
                if (active?.runId && active.wave === wave) {
                    const priorBinding = await kv.get<ReturnType<typeof createEndlessWaveBinding>>(endlessWaveBindingKey(active.runId));
                    const priorSession = await readSoloPveSession(active.runId);
                    if (endlessWaveBindingMatches(priorBinding, playerName, runToken, wave, active.runId)
                        && priorBinding.status === 'active' && endlessWaveSessionMatches(priorSession, priorBinding)) {
                        // Older starts published the marker last. Repair that
                        // interruption before returning a playable/resumable wave.
                        if (sealed?.runId !== active.runId || sealed.wave !== wave) {
                            if (sealed && sealed.wave >= wave) return changed();
                            if (!kv.compareSetMany) throw new Error('Endless wave publication requires atomic storage.');
                            if (!(await kv.compareSetMany([
                                { op: 'assert', key: saveKey, expected: rawSave },
                                { op: 'assert', key: endlessWaveBindingKey(active.runId), expected: priorBinding },
                                { op: 'assert', key: soloPveSessionKey(active.runId), expected: priorSession },
                                { op: 'cas', key: sealedKey, expected: sealed, value: { runId: active.runId, wave }, ex: ENDLESS_SEALED_WAVE_TTL_SECONDS },
                            ]))) return changed();
                        }
                        await repairSoloPveSessionPublication(active.runId);
                        return { ok: true as const, runId: active.runId, wave, session: priorSession, resumed: true };
                    }
                }

                // A sealed wave of THIS number that was walked away from (not resumable
                // above) cannot be re-sealed for a fresh try: a lost wave ends the run.
                if (sealed?.runId) {
                    const verdict = unsettledWaveVerdict(sealed, wave, await readSoloPveSession(sealed.runId));
                    if (verdict === 'won-unsettled' || verdict === 'in-progress') {
                        return { ok: false as const, error: 'Settle your current wave first.', errorCode: 'endless-wave-unsettled' };
                    }
                    if (verdict === 'lost') {
                        return { ok: false as const, error: 'Your last wave was left unfinished and counts as lost. Abandon this run to start a new one.', errorCode: 'endless-wave-lost' };
                    }
                }

                // Every fight this player is holding, an earlier wave included, is
                // settled before this wave is sealed from the save
                // (api/pve/_held-fights.ts).
                const held = await settleHeldFights(playerName);
                if (!held.ok) return { ok: false as const, error: held.error, errorCode: held.reason };
                // Keep the exact stored row separate from its augmented combat
                // projection: the atomic publication asserts only the raw source.
                const sealRawSave = await kv.get<Record<string, unknown>>(saveKey);
                const sealSave = await augmentSaveWithForgedDefs(sealRawSave);
                const sealChar = sealSave?.character as Record<string, unknown> | undefined;
                const currentRun = sealChar?.endlessTowerRun as EndlessRun | null | undefined;
                if (!sealSave || !sealChar || !currentRun || currentRun.runToken !== runToken || currentRun.wave !== wave) return changed();

                // Resuming the wave already on the board (above) stays open; sealing
                // a NEW one while admitted does not. The wave seeds from the save's
                // own HP, so it would start a knocked-out fighter at zero.
                if (!identity.admin && isIncapacitated(sealChar)) {
                    return { ok: false as const, error: 'You are in the hospital. Recover before starting a fight.', errorCode: 'hospitalized' };
                }
                const runId = endlessWaveRunId();
                const now = Date.now();
                const built = buildEndlessWaveEncounter({
                    playerName,
                    save: sealSave,
                    runToken,
                    wave,
                    playerLevel: Math.max(1, Math.floor(Number(sealChar.level) || 1)),
                    runId,
                    now,
                    admin: await loadAdminCombatContent(),
                });
                if (!built) return { ok: false as const, error: 'No Endless Tower opponent could be sealed.' };

                // No session may become playable without its banking guard. A
                // rejected/failed batch leaves no phantom lost wave and no partial
                // publication. The source assert also fences an expired save lease.
                if (!kv.compareSetMany) throw new Error('Endless wave publication requires atomic storage.');
                if (!(await kv.compareSetMany([
                    { op: 'assert', key: saveKey, expected: sealRawSave },
                    { op: 'cas', key: soloPveSessionKey(runId), expected: null, value: built.session, ex: soloPveRowTtlSeconds(built.session) },
                    { op: 'cas', key: endlessWaveBindingKey(runId), expected: null,
                        value: createEndlessWaveBinding({ runId, playerName, runToken, wave, opponentId: built.opponentId, now }), ex: ENDLESS_WAVE_TTL_SECONDS },
                    { op: 'cas', key: activeKey, expected: active, value: { runId, wave }, ex: ENDLESS_WAVE_TTL_SECONDS },
                    { op: 'cas', key: sealedKey, expected: sealed, value: { runId, wave }, ex: ENDLESS_SEALED_WAVE_TTL_SECONDS },
                ]))) return changed();
                // Projection/held-fight publication is repairable on the resume
                // path; never rewrite a session whose first move already landed.
                await repairSoloPveSessionPublication(runId);
                return { ok: true as const, runId, wave, session: built.session, resumed: false };
            }, { failClosed: true });
        }, { failClosed: true });
        if (!started.ok) return res.status(('status' in started ? started.status : undefined) ?? 409).json({ error: started.error, ...('errorCode' in started ? { errorCode: started.errorCode } : {}) });
        return res.status(200).json(started);
    } catch (err) {
        console.error('[endless/wave-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
