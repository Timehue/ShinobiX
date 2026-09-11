// World-map pinch/drag zoom (worldMapZoom.v1).
//
// The painted world map (`world_map-v2.webp`) is a fixed 1672x941 layer with 67 sector
// markers pinned to percentage coordinates. On desktop it already fits the
// screen responsively (`.generated-world-map { width:100%; aspect-ratio }`), but
// the legacy MOBILE path forced it to a fixed 1100×733 canvas with horizontal
// scrolling + 2× inflated markers — which piled the markers into an unreadable,
// un-tappable blob and clipped the map at the screen edges.
//
// This hook fits six overlapping atlas areas within the mobile game shell, with
// one-finger pan, pinch zoom, and a complete-world overview. The whole map
// (background + every marker
// + the ownership overlay) rides ONE transform on the map div, so everything
// stays perfectly registered. Gameplay is untouched — only how the map meets the
// screen changes.
//
// COSMETIC / UI ONLY: no balance, saves, rewards, or travel logic here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWorldMapRegionView, WORLD_MAP_ASPECT_RATIO, WORLD_MAP_MOBILE_QUERY, type WorldMapRegionId } from "./world-map-regions";
export { WORLD_MAP_ASPECT_RATIO } from "./world-map-regions";
import { normalizeOnboardingStep } from "./onboarding-step";
import { ACADEMY_TRAIL_FOCUS_EVENT } from "./academy-trail-focus";
import { villageOutskirtsSectorNumber } from "../data/sectors";
import type { Character } from "../types/character";

const MIN_ZOOM = 1;            // fit-to-width; short screens can fit below 1
const MAX_ZOOM = 4;            // deep enough for comfortable tap targets
const DOUBLE_TAP_ZOOM = 2.6;   // detail view; marker targets keep their screen size
const CHIP_ZOOM = 2.4;         // village quick-jump target zoom
const DOUBLE_TAP_MS = 320;     // max gap between taps to count as a double-tap
const TAP_SLOP_PX = 14;        // max finger travel that still counts as a tap
// The percentage-positioned landmarks and the painting share this exact source
// aspect. All viewports use a uniform camera transform; the artwork is never
// stretched away from its interactive coordinate system.
const MOBILE_SHELL_QUERY = WORLD_MAP_MOBILE_QUERY;
const WORLD_MAP_CONTROL_SELECTOR = "button, a, input, select, textarea, [role='button']";

/** Interactive descendants keep ownership of a clean tap. Capturing their
 * pointer on the pan surface retargets the browser's synthesized click to the
 * viewport, so sector and landmark buttons look pressed but never activate. */
export function isWorldMapControlTarget(target: EventTarget | null): boolean {
    const closest = (target as { closest?: (selector: string) => unknown } | null)?.closest;
    return typeof closest === "function" && Boolean(closest.call(target, WORLD_MAP_CONTROL_SELECTOR));
}

/** Default ON only inside the mobile shell. A per-device `worldMapZoom.v1`
 *  value of "0" opts out; an old "1" cannot enable the mobile map on desktop.
 *  The fallback remains responsive and preserves the source aspect. */
