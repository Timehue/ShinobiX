import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BloodlineAwakeningCinematic, type BloodlineRitualRank } from "../../src/components/BloodlineAwakeningCinematic";
import "../../src/styles/tokens.css";
import "../../src/styles/ui.css";

export function Fixture() {
    const [open, setOpen] = useState(false);
    const [completed, setCompleted] = useState(0);
    const params = new URLSearchParams(location.search);
    const rank = (params.get("rank") ?? "S Rank") as BloodlineRitualRank;
    return <>
        <button onClick={() => setOpen(true)}>Begin ritual</button>
        <output aria-label="Builder opens">{completed}</output>
        {open && <BloodlineAwakeningCinematic rank={rank} resumed={params.has("resumed")}
            onFinished={() => { setCompleted(n => n + 1); setOpen(false); }} />}
    </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
