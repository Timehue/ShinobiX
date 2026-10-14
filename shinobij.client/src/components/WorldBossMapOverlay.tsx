/* eslint-disable react-hooks/set-state-in-effect -- clear stale server-backed map state when access closes. */
import { useEffect, useState } from "react";
import { fetchWorldBossEvent, type WorldBossEventClientState } from "../lib/world-boss-event-api";
import { visiblePoll } from "../lib/poll";
import { sameJsonValue } from "../lib/pvp-session-runtime";
import type { WorldSectorWorldBossMarker } from "./SectorWorldBossStandee";
// The atlas glow on the boss's sector node lives here, so it loads with the map.
import "../styles/world-boss-map.css";

/**
 * Live roaming world boss state for the World Map. The atlas only highlights
 * the boss's sector; the boss itself stands inside that sector, and clicking it
 * there is the one way to open the team queue.
 */
export function useWorldBossMap(
    enabled: boolean,
    currentSector: number,
    isTraveling: boolean,
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
                // This hook lives in the World Map: an unchanged 20s poll keeps the
                // same object instead of re-rendering the whole map.
                .then(data => { if (alive) setView(prev => sameJsonValue(prev, data) ? prev : data); })
                .catch(() => { /* Best effort: hide the event marker if unavailable. */ });
        };
        load();
        const stop = visiblePoll(load, 20_000);
        return () => { alive = false; stop(); };
    }, [enabled]);

    const event = view?.event?.active ? view.event : null;
    const sector = event?.currentSector ?? null;
    const openQueue = () => {
        if (sector === currentSector && !isTraveling) setQueueOpen(true);
    };
    const closeQueue = () => setQueueOpen(false);
    /** The boss standing in `selectedSector`, clickable to open the queue, or null. */
    const standeeIn = (selectedSector: number | null): WorldSectorWorldBossMarker | null => event && sector != null && sector === selectedSector
        ? { bossId: event.bossId, name: event.bossName, paused: event.movementPaused, onOpen: openQueue }
        : null;
    return { view, event, sector, queueOpen, openQueue, closeQueue, standeeIn };
}