export function isWorldMapZoomEnabled(): boolean {
    try {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function"
            || !window.matchMedia(MOBILE_SHELL_QUERY).matches) return false;
    } catch {
        return false;
    }
    try {
        const o = localStorage.getItem("worldMapZoom.v1");
        if (o === "0") return false;
    } catch { /* private mode — fall through to viewport default */ }
    return true;
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
    // Pinch-out must reach the complete world even on a short landscape phone.
    return Math.min(MIN_ZOOM, size.h / (size.w / WORLD_MAP_ASPECT_RATIO));
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
    /** True within the mobile shell unless opted out. When false the map
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
        onClickCapture: (e: React.MouseEvent) => void;
        onFocusCapture: (e: React.FocusEvent) => void;
    };
    /** Static inline style for the map div — the displayed aspect only. The
     *  transform deliberately does NOT live here: see `applyView`. */
    contentStyle: React.CSSProperties;
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
    /** Fly to a map point given in map-percent coords (0–100) at a tappable zoom. */
    focusPoint: (xPct: number, yPct: number, targetZoom?: number) => void;
    /** A selected area stays selected and is re-fitted after browser/rotation resize. */
    selectedRegion: WorldMapRegionId | null;
    focusRegion: (region: WorldMapRegionId) => void;
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
    // "Find the trail" on the coach's chip: re-aim for a player who panned away.
    // The legacy scroll map has no camera, so scroll the real pin into view
    // instead — the same move the coach's own reveal makes.
    useEffect(() => {
        if (targetId == null) return;
        const onFindTrail = () => {
            const target = sectorPoints.find((sector) => sector.id === targetId);
            if (!target) return;
            if (zoomActive) { focusPoint(target.x, target.y, DOUBLE_TAP_ZOOM); return; }
            document.querySelector<HTMLElement>(".atlas-sector.academy-click-target")
                ?.scrollIntoView({ block: "center", inline: "center" });
        };
        window.addEventListener(ACADEMY_TRAIL_FOCUS_EVENT, onFindTrail);
        return () => window.removeEventListener(ACADEMY_TRAIL_FOCUS_EVENT, onFindTrail);
    }, [focusPoint, sectorPoints, targetId, zoomActive]);
    return targetId;
}

