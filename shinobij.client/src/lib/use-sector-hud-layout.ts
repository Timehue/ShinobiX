import { useLayoutEffect, type RefObject } from 'react';

/** Size the existing square grid to the usable shell, never its camera or tiles.
 * Like the atlas layout, use unscrolled coordinates so scrolling cannot grow it. */
export function useSectorHudLayout(ref: RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        const hud = ref.current;
        const stage = hud?.parentElement;
        if (!hud || !stage) return;
        const center = stage.closest<HTMLElement>('.center-game');
        const nav = document.querySelector<HTMLElement>('.mobile-bottom-nav');
        let frame = 0;
        const measure = () => {
            frame = 0;
            const viewport = window.visualViewport;
            const height = viewport?.scale === 1 ? viewport.height : innerHeight;
            const side = matchMedia('(min-width: 980px), (min-width: 560px) and (max-height: 450px)').matches;
            const top = stage.getBoundingClientRect().top + scrollY + (center?.scrollTop ?? 0);
            const navBounds = nav?.getBoundingClientRect();
            const chrome = navBounds?.height ? height - navBounds.top : 0;
            const available = Math.max(128, Math.floor(height - top - chrome - 12));
            const context = hud.querySelector<HTMLElement>('.sector-hud-context');
            const contextStyle = context ? getComputedStyle(context) : null;
            const contextHeight = context?.offsetHeight ? context.offsetHeight + parseFloat(contextStyle!.marginBottom) : 0;
            // Reserve a heading and one actionable row even on short phones.
            // Taller screens leave more roster room below the full-width map.
            const base = (hud.querySelector<HTMLElement>('.sector-hud-top')?.offsetHeight ?? 0) + contextHeight + 2;
            const set = (key: string, value: number) => {
                const px = `${Math.max(0, Math.floor(value))}px`;
                if (stage.style.getPropertyValue(key) !== px) stage.style.setProperty(key, px);
            };
            // A 12×12 board cannot stay useful when it is squeezed to the old
            // 180px phone floor: each movement tile is only 15px wide. On a
            // narrow phone the HUD can continue below the fold, but the board
            // should claim the available width so its tiles remain tappable.
            // Tablet/desktop still budget by height to keep their command panel
            // in view beside or beneath the board.
            const boardSize = matchMedia('(max-width: 559px)').matches
                ? stage.clientWidth
                : Math.max(180, available - (side ? 0 : base + 112));
            set('--sector-board-size', boardSize);
            const mapHeight = stage.querySelector('.sector-image-map')?.getBoundingClientRect().height ?? 0;
            const extra = available - base - (side ? 0 : mapHeight);
            // The roster scrolls when space is tight. A fixed minimum here can
            // push the entire HUD under the mobile navigation instead.
            set('--sector-nearby-height', Math.max(0, extra));
            set('--sector-stage-height', available);
            stage.setAttribute('data-sector-routes', String(innerWidth >= 980 && available - mapHeight >= 76));
            // The shared help portal occupies a reserved header slot on phones.
            const help = hud.querySelector('.sector-hud-help-slot')?.getBoundingClientRect();
            if (help?.width) {
                document.body.style.setProperty('--sector-tip-top', `${help.top + scrollY}px`);
                document.body.style.setProperty('--sector-tip-left', `${help.left + scrollX}px`);
            }
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
        const resize = new ResizeObserver(schedule);
        for (const element of [hud, center, nav]) if (element) resize.observe(element);
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        window.visualViewport?.addEventListener('resize', schedule);
        measure();
        return () => {
            resize.disconnect(); cancelAnimationFrame(frame);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.visualViewport?.removeEventListener('resize', schedule);
            stage.style.removeProperty('--sector-board-size');
            stage.style.removeProperty('--sector-nearby-height');
            stage.style.removeProperty('--sector-stage-height');
            stage.removeAttribute('data-sector-routes');
            document.body.style.removeProperty('--sector-tip-top');
            document.body.style.removeProperty('--sector-tip-left');
        };
    }, [ref]);
}
