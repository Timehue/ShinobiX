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
 * Phase 1 (always on — the `wanderers.v1` opt-out was retired): an "attack"
 * wanderer launches a
 * fight when it reaches you; the others greet with a speech bubble. Renderer +
 * movement only — the actual fight is started by <WorldMap> through the existing
 * arena AI path, so nothing here touches combat, rewards, or saves.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Biome } from "../types/core";
import type { Wanderer } from "../lib/wanderers";
import { wandererAvatar } from "../lib/wanderer-art";
import { SECTOR_MARKER_ANCHOR, SECTOR_RING_AI, sectorMarkerBox } from "../lib/sector-marker";

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

export function SectorWanderer({
    wanderer,
    playerIndex,
    biome,
    onEngage,
}: {
    wanderer: Wanderer;
    playerIndex: number;
    biome: Biome;
    onEngage: (w: Wanderer) => void;
}) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);

    const posRef = useRef({ col: colOf(wanderer.homeTile), row: rowOf(wanderer.homeTile) });
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
    useEffect(() => { playerRef.current = playerIndex; }, [playerIndex]);
    useEffect(() => { onEngageRef.current = onEngage; }, [onEngage]);

    const [bubble, setBubble] = useState<string | null>(null);
    const bubbleTimer = useRef(0);
    function speak(line: string) {
        setBubble(line);
        window.clearTimeout(bubbleTimer.current);
        bubbleTimer.current = window.setTimeout(() => setBubble(null), 3600);
    }

    function tileSizePx(): number {
        const { padX, gapX } = metricsRef.current;
        return (sizeRef.current.w - 2 * padX - (GRID_W - 1) * gapX) / GRID_W;
    }
    function paint() {
        const fig = figRef.current;
        const { w, h } = sizeRef.current;
        if (!fig || !w || !h) return;
        const { padX, padY, gapX, gapY } = metricsRef.current;
        const cx = cellCentre(w, GRID_W, posRef.current.col, padX, gapX);
        const cy = cellCentre(h, GRID_H, posRef.current.row, padY, gapY);
        fig.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -${BASE_ANCHOR}%)`;
    }
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
    }, []);

    // The movement loop.
    useEffect(() => {
        const reduced = prefersReducedMotion();
        const maxDt = reduced ? REDUCED_STEP_MS / 1000 : SMOOTH_MAX_DT;
        const schedule = () => {
            if (reduced) stepTimerRef.current = window.setTimeout(() => tick(performance.now()), REDUCED_STEP_MS);
            else rafRef.current = requestAnimationFrame(tick);
        };
        armedAtRef.current = performance.now() + ARM_DELAY_MS;
        const wps = wanderer.waypoints.length ? wanderer.waypoints : [wanderer.homeTile];

        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            const dt = Math.min(maxDt, (ts - lastTsRef.current) / 1000);
            lastTsRef.current = ts;

            const p = posRef.current;
            const pcol = colOf(playerRef.current);
            const prow = rowOf(playerRef.current);
            const distPlayer = Math.hypot(pcol - p.col, prow - p.row);
            const armed = ts >= armedAtRef.current;
            // Bandits HUNT: once they spot you they path to you and confront you,
            // and they keep coming until you break the leash. Everyone else is
            // passive — they only turn toward you once you come close, then greet.
            const isHunter = wanderer.verb === "attack" || wanderer.verb === "bountyHunter";
            if (isHunter) {
                if (distPlayer <= HUNT_SPOT_TILES) huntingRef.current = true;
                else if (distPlayer > HUNT_LEASH_TILES) huntingRef.current = false;
            }
            const closing = isHunter ? huntingRef.current : distPlayer <= NOTICE_TILES;
            // Slipping out of notice range re-arms the meeting, so a hunter you've
            // outrun can confront you again when it catches back up.
            if (distPlayer > NOTICE_TILES) greetedRef.current = false;

            let tCol: number, tRow: number;

            if (armed && closing) {
                // ── Approach: walk up to the player ──────────────────────────
                if (distPlayer <= ENGAGE_TILES) {
                    setWalking(false);
                    if (!greetedRef.current) {
                        greetedRef.current = true;
                        // A bandit confronts you (opens the Fight/Flee dialog);
                        // everyone else just greets — you click to interact.
                        if (isHunter) onEngageRef.current(wanderer);
                        else speak(wanderer.greeting);
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

        schedule();
        return () => {
            cancelAnimationFrame(rafRef.current);
            window.clearTimeout(stepTimerRef.current);
            window.clearTimeout(bubbleTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleClick() {
        onEngageRef.current(wanderer);   // opens the <WorldMap> interaction dialog
    }

    const img = wanderer.avatarImage || wandererAvatar(wanderer.avatarKey);
    const initials = wanderer.name.slice(0, 2).toUpperCase();
    // Name pills used to be one fixed height above every figure, so two
    // wanderers standing near each other printed overlapping, unreadable text.
    // A stable per-wanderer lane spreads them across three heights: it cannot
    // make a collision impossible on a 12x12 board, but it makes the common
    // case (two neighbours) legible, and it never jitters as they walk because
    // the lane comes from the id, not from where they happen to be standing.
    const labelLane = labelLaneFor(wanderer.id);

    return (
        <div className="sector-wanderer-overlay" ref={wrapRef} aria-hidden="true">
            <div
                className="sector-avatar-figure sector-wanderer-figure"
                ref={figRef}
                role="button"
                tabIndex={-1}
                title={`${wanderer.name} · Lv ${wanderer.level} · Wandering shinobi`}
                onClick={handleClick}
                style={{ ["--marker-ring"]: SECTOR_RING_AI } as CSSProperties}
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
