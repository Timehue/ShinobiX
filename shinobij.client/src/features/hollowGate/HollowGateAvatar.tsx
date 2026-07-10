/*
 * HollowGateAvatar — the player's avatar as a grounded, walking overlay inside
 * the dungeon board (the SectorAvatar presentation adapted to the shrine).
 *
 * The dungeon board is fixed-pixel (tile size known), so this is simpler than
 * SectorAvatar's grid-measuring version — but unlike sectors the shrine has
 * WALLS, so the sprite must never beeline across the map: every position
 * change is enqueued as a WAYPOINT and the sprite glides through them in
 * order, retracing the actual walked path (cardinal segments). If it falls
 * behind a fast walk it speeds up rather than cutting corners.
 *
 * Renderer-only and self-contained: pointer-events none, never touches run
 * state. Honors prefers-reduced-motion (snaps instantly, no bob).
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { HOLLOW_GATE_STEP_MS } from "./use-hollow-gate-walk";

// Base glide speed — slightly faster than the walk-logic cadence so the
// sprite arrives at each tile before the next step lands.
const TILES_PER_SEC = 1150 / HOLLOW_GATE_STEP_MS;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function HollowGateAvatar({ tileX, tileY, tilePx, avatarImage, name }: {
    tileX: number;
    tileY: number;
    tilePx: number;
    avatarImage?: string;
    name: string;
}) {
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);
    const posRef = useRef({ x: tileX, y: tileY });
    const waypointsRef = useRef<Array<{ x: number; y: number }>>([]);
    const facingRef = useRef(1);
    const rafRef = useRef(0);
    const lastTsRef = useRef(0);
    const tileRef = useRef(tilePx);
    // Layout effects run in declaration order, so the tile-size mirror lands
    // before the first paint below (a ref write during render trips the
    // hooks purity rule).
    useLayoutEffect(() => { tileRef.current = tilePx; });

    function paint() {
        const fig = figRef.current;
        if (!fig) return;
        const cx = (posRef.current.x + 0.5) * tileRef.current;
        const cy = (posRef.current.y + 0.5) * tileRef.current;
        // Anchor the figure's BASE on the tile centre (the feet, not the head).
        fig.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -88%)`;
        spriteRef.current?.style.setProperty("--face", String(facingRef.current));
    }

    // First paint before the browser paints — no flash at the board origin.
    useLayoutEffect(() => { paint(); }, []);

    useEffect(() => {
        if (prefersReducedMotion()) {
            waypointsRef.current = [];
            posRef.current = { x: tileX, y: tileY };
            paint();
            figRef.current?.classList.remove("is-walking");
            return;
        }
        // Enqueue the new logical tile as a waypoint (skip exact duplicates).
        const q = waypointsRef.current;
        const tail = q.length > 0 ? q[q.length - 1] : posRef.current;
        if (tail.x !== tileX || tail.y !== tileY) q.push({ x: tileX, y: tileY });
        if (q.length === 0) {
            // Nothing to glide to — make sure the walk styling is off (also
            // self-heals if a hot-reload interrupted a previous glide loop).
            paint();
            if (!rafRef.current) figRef.current?.classList.remove("is-walking");
            return;
        }
        if (rafRef.current) return;                 // glide loop already running

        lastTsRef.current = 0;
        figRef.current?.classList.add("is-walking");
        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
            lastTsRef.current = ts;
            const queue = waypointsRef.current;
            const head = queue[0];
            if (!head) {
                rafRef.current = 0;
                figRef.current?.classList.remove("is-walking");
                return;
            }
            const p = posRef.current;
            const dx = head.x - p.x;
            const dy = head.y - p.y;
            const dist = Math.hypot(dx, dy);
            // Catch-up: a long queue means the walk is outpacing us — hustle.
            const speed = TILES_PER_SEC * (queue.length > 2 ? 1.8 : queue.length > 1 ? 1.3 : 1);
            const step = speed * dt;
            if (Math.abs(dx) > 0.02) { facingRef.current = dx < 0 ? -1 : 1; }
            if (dist <= step || dist < 0.02) {
                posRef.current = { x: head.x, y: head.y };
                queue.shift();
            } else {
                posRef.current = { x: p.x + (dx / dist) * step, y: p.y + (dy / dist) * step };
            }
            paint();
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        // No cleanup between waypoints — the loop drains the queue and stops
        // itself; unmount cleanup below cancels for real.
    }, [tileX, tileY]);

    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    // rAF suspends in hidden tabs, which would freeze a glide mid-stride and
    // replay the backlog on return. Snap to the newest waypoint instead.
    useEffect(() => {
        const onVis = () => {
            if (document.visibilityState !== "hidden") return;
            const q = waypointsRef.current;
            if (q.length > 0) { posRef.current = q[q.length - 1]; q.length = 0; }
            paint();
            figRef.current?.classList.remove("is-walking");
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

    const initials = name.slice(0, 2).toUpperCase();
    const figSize = tilePx * 0.72;

    return (
        <div className="hg-avatar" ref={figRef} style={{ width: figSize, height: figSize * 1.28 }} aria-hidden="true">
            <span className="hg-avatar-shadow" />
            <span className="hg-avatar-aura" />
            <span className="hg-avatar-sprite" ref={spriteRef}>
                <span className="hg-avatar-body">
                    {avatarImage
                        ? <img src={avatarImage} alt={name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <span className="hg-avatar-initials">{initials}</span>}
                </span>
                <span className="hg-avatar-pin" />
            </span>
        </div>
    );
}
