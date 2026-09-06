import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors, parseJsonBody } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { getIo } from '../_realtime/socket.js';
import { toPlayerRecord } from '../_realtime/presence-input.js';
import { randomUUID } from 'node:crypto';
import { sectorExitById, travelArrivalTile, SECTOR_TILE_COUNT, type SectorExit } from '../../shared/sector-links.js';
import { isWildSector } from '../../shared/sector-geo.js';
import { clearTravelLeaseIfSame, setTravelLease, TravelLeaseHeldError, type TravelLease } from '../_realtime/travel-lease.js';

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
        && (value === 0 || value === 99 || isWildSector(value));
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

/**
 * How far the server's last-known tile may sit from a road exit the client
 * says it is standing on. Tile movement reaches the server on a separate,
 * throttled channel (socket `presence:move`, ~80ms; heartbeat, 1s), so the
 * server tile can trail an honest player by a step or two — but a client on
 * the far side of the 12x12 board is not "on the exit". Three tiles tolerates
 * the lag without opening the board.
 */
export const EDGE_ORIGIN_TILE_TOLERANCE = 3;
const SECTOR_GRID_WIDTH = Math.round(Math.sqrt(SECTOR_TILE_COUNT));

export function tileDistance(a: number, b: number): number {
    const ax = a % SECTOR_GRID_WIDTH, ay = Math.floor(a / SECTOR_GRID_WIDTH);
    const bx = b % SECTOR_GRID_WIDTH, by = Math.floor(b / SECTOR_GRID_WIDTH);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Whether the server's last-known tile (if any) is close enough to the exit. */
export function edgeOriginTileAllowed(serverTile: number | undefined, exitTile: number): boolean {
    if (serverTile === undefined || !Number.isFinite(serverTile)) return true;
    return tileDistance(serverTile, exitTile) <= EDGE_ORIGIN_TILE_TOLERANCE;
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
        // The origin is the SERVER's sector — lease-gated presence, never the
        // request body. The body used to be the only source, so a client in
        // sector 5 could name any road "from 30 to 31" and be leased across the
        // map. A body originSector is accepted only as a consistency claim.
        const claimedOrigin = Number(body.originSector);
        if (Number.isFinite(claimedOrigin) && claimedOrigin !== player.sector) {
            return res.status(409).json({ error: 'You are not in that sector.' });
        }
        const exit = edgeTravelExit({
            originSector: player.sector,
            originTile: Number(body.originTile),
            destinationSector,
            exitId: String(body.exitId ?? ''),
        });
        if (!exit || !edgeOriginTileAllowed(player.tile, exit.tile)) {
            return res.status(409).json({ error: 'Move onto that road exit before crossing sectors.' });
        }
        arrivalTile = exit.destinationTile;
        edgeOriginSector = exit.sector;
    } else {
        // A MAP jump arrives on the edge facing the sector it came from, same as
        // a road crossing — derived from the shared topology so the server seals
        // the value the client shows. Before this the server left arrivalTile
        // undefined for map travel, so settleMaturedTravel carried the player's
        // OLD sector coordinate into the new sector and everyone else in it saw
        // them standing at a stale tile until their next heartbeat landed.
        // ONE definition, shared with the client (see travelArrivalTile): the
        // traveller's screen and every observer in the destination must place
        // them on the same tile. Null — no origin to honour, e.g. leaving a
        // village at sector 0 — keeps the old behaviour of naming no tile.
        arrivalTile = travelArrivalTile(player.sector, destinationSector) ?? undefined;
    }
    if (player.sector === destinationSector) {
        return res.status(200).json({ ok: true, destinationSector, arrivalAt: Date.now(), travelMs: 0, arrivalTile });
    }

    const travelMs = mode === 'edge' ? WORLD_TRAVEL_EDGE_MS : WORLD_TRAVEL_MS;
    const now = Date.now();
    const arrivalAt = now + travelMs;
    // Capture the origin BEFORE starting travel. An instant edge crossing has
    // arrivalAt === now, so startTravel's own settle fires inside that call and
    // moves the (mutated in place) player to the DESTINATION — reading
    // `started.sector` afterwards recorded a lease whose originSector equalled
    // its destinationSector, i.e. a lease that says the player never left.
    // Harmless while arrivalAt is already past (every reader takes the
    // destination branch), but the field should mean what its name says.
    const originSector = edgeOriginSector ?? player.sector;
    // The same admission startTravel applies, checked BEFORE the durable write
    // so a player who cannot travel is refused without touching storage.
    if (player.inBattle || (player.travelingUntil !== undefined && player.travelingUntil > now)) {
        return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
    }
    const lease: TravelLease = {
        originSector,
        destinationSector,
        arrivalAt,
        ...(arrivalTile === undefined ? {} : { arrivalTile }),
        moveId: randomUUID().replace(/-/g, ''),
    };
    // Secure the durable lease FIRST, then publish the move to live memory.
    // The old order mutated memory first and rolled back on a failed lease
    // write — but an instant edge crossing matures inside startTravel and
    // clears `travelingUntil` on the spot, so cancelTravel (which keys off that
    // timestamp) could not undo it: the handler answered 503 while the player
    // had already moved in memory, unrecorded. Now a failed write moves nothing.
    try {
        await setTravelLease(identity.name, lease, now);
    } catch (err) {
        if (err instanceof TravelLeaseHeldError) {
            return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
        }
        console.error('[player-travel] could not persist travel lease:', (err as Error).message);
        return res.status(503).json({ error: 'Travel could not be secured. Please try again.' });
    }
    const started = onlineStore.startTravel(identity.name, destinationSector, arrivalAt, edgeOriginSector, arrivalTile);
    if (!started) {
        // Lost a race with another admission between the check and the start.
        // Compare-and-delete: only THIS journey's lease is removed, never the
        // one the winner secured.
        await clearTravelLeaseIfSame(identity.name, lease).catch(() => undefined);
        return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
    }
    getIo()?.to(`sector:${started.sector}`).emit('presence:update', {
        sector: started.sector,
        player: toPlayerRecord(started),
    });

    return res.status(200).json({ ok: true, destinationSector, arrivalAt, travelMs, arrivalTile });
}
