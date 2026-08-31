/*
 * ⚠ THIS IS NOT THE HOLLOW WARFRONT GAME MODE ANY MORE.
 *
 * Hollow Warfront is now the RITE — four pets a side fighting at once, best of
 * three clashes (docs/hollow-warfront-rite.md, lib/pet-warfront-rite.ts). The
 * three-lane war it replaced is no longer playable: the arena lobby, co-op and
 * the dev harness all launch the Rite.
 *
 * This file survives for ONE reason: the PET LADDER's tactical ladder still
 * resolves and replays on it (api/pet-ladder/_core.ts calls runWarfrontMatch,
 * screens/PetLadder.tsx renders the replay). That is server-authoritative
 * ranked play with existing standings, so the engine cannot simply be swapped.
 *
 * Do not wire this into anything new, and do not let player-facing copy call it
 * "the Warfront" — that name belongs to the Rite.
 */
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    WARFRONT_TPS,
    WF_HAZARDS,
    WF_MUTATORS,
    WF_OMENS,
    WF_SIGNATURES,
    WF_ULTIMATE_FAVOR_COST,
    WF_WARDEN_ASPECTS,
    wfVerdictScore,
    type WarfrontChoice,
    type WarfrontCommandEntry,
    type WarfrontResult,
    type WfBuyPolicy,
    type WfCommandState,
    type WfDoctrine,
    type WfEvent,
    type WfHazard,
    type WfMutator,
    type WfOmen,
    type WfSnapshot,
    type WfStance,
    type WfWardenAspect,
} from "../lib/pet-warfront-sim";
import {
    WF_LANE_IDS,
    WF_LANE_LABEL,
    WF_LANE_Y,
    WF_THEMES,
    type WfLaneId,
    type WfTheme,
} from "../lib/pet-warfront-map";
import { createWarfrontWorkerController } from "../lib/pet-warfront-worker-client";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic, stopBattleMusic } from "../lib/pet-music";
import battlefieldArt from "../assets/warfront-three-lane/warfront-three-lane-ground.webp";
import battlefieldPortraitArt from "../assets/warfront-three-lane/warfront-three-lane-ground-portrait.webp";
import keyArt from "../assets/warfront-three-lane/warfront-three-lane-keyart.webp";
import wardenArt from "../assets/coliseum/boss-warden.webp";
import { petVisualQuality } from "../lib/pet-visual-quality";
import "../styles/pet-warfront-three-lane.css";

const loadPetWarfrontStage3D = () => import("./PetWarfrontStage3D").then((module) => ({ default: module.PetWarfrontStage3D }));
const PetWarfrontStage3D = lazy(loadPetWarfrontStage3D);

type Team = "blue" | "red";
export type WarfrontMatchType = "unranked" | "ranked" | "coop" | "spectator";
const TEAM_LABEL: Record<Team, string> = { blue: "Azure", red: "Crimson" };
const DEFAULT_FORMATION: WfLaneId[] = ["n", "m", "s", "m"];
const COMPACT_WARFRONT_QUERY = "(max-width: 820px), (max-height: 520px), (orientation: portrait)";
const MATCH_TYPE_LABEL: Record<WarfrontMatchType, string> = {
    unranked: "OPEN WARFRONT",
    ranked: "RANKED WARFRONT",
    coop: "CO-OP WARFRONT",
    spectator: "SEALED REPLAY",
};
const STANCE_BRIEF: Record<WfStance, string> = {
    balanced: "No combat modifier.",
    siege: "+14% tower pressure · −6% pet damage · +2s reform time.",
    jungle: "+20% Favor sources · −4% combat and tower damage.",
    headhunt: "+10% pet damage · −12% tower pressure · +1s reform time.",
    turtle: "−12% tower damage taken · −10% pet damage · −20% Favor.",
};
const MODAL_FOCUSABLE = [
    "button:not([disabled])",
    "select:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

function compactWarfrontPresentation(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(COMPACT_WARFRONT_QUERY).matches;
}

const mmss = (seconds: number) => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};
const clamp = (value: number, min: number, max: number) => value < min ? min : value > max ? max : value;

function useDialogFocus<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.focus({ preventScroll: true });
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE))
                .filter((element) => element.getClientRects().length > 0);
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus({ preventScroll: true });
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog.addEventListener("keydown", trapFocus);
        return () => {
            dialog.removeEventListener("keydown", trapFocus);
            if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
        };
    }, []);
    return ref;
}

function petPortrait(slot: ArenaSlot | undefined): string | undefined {
    if (!slot) return undefined;
    const pet = slot.pet as ArenaSlot["pet"] & { bodyImage?: string; image?: string };
    return pet.bodyImage || pet.image || undefined;
}

function snapshotAt(snapshots: readonly WfSnapshot[], tick: number): WfSnapshot | null {
    if (!snapshots.length) return null;
    let lo = 0;
    let hi = snapshots.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (snapshots[mid].t <= tick) lo = mid;
        else hi = mid - 1;
    }
    return snapshots[lo];
}

function boardPosition(x: number, y: number): CSSProperties {
    return {
        left: `${clamp(50 + x / 70 * 100, 3, 97)}%`,
        top: `${clamp(50 + y / 31.5 * 100, 5, 95)}%`,
    };
}

function formationValid(formation: readonly WfLaneId[], teamSize: number): boolean {
    if (formation.length !== teamSize) return false;
    if (teamSize !== 4) return true;
    return WF_LANE_IDS.every((lane) => formation.includes(lane));
}

function actorName(actorId: string, blue: readonly ArenaSlot[], red: readonly ArenaSlot[]): string {
    const match = /^(blue|red)-(\d+)$/.exec(actorId);
    if (match) return (match[1] === "blue" ? blue : red)[Number(match[2])]?.pet.name ?? `${TEAM_LABEL[match[1] as Team]} pet`;
    if (actorId.startsWith("warden-")) return `${TEAM_LABEL[actorId.endsWith("blue") ? "blue" : "red"]} Warden`;
    if (actorId.startsWith("tower-")) return "Ward Tower";
    return "Unknown combatant";
}

