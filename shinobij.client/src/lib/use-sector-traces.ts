import { useEffect, useRef, useState } from "react";
import { FESTIVAL_SECTOR, MAX_WILD_SECTOR } from "../../../shared/sector-geo";
import type { TracesModalState } from "../components/SectorTraces";
import { fetchSectorTraces, isSectorTracesEnabled, type SectorTracesView } from "./sector-traces";

type Entry = { sector: number | null; traces: SectorTracesView | null; modal: TracesModalState | null };
/** Patch one sector's entry; a patch for a newly selected sector starts it fresh. */
const merge = (sector: number | null, patch: Partial<Entry>) => (previous: Entry): Entry =>
    ({ ...(previous.sector === sector ? previous : { sector, traces: null, modal: null }), ...patch });

/**
 * Sector traces — footfall, trail signs and the shrine: a server-authoritative
 * snapshot, refetched on sector change, which action responses patch in place.
 * A failed read is retried, and opening the shrine or signs sheet reads the
 * sector on demand, so one dropped request no longer leaves them inert.
 * State is keyed by sector, so another sector's snapshot or open sheet is never shown.
 */
export function useSectorTraces(sector: number | null, playerName: string) {
    const [entry, setEntry] = useState<Entry>({ sector, traces: null, modal: null });
    const current = useRef(sector);
    const own = entry.sector === sector ? entry : { sector, traces: null, modal: null };
    useEffect(() => {
        current.current = sector;
        if (!isSectorTracesEnabled() || sector == null || sector < 1 || sector > MAX_WILD_SECTOR || sector === FESTIVAL_SECTOR) return;
        let cancelled = false, timer = 0;
        const load = (attempt: number) => void fetchSectorTraces(sector, playerName).then((view) => {
            if (cancelled) return;
            if (view && view.sector === sector) setEntry(merge(sector, { traces: view }));
            else if (attempt < 3) timer = window.setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
        });
        load(0);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [sector, playerName]);
    function open(state: TracesModalState) {
        setEntry(merge(sector, { modal: state }));
        if (own.traces || sector == null) return;
        const asked = sector;
        void fetchSectorTraces(asked, playerName).then((view) => {
            if (view && view.sector === asked && current.current === asked) {
                setEntry(previous => previous.sector === asked && !previous.traces ? { ...previous, traces: view } : previous);
            }
        });
    }
    return {
        traces: own.traces, modal: own.modal, open,
        setTraces: (traces: SectorTracesView) => setEntry(merge(sector, { traces })),
        setModal: (modal: TracesModalState | null) => setEntry(merge(sector, { modal })),
    };
}
