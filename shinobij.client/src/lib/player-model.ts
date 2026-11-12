import { useSyncExternalStore } from "react";

export { isPlayerModel, type PlayerModel } from "../../../shared/player-model-ref";
import { readStarterWorldModel, type SprintStyle } from "../../../shared/player-model-ref";
export type { SprintStyle } from "../../../shared/player-model-ref";

export function starterModel(avatar: string, savedChoice?: unknown) {
    return readStarterWorldModel(savedChoice, avatar) ?? "starter-one";
}

const key = "worldSprintStyle.v1";
let inMemory: SprintStyle = "A";
let storageWritable = true;
function getSprintStyle(): SprintStyle {
    if (!storageWritable) return inMemory;
    try {
        const value = localStorage.getItem(key);
        return value === "B" || value === "C" ? value : "A";
    } catch { return inMemory; }
}

export function saveSprintStyle(value: SprintStyle) {
    inMemory = value;
    try { localStorage.setItem(key, value); storageWritable = true; }
    catch { storageWritable = false; }
    window.dispatchEvent(new Event(key));
}

function subscribe(listener: () => void) {
    window.addEventListener(key, listener);
    window.addEventListener("storage", listener);
    return () => {
        window.removeEventListener(key, listener);
        window.removeEventListener("storage", listener);
    };
}

export const useSprintStyle = () => useSyncExternalStore(subscribe, getSprintStyle, () => "A" as const);
