import { useEffect, useState } from "react";
import {
    HALL_LADDER_BOUTS_PER_DUELIST,
    HALL_LADDER_DUELISTS,
    hallLadderArt,
    hallLadderBoutOpen,
    hallLadderFirstClearCp,
    hallLadderFrontier,
    type HallLadderRecord,
} from "../../../shared/hall-ladder-contract";
import { TUTORIAL_PAGES } from "../lib/card-clash-tutorial-pages";
import "../styles/hall-ladder.css";

/** "easy" -> "Easy". */
const label = (word: string) => word[0].toUpperCase() + word.slice(1);

/** Each duelist's lesson, in ladder order: its title, then the Card Clash
 *  tutorial page and the lines of it the duelist teaches. Reading the tutorial
 *  keeps the two in step and ships the rules text once. */
const LESSONS: readonly (readonly [string, number, readonly number[]])[] = [
    ["Your turn", 0, [0, 1]],
    ["Summoning and Tributes", 1, [0]],
    ["Elements", 1, [2]],
    ["Set Monsters and FLIP", 1, [1]],
    ["Snares", 3, [0, 1]],
    ["Calls and Warded Monsters", 2, [0, 2]],
];
const TOWER_ART = "/chronicle/fx/hall-ladder/tower.webp";
const FLOORS = HALL_LADDER_DUELISTS.length;

/** Each storey on the tower painting, lowest first, in percent of the painting:
 *  `x`/`feet` is just behind the front lip of the storey's floor (the duelist
 *  has stepped forward to face you), and `height` is the figure's height.
 *  Measured against a percent grid on tower.webp, each storey's opening is
 *  9.3 to 9.8% tall above these feet, so a 7.4% figure keeps about 2% of clear
 *  space under the beam; re-measure if the painting is ever repainted. It is
 *  seen nearly straight on, so every storey takes the same height. The
 *  cut-off storey at the very bottom is the ground hall. */
const FLOOR_SPOTS: readonly { x: number; feet: number; height: number }[] = [
    { x: 50, feet: 87.2, height: 7.4 }, { x: 50, feet: 74.2, height: 7.4 }, { x: 50, feet: 60.8, height: 7.4 },
    { x: 50, feet: 48.3, height: 7.4 }, { x: 50, feet: 36.3, height: 7.4 }, { x: 50, feet: 23.8, height: 7.4 },
];
/** The view is a camera on the painting, this much closer than the whole tower. */
const ZOOM = 1.6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Translate (percent of the zoomed stage) that centres the camera on a floor. */
function cameraOn(floor: number): string {
    const spot = FLOOR_SPOTS[floor];
    const edge = ((ZOOM - 1) / ZOOM) * 100;
    const x = clamp(((spot.x / 100) * ZOOM - 0.5) / ZOOM * 100, 0, edge);
    const y = clamp((((spot.feet - spot.height) / 100) * ZOOM - 0.5) / ZOOM * 100, 0, edge);
    return `translate(${-x}%, ${-y}%)`;
}
const seenKey = (owner: string) => `hallLadder.seenFloor.v1:${owner.trim().toLowerCase()}`;
function readSeenFloor(owner: string): number | null {
    try {
        const raw = window.localStorage.getItem(seenKey(owner));
        const floor = raw === null ? NaN : Number(raw);
        return Number.isInteger(floor) && floor >= 0 && floor < FLOORS ? floor : null;
    } catch { return null; }
}
function writeSeenFloor(owner: string, floor: number) {
    try { window.localStorage.setItem(seenKey(owner), String(floor)); } catch { /* storage off: the climb just won't replay */ }
}

/**
 * Hall Ladder (Card Hall, Play): the Hall Tower. Six duelists, one per floor,
 * three bouts each. The server owns progress (`record`) and seals the chosen
 * bout; this view shows the climb and sends a bout index. Floors above the
 * player stand empty until they are reached. Each duelist is a painted figure
 * standing on their floor at the painting's own scale. The view is a camera on
 * the tower: reaching a new floor pans it up to that floor, brings the
 * duelist out and says so. Under Reduce Motion the camera cuts instead of
 * panning and the duelist simply appears; the arrival line still shows.
 */
