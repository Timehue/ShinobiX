import { useEffect, useState } from "react";
import type { NoticePost } from "../types/clan";
import { visiblePoll } from "./poll";
import { sectorOrderFor } from "./sector-order";
import { refreshVillageMemberState } from "./village-member-state";
import { loadVillageState } from "./world-state";

/** How often the World Map re-reads the village's own record for its orders. */
const SECTOR_ORDER_POLL_MS = 30_000;

/**
 * The village's pinned order for one sector, for the sector HUD's order plate.
 * Orders are members-only (owner ruling 2026-10-08), so the public game-state
 * poll no longer brings them: this reads the village's own record
 * (lib/village-member-state.ts) and re-renders when it changes.
 */
export function useSectorOrder(village: string, sector: number | null): NoticePost | null {
    const [, setRecordVersion] = useState(0);
    useEffect(() => {
        let alive = true;
        const load = () => {
            void refreshVillageMemberState(village).then((changed) => { if (alive && changed) setRecordVersion((version) => version + 1); });
        };
        load();
        const stop = visiblePoll(load, SECTOR_ORDER_POLL_MS);
        return () => { alive = false; stop(); };
    }, [village]);
    return sector === null ? null : sectorOrderFor(loadVillageState(village).noticePosts, sector);
}
