import { useEffect, useRef } from "react";
import type { Screen } from "../types/core";
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY, mintBattleId, postBattleLock } from "../lib/battle-save";

// Headless compatibility child for the remaining non-session battle screens
// (currently StoryBoss and the Hollow Gate tile seal). Server-sealed Solo PvE,
// PvP, and Tower hosts recover from their own session stores and do not use this
// component as combat authority. An existing client marker is adopted only so
// the matching legacy lock is cleared when its screen resolves.
export function BattleLockKeeper({ active, kind, screen, playerName }: { active: boolean; kind: string; screen: Screen; playerName: string }) {
    // Fires once per active-transition; lockedRef guards against the (mid-fight
    // stable) kind/screen/playerName deps re-running the effect and double-firing.
    const lockedRef = useRef(false);
    useEffect(() => {
        if (active && !lockedRef.current) {
            lockedRef.current = true;
            let battleId = "";
            try { battleId = localStorage.getItem(BATTLE_LOCK_ID_KEY) ?? ""; } catch { /* ignore */ }
            if (!battleId) {
                battleId = mintBattleId();
                try { localStorage.setItem(BATTLE_LOCK_ID_KEY, battleId); } catch { /* ignore */ }
            }
            void postBattleLock({ action: "start", playerName, battleId, kind, screen });
        } else if (!active && lockedRef.current) {
            lockedRef.current = false;
            let battleId = "";
            try {
                battleId = localStorage.getItem(BATTLE_LOCK_ID_KEY) ?? "";
                localStorage.removeItem(BATTLE_LOCK_ID_KEY);
                // Mark the fight as ended locally so that if the network resolve
                // below fails, a later boot retries the clear instead of treating
                // the leftover lock as a cleared-state loss.
                if (battleId) localStorage.setItem(BATTLE_LOCK_RESOLVED_KEY, battleId);
            } catch { /* ignore */ }
            if (battleId) void postBattleLock({ action: "resolve", playerName, battleId });
        }
    }, [active, kind, screen, playerName]);
    return null;
}