function eventLabel(event: WfEvent, blue: readonly ArenaSlot[], red: readonly ArenaSlot[]): string | null {
    if (event.type === "kill") return `${actorName(event.actorId, blue, red)} defeated ${actorName(event.targetId, blue, red)}`;
    if (event.type === "towerfractured") return `${actorName(event.actorId, blue, red)} fractured the ${TEAM_LABEL[event.team]} ${WF_LANE_LABEL[event.lane]} Tower`;
    if (event.type === "towerdown") return `${actorName(event.actorId, blue, red)} broke the ${TEAM_LABEL[event.team]} ${WF_LANE_LABEL[event.lane]} Tower`;
    if (event.type === "redeploy") return `${actorName(event.petId, blue, red)} transferred to ${WF_LANE_LABEL[event.lane]}`;
    if (event.type === "favorready") return `${TEAM_LABEL[event.team]} Warden summon ready`;
    if (event.type === "wardensummon") return `${TEAM_LABEL[event.team]} summoned the ${event.aspect[0].toUpperCase()}${event.aspect.slice(1)} Warden to ${WF_LANE_LABEL[event.lane]}`;
    if (event.type === "wardendown") return event.expired ? `${TEAM_LABEL[event.team]} Warden returned to the seal` : `${TEAM_LABEL[event.by]} felled the enemy Warden`;
    if (event.type === "ultimatearmed") return `${actorName(event.petId, blue, red)} armed ${event.name}`;
    if (event.type === "ultimate") return `${actorName(event.petId, blue, red)} unleashed ${event.name}`;
    if (event.type === "sealexposed") return `${TEAM_LABEL[event.team]} ${WF_LANE_LABEL[event.lane]} seal exposed for ${event.secs}s`;
    if (event.type === "favorsteal") return `${TEAM_LABEL[event.team]} stole ${Math.round(event.amount)} Warden Favor`;
    if (event.type === "lastward") return `${TEAM_LABEL[event.team]} invoked the Last Ward`;
    if (event.type === "riftrally") return `${TEAM_LABEL[event.team]} gained a ${event.secs}s Rift Rally`;
    if (event.type === "hazard") return `${event.label} swept ${WF_LANE_LABEL[event.lane]}`;
    if (event.type === "commandimpact" && event.impact.team === "blue") {
        const impact = event.impact;
        if (impact.towersBroken > 0) return `Your command secured ${impact.towersBroken} tower`;
        return `Command impact · ${impact.towerDamageDealt.toLocaleString()} dealt · ${impact.towerDamageTaken.toLocaleString()} endured`;
    }
    if (event.type === "riftfall") return "RIFTFALL — tower wards have collapsed";
    return null;
}

function laneCount(snapshot: WfSnapshot, team: Team, lane: WfLaneId): number {
    return snapshot.actors.filter((actor) => actor.team === team && actor.lane === lane).length;
}

function lanePressure(snapshot: WfSnapshot, team: Team, lane: WfLaneId): number {
    const actors = snapshot.actors.filter((actor) => actor.team === team && actor.lane === lane && actor.state !== "respawning");
    const petPower = actors.reduce((sum, actor) => sum + 0.55 + actor.hp / Math.max(1, actor.maxHp), 0);
    const warden = snapshot.wardens[team];
    return petPower + (warden.active && warden.lane === lane ? 1.75 : 0);
}

function commandEntryLabel(entry: Pick<WarfrontCommandEntry, "moves" | "summonLane" | "summonAspect" | "ultimatePetIndex" | "ultimateName" | "favorSpent" | "exposedLane">, roster: readonly ArenaSlot[]): string {
    const beats = entry.moves.map((move) => `${roster[move.petIndex]?.pet.name ?? `Pet ${move.petIndex + 1}`} → ${WF_LANE_LABEL[move.lane]}`);
    if (entry.summonLane && entry.summonAspect) beats.push(`${entry.summonAspect} Warden → ${WF_LANE_LABEL[entry.summonLane]}`);
    if (entry.ultimatePetIndex !== undefined) beats.push(`${roster[entry.ultimatePetIndex]?.pet.name ?? `Pet ${entry.ultimatePetIndex + 1}`} · ${entry.ultimateName ?? "Signature"}`);
    if (entry.exposedLane) beats.push(`${WF_LANE_LABEL[entry.exposedLane]} exposed`);
    if (entry.favorSpent) beats.push(`${entry.favorSpent} Favor committed`);
    return beats.length ? beats.join(" · ") : "Hold formation";
}

function majorEventLane(events: readonly WfEvent[], tick: number): WfLaneId | null {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.t > tick) continue;
        if (tick - event.t > WARFRONT_TPS * 2.5) return null;
        if (event.type === "towerdown" || event.type === "towerfractured" || event.type === "wardensummon" || event.type === "wardenslam" || event.type === "ultimate" || event.type === "hazard" || event.type === "sealexposed") return event.lane;
    }
    return null;
}

function directorRate(result: WarfrontResult, tick: number, reducedMotion: boolean): number {
    if (reducedMotion) return 1;
    let recentMajor = false;
    let recentTakedown = false;
    for (let index = result.events.length - 1; index >= 0; index--) {
        const event = result.events[index];
        if (event.t > tick) continue;
        if (tick - event.t > WARFRONT_TPS * 0.75) break;
        if (event.type === "towerdown" || event.type === "towerfractured" || event.type === "wardensummon" || event.type === "wardenslam" || event.type === "ultimate" || event.type === "hazard" || event.type === "lastward") {
            recentMajor = true;
            break;
        }
        if (event.type === "kill") recentTakedown = true;
    }
    if (recentMajor) return 0.72;
    if (recentTakedown) return 0.84;
    const frame = snapshotAt(result.snapshots, tick);
    const engaged = Boolean(frame && (
        frame.actors.some((actor) => actor.state === "attack")
        || frame.wardens.blue.targetId !== null
        || frame.wardens.red.targetId !== null
    ));
    return engaged ? 1 : 1.65;
}

function TowerMarker({ snapshot, team, lane }: { snapshot: WfSnapshot; team: Team; lane: WfLaneId }) {
    const tower = snapshot.towers[team][lane];
    const fraction = tower.hp / Math.max(1, tower.maxHp);
    return (
        <div
            className={`wf3-tower wf3-tower--${team}${tower.alive ? "" : " is-destroyed"}${tower.fractured ? " is-fractured" : ""}${tower.exposedSecs > 0 ? " is-exposed" : ""}${tower.guardSecs > 0 ? " is-guarded" : ""}`}
            style={{ ...boardPosition(tower.x, tower.y), "--tower-hp": `${Math.round(fraction * 100)}%` } as CSSProperties}
            role="img"
            aria-label={`${TEAM_LABEL[team]} ${WF_LANE_LABEL[lane]} Tower ${Math.round(fraction * 100)} percent${tower.exposedSecs > 0 ? ", exposed" : tower.guardSecs > 0 ? ", Last Ward protected" : ""}`}
        >
            <div className="wf3-tower__ring"><span>{tower.alive ? tower.exposedSecs > 0 ? "!" : tower.guardSecs > 0 ? "⬡" : "◆" : "✕"}</span></div>
            <div className="wf3-tower__bar"><i style={{ width: `${Math.max(0, fraction * 100)}%` }} /></div>
        </div>
    );
}

function PetToken({ actor, slot }: {
    actor: WfSnapshot["actors"][number];
    slot: ArenaSlot | undefined;
}) {
    const portrait = petPortrait(slot);
    const hp = actor.hp / Math.max(1, actor.maxHp);
    const down = actor.state === "respawning";
    return (
        <div
            className={`wf3-pet wf3-pet--${actor.team}${down ? " is-down" : ""}${actor.state === "attack" ? " is-attacking" : ""}`}
            style={boardPosition(actor.x, actor.y)}
            role="img"
            aria-label={`${slot?.pet.name ?? "Pet"}, ${TEAM_LABEL[actor.team]}, ${Math.round(hp * 100)} percent health`}
        >
            <div className="wf3-pet__portrait">
                {portrait ? <img src={portrait} alt="" draggable={false} /> : <span>{String(slot?.pet.element ?? "?").slice(0, 1)}</span>}
                <b>{actor.role.slice(0, 1).toUpperCase()}</b>
                {actor.shielded ? <em>◇</em> : null}
            </div>
            <div className="wf3-pet__name">{slot?.pet.name ?? actor.id}</div>
            <div className="wf3-pet__hp"><i style={{ width: `${Math.max(0, hp * 100)}%` }} /></div>
            <div className={`wf3-pet__ultimate${actor.ultimateReady ? " is-ready" : ""}`} title={`${WF_SIGNATURES[actor.role].label} ${Math.floor(actor.ultimateCharge)}%`}><i style={{ width: `${actor.ultimateCharge}%` }} /></div>
            {down ? <div className="wf3-pet__respawn">{Math.ceil(actor.respawnSecs)}s</div> : null}
        </div>
    );
}