export function useWorldMapZoom(initialRegion: WorldMapRegionId = "ashen"): WorldMapZoomApi {
    const [active, setActive] = useState<boolean>(() => isWorldMapZoomEnabled());
    const [selectedRegion, setSelectedRegion] = useState<WorldMapRegionId | null>(initialRegion);
    const regionRef = useRef<WorldMapRegionId | null>(initialRegion);
    const releaseRegion = useCallback(() => {
        if (regionRef.current === null) return;
        regionRef.current = null;
        setSelectedRegion(null);
    }, []);

    // Live refs so pointer handlers never read stale closure state.
    const elRef = useRef<HTMLDivElement | null>(null);
    const contentElRef = useRef<HTMLDivElement | null>(null);
    const resizeCleanupRef = useRef<(() => void) | null>(null);
    const wheelCleanupRef = useRef<(() => void) | null>(null);
    const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
    const sizeRef = useRef({ w: 0, h: 0 });
    // The viewport measurer, so the activation effect can re-measure the moment
    // the `wm-zoom` class lands (see that effect for why the order matters).
    const measureRef = useRef<() => void>(() => undefined);
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
    // Counter-scale pins by the inverse camera zoom. Their touch targets stay
    // the same screen size, while pinch zoom spreads crowded destinations apart.
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
        const markerScale = 1 / Math.max(0.01, v.zoom);
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
        immediate = false,
    ) => {
        viewRef.current = typeof next === "function" ? next(viewRef.current) : next;
        if (animate || immediate) {
            if (applyFrameRef.current) { cancelAnimationFrame(applyFrameRef.current); applyFrameRef.current = 0; }
            applyView(animate);
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
    const suppressClick = useRef(false);

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
        // Re-measure NOW, in the same task as the class change. The ref callback
        // measured the viewport during commit, before this effect added the
        // class — i.e. in the LEGACY layout, whose tall fixed canvas puts the
        // cover-zoom floor at ~3.6. Every frame scheduled off that size (the
        // home view, the Academy trail focus) then computed against the wrong
        // box, and when the ResizeObserver reported the real zoom-mode size the
        // "still at the floor" branch below snapped the camera back to the home
        // view: the Academy target opened OFF camera on every phone. Reading
        // the size here forces layout with the class applied, so sizeRef is
        // right before any of those frames run, and the observer's report of
        // the same size is a no-op.
        measureRef.current();
        return () => root.classList.remove("wm-zoom");
    }, [active]);

    // ── Measure the viewport (drives pan clamping) ───────────────────────────
    const viewportRef = useCallback((el: HTMLDivElement | null) => {
        resizeCleanupRef.current?.();
        resizeCleanupRef.current = null;
        wheelCleanupRef.current?.();
        wheelCleanupRef.current = null;
        elRef.current = el;
        if (!el) {
            measureRef.current = () => undefined;
            pointers.current.clear();
            pinch.current = null;
            lastTap.current = null;
            suppressClick.current = false;
            return;
        }
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
                    if (regionRef.current !== null) {
                        return getWorldMapRegionView(nextSize, regionRef.current);
                    }
                    // "At home" means the camera IS the home view — at the
                    // floor zoom AND at the cover pan — not merely at the floor
                    // zoom. A trail focus or a player's pan can sit at the floor
                    // too (focusPoint clamps its zoom up to the floor on tall
                    // phones), and snapping those back to centre on every
                    // address-bar resize threw the Academy target off camera.
                    const previousCover = coverViewForSize(previousSize);
                    const atHome = !previousSize.w || (
                        current.zoom <= previousCover.zoom + 0.05
                        && Math.abs(current.tx - previousCover.tx) <= 1
                        && Math.abs(current.ty - previousCover.ty) <= 1
                    );
                    if (atHome) {
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
        measureRef.current = measure;
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

    // The minimum zoom fits the entire painting, including landscape phones.
    const coverZoom = useCallback(() => {
        return coverZoomForSize(sizeRef.current);
    }, []);

    // A complete-world overview remains available through pinch-out/double-tap.
    const coverView = useCallback(() => {
        return coverViewForSize(sizeRef.current);
    }, []);

    const focusRegion = useCallback((region: WorldMapRegionId) => {
        suppressClick.current = false;
        lastTap.current = null;
        // Clear any legacy scroll offset when returning to a camera preset.
        if (elRef.current) {
            elRef.current.scrollLeft = 0;
            elRef.current.scrollTop = 0;
        }
        regionRef.current = region;
        setSelectedRegion(region);
        commitView(getWorldMapRegionView(sizeRef.current, region), true);
    }, [commitView]);

    // Open at the player's area. Academy focus runs afterward and can still
    // point directly at its target without being reset by viewport measurement.
    useEffect(() => {
        if (!active) return;
        const id = requestAnimationFrame(() => focusRegion(initialRegion));
        return () => cancelAnimationFrame(id);
    }, [active, initialRegion, focusRegion]);

    // Zoom to `nextZoom` while holding the map point under (fx,fy) — viewport-
    // relative pixels — fixed on screen.
    // `animate` marks a discrete camera move (button, wheel, double-tap) so it
    // eases; a continuous gesture passes false and lands on the finger.
    const zoomAt = useCallback((nextZoom: number, fx: number, fy: number, animate = true) => {
        releaseRegion();
        const minZ = coverZoom();
        commitView((v) => {
            const z1 = clamp(nextZoom, minZ, MAX_ZOOM);
            const tx = fx - (fx - v.tx) / v.zoom * z1;
            const ty = fy - (fy - v.ty) / v.zoom * z1;
            const p = clampPan(z1, tx, ty);
            return { zoom: z1, tx: p.tx, ty: p.ty };
        }, animate);
    }, [clampPan, coverZoom, commitView, releaseRegion]);

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
        // Track a gesture even when it starts on a marker, but keep a clean
        // tap's native target. Capture it only once it becomes an actual drag.
        if (!isWorldMapControlTarget(e.target)) {
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        if (pointers.current.size === 0) suppressClick.current = false;
        const p = localPt(e);
        pointers.current.set(e.pointerId, p);
        moved.current = 0;
        if (pointers.current.size === 2) {
            suppressClick.current = true;
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
            releaseRegion();
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
        if (moved.current <= TAP_SLOP_PX) return;
        releaseRegion();
        suppressClick.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        commitView((v) => {
            const c = clampPan(v.zoom, v.tx + dx, v.ty + dy);
            return { zoom: v.zoom, tx: c.tx, ty: c.ty };
        });
    }, [clampPan, coverZoom, commitView, releaseRegion]);

    const endPointer = useCallback((e: React.PointerEvent) => {
        if (!activeRef.current) return;
        if (!pointers.current.has(e.pointerId)) return;
        const p = localPt(e);
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;

        // Double-tap toggle (only a clean tap — little finger travel).
        if (moved.current <= TAP_SLOP_PX && !suppressClick.current && !isWorldMapControlTarget(e.target)) {
            const now = typeof performance !== "undefined" ? performance.now() : 0;
            const prev = lastTap.current;
            if (prev && now - prev.t < DOUBLE_TAP_MS
                && Math.hypot(p.x - prev.x, p.y - prev.y) < 40) {
                // A background double-tap toggles detail and the entire world.
                if (viewRef.current.zoom <= coverZoom() + 0.05) zoomAt(DOUBLE_TAP_ZOOM, p.x, p.y);
                else { releaseRegion(); commitView(coverView(), true); }
                lastTap.current = null;
                return;
            }
            lastTap.current = { t: now, x: p.x, y: p.y };
        }
    }, [zoomAt, coverZoom, coverView, commitView, releaseRegion]);

    const cancelPointer = useCallback((e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
    }, []);

    const lostPointerCapture = useCallback((e: React.PointerEvent) => {
        // Touch starts with implicit capture on a marker. When a drag transfers
        // that capture to the viewport, the marker's lost event bubbles here;
        // it must not cancel the gesture that the viewport has just acquired.
        if (e.target !== e.currentTarget) return;
        cancelPointer(e);
    }, [cancelPointer]);

    const onClickCapture = useCallback((e: React.MouseEvent) => {
        if (!activeRef.current || !suppressClick.current) return;
        // Keyboard and assistive activation is a fresh action, even after a
        // drag was interrupted without producing its own pointer click.
        if (e.detail === 0) {
            suppressClick.current = false;
            return;
        }
        // Some mobile browsers still synthesize a click after a captured drag.
        // Block only that gesture's click; the next pointer-down clears the flag.
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
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
        releaseRegion();
        const { w, h } = sizeRef.current;
        const bh = w / WORLD_MAP_ASPECT_RATIO;
        const z = clamp(targetZoom, coverZoom(), MAX_ZOOM);
        // Marker sits at (xPct%, yPct%) of the base map, whose size is w × bh.
        const cx = (xPct / 100) * w;
        const cy = (yPct / 100) * bh;
        const p = clampPan(z, w / 2 - cx * z, h / 2 - cy * z);
        commitView({ zoom: z, tx: p.tx, ty: p.ty }, true);
    }, [clampPan, coverZoom, commitView, releaseRegion]);

    const onFocusCapture = useCallback((e: React.FocusEvent) => {
        const viewport = elRef.current;
        const target = e.target as HTMLElement;
        // A pointer tap keeps its destination still. Keyboard and assistive
        // focus instead reveal an off-camera marker before it is activated.
        if (!activeRef.current || !viewport || pointers.current.size > 0
            || !target.matches(".atlas-sector, .atlas-landmark")) return;
        // A region may still be easing toward viewRef's endpoint. Finish that
        // move before comparing painted marker bounds with camera coordinates.
        commitView(viewRef.current, false, true);
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
        const bounds = viewport.getBoundingClientRect();
        const marker = target.getBoundingClientRect();
        const left = bounds.left + viewport.clientLeft;
        const top = bounds.top + viewport.clientTop;
        const { w, h } = sizeRef.current;
        const ring = target.matches(".atlas-sector") ? 6 : 0;
        if (marker.left - ring >= left && marker.right + ring <= left + w
            && marker.top - ring >= top && marker.bottom + ring <= top + h) return;
        const current = viewRef.current;
        const pan = clampPan(current.zoom,
            current.tx + left + w / 2 - (marker.left + marker.width / 2),
            current.ty + top + h / 2 - (marker.top + marker.height / 2));
        releaseRegion();
        // Apply synchronously so the browser's focus reveal sees the marker
        // inside its camera, rather than scrolling the page toward stale bounds.
        commitView({ ...current, ...pan }, false, true);
    }, [clampPan, commitView, releaseRegion]);

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
            onLostPointerCapture: lostPointerCapture,
            onClickCapture,
            onFocusCapture,
        },
        contentStyle,
        zoomIn: () => centerZoom(viewRef.current.zoom * 1.4),
        zoomOut: () => centerZoom(viewRef.current.zoom / 1.4),
        reset: () => { releaseRegion(); commitView(coverView(), true); },
        focusPoint,
        selectedRegion,
        focusRegion,
    };
}
