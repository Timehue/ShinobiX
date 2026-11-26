import { useEffect, useState } from "react";
import { COAST_WATCHES, watchForSector } from "../../../../shared/coast-watch";
import { visiblePoll } from "../../lib/poll";

export function CoastWatch({ sector, inspect }: { sector: number; inspect: (report: string) => void }) {
    const watch = watchForSector(sector);
    const [order, setOrder] = useState<number | null>(null);
    useEffect(() => {
        if (!watch) return;
        const controller = new AbortController();
        const stop = visiblePoll(async () => {
            try {
                const response = await fetch("/api/coast/world?watch=" + watch, {
                    cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
                });
                if (!response.ok) return;
                const data = await response.json() as { order: number | null };
                if (!controller.signal.aborted) setOrder(data.order);
            } catch { /* Keep the last sighting until the next visible poll. */ }
        }, 15_000, 0.1, { immediate: true });
        return () => { stop(); controller.abort(); };
    }, [watch]);
    if (!watch || order === null) return null;
    const definition = COAST_WATCHES[watch];
    const report = definition.reports[order];
    if (!report) return null;
    const shape = sector === 116 ? "skiff" : sector === 118 ? "pennant" : sector === 138 ? "lantern" : "banner";
    return <button className={"coast-watch coast-watch-" + shape} data-order={order}
        type="button" title={report} aria-label={report} onClick={event => { event.stopPropagation(); inspect(report); }}>
        {shape === "skiff" ? <img src="/coast-map/boats/reedwatch-skiff-v1.webp" alt="" draggable={false} />
            : <span aria-hidden="true" className="coast-watch-sign"><i /><i /></span>}
    </button>;
}
