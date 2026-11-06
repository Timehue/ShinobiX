import { useEffect, useRef } from "react";
import type { Screen } from "../types/core";
import { mintBattleId, postBattleLock } from "../lib/battle-save";
import { battleLockKeeperTransition, type BattleLockKeeperDeps, type BattleLockKeeperState } from "../lib/battle-lock-keeper";

// Reached per call: touching window.localStorage itself throws when storage is
// blocked, and the transition catches each call.
const browserStorage: BattleLockKeeperDeps["storage"] = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
};

// Headless compatibility child for the remaining non-session battle screens
// (currently StoryBoss and the Hollow Gate tile seal). Server-sealed Solo PvE,
// PvP, and Tower hosts recover from their own session stores and do not use this
// component as combat authority. An existing client marker is adopted only so
// the matching legacy lock is cleared when its screen resolves.
export function BattleLockKeeper({ active, kind, screen, playerName }: { active: boolean; kind: string; screen: Screen; playerName: string }) {
    // Fires once per active-transition; the ref guards against the (mid-fight
    // stable) kind/screen/playerName deps re-running the effect and double-firing.
    const stateRef = useRef<BattleLockKeeperState>({ locked: false, battleId: "" });
    const depsRef = useRef<BattleLockKeeperDeps>({ storage: browserStorage, mint: mintBattleId, post: () => undefined, playerName, kind, screen });
    // Declared before the transition effect so it always runs first.
    useEffect(() => {
        depsRef.current = { storage: browserStorage, mint: mintBattleId, post: (body) => { void postBattleLock(body); }, playerName, kind, screen };
    });
    useEffect(() => {
        stateRef.current = battleLockKeeperTransition(stateRef.current, active, depsRef.current);
    }, [active, kind, screen, playerName]);
    // Unmounting while locked ends the fight on this page too: a screen change
    // (StoryBoss's Forfeit sets the screen with the fight still live) or a
    // logout. The lock used to stay behind and hold the player "in battle" for
    // its one-hour expiry. A page unload runs no cleanup, and boot recovery
    // still owns that case (App reads the lock on the next load).
    useEffect(() => () => {
        stateRef.current = battleLockKeeperTransition(stateRef.current, false, depsRef.current);
    }, []);
    return null;
}
