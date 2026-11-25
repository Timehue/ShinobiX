import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CoastSite, QuestLinesList } from "../../lib/quest-lines-api";
import type { CoastWorldProps } from "./CoastWorld";
import CoastInterior from "./CoastInterior";
import { DEN, KITCHEN, SHOP, den, residentSpots, shop, street, type Door } from "./stair-houses-rooms";

const Shop = lazy(() => import("../../components/Shop").then(module => ({ default: module.Shop })));
const NoodleDen = lazy(() => import("../Cafeteria").then(module => ({ default: module.Cafeteria })));
type Props = Pick<CoastWorldProps, "character" | "creatorItems" | "onVersionedCharacter"> & {
    site: CoastSite; avatar?: string | null; leave: () => void; people: NonNullable<QuestLinesList["coast"]["people"]>;
};

export default function StairHouses({ site, avatar, character, creatorItems, onVersionedCharacter, leave, people }: Props) {
    const [place, setPlace] = useState<Door | "Street">("Street");
    const [atCounter, setCounter] = useState(false);
    const [speaker, setSpeaker] = useState("");
    const [streetTile, setStreetTile] = useState(street.spawn);
    const [counterTile, setCounterTile] = useState<number>();
    const heading = useRef<HTMLHeadingElement>(null);
    const outdoors = place === "Street";
    const floors = place === KITCHEN ? site.floors : [place === SHOP ? shop : place === DEN ? den : street];
    const neighbours = people.filter(resident => residentSpots[resident.label]?.place === place);
    const person = neighbours.find(resident => resident.label === speaker);
    const back = () => {
        setSpeaker("");
        if (atCounter) setCounter(false);
        else if (outdoors) leave();
        else { setPlace("Street"); setCounterTile(undefined); }
    };
    useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [place, atCounter]);
    return <main className="stair-houses" aria-label={site.name}>
        <header className="stairs-header">
            <div><small>{outdoors ? "Saltstair Landing · Sector 105" : site.name}</small>
                <h2 tabIndex={-1} ref={heading}>{outdoors ? site.name : place}</h2></div>
            <button type="button" onClick={back}>{atCounter ? "Back to the room" : outdoors ? "Leave settlement" : "Back to the street"}</button>
        </header>
        <Suspense fallback={<p role="status">Entering…</p>}>
            {atCounter && place === SHOP ? <Shop character={character} creatorItems={creatorItems} onVersionedCharacter={onVersionedCharacter} onBack={back} settlement={place} />
            : atCounter && place === DEN ? <NoodleDen character={character} onVersionedCharacter={onVersionedCharacter} onBack={back} settlement={place} />
            : floors?.length && <><CoastInterior commit={onVersionedCharacter} key={character.name + place} dutySite={place === KITCHEN ? site : undefined} player={character} floors={floors} avatar={avatar} leave={back}
                initialTile={outdoors ? streetTile : counterTile} street={outdoors}
                residents={neighbours.map(resident => ({ ...residentSpots[resident.label], label: resident.label, model: resident.model }))}
                onSpeak={setSpeaker}
                onStation={place === KITCHEN ? undefined : station => {
                    setSpeaker("");
                    if (outdoors && (station.name === SHOP || station.name === DEN || station.name === KITCHEN)) {
                        setStreetTile(station.approach); setPlace(station.name);
                    } else { setCounterTile(station.approach); setCounter(true); }
                }} />
                {!!neighbours.length && <section className="stairs-residents" aria-label="Residents">
                    <p role="status">{person && <><strong>{person.label}</strong> {person.say}</>}</p>
                    <details><summary>Residents · {neighbours.length}</summary><ul>{neighbours.map(resident =>
                        <li key={resident.label}>{resident.label}</li>)}</ul></details>
                </section>}</>}
        </Suspense>
    </main>;
}

