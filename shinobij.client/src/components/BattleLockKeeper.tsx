import { useEffect, useRef } from "react";
import type { Screen } from "../types/core";
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY, mintBattleId, postBattleLock } from "../lib/battle-save";

// Headless child (mounts inside a battle screen) that registers/clears the
// server battle lock as the fight starts and ends. Isolated like
// ArenaBattlePersister so the parent's hook count is untouched. `active` is true
// only while an unresolved, non-PvP fight is in progress (PvP has its own
// server session). It adopts an existing battleId on resume (localStorage
// intact) so the eventual resolve clears the right lock.
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

// ── ArenaBattlePersister ─────────────────────────────────────────────────
// Headless child component (renders nothing) that serializes a PvE Arena
// battle to localStorage on each turn boundary and rehydrates it on mount.
//
// Lives as a SEPARATE component to keep its hooks isolated from Arena —
// previous attempts to put the hooks directly inside Arena tripped React
// error #310 (hook count mismatch) because Arena has 50+ existing hooks
// and the interaction was unstable. With this child, Arena's hook count
// is untouched: the persister has its own consistent hook footprint
// (2 useEffects), independent of the parent.
