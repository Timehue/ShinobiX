import { COURTYARD_MODEL_SCALE, ROOM_MODEL_SCALE, SettlementPlayer } from "./CoastModelScale";
import type { Character } from "../../types/character";
import { CoastFigure } from "./CoastPatrols";
import { useEffect, useRef, useState } from "react";
import type { CoastFloor, CoastStation } from "../../../../shared/coast-world-rules";
import { centre, footprintStyle, GRID, neighbours, open, pathTo, STEP } from "./coast-grid";

type Props = {
    floors: CoastFloor[]; avatar?: string | null; name: string; leave: () => void;
    /** Who keeps this place, standing at their station on the ground floor (`coast.figures` in the quest list). */
    player?: Character; initialTile?: number; street?: boolean;
    residents?: { label: string; model: string; feet: [number, number]; approach: number; seatedArt?: string }[];
    onSpeak?: (label: string) => void;
    onStation?: (station: CoastStation) => void;
    keeper?: { label: string; image?: string; room?: [number, number] };
    /**
     * A quest step that is found in this building. Its stations are examined on the server, which keeps what
     * was found, so leaving does not lose it; `examine` answers with what to show.
     */
    clues?: { floor: number; station: string; examine: () => Promise<{ text: string; order?: boolean }> }[];
};

export default function CoastInterior({ floors, avatar, name, leave, keeper, onStation, residents, onSpeak, initialTile, street, player, clues }: Props) {
    const [level, setLevel] = useState(0);
    const [tile, setTile] = useState(initialTile !== undefined && open(floors[0].mask, initialTile) ? initialTile : floors[0].spawn);
    const [message, setMessage] = useState("");
    const position = useRef(tile);
    const clue = useRef(0);
    const journey = useRef(0);
    const board = useRef<HTMLDivElement>(null);
    const room = floors[level];
    const figureScale = street ? COURTYARD_MODEL_SCALE : ROOM_MODEL_SCALE;
    useEffect(() => {
        board.current?.focus({ preventScroll: true });
        return () => { journey.current += 1; };
    }, [level]);
    function move(next: number) {
        position.current = next;
        setTile(next);
    }
    function arrive(at: number, station?: CoastStation) {
        if (room.doors.includes(at)) { leave(); return; }
        const stair = room.stairs.find(entry => entry.tile === at);
        if (stair) {
            setMessage("");
            move(stair.arrival);
            setLevel(stair.to);
        } else if (station) {
            if (onStation) { onStation(station); return; }
            const asked = clues?.find(entry => entry.floor === level && entry.station === station.name);
            if (asked) {
                const token = journey.current;
                setMessage("…");
                void asked.examine().then(answer => { if (token === journey.current) setMessage(answer.order ? station.locked || answer.text : answer.text); });
                return;
            }
            if (station.clue === clue.current + 1) clue.current++;
            setMessage(station.clue && station.clue > clue.current ? station.locked || "An earlier clue is missing." : station.detail);
        } else {
            setMessage(room.stations.some(entry => entry.approach === at) ? "Press Enter to inspect." : "");
        }
    }
    async function walk(to: number, station?: CoastStation, then?: () => void) {
        const token = ++journey.current;
        const route = pathTo(room.mask, position.current, to);
        if (!route) { setMessage("There is no open path to that spot."); return; }
        setMessage("");
        const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 85;
        for (const next of route) {
            if (token !== journey.current) return;
            move(next);
            if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
        }
        if (token === journey.current) { if (then) then(); else arrive(to, station); }
    }
    function key(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.currentTarget !== event.target || event.altKey || event.ctrlKey || event.metaKey) return;
        const at = position.current;
        if (event.key === "Enter") {
            event.preventDefault(); journey.current++;
            arrive(at, room.stations.find(entry => entry.approach === at));
            return;
        }
        const delta = STEP[event.key];
        if (!delta) return;
        event.preventDefault(); journey.current++;
        const next = at + delta;
        if (neighbours(at).includes(next) && open(room.mask, next)) { move(next); arrive(next); }
    }
    const actions = [
        ...room.stations.map(station => ({ label: station.name, target: station.target, use: () => void walk(station.approach, station) })),
        ...room.stairs.map(stair => ({ label: stair.label, target: stair.target, use: () => void walk(stair.tile) })),
    ];
    return <div className={street ? "coast-room stairs-street" : onStation ? "coast-room stairs-counter-room" : "coast-room"}>
        <div className="coast-board coast-room-board" ref={board} tabIndex={0} role="application"
            data-floor={level + 1} data-tile={tile} aria-label={room.title + ". Arrow keys walk. Enter inspects."}
            onKeyDown={key} onClick={event => {
                const box = event.currentTarget.getBoundingClientRect();
                const x = Math.floor((event.clientX - box.left) * GRID / box.width);
                const y = Math.floor((event.clientY - box.top) * GRID / box.height);
                if (x >= 0 && x < GRID && y >= 0 && y < GRID) void walk(y * GRID + x);
                board.current?.focus({ preventScroll: true });
            }}>
            {room.art && <img className="coast-floor" src={room.art.startsWith("/") ? room.art : "/coast-map/" + room.art} alt={room.title} draggable={false} />}
            {actions.map(({ label, target: [x, y, width, height], use }) => <button key={label} aria-label={label} title={label} className="coast-site" type="button"
                style={footprintStyle(x, y, width, height)}
                onClick={event => { event.stopPropagation(); use(); }}>{onStation && <span>{label}</span>}</button>)}
            {residents?.map(resident => <CoastFigure key={resident.label} scale={figureScale} tile={resident.approach} feet={resident.feet} seatedArt={resident.seatedArt}
                model={resident.model} label={resident.label} image={"/coast-map/residents/" + resident.model + ".webp"} disabled={false}
                pick={() => { void walk(resident.approach, undefined, () => onSpeak?.(resident.label)); }} />)}
            {!level && keeper?.room && keeper.image && <span className="coast-traveler" style={{ left: keeper.room[0] / GRID * 100 + "%", top: keeper.room[1] / GRID * 100 + "%" }}>
                <img src={keeper.image} alt={keeper.label} style={{ objectPosition: "top" }} />
            </span>}
            {player ? <SettlementPlayer character={player} avatar={avatar} tile={tile} scale={figureScale} /> : <span className="coast-traveler" style={centre(tile)} aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : <b>{name.slice(0, 2)}</b>}</span>}
        </div>
        <div className="coast-site-body">
            <h3>{room.title}{floors.length > 1 && " · Floor " + (level + 1) + " of " + floors.length}</h3>
            <div className="coast-list">{actions.map(action => <button key={action.label} type="button" onClick={action.use}>{action.label}</button>)}
                {!!room.doors.length && <button type="button" onClick={() => void walk(room.doors[0])}>Walk outside</button>}
            </div>
            <p className="coast-world-status" role="status">{message}</p>
        </div>
    </div>;
}
