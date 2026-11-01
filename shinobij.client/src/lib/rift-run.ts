/*
 * rift-run: the data-free run config for Hollow Gate rifts.
 *
 * Split out of lib/hollow-rifts.ts so the App entry bundle (which needs only
 * riftEventConfig) does NOT pull the rift CONTENT catalog (data/hollow-rifts.ts,
 * ~40KB of VN text) into every player's initial download. The server calls live
 * in lib/rift-server for the same reason. lib/hollow-rifts re-exports both for
 * its (lazy) importers.
 */
import type { HollowGateEventConfig } from "../types/character";
import type { HollowRift } from "../data/hollow-rifts";

/** The scaled event-gate config for a rift (short floors, themed boss, free
 *  entry). Fed straight into the existing enterHollowGateShrine path. The run's
 *  variant.id = the rift id, which the App completion hook keys off. */
export function riftEventConfig(rift: HollowRift): HollowGateEventConfig {
    return {
        id: rift.id,
        label: `${rift.bossName} Rift`,
        maxFloor: rift.floors,
        width: rift.boardWidth,
        height: rift.boardHeight,
        bossAiId: rift.bossAiId,
        bossName: rift.bossName,
        keyCost: 0,          // quest-granted, free entry
        requiresUnlock: false,
        active: true,
    };
}
