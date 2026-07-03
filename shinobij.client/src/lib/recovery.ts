import { PLAYER_ACCOUNTS_STORAGE, STORAGE } from "../constants/game";
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY } from "./battle-save";

const LAST_SCREEN_KEY = "lastScreen.v1";
const ACTIVE_KEYS = [
    "shinobix:activePlayer",
    "shinobix:activePassword",
    "shinobix:activeToken",
    "shinobix:activePlayerPersist",
    "shinobix:activePasswordPersist",
    "shinobix:activeTokenPersist",
];

const LOCAL_RECOVERY_KEYS = [
    STORAGE,
    PLAYER_ACCOUNTS_STORAGE,
    LAST_SCREEN_KEY,
    "pvpSession.v1",
    "pendingPetPvp.v1",
    "shinobix:towerRunId",
    BATTLE_LOCK_ID_KEY,
    BATTLE_LOCK_RESOLVED_KEY,
    ...ACTIVE_KEYS,
];

const LOCAL_RECOVERY_PREFIXES = [
    "ninjav-save-preview-v1:",
    "arena.battle.v3.",
    "storyBoss.battle.v1.",
    "endless.context.v1.",
    "arenaStory.context.v1.",
    "imgcat:",
];

let localSaveWarningShown = false;

function safeStorage(action: (storage: Storage) => void): void {
    try {
        action(window.localStorage);
    } catch {
        /* storage unavailable */
    }
    try {
        action(window.sessionStorage);
    } catch {
        /* storage unavailable */
    }
}

function reloadAt(screen: "start" | "village"): void {
    try {
        const next = `${window.location.pathname}${window.location.search}#/${screen}`;
        window.history.replaceState(null, "", next);
    } catch {
        /* history unavailable */
    }
    window.location.reload();
}

export function recoverToVillage(): void {
    safeStorage((storage) => storage.setItem(LAST_SCREEN_KEY, "village"));
    reloadAt("village");
}

export function recoverToStart(): void {
    safeStorage((storage) => {
        storage.removeItem(STORAGE);
        storage.removeItem(LAST_SCREEN_KEY);
        ACTIVE_KEYS.forEach((key) => storage.removeItem(key));
    });
    reloadAt("start");
}

export function resetLocalSaveAndReload(): void {
    const ok = window.confirm(
        "Reset local recovery data on this device? Your server save is not deleted, but cached local session data will be cleared.",
    );
    if (!ok) return;
    safeStorage((storage) => {
        LOCAL_RECOVERY_KEYS.forEach((key) => storage.removeItem(key));
        for (let i = storage.length - 1; i >= 0; i -= 1) {
            const key = storage.key(i);
            if (key && LOCAL_RECOVERY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
                storage.removeItem(key);
            }
        }
    });
    reloadAt("start");
}

export function warnLocalSaveUnavailable(error: unknown): void {
    console.warn("Local save cache failed:", error);
    if (localSaveWarningShown) return;
    try {
        if (window.sessionStorage.getItem("shinobix:localSaveWarned.v1")) {
            localSaveWarningShown = true;
            return;
        }
        window.sessionStorage.setItem("shinobix:localSaveWarned.v1", "1");
    } catch {
        /* alert anyway when storage itself is blocked */
    }
    localSaveWarningShown = true;
    window.alert("Your local quick-save cache is full or blocked. Progress still saves to the server, but large uploaded images may need to be compressed or removed if saving keeps failing.");
}
