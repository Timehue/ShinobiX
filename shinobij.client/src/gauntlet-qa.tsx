// Local-only production-renderer harness; excluded from the shipped build.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PetBoardArena } from "./components/PetBoardArena";
import { rawPetPool } from "./data/pet-pool";
import { runPetGridBattle } from "./lib/pet-board-sim";
import { startGauntletRun, beginFight, applyRoundResult } from "./lib/pet-gauntlet";
import type { Pet } from "./types/pet";
import { preloadGauntletPets } from "./lib/pet-gauntlet-preload";
import { installShowdownLifecycleProbe } from "./lib/showdown-lifecycle-probe";
import "./index.css";
import "./styles/layout/adaptive-stages.css";

const params = new URLSearchParams(location.search);
const reported = params.has("reported");
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
// Current board recovery fixture, separated from the retired duel workbench.
const reportedPlayer = ["Sand Snake", "Ashen Crow", "Marsh Eel"].map((name, index) => {
    const pet = rawPetPool.find(candidate => candidate.name === name);
    if (!pet) throw new Error(`Missing reported Gauntlet fixture pet: ${name}`);
    return { pet: { ...pet, hp: 320, attack: 60, defense: 30, speed: 24 }, row: index < 2 ? 0 : 1, col: index % 2 };
});
const reportedEnemy = [0, 8, 60, 61, 62].map((poolIndex, index) => ({
    pet: { ...rawPetPool[poolIndex], element: (["Wind", "Earth", "Fire", "Water", "Lightning"] as const)[index], hp: 150, attack: 18, defense: 8, speed: 14 },
    row: index < 2 ? 0 : 1, col: index < 2 ? index : index - 2,
}));
const reportedResult = reported ? runPetGridBattle(reportedPlayer, reportedEnemy, 20260601) : null;
export function Harness() {
    const [mounted, setMounted] = useState(false);
    const [continueCount, setContinueCount] = useState(0);
    const [run, setRun] = useState(() => beginFight({ ...startGauntletRun(20260601), fieldIds: ['qa-player'], roster: [{ id: 'qa-player' } as Pet] }));
    if (reportedResult) return <>
        <output hidden data-testid="pet-board-continue-count" data-count={continueCount} />
        <output hidden data-testid="pet-board-run-state" data-round={run.round} data-cleared={run.roundsCleared} data-valor={run.valor} data-status={run.status} data-result={reportedResult.result} />
        {continueCount === 0 && <PetBoardArena result={reportedResult} onDone={() => {
            setRun(current => applyRoundResult(current, reportedResult.result === 'win'));
            setContinueCount(count => count + 1);
        }} />}
    </>;
    return <>
        <div style={{ position: "fixed", zIndex: 99999, bottom: 0, left: 0 }}>
            <button onClick={() => setMounted(!mounted)}>{mounted ? "Unmount" : "Mount"}</button>
            <button onClick={() => { void preloadGauntletPets([...player, ...enemy].map(u => u.pet)); }}>Warm models</button>
        </div>
        {mounted && <PetBoardArena result={result} onDone={() => setMounted(false)} />}
    </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
