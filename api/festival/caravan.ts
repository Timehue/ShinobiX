import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { safeLogValue } from '../_safe-log.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { recordEconomyTxn } from '../_economy.js';
import { FestivalError, festivalDay } from './_rally.js';
import { advanceCaravan, caravanProgress, departCaravan, requireCaravan } from './_caravan.js';
import { finishCaravanCombat, startCaravanCombat } from './_caravan-combat.js';
import { caravanDaily } from '../../shared/sunscar/caravan-contracts.js';
import { readSoloPveSession } from '../solo-pve/_store.js';
import { battleLockedFor } from '../_elapsed-state.js';
import { petEncounterActiveKey, petEncounterRequestKey, PET_ENCOUNTER_POINTER_TTL_SECONDS } from '../pet/_encounter-pointer.js';

async function finishPetTrail(player: string, runId: string, skip = false) {
    return await withKvLock(petEncounterActiveKey(player), async () => {
        return await mutatePlayerSave(player, async ({ character }) => {
            const { progress, run } = requireCaravan(character, runId);
            const pet = run.petEncounter;
            if (!pet) throw new FestivalError('There is no wild companion encounter to close.', 409);
            if (pet.state === 'resolved') return { ok: true, character, value: null, write: false };
            const key = petEncounterRequestKey(player, pet.requestId);
            const request = await kv.get<Record<string, unknown>>(key);
            const active = await kv.get<{ requestId?: string }>(petEncounterActiveKey(player));
            if (request && request.caravanRunId !== run.id || !request && (!skip || active?.requestId === pet.requestId)) throw new FestivalError('Follow the trail before moving on.', 409);
            if (request?.pet && !request.resolvedAt) throw new FestivalError('Befriend or leave the wild companion before continuing.', 409);
            if (request && !request.resolvedAt) {
                await kv.set(key, { ...request, resolvedAt: Date.now(), resolution: 'explored-miss' }, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
            }
            // Also repair an interrupted previous close after its receipt was saved.
            if (active?.requestId === pet.requestId) await kv.del(petEncounterActiveKey(player));
            pet.state = 'resolved';
            run.version++;
            run.updatedAt = Date.now();
            run.log.push({ nodeId: run.currentNodeId!, title: 'The wild trail', text: request?.resolution === 'befriended' ? 'The wild companion accepted your approach. Its new home follows the Pet Yard’s normal placement rules.' : 'The crew leaves the hollow undisturbed and returns to the road.', cargo: run.cargo, supplies: run.supplies, morale: run.morale });
            return { ok: true, character: { ...character, sunscarCaravan: progress }, value: null };
        });
    }, { failClosed: true });
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const body = req.method === 'GET' ? req.query ?? {} : typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const player = safeName(String(body.playerName ?? ''));
        if (!player) return res.status(400).json({ error: 'A player is required.' });
        const identity = await authedPlayerOrAdmin(req, player);
        if (!identity) return res.status(401).json({ error: 'Sign in to visit the contract board.' });
        if (!identity.admin && identity.name !== player) return res.status(403).json({ error: 'This expedition belongs to another player.' });
        if (!identity.admin && !await enforceRateLimitKv(req, res, 'sunscar-caravan', 60, 60_000, player, { strict: true })) return;
        const respond = (character: Record<string, unknown>, version?: number, extra: Record<string, unknown> = {}) => {
            const progress = caravanProgress(character);
            return res.status(200).json({ ok: true, progress, daily: caravanDaily(player, festivalDay(Date.now()), progress), serverNow: Date.now(),
                ...(version === undefined ? {} : { character, _saveVersion: version }), ...extra });
        };
        if (req.method === 'GET') {
            const save = await kv.get<{ character?: Record<string, unknown>; _saveVersion?: number }>(`save:${player}`);
            if (!save?.character) return res.status(404).json({ error: 'Your character could not be loaded.' });
            const progress = caravanProgress(save.character);
            // Reconnect repairs a terminal fight even when the tab closed before
            // its result overlay reported back to the expedition.
            if (progress.current?.status === 'combat' && progress.current.combat) {
                const session = await readSoloPveSession(progress.current.combat.sessionId);
                if (session?.status === 'done' || session && session.expiresAt <= Date.now()) {
                    const repaired = await finishCaravanCombat(player, progress.current.id);
                    if (!repaired.ok) return res.status(repaired.status).json({ error: repaired.error });
                    return respond(repaired.character, repaired._saveVersion);
                }
            }
            return respond(save.character, save._saveVersion);
        }
        if (body.action === 'combat') {
            const session = await startCaravanCombat(player, String(body.runId));
            const save = await kv.get<{ character: Record<string, unknown>; _saveVersion: number }>(`save:${player}`);
            if (!save) throw new FestivalError('Your expedition is saving. Retry.', 503);
            return respond(save.character, save._saveVersion, { session });
        }
        if (body.action === 'combat-result' || body.action === 'pet-return' || body.action === 'pet-skip') {
            const out = body.action === 'combat-result' ? await finishCaravanCombat(player, String(body.runId)) : await finishPetTrail(player, String(body.runId), body.action === 'pet-skip');
            if (!out.ok) return res.status(out.status).json({ error: out.error });
            return respond(out.character, out._saveVersion);
        }
        const out = await mutatePlayerSave<{ delta: number; requestId: string }>(player, async ({ character }) => {
            if (await battleLockedFor(player)) throw new FestivalError('Finish your active battle before moving the caravan.', 409);
            if (body.action === 'depart') {
                const current = caravanProgress(character).current;
                if (current && current.day === festivalDay(Date.now()) && current.contract.id === body.contractId && !current.result) return { ok: true, character, value: { delta: 0, requestId: current.id }, write: false };
                const next = departCaravan(character, player, body, Date.now());
                return { ok: true, character: next, value: { delta: 0, requestId: caravanProgress(next).current!.id } };
            }
            const result = advanceCaravan(character, body, Date.now());
            return { ok: true, character: result.character, value: { delta: Number(result.character.ryo || 0) - Number(character.ryo || 0), requestId: String(body.requestId) }, write: !result.replay };
        });
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        if (out.value.delta) await recordEconomyTxn({ txnId: `caravan:${out.value.requestId}`, player, currency: 'ryo', delta: out.value.delta, source: 'sunscar.caravan' });
        return respond(out.character, out._saveVersion);
    } catch (error) {
        if (error instanceof FestivalError) return res.status(error.status).json({ error: error.message });
        if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid expedition request.' });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'The caravan is saving. Retry your choice.' });
        console.error('[sunscar-caravan]', safeLogValue(error));
        return res.status(503).json({ error: 'The caravan office could not be reached. Your expedition is saved; retry to continue.' });
    }
}
