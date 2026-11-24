import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { COAST_WORLD, COAST_WORLD_VERSION, coastExits } from '../../shared/coast-world.js';
import { coastWalkSpace } from '../_coast-walk-space.js';
import { QUEST_SITES } from '../../shared/quest-sites.js';

/*
 * GET /api/coast/world
 *
 * The coast's map, for the client to draw: the atlas pins and roads, and each
 * open sector's floor mask, trails and sites. The client keeps no copy of this
 * (shared/coast-world.json would add its whole weight to the bundle), so the
 * server's own table is the only one and the two can never disagree.
 *
 * It is the same for every player and holds nothing private. Who may travel
 * where is decided by /api/player/travel, never by what is drawn.
 */

function buildPayload() {
    const sectors: Record<string, unknown> = {};
    for (const [id, layout] of Object.entries(COAST_WORLD.layouts)) {
        const sector = Number(id);
        sectors[id] = {
            name: layout.name,
            biome: layout.biome,
            contestable: layout.contestable,
            mask: layout.mask,
            floor: layout.floor ?? `s${sector}.webp`,
            exits: coastExits(sector).map(exit => ({
                id: exit.id, direction: exit.direction, tile: exit.tile,
                destinationSector: exit.destinationSector, destinationTile: exit.destinationTile,
            })),
            sites: Object.values(layout.sites).map(site => ({
                id: site.id, name: site.name, role: site.role, verb: site.verb, description: site.description,
                approach: site.approach, returnTile: site.returnTile, footprint: site.footprint,
                ...(site.floors.length ? { floors: site.floors } : {}),
                // The slip is where the boat home is boarded.
                ...(site.actions.includes('boat-crossing') ? { boat: true } : {}),
                ...(site.sprite ? { sprite: site.sprite } : {}),
                ...(site.scene ? { scene: site.scene } : {}),
                // A quest site is gathered at; the activity tells the client which tool to name.
                ...(QUEST_SITES[site.id] ? { gather: QUEST_SITES[site.id].activity } : {}),
            })),
        };
    }
    return {
        ok: true,
        version: COAST_WORLD_VERSION,
        atlas: { ...COAST_WORLD.atlas, image: 'atlas/hushstone-basin-v2.webp' },
        regions: COAST_WORLD.regions,
        points: COAST_WORLD.points,
        roads: COAST_WORLD.roads,
        space: coastWalkSpace,
        sectors,
    };
}

let payload: ReturnType<typeof buildPayload> | null = null;

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'coast-world', 20, 60_000, identity.name))) return;
    payload ??= buildPayload();
    // Per-session and short-lived: the map changes only with a deploy.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(payload);
}
