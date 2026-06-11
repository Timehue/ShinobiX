// ── DEV-ONLY pet-battle VFX harness ──────────────────────────────────────
// Drives a real runPetArenaBattle() replay through PetArenaBattlefield so the
// battle animations (movement, lunges, prefight countdown, KO) can be iterated
// without a backend or login. NOT part of the shipped app — reachable only at
// /petvfx.html in `vite dev`, and not listed in the production build inputs.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/pet-skin.css";
import { runPetArenaBattle, PetArenaBattlefield, petFramePace } from "./App";
import { rawPetPool } from "./data/pet-pool";
import { PetColiseum } from "./components/PetColiseum";

// Demo creature billboards for the coliseum harness — transparent full-body
// sprites keyed as petbody:<id> (the exact slot the live app fills from
// sharedImages). Proves the real-portrait billboard path; not shipped.
const DEMO_FOX = new URL("./assets/coliseum/demo-emberfox.webp", import.meta.url).href;
const DEMO_CROW = new URL("./assets/coliseum/demo-stormcrow.webp", import.meta.url).href;

// Two visually distinct pets, far apart on the grid so there is lots of
// movement to watch. Bumped stats so the fight resolves in a sane frame count.
function harnessPet(index: number, over: Partial<(typeof rawPetPool)[number]>) {
    const base = rawPetPool[index];
    return { ...base, hp: 320, attack: 60, defense: 30, speed: 24, ...over };
}

const PARAMS = new URLSearchParams(window.location.search);
const START_SEED = Number(PARAMS.get("seed")) || 20260601;
const START_FRAME = PARAMS.get("frame") !== null ? Math.max(0, Number(PARAMS.get("frame")) || 0) : null;

function Harness() {
    const [seed, setSeed] = useState(START_SEED);
    // Phase-0 HD-2D spike toggle (?coliseum=1 or the button below). Swaps the
    // current DOM battlefield for the throwaway react-three-fiber scene so the
    // coliseum look can be eyeballed. Dev-only; nothing here ships.
    const [coliseum, setColiseum] = useState(PARAMS.get("coliseum") === "1");
    const playerPet = useMemo(() => harnessPet(0, { element: "Fire" }), []);
    const enemyPet = useMemo(() => harnessPet(7, { element: "Wind" }), []);
    // Feed the demo creature sprites in as the pets' battle billboards.
    const harnessShared = useMemo(() => ({
        [`petbody:${playerPet.id}`]: DEMO_FOX,
        [`petbody:${enemyPet.id}`]: DEMO_CROW,
    }), [playerPet.id, enemyPet.id]);
    const battle = useMemo(
        () => runPetArenaBattle(playerPet, enemyPet, "Rival", seed, 1),
        [playerPet, enemyPet, seed],
    );
    const frames = battle.frames;
    const result = battle.result === "win" ? "Victory" : battle.result === "loss" ? "Defeat" : "Draw";

    // ?frame=N jumps straight to a paused frame for deterministic screenshots.
    const [i, setI] = useState(START_FRAME !== null ? Math.min(START_FRAME, frames.length - 1) : 0);
    const [playing, setPlaying] = useState(START_FRAME === null);
    useEffect(() => {
        // No setState here: at the last frame we simply stop scheduling.
        if (!playing || i >= frames.length - 1) return;
        const t = window.setTimeout(() => setI((x) => Math.min(x + 1, frames.length - 1)), petFramePace(frames[i]));
        return () => window.clearTimeout(t);
    }, [i, playing, frames]);
    // Debug: expose a compact frame map for the Playwright inspection loop.
    useEffect(() => {
        (window as unknown as { __petFrames?: unknown }).__petFrames = frames.map((f, n) => ({ n, k: f.actionKind, a: f.actor, pp: f.playerPos, ep: f.enemyPos, ko: f.isKO, pre: f.isPrefight }));
    }, [frames]);

    const frame = frames[i];
    const restart = () => { setI(0); setPlaying(true); };

    const btn: React.CSSProperties = { padding: "6px 12px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 6, cursor: "pointer", font: "600 12px Inter, sans-serif" };
    return (
        <div style={{ maxWidth: 880, margin: "16px auto", padding: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button style={btn} onClick={restart}>⟲ Replay</button>
                <button style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
                <button style={btn} onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }}>◀ Prev</button>
                <button style={btn} onClick={() => { setPlaying(false); setI((x) => Math.min(frames.length - 1, x + 1)); }}>Next ▶</button>
                <button style={btn} onClick={() => setSeed((s) => s + 1)}>🎲 New seed ({seed})</button>
                <button style={{ ...btn, background: coliseum ? "#6d28d9" : "#1e3a8a" }} onClick={() => setColiseum((c) => !c)}>
                    {coliseum ? "🎬 HD-2D coliseum ✓" : "🎬 HD-2D coliseum"}
                </button>
                <span style={{ color: "#cbd5e1", font: "600 12px Inter, sans-serif" }}>
                    frame {i + 1}/{frames.length} · {frame?.actionKind ?? "idle"} · actor {frame?.actor} · pos P{frame?.playerPos} E{frame?.enemyPos}{frame?.isPrefight ? " · PREFIGHT" : ""}{frame?.isKO ? " · KO" : ""}
                </span>
            </div>
            {coliseum ? (
                <PetColiseum
                    playerPet={playerPet}
                    enemyPet={enemyPet}
                    enemyOwner="Rival"
                    sharedImages={harnessShared}
                    frame={frame}
                    recentFrames={frames.slice(Math.max(0, i - 4), i + 1)}
                    result={i >= frames.length - 1 ? result : ""}
                    obstacles={battle.obstacles}
                    tiles={battle.tiles}
                    onReplay={restart}
                    onFightAgain={restart}
                    onExit={() => {}}
                    playerRecord={{ wins: 7, losses: 2, rating: 1240 }}
                    enemyRecord={{ wins: 5, losses: 4, rating: 1190 }}
                />
            ) : (
            <div className="pet-arena-screen" style={{ minHeight: 620 }}>
                <PetArenaBattlefield
                    playerPet={playerPet}
                    enemyPet={enemyPet}
                    enemyOwner="Rival"
                    frame={frame}
                    recentFrames={frames.slice(Math.max(0, i - 4), i + 1)}
                    result={i >= frames.length - 1 ? result : ""}
                    obstacles={battle.obstacles}
                    tiles={battle.tiles}
                    onReplay={restart}
                    onFightAgain={restart}
                    onExit={() => {}}
                    playerRecord={{ wins: 7, losses: 2, rating: 1240 }}
                    enemyRecord={{ wins: 5, losses: 4, rating: 1190 }}
                />
            </div>
            )}
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
