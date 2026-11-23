import { useState } from "react";
import type { Wanderer } from "../lib/wanderers";
import "./road-beast-figure.css";

export function RoadBeastFigure({ art, name }: { art: NonNullable<Wanderer["roadBeastArt"]>; name: string }) {
    const [failed, setFailed] = useState(false);
    if (!art.atlas || failed) return <img src={art.pose} alt={name} draggable={false} />;
    return <span className="road-beast-frame">
        <img src={art.atlas} alt={name} draggable={false} onError={() => setFailed(true)} />
    </span>;
}
