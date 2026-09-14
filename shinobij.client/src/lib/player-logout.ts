import type { GameConfirmOptions } from "../components/GameAlert";
import type { Character } from "../types/character";
import type { usePlayerSaveCoordinator } from "./use-player-save-coordinator";
import { logoutSaveFailure } from "./logout-save-failure";
import { saveConflictAccountKey } from "./save-conflict";

type SaveCoordinator = Pick<ReturnType<typeof usePlayerSaveCoordinator>,
    "pushSaveToServer" | "charDirtyRef" | "latestSaveRef"> & {
    saveAuthority: Pick<ReturnType<typeof usePlayerSaveCoordinator>["saveAuthority"], "isCurrent">;
};

export type PlayerLogoutParams = {
    character: Character | null;
    currentAccountName: string;
    saveSessionEpochRef: { current: number };
    saveCoordinator: SaveCoordinator;
    confirm: (message: string, options: GameConfirmOptions) => Promise<boolean>;
    endLocalSession: () => void;
};

/** One logout per account/session, retired on unmount or a newer session. */
export function createPlayerLogout() {
    let active: { accountKey: string; epoch: number; promise: Promise<void> } | null = null;

    function run(params: PlayerLogoutParams): Promise<void> {
        const { character, saveCoordinator, saveSessionEpochRef } = params;
        const accountName = params.currentAccountName || character?.name || "";
        const accountKey = saveConflictAccountKey(accountName);
        const epoch = saveSessionEpochRef.current;
        if (active?.accountKey === accountKey && active.epoch === epoch) return active.promise;
        const attempt = { accountKey, epoch, promise: Promise.resolve() };
        active = attempt;
        const isCurrent = () => active === attempt && saveSessionEpochRef.current === epoch
            && (!character || saveCoordinator.saveAuthority.isCurrent(accountKey, epoch));

        attempt.promise = Promise.resolve().then(async () => {
            if (!isCurrent()) return;
            const { pushSaveToServer, charDirtyRef, latestSaveRef } = saveCoordinator;
            if (character) {
                try {
                    await pushSaveToServer(character, accountName, undefined, { useLatestAtExecution: true });
                    if (!isCurrent()) return;
                    if (charDirtyRef.current && latestSaveRef.current) {
                        await pushSaveToServer(latestSaveRef.current.character, accountName, undefined, { useLatestAtExecution: true });
                        if (!isCurrent()) return;
                    }
                    if (charDirtyRef.current) throw new Error("The save changed while logout was finishing.");
                } catch (error) {
                    if (!isCurrent()) return;
                    charDirtyRef.current = true;
                    const failure = logoutSaveFailure(error);
                    const leave = await params.confirm(failure.message, failure.options);
                    if (!isCurrent() || !leave) return;
                }
            }
            if (isCurrent()) params.endLocalSession();
        }).finally(() => { if (active === attempt) active = null; });
        return attempt.promise;
    }

    return { run, retire: () => { active = null; } };
}
