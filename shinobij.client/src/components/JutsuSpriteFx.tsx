/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";

export function JutsuSpriteFx({ frames, single, x, y, onDone, variant }: {
    frames: string[];
    single: boolean;
    x: number;
    y: number;
    onDone: () => void;
    /** Optional extra class for tinting (e.g. "fx-heal" → green glow). */
    variant?: string;
}) {
    const [i, setI] = useState(0);
    useEffect(() => {
        setI(0);
        if (single || frames.length <= 1) {
            const t = window.setTimeout(onDone, 680);
            return () => window.clearTimeout(t);
        }
        let idx = 0;
        const id = window.setInterval(() => {
            idx++;
            if (idx >= frames.length) { window.clearInterval(id); onDone(); return; }
            setI(idx);
        }, 55);
        return () => window.clearInterval(id);
        // onDone is recreated per render, but the component is keyed by the FX id
        // at the call site (it remounts per cast), so we resync only on frames.
    }, [frames, single]);
    return (
        <img
            src={frames[Math.min(i, frames.length - 1)]}
            className={`jutsu-sprite-fx${variant ? ` ${variant}` : ""}`}
            style={{ left: x, top: y }}
            alt=""
            aria-hidden="true"
        />
    );
}
