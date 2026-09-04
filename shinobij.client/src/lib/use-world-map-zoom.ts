// World-map pinch/drag zoom (worldMapZoom.v1).
//
// The painted world map (`world_map-v2.webp`) is a fixed 1672x941 layer with ~60 sector
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
import { normalizeOnboardingStep } from "./onboarding-step";
import { villageOutskirtsSectorNumber } from "../data/sectors";
import type { Character } from "../types/character";

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
const WORLD_MAP_CONTROL_SELECTOR = "button, a, input, select, textarea, [role='button']";

/** Interactive descendants keep ownership of a clean tap. Capturing their
 * pointer on the pan surface retargets the browser's synthesized click to the
 * viewport, so sector and landmark buttons look pressed but never activate. */
export function isWorldMapControlTarget(target: EventTarget | null): boolean {
    const closest = (target as { closest?: (selector: string) => unknown } | null)?.closest;
    return typeof closest === "function" && Boolean(closest.call(target, WORLD_MAP_CONTROL_SELECTOR));
}

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
    /** Attach to the `.world-map-scroll` viewport element. */
    viewportRef: (el: HTMLDivElement | null) => void;
    /** Attach to the map div itself. The pan/zoom transform is written straight
     *  onto this node (see `applyView`), never through React or a CSS variable. */
    contentRef: (el: HTMLDivElement | null) => void;
    /** Pointer handlers for the viewport (no-ops when inactive). Wheel zoom is
     *  installed natively by viewportRef so it can be explicitly non-passive. */
    viewportHandlers: {
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
        onPointerCancel: (e: React.PointerEvent) => void;
        onLostPointerCapture: (e: React.PointerEvent) => void;
    };
    /** Static inline style for the map div — the displayed aspect only. The
     *  transform deliberately does NOT live here: see `applyView`. */
    contentStyle: React.CSSProperties;
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
    /** Fly to a map point given in map-percent coords (0–100) at a tappable zoom. */
    focusPoint: (xPct: number, yPct: number, targetZoom?: number) => void;
}

type AcademyMapPoint = Readonly<{ id: number; x: number; y: number }>;

/** Keep the mobile Academy handoff visible without putting onboarding camera
 * choreography back into the already-large WorldMap owner. */
export function useAcademyWorldMapFocus({ character, sectorPoints, zoomActive, focusPoint }: {
    character: Pick<Character, "onboardingStep" | "academySectorVisited" | "village">;
    sectorPoints: readonly AcademyMapPoint[];
    zoomActive: boolean;
    focusPoint: WorldMapZoomApi["focusPoint"];
}): number | null {
    const targetId = normalizeOnboardingStep(character.onboardingStep) === "sectorReturn" && !character.academySectorVisited
        ? villageOutskirtsSectorNumber(character.village)
        : null;
    useEffect(() => {
        if (!zoomActive || targetId == null) return;
        const target = sectorPoints.find((sector) => sector.id === targetId);
        if (!target) return;
        const frame = window.requestAnimationFrame(() => focusPoint(target.x, target.y, DOUBLE_TAP_ZOOM));
        return () => window.cancelAnimationFrame(frame);
    }, [focusPoint, sectorPoints, targetId, zoomActive]);
    return targetId;
}

