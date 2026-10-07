import { useLayoutEffect, useRef } from "react";
import type { SectorDirection } from "../../../shared/sector-links";

/** A fixed viewport joins the outgoing floor to the incoming floor at their road edge. */
export function SectorFloorPan({ image, direction }: { image?: string; direction?: SectorDirection | null }) {
    const previous = useRef<string | undefined>(undefined);
    const outgoing = useRef<HTMLDivElement>(null), incoming = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const old = previous.current;
        previous.current = image;
        const out = outgoing.current, next = incoming.current;
        if (!out || !next) return;
        out.hidden = true;
        if (!old || old === image || !direction || !out.animate || document.documentElement.classList.contains("lite-fx")
            || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const [x, y] = direction === "east" ? [100, 0] : direction === "west" ? [-100, 0]
            : direction === "south" ? [0, 100] : [0, -100];
        out.style.backgroundImage = `url("${old}")`;
        out.hidden = false;
        const options = { duration: 420, easing: "cubic-bezier(.22,.61,.36,1)", fill: "forwards" as const };
        const leave = out.animate([{ transform: "translate(0,0)" }, { transform: `translate(${-x}%,${-y}%)` }], options);
        const arrive = next.animate([{ transform: `translate(${x}%,${y}%)` }, { transform: "translate(0,0)" }], options);
        // Incoming world actors and building labels belong to the incoming floor.
        // Animate their outer elements without wrapping the measured tile grid or
        // disturbing the inner transforms used for walking and marker anchors.
        const board = next.closest<HTMLElement>(".pixel-map");
        const actors = board?.querySelectorAll<HTMLElement>(".sector-peers-overlay,.sector-wanderer-overlay,.sector-ground-landmark,.sector-ground-cairn,.sector-village-entrance,.sector-story-field-marker,.sector-trace-overlay,.sector-shrine-standee,.sector-rift-standee,.sector-stronghold-standee");
        const actorPans = Array.from(actors ?? [], actor => actor.animate([
            { translate: `${x / 100 * board!.clientWidth}px ${y / 100 * board!.clientHeight}px` },
            { translate: "0px 0px" },
        ], options));
        leave.onfinish = () => { out.hidden = true; };
        return () => { leave.cancel(); arrive.cancel(); actorPans.forEach(animation => animation.cancel()); out.hidden = true; };
    }, [image, direction]);
    return <div className="sector-floor-pan" aria-hidden="true">
        <div ref={incoming} className="sector-map-backdrop" style={{ backgroundImage: image ? `url("${image}")` : undefined }} />
        <div ref={outgoing} className="sector-map-backdrop sector-floor-outgoing" hidden />
    </div>;
}
