import { useState, type ReactNode } from "react";
import { SectorNpcLayer } from "../lib/sector-npc-layer";
import "./sector-npc-layer.css";

/**
 * The board's shared NPC layer plus the context its NPCs portal through (see
 * lib/sector-npc-layer). Rendered as a direct child of a board, so the layer
 * covers exactly the area every NPC overlay used to.
 */
export function SectorNpcLayerHost({ children }: { children: ReactNode }) {
    const [layer, setLayer] = useState<HTMLDivElement | null>(null);
    return <>
        <div className="sector-npc-layer" ref={setLayer} />
        <SectorNpcLayer.Provider value={layer}>{children}</SectorNpcLayer.Provider>
    </>;
}
