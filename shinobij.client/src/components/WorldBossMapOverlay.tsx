/* eslint-disable react-hooks/set-state-in-effect -- clear stale server-backed map state when access closes. */
import { lazy, Suspense, useEffect, useState } from "react";
import { fetchWorldBossEvent, type WorldBossEventClientState } from "../lib/world-boss-event-api";
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from "../types/character";
import type { TowerHostLoadout } from "../lib/towers-api";
import { visiblePoll } from "../lib/poll";
import { worldBossDefinition } from "../../../shared/world-boss-event";

const WorldBossQueueDialog = lazy(() =>
    import("../screens/WorldBossQueueDialog").then(({ WorldBossQueueDialog }) => ({ default: WorldBossQueueDialog })),
);

type WorldBossMapEvent = NonNullable<WorldBossEventClientState["event"]>;

export function useWorldBossMap(
    enabled: boolean,
    currentSector: number,
    isTraveling: boolean,
    travelToSector: (sector: number) => void,
) {
    const [view, setView] = useState<WorldBossEventClientState | null>(null);
    const [queueOpen, setQueueOpen] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setView(null);
            setQueueOpen(false);
            return;
        }
        let alive = true;
        const load = () => {
            void fetchWorldBossEvent()
                .then(data => { if (alive) setView(data); })
                .catch(() => { /* Best effort: hide the event marker if unavailable. */ });
        };
        load();
        const stop = visiblePoll(load, 20_000);
        return () => { alive = false; stop(); };
    }, [enabled]);

    const event = view?.event?.active ? view.event : null;
    const boss = worldBossDefinition(event?.bossId);
    const sector = event?.currentSector ?? null;
    const activate = (target: number) => {
        if (target === currentSector && !isTraveling) {
            setQueueOpen(true);
            return;
        }
        travelToSector(target);
    };
    const closeQueue = () => setQueueOpen(false);
    return { view, event, boss, sector, queueOpen, activate, closeQueue };
}

export function WorldBossMapOverlay({
    event,
    sector,
    currentSector,
    isTraveling,
    activate,
    open,
    onClose,
    character,
    hostLoadout,
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
    hostLoadout?: TowerHostLoadout;
    sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    showCallout: boolean;
}) {
    const boss = worldBossDefinition(event?.bossId);
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

export function WorldBossSectorFlag({ event, sector }: { event: WorldBossMapEvent | null; sector: number }) {
    if (!event || event.currentSector !== sector) return null;
    const boss = worldBossDefinition(event.bossId);
    return <span className={"atlas-world-boss-flag" + (event.movementPaused ? " is-paused" : "")} aria-hidden="true" title={(event.bossName || boss.name) + " is at Sector " + sector + ". Travel in to join the team queue"}>
        <span
            className={"atlas-world-boss-sprite" + (boss.mapGlow === "white-red" ? " is-white-red-glow" : "")}
            style={{ backgroundImage: 'url("' + boss.mapSprite + '")' }}
        />
    </span>;
}
