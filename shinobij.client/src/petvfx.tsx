// ── DEV-ONLY pet-battle VFX harness ──────────────────────────────────────
// Drives a real runPetArenaBattle() replay through PetArenaBattlefield so the
// battle animations (movement, lunges, prefight countdown, KO) can be iterated
// without a backend or login. NOT part of the shipped app — reachable only at
// /petvfx.html in `vite dev`, and not listed in the production build inputs.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/pet-skin.css";
import { PetArenaBattlefield } from "./components/PetArenaBattlefield";
import { petFramePace, runPetArenaBattle, runPetArenaParty } from "./lib/pet-battle-sim";
import { rawPetPool } from "./data/pet-pool";
import { PetColiseum, PetColiseumDuel, PetArenaMatch } from "./components/PetColiseum";
import { PetWarfrontMatch } from "./components/PetWarfrontMatch";
import { WF_THEMES, type WfTheme } from "./lib/pet-warfront-map";
import type { WfBuyPolicy, WfStance } from "./lib/pet-warfront-sim";
import { runPetDuelCinematic, runPetPartyDuelCinematic } from "./lib/pet-duel-cinematic";
import { createLiveDuel, createLivePartyDuel } from "./lib/pet-duel-live";
import { PetBoardArena } from "./components/PetBoardArena";
import { PetGauntlet } from "./components/PetGauntlet";
import { runPetGridBattle } from "./lib/pet-board-sim";
import type { PetJutsu, Pet } from "./types/pet";
import type { Character } from "./types/character";
import type { ArenaRole, ArenaSlot } from "./lib/pet-arena-sim";
import { PetModelQa } from "./components/PetModelQa";
import { petElementByName } from "./data/pet-elements";
import { balanceBuiltInPetTemplate } from "./lib/pet-balance";
import { genericPetArenaOpponents } from "./data/pet-arena-opponents";
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
const START_DUEL_TICK = PARAMS.get("dueltick") !== null ? Math.max(0, Number(PARAMS.get("dueltick")) || 0) : 0;
const DEBUG_AI = PARAMS.get("debugAI") === "1";

