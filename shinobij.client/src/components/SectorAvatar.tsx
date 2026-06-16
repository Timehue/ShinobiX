/*
 * SectorAvatar — the player's avatar as a grounded, *walking* overlay inside a
 * sector scene. Track 1 of the "living sectors" work.
 *
 * Instead of the avatar snapping between grid cells, it smoothly walks toward
 * the target tile (the same `sectorPlayerPos` the grid already uses) with a
 * contact shadow, a walk-bob (squash/stretch), footstep dust, a directional
 * flip, and a biome-tinted aura. The gold target tile underneath doubles as a
 * destination marker.
 *
 * Works with ANY player-chosen portrait — no per-avatar art is generated. The
 * 3D/alive feel comes from how the flat image is *presented* (grounded billboard
 * + shadow + motion), not from the image itself, so it applies to every current
 * and future avatar identically.
 *
 * Renderer-only and self-contained: it never touches game logic, balance, or
 * saves. pointer-events:none, so click-to-move underneath keeps working. Honors
 * prefers-reduced-motion (snaps instantly, no walk/bob/dust). Matches the grid's
 * exact tile centres (padding + gap aware) so the avatar lands on the clicked
 * tile.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Biome } from "../types/core";

// .pixel-map is a 12×12 grid. Its padding + gap differ by breakpoint (8px/1px on
// desktop, 4px on mobile), so the real values are read from getComputedStyle at
// measure time — PAD/GAP are only the pre-measure fallbacks.
const GRID_W = 12;
const GRID_H = 12;
const PAD = 8;
const GAP = 1;
const WALK_TILES_PER_SEC = 6.5; // glide speed across the grid
// The avatar is a small "map-pin": a round portrait floating up top with a pointer
// that tapers down to a single contact point on the tile (like a location marker /
// the temple sprite's base sitting on a hex). The pin TIP — not the circle — is
// anchored on the tile centre, so the marker reads as planted in the biome, and a
// small planted shadow at the tip pulses while the marker gently bobs. The figure
// box is narrower than a tile (the circle) and tall enough to hold circle + pin.
const FIGURE_W = 0.58;      // box width  (× tile) — the circle's diameter
const FIGURE_H = 0.86;      // box height (× tile) — circle + pointer
const BASE_ANCHOR = 100;    // % down the box that lands on the tile centre (the pin tip)

// Soft glow tint per biome — same palette family as <SceneAmbience>.
const AURA: Record<Biome, string> = {
    snow: "#cfe8ff",
    volcano: "#ff8a3d",
    shadow: "#c9a2ff",
    forest: "#9bf0a6",
    central: "#ffe9a6",
};

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Centre (px) of grid cell `n` along an axis of length `size` with `count`
// tracks, accounting for the .pixel-map padding + gaps so the avatar lines up
// with the actual tile the player clicked.
function cellCentre(size: number, count: number, n: number, pad: number, gap: number): number {
    const tile = (size - 2 * pad - (count - 1) * gap) / count;
    return pad + n * (tile + gap) + tile / 2;
}

type Puff = { id: number; x: number; y: number };

export function SectorAvatar({
    targetIndex,
    avatarImage,
    name,
    biome,
}: {
    targetIndex: number;
    avatarImage?: string;
    name: string;
    biome: Biome;
}) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);
    const posRef = useRef({ col: targetIndex % GRID_W, row: Math.floor(targetIndex / GRID_W) });
    const facingRef = useRef(1);
    const sizeRef = useRef({ w: 0, h: 0 });
    const metricsRef = useRef({ padX: PAD, padY: PAD, gapX: GAP, gapY: GAP });
    const rafRef = useRef(0);
    const lastTsRef = useRef(0);
    const lastStepTileRef = useRef(-1);
    const puffIdRef = useRef(0);
    const [puffs, setPuffs] = useState<Puff[]>([]);

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
        // Anchor the box BASE (the pin tip) on the tile centre, so the marker is
        // planted at the spot with the circle floating above it.
        fig.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -${BASE_ANCHOR}%)`;
    }

    function applyFacing() {
        spriteRef.current?.style.setProperty("--face", String(facingRef.current));
    }

    // The walk animation is a CSS class toggled imperatively (not React state) so
    // starting/stopping a walk never triggers a re-render.
    function setWalkingClass(on: boolean) {
        figRef.current?.classList.toggle("is-walking", on);
    }

    // Measure the grid (our parent) and keep the figure sized + positioned on resize.
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
                const t = Math.max(0, tileSizePx());
                fig.style.width = `${t * FIGURE_W}px`;
                fig.style.height = `${t * FIGURE_H}px`;
            }
            paint();
        });
        ro.observe(grid);
        return () => ro.disconnect();
    }, []);

    // Walk toward the target whenever it changes.
    useEffect(() => {
        const tCol = targetIndex % GRID_W;
        const tRow = Math.floor(targetIndex / GRID_W);

        if (prefersReducedMotion()) {
            posRef.current = { col: tCol, row: tRow };
            paint();
            setWalkingClass(false);
            return;
        }

        lastTsRef.current = 0;
        setWalkingClass(true);

        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
            lastTsRef.current = ts;

            const p = posRef.current;
            const dx = tCol - p.col;
            const dy = tRow - p.row;
            const dist = Math.hypot(dx, dy);
            const step = WALK_TILES_PER_SEC * dt;

            if (Math.abs(dx) > 0.02) { facingRef.current = dx < 0 ? -1 : 1; applyFacing(); }

            if (dist <= step || dist < 0.02) {
                posRef.current = { col: tCol, row: tRow };
                paint();
                setWalkingClass(false);
                return;
            }

            posRef.current = { col: p.col + (dx / dist) * step, row: p.row + (dy / dist) * step };
            paint();

            // Footstep dust each time we cross into a new tile.
            const tileNow = Math.round(posRef.current.row) * GRID_W + Math.round(posRef.current.col);
            if (tileNow !== lastStepTileRef.current && sizeRef.current.w) {
                lastStepTileRef.current = tileNow;
                const { w, h } = sizeRef.current;
                const { padX, padY, gapX, gapY } = metricsRef.current;
                const t = tileSizePx();
                const px = cellCentre(w, GRID_W, posRef.current.col, padX, gapX);
                const py = cellCentre(h, GRID_H, posRef.current.row, padY, gapY) + t * 0.04; // at the pin tip
                const id = puffIdRef.current++;
                setPuffs(prev => [...prev.slice(-5), { id, x: px, y: py }]);
                window.setTimeout(() => setPuffs(prev => prev.filter(pf => pf.id !== id)), 520);
            }

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [targetIndex]);

    const initials = name.slice(0, 2).toUpperCase();

    return (
        <div className="sector-avatar-overlay" ref={wrapRef} aria-hidden="true">
            {puffs.map(pf => (
                <span key={pf.id} className="sector-avatar-dust" style={{ left: `${pf.x}px`, top: `${pf.y}px` }} />
            ))}
            <div className="sector-avatar-figure" ref={figRef}>
                <span className="sector-avatar-shadow" />
                <span className="sector-avatar-aura" style={{ ["--aura"]: AURA[biome] } as CSSProperties} />
                <span className="sector-avatar-sprite" ref={spriteRef}>
                    <span className="sector-avatar-body">
                        {avatarImage
                            ? <img src={avatarImage} alt={name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : <span className="sector-avatar-initials">{initials}</span>}
                        <span className="sector-avatar-pin" />
                    </span>
                </span>
            </div>
        </div>
    );
}
