import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, safeName } from '../_utils.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    cleanDungeonProbeRequestId,
    freeDungeonProbeReceipt,
    mutateDungeonRun,
    resolveFreeDungeonMiss,
    unresolvedFreeDungeonMiss,
} from './_run.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { kv } from '../_storage.js';
import { cleanPetEncounterPointer, petEncounterActiveKey } from '../pet/_encounter-pointer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player.' });
        const identity = await authedPlayerOrAdmin(req, playerName); if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your dungeon run.' });
        const action = typeof body.action === 'string' ? body.action : '';
        const requestId = cleanDungeonProbeRequestId(body.requestId);
        if (action === 'probe-free' && !requestId && !identity.admin) {
            return res.status(400).json({ error: 'A stable dungeon probe requestId is required.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, action === 'probe-free' ? 'dungeon-probe' : 'dungeon-run', action === 'probe-free' ? 180 : 20, 60_000, identity.name))) return;
        const result = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ character }) => {
            const activeBefore = character.activeDungeonRun && typeof character.activeDungeonRun === 'object'
                ? character.activeDungeonRun as Record<string, unknown>
                : null;
            const priorProbe = action === 'probe-free' ? freeDungeonProbeReceipt(character, requestId) : null;
            const pendingMiss = action === 'probe-free' ? unresolvedFreeDungeonMiss(character) : null;
            const activePet = action === 'probe-free'
                ? cleanPetEncounterPointer(await kv.get(petEncounterActiveKey(playerName)))
                : null;
            if (action === 'probe-free' && activePet?.playerName.toLowerCase() === playerName.toLowerCase()) {
                // One discovery operation owns the pipeline. If another device
                // starts at the dungeon probe while an older pet result awaits,
                // rebound directly to that pet authority instead of minting a
                // second dungeon miss that would deadlock the two request IDs.
                const reconciled = pendingMiss
                    ? resolveFreeDungeonMiss(character, pendingMiss.requestId)
                    : character;
                return {
                    ok: true as const,
                    character: reconciled,
                    value: {
                        token: '',
                        found: false,
                        alreadyApplied: true,
                        requestId: activePet.requestId,
                        sector: activePet.sector,
                        handoff: 'pet',
                    },
                    write: reconciled !== character,
                };
            }
            // A committed discovery replays from its sealed sector even after
            // movement or a reload. Presence is required only for a NEW probe.
            if (action === 'probe-free' && !identity.admin
                && !(activeBefore?.entry === 'free' && activeBefore.token)) {
                if (priorProbe || pendingMiss) {
                    // Exact hit/miss replay is already presence-authorized by
                    // the original probe and must survive movement/reconnect.
                } else {
                const presenceBlock = sectorPresenceBlock(playerName, body.sector);
                if (presenceBlock) return { ok: false as const, status: presenceBlock.status, error: presenceBlock.error };
                }
            }
            const out = mutateDungeonRun(character, body.action, body.token, randomUUID().replaceAll('-', ''), Date.now(), Math.random(), body.sector, requestId || `admin_${randomUUID().replaceAll('-', '')}`);
            if (!out.ok) return { ok: false as const, status: 409, error: out.reason };
            const activeAfter = out.character.activeDungeonRun && typeof out.character.activeDungeonRun === 'object'
                ? out.character.activeDungeonRun as Record<string, unknown>
                : null;
            const authoritativeSector = action === 'probe-free' && activeAfter?.entry === 'free'
                ? Math.floor(Number(activeAfter.sector))
                : action === 'probe-free' && 'sector' in out && Number.isSafeInteger(Number(out.sector))
                    ? Math.floor(Number(out.sector))
                : action === 'probe-free' && priorProbe
                    ? priorProbe.sector
                : action === 'probe-free'
                    ? Math.floor(Number(body.sector))
                    : undefined;
            return { ok: true as const, character: out.character, value: {
                token: out.token,
                found: 'found' in out ? out.found : undefined,
                alreadyApplied: out.alreadyApplied,
                ...('requestId' in out && out.requestId ? { requestId: out.requestId } : {}),
                ...('resolved' in out ? { resolved: out.resolved } : {}),
                ...(activeAfter?.entry === 'free' && typeof activeAfter.exploreReceiptId === 'string'
                    ? { exploreReceiptId: activeAfter.exploreReceiptId }
                    : {}),
                ...(Number.isSafeInteger(authoritativeSector) ? { sector: authoritativeSector } : {}),
            } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[dungeon/run]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
