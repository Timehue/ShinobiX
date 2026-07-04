/*
 * SectorWeeklyBossActor — the roaming weekly boss as an in-sector figure
 * (roaming-weekly-boss-plan, Phase 3).
 *
 * A menacing, oversized billboard that ALWAYS hunts: once armed it bears down on
 * the player from across the 12×12 sector grid, and on contact fires onEngage()
 * — the Stand/Flee telegraph. <WorldMap> only mounts it when the player is
 * physically standing in the boss's current sector (and it's off cooldown with
 * attempts left), so its mere presence IS the "the boss is here" signal.
 *
 * Forked from SectorWanderer (rather than reused) so the live wanderer system
 * (wanderers.v1, default ON) is untouched, and so the boss can loom larger and
 * wear its own portrait. Renderer/movement only — the fight is launched by
 * <WorldMap> through launchWeeklyBossFight, so nothing here touches combat.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef } from "react";
import type { Biome } from "../types/core";

const GRID_W = 12;
const GRID_H = 12;
const PAD = 8;
const GAP = 1;
const FIGURE_W = 0.9;           // looms larger than a wanderer (0.52) or the player
const FIGURE_H = 1.2;
const BASE_ANCHOR = 100;        // pin tip lands on the tile centre
const WALK_TILES_PER_SEC = 4.4; // a heavy, deliberate stalk
const ENGAGE_TILES = 0.9;       // "it's upon you" distance → open the Stand/Flee prompt
const ARM_DELAY_MS = 1400;      // a beat after you enter before it lunges

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
const colOf = (t: number) => t % GRID_W;
const rowOf = (t: number) => Math.floor(t / GRID_W);
const HOME_TILE = 5; // top-centre — it walks DOWN into the sector toward the player

export function SectorWeeklyBossActor({
    playerIndex,
    biome,
    portrait,
    name,
    onEngage,
}: {
    playerIndex: number;
    biome: Biome;
    portrait?: string;
    name: string;
    onEngage: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const figRef = useRef<HTMLDivElement | null>(null);
    const spriteRef = useRef<HTMLSpanElement | null>(null);

    const posRef = useRef({ col: colOf(HOME_TILE), row: rowOf(HOME_TILE) });
    const facingRef = useRef(1);
    const sizeRef = useRef({ w: 0, h: 0 });
    const metricsRef = useRef({ padX: PAD, padY: PAD, gapX: GAP, gapY: GAP });
    const rafRef = useRef(0);
    const lastTsRef = useRef(0);
    const armedAtRef = useRef(0);
    const greetedRef = useRef(false);

    // latest props for the long-lived RAF closure
    const playerRef = useRef(playerIndex);
    const onEngageRef = useRef(onEngage);
    useEffect(() => { playerRef.current = playerIndex; }, [playerIndex]);
    useEffect(() => { onEngageRef.current = onEngage; }, [onEngage]);

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

    // Measure the parent .pixel-map grid (same approach as SectorAvatar/SectorWanderer).
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

    // The stalk loop — always hunts the player.
    useEffect(() => {
        if (prefersReducedMotion()) { paint(); return; } // static placement, still interactive (click to engage)
        armedAtRef.current = performance.now() + ARM_DELAY_MS;

        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
            lastTsRef.current = ts;

            const p = posRef.current;
            const pcol = colOf(playerRef.current);
            const prow = rowOf(playerRef.current);
            const distPlayer = Math.hypot(pcol - p.col, prow - p.row);
            const armed = ts >= armedAtRef.current;
            // Re-arm the lunge if the player breaks well away, so it confronts
            // them again when it catches back up.
            if (distPlayer > ENGAGE_TILES * 3) greetedRef.current = false;

            let tCol: number, tRow: number;
            if (armed) {
                if (distPlayer <= ENGAGE_TILES) {
                    setWalking(false);
                    if (!greetedRef.current) { greetedRef.current = true; onEngageRef.current(); }
                    rafRef.current = requestAnimationFrame(tick); // hold adjacent
                    return;
                }
                tCol = pcol; tRow = prow; // ALWAYS hunt toward the player
            } else {
                tCol = p.col; tRow = p.row; // hold at spawn during the arm delay
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
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <div className="sector-wanderer-overlay" ref={wrapRef} aria-hidden="true">
            <div
                className="sector-avatar-figure sector-wanderer-figure"
                ref={figRef}
                role="button"
                tabIndex={-1}
                title={`${name} — the Weekly Boss is bearing down on you`}
                onClick={() => onEngageRef.current()}
                style={{ filter: "drop-shadow(0 0 10px rgba(236,91,56,.85))" } as CSSProperties}
            >
                <span className="sector-avatar-shadow" />
                <span className="sector-avatar-aura" style={{ ["--aura"]: AURA[biome] } as CSSProperties} />
                <span className="sector-avatar-sprite" ref={spriteRef}>
                    <span className="sector-avatar-body">
                        <span className="sector-wanderer-tell" style={{ ["--tell"]: "#ec5b38" } as CSSProperties} />
                        {portrait
                            ? <img src={portrait} alt={name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            : <span className="sector-avatar-initials" style={{ fontSize: "1.3em" }}>👹</span>}
                        <span className="sector-avatar-pin" />
                    </span>
                </span>
                <span className="sector-wanderer-label" style={{ color: "#ffd9cc", fontWeight: 700 }}>⚔ {name}</span>
            </div>
        </div>
    );
}
