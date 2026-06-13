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
import { runPetArenaParty } from "./lib/pet-battle-sim";
import { rawPetPool } from "./data/pet-pool";
import { PetColiseum, PetColiseumDuel, PetArenaMatch } from "./components/PetColiseum";
import type { PetJutsu, Pet } from "./types/pet";
import type { ArenaRole, ArenaSlot } from "./lib/pet-arena-sim";
const jts = (...js: PetJutsu[]) => js;   // typed inline jutsu list for the duel harness

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
    // ?party=1 — run the simultaneous 2v2 engine instead, to exercise the
    // 4-standee party4v4 path in the coliseum renderer.
    const partyMode = PARAMS.get("party") === "1";
    // ?duel=1 — render the new TACTICAL diorama-stage duel (PetColiseumDuel),
    // using pets that have generated run-cycle frames so the gliding fix shows.
    const duelMode = PARAMS.get("duel") === "1";
    // A pure-RANGED kiter vs a MELEE chaser — the clearest tactical contrast.
    const duelPlayer = useMemo(() => ({ ...harnessPet(0, { element: "Fire" }), id: "generic-ai-pet-emberlynx", name: "Emberlynx", hp: 1100, attack: 110, speed: 95,
        jutsus: jts({ name: "Ember Bolt", kind: "burn", power: 95, cooldown: 2, currentCooldown: 0 }, { name: "Cinder Veil", kind: "slow", power: 55, cooldown: 3, currentCooldown: 0 }) }), []);
    const duelEnemy = useMemo(() => ({ ...harnessPet(7, { element: "Lightning" }), id: "generic-ai-pet-guardhound", name: "Guardhound", hp: 1200, attack: 115, speed: 80,
        jutsus: jts({ name: "Iron Bite", kind: "damage", power: 95, cooldown: 2, currentCooldown: 0 }, { name: "Warding Howl", kind: "stun", power: 45, cooldown: 4, currentCooldown: 0 }) }), []);
    const duelPlayerRes = useMemo(() => ({ ...harnessPet(1, { element: "Water" }), id: "legendary-0", name: "Ally", hp: 1000, attack: 100,
        jutsus: jts({ name: "Frost Lance", kind: "freeze", power: 90, cooldown: 3, currentCooldown: 0 }, { name: "Tide Mend", kind: "heal", power: 120, cooldown: 4, currentCooldown: 0 }) }), []);
    const duelEnemyRes = useMemo(() => ({ ...harnessPet(8, { element: "Earth" }), id: "legendary-1", name: "Foe", hp: 1000, attack: 100,
        jutsus: jts({ name: "Boulder Smash", kind: "damage", power: 100, cooldown: 1, currentCooldown: 0 }, { name: "Quag Snare", kind: "slow", power: 50, cooldown: 3, currentCooldown: 0 }) }), []);

    // ?arena=1 (2v2) / ?arena4=1 (4v4) — the Tactical Arena game mode.
    const arenaMode = PARAMS.get("arena") === "1" || PARAMS.get("arena4") === "1";
    const arena4 = PARAMS.get("arena4") === "1";
    const aPet = (id: string, name: string, element: string, over: Record<string, number>) => ({ ...harnessPet(0, { element: element as Pet["element"] }), id, name, ...over });
    const [arenaBlue, arenaRed] = useMemo(() => {
        const blueAll: ArenaSlot[] = [
            { pet: aPet("generic-ai-pet-guardhound", "Aegis", "Lightning", { hp: 1100, attack: 80, defense: 70, speed: 60 }), role: "defender" as ArenaRole },
            { pet: aPet("legendary-0", "Stalker", "Water", { hp: 760, attack: 95, defense: 45, speed: 82 }), role: "tracker" as ArenaRole },
            { pet: aPet("generic-ai-pet-emberlynx", "Blitz", "Fire", { hp: 620, attack: 125, defense: 32, speed: 100 }), role: "assassin" as ArenaRole },
            { pet: aPet("legendary-1", "Mender", "Wind", { hp: 640, attack: 55, defense: 42, speed: 78 }), role: "sage" as ArenaRole },
        ];
        const redAll: ArenaSlot[] = [
            { pet: aPet("legendary-2", "Bulwark", "Earth", { hp: 1100, attack: 80, defense: 70, speed: 60 }), role: "defender" as ArenaRole },
            { pet: aPet("legendary-3", "Hunter", "Fire", { hp: 760, attack: 95, defense: 45, speed: 82 }), role: "tracker" as ArenaRole },
            { pet: aPet("legendary-4", "Shade", "Lightning", { hp: 620, attack: 125, defense: 32, speed: 100 }), role: "assassin" as ArenaRole },
            { pet: aPet("legendary-5", "Oracle", "Water", { hp: 640, attack: 55, defense: 42, speed: 78 }), role: "sage" as ArenaRole },
        ];
        return arena4 ? [blueAll, redAll] : [[blueAll[0], blueAll[2]], [redAll[1], redAll[3]]];
    }, [arena4]);
    const playerPet = useMemo(() => harnessPet(0, { element: "Fire" }), []);
    const enemyPet = useMemo(() => harnessPet(7, { element: "Wind" }), []);
    const playerReserve = useMemo(() => harnessPet(1, { element: "Water" }), []);
    const enemyReserve = useMemo(() => harnessPet(8, { element: "Earth" }), []);
    // Feed the demo creature sprites in as the pets' battle billboards.
    const harnessShared = useMemo(() => ({
        [`petbody:${playerPet.id}`]: DEMO_FOX,
        [`petbody:${enemyPet.id}`]: DEMO_CROW,
    }), [playerPet.id, enemyPet.id]);
    const battle = useMemo(() => {
        if (!partyMode) return runPetArenaBattle(playerPet, enemyPet, "Rival", seed, 1);
        const party = runPetArenaParty([playerPet, playerReserve], [enemyPet, enemyReserve], "Rival", seed, 1);
        // The simultaneous 2v2 keeps ALL frames/logs/obstacles in matches[0].
        return {
            result: party.result,
            frames: party.matches[0]?.frames ?? [],
            obstacles: party.matches[0]?.obstacles ?? [],
            tiles: undefined,
        };
    }, [partyMode, playerPet, enemyPet, playerReserve, enemyReserve, seed]);
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
            {duelMode && (
                <PetColiseumDuel
                    playerPet={duelPlayer}
                    enemyPet={duelEnemy}
                    playerReservePet={partyMode ? duelPlayerRes : undefined}
                    enemyReservePet={partyMode ? duelEnemyRes : undefined}
                    seed={seed}
                    sharedImages={harnessShared}
                    onFightAgain={restart}
                    onExit={() => {}}
                />
            )}
            {arenaMode && (
                <PetArenaMatch blue={arenaBlue} red={arenaRed} seed={seed} sharedImages={harnessShared} onExit={() => { }} />
            )}
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
                    playerReservePet={partyMode ? playerReserve : undefined}
                    enemyReservePet={partyMode ? enemyReserve : undefined}
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
