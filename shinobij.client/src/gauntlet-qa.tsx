// Local-only production-renderer harness; excluded from the shipped build.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PetBoardArena } from "./components/PetBoardArena";
import { rawPetPool } from "./data/pet-pool";
import { runPetGridBattle } from "./lib/pet-board-sim";
import { preloadGauntletPets } from "./lib/pet-gauntlet-preload";
import { installShowdownLifecycleProbe } from "./lib/showdown-lifecycle-probe";
import "./index.css";
import "./styles/layout/adaptive-stages.css";

const params = new URLSearchParams(location.search);
const benchmark = params.has("benchmark");
// Resource accounting is a separate check; don't patch every GPU call twice
// during frame-time measurement. High HP keeps ten fighters active throughout.
if (!benchmark) Object.assign(window, { gauntletProbe: installShowdownLifecycleProbe() });
const count = params.has("full") ? 5 : 3;
const team = (side: string) => rawPetPool.slice(0, count).map((pet, col) => ({
    pet: { ...pet, templateId: pet.id, id: `${side}-${col}`, hp: benchmark ? 30000 : 170, attack: 170, defense: 20 }, row: 0, col,
}));
const player = team("player"), enemy = team("enemy");
const result = runPetGridBattle(player, enemy, 765, { accuracy: false });
export function Harness() {
    const [mounted, setMounted] = useState(false);
    return <>
        <div style={{ position: "fixed", zIndex: 99999, bottom: 0, left: 0 }}>
            <button onClick={() => setMounted(!mounted)}>{mounted ? "Unmount" : "Mount"}</button>
            <button onClick={() => { void preloadGauntletPets([...player, ...enemy].map(u => u.pet)); }}>Warm models</button>
        </div>
        {mounted && <PetBoardArena result={result} onDone={() => setMounted(false)} />}
    </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
