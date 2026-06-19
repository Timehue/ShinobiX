import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { BattleTowersLobby } from "./BattleTowersLobby";
import { BattleTowerFight } from "./BattleTowerFight";
import type { TowerSession } from "../lib/towers-api";

// ─── Battle Towers (combined lobby ↔ fight) ───────────────────────────────────
// One screen wrapping the lobby and the fullscreen fight, so App.tsx only wires a
// single "battleTowers" screen. While a fight is live it sets a localStorage flag
// that screen-guards' isUnresolvedBattle reads (hasActiveTowerFight) to block
// leaving mid-fight — without the server BattleLockKeeper, so a refresh just drops
// back to Central with no penalty (the server tower:<runId> session persists).
export const TOWER_FIGHT_FLAG = "shinobix:towerFightActive";

export function BattleTowers({ character, onExit }: { character: Character; onExit: () => void }) {
    const [run, setRun] = useState<{ runId: string; session: TowerSession } | null>(null);

    useEffect(() => {
        try {
            if (run) localStorage.setItem(TOWER_FIGHT_FLAG, "1");
            else localStorage.removeItem(TOWER_FIGHT_FLAG);
        } catch { /* storage disabled */ }
        return () => { try { localStorage.removeItem(TOWER_FIGHT_FLAG); } catch { /* ignore */ } };
    }, [run]);

    if (run) {
        return (
            <BattleTowerFight
                character={character}
                runId={run.runId}
                initialSession={run.session}
                onExit={() => { setRun(null); onExit(); }}
            />
        );
    }
    return (
        <BattleTowersLobby
            character={character}
            onEnter={(runId, session) => setRun({ runId, session })}
            onBack={onExit}
        />
    );
}
