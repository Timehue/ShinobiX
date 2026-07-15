import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { cors, parseJsonBody } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { getIo } from '../_realtime/socket.js';
import { toPlayerRecord } from '../_realtime/presence-input.js';
import { sectorExitById, type SectorExit } from '../../shared/sector-links.js';
import type { OnlinePlayer } from '../_realtime/types.js';

// Intentional UX contract: travel is a short loading mask, not a distance tax.
// The server mints the timer so clients cannot claim an arbitrary destination
// or a permanent untouchable window through presence frames.
export const WORLD_TRAVEL_MS = 3_000;

export function isPlayableWorldSector(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && (value === 0 || value === 99 || (value >= 1 && value <= 60));
}

export type EdgeTravelInput = {
    originSector: number;
    destinationSector: number;
    exitId: string;
};

export function edgeTravelExit(
    player: Pick<OnlinePlayer, 'sector' | 'tile'>,
    input: EdgeTravelInput,
): SectorExit | null {
    if (player.sector !== input.originSector) return null;
    const exit = sectorExitById(player.sector, input.exitId);
    if (!exit || exit.destinationSector !== input.destinationSector) return null;
    if (player.tile !== exit.tile) return null;
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
    if (mode === 'edge') {
        const exit = edgeTravelExit(player, {
            originSector: Number(body.originSector),
            destinationSector,
            exitId: String(body.exitId ?? ''),
        });
        if (!exit) {
            return res.status(409).json({ error: 'Move onto that road exit before crossing sectors.' });
        }
        arrivalTile = exit.destinationTile;
    }
    if (player.sector === destinationSector) {
        return res.status(200).json({ ok: true, destinationSector, arrivalAt: Date.now(), arrivalTile });
    }

    const arrivalAt = Date.now() + WORLD_TRAVEL_MS;
    const started = onlineStore.startTravel(identity.name, destinationSector, arrivalAt);
    if (!started) return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
    getIo()?.to(`sector:${started.sector}`).emit('presence:update', {
        sector: started.sector,
        player: toPlayerRecord(started),
    });

    return res.status(200).json({ ok: true, destinationSector, arrivalAt, arrivalTile });
}
