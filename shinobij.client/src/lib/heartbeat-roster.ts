// When does a heartbeat still need the full sector roster?
//
// The server used to return every sector-mate on every beat. With a live
// presence socket the client already receives joins, leaves, moves and state
// changes as they happen (lib/presence-socket.ts), so re-sending the whole
// sector each beat was pure load — O(N²) in a crowded sector. A beat that
// declares `socketLive` gets no `sectorMates` (api/player/heartbeat.ts).
//
// The client declares it only while it already holds a current roster for the
// sector it reports (lib/presence-store.ts records the last one adopted from
// either channel). So a beat asks for the roster when:
//   • the socket is down;
//   • it reports a sector this client has no roster for yet — a trip, a
//     reconnect, a server correction. The socket's own arrival snapshot can
//     be dropped when it lands before the client has switched sector;
//   • the roster is ROSTER_MAX_AGE_MS old and the tab is visible, as a safety
//     net for anything the socket missed. A hidden tab skips this one; the
//     beat that fires when it becomes visible asks instead.
// The rule reads state rather than counting beats, so a beat that is folded
// into one already in flight, or whose reply is discarded, leaves it unchanged.
import { getLastFullRoster } from "./presence-store";

export const ROSTER_MAX_AGE_MS = 60_000;

export type HeartbeatRosterInput = {
    /** The presence socket is connected. */
    socketLive: boolean;
    /** The sector this beat reports. */
    sector: number;
    /** document.visibilityState === "visible". */
    tabVisible: boolean;
};

export function heartbeatRosterFields(input: HeartbeatRosterInput, now: number = Date.now()): { socketLive?: true } {
    if (!input.socketLive) return {};
    const last = getLastFullRoster();
    if (!last || last.sector !== input.sector) return {};
    if (input.tabVisible && now - last.at >= ROSTER_MAX_AGE_MS) return {};
    return { socketLive: true };
}
