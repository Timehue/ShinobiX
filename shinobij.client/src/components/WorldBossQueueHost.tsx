import { lazy, Suspense, useMemo } from "react";
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from "../types/character";
import { buildHostLoadout } from "../lib/host-loadout";
import type { GameItem, SavedBloodline } from "../types/combat";

const WorldBossQueueDialog = lazy(() =>
    import("../screens/WorldBossQueueDialog").then(({ WorldBossQueueDialog }) => ({ default: WorldBossQueueDialog })),
);

/**
 * The roaming world boss team queue (and the raid it launches), opened by
 * clicking the boss where it stands in its sector. WorldMap portals this to
 * the document body: the sector board is transformed, which would otherwise
 * trap the fixed-position dialog inside the board.
 */
export function WorldBossQueueHost({
    currentSector,
    onClose,
    character,
    creatorItems,
    savedBloodlines,
    sharedImages,
    onVersionedCharacter,
    onRecordBattle,
}: {
    currentSector: number;
    onClose: () => void;
    character: Character;
    creatorItems: GameItem[];
    savedBloodlines: SavedBloodline[];
    sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const hostLoadout = useMemo(() => buildHostLoadout(character, savedBloodlines, creatorItems), [character, savedBloodlines, creatorItems]);
    return <Suspense fallback={null}>
        <WorldBossQueueDialog
            character={character}
            currentSector={currentSector}
            hostLoadout={hostLoadout}
            sharedImages={sharedImages}
            onVersionedCharacter={onVersionedCharacter}
            onRecordBattle={onRecordBattle}
            onClose={onClose}
        />
    </Suspense>;
}
