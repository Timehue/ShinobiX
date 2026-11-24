/*
 * The Unmapped Coast: the second world, across the sea (level 75 or higher).
 *
 * WorldMap hands the screen to this module whenever the player stands in a
 * coast sector (ids 101 to 150). It draws two things: the coast's atlas, and
 * the sector the player is in, with its painted floor, its sites and its
 * trails. The map itself comes from the server (/api/coast/world), so nothing
 * of the coast is carried in the bundle.
 *
 * Walking uses the server's continuous-world cursor. The atlas and the boat use timed travel.
 */
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character, PlayerRecord } from "../../types/character";
import { findSectorSpectatorBattle } from "../../lib/sector-spectate";
import type { Biome, Screen } from "../../types/core";
import { ModalDialogScrim } from "../../components/ModalDialogScrim";
import { QuestLinesPanel } from "../../components/QuestLinesPanel";
import { resolveOwnAvatar } from "../../lib/own-avatar";
import { getLocalSectorTile, setLocalSectorTile } from "../../lib/presence-store";
import { requestContinuousWorldWalk } from "../../lib/continuous-world-control";

import { travelMaskMs } from "../../lib/travel-mask";
import {
    coastTravel, loadCoastWorld, loadQuestLines, questLineAction, questRefusal, questSiteGather,
    type CoastSector, type CoastSite, type CoastWorld as CoastWorldData, type QuestLinesList,
} from "../../lib/quest-lines-api";
import { HOME_HARBOR_SECTOR, coastRegionOf } from "../../../../shared/world-maps";
import { ContinuousWorldSector } from "../../components/ContinuousWorldSector";
import { visiblePoll } from "../../lib/poll";
import { CoastWeather } from "./CoastWeather";
import { SectorHudFrame } from "../../components/SectorHudFrame";
import { CoastNearby } from "./CoastNearby";
import type { GameItem } from "../../types/combat";
import { CoastFigure, CoastPatrols } from "./CoastPatrols";
import { GameArtIcon } from "../../components/GameArtIcon";
import CoastExplore from "./CoastExplore";
import { CoastClanPanel } from "./CoastClan";
import { useCoastGround } from "./coast-service";
import { CoastFieldBoundary } from "./CoastFieldBoundary";
import { CoastPlotArt } from "./CoastPlotArt";
import { atlasPlate, plotPaint } from "./coast-plot";
import "./CoastWorld.css";


import { footprintStyle } from "./coast-grid";

const StairHouses = lazy(() => import("./StairHouses"));
const CoastInterior = lazy(() => import("./CoastInterior"));
const CoastLandingPlans = lazy(() => import("./CoastLandingPlans"));
const entering = <p role="status">Entering…</p>;

export type CoastWorldProps = Readonly<{
    character: Character;
    /** The coast sector the player stands in. */
    sector: number;
    setCurrentSector: (sector: number) => void;
    setCurrentBiome: (biome: Biome) => void;
    setScreen: (screen: Screen) => void;
    onVersionedCharacter: (character: Character, version: unknown) => boolean;
    setTravelingUntil: (until: number) => void;
    setPendingTravel: (travel: { destinationSector: number; arrivalAt: number } | null) => void;
    creatorItems: GameItem[];
    sharedImages?: Record<string, string>;
    /** The home map's world attack and spectating (WorldMap passes all of its props through). */
    sectorAttackPlayer?: (opponent: PlayerRecord) => void | Promise<void>;
    setPvpBattleId?: (id: string) => void;
    setPvpRole?: (role: "p1" | "p2") => void;
    setPvpBattleContext?: (context: { spectatingFromSector: number }) => void;
}>;


const ART = "/coast-map/";

const TOOL = { harvesting: "harvest kama", mining: "pickaxe", fishing: "fishing kunai" } as const;
const WORK = { harvesting: "Harvest", mining: "Mine", fishing: "Fish" } as const;
const MARKER = { harvesting: "markers/harvest-v1.webp", mining: "markers/mine-v1.webp", fishing: "markers/fish-v1.webp" } as const;

const pause = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
const clock = () => Date.now();
/** A fresh id for one gathering attempt, in the form the server asks for. */
const attemptId = () => `coast-${crypto.randomUUID().replace(/-/g, "")}`;

