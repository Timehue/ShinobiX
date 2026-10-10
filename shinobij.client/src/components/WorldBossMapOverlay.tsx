/* eslint-disable react-hooks/set-state-in-effect -- clear stale server-backed map state when access closes. */
import { useEffect, useState } from "react";
import { fetchWorldBossEvent, type WorldBossEventClientState } from "../lib/world-boss-event-api";
import { visiblePoll } from "../lib/poll";
import { worldBossDefinition } from "../../../shared/world-boss-event";

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
