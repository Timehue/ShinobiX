import { lazy, Suspense, useMemo } from "react";
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from "../types/character";
import { buildHostLoadout } from "../lib/host-loadout";
import type { GameItem, SavedBloodline } from "../types/combat";
import type { WorldBossEventClientState } from "../lib/world-boss-event-api";
import { worldBossDefinition } from "../../../shared/world-boss-event";
import "../styles/world-boss-map.css";

const WorldBossQueueDialog = lazy(() =>
    import("../screens/WorldBossQueueDialog").then(({ WorldBossQueueDialog }) => ({ default: WorldBossQueueDialog })),
);

type WorldBossMapEvent = NonNullable<WorldBossEventClientState["event"]>;

export function WorldBossMapCalloutOverlay({
    event,
    sector,
    currentSector,
    isTraveling,
    activate,
    open,
    onClose,
    character,
    creatorItems,
    savedBloodlines,
    sharedImages,
    onVersionedCharacter,
    onRecordBattle,
    showCallout,
}: {
    event: WorldBossMapEvent | null;
    sector: number | null;
    currentSector: number;
    isTraveling: boolean;
    activate: (sector: number) => void;
    open: boolean;
    onClose: () => void;
    character: Character;
    creatorItems: GameItem[];
    savedBloodlines: SavedBloodline[];
    sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    showCallout: boolean;
}) {
    const boss = worldBossDefinition(event?.bossId);
    const hostLoadout = useMemo(() => buildHostLoadout(character, savedBloodlines, creatorItems), [character, savedBloodlines, creatorItems]);
    return <>
        {showCallout && event && sector != null && <button
            type="button"
            className="world-boss-map-call"
            onClick={() => activate(sector)}
            aria-label={"World boss at Sector " + sector + ". " + (currentSector === sector ? "Open team queue" : "Travel to boss")}
        >
            <img src={boss.keyArt} alt="" />
            <span><strong>WORLD THREAT · SECTOR {sector}</strong><small>{event.movementPaused ? event.bossName + " is holding position while a team forms." : (event.bossName || boss.name) + " is roaming. Rally a team of up to three."}</small></span>
            <b>{currentSector === sector && !isTraveling ? "ATTACK →" : "TRAVEL →"}</b>
        </button>}
        {open && <Suspense fallback={null}>
            <WorldBossQueueDialog
                character={character}
                currentSector={currentSector}
                hostLoadout={hostLoadout}
                sharedImages={sharedImages}
                onVersionedCharacter={onVersionedCharacter}
                onRecordBattle={onRecordBattle}
                onClose={onClose}
            />
        </Suspense>}
    </>;
}
