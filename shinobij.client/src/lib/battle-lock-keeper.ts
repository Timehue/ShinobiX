import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY } from "./battle-save";

/** What BattleLockKeeper remembers between renders. */
export type BattleLockKeeperState = { locked: boolean; battleId: string };

export type BattleLockKeeperDeps = {
    /** localStorage, or a stand-in. Any call may throw (full or blocked storage). */
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    mint: () => string;
    post: (body: Record<string, unknown>) => void;
    playerName: string;
    kind: string;
    screen: string;
};

/**
 * One keeper transition: lock when the screen turns active, resolve when it
 * turns inactive, and nothing otherwise.
 *
 * The battle id is carried in `state` as well as localStorage. With
 * localStorage alone, a write it refused (full or blocked storage) left nothing
 * to read back at resolve time, so the resolve was skipped and the server
 * marker held the player "in battle" until its one-hour expiry. Storage stays
 * the copy that a reload recovers from.
 */
export function battleLockKeeperTransition(
    state: BattleLockKeeperState,
    active: boolean,
    deps: BattleLockKeeperDeps,
): BattleLockKeeperState {
    if (active && !state.locked) {
        let battleId = "";
        try { battleId = deps.storage.getItem(BATTLE_LOCK_ID_KEY) ?? ""; } catch { /* ignore */ }
        if (!battleId) {
            battleId = deps.mint();
            try { deps.storage.setItem(BATTLE_LOCK_ID_KEY, battleId); } catch { /* ignore */ }
        }
        deps.post({ action: "start", playerName: deps.playerName, battleId, kind: deps.kind, screen: deps.screen });
        return { locked: true, battleId };
    }
    if (!active && state.locked) {
        let battleId = state.battleId;
        try { if (!battleId) battleId = deps.storage.getItem(BATTLE_LOCK_ID_KEY) ?? ""; } catch { /* ignore */ }
        try { deps.storage.removeItem(BATTLE_LOCK_ID_KEY); } catch { /* ignore */ }
        // Mark the fight as ended locally so that if the network resolve below
        // fails, a later boot retries the clear instead of treating the leftover
        // lock as a cleared-state loss.
        try { if (battleId) deps.storage.setItem(BATTLE_LOCK_RESOLVED_KEY, battleId); } catch { /* ignore */ }
        if (battleId) deps.post({ action: "resolve", playerName: deps.playerName, battleId });
        return { locked: false, battleId: "" };
    }
    return state;
}
