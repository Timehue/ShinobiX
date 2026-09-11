import { useCallback } from "react";

const pixels = (value: string | undefined) => Number.parseFloat(value ?? "0") || 0;

/** Fit the atlas and its six buttons into the space the application actually
 * leaves available. Measuring the shell also handles safe-area padding, font
 * size changes, browser toolbars, and tablets that use the desktop rails. */
export function useWorldMapLayout(active: boolean) {
    // React 19 runs callback-ref cleanup on replacement/unmount, so measuring a
    // newly mounted atlas does not need a render merely to store its DOM node.
    return useCallback((frame: HTMLDivElement | null) => {
        if (!active || !frame) return;

        const card = frame.closest<HTMLElement>(".world-atlas-card");
        const center = frame.closest<HTMLElement>(".center-game");
        const shell = frame.closest<HTMLElement>(".app-shell");
        const nav = shell?.querySelector<HTMLElement>(".mobile-bottom-nav")
            ?? document.querySelector<HTMLElement>(".mobile-bottom-nav");
        const hud = shell?.querySelector<HTMLElement>(".mobile-top-hud")
            ?? document.querySelector<HTMLElement>(".mobile-top-hud");
        const topbar = card?.querySelector<HTMLElement>(".wm-topbar");
        const regions = frame.querySelector<HTMLElement>(".wm-village-bar");
        const visualViewport = window.visualViewport;
        let pendingFrame = 0;
        let positionedTip: HTMLElement | null = null;
        let notificationBar: HTMLElement | null = null;
        let trailChip: HTMLElement | null = null;
        let observer: ResizeObserver | null = null;

        const measure = () => {
            pendingFrame = 0;
            const nextNotificationBar = shell?.querySelector<HTMLElement>(".mobile-notif-bar") ?? null;
            if (nextNotificationBar !== notificationBar) {
                if (notificationBar) observer?.unobserve(notificationBar);
                notificationBar = nextNotificationBar;
                if (notificationBar) observer?.observe(notificationBar);
            }
            const nextTrailChip = document.querySelector<HTMLElement>("body > .coach-trail-chip");
            if (nextTrailChip !== trailChip) {
                if (trailChip) observer?.unobserve(trailChip);
                trailChip = nextTrailChip;
                if (trailChip) observer?.observe(trailChip);
            }
            // Browser page zoom must remain an accessibility operation. Only
            // use visual-viewport shrinking for browser chrome/keyboard changes.
            const viewportHeight = visualViewport && visualViewport.scale === 1
                ? visualViewport.height
                : window.innerHeight;
            const rect = frame.getBoundingClientRect();
            const centerStyle = center ? getComputedStyle(center) : undefined;
            const cardStyle = card ? getComputedStyle(card) : undefined;
            const visibleNav = shell?.querySelector<HTMLElement>(".mobile-bottom-nav") ?? nav;
            // Notifications and the Academy trail float above the nav rather
            // than taking up document space. Reserve their actual upper edge,
            // including safe-area offsets, so they cannot cover a region row.
            const fixedChromeClearance = [visibleNav, notificationBar, trailChip].reduce((clearance, element) => {
                const bounds = element?.getBoundingClientRect();
                return bounds && bounds.height > 0 && bounds.width > 0
                    ? Math.max(clearance, viewportHeight - bounds.top + 8)
                    : clearance;
            }, 0);
            // Work in the unscrolled page/center coordinate space: scrolling
            // must never continually enlarge the stage beneath the player's hand.
            const top = rect.top + window.scrollY + (center?.scrollTop ?? 0);
            const bottomClearance = Math.max(
                pixels(centerStyle?.paddingBottom),
                fixedChromeClearance,
            ) + pixels(cardStyle?.paddingBottom)
                + pixels(cardStyle?.borderBottomWidth)
                + pixels(cardStyle?.marginBottom);
            const available = Math.floor(viewportHeight - top - bottomClearance - 1);
            const wide = rect.width >= 400 && window.innerHeight <= 480
                && window.innerWidth > window.innerHeight;
            const controlsHeight = Math.max(94, regions?.getBoundingClientRect().height ?? 0);
            // Give the map all remaining height, including on tall phones.
            // The controls and visible navigation/coach keep their own space.
            // Extremely short split-screen views may scroll slightly rather
            // than shrink targets below 44px or hide a row of regions.
            const wideMinimum = Math.ceil((topbar?.getBoundingClientRect().height ?? 44) + controlsHeight + 8);
            const height = Math.max(wide ? wideMinimum : 204, available);
            const heightValue = `${height}px`;
            const layout = wide ? "wide" : "stacked";
            if (frame.style.getPropertyValue("--wm-frame-height") !== heightValue) {
                frame.style.setProperty("--wm-frame-height", heightValue);
            }
            if (frame.dataset.wmLayout !== layout) frame.dataset.wmLayout = layout;

            // ScreenHint is a body portal. Align its optional trigger with the
            // back bar so it cannot cover the last region button above the nav.
            const tip = document.querySelector<HTMLElement>("body > .screen-hint-worldMap");
            if (positionedTip && positionedTip !== tip) {
                positionedTip.style.removeProperty("--wm-tip-top");
                positionedTip.style.removeProperty("--wm-tip-left");
            }
            positionedTip = tip;
            if (tip && topbar) {
                const barRect = topbar.getBoundingClientRect();
                tip.style.setProperty("--wm-tip-top", `${barRect.top + window.scrollY}px`);
                // An expanded hint can be much wider than its trigger. Keep
                // its saved collapsed position inside the reserved help slot.
                const triggerWidth = Math.min(64, tip.getBoundingClientRect().width);
                tip.style.setProperty("--wm-tip-left", `${barRect.right - triggerWidth + window.scrollX}px`);
            }
        };
        const schedule = () => {
            if (!pendingFrame) pendingFrame = window.requestAnimationFrame(measure);
        };

        measure();
        observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
        for (const element of [frame, card, center, nav, hud, topbar, regions, notificationBar, trailChip]) {
            if (element) observer?.observe(element);
        }
        // The optional hint is lazy-loaded and can mount after the atlas ref.
        const portals = new MutationObserver(schedule);
        portals.observe(document.body, { childList: true });
        // MobileNav renders its notification strip as a direct shell child.
        // Watch that boundary for poll-driven mount/removal without observing
        // the atlas's marker, label, and animation descendants on every update.
        if (shell) portals.observe(shell, { childList: true });
        window.addEventListener("resize", schedule, { passive: true });
        window.addEventListener("scroll", schedule, { passive: true });
        center?.addEventListener("scroll", schedule, { passive: true });
        visualViewport?.addEventListener("resize", schedule, { passive: true });

        return () => {
            observer?.disconnect();
            portals.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule);
            center?.removeEventListener("scroll", schedule);
            visualViewport?.removeEventListener("resize", schedule);
            if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
            frame.style.removeProperty("--wm-frame-height");
            delete frame.dataset.wmLayout;
            positionedTip?.style.removeProperty("--wm-tip-top");
            positionedTip?.style.removeProperty("--wm-tip-left");
        };
    }, [active]);
}