export function CoastWorld({ character, sector, setCurrentSector, setCurrentBiome, setScreen, onVersionedCharacter, setTravelingUntil, setPendingTravel, sharedImages, creatorItems,
    sectorAttackPlayer, setPvpBattleId, setPvpRole, setPvpBattleContext }: CoastWorldProps) {
    const [world, setWorld] = useState<CoastWorldData | null>(null);
    const [failed, setFailed] = useState(false);
    const [atlasOpen, setAtlasOpen] = useState(false);
    const [tile, setTile] = useState(() => getLocalSectorTile());
    const [siteId, setSiteId] = useState<string | null>(null);
    const [view, setView] = useState<"entry" | "room" | "plans">("entry");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [quests, setQuests] = useState<QuestLinesList | null>(null);

    const [questKey, setQuestKey] = useState(0);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        void loadCoastWorld().then(next => { if (alive.current) { setWorld(next); setFailed(!next); } });
    }, [attempt]);
    const load = () => { setFailed(false); setAttempt(count => count + 1); };

    useEffect(() => {
        let active = true;
        void loadQuestLines(character.name).then(next => { if (active && next) setQuests(next); });
        return () => { active = false; };
    }, [character.name, sector, questKey, atlasOpen]);

    const layout: CoastSector | undefined = world?.sectors[sector];
    const site = layout?.sites.find(entry => entry.id === siteId) ?? null;
    const ground = useCoastGround(atlasOpen || layout?.contestable ? JSON.stringify([character.name, character.clan, sector, atlasOpen]) : "");
    const refreshGround = useEffectEvent(ground.reload);
    useEffect(() => {
        if (layout?.contestable && !atlasOpen && !site) return visiblePoll(() => refreshGround(), 120_000);
    }, [sector, layout?.contestable, atlasOpen, site]);
    const areas = ground.lands.data?.sectors;
    const area = areas?.find(row => row.sector === sector);
    const plot = plotPaint(sector, ground.base.data);
    const isPlot = (id: string) => id.endsWith("-plot-" + sector);
    const entryScene = site && ((isPlot(site.id) && plot.scene) || (site.scene && ART + site.scene));

    // Close a site's sheet as soon as authority moves to another sector.
    const [placedIn, setPlacedIn] = useState<number | null>(null);
    if (layout && placedIn !== sector) {
        setPlacedIn(sector);
        setView("entry");
        setSiteId(null);
        setStatus("");
    }

    useEffect(() => {
        if (!layout) return;
        setCurrentBiome(layout.biome as Biome);
    }, [layout, sector, setCurrentBiome]);

    function enterTown() {
        if (busy) return;
        setScreen("clanTown");
    }

    function leaveSite() {
        setSiteId(null);
        setView("entry");
    }

    function visit(target: CoastSite) {
        if (busy) return;
        if (!requestContinuousWorldWalk(sector, target.approach, () => setSiteId(target.id))) {
            setStatus("Connecting to the coast. Try again in a moment.");
        }
    }

    /** A timed crossing: the boat, or a pin on the atlas. The server mints the wait. */
    async function travel(destination: number, label: string) {
        if (busy) return;
        setBusy(label);
        setStatus("");
        const reply = await coastTravel({ destinationSector: destination });
        if (!reply.ok) { if (alive.current) { setBusy(null); setStatus(reply.error ?? ""); } return; }
        const wait = travelMaskMs(reply.travelMs), arrivalAt = clock() + wait;
        setPendingTravel({ destinationSector: destination, arrivalAt });
        setTravelingUntil(arrivalAt);
        await pause(wait);
        // Arrival is committed even if this screen has gone: the player did travel.
        if (typeof reply.arrivalTile === "number") setLocalSectorTile(reply.arrivalTile);
        setPendingTravel(null);
        setTravelingUntil(0);
        setCurrentSector(destination);
        if (alive.current) { setBusy(null); setAtlasOpen(false); }
    }

    async function gather(target: CoastSite) {
        if (busy || !target.gather) return;
        setBusy(WORK[target.gather]);
        setStatus("");
        const requestId = attemptId();
        const started = await questSiteGather({ action: "start", nodeId: target.id, mode: "relaxed", requestId });
        if (started.character) onVersionedCharacter(started.character, started._saveVersion);
        if (!started.ok) { if (alive.current) { setBusy(null); setStatus(started.error ?? ""); } return; }
        await pause(3_200);
        let done = await questSiteGather({ action: "resolve", requestId });
        if (!done.ok) { await pause(900); done = await questSiteGather({ action: "resolve", requestId }); }
        if (done.character) onVersionedCharacter(done.character, done._saveVersion);
        if (!alive.current) return;
        setBusy(null);
        const receipt = done.receipt;
        setStatus(!done.ok ? done.error ?? ""
            : receipt?.outcome === "success" ? `The work paid off. You have one more.${receipt.toolBroke ? " Your tool broke on the last stroke." : ""}`
            : `Nothing came of that attempt.${receipt?.toolBroke ? " Your tool broke." : ""}`);
        setQuestKey(key => key + 1);
    }

    /** The clues a quest step asks for inside this site, each examined on the server, which keeps what was found. */
    function siteClues(target: CoastSite) {
        const line = quests?.lines.find(entry => entry.state === "active" && entry.stage?.clues?.length
            && entry.stage.place?.sector === sector && entry.stage.place.name === target.name);
        return line?.stage?.clues?.map(clue => ({ floor: clue.floor, station: clue.station, examine: async () => {
            const reply = await questLineAction(character.name, "examine", line.id, { clueKey: clue.key });
            if (reply.ok) setQuestKey(key => key + 1);
            const talk = Array.isArray(reply.talk) ? reply.talk as { speaker: string; text: string }[] : [];
            return { order: reply.reason === "clue-order", text: reply.ok ? talk.map(say => (say.speaker ? `${say.speaker}: ` : "") + say.text).join(" ") : questRefusal(reply) };
        } }));
    }

    const avatar = resolveOwnAvatar(character, sharedImages);
    const questPanel = <QuestLinesPanel playerName={character.name} mode="sector" sector={sector} onVersionedCharacter={onVersionedCharacter} onLoaded={setQuests} refreshKey={questKey} character={character} sharedImages={sharedImages} />;

    if (!world || !layout) {
        return (
            <main className="coast-world coast-world--waiting">
                <p role="status">{failed ? "The coast's charts could not be read." : "Reading the coast's charts…"}</p>
                {failed && <button type="button" onClick={load}>Try again</button>}
                <button type="button" onClick={() => setScreen("village")}>Return to your village</button>
            </main>
        );
    }

    const region = coastRegionOf(sector);
    const trails = (onMap: boolean) => layout.exits.map(({ id, tile, direction, destinationSector, destinationTile }) => {
        const destination = world.sectors[destinationSector];
        const label = 'Follow the ' + direction + ' trail to ' + (destination?.name ?? destinationSector);
        return <button key={id} type="button" title={label} disabled={!!busy || !destination}
            className={onMap ? 'coast-site' : undefined}
            style={onMap ? footprintStyle(tile % 12, Math.floor(tile / 12), 1) : undefined}
            onClick={() => requestContinuousWorldWalk(destinationSector, destinationTile)}>{!onMap && label}</button>;
    });
    const openRegion = quests?.coast.region ?? 0;
    const questSite = site ? quests?.sites.find(entry => entry.id === site.id) : undefined;
    /** True where a quest can be taken or moved on: a whole sector for the atlas, or one site in the sector the player stands in. */
    const questHere = (at: number, siteId?: string) => !!quests?.coast.places?.some(place => place.sector === at && (!siteId || place.site === siteId));

    const statusLine = <p className="coast-world-status" role="status">{busy ? `${busy}…` : status}</p>;
    const questMark = <GameArtIcon kind="scroll" size={28} className="coast-quest-mark" title="A quest has something for you here" />;
    const clanPanel = <CoastClanPanel ground={ground} key={sector} plot={site?.id === "saltstair-plot-108"}
        character={character} sector={sector} commit={onVersionedCharacter} enter={busy ? undefined : enterTown} />;
    const settlement = layout.sites.find(entry => entry.id === "saltstair-houses-105");
    if (settlement && site === settlement) return <Suspense fallback={entering}>
        <StairHouses site={site} character={character} creatorItems={creatorItems} avatar={avatar} leave={leaveSite}
            onVersionedCharacter={onVersionedCharacter} people={quests?.coast.people?.filter(person => person.sector === sector) ?? []} />
    </Suspense>;
    return (
        <div className={atlasOpen ? "coast-world" : "map-instance"} aria-busy={busy ? true : undefined}>
            {atlasOpen && <header className="coast-world-head"><h2>Coast map</h2>
                <button type="button" onClick={() => setAtlasOpen(false)}>Sector</button></header>}
            {atlasOpen ? (
                <section className="coast-atlas" aria-label="Map of the Unmapped Coast">
                    <div className="coast-atlas-frame"><div className="coast-atlas-canvas">
                        <img src={ART + world.atlas.image} alt="" draggable={false} />
                        {world.points.map(point => {
                            const destination = world.sectors[point.sector];
                            const reachable = !!destination && point.region <= openRegion && !quests?.coast.sealed?.includes(point.sector);
                            const name = destination?.name ?? "Uncharted";
                            const label = point.sector === sector ? `You are here, ${name}` : reachable ? `Travel to ${name}` : `${name}, not open to you yet`;
                            const holding = areas?.find(row => row.sector === point.sector);
                            const state = atlasPlate(point.sector === sector, !!quests?.coast.sealed?.includes(point.sector), reachable, holding);
                            return (
                                <button key={point.sector} type="button" disabled={!reachable || !!busy || point.sector === sector}
                                    className="coast-pin"
                                    style={{ left: `${point.x / world.atlas.width * 100}%`, top: `${point.y / world.atlas.height * 100}%` }}
                                    title={label}
                                    aria-description={[state, holding?.holder?.clan, holding?.contest?.phase].filter(Boolean).join(" · ")}
                                    aria-label={label}
                                    onClick={() => void travel(point.sector, `Travelling to ${name}`)}>
                                    <img src={ART + "markers/atlas-" + state + "-v1.webp"} alt="" /><span>{point.sector - 100}</span>
                                    {questHere(point.sector) && questMark}
                                </button>
                            );
                        })}
                    </div></div>
                    {statusLine}
                </section>
            ) : (
                <div className="instance-frame sector-instance-frame"><ContinuousWorldSector space={world.space} sector={sector} playerTile={tile}
                    biome={layout.biome as Biome} playerName={character.name} playerAvatarImage={avatar || ""}
                    playerModel={character.playerModel} starterWorldModel={character.starterWorldModel} paused={!!site || !!busy}
                    inspectTile={at => { const place = layout.sites.find(entry => entry.approach === at); if (place) visit(place); }}
                    worldMovementBlocked={() => !!busy || !!site} sharedImages={sharedImages ?? {}} sleeperPeers={[]} showLivePeers
                    onWorldAuthority={(next, at) => {
                        setLocalSectorTile(at); setTile(at);
                        if (next !== sector) setCurrentSector(next);
                    }} overlayLayer={<>
                        {trails(true)}
                        {layout.sites.map(entry => {
                            const [x, y, size] = entry.footprint;
                            return (
                                <button key={entry.id} type="button" className="coast-site" title={entry.name} aria-label={`${entry.verb}: ${entry.name}`}
                                    style={footprintStyle(x, y, size)}
                                    onClick={event => { event.stopPropagation(); void visit(entry); }}>
                                    {entry === settlement && <span className="coast-door-label">The Stair Houses</span>}
                                    {isPlot(entry.id) && <CoastPlotArt paint={plot} area={area} />}
                                    {entry.gather && <img src={ART + MARKER[entry.gather]} alt="" draggable={false} />}
                                    {questHere(sector, entry.id) && questMark}
                                </button>
                            );
                        })}
                        <CoastPatrols mask={layout.mask} key={sector} sector={sector} disabled={!!busy} notify={setStatus} />
                        {/* The keepers at their counters, and the boss a quest has brought the player to: choosing one goes to its place. */}
                        {quests?.coast.figures?.filter(figure => figure.sector === sector).map(figure => (
                            <CoastFigure mask={layout.mask} key={figure.label} tile={figure.tile} model={figure.model} label={figure.label} disabled={!!busy}
                                pick={() => { const place = layout.sites.find(entry => entry.id === figure.site); if (place) void visit(place); }} />
                        ))}
                        {/* The people of the coast (api/quests/_coast-residents.ts). Choosing one shows the line the server picked for this player. */}
                        {quests?.coast.people?.filter(person => !settlement && person.sector === sector).map(person => (
                            <CoastFigure mask={layout.mask} key={person.label} tile={person.tile} model={person.model} label={person.label} disabled={!!busy}
                                pick={() => setStatus(person.label + ": " + person.say)} />
                        ))}
                    </>}>

                    <SectorHudFrame sector={sector} present={!busy} biome={layout.biome as Biome} chatName={character.name}
                        weather={layout.contestable && !areas ? (ground.lands.error ? "Weather unavailable" : "Reading weather…") :
                            <CoastWeather sector={sector} biome={layout.biome} area={area} />}
                        name={layout.name} region={world.regions[region - 1]} questHere={questHere(sector)}
                        explore={<CoastExplore key={sector} character={character} sector={sector} commit={onVersionedCharacter} disabled={!!busy} />}
                        nearby={<CoastNearby sector={sector} name={character.name} village={character.village} images={sharedImages} present={!busy}
                            attack={sectorAttackPlayer}
                            spectate={setPvpBattleId && setPvpRole && setPvpBattleContext ? async (target, isCurrent) => {
                                const battleId = await findSectorSpectatorBattle(target.name, character.name);
                                if (!isCurrent()) throw new Error("This player is no longer available to spectate.");
                                setPvpBattleContext({ spectatingFromSector: sector });
                                setPvpBattleId(battleId); setPvpRole("p1"); setScreen("pvpBattle");
                            } : undefined} />}
                        context={<><button type="button" onClick={() => setAtlasOpen(true)}>Coast map</button>
                            {settlement && <button type="button" disabled={!!busy} onClick={() => void visit(settlement)}>Enter {settlement.name}</button>}
                            {statusLine}</>}
                        details={<div className="coast-side">
                            <h3>Trails</h3><div className="coast-list">{trails(false)}</div>
                            {layout.contestable && !site && clanPanel}
                            {!site && questPanel}
                            <section>
                                <h3>Places</h3>
                                <div className="coast-list">
                                    {layout.sites.map(entry => <button key={entry.id} type="button" disabled={!!busy} onClick={() => visit(entry)}>{entry.verb} <span>{entry.name}</span></button>)}
                                </div>
                            </section>
                            <button type="button" onClick={() => setScreen("village")}>Return to your home village</button>
                        </div>} />
                </ContinuousWorldSector>
                </div>
            )}

            {site && createPortal(
                <ModalDialogScrim label={site.name} onBackdrop={leaveSite} onEscape={leaveSite}>
                    <div className="card coast-site-sheet" onClick={event => event.stopPropagation()}>
                        {view === "room" && site.floors?.length ? <Suspense fallback={entering}>
                            <CoastInterior player={character} key={site.id} floors={site.floors} avatar={avatar} leave={leaveSite}
                                keeper={quests?.coast.figures?.find(figure => figure.site === site.id && figure.room)} clues={siteClues(site)} />
                        </Suspense> : view === "plans" ? <Suspense fallback={<p role="status">Opening plans…</p>}>
                            <CoastLandingPlans player={character} avatar={avatar} leave={leaveSite} />
                        </Suspense> : <>
                        {entryScene && <div className="coast-entry-art"><img className="coast-site-scene" src={entryScene} alt="" />
                            {isPlot(site.id) && <CoastPlotArt paint={{ ...plot, main: plot.scene ? undefined : plot.main }} area={area} />}</div>}
                        <div className="coast-site-body">
                            <p className="coast-world-eyebrow">{site.role}</p>
                            <h3>{site.name}</h3>
                            <p>{site.description}</p>
                            {!!site.floors?.length && <button type="button" onClick={() => setView("room")}>Enter {site.name}</button>}
                            {isPlot(site.id) && clanPanel}
                            {site.id === "saltstair-plot-108" && <button type="button" onClick={() => setView("plans")}>View building plans</button>}
                            {questPanel}
                            {site.gather && (questSite ? (
                                <div className="coast-gather">
                                    <p>You hold {questSite.have}{questSite.kept ? "" : " of " + questSite.need}. You have {questSite.remaining} of 3 attempts here before it must rest. It takes a {TOOL[site.gather]} and skill level {questSite.level}.</p>
                                    <button type="button" disabled={!!busy || questSite.remaining < 1} onClick={() => void gather(site)}>{busy === WORK[site.gather] ? "Working…" : WORK[site.gather]}</button>
                                </div>
                            ) : <p className="hint">There is nothing here you have a use for yet. A quest will send you back.</p>)}
                            {(site.boat || (site.id === "brackwater-dock-116" && quests?.coast.docks?.some(dock => dock.sector === sector))) && <button type="button" disabled={!!busy} onClick={() => { setSiteId(null); void travel(HOME_HARBOR_SECTOR, "Sailing home"); }}><img className="coast-slip-boat" src="/coast-map/boats/shuttered-boat-coast-v1.webp" alt="" />Sail home to the Western Piers</button>}
                            {statusLine}
                            <button type="button" onClick={leaveSite}>Leave</button>
                        </div></>}
                    </div>
                </ModalDialogScrim>,
                document.body,
            )}
        </div>
    );
}

export default function CoastMap(props: CoastWorldProps) {
    const field = <CoastWorld key={props.character.name} {...props} />;
    return props.character.clan ? <CoastFieldBoundary key={props.character.name + "/" + props.character.clan} resume={() => props.setScreen("clanTown")}>{field}</CoastFieldBoundary> : field;
}
