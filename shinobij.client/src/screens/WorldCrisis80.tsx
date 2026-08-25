import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { BattleTowerFight } from "./BattleTowerFight";
import { PetShowdownBattle } from "../components/PetShowdownBattle";
import { activeCarriedPetIds } from "../lib/entitlements";
import { activeClientBreedingParentIds } from "../lib/pet-breeding";
import { isPetAvailableForColosseum } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { warmShowdownModels } from "../lib/pet-model-preload";
import { fetchShowdownState, forfeitShowdown, submitShowdownTurn, type ShowdownCommand, type ShowdownStateView } from "../lib/pet-showdown-api";
import { fetchTowerState, type TowerHostLoadout, type TowerSession } from "../lib/towers-api";
import { setTowerFightRunId } from "../lib/screen-guards";
import {
    fetchWorldCrisis80,
    settleWorldCrisis80Combat,
    startWorldCrisis80Combat,
    startWorldCrisis80PetBattle,
} from "../lib/world-crisis-80";
import {
    WORLD_CRISIS_80_TITLE,
    WORLD_CRISIS_80_VILLAGES,
    isWorldCrisis80Village,
    worldCrisis80EncounterForVillage,
    worldCrisis80PhaseLabel,
    type WorldCrisis80Projection,
    type WorldCrisis80Village,
} from "../../../shared/world-crisis-80";
import stormveilArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowArt from "../assets/map-landmarks/moonshadow.webp";
import hollowGateMark from "../assets/map-landmarks/hollow-gate.webp";
import reckoningOutskirtsArt from "../assets/world-crisis-80/reckoning-outskirts.webp";
import collectionCellArt from "../assets/world-crisis-80/collection-cell-lineup.webp";
import pursuitPackArt from "../assets/world-crisis-80/pursuit-pack.webp";
import "./WorldCrisis80.css";

const VILLAGE_ART: Record<WorldCrisis80Village, string> = {
    "Stormveil Village": stormveilArt,
    "Ashen Leaf Village": ashenLeafArt,
    "Frostfang Village": frostfangArt,
    "Moonshadow Village": moonshadowArt,
};
const towerCrumbKey = (name: string) => `worldCrisis80.tower.v1.${name.trim().toLowerCase()}`;
const petCrumbKey = (name: string) => `worldCrisis80.pet.v1.${name.trim().toLowerCase()}`;
const enemyRoleLabel = (role: "vanguard" | "skirmisher" | "controller") => role === "skirmisher" ? "hunter" : role === "controller" ? "assessor" : role;