function Harness() {
    const [seed, setSeed] = useState(START_SEED);
    const [qaFightMounted, setQaFightMounted] = useState(true);
    const [qaRemounts, setQaRemounts] = useState(0);
    useEffect(() => {
        if (PARAMS.get("remountqa") !== "1") return;
        const timers: number[] = [];
        [1400, 2800, 4200].forEach((start) => {
            timers.push(window.setTimeout(() => setQaFightMounted(false), start));
            timers.push(window.setTimeout(() => {
                setQaFightMounted(true);
                setQaRemounts((count) => count + 1);
            }, start + 420));
        });
        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, []);
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
    // ?cine=1 — play the NEW cinematic engine (pet-duel-cinematic.ts) through the
    // same renderer (precompute the result + pass it in).
    const cineMode = PARAMS.get("cine") === "1";
    // ?control=1 — the PLAYER-CONTROLLED duel (docs/pet-coliseum-player-control-plan.md):
    // the fight runs live behind the command deck instead of being precomputed.
    // This is the manual QA route for orders, stance, Auto and Bond Break.
    const controlMode = PARAMS.get("control") === "1";
    // ?model3d=1 — force a pair of evolved starters with approved GLB combat art.
    // This is the deterministic visual-QA route for the live 3D Coliseum path.
    const modelQaMode = PARAMS.get("modelqa") === "1";
    // ?rosterfox=1 runs the approved production Red Fox against the regular
    // 3D water opponent, proving roster art through the full fight renderer.
    const rosterFoxMode = PARAMS.get("rosterfox") === "1";
    const requestedRosterId = rosterFoxMode ? "standard-0" : PARAMS.get("rosterpet");
    const rosterBattlePet = requestedRosterId ? rawPetPool.find((pet) => pet.id === requestedRosterId) : undefined;
    const model3dMode = PARAMS.get("model3d") === "1" || modelQaMode || Boolean(rosterBattlePet);
    // ?liveai=guardhound|emberlynx|sparrow reproduces an exact built-in Coliseum
    // matchup instead of pairing roster QA with an evolved starter. Keeping all
    // three aliases available prevents a generic starter preview from certifying
    // a production-only model/material failure.
    const liveAiKey = PARAMS.get("liveai")?.toLowerCase();
    const liveAiEnemy = liveAiKey
        ? genericPetArenaOpponents.find((entry) => entry.pet.id === `generic-ai-pet-${liveAiKey}`)?.pet
        : undefined;
    // ?legendary=1 lets visual QA compare the alternate evolved mesh without
    // changing the live model gate or the deterministic fight setup.
    const legendaryModelMode = PARAMS.get("legendary") === "1";
    // ?quick=1 — exhibition pacing for short recordings. Dev harness only;
    // the live simulator, combat formulas, rewards and ranked paths are untouched.
    const quickDemoMode = PARAMS.get("quick") === "1";
    // Roster QA must preserve the selected pet's ACTUAL combat identity. The old
    // harness put every model into the same all-ranged fire-kiter kit, which made a
    // melee/support pet such as Eclipse Kitsune spend the preview running away.
    const duelPlayer = useMemo(() => {
        // The preview must use the finalized template the live game uses: this
        // includes its role, elemental special, and signature move rather than an
        // unbalanced raw roster record with part of the kit missing.
        const base = rosterBattlePet ? balanceBuiltInPetTemplate(rosterBattlePet) : harnessPet(0, { element: "Fire" });
        const element = rosterBattlePet ? base.element ?? petElementByName[base.name] ?? "Fire" : "Fire";
        return {
            ...base,
            element,
            id: rosterBattlePet?.id ?? (model3dMode ? "starter-fire" : "generic-ai-pet-emberlynx"),
            name: rosterBattlePet?.name ?? (model3dMode ? (legendaryModelMode ? "Inferno Fenrir" : "Ember Wolf") : "Emberlynx"),
            hp: quickDemoMode ? 520 : Math.max(1100, base.hp ?? 0),
            attack: quickDemoMode ? Math.max(150, base.attack ?? 0) : Math.max(110, base.attack ?? 0),
            speed: Math.max(88, base.speed ?? 0),
            ...(model3dMode ? { evolutionStage: legendaryModelMode ? 2 as const : 1 as const, rarity: rosterBattlePet?.rarity ?? (legendaryModelMode ? "legendary" as const : "rare" as const) } : {}),
            jutsus: rosterBattlePet ? base.jutsus.map((move) => ({ ...move, currentCooldown: 0 })) : (model3dMode
                ? jts(
                    { name: "Ember Fang", kind: "damage", power: 82, cooldown: 1, currentCooldown: 0 },
                    { name: "Cinder Volley", kind: "burn", power: 86, cooldown: 2, currentCooldown: 0 },
                    { name: "Flame Burst", kind: "push", power: 112, cooldown: 4, currentCooldown: 0, signature: true },
                    { name: "Blazing Focus", kind: "buff", power: 58, cooldown: 5, currentCooldown: 0 },
                )
                : jts({ name: "Ember Bolt", kind: "burn", power: 95, cooldown: 2, currentCooldown: 0 }, { name: "Cinder Veil", kind: "slow", power: 55, cooldown: 3, currentCooldown: 0 }, { name: "Stone Ward", kind: "barrier", power: 60, cooldown: 3, currentCooldown: 0 })),
        };
    }, [model3dMode, rosterBattlePet, legendaryModelMode, quickDemoMode]);
    const duelEnemy = useMemo(() => liveAiEnemy ? ({ ...liveAiEnemy, hp: quickDemoMode ? 520 : liveAiEnemy.hp }) : ({ ...harnessPet(7, { element: model3dMode ? "Water" : "Lightning" }), id: model3dMode ? "starter-water" : "generic-ai-pet-guardhound", name: model3dMode ? (legendaryModelMode ? "Abyssal Leviathan" : "Tidal Selkie") : "Guardhound", hp: quickDemoMode ? 520 : 1200, attack: quickDemoMode ? 160 : 115, speed: 84,
        ...(model3dMode ? { evolutionStage: legendaryModelMode ? 2 as const : 1 as const, rarity: legendaryModelMode ? "legendary" as const : "rare" as const } : {}),
        jutsus: model3dMode
            ? jts(
                { name: "Riptide Fang", kind: "damage", power: 82, cooldown: 1, currentCooldown: 0 },
                { name: "Tidal Crash", kind: "push", power: 106, cooldown: 3, currentCooldown: 0, signature: true },
                { name: "Flow State", kind: "haste", power: 54, cooldown: 5, currentCooldown: 0 },
                { name: "Riptide Shift", kind: "move", power: 1, cooldown: 3, currentCooldown: 0 },
            )
            : jts({ name: "Iron Bite", kind: "damage", power: 95, cooldown: 2, currentCooldown: 0 }, { name: "Warding Howl", kind: "stun", power: 45, cooldown: 4, currentCooldown: 0 }) }), [model3dMode, legendaryModelMode, quickDemoMode, liveAiEnemy]);
    const duelPlayerRes = useMemo(() => ({ ...harnessPet(1, { element: "Water" }), id: "legendary-0", name: "Ally", hp: 1000, attack: 100,
        jutsus: jts({ name: "Frost Lance", kind: "freeze", power: 90, cooldown: 3, currentCooldown: 0 }, { name: "Tide Mend", kind: "heal", power: 120, cooldown: 4, currentCooldown: 0 }) }), []);
    const duelEnemyRes = useMemo(() => ({ ...harnessPet(8, { element: "Earth" }), id: "legendary-1", name: "Foe", hp: 1000, attack: 100,
        jutsus: jts({ name: "Boulder Smash", kind: "damage", power: 100, cooldown: 1, currentCooldown: 0 }, { name: "Quag Snare", kind: "slow", power: 50, cooldown: 3, currentCooldown: 0 }) }), []);

    // ?arena=1 (2v2) / ?arena4=1 (4v4) — the Tactical Arena game mode.
    const arenaMode = PARAMS.get("arena") === "1" || PARAMS.get("arena4") === "1";
    // ?warfront=1 — the Hollow Warfront lane-war mode (always 4v4). Optional
    // &theme=forest|snow|volcano|shadow|central and &autobuy=balanced|offense|defense.
    const warfrontMode = PARAMS.get("warfront") === "1";
    const arena4 = PARAMS.get("arena4") === "1" || warfrontMode;
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
    // ?gauntlet=1 — the full Pet Gauntlet run UI (offline: the server start fails
    // gracefully to a local seed, so the shop overlay + board render with no login).
    const gauntletMode = PARAMS.get("gauntlet") === "1";
    const mockChar = useMemo(() => ({ name: "Tester", ryo: 5000 } as unknown as Character), []);
    // ?board=1 — the Pet Gauntlet BOARD auto-battler (PetBoardArena), full 5v5.
    const boardMode = PARAMS.get("board") === "1";
    const boardPlayer = useMemo(() => [
        harnessPet(0, { element: "Fire" }), harnessPet(1, { element: "Fire" }),
        harnessPet(2, { element: "Water" }), harnessPet(20, { element: "Earth" }),
        harnessPet(50, { element: "Lightning" }),
    ], []);
    const boardEnemy = useMemo(() => [
        harnessPet(7, { element: "Wind" }), harnessPet(8, { element: "Earth" }),
        harnessPet(60, { element: "Fire" }), harnessPet(61, { element: "Water" }),
        harnessPet(62, { element: "Lightning" }),
    ], []);
    const boardResult = useMemo(() => runPetGridBattle(
        [
            { pet: boardPlayer[0], row: 0, col: 0 }, { pet: boardPlayer[1], row: 0, col: 1 },
            { pet: boardPlayer[2], row: 1, col: 0 }, { pet: boardPlayer[3], row: 1, col: 1 }, { pet: boardPlayer[4], row: 1, col: 2 },
        ],
        [
            { pet: boardEnemy[0], row: 0, col: 0 }, { pet: boardEnemy[1], row: 0, col: 1 },
            { pet: boardEnemy[2], row: 1, col: 0 }, { pet: boardEnemy[3], row: 1, col: 1 }, { pet: boardEnemy[4], row: 1, col: 2 },
        ],
        seed,
    ), [boardPlayer, boardEnemy, seed]);
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
    const liveDuel = useMemo(() => {
        if (!controlMode) return undefined;
        return partyMode
            ? createLivePartyDuel(duelPlayer, duelPlayerRes, duelEnemy, duelEnemyRes, seed, 1, 1, false, true, undefined)
            : createLiveDuel(duelPlayer, duelEnemy, seed, 1, 1, false, true, undefined, null);
    }, [controlMode, partyMode, duelPlayer, duelEnemy, duelPlayerRes, duelEnemyRes, seed]);
    const cineResult = useMemo(() => {
        if (!cineMode || controlMode) return undefined;
        return partyMode
            ? runPetPartyDuelCinematic(duelPlayer, duelPlayerRes, duelEnemy, duelEnemyRes, seed, 1, 1, false, true, undefined, DEBUG_AI)
            : runPetDuelCinematic(duelPlayer, duelEnemy, seed, 1, 1, false, true, undefined, null, DEBUG_AI);
    }, [cineMode, controlMode, partyMode, duelPlayer, duelEnemy, duelPlayerRes, duelEnemyRes, seed]);
    useEffect(() => {
        // Dev-only deterministic QA hook: lets the browser harness locate exact
        // maneuver/signature ticks without adding scrub controls to production UI.
        (window as unknown as { __petDuelResult?: unknown }).__petDuelResult = cineResult;
    }, [cineResult]);
    useEffect(() => {
        // Same idea for the player-controlled duel: exposes the live controller so
        // the browser QA loop can advance playback and issue orders without needing
        // a compositing WebGL frame (the render loop is throttled when the pane is
        // hidden, which would otherwise freeze the fight).
        (window as unknown as { __petLiveDuel?: unknown }).__petLiveDuel = liveDuel;
    }, [liveDuel]);

    const btn: React.CSSProperties = { padding: "6px 12px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 6, cursor: "pointer", font: "600 12px Inter, sans-serif" };
    if (modelQaMode) return <PetModelQa />;
    if (gauntletMode) {
        return <div className="pet-arena-screen" style={{ maxWidth: 1000, margin: "16px auto", padding: 12 }}><PetGauntlet character={mockChar} updateCharacter={() => {}} /></div>;
    }
    return (
        <div style={{ maxWidth: 880, margin: "16px auto", padding: 12 }}>
            {cineResult && <output hidden data-testid="pet-duel-qa" data-events={JSON.stringify(cineResult.events)} />}
            <output hidden data-testid="pet-atlas-remount-qa" data-remounts={qaRemounts} />
            {(duelMode || cineMode || controlMode) && qaFightMounted && (
                <PetColiseumDuel
                    playerPet={duelPlayer}
                    enemyPet={duelEnemy}
                    playerReservePet={partyMode ? duelPlayerRes : undefined}
                    enemyReservePet={partyMode ? duelEnemyRes : undefined}
                    seed={seed}
                    result={cineResult}
                    live={liveDuel}
                    initialTick={START_DUEL_TICK}
                    sharedImages={harnessShared}
                    onFightAgain={restart}
                    onExit={() => {}}
                />
            )}
            {arenaMode && (
                <PetArenaMatch blue={arenaBlue} red={arenaRed} seed={seed} sharedImages={harnessShared} onExit={() => { }} />
            )}
            {warfrontMode && (
                <PetWarfrontMatch
                    blue={arenaBlue} red={arenaRed} seed={seed} allowReseed
                    theme={((): WfTheme => { const t = PARAMS.get("theme") as WfTheme | null; return t && WF_THEMES[t] ? t : "central"; })()}
                    autoBuy={((): WfBuyPolicy => { const p = PARAMS.get("autobuy"); return p === "balanced" || p === "offense" || p === "defense" ? p : "off"; })()}
                    stance={((): WfStance => { const s = PARAMS.get("stance"); return s === "siege" || s === "jungle" || s === "headhunt" || s === "turtle" ? s : "balanced"; })()}
                    onExit={() => { }}
                />
            )}
            {boardMode && (
                <PetBoardArena result={boardResult} onDone={restart} />
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

const rootNode = document.getElementById("root")!;
const devWindow = window as typeof window & { __petVfxRoot?: ReturnType<typeof createRoot> };
const petVfxRoot = devWindow.__petVfxRoot ?? createRoot(rootNode);
devWindow.__petVfxRoot = petVfxRoot;

async function mountHarness() {
    // Reproduce the live PetArena lifecycle: decode both chosen GLBs while no
    // Canvas exists, then mount the fight from those warmed caches. This catches
    // atlas ownership bugs that a direct /petvfx first render cannot expose.
    if (PARAMS.get("preloadqa") === "1") {
        const requested = PARAMS.get("rosterpet");
        const player = requested ? rawPetPool.find((pet) => pet.id === requested) : undefined;
        const liveAi = PARAMS.get("liveai")?.toLowerCase();
        const enemy = liveAi ? genericPetArenaOpponents.find((entry) => entry.pet.id === `generic-ai-pet-${liveAi}`)?.pet : undefined;
        if (player && enemy) {
            const { preloadPetColiseumModels } = await import("./lib/pet-model-preload");
            await preloadPetColiseumModels([player, enemy]);
        }
    }
    petVfxRoot.render(<Harness />);
}

void mountHarness();
