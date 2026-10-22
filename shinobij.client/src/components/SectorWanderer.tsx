/*
 * SectorWanderer — an AI shinobi that walks a sector and "feels like a player".
 *
 * It reuses the exact grounded-billboard look + walk of <SectorAvatar> (the
 * component that walks the player's own pin), but instead of tracking the
 * player's destination it drives its OWN target: it patrols between its
 * waypoints and, when you come close, turns and walks up to you to do its thing.
 * You can also walk to it (or click it) — whoever closes the gap first, the
 * encounter fires.
 *
 * Phase 1 (always on — the `wanderers.v1` opt-out was retired): a pursuer
 * (bandits, night ninjas, contract hunters, war mercenaries) hunts you and, when
 * it reaches you, stops you with the Fight/Flee encounter; the others greet with
 * a speech bubble. Renderer + movement only — <WorldMap> owns the encounter, the
 * fight start and the priced flee, so nothing here touches combat, rewards, or saves.
 */
import { type CSSProperties, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorldPlayerPosition } from '../lib/world-player-position';
import type { Biome } from "../types/core";
import type { Wanderer } from "../lib/wanderers";
import { wandererAvatar } from "../lib/wanderer-art";
import { loiterPositionAt } from "../lib/wanderer-loiter";
import { serverNow } from "../lib/server-clock";
import { createSectorNavigator } from "../lib/sector-path-waypoint";
import { advanceAuthoredGroundMotion } from "../lib/authored-ground-motion";
import { safeSectorTile, sectorObstaclesOn } from "../lib/sector-obstacles";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { SECTOR_MARKER_ANCHOR, SECTOR_RING_AI, sectorMarkerBox } from "../lib/sector-marker";
import type { LifeActor } from '../../../shared/sector-life';
import { lifeActorPosition,lifeActivityAt,lifeActivityAtPosition } from '../../../shared/sector-life-motion';
import { sectorTrackerAway } from '../lib/sector-life-art';
import { isCoveredByCombat, subscribeCombatCover } from '../lib/combat-cover';
import {useSectorServiceRoutine} from '../lib/sector-service-routine';
import {layoutWandererLabels} from '../lib/wanderer-label-layout';
import {publishFigureGroundPosition} from '../lib/figure-ground-position';
import {GroundWorkTool} from './GroundWorkTool';
import {paintGroundWorkTool} from '../lib/ground-work-tool';
import {groundWorkPresentation} from '../lib/ground-work-surface';

const GRID_W = 12;
const GRID_H = 12;
const PAD = 8;
const GAP = 1;
// A wanderer is another shinobi standing on the same ground you are, so it is
// drawn at exactly your size — see lib/sector-marker. It used to be 0.52 tiles
// against your 0.58 ("a touch smaller than the player's pin"), which on a phone
// was a 1.5px difference nobody could read as intent, only as inconsistency.
const BASE_ANCHOR = SECTOR_MARKER_ANCHOR;
const WALK_TILES_PER_SEC = 5.0; // ambles a little slower than the player (6.5)
const NOTICE_TILES = 3.6;       // how close before it turns toward you
const ENGAGE_TILES = 0.8;       // "we've met" distance
const ARM_DELAY_MS = 2200;      // grace after entering a sector before it can engage
// A hunter has to FIND you. It used to path to the player from anywhere on the
// board the moment it armed, which made an ambush unavoidable in every sector
// that happened to hold a bandit — not an ambush so much as a homing missile,
// and the reason the encounter rate read as one-in-twelve arrivals flat,
// regardless of where you were standing or how briefly you stayed.
//
// Now it hunts only what it can notice, and once it has you it commits: the
// leash is wider than the spot radius so a chase is a chase, not a yo-yo at the
// edge of the circle. With arrivals landing on the edge you travelled in from
// (arrivalTileFromOrigin), a bandit patrolling the far side genuinely misses
// you, and the rate falls out of the geometry instead of being dialled: cross
// a corner of the sector and you are usually clear, linger and you are found.
const HUNT_SPOT_TILES = 5.5;    // a hunter locks on inside this
const HUNT_LEASH_TILES = 8.0;   // ...and gives up outside this
// Reduced motion suppresses the ANIMATION, not the world. The loop used to
// return early for these players, which quietly exempted them from every road
// ambush in the game — a real gameplay asymmetry, not an accommodation. They
// now get the same encounters, closed in discrete steps on a timer instead of
// a per-frame tween.
// 200ms x WALK_TILES_PER_SEC lands on exactly ONE tile per step. That is the
// point of the number: the wanderer covers the same ground per second as it
// does animated — so the encounter plays out identically — while never making
// a large sudden jump, which is the motion reduced-motion users are actually
// asking to avoid. A coarser timer preserves the speed too, but by teleporting
// several tiles at once, which is worse for them than the tween was.
const REDUCED_STEP_MS = 200;
const SMOOTH_MAX_DT = 0.05;
const LABEL_LANES = 3;      // vertical lanes the name pill can sit in
let nextAmbientGreetingAt = 0;
let activeRoadSpeechUntil = 0;

