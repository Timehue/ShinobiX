import { useEffect, useRef, useState } from "react";
import type { Character } from "../../types/character";
import type { Screen } from "../../types/core";
import { ClanImageMark } from "../../components/Marks";
import { DayNightSky } from "../../components/DayNightSky";
import { SceneAmbience } from "../../components/SceneAmbience";
import { fetchClanData } from "../../lib/clan-api";
import { FACILITY_PRESENTATION, type FacilityId } from "../../lib/facility-presentation";
import { VillageFacilityTile } from "../../components/VillageFacilityTile";
import { coastMessage, coastPost, type Landing } from "./coast-service";
import { changeTownPresence } from "./clan-town-presence";
import CoastLandingPlans from "./CoastLandingPlans";
import "./ClanTown.css";

type Town = NonNullable<Landing["landing"]> & { town: FacilityId[] };
type Status = { inTown: boolean; clan: string; landing: Town | null };
type Props = { character: Character; sector: number; leave: () => void; open: (screen: Screen) => void };
const positions = [
    [[24,54],[80,58]],
    [[17,50],[84,63],[53,45],[33,63],[68,51]],
    [[47,38],[73,57],[22,43],[15,65],[75,35],[52,68],[33,63],[88,70]],
];

export default function ClanTown({ character, sector, leave, open }: Props) {
    const [town, setTown] = useState<Town | null>(null);
    const [clan, setClan] = useState("");
    const [image, setImage] = useState("");
    const [error, setError] = useState("");
    const [attempt, retry] = useState(0);
    const [room, setRoom] = useState(false);
    const [busy, setBusy] = useState(false);
    const gate = useRef(false);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        if (room) return;
        let active = true;
        async function arrive() {
            try {
                const entered = await changeTownPresence("town-enter");
                if (!active) return;
                const state = await coastPost<Status>("landing", { action: "status" });
                if (!active) return;
                if (!state.inTown || entered.sector !== sector || state.landing?.sector !== sector || !state.landing.town.length) {
                    setError("Your visit has ended. Return to the sector to enter again.");
                    return;
                }
                setClan(state.clan);
                setTown(state.landing);
                const record = await fetchClanData(state.clan);
                if (active) setImage(record?.image ?? "");
            } catch (cause) { if (active) setError(coastMessage(cause)); }
        }
        void arrive();
        return () => { active = false; };
    }, [sector, character.name, character.clan, attempt, room]);

    async function choose(id?: FacilityId | "interior") {
        if (gate.current) return;
        gate.current = true;
        setBusy(true);
        try {
            if (!id) {
                await changeTownPresence("town-leave");
                if (mounted.current) leave();
            } else {
                const state = await coastPost<Status>("landing", { action: "status" });
                if (!mounted.current) return;
                const landing = state.landing;
                if (state.inTown && landing?.sector === sector && landing.town.length) {
                    if (id === "interior") { setTown(landing); setRoom(true); return; }
                    if (landing.town.includes(id)) { open(FACILITY_PRESENTATION[id].screen); return; }
                }
                setTown(null);
                setError("This facility is closed. Return to the sector to enter again.");
            }
        } catch (cause) { if (mounted.current) setError(coastMessage(cause)); }
        finally { gate.current = false; if (mounted.current) setBusy(false); }
    }

    if (room && town) return <section className="card clan-town"><CoastLandingPlans tier={town.tier} name={character.name} avatar={character.avatarImage} leave={() => { setTown(null); setError(""); setRoom(false); }} /></section>;
    const mark = <ClanImageMark name={clan} image={image} />;
    return <main className="clan-town" aria-label="Clan town">
        {town && <><header className="stairs-header">{mark}<div><small>{clan} · Sector {sector}</small><h2>{town.name}</h2></div></header>
            <div className="clan-town-map">
                <div className="clan-town-paint" style={{ backgroundImage: "url(/coast-map/town/tier-" + town.tier + ".webp)" }}>
                    <DayNightSky className="amb-under" /><SceneAmbience className="amb-under" biome="forest" />
                    <span className="clan-town-standard" aria-hidden="true">{mark}</span>
                </div>
                <nav className="clan-town-tiles" aria-label="Town facilities">{town.town.map((id, index) => {
                    if (!Object.hasOwn(FACILITY_PRESENTATION, id)) return null;
                    return <VillageFacilityTile key={id} id={id} village={character.village} position={positions[town.tier - 1]?.[index]}
                        disabled={busy} enter={() => void choose(id)} />;
                })}</nav>
            </div>
            <div className="clan-town-works">{town.works?.filter(work => work.built).map(work => <figure key={work.id}>
                <img src={"/coast-map/landing/" + work.id + "-v1.webp"} alt="" /><figcaption>{work.name}</figcaption>
            </figure>)}</div></>}
        {error ? <p role="status">{error}</p> : !town && <p role="status">Entering the clan town…</p>}
        <footer>{town && <button type="button" disabled={busy} onClick={() => void choose("interior")}>Walk inside the hall</button>}
            {error && !town && <button type="button" disabled={busy} onClick={() => { setError(""); retry(n => n + 1); }}>Try again</button>}
            {(town || error) && <button type="button" disabled={busy} onClick={() => void choose()}>Walk out to sector {sector}</button>}
        </footer>
    </main>;
}