function readCrumb(key: string): { id: string; petIds?: string[] } | null {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as { id?: unknown; petIds?: unknown } | null;
        return parsed && typeof parsed.id === "string"
            ? { id: parsed.id, petIds: Array.isArray(parsed.petIds) ? parsed.petIds.map(String) : undefined }
            : null;
    } catch { return null; }
}
function writeCrumb(key: string, value: { id: string; petIds?: string[] } | null) {
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* best effort */ }
}
function requestId(): string {
    try { return `crisis_${crypto.randomUUID().replace(/-/g, "")}`; }
    catch { return `crisis_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
}
function openWorldNews(setScreen: (screen: Screen) => void) {
    try { sessionStorage.setItem("hall.initialTab", "news"); } catch { /* best effort */ }
    setScreen("hallOfLegends");
}

export function WorldCrisis80({
    character,
    setScreen,
    sharedImages,
    hostLoadout,
    onVersionedCharacter,
    onRecordBattle,
    onSwitch,
}: {
    character: Character;
    setScreen: (screen: Screen) => void;
    sharedImages: Record<string, string>;
    hostLoadout?: TowerHostLoadout;
    onVersionedCharacter?: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onSwitch: () => void;
}) {
    const village = isWorldCrisis80Village(character.village) ? character.village : "Stormveil Village";
    const encounter = worldCrisis80EncounterForVillage(village);
    const [crisis, setCrisis] = useState<WorldCrisis80Projection | null>(null);
    const [towerSession, setTowerSession] = useState<TowerSession | null>(null);
    const [towerRecovery, setTowerRecovery] = useState(() => readCrumb(towerCrumbKey(character.name))?.id ?? "");
    const [petSession, setPetSession] = useState<ShowdownStateView | null>(null);
    const [petTeamIds, setPetTeamIds] = useState<string[]>(() => readCrumb(petCrumbKey(character.name))?.petIds ?? []);
    const [selectedPets, setSelectedPets] = useState<string[]>([]);
    const [launching, setLaunching] = useState<"shinobi" | "companion" | "">("");
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        const next = await fetchWorldCrisis80();
        if (next) { setCrisis(next); setError(""); }
        else setError("The four witness relays could not be reached.");
    }, []);
    useEffect(() => {
        const start = window.setTimeout(() => { void refresh(); }, 0);
        const timer = window.setInterval(() => { void refresh(); }, 12_000);
        return () => { window.clearTimeout(start); window.clearInterval(timer); };
    }, [refresh]);

    useEffect(() => {
        let alive = true;
        const tower = readCrumb(towerCrumbKey(character.name));
        const pet = readCrumb(petCrumbKey(character.name));
        void (async () => {
            if (tower?.id) {
                try {
                    const session = await fetchTowerState(tower.id, character.name);
                    if (alive && session.worldCrisis80) {
                        setTowerRecovery(tower.id);
                        setTowerFightRunId(tower.id);
                        setTowerSession(session);
                        return;
                    }
                } catch { writeCrumb(towerCrumbKey(character.name), null); setTowerRecovery(""); setTowerFightRunId(null); }
            }
            if (pet?.id) {
                const session = await fetchShowdownState(character.name, pet.id);
                if (alive && session) {
                    const teamIds = pet.petIds ?? [];
                    const team = teamIds.map((id) => character.pets.find((candidate) => candidate.id === id)).filter(Boolean) as Pet[];
                    if (!session.finished) await warmShowdownModels(session, team);
                    if (!alive) return;
                    setPetTeamIds(teamIds);
                    setTowerFightRunId(`wcr80pet:${session.sessionId}`);
                    setPetSession(session);
                    return;
                }
                writeCrumb(petCrumbKey(character.name), null);
            }
        })();
        return () => { alive = false; };
    }, [character.name, character.pets]);

    const breeding = useMemo(() => activeClientBreedingParentIds(character), [character]);
    const carried = useMemo(() => new Set(activeCarriedPetIds(character)), [character]);
    const availablePets = useMemo(() => character.pets.filter((pet) => carried.has(pet.id) && isPetAvailableForColosseum(pet, breeding)), [character.pets, carried, breeding]);
    const battlePets = useMemo(() => petTeamIds.map((id) => character.pets.find((pet) => pet.id === id)).filter(Boolean) as Pet[], [petTeamIds, character.pets]);
    const local = crisis?.villages[village];
    const active = crisis?.status === "active" && local?.attackersActive === true;

    async function launchShinobi() {
        if (!active || launching) return;
        setLaunching("shinobi"); setError("");
        try {
            const started = await startWorldCrisis80Combat({ playerName: character.name, sourceId: encounter.sourceId, requestId: requestId(), hostLoadout });
            writeCrumb(towerCrumbKey(character.name), { id: started.runId });
            setTowerRecovery(started.runId);
            setTowerFightRunId(started.runId);
            setTowerSession(started.session);
        } catch (reason) { setError(String((reason as Error)?.message || "The collection cell could not be sealed.")); }
        finally { setLaunching(""); }
    }
    async function resumeShinobi() {
        if (!towerRecovery || launching) return;
        setLaunching("shinobi"); setError("");
        try { setTowerSession(await fetchTowerState(towerRecovery, character.name)); setTowerFightRunId(towerRecovery); }
        catch (reason) { setError(String((reason as Error)?.message || "That battlefield could not be recovered.")); }
        finally { setLaunching(""); }
    }
    async function launchCompanions() {
        if (!active || selectedPets.length !== 3 || launching) return;
        setLaunching("companion"); setError("");
        try {
            const started = await startWorldCrisis80PetBattle({ playerName: character.name, sourceId: encounter.petSourceId, petIds: selectedPets });
            const team = selectedPets.map((id) => character.pets.find((pet) => pet.id === id)).filter(Boolean) as Pet[];
            await warmShowdownModels(started.state, team);
            writeCrumb(petCrumbKey(character.name), { id: started.state.sessionId, petIds: selectedPets });
            setPetTeamIds(selectedPets);
            setTowerFightRunId(`wcr80pet:${started.state.sessionId}`);
            setPetSession(started.state);
        } catch (reason) { setError(String((reason as Error)?.message || "The pursuit pack could not be engaged.")); }
        finally { setLaunching(""); }
    }
    function clearTowerResult() {
        writeCrumb(towerCrumbKey(character.name), null); setTowerRecovery(""); setTowerSession(null); setTowerFightRunId(null); void refresh();
    }
    function clearPetResult() {
        writeCrumb(petCrumbKey(character.name), null); setPetSession(null); setPetTeamIds([]); setTowerFightRunId(null); void refresh();
    }

    if (towerSession) return (
        <BattleTowerFight
            character={character}
            onVersionedCharacter={onVersionedCharacter}
            sharedImages={sharedImages}
            hostLoadout={hostLoadout}
            runId={towerSession.runId}
            initialSession={towerSession}
            onRecordBattle={onRecordBattle}
            settleFn={settleWorldCrisis80Combat}
            settleOnAnyDone
            onLeaveActive={() => setTowerSession(null)}
            onExit={clearTowerResult}
        />
    );
    if (petSession) return (
        <PetShowdownBattle
            initialState={petSession}
            playerPets={battlePets}
            sharedImages={sharedImages}
            submitTurn={(commands: ShowdownCommand[]) => submitShowdownTurn(character.name, petSession.sessionId, commands)}
            onForfeit={() => { void forfeitShowdown(character.name, petSession.sessionId).finally(clearPetResult); }}
            onFinished={() => { writeCrumb(petCrumbKey(character.name), null); setTowerFightRunId(null); void refresh(); }}
            onExit={clearPetResult}
            onRematch={clearPetResult}
        />
    );

    const locked = crisis?.status === "armed" || crisis?.status === "dormant";
    const resolved = crisis?.status === "resolved";
    return (
        <section className={`reckoning reckoning--${crisis?.status ?? "loading"}`} aria-labelledby="reckoning-title">
            <nav className="crisis-chronicle-tabs" aria-label="World crisis chronicle">
                <button type="button" onClick={onSwitch}>Level 37 · Fourfold Breach</button>
                <button type="button" className="is-active" aria-current="page">Level 80 · Hollow Gate Reckoning</button>
            </nav>
            <header className="reckoning__header">
                <button type="button" className="reckoning__back" onClick={() => setScreen("village")}>← Village</button>
                <div><span>Server-wide reckoning · Four witness ledgers</span><h1 id="reckoning-title">{WORLD_CRISIS_80_TITLE}</h1><p>Harrow traced four village bargains to one Sunken Court lattice. The first new level-80 record made those reports agree—and Hollow Gate’s human agents moved to collect the evidence.</p></div>
                <button type="button" className="reckoning__news" onClick={() => openWorldNews(setScreen)}>Watch World News</button>
            </header>
            <div className="reckoning__status" role="status" aria-live="polite">
                <span>{crisis ? worldCrisis80PhaseLabel(crisis.phase) : "Reconciling witnesses"}</span>
                <strong>{crisis ? `${crisis.globalProgressPercent}% CLAIMS BROKEN` : "CONNECTING"}</strong>
                {crisis?.awakenedBy && <small>{crisis.awakenedBy} became the first level-{crisis.triggerLevel} witness</small>}
            </div>
            {error && <div className="reckoning__error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry signal</button></div>}

            <div className="reckoning__layout">
                <div className="reckoning__outskirts" style={{ "--reckoning-art": `url(${reckoningOutskirtsArt})`, "--collection-art": `url(${collectionCellArt})` } as CSSProperties}>
                    <div className="reckoning__ledger">
                        <span aria-hidden="true">四</span><div className="reckoning__ledger-marks" aria-hidden="true"><img src={hollowGateMark} alt="" /><img src={VILLAGE_ART[village]} alt="" /></div><strong>{encounter.ledgerName}</strong><small>{local?.integrityPercent ?? 24}% WITNESS INTEGRITY</small>
                    </div>
                    {encounter.triad.map((enemy, index) => <article key={enemy.name} className={`reckoning__enemy reckoning__enemy--${index + 1}`} style={{ "--portrait-position": `${index * 50}%` } as CSSProperties}><i aria-hidden="true" /><div className="reckoning__enemy-portrait" aria-hidden="true" /><small>{enemyRoleLabel(enemy.role)}</small><strong>{enemy.name}</strong><span>{enemy.specialty}</span></article>)}
                    <div className="reckoning__integrity"><span><b>{village}</b><em>{local?.defenses ?? 0} / {local?.target ?? "?"}</em></span><div><i style={{ width: `${local?.progressPercent ?? 0}%` }} /></div></div>
                </div>

                <aside className="reckoning__operations">
                    <span className="reckoning__eyebrow">Choose your front</span>
                    {towerRecovery && <button type="button" className="reckoning__resume" onClick={() => void resumeShinobi()}>Resume sealed ledger defense</button>}
                    <article className="reckoning__operation reckoning__operation--shinobi">
                        <img className="reckoning__operation-art" src={collectionCellArt} alt="" />
                        <small>ELITE SHINOBI OPERATION · 1 VS 3</small><h2>Break the Collection Cell</h2><p>Face the vanguard, hunter, and assessor together on a contracting tactical field.</p>
                        <ul><li>Three simultaneous enemy turns</li><li>Separate roles and focus policies</li><li>1 verified win advances the ledger</li></ul>
                        <button type="button" onClick={() => void launchShinobi()} disabled={!active || !!launching || !!towerRecovery}>{launching === "shinobi" ? "Sealing three combatants…" : resolved ? "Claims broken" : locked ? "Awaiting the first witness" : "Deploy against all three"}</button>
                    </article>
                    <article className="reckoning__operation reckoning__operation--pets">
                        <img className="reckoning__operation-art" src={pursuitPackArt} alt="" />
                        <small>COMPANION OPERATION · 3 VS 3</small><h2>Hunt the Pursuit Pack</h2><p>Field exactly three carried companions against {encounter.petPackName}. This is a separate front, not an easier copy.</p>
                        <div className="reckoning__pet-grid">
                            {availablePets.map((pet) => { const picked = selectedPets.includes(pet.id); const art = petCardImage(pet, sharedImages); return <button key={pet.id} type="button" className={picked ? "is-picked" : ""} onClick={() => setSelectedPets((ids) => picked ? ids.filter((id) => id !== pet.id) : ids.length < 3 ? [...ids, pet.id] : ids)} aria-pressed={picked}>{art ? <img src={art} alt="" /> : <span aria-hidden="true">{pet.name.slice(0, 1)}</span>}<strong>{pet.name}</strong><small>Lv {pet.level}</small></button>; })}
                        </div>
                        <button type="button" onClick={() => void launchCompanions()} disabled={!active || selectedPets.length !== 3 || !!launching}>{launching === "companion" ? "Calling the pack…" : availablePets.length < 3 ? "Three ready companions required" : `Send companion team (${selectedPets.length}/3)`}</button>
                    </article>
                    <small className="reckoning__authority">Both fronts share one village target. Fights and contribution proofs are resolved by the server; no arena reward or ranked season is involved.</small>
                </aside>
            </div>

            <section className="reckoning__fronts" aria-labelledby="reckoning-fronts-title">
                <header><div><span>Four reports, one case</span><h2 id="reckoning-fronts-title">Every ledger must remain in village hands</h2></div><strong>{crisis?.totalDefenses ?? 0} / {crisis?.totalTarget ?? "?"} verified operations</strong></header>
                <div>{WORLD_CRISIS_80_VILLAGES.map((frontVillage) => { const front = crisis?.villages[frontVillage]; return <article key={frontVillage} className={frontVillage === village ? "is-home" : ""}><img src={VILLAGE_ART[frontVillage]} alt="" /><strong>{frontVillage}</strong><small>{front?.remaining ?? "?"} claims remain</small><span><i style={{ width: `${front?.progressPercent ?? 0}%` }} /></span><em>{front?.shinobiDefenses ?? 0} shinobi · {front?.companionDefenses ?? 0} companion</em></article>; })}</div>
            </section>
        </section>
    );
}
