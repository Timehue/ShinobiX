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
import { SectorModelFigure, type SectorModelHandle } from "../../components/SectorModelFigure";
import type { PlayerModel, SprintStyle } from "../../lib/player-model";

// Base glide speed — slightly faster than the walk-logic cadence so the
// sprite arrives at each tile before the next step lands.
const TILES_PER_SEC = 1150 / HOLLOW_GATE_STEP_MS;
// A glide completes just before the next scheduled tile. Allow two display
// frames for its React update before starting a planted stop.
const STEP_GAP_MS = HOLLOW_GATE_STEP_MS - 1000 / TILES_PER_SEC + 1000 / 30;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function HollowGateAvatar({ tileX, tileY, tilePx, avatarImage, name, onSelect, disposition, label,
    artBase, modelKind, equipped, sprintStyle, self }: {
    tileX: number;
    tileY: number;
    tilePx: number;
    avatarImage?: string;
    name: string;
    onSelect?: () => void;
    disposition?: 'friendly' | 'hostile';
    label?: string;
    artBase?: string | null;
    modelKind?: string;
    equipped?: PlayerModel;
    sprintStyle?: SprintStyle;
    /** The player's own avatar (decodes its figure first). */
    self?: boolean;
}) {
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);
    const model = useRef<SectorModelHandle>(null);
    const posRef = useRef({ x: tileX, y: tileY });
    const waypointsRef = useRef<Array<{ x: number; y: number }>>([]);
    const facingRef = useRef(1);
    const rafRef = useRef(0);
    const lastTsRef = useRef(0);
    const tileRef = useRef(tilePx);
    // Layout effects run in declaration order, so the tile-size mirror lands
    // before the first paint below (a ref write during render trips the
    // hooks purity rule).
    useLayoutEffect(() => { tileRef.current = tilePx; paint(false, true); }, [tilePx, artBase, modelKind, equipped?.assetId, equipped?.version, sprintStyle]);

    function paint(moving = false, snap = false) {
        const fig = figRef.current;
        if (!fig) return;
        const cx = (posRef.current.x + 0.5) * tileRef.current;
        const cy = (posRef.current.y + 0.5) * tileRef.current;
        // Anchor the figure's BASE on the tile centre (the feet, not the head).
        fig.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, var(--hg-avatar-anchor, -88%))`;
        spriteRef.current?.style.setProperty("--face", String(facingRef.current));
        const width = tileRef.current * 12;
        if (snap) model.current?.snap(cx, cy, width);
        else model.current?.place(cx, cy, width, moving, undefined, moving);
    }

    function stopGlide() {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        lastTsRef.current = 0;
        waypointsRef.current = [];
        figRef.current?.classList.remove('is-walking');
    }

    useEffect(() => {
        if (document.hidden || prefersReducedMotion()) {
            stopGlide();
            posRef.current = { x: tileX, y: tileY };
            paint(false, true);
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
        figRef.current?.classList.add("is-walking");
        if (rafRef.current) return;                 // glide or braking loop already running

        lastTsRef.current = 0;
        let lastTravel = 0;
        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            // A slow display can present a whole step in one frame. The single
            // queue head below still prevents crossing a corner in that frame.
            const dt = Math.min(HOLLOW_GATE_STEP_MS, ts - lastTsRef.current) / 1000;
            lastTsRef.current = ts;
            const queue = waypointsRef.current;
            const head = queue[0];
            if (!head) {
                if (model.current && ts - lastTravel < STEP_GAP_MS) {
                    rafRef.current = requestAnimationFrame(tick);
                    return;
                }
                figRef.current?.classList.remove("is-walking");
                rafRef.current = model.current?.stop() ? requestAnimationFrame(tick) : 0;
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
            paint(true);
            lastTravel = ts;
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        // No cleanup between waypoints — the loop drains the queue and stops
        // itself; unmount cleanup below cancels for real.
    }, [tileX, tileY, tilePx]);

    // rAF suspends in hidden tabs, which would freeze a glide mid-stride and
    // replay the backlog on return. Snap to the newest waypoint instead.
    useEffect(() => {
        const snap = () => {
            const q = waypointsRef.current;
            if (q.length > 0) posRef.current = q[q.length - 1];
            stopGlide();
            paint(false, true);
        };
        const onVis = () => { if (document.hidden) snap(); };
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onMotion = () => { if (motion.matches) snap(); };
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener('pagehide', snap);
        motion.addEventListener('change', onMotion);
        return () => {
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener('pagehide', snap);
            motion.removeEventListener('change', onMotion);
            stopGlide();
        };
    }, []);

    const initials = name.slice(0, 2).toUpperCase();
    const figSize = Math.min(56, tilePx * 0.64);

    return (
        <div className={`hg-avatar${disposition ? ` hg-wanderer is-${disposition}` : ''}`} ref={figRef}
            style={{ width: figSize, height: figSize * 1.28 }} aria-hidden={onSelect ? undefined : true}
            role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `${name}, ${label}` : undefined}
            onClick={onSelect} onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(); } } : undefined}>
            <span className="hg-avatar-shadow" />
            {artBase && modelKind && <SectorModelFigure key={modelKind} ref={model} kind={modelKind}
                equipped={equipped} style={sprintStyle} artBase={artBase} self={self} />}
            <span className="hg-avatar-aura" />
            <span className="hg-avatar-sprite" ref={spriteRef}>
                <span className="hg-avatar-body">
                    {avatarImage
                        ? <img src={avatarImage} alt={name} style={disposition ? { objectFit: 'contain' } : undefined} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <span className="hg-avatar-initials">{initials}</span>}
                </span>
                <span className="hg-avatar-pin" />
            </span>
            {label && <span className="hg-avatar-label"><b>{name}</b><small>{label}</small></span>}
        </div>
    );
}
