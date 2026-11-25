import type { RoomDuty, WorkSample } from "../../../../shared/coast-room-duties";

type Adjustment = { lower: string; higher: string; test: string; measures: [string, string] };
const gauges: Partial<Record<string, Adjustment>> = {
    "saltstair-dock-101": { lower: "Plane one shaving", higher: "Add one shim", test: "Test the fit",
        measures: ["shavings removed", "shims fitted"] },
    "saltstair-houses-105": { lower: "Add plain stock", higher: "Add brine", test: "Taste the sample",
        measures: ["ladles of stock", "spoons of brine"] },
};

export function RoomWorkbench({ site, duty, sample, adjust, submit }: {
    site: string; duty: RoomDuty; sample?: WorkSample; adjust: (value: WorkSample) => void; submit: (answer: WorkSample) => void;
}) {
    const adjustment = typeof sample === "number" ? sample : 0;
    const reply = typeof sample === "string" && sample ? sample.split(" ") : [];
    const gauge = gauges[site];
    if (gauge) return <div className="coast-duty-choices">
        <output>{adjustment === 0 ? "Original sample" : gauge.measures[Number(adjustment > 0)] + " · " + Math.abs(adjustment)}</output>
        <button type="button" disabled={adjustment <= -3} onClick={() => adjust(adjustment - 1)}>{gauge.lower}</button>
        <button type="button" disabled={adjustment >= 3} onClick={() => adjust(adjustment + 1)}>{gauge.higher}</button>
        <button type="button" onClick={() => submit(adjustment)}>{gauge.test}</button>
        <button type="button" disabled={!adjustment} onClick={() => adjust(0)}>Reset sample</button>
    </div>;
    if (site === "hushcrown-fort-148") {
        return <div className="coast-duty-choices">
            <output>{reply.length ? reply.join(" · ") : "Signal shutter ready"}</output>
            {["Flash", "Hold"].map(pulse => <button key={pulse} type="button" disabled={reply.length >= 3}
                onClick={() => adjust([...reply, pulse].join(" "))}>{pulse}</button>)}
            <button type="button" disabled={reply.length !== 3} onClick={() => submit(reply.join(" "))}>Send signal</button>
            <button type="button" disabled={!reply.length} onClick={() => adjust("")}>Clear signal</button>
        </div>;
    }
    if (duty.cases[0].fitting) {
        const [piece, placement] = typeof sample === "string" ? sample.split("|") : [];
        const dim = piece ? 1 : 0;
        const parts = duty.cases.flatMap(card => card.fitting ? [card.fitting[dim]] : []);
        return <div className="coast-duty-choices">
            <output>{placement ? piece + " · " + placement : piece ? piece + " · Choose a fitting" : "Choose a piece from the bench"}</output>
            {!placement && [...new Set(parts)].sort().map(part => <button type="button" key={part}
                onClick={() => adjust(piece ? piece + "|" + part : part)}>{part}</button>)}
            {placement && <button type="button" onClick={() => submit(piece + "|" + placement)}>Check the work</button>}
            {piece && <button type="button" onClick={() => adjust("")}>Put the pieces back</button>}
        </div>;
    }
    return <div className="coast-duty-choices">{duty.cases.map(card => card.action).sort().map(action =>
        <button type="button" key={action} onClick={() => submit(action)}>{action}</button>)}</div>;
}
