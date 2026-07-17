"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORLD_TRAVEL_MS = void 0;
exports.isPlayableWorldSector = isPlayableWorldSector;
exports.edgeTravelExit = edgeTravelExit;
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const socket_js_1 = require("../_realtime/socket.js");
const presence_input_js_1 = require("../_realtime/presence-input.js");
const sector_links_js_1 = require("../../shared/sector-links.js");
const travel_lease_js_1 = require("../_realtime/travel-lease.js");
// Intentional UX contract: travel is a short loading mask, not a distance tax.
// The server mints the timer so clients cannot claim an arbitrary destination
// or a permanent untouchable window through presence frames.
// `arrivalAt` is an absolute deadline on THIS clock, so it is only meaningful
// to the server (lease, presence, attackability). Responses also carry the
// duration, because a client that subtracts its own Date.now() from arrivalAt
// turns any clock drift between the two machines into the mask it shows.
exports.WORLD_TRAVEL_MS = 3_000;
function isPlayableWorldSector(value) {
    return typeof value === 'number'
        && Number.isInteger(value)
        && (value === 0 || value === 99 || (value >= 1 && value <= 60));
}
function edgeTravelExit(input) {
    const exit = (0, sector_links_js_1.sectorExitById)(input.originSector, input.exitId);
    if (!exit || exit.destinationSector !== input.destinationSector)
        return null;
    // Presence sector/tile snapshots can lag after reconnects and deployments,
    // and their socket/heartbeat updates travel separately from this request.
    // Validate the atomic crossing action itself against the shared road graph;
    // the authenticated player's presence is reconciled when travel starts.
    if (input.originTile !== exit.tile)
        return null;
    return exit;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity || identity.admin)
        return res.status(401).json({ error: 'Player authentication required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'player-travel', 30, 60_000, identity.name))
        return;
    const parsed = (0, _utils_js_1.parseJsonBody)(req.body);
    if (!parsed.ok)
        return res.status(400).json({ error: parsed.error });
    const body = parsed.body;
    const destinationSector = Number(body.destinationSector);
    if (!isPlayableWorldSector(destinationSector) || destinationSector === 0) {
        return res.status(400).json({ error: 'Invalid travel destination.' });
    }
    const player = online_store_js_1.onlineStore.get(identity.name);
    if (!player)
        return res.status(409).json({ error: 'World presence is not ready. Please try again.' });
    const mode = body.mode === 'edge' ? 'edge' : 'map';
    let arrivalTile;
    let edgeOriginSector;
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
    const arrivalAt = Date.now() + exports.WORLD_TRAVEL_MS;
    const started = online_store_js_1.onlineStore.startTravel(identity.name, destinationSector, arrivalAt, edgeOriginSector, arrivalTile);
    if (!started)
        return res.status(409).json({ error: 'You cannot travel while moving or fighting.' });
    try {
        await (0, travel_lease_js_1.setTravelLease)(identity.name, {
            originSector: started.sector,
            destinationSector,
            arrivalAt,
            ...(arrivalTile === undefined ? {} : { arrivalTile }),
        });
    }
    catch (err) {
        online_store_js_1.onlineStore.cancelTravel(identity.name, arrivalAt);
        await (0, travel_lease_js_1.clearTravelLease)(identity.name).catch(() => undefined);
        console.error('[player-travel] could not persist travel lease:', err.message);
        return res.status(503).json({ error: 'Travel could not be secured. Please try again.' });
    }
    (0, socket_js_1.getIo)()?.to(`sector:${started.sector}`).emit('presence:update', {
        sector: started.sector,
        player: (0, presence_input_js_1.toPlayerRecord)(started),
    });
    return res.status(200).json({ ok: true, destinationSector, arrivalAt, travelMs: exports.WORLD_TRAVEL_MS, arrivalTile });
}
