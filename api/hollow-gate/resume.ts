import { recoverHollowGatePendingOperation } from './_pending-operation.js';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    AUGMENT_CATALOG,
    augmentDisplay,
    hollowGateRunKey,
    hollowGateRunsEnabled,
    type HollowGateRunToken,
} from './_run-token.js';
import { hollowGateCombatBindingKey, type HollowGateCombatBinding } from './_combat-session.js';
import { hollowGateEncounterRecovery } from './_encounter-recovery.js';

/*
 * /api/hollow-gate/resume  — POST only
 *
 * The live run as the server holds it, so a browser that reloaded mid-run can
 * rebuild its board. The shrine board never reaches the save (the autosave does
 * not run inside the shrine, and a real save is too large for the unload save),
 * so the save keeps only a board-less projection. Everything the board needs is
 * sealed here instead: the floor and its manifest, position, resources, the
 * chosen augment, the encounters and events already resolved, the tiles already
 * stepped on, and any open fight with its mode.
 *
 * READ-ONLY apart from the pending-operation repair every run endpoint performs
 * under the run lock. The run is found from the SAVE's own pointer, never from
 * the request, so a player can only ever resume their own live run. Nothing here
 * is a reward: the seed and offers were already sent at start, and no reward
 * multiplier or ledger amount leaves the server.
 * Body: { playerName }.
 */

type SavedCharacter = {
    hollowGateRun?: { runToken?: unknown } | null;
    lastHollowGateStart?: { token?: unknown } | null;
    redeemedHollowGateRuns?: unknown;
};

/** The save's pointer to its live run: the projection first, then the start marker. */
export function hollowGateLiveTokenOf(character: SavedCharacter | null | undefined): string {
    const projected = character?.hollowGateRun?.runToken;
    if (typeof projected === 'string' && projected) return projected.slice(0, 64);
    const marker = character?.lastHollowGateStart?.token;
    return typeof marker === 'string' && marker ? marker.slice(0, 64) : '';
}

/** The resume payload for one live run, limited to its current floor. */
export function hollowGateResumeState(
    run: HollowGateRunToken,
    token: string,
    recovery: ReturnType<typeof hollowGateEncounterRecovery>,
) {
    const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
    const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
    const onFloor = (ids: unknown, prefix: string) => (Array.isArray(ids) ? ids : [])
        .filter((id): id is string => typeof id === 'string' && id.startsWith(prefix));
    return {
        token,
        seed: run.seed,
        floorDepth: run.floorDepth,
        floor,
        ...(run.variantId ? { variantId: run.variantId } : {}),
        ...(run.floorWidth != null ? { floorWidth: run.floorWidth } : {}),
        ...(run.floorHeight != null ? { floorHeight: run.floorHeight } : {}),
        ...(run.bossProfileId ? { bossProfileId: run.bossProfileId } : {}),
        ...(run.bossName ? { bossName: run.bossName } : {}),
        chosenAugmentId: run.chosenAugmentId ?? null,
        augmentOffers: (run.offeredAugmentIds ?? [])
            .map((id) => AUGMENT_CATALOG[id])
            .filter((offer): offer is NonNullable<typeof offer> => Boolean(offer))
            .map(augmentDisplay),
        position: run.position ?? null,
        keys: whole(run.keys),
        torch: whole(run.torch),
        threat: whole(run.threat),
        wardSteps: whole(run.wardSteps),
        divinerUsed: run.divinerUsed === true,
        secondWindArmed: run.secondWindArmed === true,
        resolvedEncounterIds: onFloor(run.resolvedEncounterIds, `${floor}:`),
        resolvedEventIds: onFloor(run.resolvedEventIds, `event:${floor}:`),
        visited: run.visitedTiles?.[String(floor)] ?? null,
        manifest: run.floorManifests?.[String(floor)] ?? null,
        activeCombat: recovery.activeCombat ?? null,
        pendingAmbush: recovery.pendingAmbush ?? null,
        entryCurrencies: run.entryCurrencies ?? {},
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!hollowGateRunsEnabled()) {
            return res.status(503).json({ error: 'Hollow Gate runs are temporarily unavailable until server settlement is complete.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-resume', 30, 60_000, identity.name))) return;

        const record = await kv.get<{ character?: SavedCharacter }>(`save:${playerName}`);
        const character = record?.character;
        const token = hollowGateLiveTokenOf(character);
        const redeemed = Array.isArray(character?.redeemedHollowGateRuns) ? character.redeemedHollowGateRuns : [];
        if (!token || redeemed.includes(token)) return res.status(200).json({ ok: true, live: false });

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await recoverHollowGatePendingOperation(kv, runKey, await kv.get<HollowGateRunToken>(runKey), playerName, token);
            if (!run || run.playerName !== playerName) return { ok: true, live: false };
            const active = run.activeEncounter;
            const binding = active ? await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(active.runId)) : null;
            const recovery = hollowGateEncounterRecovery(run, binding, playerName, token);
            return { ok: true, live: true, run: hollowGateResumeState(run, token, recovery) };
        }, { failClosed: true, ttlSec: 10 });
        return res.status(200).json(result);
    } catch (err) {
        console.error('[hollow-gate/resume]', safeLogValue(err));
        return res.status(500).json({ error: 'The Hollow Gate run could not be read.' });
    }
}
