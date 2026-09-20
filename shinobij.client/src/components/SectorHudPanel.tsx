import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** A bounded modeless browser. Outside pointer gestures are consumed in full,
 * including their synthetic click; dismissing is never a move or a gate crossing. */
export function SectorHudPanel({ id, title, children, rootRef, onClose }: {
    id: string; title: string; children: ReactNode;
    rootRef: RefObject<HTMLDivElement | null>; onClose: (restoreFocus?: boolean, consumeTouchClick?: boolean) => void;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    useLayoutEffect(() => { closeRef.current = onClose; });
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        panel.focus({ preventScroll: true });
        const size = () => {
            const viewport = window.visualViewport;
            const nav = document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
            const bottom = Math.min((viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0),
                nav?.height ? nav.top : Infinity);
            const root = rootRef.current?.getBoundingClientRect();
            const map = rootRef.current?.parentElement?.querySelector('.sector-image-map')?.getBoundingClientRect();
            if (!root || !map) return;
            const side = matchMedia('(min-width: 980px), (min-width: 560px) and (max-height: 450px)').matches;
            const available = side ? bottom - root.top - 8
                : root.top - Math.max(map.top, viewport?.offsetTop ?? 0) - 8;
            const budget = side ? 460 : map.height * (innerHeight <= 450 ? 1 : .8);
            panel.style.maxHeight = `${Math.max(80, Math.min(budget, available))}px`;
        };
        size();
        const resize = new ResizeObserver(size);
        if (rootRef.current) resize.observe(rootRef.current);
        window.addEventListener('resize', size);
        window.addEventListener('scroll', size, true);
        window.visualViewport?.addEventListener('resize', size);
        let outsidePointer = false;
        const blocked = () => Boolean(document.querySelector('[aria-modal="true"], dialog[open]'));
        const contains = (event: Event) => event.target instanceof Node && rootRef.current?.contains(event.target);
        const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
        const down = (event: PointerEvent) => {
            if (blocked()) return;
            outsidePointer = !contains(event);
            if (outsidePointer) consume(event);
        };
        const up = (event: PointerEvent) => {
            if (!outsidePointer) return;
            consume(event);
            // A prevented touch gesture need not synthesize a click (including
            // the tap that stops momentum scrolling). Finish dismissal on up.
            if (event.pointerType === 'touch') closeRef.current(true, true);
        };
        const cancel = () => { outsidePointer = false; };
        const click = (event: MouseEvent) => {
            if (blocked()) return;
            if (outsidePointer || !contains(event)) {
                consume(event); outsidePointer = false; closeRef.current(true);
            }
        };
        const key = (event: KeyboardEvent) => {
            if (blocked()) return;
            if (event.key === 'Escape') { consume(event); closeRef.current(true); }
            else if (/^[wasde]$/i.test(event.key) && !contains(event)) consume(event);
        };
        const focus = (event: FocusEvent) => {
            if (!contains(event) && !blocked()) closeRef.current(false);
        };
        // Existing modal primitives own their own focus and Escape. Retire this
        // surface when one takes over, without stealing focus from that dialog.
        const dialogs = new MutationObserver(() => { if (blocked()) closeRef.current(false); });
        dialogs.observe(document.body, { childList: true, subtree: true });
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('pointerup', up, true);
        document.addEventListener('pointercancel', cancel, true);
        document.addEventListener('click', click, true);
        document.addEventListener('keydown', key, true);
        document.addEventListener('focusin', focus);
        return () => {
            resize.disconnect(); dialogs.disconnect();
            window.removeEventListener('resize', size);
            window.removeEventListener('scroll', size, true);
            window.visualViewport?.removeEventListener('resize', size);
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('pointerup', up, true);
            document.removeEventListener('pointercancel', cancel, true);
            document.removeEventListener('click', click, true);
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('focusin', focus);
        };
    }, [rootRef]);
    return <div id={id} ref={panelRef} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1}
        className="sector-hud-panel" onWheel={event => event.stopPropagation()}>
        <header className="sector-hud-panel-heading">
            <strong id={`${id}-title`}>{title}</strong>
            <button type="button" aria-label={`Close ${title}`} onClick={() => onClose(true)}>×</button>
        </header>
        <div className="sector-hud-panel-scroll">{children}</div>
    </div>;
}
