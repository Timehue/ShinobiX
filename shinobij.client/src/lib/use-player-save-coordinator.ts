import { useState } from "react";
import type { Character } from "../types/character";
import type { PlayerSaveOverrides, PlayerSavePayload } from "./player-save-types";
import type { SaveConflictDraft } from "./save-conflict";
import { createPlayerSaveCoordinator } from "./player-save-coordinator";
import { SAVE_REFRESH_REQUIRED, type SaveBlockedState } from "./save-persistence";

type CoordinatorPorts = Omit<Parameters<typeof createPlayerSaveCoordinator>[0], "storage" | "setSaveConflictDraft" | "setSaveBlocked">;

/** Retain one owner per mount; only the payload builder changes per render,
 * preserving the snapshot captured by each caller of a required save. */
export function usePlayerSaveCoordinator({ buildPlayerSavePayload, ...ports }: CoordinatorPorts & {
    buildPlayerSavePayload: (character: Character, overrides?: PlayerSaveOverrides) => PlayerSavePayload;
}) {
    const [saveConflictDraft, setSaveConflictDraft] = useState<SaveConflictDraft | null>(null);
    const [saveBlocked, setSaveBlockedState] = useState<SaveBlockedState>(false);
    // Only a reload clears a refresh-required block: no save from this build can
    // land after a 426, so a later success or account switch must not hide it.
    const [coordinator] = useState(() => createPlayerSaveCoordinator({
        ...ports, storage: localStorage, setSaveConflictDraft,
        setSaveBlocked: blocked => setSaveBlockedState(current => current === SAVE_REFRESH_REQUIRED ? current : blocked),
    }));
    function pushSaveToServer(
        characterToSave: Character,
        name: string,
        overrides?: PlayerSaveOverrides,
        opts?: { echoVersion?: boolean; useLatestAtExecution?: boolean; bloodlineEquipIntent?: string; bloodlineWriteIntent?: string },
    ) {
        return coordinator.pushSaveToServer(buildPlayerSavePayload, characterToSave, name, overrides, opts);
    }
    return { ...coordinator, saveConflictDraft, saveBlocked, pushSaveToServer };
}
