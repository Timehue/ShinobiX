// When does a heartbeat still need the full sector roster?
//
// The server used to return every sector-mate on every beat. With a live
// presence socket the client already receives joins, leaves, moves and state
// changes as they happen (lib/presence-socket.ts), so re-sending the whole
// sector each beat was pure load — O(N²) in a crowded sector. A beat that
// declares `socketLive` gets no `sectorMates` (api/player/heartbeat.ts), except
// that every ROSTER_RESYNC_EVERY_BEATS-th beat still asks for it as a safety
// resync, and every beat does while the socket is down.
export const ROSTER_RESYNC_EVERY_BEATS = 6;

let beatsWithoutRoster = 0;

export function heartbeatRosterFields(socketLive: boolean): { socketLive?: true } {
    if (!socketLive || beatsWithoutRoster >= ROSTER_RESYNC_EVERY_BEATS - 1) {
        beatsWithoutRoster = 0;
        return {};
    }
    beatsWithoutRoster += 1;
    return { socketLive: true };
}

/** Test-only. */
export function __resetHeartbeatRosterForTest(): void {
    beatsWithoutRoster = 0;
}
