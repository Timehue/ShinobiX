// World-map pinch/drag zoom (worldMapZoom.v1).
//
// The painted world map (`world_map.webp`) is a fixed 1672x941 layer with ~60 sector
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
import { VIEWPORT_BREAKPOINTS } from "./viewport-contract";

const MIN_ZOOM = 1;            // fit-to-width — the whole painting is visible
const MAX_ZOOM = 4;            // deep enough for comfortable tap targets
const DOUBLE_TAP_ZOOM = 2.6;   // where a double-tap lands (markers ≈ 55px)
const CHIP_ZOOM = 2.4;         // village quick-jump target zoom
const DOUBLE_TAP_MS = 320;     // max gap between taps to count as a double-tap
const TAP_SLOP_PX = 14;        // max finger travel that still counts as a tap
// The percentage-positioned landmarks and the painting share this exact source
// aspect. Tall viewports use a uniform cover transform; the artwork is never
// stretched away from its interactive coordinate system.
export const WORLD_MAP_ASPECT_RATIO = 1672 / 941;
const MOBILE_SHELL_QUERY = `(max-width: ${VIEWPORT_BREAKPOINTS.md - 1}px)`;

/** Master flag. Default ON for narrow / touch viewports; a per-device
 *  `worldMapZoom.v1` localStorage override forces gestures on ("1") or off
 *  ("0"). The fallback remains responsive and preserves the source aspect. */
