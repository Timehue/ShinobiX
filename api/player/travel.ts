import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors, parseJsonBody } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { getIo } from '../_realtime/socket.js';
import { toPlayerRecord } from '../_realtime/presence-input.js';
import { sectorExitById, type SectorExit } from '../../shared/sector-links.js';
import { clearTravelLease, setTravelLease } from '../_realtime/travel-lease.js';

// Intentional UX contract: travel is a short loading mask, not a distance tax.
// The server mints the timer so clients cannot claim an arbitrary destination
// or a permanent untouchable window through presence frames.
// `arrivalAt` is an absolute deadline on THIS clock, so it is only meaningful
// to the server (lease, presence, attackability). Responses also carry the
// duration, because a client that subtracts its own Date.now() from arrivalAt
// turns any clock drift between the two machines into the mask it shows.
export const WORLD_TRAVEL_MS = 3_000;

// Walking across a road exit into the ADJACENT sector is INSTANT (owner call:
// walking is free movement; only map fast-travel wears the timed mask). The
// lease is still minted with arrivalAt = now so every arrival keeps flowing
// through the same authoritative machinery — presence settle, anti-teleport,
// footfall — and the battle lock + the exit-tile check + the 30/min rate limit
// remain the real guards. WORLD_TRAVEL_EDGE_MS is a server dial to reintroduce
// a delay without a code change if live feel ever wants one (0..WORLD_TRAVEL_MS).
const EDGE_MS_RAW = Number(process.env.WORLD_TRAVEL_EDGE_MS ?? 0);
export const WORLD_TRAVEL_EDGE_MS = Number.isFinite(EDGE_MS_RAW)
    ? Math.min(WORLD_TRAVEL_MS, Math.max(0, Math.floor(EDGE_MS_RAW)))
    : 0;

export function isPlayableWorldSector(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && (value === 0 || value === 99 || (value >= 1 && value <= 60));
}

export type EdgeTravelInput = {
    originSector: number;
    originTile: number;
    destinationSector: number;
    exitId: string;
};

export function edgeTravelExit(
    input: EdgeTravelInput,
): SectorExit | null {
    const exit = sectorExitById(input.originSector, input.exitId);
    if (!exit || exit.destinationSector !== input.destinationSector) return null;
    // Presence sector/tile snapshots can lag after reconnects and deployments,
    // and their socket/heartbeat updates travel separately from this request.
    // Validate the atomic crossing action itself against the shared road graph;
    // the authenticated player's presence is reconciled when travel starts.
    if (input.originTile !== exit.tile) return null;
    return exit;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
    if (!enforceRateLimit(req, res, 'player-travel', 30, 60_000, identity.name)) return;

    const parsed = parseJsonBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const body = parsed.body as Record<string, unknown>;
    const destinationSector = Number(body.destinationSector);
    if (!isPlayableWorldSector(destinationSector) || destinationSector === 0) {
        return res.status(400).json({ error: 'Invalid travel destination.' });
    }

    const player = onlineStore.get(identity.name);
    if (!player) return res.status(409).json({ error: 'World presence is not ready. Please try again.' });
    const mode = body.mode === 'edge' ? 'edge' : 'map';
    let arrivalTile: number | undefined;
    let edgeOriginSector: number | undefined;
    if (mode === 'edge') {
        const exit = edgeTravelExit({
            originSector: Number(body.originSector),
            originTile: Number(body.originTile),
            destinationSector,
            exitId: String(body.exitId ?? ''),
        });
        if (!exit) {
            return res.status(409).json({ error: 'Move onto that road exit before crossing sectors.' });
        }
        arrivalTile = exit.destinationTile;
        edgeOriginSector = exit.sector;
    }
    if (player.sector === destinationSector) {
        return res.status(200).json({ ok: true, destinationSector, arrivalAt: Date.now(), travelMs: 0, arrivalTile });
    }

    const travelMs = mode === 'edge' ? WORLD_TRAVEL_EDGE_MS : WORLD_TRAVEL_MS;
    const arrivalAt = Date.now() + travelMs;
    const started = onlineStore.startTravel(identity.name, destinationSector, arrivalAt, edgeOriginSector, arrivalTile);
    if (!started) return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
    try {
        await setTravelLease(identity.name, {
            originSector: started.sector,
            destinationSector,
            arrivalAt,
            ...(arrivalTile === undefined ? {} : { arrivalTile }),
        });
    } catch (err) {
        onlineStore.cancelTravel(identity.name, arrivalAt);
        await clearTravelLease(identity.name).catch(() => undefined);
        console.error('[player-travel] could not persist travel lease:', (err as Error).message);
        return res.status(503).json({ error: 'Travel could not be secured. Please try again.' });
    }
    getIo()?.to(`sector:${started.sector}`).emit('presence:update', {
        sector: started.sector,
        player: toPlayerRecord(started),
    });

    return res.status(200).json({ ok: true, destinationSector, arrivalAt, travelMs, arrivalTile });
}
