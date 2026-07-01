// World-map pinch/drag zoom (worldMapZoom.v1).
//
// The painted world map (`world_map.webp`) is a fixed 3:2 layer with ~60 sector
// markers pinned to percentage coordinates. On desktop it already fits the
// screen responsively (`.generated-world-map { width:100%; aspect-ratio }`), but
// the legacy MOBILE path forced it to a fixed 1100×733 canvas with horizontal
// scrolling + 2× inflated markers — which piled the markers into an unreadable,
// un-tappable blob and clipped the map at the screen edges.
//
// This hook restores the fit-to-screen painting on mobile and adds a proper
// pan/zoom surface on top (one finger pans, two fingers pinch, double-tap
// toggles, +/- buttons, village jump). The whole map (background + every marker
// + the ownership overlay) rides ONE transform on the map div, so everything
// stays perfectly registered. Gameplay is untouched — only how the map meets the
// screen changes.
//
// COSMETIC / UI ONLY: no balance, saves, rewards, or travel logic here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MIN_ZOOM = 1;            // fit-to-width — the whole painting is visible
const MAX_ZOOM = 4;            // deep enough for comfortable tap targets
const DOUBLE_TAP_ZOOM = 2.6;   // where a double-tap lands (markers ≈ 55px)
const CHIP_ZOOM = 2.4;         // village quick-jump target zoom
const DOUBLE_TAP_MS = 320;     // max gap between taps to count as a double-tap
const TAP_SLOP_PX = 14;        // max finger travel that still counts as a tap

/** Master flag. Default ON for narrow / touch viewports; a per-device
 *  `worldMapZoom.v1` localStorage override forces it on ("1") or off ("0").
 *  Off falls back to the legacy fixed-canvas mobile scroll map. */