function WardenToken({ snapshot, team }: { snapshot: WfSnapshot; team: Team }) {
    const warden = snapshot.wardens[team];
    if (!warden.active) return null;
    const hp = warden.hp / Math.max(1, warden.maxHp);
    return (
        <div
            className={`wf3-warden wf3-warden--${team} wf3-warden--${warden.aspect}`}
            style={boardPosition(warden.x, warden.y)}
            role="img"
            aria-label={`${TEAM_LABEL[team]} ${warden.aspect} Warden, ${Math.round(hp * 100)} percent health, ${Math.ceil(warden.secs)} seconds remaining`}
        >
            <img src={wardenArt} alt="" draggable={false} />
            <strong>{warden.aspect.toUpperCase()}</strong>
            <div><i style={{ width: `${hp * 100}%` }} /></div>
            <small>{Math.ceil(warden.secs)}s</small>
        </div>
    );
}

function LaneRibbon({ snapshot, lane, selected, onSelect }: { snapshot: WfSnapshot; lane: WfLaneId; selected: boolean; onSelect: () => void }) {
    const blueTower = snapshot.towers.blue[lane];
    const redTower = snapshot.towers.red[lane];
    const resolved = !blueTower.alive || !redTower.alive;
    const bluePressure = lanePressure(snapshot, "blue", lane);
    const redPressure = lanePressure(snapshot, "red", lane);
    const pressureDelta = bluePressure - redPressure;
    const pressure = resolved ? "SEALED" : pressureDelta > 0.65 ? "AZURE EDGE" : pressureDelta < -0.65 ? "CRIMSON EDGE" : "CONTESTED";
    const blueHp = Math.round(blueTower.hp / Math.max(1, blueTower.maxHp) * 100);
    const redHp = Math.round(redTower.hp / Math.max(1, redTower.maxHp) * 100);
    return (
        <button type="button" className={`wf3-lane-ribbon${resolved ? " is-resolved" : ""}${selected ? " is-selected" : ""}`} onClick={onSelect} aria-pressed={selected} aria-label={`Focus ${WF_LANE_LABEL[lane]} lane, ${pressure.toLowerCase()}`}>
            <span className="wf3-lane-ribbon__count is-blue" title={`Azure tower ${blueHp}%`}>{laneCount(snapshot, "blue", lane)}</span>
            <div>
                <strong>{WF_LANE_LABEL[lane]}</strong>
                <small>{pressure}</small>
                <span className="wf3-lane-ribbon__towers" aria-label={`Azure tower ${blueHp} percent, Crimson tower ${redHp} percent`}>
                    <i className="is-blue"><b style={{ width: `${blueHp}%` }} /></i>
                    <i className="is-red"><b style={{ width: `${redHp}%` }} /></i>
                </span>
            </div>
            <span className="wf3-lane-ribbon__count is-red" title={`Crimson tower ${redHp}%`}>{laneCount(snapshot, "red", lane)}</span>
        </button>
    );
}

