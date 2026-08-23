import { useCallback, useState } from "react";
import type { Character } from "../types/character";
import { BattleTowerFight } from "../screens/BattleTowerFight";
import { TowerPvpPanel } from "./TowerPvpPanel";
import {
    fetchTowerPvpSession,
    settleAndLeaveTowerPvp,
    submitTowerPvpActionWithLostResponseRetry,
    type TowerPvpMatch,
} from "../lib/tower-pvp-api";
import { setTowerPvpMatchId } from "../lib/screen-guards";

/*
 * Public 2v2 Team Arena — queue and board in one self-contained section.
 *
 * This lives in the BATTLE ARENA, not in Battle Towers. The Towers are the
 * cooperative PvE climb; a public player-versus-player queue has no business
 * sitting inside them. The engine underneath is still the shared N-actor
 * session (api/towers/_pvp-*), because that is what puts four fighters on the
 * canonical 12x10 PvP grid — but that is an implementation detail, not a reason
 * to file the mode under Towers in the UI.
 *
 * No recovery breadcrumb is needed to re-enter a live match: TowerPvpPanel polls
 * authoritative presence and re-fires onEnter for an active or finished match,
 * so a refresh mid-fight lands back on the board on its own. The run key is
 * still written so the nav lock knows a fight is in progress.
 */
export function TeamArenaSection({ character, sharedImages }: {
    character: Character;
    sharedImages?: Record<string, string>;
}) {
    const [match, setMatch] = useState<TowerPvpMatch | null>(null);

    const lockNav = useCallback((matchId: string | null) => {
        setTowerPvpMatchId(matchId);
    }, []);

    const exitBoard = useCallback(() => {
        setTowerPvpMatchId(null);
        setMatch(null);
    }, []);

    if (match) {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                runId={match.matchId}
                initialSession={match.combat}
                stateFn={fetchTowerPvpSession}
                actionRetryFn={submitTowerPvpActionWithLostResponseRetry}
                settleFn={settleAndLeaveTowerPvp}
                settleOnAnyDone
                variant="team-pvp"
                onExit={exitBoard}
            />
        );
    }

    return (
        <TowerPvpPanel
            playerName={character.name}
            unlocked
            onMatchLockChange={lockNav}
            onEnter={setMatch}
        />
    );
}
