import type { ReactNode } from "react";

/** A minimal camera-scale node. Artwork keeps its own styles and hover state;
 * changing this wrapper's native scale does not restyle its descendants. */
export function WorldMapPin({ active, x, y, layer, anchorClass, children }: {
    active: boolean;
    x: number;
    y: number;
    layer: number;
    anchorClass?: string;
    children: ReactNode;
}) {
    if (!active) return children;
    return <div className={"wm-scale-pin" + (anchorClass ? ` ${anchorClass}` : "")} data-map-layer={layer}
        style={{ left: `${x}%`, top: `${y}%`, zIndex: layer }}>{children}</div>;
}
