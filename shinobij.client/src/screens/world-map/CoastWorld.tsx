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
import type { CoastJob } from "../../../../shared/coast-work";
import { CoastWatch } from "./CoastWatch";
import { CoastWorkRoutes } from "./CoastWorkRoutes";
import { CoastWorkDialog } from "./CoastWorkDialog";
import { openBuildingCounter } from "../../lib/sector-building-counter";
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
import { coastAtlasGoals } from "./coast-atlas-goals";
import "./CoastWorld.css";


import { footprintStyle } from "./coast-grid";
import { coastFigureMarker } from "../../lib/npc-quest-marker";

const ResourceWorld = lazy(() => import("../../components/ResourceWorld").then(module => ({ default: module.ResourceWorld })));
const SectorBuildings = lazy(() => import("../../components/SectorBuildings").then(module => ({ default: module.SectorBuildings })));
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
    const atlasFrame = useRef<HTMLDivElement>(null);
    const [tile, setTile] = useState(() => getLocalSectorTile());
    const [siteId, setSiteId] = useState<string | null>(null);
    const [view, setView] = useState<"entry" | "room" | "plans">("entry");
    const [jobId, setJobId] = useState<string | null>(null);
    const [nodeId, setNodeId] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState<{ kind: "travel" | "gather"; label: string } | null>(null);
    const [quests, setQuests] = useState<QuestLinesList | null>(null);

    const [questKey, setQuestKey] = useState(0);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        void loadCoastWorld().then(next => { if (alive.current) { setWorld(next); setFailed(!next); } });
    }, [attempt]);
    const load = () => { setFailed(false); setAttempt(count => count + 1); };

    // Narrow screens pan a wider atlas. Start at the player pin without
    // resetting their pan when the quest or holdings data refreshes.
    useEffect(() => {
        const frame = atlasFrame.current;
        const point = world?.points.find(entry => entry.sector === sector);
        if (!atlasOpen || !world || !frame || !point) return;
        frame.scrollLeft = frame.scrollWidth * point.x / world.atlas.width - frame.clientWidth / 2;
    }, [atlasOpen, sector, world]);

    useEffect(() => {
        let active = true;
        void loadQuestLines(character.name).then(next => { if (active && next) setQuests(next); });
        return () => { active = false; };
    }, [character.name, sector, questKey, atlasOpen]);

    const layout: CoastSector | undefined = world?.sectors[sector];
    const site = layout?.sites.find(entry => entry.id === siteId) ?? null;
    const questSite = site ? quests?.sites.find(entry => entry.id === site.id) : undefined;
    const refillAt = questSite?.remaining === 0 ? questSite.refillAt : 0;
    useEffect(() => {
        if (!refillAt) return;
        const timer = window.setTimeout(() => setQuestKey(key => key + 1), Math.max(0, refillAt - clock()) + 250);
        return () => window.clearTimeout(timer);
    }, [refillAt, site?.id]);
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
        setJobId(null);
        setNodeId(layout.resources?.find(node => node.id === character.resourceGathering?.active?.nodeId)?.id ?? null);
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
        if (site?.duty) setQuestKey(key => key + 1);
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
        setBusy({ kind: "travel", label });
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
        setBusy({ kind: "gather", label: WORK[target.gather] });
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
            : receipt?.outcome === "success" ? `The work paid off. You have ${(receipt.count ?? 1) > 1 ? receipt.count : "one"} more.${receipt.toolBroke ? " Your tool broke on the last stroke." : ""}`
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

    const atlasGoals = atlasOpen ? coastAtlasGoals(quests) : null;
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
    const openRegion = quests?.coast.region ?? 0;
    const resources = layout.resources ?? [];
    const selectedNode = resources.find(node => node.id === (nodeId ?? character.resourceGathering?.active?.nodeId));
    const siteNode = resources.find(node => node.siteId === site?.id);
    function walkToWork(at: number, arrived: () => void) {
        // Let the sheet release its movement lock before assigning a destination.
        requestAnimationFrame(() => {
            if (alive.current && !requestContinuousWorldWalk(sector, at, arrived)) setStatus("Connecting to the coast. Try again in a moment.");
        });
    }
    function workNode(node: NonNullable<CoastSector["resources"]>[number]) {
        if (busy) return;
        leaveSite();
        walkToWork(node.approach, () => setNodeId(node.id));
    }
    const jobs = world.jobs ?? [];
    const progress = quests?.coastWork ?? {};
    const selectedJob = jobs.find(job => job.id === jobId);
    const localJobs = jobs.filter(job => job.steps[0].sector === sector);
    const workPoints = jobs.filter(job => job.steps[progress[job.id] ?? 0]?.sector === sector && (progress[job.id] ?? 0) > 0);
    const jobDone = (job: CoastJob) => (progress[job.id] ?? 0) >= job.steps.length;
    function meet(job: CoastJob, at: number) {
        setJobId(null);
        walkToWork(at, () => setJobId(job.id));
    }
    function openRack() {
        leaveSite();
        walkToWork(102, () => openBuildingCounter({ buildingId: "saltstair-net-rack" }));
    }
    const isOpen = (at: number) => !!world.sectors[at] && coastRegionOf(at) <= openRegion && !quests?.coast.sealed?.includes(at);
    const present = busy?.kind !== "travel";
    /** True where a quest can be taken or moved on: a whole sector for the atlas, or one site in the sector the player stands in. */
    const questHere = (at: number, siteId?: string) => !!quests?.coast.places?.some(place => place.sector === at && (!siteId || place.site === siteId));

    const statusLine = <p className="coast-world-status" role="status">{busy ? `${busy.label}…` : status}</p>;
    const questMark = <GameArtIcon kind="scroll" size={28} className="coast-quest-mark" title="A quest has something for you here" />;
    const clanPanel = <CoastClanPanel ground={ground} key={sector} plot={site?.id === "saltstair-plot-108"}
        character={character} sector={sector} commit={onVersionedCharacter} enter={busy ? undefined : enterTown} />;
    const boatAt = (s: { id: string; boat?: boolean }) => s.boat || (s.id === "brackwater-dock-116" && quests?.coast.docks?.some(dock => dock.sector === sector));
    const boatArt = "/coast-map/boats/shuttered-boat-coast-v1.webp";
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
                    {!!atlasGoals?.size && <div className="coast-atlas-goals">
                        <h3>Active quest destinations</h3>
                        <ul>{[...atlasGoals].map(([at, goals]) => goals.map(goal => <li key={at + ":" + goal.questId}>
                            <strong>Sector {at}{world.sectors[at] ? " · " + world.sectors[at].name : ""}</strong> · {goal.text}
                        </li>))}</ul>
                    </div>}
                    <div className="coast-atlas-frame" ref={atlasFrame}><div className="coast-atlas-canvas">
                        <img src={ART + world.atlas.image} alt="" draggable={false} />
                        {world.points.map(point => {
                            const destination = world.sectors[point.sector];
                            const reachable = isOpen(point.sector);
                            const name = destination?.name ?? "Uncharted";
                            const label = point.sector === sector ? `You are here, ${name}` : reachable ? `Travel to ${name}` : `${name}, not open to you yet`;
                            const holding = areas?.find(row => row.sector === point.sector);
                            const goals = atlasGoals?.get(point.sector)?.map(goal => goal.text) ?? [];
                            const state = atlasPlate(point.sector === sector, !!quests?.coast.sealed?.includes(point.sector), reachable, holding);
                            return (
                                <button key={point.sector} type="button" disabled={!reachable || !!busy || point.sector === sector}
                                    className="coast-pin"
                                    style={{ left: `${point.x / world.atlas.width * 100}%`, top: `${point.y / world.atlas.height * 100}%` }}
                                    title={[`Sector ${point.sector}`, label, ...goals].join(" · ")}
                                    aria-description={[`Sector ${point.sector}`, state, holding?.holder?.clan, holding?.contest?.phase, ...goals].filter(Boolean).join(" · ")}
                                    aria-label={label}
                                    onClick={() => void travel(point.sector, `Travelling to ${name}`)}>
                                    <img src={ART + "markers/atlas-" + state + "-v1.webp"} alt="" /><span>{point.sector}</span>
                                    {questHere(point.sector) && questMark}
                                </button>
                            );
                        })}
                    </div></div>
                    <CoastWorkRoutes world={world} quests={quests} sector={sector} busy={!!busy} go={at => {
                        if (at === sector) setAtlasOpen(false);
                        else void travel(at, "Travelling to " + world.sectors[at].name);
                    }} />
                    {statusLine}
                </section>
            ) : (
                <div className="instance-frame sector-instance-frame"><ContinuousWorldSector space={world.space} sector={sector} playerTile={tile}
                    biome={layout.biome as Biome} playerName={character.name} playerAvatarImage={avatar || ""}
                    playerModel={character.playerModel} starterWorldModel={character.starterWorldModel} paused={!!site || !!busy || !!selectedNode || !!selectedJob}
                    inspectTile={at => { const place = layout.sites.find(entry => entry.approach === at); if (place) visit(place); }}
                    worldMovementBlocked={() => !!busy || !!site || !!selectedNode || !!selectedJob} sharedImages={sharedImages ?? {}} sleeperPeers={[]} showLivePeers
                    onWorldAuthority={(next, at) => {
                        setLocalSectorTile(at); setTile(at);
                        if (next !== sector) setCurrentSector(next);
                    }} overlayLayer={<>
                        {!site && <CoastWatch key={sector} sector={sector} inspect={setStatus} />}
                        {layout.exits.map(({ id, tile, direction, destinationSector, destinationTile }) => {
                            const destination = world.sectors[destinationSector];
                            const label = `Follow the ${direction} trail to ${destination?.name ?? destinationSector}`;
                            const refusal = !quests ? "The coast charts are still loading. Try again in a moment."
                                : isOpen(destinationSector) ? undefined
                                    : quests.coast.sealed?.includes(destinationSector) ? "This route is sealed by a Coast story choice."
                                        : "That region of the coast is not open to you yet.";
                            return <button key={id} type="button" className="coast-site" style={footprintStyle(tile % 12, Math.floor(tile / 12), 1)}
                                title={refusal ? `${label}. ${refusal}` : label} aria-label={label} aria-description={refusal}
                                disabled={!!busy || !destination}
                                onClick={event => {
                                    event.stopPropagation();
                                    if (refusal) setStatus(refusal);
                                    else if (!requestContinuousWorldWalk(destinationSector, destinationTile)) setStatus("Connecting to the coast. Try again in a moment.");
                                }} />;
                        })}
                        {layout.sites.map(entry => {
                            const [x, y, size] = entry.footprint;
                            return (
                                <button key={entry.id} type="button" className="coast-site" title={entry.name} aria-label={`${entry.verb}: ${entry.name}`}
                                    style={footprintStyle(x, y, size)}
                                    onClick={event => { event.stopPropagation(); void visit(entry); }}>
                                    {entry === settlement && <span className="coast-door-label">The Stair Houses</span>}
                                    {isPlot(entry.id) && <CoastPlotArt paint={plot} area={area} />}
                                    {entry.gather && !resources.some(node => node.siteId === entry.id) && <img src={ART + MARKER[entry.gather ?? "fishing"]} alt="" draggable={false} />}
                                    {/* The boat that sails home, moored where the player lands, so it reads as the thing to click. */}
                                    {boatAt(entry) && <img className="coast-site-boat" src={boatArt} alt="" draggable={false} />}
                                    {questHere(sector, entry.id) && questMark}
                                </button>
                            );
                        })}
                        {quests && localJobs.map(job => {
                            const done = jobDone(job);
                            const actorTile = done && job.prop === "tracks" ? job.steps.at(-1)!.tile : job.workerTile;
                            return <CoastFigure key={job.id} mask={layout.mask} tile={actorTile} speakingTile={job.steps[0].tile}
                                prop={{ kind: job.prop, done }} model={job.model} disabled={!!busy}
                                label={job.worker + " · " + (done ? job.finished : job.working)} pick={() => meet(job, job.steps[0].tile)} />;
                        })}
                        {workPoints.map(job => {
                            const point = job.steps[progress[job.id]];
                            return <button type="button" key={job.id} className="coast-site coast-work-point" title={point.action} aria-label={point.action}
                                style={footprintStyle(point.tile % 12, Math.floor(point.tile / 12), .65)} onClick={() => meet(job, point.tile)}>◇</button>;
                        })}
                        {resources.map(node => <button key={node.id} className="coast-site" type="button"
                            aria-label={node.name} style={footprintStyle(node.target % 12, Math.floor(node.target / 12), 1)}
                            onClick={event => { event.stopPropagation(); workNode(node); }}><img src={ART + MARKER[node.activity]} alt="" /></button>)}
                        {sector === 101 && <Suspense fallback={null}><SectorBuildings character={character} sector={sector} tile={tile}
                            commit={onVersionedCharacter} walk={requestContinuousWorldWalk} directRoadWalking={false} onAtlas={() => setAtlasOpen(true)} /></Suspense>}
                        <CoastPatrols mask={layout.mask} key={sector} sector={sector} disabled={!!busy} notify={setStatus} />
                        {/* The keepers at their counters, and the boss a quest has brought the player to: choosing one goes to its place. */}
                        {quests?.coast.figures?.filter(figure => figure.sector === sector).map(figure => (
                            <CoastFigure marker={figure.boss || questHere(sector, figure.site) ? coastFigureMarker(figure) : undefined} mask={layout.mask} key={figure.label} tile={figure.site === "saltstair-dock-101" ? 90 : figure.tile} model={figure.model} prop={figure.site === "saltstair-dock-101" ? { kind: "net", done: false } : undefined} label={figure.site === "saltstair-dock-101" ? figure.label + " · Tending the net rack" : figure.label} disabled={!!busy}
                                pick={() => { const place = layout.sites.find(entry => entry.id === figure.site); if (place) void visit(place); }} />
                        ))}
                        {/* The people of the coast (api/quests/_coast-residents.ts). Choosing one shows the line the server picked for this player. */}
                        {quests?.coast.people?.filter(person => !settlement && person.sector === sector && !localJobs.some(job => job.resident === person.label)).map(person => (
                            <CoastFigure prop={person.label === "A fisher on the rocks" && progress["mend-the-mesh"] >= 3 ? { kind: "net", done: true } : undefined} mask={layout.mask} key={person.label} tile={person.tile} model={person.model} label={person.label} disabled={!!busy}
                                pick={() => setStatus(person.label + ": " + person.say)} />
                        ))}
                    </>}>

                    <SectorHudFrame sector={sector} present={present} biome={layout.biome as Biome} chatName={character.name}
                        weather={layout.contestable && !areas ? (ground.lands.error ? "Weather unavailable" : "Reading weather…") :
                            <CoastWeather sector={sector} biome={layout.biome} area={area} />}
                        name={layout.name} region={world.regions[region - 1]} questHere={questHere(sector)}
                        explore={<CoastExplore key={sector} character={character} sector={sector} commit={onVersionedCharacter} disabled={!!busy} />}
                        nearby={<CoastNearby sector={sector} name={character.name} village={character.village} images={sharedImages} present={present}
                            attack={busy ? undefined : sectorAttackPlayer}
                            spectate={!busy && setPvpBattleId && setPvpRole && setPvpBattleContext ? async (target, isCurrent) => {
                                const battleId = await findSectorSpectatorBattle(target.name, character.name);
                                if (!isCurrent()) throw new Error("This player is no longer available to spectate.");
                                setPvpBattleContext({ spectatingFromSector: sector });
                                setPvpBattleId(battleId); setPvpRole("p1"); setScreen("pvpBattle");
                            } : undefined} />}
                        context={<><button type="button" onClick={() => setAtlasOpen(true)}>Coast map</button>
                            {settlement && <button type="button" disabled={!!busy} onClick={() => void visit(settlement)}>Enter {settlement.name}</button>}
                            {statusLine}</>}
                        details={<div className="coast-side">
                            {layout.contestable && !site && clanPanel}
                            {!site && questPanel}
                            <section>
                                <h3>Places</h3>
                                <div className="coast-list">
                                    {sector === 101 && <button type="button" onClick={openRack}>Help the boatwright <span>Saltstair net rack</span></button>}
                                    {quests && localJobs.map(job => <button type="button" key={job.id} onClick={() => meet(job, job.steps[0].tile)}>{job.worker}<span>{jobDone(job) ? job.finished : job.working}</span></button>)}
                                    {workPoints.map(job => <button type="button" key={job.id} onClick={() => meet(job, job.steps[progress[job.id]].tile)}>{job.steps[progress[job.id]].action}</button>)}
                                    {resources.map(node => <button key={node.id} type="button" disabled={!!busy} onClick={() => workNode(node)}>{WORK[node.activity]} <span>{node.name}</span></button>)}
                                    {layout.sites.map(entry => <button key={entry.id} type="button" disabled={!!busy} onClick={() => visit(entry)}>{entry.verb} <span>{entry.name}</span></button>)}
                                </div>
                            </section>
                            <button type="button" onClick={() => setScreen("village")}>Return to your home village</button>
                        </div>} />
                </ContinuousWorldSector>
                </div>
            )}

            {selectedJob && <CoastWorkDialog key={selectedJob.id} job={selectedJob} index={progress[selectedJob.id] ?? 0}
                speech={quests?.coast.people?.find(person => person.label === selectedJob.resident)?.say}
                character={character} sector={sector} tile={tile} close={() => setJobId(null)} walk={at => meet(selectedJob, at)}
                commit={onVersionedCharacter} update={coastWork => { setQuests(current => current && { ...current, coastWork }); setQuestKey(key => key + 1); }} />}
            {selectedNode && <Suspense fallback={entering}><ResourceWorld key={selectedNode.id} coastNode={selectedNode} onLeave={() => setNodeId(null)}
                character={character} sector={sector} tile={tile} commit={onVersionedCharacter} walk={requestContinuousWorldWalk} onContest={sectorAttackPlayer} /></Suspense>}
            {site && createPortal(
                <ModalDialogScrim label={site.name} onBackdrop={leaveSite} onEscape={leaveSite}>
                    <div className="card coast-site-sheet" onClick={event => event.stopPropagation()}>
                        {view === "room" && site.floors?.length ? <Suspense fallback={entering}>
                            <CoastInterior player={character} commit={onVersionedCharacter} key={character.name + site.id} dutySite={site} floors={site.floors} avatar={avatar} leave={leaveSite}
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
                            {quests?.notebook?.[site.id]?.result && <p>{quests.notebook[site.id].result}</p>}
                            {site.workshop && <p><strong>{site.workshop.worker}</strong> · {site.workshop.title}</p>}
                            {!!site.floors?.length && <button type="button" onClick={() => setView("room")}>Enter {site.name}</button>}
                            {isPlot(site.id) && clanPanel}
                            {site.id === "saltstair-plot-108" && <button type="button" onClick={() => setView("plans")}>View building plans</button>}
                            {site.gather && (questSite ? (
                                <div className="coast-gather">
                                    <p>You hold {questSite.have}{questSite.kept ? "" : " of " + questSite.need}. You have {questSite.remaining} of 3 attempts here before it must rest. It takes a {TOOL[site.gather]} and skill level {questSite.level}.</p>
                                    {refillAt > 0 && <p className="hint">Attempts reset at <time dateTime={new Date(refillAt).toISOString()}>{new Date(refillAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time> (your time).</p>}
                                    <button type="button" disabled={!!busy || questSite.remaining < 1} onClick={() => void gather(site)}>{busy?.kind === "gather" ? "Working…" : site.id === "saltstair-harvest-102" ? "Harvest Wrack Cord" : WORK[site.gather] + " quest material"}</button>
                                </div>
                            ) : <p className="hint">Story materials become available when a quest sends you here.</p>)}
                            {siteNode && <button type="button" disabled={!!busy} onClick={() => workNode(siteNode)}>{WORK[siteNode.activity]} {siteNode.name}</button>}
                            {questPanel}
                            {site.boat && <section><h4>The boatwright’s crew</h4><p>The crew needs binding fibre from Wrack Strand (102), ore from Splitstone Seam (103), and fish from Needle Shoal (104). The net mender at the shoal can use a second pair of hands.</p><button type="button" onClick={openRack}>Visit the net rack</button></section>}
                            {boatAt(site) && <button type="button" disabled={!!busy} onClick={() => { setSiteId(null); void travel(HOME_HARBOR_SECTOR, "Sailing home"); }}><img className="coast-slip-boat" src={boatArt} alt="" />Sail home to the Western Piers</button>}
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
