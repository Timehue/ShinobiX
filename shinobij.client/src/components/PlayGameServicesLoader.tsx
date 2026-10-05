import { Suspense } from "react";
import type { GameConfirmOptions } from "./GameAlert";
import type { GameToastOptions } from "./GameToast";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { isAppShell } from "../lib/surface";
import type { Character, VersionedCharacterCommit } from "../types/character";

const PlayGameServicesHost = lazyWithRetry(() => import("./PlayGameServicesHost").then(m => ({ default: m.PlayGameServicesHost })));

export function PlayGameServicesLoader({
    character,
    commitVersionedCharacter,
    confirm,
    toast,
}: {
    character: Character;
    commitVersionedCharacter: VersionedCharacterCommit;
    confirm: (message: string, options?: GameConfirmOptions) => Promise<boolean>;
    toast: (message: string, options?: GameToastOptions) => void;
}) {
    if (!isAppShell()) return null;
    return <Suspense fallback={null}>
        <PlayGameServicesHost
            character={character}
            commitVersionedCharacter={commitVersionedCharacter}
            confirm={confirm}
            toast={toast}
        />
    </Suspense>;
}
