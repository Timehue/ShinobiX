import { useState } from "react";
import type { Character } from "../types/character";
import type { PlayerSaveOverrides, PlayerSavePayload } from "./player-save-types";
import type { SaveConflictDraft } from "./save-conflict";
import { createPlayerSaveCoordinator } from "./player-save-coordinator";

type CoordinatorPorts = Omit<Parameters<typeof createPlayerSaveCoordinator>[0], "storage" | "setSaveConflictDraft" | "setSaveBlocked">;

/** Retain one owner per mount; only the payload builder changes per render,
 * preserving the snapshot captured by each caller of a required save. */
export function usePlayerSaveCoordinator({ buildPlayerSavePayload, ...ports }: CoordinatorPorts & {
    buildPlayerSavePayload: (character: Character, overrides?: PlayerSaveOverrides) => PlayerSavePayload;
}) {
    const [saveConflictDraft, setSaveConflictDraft] = useState<SaveConflictDraft | null>(null);
    const [saveBlocked, setSaveBlocked] = useState(false);
    const [coordinator] = useState(() => createPlayerSaveCoordinator({
        ...ports, storage: localStorage, setSaveConflictDraft, setSaveBlocked,
    }));
    function pushSaveToServer(
        characterToSave: Character,
        name: string,
        overrides?: PlayerSaveOverrides,
        opts?: { echoVersion?: boolean; useLatestAtExecution?: boolean },
    ) {
        return coordinator.pushSaveToServer(buildPlayerSavePayload, characterToSave, name, overrides, opts);
    }
    return { ...coordinator, saveConflictDraft, saveBlocked, pushSaveToServer };
}