const AURA: Record<Biome, string> = {
    snow: "#cfe8ff", volcano: "#ff8a3d", shadow: "#c9a2ff", forest: "#9bf0a6", central: "#ffe9a6",
};

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
function cellCentre(size: number, count: number, n: number, pad: number, gap: number): number {
    const tile = (size - 2 * pad - (count - 1) * gap) / count;
    return pad + n * (tile + gap) + tile / 2;
}
/** Stable 0..LABEL_LANES-1 lane for a wanderer's name pill (FNV-1a over the id). */
function labelLaneFor(id: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % LABEL_LANES;
}
const colOf = (t: number) => t % GRID_W;
const rowOf = (t: number) => Math.floor(t / GRID_W);
const indoors=(life:LifeActor|undefined,p:{col:number;row:number},now:number)=>life?.hideAt!==undefined&&now>=life.hideAt&&Math.hypot(p.col-(life.hideTile??life.restTile)%12,p.row-Math.floor((life.hideTile??life.restTile)/12))<.18;
const visualActivity=(life:LifeActor,p:{col:number;row:number},now:number)=>groundWorkPresentation(life,lifeActivityAtPosition(life,p,life.hideAt!==undefined&&!indoors(life,p,now)?Math.min(now,life.hideAt-1):now));

export function SectorWanderer({
    wanderer,
    sector = Number(wanderer.id.split("-")[1]),
    playerIndex,
    biome,
    onEngage,
    routine:suppliedRoutine,
}: {
    wanderer: Wanderer;
    sector?: number;
    playerIndex: number;
    biome: Biome;
    onEngage: (w: Wanderer,presentation?:Pick<LifeActor,'activity'|'line'>) => boolean | void;
    /** Ambient routines use the same figure, portrait, grounding and motion as every other road NPC. */
    routine?: LifeActor;
}) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);
    const tackleRef=useRef<SVGSVGElement>(null),nativeReady=useRef(false);
    const workToolRef=useRef<SVGSVGElement>(null),reducedTool=useRef(prefersReducedMotion());

    // Story and service characters are placed by id, not by the board, so ground
    // them here: an actor standing in rock or a building is one nobody can reach.
    const homeTile = safeSectorTile(sector, wanderer.homeTile);
    const walkable = (tile: number) => isWalkableTile(sector, tile, sectorObstaclesOn());
    const worldPlayer = useContext(WorldPlayerPosition);
    const nativeWork=worldPlayer!==null&&wanderer.verb==='angler'&&(sector===6||sector===18);
    const service=useSectorServiceRoutine(sector,wanderer.id,nativeWork),routine=suppliedRoutine??service??undefined;
    const initialPose = routine ? lifeActorPosition(sector, routine, serverNow()) : wanderer.movement === "stationary"
        ? loiterPositionAt(wanderer.id, homeTile, serverNow(), walkable)
        : { col: colOf(homeTile), row: rowOf(homeTile) };
    const posRef = useRef({ col: initialPose.col, row: initialPose.row });
    const facingRef = useRef(1);
    const sizeRef = useRef({ w: 0, h: 0 });
    const metricsRef = useRef({ padX: PAD, padY: PAD, gapX: GAP, gapY: GAP });
    const rafRef = useRef(0);
    const lastTsRef = useRef(0);
    const armedAtRef = useRef(0);

    // movement brain (refs so the RAF loop never forces a re-render)
    const wpIndexRef = useRef(0);
    const pauseUntilRef = useRef(0);
    const greetedRef = useRef(false);
    // A hunter that has spotted you stays committed until it breaks the leash.
    const huntingRef = useRef(false);
    const stepTimerRef = useRef(0);

    // latest props for the long-lived RAF closure
    const playerRef = useRef(playerIndex);
    const onEngageRef = useRef(onEngage);
    const routineRef = useRef(routine);
    const wandererRef = useRef(wanderer);
    useEffect(() => { wandererRef.current = wanderer; }, [wanderer]);
    useLayoutEffect(() => { routineRef.current = routine; }, [routine]);
    useLayoutEffect(()=>{nativeReady.current=service!==undefined;},[service]);
    useEffect(() => { playerRef.current = playerIndex; }, [playerIndex]);
    useEffect(() => { onEngageRef.current = onEngage; }, [onEngage]);

    const [bubble, setBubble] = useState<string | null>(null);
    const bubbleTimer = useRef(0);
    function speak(line: string) {
        const now = performance.now();
        if (now < activeRoadSpeechUntil) return;
        activeRoadSpeechUntil = now + 3600;
        setBubble(line);
        window.clearTimeout(bubbleTimer.current);
        bubbleTimer.current = window.setTimeout(() => setBubble(null), 3600);
    }

    function tileSizePx(): number {
        const { padX, gapX } = metricsRef.current;
        return (sizeRef.current.w - 2 * padX - (GRID_W - 1) * gapX) / GRID_W;
    }
    const paint=useCallback(()=>{
        const fig = figRef.current;
        const { w, h } = sizeRef.current;
        if (!fig) return;
        const life=routineRef.current,now=serverNow();
        if(nativeWork&&nativeReady.current||life?.hideAt!==undefined)fig.style.visibility=!life||indoors(life,posRef.current,now)?'hidden':'';
        const presentation=life?visualActivity(life,posRef.current,now):undefined;
        if(life){const activity=presentation!.activity,title=`${life.name} · ${activity}`;
            if(fig.dataset.activity!==activity||fig.title!==title){fig.dataset.activity=activity;fig.title=title;fig.setAttribute('aria-label',`${life.name}: ${activity}. Talk`);}}
        if(!w||!h)return;
        const { padX, padY, gapX, gapY } = metricsRef.current;
        const cx = cellCentre(w, GRID_W, posRef.current.col, padX, gapX);
        const cy = cellCentre(h, GRID_H, posRef.current.row, padY, gapY);
        fig.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -${BASE_ANCHOR}%)`;
        publishFigureGroundPosition(fig,posRef.current);
        layoutWandererLabels(fig);
        if(workToolRef.current)paintGroundWorkTool(workToolRef.current,!!presentation&&'working' in presentation&&presentation.working===true,cx/w*1200,cy/h*1200,now,reducedTool.current);
        const fishing=routineRef.current?.fishing;
        if(tackleRef.current)tackleRef.current.style.visibility=fishing&&now>=fishing.startsAt&&now<fishing.until&&Math.hypot(posRef.current.col-fishing.bank%12,posRef.current.row-Math.floor(fishing.bank/12))<.18?'visible':'hidden';
    },[nativeWork]);
    useLayoutEffect(()=>{paint();},[paint,routine]);
    function setWalking(on: boolean) { figRef.current?.classList.toggle("is-walking", on); }
    function applyFacing() { spriteRef.current?.style.setProperty("--face", String(facingRef.current)); }

    // Measure the parent .pixel-map grid (same approach as SectorAvatar).
    useLayoutEffect(() => {
        const grid = wrapRef.current?.parentElement;
        if (!grid) return;
        const ro = new ResizeObserver(() => {
            const r = grid.getBoundingClientRect();
            sizeRef.current = { w: r.width, h: r.height };
            const cs = getComputedStyle(grid);
            metricsRef.current = {
                padX: parseFloat(cs.paddingLeft) || 0,
                padY: parseFloat(cs.paddingTop) || 0,
                gapX: parseFloat(cs.columnGap) || 0,
                gapY: parseFloat(cs.rowGap) || 0,
            };
            const fig = figRef.current;
            if (fig) {
                const box = sectorMarkerBox(tileSizePx());
                fig.style.width = `${box.w}px`;
                fig.style.height = `${box.h}px`;
            }
            paint();
        });
        ro.observe(grid);
        return () => ro.disconnect();
    }, [paint]);

    // The movement loop.
    useEffect(() => {
        const reduced = prefersReducedMotion();
        // In the connected world an actor may follow you onto its sector's open land.
        const clearance=()=>routineRef.current?.clearance;
        let navigate = createSectorNavigator(worldPlayer !== null,clearance);
        const maxDt = reduced ? REDUCED_STEP_MS / 1000 : SMOOTH_MAX_DT;
        let routineDebtMs = 0;
        const schedule = () => {
            if ((routineRef.current||nativeWork) && (document.hidden || isCoveredByCombat())) return;
            if (reduced) stepTimerRef.current = window.setTimeout(() => tick(performance.now()), REDUCED_STEP_MS);
            else rafRef.current = requestAnimationFrame(tick);
        };
        armedAtRef.current = performance.now() + ARM_DELAY_MS;
        const wps = (wanderer.waypoints.length ? wanderer.waypoints : [wanderer.homeTile]).map(tile => safeSectorTile(sector, tile));

        const tick = (ts: number) => {
            const wanderer = wandererRef.current;
            if (!lastTsRef.current) lastTsRef.current = ts;
            const elapsedMs = Math.max(0, ts - lastTsRef.current);
            const dt = Math.min(maxDt, elapsedMs / 1000);
            lastTsRef.current = ts;

            const p = posRef.current;
            const candidate = worldPlayer?.current;
            const actual = candidate && candidate.sector === sector ? candidate : null;
            const pcol = actual?.col ?? colOf(playerRef.current);
            const prow = actual?.row ?? rowOf(playerRef.current);
            const distPlayer = Math.hypot(pcol - p.col, prow - p.row);
            const armed = ts >= armedAtRef.current;
            const life = routineRef.current;
            const away=!life&&sectorTrackerAway(sector,wanderer.id);
            if(figRef.current)figRef.current.style.visibility=away?'hidden':'';
            if(away){setWalking(false);schedule();return;}
            if(nativeWork&&nativeReady.current&&!life){if(figRef.current)figRef.current.style.visibility='hidden';setWalking(false);schedule();return;}
            if (life) {
                if (document.hidden) { setWalking(false); schedule(); return; }
                const now = serverNow();
                // Weather and event changes choose a new destination, never a new
                // position. The established navigator walks there through real ground.
                const motion = advanceAuthoredGroundMotion({
                    position: p, elapsedMs: elapsedMs + routineDebtMs, now,
                    maxStepMs: maxDt * 1000, speed: .6,
                    targetAt: at => lifeActorPosition(sector, life, reduced ? Math.floor(at / REDUCED_STEP_MS) * REDUCED_STEP_MS : at),
                    navigate: (position, target) => navigate(sector, position, target),
                });
                routineDebtMs = motion.unconsumedMs;
                posRef.current = motion.position;
                if (Math.abs(motion.facingDelta) > .005) facingRef.current = motion.facingDelta < 0 ? -1 : 1;
                applyFacing(); setWalking(motion.remainingDistance > .02 && !reduced); paint();
                if(indoors(life,posRef.current,now)){if(figRef.current)figRef.current.style.visibility='hidden';schedule();return;}
                const near = Math.hypot(pcol - posRef.current.col, prow - posRef.current.row) <= 1.8;
                if (!near) greetedRef.current = false;
                if (armed && near && !greetedRef.current) {
                    greetedRef.current = true;
                    // A passing greeting stays short. Full work instructions
                    // belong in Talk, and only one ambient resident speaks at once.
                    if (now >= nextAmbientGreetingAt) { nextAmbientGreetingAt = now + 45_000; speak(life.bark ?? (life.traveler ? 'Good to see you.' : 'Hello.')); }
                }
                schedule(); return;
            }
            const movement = wanderer.movement
                ?? ((wanderer.verb === "attack" || wanderer.verb === "bountyHunter") ? "pursue" : "patrol");
            // Pursuers HUNT: once they spot you they path to you and confront you,
            // and they keep coming until you break the leash. Patrol actors amble
            // and may approach nearby players; service/story actors loiter near
            // their authored spot and only greet when the player comes to them.
            const isHunter = movement === "pursue";
            if (isHunter) {
                if (distPlayer <= HUNT_SPOT_TILES) huntingRef.current = true;
                else if (distPlayer > HUNT_LEASH_TILES) huntingRef.current = false;
            }
            const closing = isHunter ? huntingRef.current : distPlayer <= NOTICE_TILES;
            // Slipping out of notice range re-arms the meeting, so a hunter you've
            // outrun can confront you again when it catches back up.
            if (distPlayer > NOTICE_TILES) greetedRef.current = false;

            if (movement === "stationary") {
                // The route follows the shared world clock, so leaving and
                // returning does not reset a passive actor to its home tile.
                // Quantize reduced motion to the same 200ms cadence as other AI.
                const now = serverNow();
                const pose = loiterPositionAt(wanderer.id, homeTile,
                    reduced ? Math.floor(now / REDUCED_STEP_MS) * REDUCED_STEP_MS : now, walkable);
                posRef.current = { col: pose.col, row: pose.row };
                facingRef.current = pose.facing;
                applyFacing();
                setWalking(pose.walking && !reduced);
                paint();
                const loiterDist = Math.hypot(pcol - pose.col, prow - pose.row);
                if (loiterDist > NOTICE_TILES) greetedRef.current = false;
                if (armed && loiterDist <= NOTICE_TILES && !greetedRef.current) {
                    greetedRef.current = true;
                    speak(wanderer.greeting);
                }
                schedule();
                return;
            }

            let tCol: number, tRow: number;

            if (armed && closing) {
                // ── Approach: walk up to the player ──────────────────────────
                if (distPlayer <= ENGAGE_TILES) {
                    setWalking(false);
                    if (!greetedRef.current) {
                        // A bandit confronts you (opens the Fight/Flee dialog);
                        // everyone else just greets — you click to interact.
                        // A confrontation refused because another hostile holds
                        // you stays un-greeted, so it engages once that is done.
                        if (isHunter) greetedRef.current = onEngageRef.current(wanderer) !== false;
                        else { greetedRef.current = true; speak(wanderer.greeting); }
                    }
                    schedule(); // hold adjacent
                    return;
                }
                tCol = pcol; tRow = prow;
            } else {
                // ── Patrol: amble between waypoints ──────────────────────────
                const cur = wps[wpIndexRef.current % wps.length];
                const atWp = Math.hypot(colOf(cur) - p.col, rowOf(cur) - p.row) < 0.06;
                if (atWp) {
                    if (ts < pauseUntilRef.current) { setWalking(false); schedule(); return; }
                    wpIndexRef.current = (wpIndexRef.current + 1) % wps.length;
                    pauseUntilRef.current = ts + 900 + Math.random() * 1600;
                }
                const next = wps[wpIndexRef.current % wps.length];
                tCol = colOf(next); tRow = rowOf(next);
            }

            const nextStep = navigate(sector, p, { col: tCol, row: tRow });
            tCol = nextStep.col; tRow = nextStep.row;
            const dx = tCol - p.col, dy = tRow - p.row;
            const dist = Math.hypot(dx, dy);
            const step = WALK_TILES_PER_SEC * dt;
            if (Math.abs(dx) > 0.02) { facingRef.current = dx < 0 ? -1 : 1; applyFacing(); }

            if (dist <= step || dist < 0.02) {
                posRef.current = { col: tCol, row: tRow };
            } else {
                posRef.current = { col: p.col + (dx / dist) * step, row: p.row + (dy / dist) * step };
                setWalking(true);
            }
            paint();
            schedule();
        };

        let paused=document.hidden||isCoveredByCombat();
        const syncRoutine = () => {
            if (!routineRef.current&&!nativeWork) return;
            cancelAnimationFrame(rafRef.current); window.clearTimeout(stepTimerRef.current); lastTsRef.current = 0;
            routineDebtMs = 0;
            const nextPaused=document.hidden||isCoveredByCombat();
            if(paused&&!nextPaused&&routineRef.current){
                const now=serverNow(),pose=lifeActorPosition(sector,routineRef.current,reduced?Math.floor(now/REDUCED_STEP_MS)*REDUCED_STEP_MS:now);
                posRef.current={col:pose.col,row:pose.row};navigate=createSectorNavigator(worldPlayer!==null,clearance);setWalking(false);paint();
            }
            paused=nextPaused;
            schedule();
        };
        const stopCover = routine||nativeWork ? subscribeCombatCover(syncRoutine) : () => {};
        if (routine||nativeWork) document.addEventListener('visibilitychange', syncRoutine);
        schedule();
        return () => {
            stopCover(); if (routine||nativeWork) document.removeEventListener('visibilitychange', syncRoutine);
            cancelAnimationFrame(rafRef.current);
            window.clearTimeout(stepTimerRef.current);
            window.clearTimeout(bubbleTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleClick() {
        const current=routine?visualActivity(routine,posRef.current,serverNow()):undefined;
        onEngageRef.current(nativeWork&&current?{...wanderer,greeting:current.line}:wanderer,current);
    }

    const img = wanderer.avatarImage || wandererAvatar(wanderer.avatarKey);
    const initials = wanderer.name.slice(0, 2).toUpperCase();
    const presentation=routine?lifeActivityAt(routine,serverNow()):undefined,tackle=routine?.fishing;
    // Name pills used to be one fixed height above every figure, so two
    // wanderers standing near each other printed overlapping, unreadable text.
    // A stable per-wanderer lane spreads them across three heights: it cannot
    // make a collision impossible on a 12x12 board, but it makes the common
    // case (two neighbours) legible, and it never jitters as they walk because
    // the lane comes from the id, not from where they happen to be standing.
    // Authored life already shares the batched collision packer. Start its names
    // near their owners rather than adding a second static vertical offset.
    const labelLane = routine ? 0 : labelLaneFor(wanderer.id);

    return (
        <div className="sector-wanderer-overlay" ref={wrapRef} aria-hidden={routine ? undefined : true}>
            {routine?.workTool&&<GroundWorkTool toolRef={workToolRef} tool={routine.workTool}/>}
            {tackle&&<svg ref={tackleRef} className="sector-fishing-tackle" viewBox="0 0 1200 1200" aria-hidden="true" data-water={tackle.water}>
                <path d={tackle.rod} stroke="#34291c" strokeWidth="5"/><path d={tackle.rod} stroke="#b29b6d" strokeWidth="2.5"/>
                <path d={tackle.cord} stroke="#e8dcc0" strokeWidth="1"/>
                <g transform={`translate(${(tackle.water%12+.5)*100} ${(Math.floor(tackle.water/12)+.5)*100})`}>
                    <ellipse className="sector-fishing-ripple" rx="10" ry="4"/>
                    <ellipse rx="3" ry="5" fill="#c39164" stroke="#493a29" strokeWidth="1"/>
                </g>
            </svg>}
            <div
                className="sector-avatar-figure sector-wanderer-figure"
                ref={figRef}
                role="button"
                tabIndex={routine ? 0 : -1}
                aria-label={routine ? `${routine.name}: ${presentation!.activity}. Talk` : undefined}
                data-life-resident={routine?.id}
                onKeyDown={routine ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClick(); } } : undefined}
                title={routine?`${routine.name} · ${presentation!.activity}`:`${wanderer.name} · Lv ${wanderer.level} · ${wanderer.verb === "petDuel" ? "Wild beast" : "Wandering shinobi"}`}
                onClick={handleClick}
                style={{ ["--marker-ring"]: SECTOR_RING_AI,visibility:nativeWork&&service===null?'hidden':undefined } as CSSProperties}
            >
                {bubble && <span className="sector-wanderer-bubble">{bubble}</span>}
                <span className="sector-avatar-shadow" />
                <span className="sector-avatar-aura" style={{ ["--aura"]: AURA[biome] } as CSSProperties} />
                <span className="sector-avatar-sprite" ref={spriteRef}>
                    <span className="sector-avatar-body">
                        <span className="sector-wanderer-tell" style={{ ["--tell"]: wanderer.tellTint } as CSSProperties} />
                        {img
                            ? <img src={img} alt={wanderer.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : <span className="sector-avatar-initials">{initials}</span>}
                        <span className="sector-avatar-pin" />
                    </span>
                </span>
                <span className="sector-wanderer-label" style={{ ["--label-lane"]: labelLane } as CSSProperties}>
                    {wanderer.name}
                </span>
            </div>

        </div>
    );
}