export function useWorldMapZoom(): WorldMapZoomApi {
    const [active, setActive] = useState<boolean>(() => isWorldMapZoomEnabled());

    // Live refs so pointer handlers never read stale closure state.
    const elRef = useRef<HTMLDivElement | null>(null);
    const contentElRef = useRef<HTMLDivElement | null>(null);
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const wheelCleanupRef = useRef<(() => void) | null>(null);
    const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
    const sizeRef = useRef({ w: 0, h: 0 });
    // ── The camera lives in a ref, NOT in React state ────────────────────────
    // A finger drag produces a pointermove every frame, and this hook is called
    // from WorldMap — a 5k-line owner rendering 67 sector markers, 95 road paths
    // and the ownership overlay. Routing the camera through setState re-rendered
    // that whole tree per move (measured: ~16ms of reconciliation per frame on a
    // mid-range phone, before the browser had painted anything). Nothing outside
    // this hook reads the live camera, so it is a ref and the transform is
    // written straight to the DOM in `applyView`.
    const viewRef = useRef<MapView>({ zoom: MIN_ZOOM, tx: 0, ty: 0 });
    const activeRef = useRef(active);
    // Last `--wm-marker-scale` actually written. See applyView for why this is
    // tracked separately from the zoom.
    const appliedMarkerScaleRef = useRef(Number.NaN);
    const applyFrameRef = useRef(0);

    // ── Writing the camera to the DOM ────────────────────────────────────────
    // `transform` is set DIRECTLY on the element and never through a CSS custom
    // property. Custom properties inherit, so writing one on this container
    // invalidates the computed style of every descendant: measured on the real
    // build at 390x844 with a 4x CPU throttle, one pan update cost 0.50ms as a
    // plain `transform` write and 70ms as a `--wm-tf` variable write — 140x, for
    // an identical visual result. (The variable indirection originally existed
    // to out-specify a legacy `transform: none !important` mobile rule; that rule
    // is gone, so the inline style now wins on its own.)
    //
    // `--wm-marker-scale` genuinely must be a variable — the pinned markers read
    // it (see `.atlas-* { scale(var(--wm-marker-scale)) }`) — so it pays that
    // same subtree-invalidation cost. It is therefore written ONLY when the zoom
    // has moved enough to change it visibly, which keeps it off the pan path
    // entirely: panning never changes zoom.
    //
    // What that variable is for: the markers ride the map's own `scale(zoom)`, so
    // unaided they inflate at exactly the rate the spacing does and a clustered
    // village stays clustered no matter how far you zoom (the "it's just a
    // magnified picture" problem). Dividing their scale by zoom^0.7 grows each pin
    // only ~zoom^0.3, so it holds a near-constant tappable size while the gaps
    // between pins open at full zoom — zooming actually SPREADS the sectors.
    const applyView = useCallback((animate: boolean) => {
        const el = contentElRef.current;
        if (!el) return;
        if (!activeRef.current) {
            el.style.transform = "";
            el.style.transition = "";
            el.style.removeProperty("--wm-marker-scale");
            appliedMarkerScaleRef.current = Number.NaN;
            return;
        }
        const v = viewRef.current;
        el.style.transition = animate ? "transform 140ms ease-out" : "none";
        el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`;
        const markerScale = clamp(Math.pow(v.zoom, -0.7), 0.34, 1);
        const applied = appliedMarkerScaleRef.current;
        // Number.isNaN(applied) is the "never written yet" case, so it must write.
        if (Number.isNaN(applied) || Math.abs(markerScale - applied) >= 0.005) {
            appliedMarkerScaleRef.current = markerScale;
            el.style.setProperty("--wm-marker-scale", markerScale.toFixed(3));
        }
    }, []);

    /** Move the camera. Gesture updates coalesce into one write per frame — a
     *  120Hz phone otherwise asks for two transforms per displayed frame. */
    const commitView = useCallback((
        next: MapView | ((current: MapView) => MapView),
        animate = false,
    ) => {
        viewRef.current = typeof next === "function" ? next(viewRef.current) : next;
        if (animate) {
            if (applyFrameRef.current) { cancelAnimationFrame(applyFrameRef.current); applyFrameRef.current = 0; }
            applyView(true);
            return;
        }
        if (applyFrameRef.current) return;
        applyFrameRef.current = requestAnimationFrame(() => {
            applyFrameRef.current = 0;
            applyView(false);
        });
    }, [applyView]);

    useEffect(() => () => {
        if (applyFrameRef.current) cancelAnimationFrame(applyFrameRef.current);
    }, []);

    // Attach point for the map div. Re-applies the current camera on (re)mount so
    // a React remount never leaves the node without its transform.
    const contentRef = useCallback((el: HTMLDivElement | null) => {
        contentElRef.current = el;
        appliedMarkerScaleRef.current = Number.NaN;
        if (el) applyView(false);
    }, [applyView]);

    // Entering zoom mode paints the camera; leaving it strips the inline transform
    // so the legacy/desktop path renders exactly as it did before this hook.
    useEffect(() => {
        activeRef.current = active;
        applyView(false);
    }, [active, applyView]);

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
            // a later re-entry doesn't start mid-zoom. The `active` effect below
            // clears the inline transform once React has caught up.
            if (!next) viewRef.current = { zoom: MIN_ZOOM, tx: 0, ty: 0 };
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
                commitView((current) => {
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
    }, [commitView]);

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
        const id = requestAnimationFrame(() => commitView(coverView()));
        return () => cancelAnimationFrame(id);
    }, [active, coverView, commitView]);

    // Zoom to `nextZoom` while holding the map point under (fx,fy) — viewport-
    // relative pixels — fixed on screen.
    // `animate` marks a discrete camera move (button, wheel, double-tap) so it
    // eases; a continuous gesture passes false and lands on the finger.
    const zoomAt = useCallback((nextZoom: number, fx: number, fy: number, animate = true) => {
        const minZ = coverZoom();
        commitView((v) => {
            const z1 = clamp(nextZoom, minZ, MAX_ZOOM);
            const tx = fx - (fx - v.tx) / v.zoom * z1;
            const ty = fy - (fy - v.ty) / v.zoom * z1;
            const p = clampPan(z1, tx, ty);
            return { zoom: z1, tx: p.tx, ty: p.ty };
        }, animate);
    }, [clampPan, coverZoom, commitView]);

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
        if (isWorldMapControlTarget(e.target)) return;
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
            commitView((v) => {
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
        commitView((v) => {
            const c = clampPan(v.zoom, v.tx + dx, v.ty + dy);
            return { zoom: v.zoom, tx: c.tx, ty: c.ty };
        });
    }, [clampPan, coverZoom, commitView]);

    const endPointer = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        if (!pointers.current.has(e.pointerId)) return;
        const p = localPt(e);
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;

        // Double-tap toggle (only a clean tap — little finger travel).
        if (moved.current <= TAP_SLOP_PX) {
            const now = typeof performance !== "undefined" ? performance.now() : 0;
            const prev = lastTap.current;
            if (prev && now - prev.t < DOUBLE_TAP_MS
                && Math.hypot(p.x - prev.x, p.y - prev.y) < 40) {
                // Toggle: at the full-bleed floor → zoom in on the tap; otherwise
                // zoom back out to the full-bleed cover view (never past it).
                if (viewRef.current.zoom <= coverZoom() + 0.05) zoomAt(DOUBLE_TAP_ZOOM, p.x, p.y);
                else commitView(coverView(), true);
                lastTap.current = null;
                return;
            }
            lastTap.current = { t: now, x: p.x, y: p.y };
        }
    }, [zoomAt, coverZoom, coverView, commitView]);

    const cancelPointer = useCallback((e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
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
        commitView({ zoom: z, tx: p.tx, ty: p.ty }, true);
    }, [clampPan, coverZoom, commitView]);

    // Deliberately camera-INDEPENDENT, so a re-render from anywhere else in
    // WorldMap (a presence poll, a timer) can never write a stale transform over
    // a gesture in flight. The camera is owned end-to-end by `applyView`; this
    // only drives the map box's displayed aspect (`background-size: 100% 100%`
    // then stretches the art to it). Single source of truth = MAP_AR.
    const contentStyle = useMemo<React.CSSProperties>(() => ({
        ["--wm-map-ar" as string]: String(WORLD_MAP_ASPECT_RATIO),
    } as React.CSSProperties), []);

    return {
        active,
        viewportRef,
        contentRef,
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
        reset: () => commitView(coverView(), true),
        focusPoint,
    };
}