function DeploymentPanel({ blue, formation, omen, mutator, hazard, stance, doctrine, matchType, onChange, onDeploy }: {
    blue: ArenaSlot[];
    formation: WfLaneId[];
    omen: WfOmen;
    mutator: WfMutator;
    hazard: WfHazard;
    stance: WfStance;
    doctrine: WfDoctrine;
    matchType: WarfrontMatchType;
    onChange: (index: number, lane: WfLaneId) => void;
    onDeploy: () => void;
}) {
    const valid = formationValid(formation, blue.length);
    const omenSpec = WF_OMENS.find((entry) => entry.id === omen) ?? WF_OMENS[0];
    const mutatorSpec = WF_MUTATORS.find((entry) => entry.id === mutator) ?? WF_MUTATORS[0];
    const hazardSpec = Object.values(WF_HAZARDS).find((entry) => entry.id === hazard) ?? WF_HAZARDS.central;
    const dialogRef = useDialogFocus<HTMLDivElement>();
    return (
        <div ref={dialogRef} className="wf3-deploy" role="dialog" aria-modal="true" aria-labelledby="wf3-deploy-title" tabIndex={-1}>
            <div className="wf3-deploy__art" style={{ backgroundImage: `linear-gradient(180deg, transparent 45%, rgba(3,7,12,.96)), url(${keyArt})` }}>
                <span>HOLLOW WARFRONT</span>
                <strong>Three fronts. Two towers. One command.</strong>
            </div>
            <div className="wf3-deploy__plan">
                <p className="wf3-eyebrow">{MATCH_TYPE_LABEL[matchType]} · OPENING DEPLOYMENT</p>
                <h2 id="wf3-deploy-title">Commit your squad</h2>
                <p>Every causeway needs a guardian. Your fourth pet creates the opening advantage.</p>
                <div className="wf3-directive-grid">
                    <section className="wf3-omen-card" aria-label={`Hollow Omen: ${omenSpec.label}`}>
                        <b>{omenSpec.icon}</b>
                        <div><small>HOLLOW OMEN</small><strong>{omenSpec.label}</strong><p>{omenSpec.desc}</p></div>
                    </section>
                    <section className="wf3-omen-card is-mutator" aria-label={`Warfront directive: ${mutatorSpec.label}`}>
                        <b>{mutatorSpec.icon}</b>
                        <div><small>WARFRONT DIRECTIVE</small><strong>{mutatorSpec.label}</strong><p>{mutatorSpec.desc}</p></div>
                    </section>
                    <section className="wf3-omen-card is-hazard" aria-label={`Arena hazard: ${hazardSpec.label}`}>
                        <b>{hazardSpec.icon}</b>
                        <div><small>ARENA HAZARD</small><strong>{hazardSpec.label}</strong><p>{hazardSpec.desc}</p></div>
                    </section>
                </div>
                <section className="wf3-plan-tradeoff"><small>SEALED BATTLE PLAN</small><strong>{stance.toUpperCase()} · {doctrine.replace("-", " ").toUpperCase()}</strong><p>{STANCE_BRIEF[stance]}</p></section>
                <div className="wf3-deploy__roster">
                    {blue.map((slot, index) => (
                        <article key={slot.pet.id}>
                            <div className="wf3-deploy__pet">
                                {petPortrait(slot) ? <img src={petPortrait(slot)} alt="" /> : <span>{String(slot.pet.element).slice(0, 1)}</span>}
                                <div><strong>{slot.pet.name}</strong><small>{slot.role} · {slot.pet.element}</small></div>
                            </div>
                            <div className="wf3-segmented" aria-label={`Assign ${slot.pet.name} to a lane`}>
                                {WF_LANE_IDS.map((lane) => (
                                    <button key={lane} type="button" className={formation[index] === lane ? "is-selected" : ""} onClick={() => onChange(index, lane)}>
                                        {WF_LANE_LABEL[lane]}
                                    </button>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
                <div className={`wf3-formation-check${valid ? " is-valid" : ""}`}>
                    {WF_LANE_IDS.map((lane) => <span key={lane}>{WF_LANE_LABEL[lane]} {formation.filter((value) => value === lane).length}</span>)}
                </div>
                <button className="wf3-primary" type="button" disabled={!valid} onClick={onDeploy}>
                    {valid ? "Seal deployment" : "Assign at least one pet to every lane"}
                </button>
            </div>
        </div>
    );
}

function CommandPanel({ command, snapshot, blue, doctrine, onConfirm }: {
    command: WfCommandState;
    snapshot: WfSnapshot;
    blue: ArenaSlot[];
    doctrine: WfDoctrine;
    onConfirm: (choices: WarfrontChoice[]) => void;
}) {
    const dialogRef = useDialogFocus<HTMLDivElement>();
    const [scheduledPet, setScheduledPet] = useState<number | null>(null);
    const [scheduledLane, setScheduledLane] = useState<WfLaneId>(command.activeLanes[0] ?? "m");
    const [breakthrough, setBreakthrough] = useState<Record<number, WfLaneId>>(() => Object.fromEntries(
        command.freedPetSlots.blue.map((slot) => [slot, command.activeLanes[0] ?? "m"]),
    ));
    const [summonLane, setSummonLane] = useState<WfLaneId | "">("");
    const [summonAspect, setSummonAspect] = useState<WfWardenAspect>("breaker");
    const [ultimatePet, setUltimatePet] = useState<number | null>(null);
    const favorCost = snapshot.omen === "thin-veil" ? 80 : snapshot.mutator === "warden-tide" ? 85 : doctrine === "warden-pact" ? 85 : 100;
    const summonReady = snapshot.favor.blue >= favorCost && !snapshot.wardens.blue.active && ultimatePet === null;
    const currentLane = (slot: number) => snapshot.actors.find((actor) => actor.team === "blue" && actor.slot === slot)?.lane;
    const signatureActors = snapshot.actors.filter((actor) => actor.team === "blue" && actor.respawnSecs <= 0 && command.activeLanes.includes(actor.lane));
    const selectedSpend = summonLane ? favorCost : ultimatePet !== null ? WF_ULTIMATE_FAVOR_COST : 0;
    const submit = () => {
        const choices: WarfrontChoice[] = [];
        if (command.reason !== "breakthrough" && scheduledPet !== null && currentLane(scheduledPet) !== scheduledLane) {
            choices.push({ type: "move", petIndex: scheduledPet, lane: scheduledLane });
        }
        if (command.reason === "breakthrough") {
            for (const slot of command.freedPetSlots.blue) choices.push({ type: "move", petIndex: slot, lane: breakthrough[slot] ?? command.activeLanes[0] });
        }
        if (summonReady && summonLane) choices.push({ type: "summon", lane: summonLane, aspect: summonAspect });
        if (ultimatePet !== null) choices.push({ type: "ultimate", petIndex: ultimatePet });
        onConfirm(choices);
    };
    return (
        <div ref={dialogRef} className="wf3-command" role="dialog" aria-modal="true" aria-labelledby="wf3-command-title" tabIndex={-1}>
            <div className="wf3-command__header">
                <p className="wf3-eyebrow">{command.reason === "breakthrough" ? "BREAKTHROUGH REDEPLOY" : command.reason === "omen" ? "SHATTERED-WARD REACTION" : snapshot.omen === "storm-gate" ? "STORM-GATE COMMAND" : "TWO-MINUTE LANE COMMAND"}</p>
                <h2 id="wf3-command-title">{command.reason === "breakthrough" ? `${WF_LANE_LABEL[command.resolvedLane ?? "m"]} is sealed` : command.reason === "omen" ? "Answer the fracture" : "Shift the pressure"}</h2>
                <p>{command.reason === "breakthrough" ? "Every pet on the resolved causeway can reinforce a surviving front." : "Move one pet, hold formation, or commit the Warden."}</p>
            </div>
            <div className="wf3-command__body">
                {command.reason !== "breakthrough" ? (
                    <>
                        <div className="wf3-command__move-grid">
                            <label>
                                <span>Pet to transfer</span>
                                <select value={scheduledPet ?? ""} onChange={(event) => setScheduledPet(event.target.value === "" ? null : Number(event.target.value))}>
                                    <option value="">Hold formation</option>
                                    {blue.map((slot, index) => <option key={slot.pet.id} value={index}>{slot.pet.name} · {WF_LANE_LABEL[currentLane(index) ?? "m"]}</option>)}
                                </select>
                            </label>
                            <label>
                                <span>Destination</span>
                                <select value={scheduledLane} disabled={scheduledPet === null} onChange={(event) => setScheduledLane(event.target.value as WfLaneId)}>
                                    {command.activeLanes.map((lane) => <option key={lane} value={lane}>{WF_LANE_LABEL[lane]}</option>)}
                                </select>
                            </label>
                        </div>
                        {scheduledPet !== null ? <p className="wf3-command__risk"><b>TRANSFER RISK</b> {WF_LANE_LABEL[currentLane(scheduledPet) ?? "m"]} loses its seal protection for 8 seconds.</p> : null}
                    </>
                ) : (
                    <div className="wf3-command__freed">
                        {command.freedPetSlots.blue.map((slot) => (
                            <label key={slot}>
                                <span>{blue[slot]?.pet.name ?? `Pet ${slot + 1}`}</span>
                                <select value={breakthrough[slot]} onChange={(event) => setBreakthrough((current) => ({ ...current, [slot]: event.target.value as WfLaneId }))}>
                                    {command.activeLanes.map((lane) => <option key={lane} value={lane}>{WF_LANE_LABEL[lane]}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                )}
                <section className="wf3-command__signatures" aria-label="Authorize a pet signature ultimate">
                    <header><div><small>SIGNATURE AUTHORIZATION</small><strong>Spend {WF_ULTIMATE_FAVOR_COST} Favor for one ultimate</strong></div><span>{Math.floor(snapshot.favor.blue - selectedSpend)} remaining</span></header>
                    <div>
                        {signatureActors.map((actor) => {
                            const slot = blue[actor.slot];
                            const signature = WF_SIGNATURES[actor.role];
                            const ready = actor.ultimateReady && snapshot.favor.blue >= WF_ULTIMATE_FAVOR_COST && !summonLane;
                            return (
                                <button
                                    key={actor.id}
                                    type="button"
                                    disabled={!ready && ultimatePet !== actor.slot}
                                    className={ultimatePet === actor.slot ? "is-selected" : ""}
                                    aria-pressed={ultimatePet === actor.slot}
                                    onClick={() => {
                                        setUltimatePet((current) => current === actor.slot ? null : actor.slot);
                                        setSummonLane("");
                                    }}
                                >
                                    <b>{signature.icon}</b><span>{slot?.pet.name ?? actor.id}<small>{signature.label}</small></span><em>{Math.floor(actor.ultimateCharge)}%</em>
                                </button>
                            );
                        })}
                    </div>
                </section>
                <section className={`wf3-command__warden${summonReady ? " is-ready" : ""}`}>
                    <img src={wardenArt} alt="" />
                    <div><strong>Gate Warden</strong><small>{Math.floor(snapshot.favor.blue)}/{favorCost} Favor</small></div>
                    <select aria-label="Warden summon lane" value={summonLane} disabled={!summonReady} onChange={(event) => { setSummonLane(event.target.value as WfLaneId | ""); setUltimatePet(null); }}>
                        <option value="">{summonReady ? "Hold summon" : "Gather more Favor"}</option>
                        {command.activeLanes.map((lane) => <option key={lane} value={lane}>Summon · {WF_LANE_LABEL[lane]}</option>)}
                    </select>
                    <div className="wf3-command__aspects" aria-label="Choose Warden Aspect">
                        {WF_WARDEN_ASPECTS.map((aspect) => (
                            <button
                                key={aspect.id}
                                type="button"
                                disabled={!summonReady}
                                className={summonAspect === aspect.id ? "is-selected" : ""}
                                onClick={() => setSummonAspect(aspect.id)}
                                title={aspect.desc}
                                aria-pressed={summonAspect === aspect.id}
                            >
                                <b>{aspect.icon}</b><span>{aspect.label}</span><small>{aspect.desc}</small>
                            </button>
                        ))}
                    </div>
                </section>
                <button className="wf3-primary" type="button" onClick={submit}>Lock command</button>
            </div>
        </div>
    );
}

function CommandReveal({ event, blue, red }: {
    event: Extract<WfEvent, { type: "commandresolved" }>;
    blue: readonly ArenaSlot[];
    red: readonly ArenaSlot[];
}) {
    return (
        <section className="wf3-command-reveal" role="status" aria-live="assertive" aria-label="Commands revealed">
            <p>COMMANDS REVEALED</p>
            <div className="is-blue"><b>AZURE</b><span>{commandEntryLabel(event.blue, blue)}</span></div>
            <i>◇</i>
            <div className="is-red"><b>CRIMSON</b><span>{commandEntryLabel(event.red, red)}</span></div>
        </section>
    );
}

function TransferTrails({ events }: { events: Array<Extract<WfEvent, { type: "redeploy" }>> }) {
    if (!events.length) return null;
    const laneY = (lane: WfLaneId) => clamp(50 + WF_LANE_Y[lane] / 31.5 * 100, 5, 95);
    return (
        <svg className="wf3-transfer-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {events.map((event, index) => {
                const x = event.team === "blue" ? 9 : 91;
                const bend = event.team === "blue" ? 15 : 85;
                const fromY = laneY(event.from);
                const toY = laneY(event.lane);
                return <path key={`${event.petId}-${index}`} className={`is-${event.team}`} d={`M ${x} ${fromY} C ${bend} ${fromY}, ${bend} ${toY}, ${x} ${toY}`} />;
            })}
        </svg>
    );
}

function CommandImpactToast({ event }: { event: Extract<WfEvent, { type: "commandimpact" }> }) {
    const impact = event.impact;
    const headline = impact.towersBroken > 0
        ? `${impact.towersBroken} ${impact.towersBroken === 1 ? "tower" : "towers"} secured`
        : impact.towersLost > 0
            ? `${impact.towersLost} ${impact.towersLost === 1 ? "tower" : "towers"} lost`
            : impact.towerDamageDealt >= impact.towerDamageTaken
                ? "Pressure gained"
                : "Pressure absorbed";
    return (
        <section className={`wf3-impact-toast is-${impact.team}`} role="status" aria-live="polite">
            <small>COMMAND {impact.sequence} IMPACT</small>
            <strong>{headline}</strong>
            <span>{impact.towerDamageDealt.toLocaleString()} dealt · {impact.towerDamageTaken.toLocaleString()} endured</span>
        </section>
    );
}

function ResultPanel({
    result,
    blue,
    red,
    score,
    matchType,
    resultSupplement,
    settlementPending,
    resultActionsLocked,
    allowReseed,
    onExit,
    onReplayTurningPoint,
    onReplay,
    onReseed,
}: {
    result: WarfrontResult;
    blue: readonly ArenaSlot[];
    red: readonly ArenaSlot[];
    score: Record<Team, number>;
    matchType: WarfrontMatchType;
    resultSupplement?: ReactNode;
    settlementPending: boolean;
    resultActionsLocked: boolean;
    allowReseed: boolean;
    onExit: () => void;
    onReplayTurningPoint: (tick: number) => void;
    onReplay: () => void;
    onReseed: () => void;
}) {
    const dialogRef = useDialogFocus<HTMLDivElement>();
    const winner = result.winner;
    if (!winner) return null;
    const verdict = winner === "blue" ? "VICTORY" : winner === "red" ? "DEFEAT" : "STALEMATE";
    const blueImpacts = result.commandImpacts.filter((impact) => impact.team === "blue");
    const bestImpact = [...blueImpacts].sort((a, b) => (
        b.towersBroken * 5000 - b.towersLost * 3500 + b.towerDamageDealt - b.towerDamageTaken * 0.35
    ) - (
        a.towersBroken * 5000 - a.towersLost * 3500 + a.towerDamageDealt - a.towerDamageTaken * 0.35
    ))[0];
    const lastTower = [...result.events].reverse().find((event): event is Extract<WfEvent, { type: "towerdown" }> => event.type === "towerdown");
    const blueStats = result.petStats?.filter((row) => row.team === "blue") ?? [];
    const mvp = [...blueStats].sort((a, b) => (
        b.kills * 900 + b.assists * 450 + b.towerDamage + b.healing * 0.8 + b.damageTaken * 0.2 + b.ultimates * 700
    ) - (
        a.kills * 900 + a.assists * 450 + a.towerDamage + a.healing * 0.8 + a.damageTaken * 0.2 + a.ultimates * 700
    ) || a.name.localeCompare(b.name))[0];
    const turningTick = bestImpact?.t ?? lastTower?.t ?? result.ticks;
    const notableEvents = result.events.filter((event) => (
        event.type === "ultimate" || event.type === "towerfractured" || event.type === "towerdown"
        || event.type === "lastward" || event.type === "riftrally" || event.type === "hazard"
    )).slice(-5);
    const finalSnapshot = result.snapshots[result.snapshots.length - 1];
    const mutatorSpec = WF_MUTATORS.find((entry) => entry.id === result.mutator) ?? WF_MUTATORS[0];
    const hazardSpec = Object.values(WF_HAZARDS).find((entry) => entry.id === result.hazard) ?? WF_HAZARDS.central;
    const teamUltimates = blueStats.reduce((total, row) => total + row.ultimates, 0);
    return (
        <div
            ref={dialogRef}
            className="wf3-result"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wf3-result-verdict wf3-result-title"
            tabIndex={-1}
        >
            <small className="wf3-result__mode">{MATCH_TYPE_LABEL[matchType]} · {mutatorSpec.label} · {hazardSpec.label}</small>
            <div id="wf3-result-verdict" className={`wf3-result__crest is-${winner}`}>{verdict}</div>
            <p>{score.blue} <span>towers</span> {score.red}</p>
            <h2 id="wf3-result-title">{winner === "blue" ? "The Hollow answers your command." : winner === "red" ? "The rival seals claimed the Warfront." : "Neither command could break the final ward."}</h2>
            <div className="wf3-result__decisive">
                <small>DECISIVE BREAK</small>
                <strong>{lastTower ? `${WF_LANE_LABEL[lastTower.lane]} · ${mmss(lastTower.t / WARFRONT_TPS)}` : `Hard verdict · ${mmss(result.ticks / WARFRONT_TPS)}`}</strong>
                <span>{lastTower ? `${TEAM_LABEL[lastTower.by]} claimed the lane` : "Tower pressure decided the final seal"}</span>
            </div>
            {bestImpact ? (
                <section className="wf3-result__impact">
                    <small>MOST INFLUENTIAL COMMAND</small>
                    <strong>Command {bestImpact.sequence} · {bestImpact.towersBroken ? `${bestImpact.towersBroken} tower secured` : `${bestImpact.towerDamageDealt.toLocaleString()} tower damage`}</strong>
                    <span>{commandEntryLabel(bestImpact, blue)}</span>
                </section>
            ) : null}
            <section className="wf3-result__overview" aria-label="Match overview">
                <div><small>DURATION</small><strong>{mmss(result.ticks / WARFRONT_TPS)}</strong></div>
                <div><small>TOWER PRESSURE</small><strong>{Math.round(finalSnapshot?.towerDamage.blue ?? 0).toLocaleString()}</strong></div>
                <div><small>SIGNATURES</small><strong>{teamUltimates}</strong></div>
                <div><small>MVP</small><strong>{mvp?.name ?? "—"}</strong></div>
            </section>
            {mvp ? (
                <section className="wf3-result__mvp">
                    <small>WARFRONT MVP</small>
                    <strong>{mvp.name}</strong>
                    <span>{mvp.kills} takedowns · {mvp.assists} assists · {mvp.towerDamage.toLocaleString()} tower · {mvp.healing.toLocaleString()} restored</span>
                </section>
            ) : null}
            <div className="wf3-result__stats">
                {blueStats.map((row) => <div key={row.id}><strong>{row.name}</strong><span>{row.kills} K · {row.assists} A · {row.towerDamage.toLocaleString()} tower · {row.healing.toLocaleString()} heal · {row.ultimates} signature</span></div>)}
            </div>
            {notableEvents.length ? (
                <section className="wf3-result__timeline" aria-label="Warfront turning points">
                    <small>TURNING-POINT TIMELINE</small>
                    {notableEvents.map((event, index) => <div key={`${event.t}-${event.type}-${index}`}><time>{mmss(event.t / WARFRONT_TPS)}</time><span>{eventLabel(event, blue, red) ?? event.type}</span></div>)}
                </section>
            ) : null}
            {resultSupplement}
            <div className="wf3-result__actions">
                <button type="button" onClick={onExit} disabled={settlementPending}>{settlementPending ? "Recording result…" : "Return to arena"}</button>
                <button type="button" onClick={() => onReplayTurningPoint(turningTick)} disabled={resultActionsLocked}>Replay turning point</button>
                <button type="button" onClick={onReplay} disabled={resultActionsLocked}>Full replay</button>
                {allowReseed ? <button type="button" onClick={onReseed} disabled={resultActionsLocked}>New opponent plan</button> : null}
            </div>
        </div>
    );
}

export type PetWarfrontMatchProps = {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    theme?: WfTheme;
    autoBuy?: WfBuyPolicy;
    opponentAutoBuy?: Exclude<WfBuyPolicy, "off">;
    stance?: WfStance;
    doctrine?: WfDoctrine;
    opponentStance?: WfStance;
    opponentDoctrine?: WfDoctrine;
    allowReseed?: boolean;
    playbackRate?: number;
    onExit: () => void;
    onResult?: (result: WarfrontResult) => void;
    resultActionsLocked?: boolean;
    settlementPending?: boolean;
    resultSupplement?: ReactNode;
    matchType?: WarfrontMatchType;
    spectator?: boolean;
};

export function PetWarfrontMatch({
    blue,
    red,
    seed,
    theme = "central",
    autoBuy = "off",
    opponentAutoBuy = "balanced",
    opponentStance = "balanced",
    opponentDoctrine = "vanguard",
    stance = "balanced",
    doctrine = "none",
    allowReseed = false,
    playbackRate = 1,
    onExit,
    onResult,
    resultActionsLocked = false,
    settlementPending = false,
    resultSupplement,
    matchType = "unranked",
    spectator = false,
}: PetWarfrontMatchProps) {
    const isSpectator = spectator || matchType === "spectator";
    const [formation, setFormation] = useState<WfLaneId[]>(() => DEFAULT_FORMATION.slice(0, blue.length));
    const [deployed, setDeployed] = useState(isSpectator);
    const [run, setRun] = useState(0);
    const [seedBump, setSeedBump] = useState(0);
    const [version, setVersion] = useState(0);
    const [displayTick, setDisplayTick] = useState(0);
    const [commandOpen, setCommandOpen] = useState<number | null>(null);
    const [resultShown, setResultShown] = useState(false);
    const [paused, setPaused] = useState(false);
    const [selectedFocusLane, setSelectedFocusLane] = useState<WfLaneId | null>(null);
    const [reducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const [visualQuality] = useState(() => petVisualQuality());
    const [compactPresentation, setCompactPresentation] = useState(compactWarfrontPresentation);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const clockRef = useRef(0);
    const lastFrameRef = useRef<number | null>(null);
    const resultReportedRef = useRef(false);
    const audioEventCursorRef = useRef(0);
    const lastPruneTickRef = useRef(0);
    const lastResolvedCommandSequenceRef = useRef(0);
    const effectiveSeed = seed + seedBump * 1000003;
    const safePlaybackRate = Number.isFinite(playbackRate) ? clamp(playbackRate, 0.1, 20) : 1;
    const themeSpec = WF_THEMES[theme];
    const controller = useMemo(() => {
        // `run` is the generation key that intentionally replaces a completed
        // worker even when the player replays the same sealed seed.
        void run;
        return createWarfrontWorkerController({
            blue,
            red,
            seed: effectiveSeed,
            bluePolicy: autoBuy,
            redPolicy: opponentAutoBuy,
            theme,
            blueStance: stance,
            redStance: opponentStance,
            blueDoctrine: doctrine,
            redDoctrine: opponentDoctrine,
            initialLanes: { blue: formation, red: DEFAULT_FORMATION.slice(0, red.length) },
        });
    }, [blue, red, effectiveSeed, autoBuy, opponentAutoBuy, theme, stance, opponentStance, doctrine, opponentDoctrine, formation, run]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const query = window.matchMedia(COMPACT_WARFRONT_QUERY);
        const update = () => setCompactPresentation(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        if (visualQuality.id !== "low" && !compactPresentation) void loadPetWarfrontStage3D();
    }, [compactPresentation, visualQuality.id]);

    useEffect(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        const siblings = Array.from(document.body.children)
            .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== shell)
            .map((element) => ({ element, inert: element.inert }));
        for (const { element } of siblings) element.inert = true;
        document.body.style.overflow = "hidden";
        return () => {
            for (const { element, inert } of siblings) element.inert = inert;
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        const unsubscribe = controller.subscribeStatus(() => setVersion((value) => value + 1));
        if (deployed) controller.start();
        return () => { unsubscribe(); controller.dispose(); };
    }, [controller, deployed]);

    useEffect(() => {
        clockRef.current = 0;
        // A new worker controller is a new match; resetting its presentation in
        // one batched effect prevents state from leaking between sealed runs.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplayTick(0);
        setCommandOpen(null);
        setResultShown(false);
        setPaused(false);
        setSelectedFocusLane(null);
        resultReportedRef.current = false;
        audioEventCursorRef.current = 0;
        lastPruneTickRef.current = 0;
        lastResolvedCommandSequenceRef.current = 0;
        lastFrameRef.current = null;
    }, [controller]);

    const result = controller.result;
    const command = controller.commandState();
    const commandSequence = command?.sequence;
    const commandTick = command?.t;
    const frontier = result.ticks;

    useEffect(() => {
        if (!isSpectator || commandSequence === undefined) return;
        lastResolvedCommandSequenceRef.current = commandSequence;
        controller.advanceRound(undefined);
    }, [commandSequence, controller, isSpectator]);

    useEffect(() => {
        if (!deployed) return;
        let raf = 0;
        const frame = (now: number) => {
            const last = lastFrameRef.current ?? now;
            lastFrameRef.current = now;
            const delta = Math.min(0.05, Math.max(0, (now - last) / 1000));
            if (!paused && !resultShown) {
                const direction = directorRate(result, Math.floor(clockRef.current), reducedMotion);
                clockRef.current = Math.min(frontier, clockRef.current + delta * WARFRONT_TPS * safePlaybackRate * direction);
            }
            const tick = Math.floor(clockRef.current);
            if (tick - lastPruneTickRef.current >= WARFRONT_TPS * 5) {
                // Retain a short broadcast buffer so the decisive tower break can
                // be replayed immediately without rebuilding the simulation.
                controller.pruneSnapshotsBefore(tick, WARFRONT_TPS * 10);
                lastPruneTickRef.current = tick;
            }
            setDisplayTick((current) => current === tick ? current : tick);
            if (!isSpectator && commandTick !== undefined && commandSequence !== undefined && tick >= commandTick && commandSequence > lastResolvedCommandSequenceRef.current) {
                clockRef.current = commandTick;
                setCommandOpen(commandSequence);
            }
            if (result.winner && tick >= frontier) setResultShown(true);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [controller, deployed, frontier, commandSequence, commandTick, result, result.winner, paused, resultShown, safePlaybackRate, reducedMotion, version, isSpectator]);

    useEffect(() => {
        if (!resultShown || resultReportedRef.current || !result.winner) return;
        resultReportedRef.current = true;
        stopBattleMusic();
        playPetSfx(result.winner === "blue" ? "victory" : "crowd");
        onResult?.(result);
    }, [resultShown, result, onResult]);

    const snapshot = snapshotAt(result.snapshots, displayTick);
    const score = snapshot ? wfVerdictScore(snapshot) : { blue: 0, red: 0 };
    const recentEvents = result.events
        .filter((event) => event.t <= displayTick)
        .map((event) => ({ event, label: eventLabel(event, blue, red) }))
        .filter((entry): entry is { event: WfEvent; label: string } => Boolean(entry.label))
        .slice(-6)
        .reverse();

    const commandReveal = [...result.events].reverse().find((event): event is Extract<WfEvent, { type: "commandresolved" }> => (
        event.type === "commandresolved" && event.t <= displayTick && displayTick - event.t <= WARFRONT_TPS * 1.6
    )) ?? null;
    const transferTrails = commandReveal
        ? result.events.filter((event): event is Extract<WfEvent, { type: "redeploy" }> => event.type === "redeploy" && event.t === commandReveal.t)
        : [];
    const impactToast = [...result.events].reverse().find((event): event is Extract<WfEvent, { type: "commandimpact" }> => (
        event.type === "commandimpact" && event.impact.team === "blue" && event.t <= displayTick && displayTick - event.t <= WARFRONT_TPS * 5
    )) ?? null;
    const focusLane = commandOpen === null ? majorEventLane(result.events, displayTick) ?? selectedFocusLane : null;
    const commandInterval = result.omen === "storm-gate" ? 90 : 120;
    const nextCommandSeconds = Math.max(0, commandInterval - (displayTick / WARFRONT_TPS) % commandInterval);
    const omenSpec = WF_OMENS.find((entry) => entry.id === result.omen) ?? WF_OMENS[0];
    const mutatorSpec = WF_MUTATORS.find((entry) => entry.id === result.mutator) ?? WF_MUTATORS[0];
    const hazardSpec = Object.values(WF_HAZARDS).find((entry) => entry.id === result.hazard) ?? WF_HAZARDS.central;

    useEffect(() => {
        let cue: Parameters<typeof playPetSfx>[0] | null = null;
        while (audioEventCursorRef.current < result.events.length) {
            const event = result.events[audioEventCursorRef.current];
            if (event.t > displayTick) break;
            audioEventCursorRef.current++;
            if (event.type === "towerdown") cue = "finisher";
            else if (event.type === "towerfractured") cue = "crit";
            else if (event.type === "wardensummon") cue = "crowd";
            else if (event.type === "favorready") cue = "buff";
            else if (event.type === "kill") cue = "ko";
            else if (event.type === "redeploy") cue = "move";
            else if (event.type === "ultimate") cue = "finisher";
            else if (event.type === "lastward" || event.type === "riftrally") cue = "buff";
            else if (event.type === "hazard") cue = "crit";
        }
        if (cue) playPetSfx(cue);
    }, [displayTick, result.events, result.events.length]);

    useEffect(() => {
        if (commandOpen !== null) playPetSfx("command");
    }, [commandOpen]);

    useEffect(() => () => stopBattleMusic(), []);

    const confirmCommand = useCallback((choices: WarfrontChoice[]) => {
        playPetSfx("uiConfirm");
        if (commandOpen !== null) lastResolvedCommandSequenceRef.current = commandOpen;
        controller.advanceRound(choices);
        setCommandOpen(null);
        setPaused(false);
        lastFrameRef.current = null;
    }, [commandOpen, controller]);

    const deploy = () => {
        primePetSfx();
        playPetSfx("command");
        startBattleMusic();
        setDeployed(true);
    };

    const restart = (newSeed: boolean) => {
        if (resultActionsLocked) return;
        stopBattleMusic();
        clockRef.current = 0;
        setDisplayTick(0);
        setCommandOpen(null);
        setResultShown(false);
        setPaused(false);
        setSelectedFocusLane(null);
        if (newSeed) setSeedBump((value) => value + 1);
        setRun((value) => value + 1);
        setDeployed(isSpectator);
        setFormation(DEFAULT_FORMATION.slice(0, blue.length));
    };

    const replayFromTick = (requestedTick: number) => {
        if (resultActionsLocked || !result.winner) return;
        const highlightTick = Math.max(0, requestedTick - WARFRONT_TPS * 7);
        const firstHighlightEvent = result.events.findIndex((event) => event.t >= highlightTick);
        clockRef.current = highlightTick;
        audioEventCursorRef.current = firstHighlightEvent < 0 ? result.events.length : firstHighlightEvent;
        setDisplayTick(highlightTick);
        setResultShown(false);
        setPaused(false);
        lastFrameRef.current = null;
        startBattleMusic();
    };

    const commandVisible = Boolean(!isSpectator && snapshot && command && commandOpen === command.sequence);
    const resultVisible = Boolean(resultShown && snapshot && result.winner);
    const stageInteractionBlocked = !deployed
        || commandVisible
        || resultVisible
        || controller.status === "loading"
        || controller.status === "error";
    const useThreeDimensionalStage = visualQuality.id !== "low" && !compactPresentation;
    const domBattlefield = snapshot ? (
        <>
            {WF_LANE_IDS.map((lane) => <TowerMarker key={`bt-${lane}`} snapshot={snapshot} team="blue" lane={lane} />)}
            {WF_LANE_IDS.map((lane) => <TowerMarker key={`rt-${lane}`} snapshot={snapshot} team="red" lane={lane} />)}
            {snapshot.actors.map((actor) => (
                <PetToken key={actor.id} actor={actor} slot={(actor.team === "blue" ? blue : red)[actor.slot]} />
            ))}
            <WardenToken snapshot={snapshot} team="blue" />
            <WardenToken snapshot={snapshot} team="red" />
        </>
    ) : null;

    const overlay = (
        <div ref={shellRef} className="pet-combat-takeover wf3-shell" style={{ "--wf3-void": themeSpec.voidColor, "--wf3-glow": themeSpec.breachGlow } as CSSProperties}>
            <header className="wf3-topbar" inert={stageInteractionBlocked} aria-hidden={stageInteractionBlocked}>
                <div className="wf3-brand"><span>HOLLOW WARFRONT · {MATCH_TYPE_LABEL[matchType]}</span><strong>FIRST TO TWO TOWERS</strong></div>
                <div className="wf3-score" aria-label={`Azure ${score.blue}, Crimson ${score.red}`} aria-live="polite">
                    <b className="is-blue">{score.blue}</b><span>◆</span><b className="is-red">{score.red}</b>
                </div>
                <div className={`wf3-clock${nextCommandSeconds <= 15 ? " is-imminent" : ""}`}><strong>{mmss(displayTick / WARFRONT_TPS)}</strong><small>{displayTick >= WARFRONT_TPS * 480 ? `RIFTFALL · CMD ${mmss(nextCommandSeconds)}` : `COMMAND ${mmss(nextCommandSeconds)}`}</small></div>
                <div className="wf3-omen-chip" title={`${omenSpec.desc} ${mutatorSpec.desc} Arena hazard: ${hazardSpec.desc}`}><b>{omenSpec.icon}</b><div><span>{omenSpec.label}</span><small>{mutatorSpec.label}</small></div></div>
                <div className="wf3-actions">
                    <button type="button" onClick={() => setPaused((value) => !value)} aria-pressed={paused} aria-label={paused ? "Resume Warfront" : "Pause Warfront"}>{paused ? "▶" : "Ⅱ"}</button>
                    <button type="button" onClick={onExit} disabled={settlementPending} aria-label="Leave Warfront">×</button>
                </div>
            </header>

            <main className="wf3-stage" inert={stageInteractionBlocked} aria-hidden={stageInteractionBlocked}>
                <div
                    className={`wf3-board${focusLane ? ` is-focusing is-focus-${focusLane}` : ""}`}
                    style={{
                        "--wf3-board-landscape": `url(${battlefieldArt})`,
                        "--wf3-board-portrait": `url(${battlefieldPortraitArt})`,
                    } as CSSProperties}
                >
                    <div className="wf3-board__vignette" />
                    {snapshot ? useThreeDimensionalStage ? (
                        <Suspense fallback={domBattlefield}>
                            <PetWarfrontStage3D
                                snapshot={snapshot}
                                blue={blue}
                                red={red}
                                quality={visualQuality}
                                paused={paused || resultVisible}
                                displayTick={displayTick}
                                events={result.events}
                                theme={theme}
                            />
                        </Suspense>
                    ) : domBattlefield : null}
                </div>

                <aside className="wf3-lanes" aria-label="Lane status">
                    {snapshot ? WF_LANE_IDS.map((lane) => (
                        <LaneRibbon
                            key={lane}
                            snapshot={snapshot}
                            lane={lane}
                            selected={selectedFocusLane === lane}
                            onSelect={() => setSelectedFocusLane((current) => current === lane ? null : lane)}
                        />
                    )) : null}
                </aside>

                <aside className="wf3-feed" aria-live="polite">
                    {recentEvents.map(({ event, label }) => <div key={`${event.t}-${event.type}-${label}`}><time>{mmss(event.t / WARFRONT_TPS)}</time><span>{label}</span></div>)}
                </aside>

                {commandReveal ? <CommandReveal event={commandReveal} blue={blue} red={red} /> : null}
                {commandReveal ? <TransferTrails events={transferTrails} /> : null}
                {impactToast && !commandReveal ? <CommandImpactToast event={impactToast} /> : null}

                {snapshot ? (
                    <div className="wf3-favor">
                        <div className="wf3-favor__side is-blue" role="progressbar" aria-label="Azure Warden Favor" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(snapshot.favor.blue)}><span>WARDEN FAVOR</span><strong>{Math.floor(snapshot.favor.blue)}</strong><i><b style={{ width: `${snapshot.favor.blue}%` }} /></i></div>
                        <div className="wf3-favor__crest"><img src={wardenArt} alt="" draggable={false} /></div>
                        <div className="wf3-favor__side is-red" role="progressbar" aria-label="Crimson Warden Favor" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(snapshot.favor.red)}><span>RIVAL FAVOR</span><strong>{Math.floor(snapshot.favor.red)}</strong><i><b style={{ width: `${snapshot.favor.red}%` }} /></i></div>
                    </div>
                ) : null}
            </main>

            {!deployed ? (
                <DeploymentPanel
                    blue={blue}
                    formation={formation}
                    omen={result.omen}
                    mutator={result.mutator}
                    hazard={result.hazard}
                    stance={stance}
                    doctrine={doctrine}
                    matchType={matchType}
                    onChange={(index, lane) => setFormation((current) => current.map((value, at) => at === index ? lane : value))}
                    onDeploy={deploy}
                />
            ) : null}

            {deployed && controller.status === "loading" ? <div className="wf3-loading" role="status" aria-live="polite"><span /><strong>Sealing the three causeways…</strong></div> : null}
            {controller.status === "error" ? <div className="wf3-error" role="alert"><strong>Warfront simulation failed</strong><p>{controller.error}</p><button type="button" onClick={() => restart(false)}>Retry</button></div> : null}

            {commandVisible && snapshot && command ? (
                <CommandPanel key={command.sequence} command={command} snapshot={snapshot} blue={blue} doctrine={doctrine} onConfirm={confirmCommand} />
            ) : null}

            {resultVisible ? (
                <ResultPanel
                    result={result}
                    blue={blue}
                    red={red}
                    score={score}
                    matchType={matchType}
                    resultSupplement={resultSupplement}
                    settlementPending={settlementPending}
                    resultActionsLocked={resultActionsLocked}
                    allowReseed={allowReseed}
                    onExit={onExit}
                    onReplayTurningPoint={replayFromTick}
                    onReplay={() => restart(false)}
                    onReseed={() => restart(true)}
                />
            ) : null}
        </div>
    );

    return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
