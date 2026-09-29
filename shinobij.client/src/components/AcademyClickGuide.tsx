import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type AcademyClickStep = { selector: string; title: string; description: string };

/** A pointer-transparent callout: the real battle control always receives the click. */
export function AcademyClickGuide({ step }: { step: AcademyClickStep }) {
    const bubbleRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const target = document.querySelector<HTMLElement>(step.selector);
        const bubble = bubbleRef.current;
        const ring = ringRef.current;
        if (!target || !bubble || !ring || target.matches(":disabled")) return;
        const previousDescription = target.getAttribute("aria-describedby");
        target.setAttribute("aria-describedby", [previousDescription, "academy-click-description"].filter(Boolean).join(" "));
        // Reveal a clipped card inside its own tray, never scroll the battle/page.
        const tray = target.closest<HTMLElement>(".combat-action-tray");
        if (tray && getComputedStyle(tray).overflowY === "auto") {
            const rect = target.getBoundingClientRect();
            const bounds = tray.getBoundingClientRect();
            if (rect.bottom > bounds.bottom - 8) tray.scrollTop += rect.bottom - bounds.bottom + 8;
            else if (rect.top < bounds.top + 8) tray.scrollTop -= bounds.top + 8 - rect.top;
        }
        const place = () => {
            const rect = target.getBoundingClientRect();
            const viewport = window.visualViewport;
            const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
            const topEdge = (viewport?.offsetTop ?? 0) + 8;
            const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
            const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
            const clip = tray && getComputedStyle(tray).overflowY === "auto" ? tray.getBoundingClientRect() : null;
            const visible = rect.width > 0 && rect.height > 0 && rect.top >= topEdge - 8 && rect.bottom <= bottomEdge + 8
                && rect.left >= leftEdge - 8 && rect.right <= rightEdge + 8
                && (!clip || (rect.top >= clip.top && rect.bottom <= clip.bottom));
            bubble.hidden = ring.hidden = !visible;
            if (!visible) return;
            Object.assign(ring.style, { left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
            const width = bubble.offsetWidth;
            const height = bubble.offsetHeight;
            const left = Math.max(leftEdge, Math.min(rect.left + rect.width / 2 - width / 2, rightEdge - width));
            const focused = document.activeElement instanceof HTMLElement && document.activeElement !== target
                && document.activeElement.matches("button, a, input, select, textarea, [tabindex]")
                ? document.activeElement.getBoundingClientRect() : null;
            const coversFocus = (top: number) => focused && left < focused.right + 8 && left + width > focused.left - 8
                && top < focused.bottom + 8 && top + height > focused.top - 8;
            const above = rect.top - height - 14 >= topEdge && !coversFocus(rect.top - height - 14);
            const below = rect.bottom + height + 14 <= bottomEdge && !coversFocus(rect.bottom + 14);
            // A normal control fits above or below; never cover it on a tiny viewport.
            if (!above && !below) { bubble.hidden = true; return; }
            bubble.style.left = `${left}px`;
            bubble.style.top = `${above ? rect.top - height - 14 : rect.bottom + 14}px`;
            bubble.dataset.side = above ? "above" : "below";
            bubble.style.setProperty("--academy-arrow-x", `${Math.max(14, Math.min(width - 14, rect.left + rect.width / 2 - left))}px`);
        };
        place();
        // Board scale and tray sizing settle after mount; observe both and track scroll.
        const observer = new ResizeObserver(place);
        observer.observe(target);
        observer.observe(bubble);
        if (tray) observer.observe(tray);
        const board = document.querySelector("#combat .hex-battlefield");
        if (board) observer.observe(board);
        // CSS transforms can move a tile without changing its layout dimensions.
        const movement = new MutationObserver(place);
        for (let parent: HTMLElement | null = target; parent && parent !== document.body; parent = parent.parentElement) {
            movement.observe(parent, { attributes: true, attributeFilter: ["style", "class"] });
        }
        const frame = requestAnimationFrame(place);
        window.addEventListener("resize", place);
        document.addEventListener("scroll", place, true);
        document.addEventListener("focusin", place);
        document.addEventListener("focusout", place);
        window.visualViewport?.addEventListener("resize", place);
        window.visualViewport?.addEventListener("scroll", place);
        return () => {
            observer.disconnect();
            movement.disconnect();
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", place);
            document.removeEventListener("scroll", place, true);
            document.removeEventListener("focusin", place);
            document.removeEventListener("focusout", place);
            window.visualViewport?.removeEventListener("resize", place);
            window.visualViewport?.removeEventListener("scroll", place);
            if (previousDescription === null) target.removeAttribute("aria-describedby");
            else target.setAttribute("aria-describedby", previousDescription);
        };
    }, [step.selector, step.title, step.description]);

    return createPortal(<div className="academy-click-guide" data-target={step.selector}>
        <div ref={ringRef} className="academy-click-ring" hidden aria-hidden="true" />
        <div ref={bubbleRef} className="academy-click-bubble" hidden role="status" aria-live="polite" aria-atomic="true">
            <strong>{step.title}</strong>
            <span id="academy-click-description">{step.description}</span>
        </div>
    </div>, document.body);
}