export function isWorldMapZoomEnabled(): boolean {
    try {
        const o = localStorage.getItem("worldMapZoom.v1");
        if (o === "0") return false;
        if (o === "1") return true;
    } catch { /* private mode — fall through to viewport default */ }
    try {
        return typeof window !== "undefined"
            && typeof window.matchMedia === "function"
            && window.matchMedia("(max-width: 800px)").matches;
    } catch {
        return false;
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Pt { x: number; y: number }

export interface WorldMapZoomApi {
    /** True when zoom mode is active (narrow/touch + flag). When false the map
     *  renders exactly as the legacy path — this hook adds nothing. */
    active: boolean;
    /** Current zoom (1 = whole map visible). */
    zoom: number;
    /** Attach to the `.world-map-scroll` viewport element. */
    viewportRef: (el: HTMLDivElement | null) => void;
    /** Pointer/wheel handlers for the viewport (no-ops when inactive). */
    viewportHandlers: {
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
        onPointerCancel: (e: React.PointerEvent) => void;
        onWheel: (e: React.WheelEvent) => void;
    };
    /** Inline style for the map div (sets the `--wm-tf` transform var). */
    contentStyle: React.CSSProperties;
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
    /** Fly to a map point given in map-percent coords (0–100) at a tappable zoom. */
    focusPoint: (xPct: number, yPct: number, targetZoom?: number) => void;
}

export function useWorldMapZoom(): WorldMapZoomApi {
    const [active, setActive] = useState<boolean>(() => isWorldMapZoomEnabled());
    const [view, setView] = useState({ zoom: MIN_ZOOM, tx: 0, ty: 0 });
    const [dragging, setDragging] = useState(false);

    // Live refs so pointer handlers never read stale closure state.
    const elRef = useRef<HTMLDivElement | null>(null);
    const sizeRef = useRef({ w: 0, h: 0 });
    // Mirror live state into refs (in effects, not during render) so the pointer
    // handlers never read stale closure values.
    const viewRef = useRef(view);
    const activeRef = useRef(active);
    useEffect(() => { viewRef.current = view; }, [view]);
    useEffect(() => { activeRef.current = active; }, [active]);

    const pointers = useRef<Map<number, Pt>>(new Map());
    const pinch = useRef<{ dist: number; mid: Pt } | null>(null);
    const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
    const moved = useRef(0);

    // ── Activation: track viewport width + the flag override ──────────────────
    useEffect(() => {
        if (typeof window === "undefined") return;
        const recompute = () => {
            const next = isWorldMapZoomEnabled();
            setActive(next);
            // Leaving zoom mode (resized to desktop): drop back to the fit view so
            // a later re-entry doesn't start mid-zoom. Done in the listener (not an
            // effect body) to avoid a cascading-render setState.
            if (!next) setView({ zoom: MIN_ZOOM, tx: 0, ty: 0 });
        };
        let mq: MediaQueryList | null = null;
        try { mq = window.matchMedia("(max-width: 800px)"); } catch { mq = null; }
        mq?.addEventListener?.("change", recompute);
        window.addEventListener("resize", recompute);
        return () => {
            mq?.removeEventListener?.("change", recompute);
            window.removeEventListener("resize", recompute);
        };
    }, []);

    // Tag <html> so the CSS override (fit-to-screen + reset marker sizing) applies
    // only in zoom mode; the legacy fixed-canvas rules stay the fallback.
    useEffect(() => {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        if (active) root.classList.add("wm-zoom");
        else root.classList.remove("wm-zoom");
        return () => root.classList.remove("wm-zoom");
    }, [active]);

    // ── Measure the viewport (drives pan clamping) ───────────────────────────
    const viewportRef = useCallback((el: HTMLDivElement | null) => {
        elRef.current = el;
        if (!el) return;
        const measure = () => {
            sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        (el as HTMLDivElement & { _wmRo?: ResizeObserver })._wmRo = ro ?? undefined;
    }, []);

    const clampPan = useCallback((zoom: number, tx: number, ty: number) => {
        const { w, h } = sizeRef.current;
        return {
            tx: clamp(tx, w * (1 - zoom), 0),
            ty: clamp(ty, h * (1 - zoom), 0),
        };
    }, []);

    // Zoom to `nextZoom` while holding the map point under (fx,fy) — viewport-
    // relative pixels — fixed on screen.
    const zoomAt = useCallback((nextZoom: number, fx: number, fy: number) => {
        setView((v) => {
            const z1 = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
            const tx = fx - (fx - v.tx) / v.zoom * z1;
            const ty = fy - (fy - v.ty) / v.zoom * z1;
            const p = clampPan(z1, tx, ty);
            return { zoom: z1, tx: p.tx, ty: p.ty };
        });
    }, [clampPan]);

    const centerZoom = useCallback((nextZoom: number) => {
        const { w, h } = sizeRef.current;
        zoomAt(nextZoom, w / 2, h / 2);
    }, [zoomAt]);

    // ── Pointer gestures ─────────────────────────────────────────────────────
    const localPt = (e: React.PointerEvent): Pt => {
        const r = elRef.current?.getBoundingClientRect();
        return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
    };

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const p = localPt(e);
        pointers.current.set(e.pointerId, p);
        moved.current = 0;
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = {
                dist: Math.hypot(a.x - b.x, a.y - b.y),
                mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            };
        }
        setDragging(true);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        if (!pointers.current.has(e.pointerId)) return;
        const prev = pointers.current.get(e.pointerId)!;
        const p = localPt(e);
        pointers.current.set(e.pointerId, p);

        if (pointers.current.size >= 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const ratio = pinch.current.dist > 0 ? dist / pinch.current.dist : 1;
            const dMidX = mid.x - pinch.current.mid.x;
            const dMidY = mid.y - pinch.current.mid.y;
            setView((v) => {
                const z1 = clamp(v.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
                const tx = mid.x - (mid.x - v.tx) / v.zoom * z1 + dMidX;
                const ty = mid.y - (mid.y - v.ty) / v.zoom * z1 + dMidY;
                const c = clampPan(z1, tx, ty);
                return { zoom: z1, tx: c.tx, ty: c.ty };
            });
            pinch.current = { dist, mid };
            moved.current += Math.abs(dMidX) + Math.abs(dMidY) + Math.abs(ratio - 1) * 100;
            return;
        }

        // Single-finger drag → pan.
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        moved.current += Math.abs(dx) + Math.abs(dy);
        setView((v) => {
            const c = clampPan(v.zoom, v.tx + dx, v.ty + dy);
            return { zoom: v.zoom, tx: c.tx, ty: c.ty };
        });
    }, [clampPan]);

    const endPointer = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        const p = localPt(e);
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) setDragging(false);

        // Double-tap toggle (only a clean tap — little finger travel).
        if (moved.current <= TAP_SLOP_PX) {
            const now = typeof performance !== "undefined" ? performance.now() : 0;
            const prev = lastTap.current;
            if (prev && now - prev.t < DOUBLE_TAP_MS
                && Math.hypot(p.x - prev.x, p.y - prev.y) < 40) {
                if (viewRef.current.zoom <= MIN_ZOOM + 0.05) zoomAt(DOUBLE_TAP_ZOOM, p.x, p.y);
                else setView({ zoom: MIN_ZOOM, tx: 0, ty: 0 });
                lastTap.current = null;
                return;
            }
            lastTap.current = { t: now, x: p.x, y: p.y };
        }
    }, [zoomAt]);

    const onWheel = useCallback((e: React.WheelEvent) => {
        if (!activeRef.current) return;
        const r = elRef.current?.getBoundingClientRect();
        const fx = e.clientX - (r?.left ?? 0);
        const fy = e.clientY - (r?.top ?? 0);
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAt(viewRef.current.zoom * factor, fx, fy);
    }, [zoomAt]);

    const focusPoint = useCallback((xPct: number, yPct: number, targetZoom = CHIP_ZOOM) => {
        const { w, h } = sizeRef.current;
        const z = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
        const cx = (xPct / 100) * w;
        const cy = (yPct / 100) * h;
        const p = clampPan(z, w / 2 - cx * z, h / 2 - cy * z);
        setView({ zoom: z, tx: p.tx, ty: p.ty });
    }, [clampPan]);

    const contentStyle = useMemo<React.CSSProperties>(() => {
        if (!active) return {};
        return {
            // Consumed by the `.wm-zoom … { transform: var(--wm-tf) }` rule so it
            // overrides the legacy `transform: none !important` mobile rule.
            ["--wm-tf" as string]: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`,
            transition: dragging ? "none" : "transform 140ms ease-out",
        } as React.CSSProperties;
    }, [active, view, dragging]);

    return {
        active,
        zoom: view.zoom,
        viewportRef,
        viewportHandlers: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onWheel },
        contentStyle,
        zoomIn: () => centerZoom(viewRef.current.zoom * 1.4),
        zoomOut: () => centerZoom(viewRef.current.zoom / 1.4),
        reset: () => setView({ zoom: MIN_ZOOM, tx: 0, ty: 0 }),
        focusPoint,
    };
}
