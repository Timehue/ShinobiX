import type { RefObject } from "react";
import type { CoastFloor } from "../../../../shared/coast-world-rules";
import { RoomWorkbench } from "./RoomWorkbench";
import { dutyFloor, type useRoomDuty } from "./use-room-duty";

type Work = NonNullable<ReturnType<typeof useRoomDuty>>;
export function CoastRoomDuty({ work, floors, level, atBench, approach, respond, heading }: {
    work: Work; floors: CoastFloor[]; level: number; atBench: boolean; approach: () => void;
    respond: (answer: string | number) => void; heading: RefObject<HTMLHeadingElement | null>;
}) {
    const { duty, stage, card, station, completed } = work;
    const destination = station ? dutyFloor(floors, station) : -1;
    const stationAction = station && /^(Read|Sound|Fit|Take|Compare|Study|Inspect|Trace|Examine|Match|Lift|Look|Unfold) /.test(station)
        ? station : "Walk to " + station;
    return <section className="coast-room-duty" aria-label={duty.title}>
        <small>{duty.worker}</small>
        <h4 tabIndex={-1} ref={heading}>{duty.title}</h4>
        <p>{work.paid ? "Received" : "Payment"} · {duty.reward.label}</p>
        {work.error && <p role="status">{work.error}</p>}
        {!work.ready && (work.error ? <button type="button" disabled={work.busy} onClick={work.sync}>Reload job</button> : <p role="status">Reading your character’s work record…</p>)}
        {work.ready && <fieldset className="coast-duty-controls" disabled={work.busy} aria-label="Job actions">
        {stage === 0 && <p>“{duty.request}”</p>}
        {stage === 3 && <p role="status">{card.result}</p>}
        {stage >= 1 && stage <= 2 && <>
            {stage === 2 && <p>{card.reading}</p>}
            {stage === 2 && atBench ? <RoomWorkbench site={work.site} duty={duty} sample={work.sample} adjust={work.adjust} submit={respond} />
            : destination === level ? <button type="button" onClick={approach}>{stationAction}</button>
            : destination >= 0 && <p>Continue on floor {destination + 1} · {floors[destination].title}<br />{station}</p>}
        </>}
        {(stage === 0 || stage === 3) && <button type="button" onClick={work.take}>{stage === 0 ? "Take the request" : "Take the next request"}</button>}
        </fieldset>}
        {completed > 0 && <details><summary>Keeper’s note · {completed} {completed === 1 ? "request" : "requests"} finished</summary>
            <p>{duty.note}</p><small>Saved with your character.</small></details>}
    </section>;
}