export function isWorldMapZoomEnabled(): boolean {
    try {
        const o = localStorage.getItem("worldMapZoom.v1");
        if (o === "0") return false;
        if (o === "1") return true;
    } catch { /* private mode — fall through to viewport default */ }
    try {
        return typeof window !== "undefined"
            && typeof window.matchMedia === "function"
            && window.matchMedia(MOBILE_SHELL_QUERY).matches;
    } catch {
        return false;
    }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Pt { x: number; y: number }
interface Size { w: number; h: number }
interface MapView { zoom: number; tx: number; ty: number }

function clampPanForSize(size: Size, zoom: number, tx: number, ty: number): Pt {
    const { w, h } = size;
    const baseHeight = w / WORLD_MAP_ASPECT_RATIO;
    const contentWidth = w * zoom;
    const contentHeight = baseHeight * zoom;
    return {
        x: contentWidth <= w ? (w - contentWidth) / 2 : clamp(tx, w - contentWidth, 0),
        y: contentHeight <= h ? (h - contentHeight) / 2 : clamp(ty, h - contentHeight, 0),
    };
}

function coverZoomForSize(size: Size): number {
    if (!size.w || !size.h) return MIN_ZOOM;
    return clamp(size.h / (size.w / WORLD_MAP_ASPECT_RATIO), MIN_ZOOM, MAX_ZOOM);
}

function coverViewForSize(size: Size): MapView {
    if (!size.w || !size.h) return { zoom: MIN_ZOOM, tx: 0, ty: 0 };
    const zoom = coverZoomForSize(size);
    const baseHeight = size.w / WORLD_MAP_ASPECT_RATIO;
    const point = clampPanForSize(
        size,
        zoom,
        (size.w - size.w * zoom) / 2,
        (size.h - baseHeight * zoom) / 2,
    );
    return { zoom, tx: point.x, ty: point.y };
}

function sameView(a: MapView, b: MapView): boolean {
    return a.zoom === b.zoom && a.tx === b.tx && a.ty === b.ty;
}

export interface WorldMapZoomApi {
    /** True when zoom mode is active (narrow/touch + flag). When false the map
     *  renders exactly as the legacy path — this hook adds nothing. */
    active: boolean;
    /** Current zoom (1 = whole map visible). */
    zoom: number;
    /** Attach to the `.world-map-scroll` viewport element. */
    viewportRef: (el: HTMLDivElement | null) => void;
    /** Pointer handlers for the viewport (no-ops when inactive). Wheel zoom is
     *  installed natively by viewportRef so it can be explicitly non-passive. */
    viewportHandlers: {
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
        onPointerCancel: (e: React.PointerEvent) => void;
        onLostPointerCapture: (e: React.PointerEvent) => void;
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
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const wheelCleanupRef = useRef<(() => void) | null>(null);
    const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
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
        try { mq = window.matchMedia(MOBILE_SHELL_QUERY); } catch { mq = null; }
        mq?.addEventListener?.("change", recompute);
        return () => {
            mq?.removeEventListener?.("change", recompute);
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
        resizeCleanupRef.current?.();
        resizeCleanupRef.current = null;
        wheelCleanupRef.current?.();
        wheelCleanupRef.current = null;
        elRef.current = el;
        if (!el) return;
        const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
        el.addEventListener("wheel", onWheel, { passive: false });
        wheelCleanupRef.current = () => el.removeEventListener("wheel", onWheel);
        let animationFrame = 0;
        const measure = () => {
            const previousSize = sizeRef.current;
            const nextSize = { w: el.clientWidth, h: el.clientHeight };
            if (previousSize.w === nextSize.w && previousSize.h === nextSize.h) return;
            sizeRef.current = nextSize;
            if (!activeRef.current) return;

            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(() => {
                setView((current) => {
                    const previousFloor = coverZoomForSize(previousSize);
                    if (!previousSize.w || current.zoom <= previousFloor + 0.05) {
                        const next = coverViewForSize(nextSize);
                        return sameView(current, next) ? current : next;
                    }

                    // Keep the same logical map point under the viewport center
                    // while the base map width changes during resize/rotation.
                    const logicalX = (previousSize.w / 2 - current.tx)
                        / (previousSize.w * current.zoom);
                    const logicalY = (previousSize.h / 2 - current.ty)
                        / ((previousSize.w / WORLD_MAP_ASPECT_RATIO) * current.zoom);
                    const zoom = clamp(current.zoom, coverZoomForSize(nextSize), MAX_ZOOM);
                    const point = clampPanForSize(
                        nextSize,
                        zoom,
                        nextSize.w / 2 - logicalX * nextSize.w * zoom,
                        nextSize.h / 2 - logicalY * (nextSize.w / WORLD_MAP_ASPECT_RATIO) * zoom,
                    );
                    const next = { zoom, tx: point.x, ty: point.y };
                    return sameView(current, next) ? current : next;
                });
            });
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        resizeCleanupRef.current = () => {
            ro?.disconnect();
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    useEffect(() => () => {
        resizeCleanupRef.current?.();
        resizeCleanupRef.current = null;
        wheelCleanupRef.current?.();
        wheelCleanupRef.current = null;
    }, []);

    const clampPan = useCallback((zoom: number, tx: number, ty: number) => {
        const point = clampPanForSize(sizeRef.current, zoom, tx, ty);
        return { tx: point.x, ty: point.y };
    }, []);

    // The MINIMUM allowed zoom: the "cover" zoom at which the map exactly fills
    // the viewport height. This is the pinch-out floor, so you can never zoom out
    // into an ugly black-bar letterbox — the map stays full-bleed at every zoom.
    // Viewport-dependent (recomputed from the live size each call).
    const coverZoom = useCallback(() => {
        return coverZoomForSize(sizeRef.current);
    }, []);

    // The mobile "home" / reset view: the map scaled to COVER the viewport height,
    // centered horizontally — big, immersive, and never letterboxed. This equals
    // the minimum zoom, so pinch-out lands exactly here. Region chips + pan reach
    // the cropped edges, so nothing is unreachable.
    const coverView = useCallback(() => {
        return coverViewForSize(sizeRef.current);
    }, []);

    // Apply the fill-height home view once the viewport has been measured, and
    // again on re-activation (e.g. rotating back into the mobile breakpoint). rAF
    // lets the viewportRef measurement run first so sizeRef is populated (and keeps
    // the setState out of the effect body).
    useEffect(() => {
        if (!active) return;
        const id = requestAnimationFrame(() => setView(coverView()));
        return () => cancelAnimationFrame(id);
    }, [active, coverView]);

    // Zoom to `nextZoom` while holding the map point under (fx,fy) — viewport-
    // relative pixels — fixed on screen.
    const zoomAt = useCallback((nextZoom: number, fx: number, fy: number) => {
        const minZ = coverZoom();
        setView((v) => {
            const z1 = clamp(nextZoom, minZ, MAX_ZOOM);
            const tx = fx - (fx - v.tx) / v.zoom * z1;
            const ty = fy - (fy - v.ty) / v.zoom * z1;
            const p = clampPan(z1, tx, ty);
            return { zoom: z1, tx: p.tx, ty: p.ty };
        });
    }, [clampPan, coverZoom]);

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
        // Buttons and other controls own clean taps. Capturing their pointer on
        // the viewport retargets pointerup/click to the map and makes sector
        // markers intermittently untappable on real touch devices. Panning can
        // still begin from the painted map around the controls.
        if ((e.target as Element).closest("button, a, input, select, textarea, [role='button']")) return;
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
            const minZ = coverZoom();
            setView((v) => {
                const z1 = clamp(v.zoom * ratio, minZ, MAX_ZOOM);
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
    }, [clampPan, coverZoom]);

    const endPointer = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        if (!pointers.current.has(e.pointerId)) return;
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
                // Toggle: at the full-bleed floor → zoom in on the tap; otherwise
                // zoom back out to the full-bleed cover view (never past it).
                if (viewRef.current.zoom <= coverZoom() + 0.05) zoomAt(DOUBLE_TAP_ZOOM, p.x, p.y);
                else setView(coverView());
                lastTap.current = null;
                return;
            }
            lastTap.current = { t: now, x: p.x, y: p.y };
        }
    }, [zoomAt, coverZoom, coverView]);

    const cancelPointer = useCallback((e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) setDragging(false);
    }, []);

    useEffect(() => {
        wheelHandlerRef.current = (event: WheelEvent) => {
            if (!activeRef.current) return;
            event.preventDefault();
            const r = elRef.current?.getBoundingClientRect();
            const fx = event.clientX - (r?.left ?? 0);
            const fy = event.clientY - (r?.top ?? 0);
            const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
            zoomAt(viewRef.current.zoom * factor, fx, fy);
        };
        return () => { wheelHandlerRef.current = () => undefined; };
    }, [zoomAt]);

    const focusPoint = useCallback((xPct: number, yPct: number, targetZoom = CHIP_ZOOM) => {
        const { w, h } = sizeRef.current;
        const bh = w / WORLD_MAP_ASPECT_RATIO;
        const z = clamp(targetZoom, coverZoom(), MAX_ZOOM);
        // Marker sits at (xPct%, yPct%) of the base map, whose size is w × bh.
        const cx = (xPct / 100) * w;
        const cy = (yPct / 100) * bh;
        const p = clampPan(z, w / 2 - cx * z, h / 2 - cy * z);
        setView({ zoom: z, tx: p.tx, ty: p.ty });
    }, [clampPan, coverZoom]);

    const contentStyle = useMemo<React.CSSProperties>(() => {
        const aspectStyle = {
            ["--wm-map-ar" as string]: String(WORLD_MAP_ASPECT_RATIO),
        };
        if (!active) return aspectStyle as React.CSSProperties;
        // Counter-scale for the pinned markers. They ride the map's `scale(zoom)`,
        // so on their own they inflate at the SAME rate as the spacing — clustered
        // sectors would stay overlapping no matter how far you zoom (the "it's just
        // a magnified picture" problem). Grow them only ~zoom^0.3 (divide their
        // scale by zoom^0.7) so each pin holds a near-constant, tappable on-screen
        // size while the gaps between them open up — zooming actually SPREADS the
        // sectors apart. Consumed by the `.atlas-* { scale(var(--wm-marker-scale)) }`
        // rules below.
        const markerScale = clamp(Math.pow(view.zoom, -0.7), 0.34, 1);
        return {
            // Consumed by the `.wm-zoom … { transform: var(--wm-tf) }` rule so it
            // overrides the legacy `transform: none !important` mobile rule.
            ["--wm-tf" as string]: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`,
            ["--wm-marker-scale" as string]: markerScale.toFixed(3),
            // Drives the map box's displayed aspect (background-size:100% 100% then
            // stretches the art to it). Single source of truth = MAP_AR.
            ...aspectStyle,
            transition: dragging ? "none" : "transform 140ms ease-out",
        } as React.CSSProperties;
    }, [active, view, dragging]);

    return {
        active,
        zoom: view.zoom,
        viewportRef,
        viewportHandlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endPointer,
            onPointerCancel: cancelPointer,
            onLostPointerCapture: cancelPointer,
        },
        contentStyle,
        zoomIn: () => centerZoom(viewRef.current.zoom * 1.4),
        zoomOut: () => centerZoom(viewRef.current.zoom / 1.4),
        reset: () => setView(coverView()),
        focusPoint,
    };
}
