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
 * Phase 1 (behind the `wanderers.v1` flag): an "attack" wanderer launches a
 * fight when it reaches you; the others greet with a speech bubble. Renderer +
 * movement only — the actual fight is started by <WorldMap> through the existing
 * arena AI path, so nothing here touches combat, rewards, or saves.
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Biome } from "../types/core";
import type { Wanderer } from "../lib/wanderers";
import { wandererAvatar } from "../lib/wanderer-art";

const GRID_W = 12;
const GRID_H = 12;
const PAD = 8;
const GAP = 1;
const FIGURE_W = 0.52;          // a touch smaller than the player's pin
const FIGURE_H = 0.70;
const BASE_ANCHOR = 100;        // pin tip lands on the tile centre
const WALK_TILES_PER_SEC = 5.0; // ambles a little slower than the player (6.5)
const NOTICE_TILES = 3.6;       // how close before it turns toward you
const ENGAGE_TILES = 0.8;       // "we've met" distance
const ARM_DELAY_MS = 1200;      // grace after entering a sector before it can engage

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
    const engagedRef = useRef(false);
    const greetedRef = useRef(false);

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
                const t = Math.max(0, tileSizePx());
                fig.style.width = `${t * FIGURE_W}px`;
                fig.style.height = `${t * FIGURE_H}px`;
            }
            paint();
        });
        ro.observe(grid);
        return () => ro.disconnect();
    }, []);

    // The movement loop.
    useEffect(() => {
        if (prefersReducedMotion()) { paint(); return; } // static placement, still interactive
        armedAtRef.current = performance.now() + ARM_DELAY_MS;
        const wps = wanderer.waypoints.length ? wanderer.waypoints : [wanderer.homeTile];

        const tick = (ts: number) => {
            if (!lastTsRef.current) lastTsRef.current = ts;
            const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
            lastTsRef.current = ts;

            if (engagedRef.current) return; // fight launched — stop

            const p = posRef.current;
            const pcol = colOf(playerRef.current);
            const prow = rowOf(playerRef.current);
            const distPlayer = Math.hypot(pcol - p.col, prow - p.row);
            const armed = ts >= armedAtRef.current;

            let tCol: number, tRow: number;

            if (armed && distPlayer <= NOTICE_TILES) {
                // ── Approach: walk up to the player ──────────────────────────
                if (distPlayer <= ENGAGE_TILES) {
                    setWalking(false);
                    if (wanderer.verb === "attack") {
                        engagedRef.current = true;
                        onEngageRef.current(wanderer);   // <WorldMap> starts the fight
                        return;
                    }
                    if (!greetedRef.current) { greetedRef.current = true; speak(wanderer.greeting); }
                    rafRef.current = requestAnimationFrame(tick); // hold adjacent
                    return;
                }
                tCol = pcol; tRow = prow;
            } else {
                // ── Patrol: amble between waypoints ──────────────────────────
                greetedRef.current = false;
                const cur = wps[wpIndexRef.current % wps.length];
                const atWp = Math.hypot(colOf(cur) - p.col, rowOf(cur) - p.row) < 0.06;
                if (atWp) {
                    if (ts < pauseUntilRef.current) { setWalking(false); rafRef.current = requestAnimationFrame(tick); return; }
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
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => { cancelAnimationFrame(rafRef.current); window.clearTimeout(bubbleTimer.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleClick() {
        if (engagedRef.current) return;
        if (wanderer.verb === "attack") engagedRef.current = true;
        onEngageRef.current(wanderer);   // attack → fight; gift/gamble → <WorldMap> dialog
    }

    const img = wandererAvatar(wanderer.avatarKey);
    const initials = wanderer.name.slice(0, 2).toUpperCase();

    return (
        <div className="sector-wanderer-overlay" ref={wrapRef} aria-hidden="true">
            <div
                className="sector-avatar-figure sector-wanderer-figure"
                ref={figRef}
                role="button"
                tabIndex={-1}
                title={`${wanderer.name} · Lv ${wanderer.level} · Wandering shinobi`}
                onClick={handleClick}
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
                <span className="sector-wanderer-label">{wanderer.name}</span>
            </div>
        </div>
    );
}