export function HallLadder({ owner, record, busy, onFight }: {
    owner: string;
    record: HallLadderRecord;
    busy: boolean;
    onFight: (bout: number) => void;
}) {
    const frontier = hallLadderFrontier(record);
    const complete = frontier === null;
    const currentFloor = complete ? FLOORS - 1 : Math.floor(frontier / HALL_LADDER_BOUTS_PER_DUELIST);
    const [picked, setPicked] = useState<number | null>(null);
    const shown = picked ?? currentFloor;

    // Start from the floor this player last saw, then reveal the new one.
    const [tokenFloor, setTokenFloor] = useState(() => Math.min(readSeenFloor(owner) ?? currentFloor, currentFloor));
    const [arrived, setArrived] = useState<number | null>(null);
    // The Hall keys this view by account, so `owner` never changes under it.
    useEffect(() => {
        if (tokenFloor >= currentFloor) {
            writeSeenFloor(owner, currentFloor);
            return;
        }
        const timer = window.setTimeout(() => {
            setTokenFloor(currentFloor);
            setArrived(currentFloor);
            setPicked(null);
            writeSeenFloor(owner, currentFloor);
        }, 450);
        return () => window.clearTimeout(timer);
    }, [owner, tokenFloor, currentFloor]);

    const duelist = HALL_LADDER_DUELISTS[shown];
    const firstBout = shown * HALL_LADDER_BOUTS_PER_DUELIST;
    const nextBout = !complete && shown === currentFloor ? frontier : null;
    // During a climb the camera starts on the floor last seen; after it, it follows the floor being viewed.
    const cameraFloor = tokenFloor < currentFloor ? tokenFloor : shown;

    return (
        <section className="hall-ladder" aria-labelledby="hall-ladder-heading">
            <h3 id="hall-ladder-heading">The Hall Tower</h3>
            <p className="hall-ladder__progress">
                {complete
                    ? "You stand at the top of the Hall Tower. Every duelist can be fought again."
                    : `Floor ${currentFloor + 1} of ${FLOORS}. Win three bouts to climb to the next floor.`}
            </p>
            {arrived !== null ? (
                <p className="hall-ladder__arrival" role="status">
                    Floor {arrived + 1} reached. {HALL_LADDER_DUELISTS[arrived].name} is waiting.
                </p>
            ) : null}
            <div className="hall-ladder__climb">
                <div className="hall-tower">
                    <div className="hall-tower__stage" style={{ backgroundImage: `url(${TOWER_ART})`, transform: cameraOn(cameraFloor) }}>
                    {HALL_LADDER_DUELISTS.map((entry, floor) => {
                        const spot = FLOOR_SPOTS[floor];
                        const open = hallLadderBoutOpen(record, floor * HALL_LADDER_BOUTS_PER_DUELIST);
                        // A floor above the player stands empty; so does a newly
                        // reached one until its duelist steps out.
                        if (!open || floor > tokenFloor) return null;
                        const beaten = record.cleared >= (floor + 1) * HALL_LADDER_BOUTS_PER_DUELIST;
                        const wins = Math.min(HALL_LADDER_BOUTS_PER_DUELIST, Math.max(0, record.cleared - floor * HALL_LADDER_BOUTS_PER_DUELIST));
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                className={`hall-tower__floor${beaten ? " is-beaten" : " is-current"}${floor === shown ? " is-shown" : ""}${floor === arrived ? " is-arrived" : ""}`}
                                style={{ left: `${spot.x}%`, top: `${spot.feet}%`, height: `${spot.height}%` }}
                                aria-pressed={floor === shown}
                                aria-label={`Floor ${floor + 1}, ${entry.name}, ${entry.title}: ${beaten ? "beaten" : `${wins} of 3 bouts won`}`}
                                // Keyboard users move between floors with the numbered buttons
                                // beside the tower, so the figure is not a second tab stop.
                                tabIndex={-1}
                                onClick={() => setPicked(floor)}
                            >
                                <img src={hallLadderArt(entry.id, true)} alt="" decoding="async" />
                            </button>
                        );
                    })}
                    </div>
                </div>
                <div className="hall-ladder__card">
                    <img className="hall-ladder__portrait" src={hallLadderArt(duelist.id)} alt={`${duelist.name}, ${duelist.title}`} width={112} height={112} />
                    <div className="hall-ladder__detail">
                        <div className="hall-ladder__floors" role="group" aria-label="Look at a floor">
                            {HALL_LADDER_DUELISTS.map((entry, floor) => floor <= tokenFloor ? (
                                <button
                                    key={entry.id}
                                    type="button"
                                    className={floor === shown ? "is-shown" : undefined}
                                    aria-pressed={floor === shown}
                                    aria-label={`Look at floor ${floor + 1}: ${entry.name}`}
                                    onClick={() => setPicked(floor)}
                                >
                                    {floor + 1}
                                </button>
                            ) : (
                                <span key={entry.id} role="img" aria-label={`Floor ${floor + 1}, not reached`}>{floor + 1}</span>
                            ))}
                        </div>
                        <p className="hall-ladder__floor">Floor {shown + 1}</p>
                        <h4>{duelist.name} <small>{duelist.title}</small></h4>
                        <ol className="hall-ladder__bouts" aria-label={`${duelist.name}'s bouts`}>
                            {duelist.bouts.map((bout, round) => {
                                const index = firstBout + round;
                                const won = record.cleared > index;
                                return (
                                    <li key={round} className={won ? "is-won" : index === nextBout ? "is-next" : undefined}>
                                        <span>
                                            Bout {round + 1}: {label(bout.difficulty)}
                                            {bout.opponentLifeBonus > 0 ? `, +${bout.opponentLifeBonus.toLocaleString("en-US")} Health` : ""}
                                            {won ? " (won)" : ` · first win ${hallLadderFirstClearCp(index)} Chronicle Points`}
                                        </span>
                                        {won ? (
                                            <button type="button" className="hall-ladder__rematch" disabled={busy} onClick={() => onFight(index)}>
                                                Rematch
                                            </button>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ol>
                        <div className="hall-ladder__lesson">
                            <strong>{duelist.name}'s lesson: {LESSONS[shown][0]}</strong>
                            <p>{LESSONS[shown][2].map((line) => TUTORIAL_PAGES[LESSONS[shown][1]].lines[line]).join(" ")}</p>
                        </div>
                        {nextBout !== null ? (
                            <button type="button" className="hall-ladder__fight" disabled={busy} onClick={() => onFight(nextBout)}>
                                {busy ? "Preparing showdown…" : `Fight ${duelist.name}: Bout ${(nextBout % HALL_LADDER_BOUTS_PER_DUELIST) + 1}`}
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    );
}
