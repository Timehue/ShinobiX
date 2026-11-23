/*
 * The players in a coast sector, with the same rows and actions the home map gives them: Attack, and Spectate for a
 * player already fighting. A clan defending its coast sector scores only from these duels (api/coast/_land-duel.ts),
 * so a list with no Attack left a defence unable to score.
 *
 * Everything decisive is the server's: the attack refuses a player who is not in this sector, one inside their
 * clan's town (a safe zone), or one who is traveling or fighting, and the fight it opens seals the sector's own
 * ground and weather. A player in their town is not listed at all (they carry `stronghold`, as a shrine visitor does).
 * The coast keeps no sleeper camps in a list, so there is no Strike down here.
 */
import { useLiveSectorRoster, getLiveSectorRoster, useSectorRosterState, getSectorRosterState } from "../../lib/presence-store";
import { projectSectorPlayers, sectorPlayerRoster } from "../../lib/sector-player-roster";
import { useSectorPlayerAction } from "../../lib/use-sector-player-action";
import { isRecentlyStruckDown } from "../../lib/sleeper-kill";
import { useLiveCapabilities } from "../../lib/live-capabilities-context";
import { capabilityAdmissionAllowed, mutationAdmissionMessage } from "../../lib/live-capability-admission";
import { SectorNearby } from "../../components/SectorNearby";
import type { PlayerRecord } from "../../types/character";

export function CoastNearby({ sector, name, village, images = {}, present, attack, spectate }: {
    sector: number; name: string; village: string; images?: Record<string, string>; present: boolean;
    attack?: (target: PlayerRecord) => void | Promise<void>;
    spectate?: (target: PlayerRecord, isCurrent: () => boolean) => void | Promise<void>;
}) {
    const live = useLiveSectorRoster();
    const state = useSectorRosterState();
    const { mutationAvailability } = useLiveCapabilities();
    const rows = (from = live) => {
        const admission = mutationAvailability();
        const waiting = getSectorRosterState() !== "current" ? "Waiting for a current sector roster." : undefined;
        return projectSectorPlayers(sectorPlayerRoster({ sector, currentSector: sector, viewer: name, live: from, registered: [], recentlyStruckDown: isRecentlyStruckDown }),
            { sector, village, images, contest: null, spectateBlockedReason: waiting,
                blockedReason: waiting || (!attack ? "Attacking is unavailable here." : capabilityAdmissionAllowed(admission) ? undefined : mutationAdmissionMessage(admission)) });
    };
    const action = useSectorPlayerAction({ sector, present, rows: () => rows(getLiveSectorRoster()),
        attack: target => attack?.(target), strike: async () => { throw new Error("There is no camp to strike here."); },
        spectate: (target, isCurrent) => spectate?.(target, isCurrent) });
    // The home map's own roster markup; the coast has no sky forecast or road list under an empty roster.
    return <SectorNearby sector={sector} biome="central" players={rows()} present rosterState={state} action={action} onAction={action.run} conditions={false} />;
}
