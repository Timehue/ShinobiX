/*
 * PetGauntlet — the Pet Gauntlet run mode UI (a 3rd tab in the Pet Coliseum page,
 * next to the Tactical Pet Arena).
 *
 * Self-contained: it owns its GauntletRun state (lib/pet-gauntlet.ts) and its own
 * full-screen fight via PetColiseumDuel, so it never tangles with PetArena's
 * existing battle/duel state — adding the tab is therefore zero-risk to the
 * Coliseum + Tactical flows.
 *
 * Loop: DRAFT from the shop into a run-only roster → field up to 2 (chasing
 * element/role SYNERGIES) → fight the round on the continuous engine → win
 * advances + pays gold, loss costs a heart. V1 = PREVIEW (no rewards granted).
 */
import { useMemo, useState } from "react";
import type { Pet } from "../types/pet";
import { runPetGridBattle, BOARD_COLS, BOARD_ROWS_PER_SIDE, type BoardResult, type GridUnit } from "../lib/pet-board-sim";
import {
    startGauntletRun, buyOffer, rerollShop, releasePet, fieldedPets,
    enemySquadForRound, beginFight, applyRoundResult,
    GAUNTLET_REROLL_COST,
    type GauntletRun,
} from "../lib/pet-gauntlet";
import { resolveSynergies, applySynergiesToSquad } from "../lib/pet-synergies";
import { petCardImage } from "../lib/pet-battle-anim";
import { ROLE_META, derivePetRole, type PetRole } from "../lib/pet-roles";
import { PetBoardArena } from "./PetBoardArena";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";

const ELEMENT_COLOR: Record<string, string> = {
    Fire: "#fb923c", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#facc15", Earth: "#a3a380",
};
const elColor = (el?: string | null) => (el && ELEMENT_COLOR[el]) || "#94a3b8";
const roleOf = (p: Pet): PetRole => (p.role as PetRole | undefined) ?? derivePetRole(p).role;
// Deterministic fight seed from the run + round so a round's fight is reproducible.
const fightSeed = (run: GauntletRun) => (run.seed * 7919 + run.round * 104729) >>> 0;

function PetMiniCard({ pet, footer }: { pet: Pet; footer?: React.ReactNode }) {
    const role = roleOf(pet);
    return (
        <div style={{ border: `1px solid ${elColor(pet.element)}66`, borderRadius: 10, background: "rgba(15,23,42,0.6)", padding: "8px 10px", minWidth: 132 }}>
            {(() => { const img = petCardImage(pet); return img ? <img src={img} alt="" style={{ display: "block", width: "100%", height: 70, objectFit: "contain", marginBottom: 4, mixBlendMode: "screen", filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.5))" }} /> : null; })()}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <strong style={{ fontSize: "0.86rem", color: "#e2e8f0" }}>{pet.name}</strong>
                <span title={ROLE_META[role].label} style={{ fontSize: "0.92rem" }}>{ROLE_META[role].icon}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "3px 0 5px" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: elColor(pet.element) }}>{pet.element ?? "—"}</span>
                <span style={{ fontSize: "0.68rem", color: "#64748b", textTransform: "capitalize" }}>· {pet.rarity}</span>
            </div>
            <div style={{ display: "flex", gap: 8, fontSize: "0.68rem", color: "#94a3b8" }}>
                <span title="HP">❤ {pet.hp}</span><span title="Attack">⚔ {pet.attack}</span><span title="Defense">🛡 {pet.defense}</span><span title="Speed">💨 {pet.speed}</span>
            </div>
            {footer && <div style={{ marginTop: 6 }}>{footer}</div>}
        </div>
    );
}

const btn = (bg: string, disabled = false): React.CSSProperties => ({
    padding: "5px 12px", borderRadius: 8, border: "1px solid #334155", background: disabled ? "#1e293b" : bg,
    color: disabled ? "#64748b" : "#0b1220", fontWeight: 800, fontSize: "0.78rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
});

export function PetGauntlet({ sharedImages = {} }: { sharedImages?: Record<string, string> }) {
    const [run, setRun] = useState<GauntletRun>(() => startGauntletRun((Date.now() & 0x7fffffff) >>> 0));
    // The active fight: the precomputed board result the board renderer plays.
    const [fight, setFight] = useState<{ result: BoardResult; key: number } | null>(null);

    const fielded = useMemo(() => fieldedPets(run), [run]);
    const synergies = useMemo(() => resolveSynergies(fielded), [fielded]);

    // Placement: each pet sits on a cell of YOUR grid (row 0 = front line that
    // soaks the enemy melee … back row = protected). Click a pet, then a cell, to
    // move it. `cells` holds the player's explicit moves; `placement` fills in any
    // un-placed pet automatically (defenders front, everyone else back).
    const [cells, setCells] = useState<Record<string, { row: number; col: number }>>({});
    const [selId, setSelId] = useState<string | null>(null);
    const placement = useMemo(() => {
        const next: Record<string, { row: number; col: number }> = {};
        const taken = new Set<string>();
        for (const p of run.roster) { const c = cells[p.id]; if (c) { next[p.id] = c; taken.add(`${c.row},${c.col}`); } }
        for (const p of run.roster) {
            if (next[p.id]) continue;
            const order = roleOf(p) === "defender" ? [0, 1, 2] : [2, 1, 0];
            let done = false;
            for (const r of order) { for (let c = 0; c < BOARD_COLS && !done; c++) if (!taken.has(`${r},${c}`)) { next[p.id] = { row: r, col: c }; taken.add(`${r},${c}`); done = true; } if (done) break; }
        }
        return next;
    }, [cells, run.roster]);
    function clickCell(r: number, c: number) {
        const occupant = run.roster.find((p) => placement[p.id]?.row === r && placement[p.id]?.col === c) ?? null;
        if (selId && selId !== occupant?.id) {
            const from = placement[selId];
            setCells((prev) => { const n = { ...prev, [selId]: { row: r, col: c } }; if (occupant && from) n[occupant.id] = from; return n; });
            setSelId(null);
        } else if (occupant) {
            setSelId((prev) => (prev === occupant.id ? null : occupant.id));
        } else {
            setSelId(null);
        }
    }
    // Enemies auto-place: defenders to the front line, everyone else to the back.
    const enemyUnits = (pets: Pet[]): GridUnit[] => { const col = [0, 0, 0]; return pets.map((pet) => { const row = roleOf(pet) === "defender" ? 0 : 2; return { pet, row, col: col[row]++ }; }); };

    function startRound() {
        const squad = applySynergiesToSquad(fielded);
        const enemy = enemySquadForRound(run);
        if (!squad.length || !enemy.length) return;
        const playerUnits: GridUnit[] = squad.map((pet) => ({ pet, row: placement[pet.id]?.row ?? 2, col: placement[pet.id]?.col ?? 0 }));
        const result = runPetGridBattle(playerUnits, enemyUnits(enemy), fightSeed(run));
        setRun(beginFight(run));
        setFight({ result, key: run.round });
    }

    // Watched the board fight → bank the result and return to drafting (or end the run).
    function resolveFight() {
        if (!fight) return;
        setRun((r) => applyRoundResult(r, fight.result.result === "win"));
        setFight(null);
    }

    function newRun() {
        setFight(null);
        setRun(startGauntletRun((Date.now() & 0x7fffffff) >>> 0));
    }

    const rosterFull = run.roster.length >= 5;
    const over = run.status === "won" || run.status === "lost";

    return (
        <section className="summary-box" style={{ marginTop: "0.2rem", display: "grid", gap: "0.9rem" }}>
            {/* Hero header — generated banner (fal Flux) under a dark gradient for text legibility. */}
            <div style={{ borderRadius: 12, padding: "22px 20px", border: "1px solid #3b2f55", backgroundImage: `linear-gradient(105deg, rgba(8,11,22,0.86), rgba(8,11,22,0.4) 70%), url(${gauntletHero})`, backgroundSize: "cover", backgroundPosition: "center 38%" }}>
                <h3 style={{ margin: 0, font: "800 1.15rem Cinzel, serif", color: "#fcd34d" }}>🗡️ Pet Gauntlet</h3>
                <p className="hint" style={{ margin: "4px 0 0" }}>
                    Draft a run-only squad from the wilds, chase element &amp; role synergies, and survive {run.maxRounds} escalating rounds.
                    Drafted pets vanish when the run ends. <em>Preview — no rewards yet.</em>
                </p>
            </div>

            {/* Run status bar */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "8px 14px", background: "rgba(15,23,42,0.55)", border: "1px solid #334155", borderRadius: 10, fontWeight: 800 }}>
                <span style={{ color: "#fca5a5" }}>{"❤".repeat(Math.max(0, run.hearts))}{"🖤".repeat(Math.max(0, 3 - run.hearts))}</span>
                <span style={{ color: "#fcd34d" }}>🪙 {run.gold}g</span>
                <span style={{ color: "#93c5fd" }}>Round {Math.min(run.round, run.maxRounds)} / {run.maxRounds}</span>
                <span style={{ marginLeft: "auto" }}><button type="button" style={btn("#475569")} onClick={newRun}>↻ New Run</button></span>
            </div>

            {over ? (
                <div style={{ textAlign: "center", padding: "1.4rem" }}>
                    <div style={{ font: "900 2rem Inter, sans-serif", color: run.status === "won" ? "#4ade80" : "#f87171" }}>
                        {run.status === "won" ? "🏆 Gauntlet Cleared!" : "Run Over"}
                    </div>
                    <p className="hint">{run.log[run.log.length - 1]}</p>
                    <button type="button" style={{ ...btn("#f59e0b"), padding: "8px 18px", fontSize: "0.9rem" }} onClick={newRun}>Start a new run</button>
                </div>
            ) : (
                <>
                    {/* Fielded squad + active synergies */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <h4 style={{ margin: 0, color: "#e2e8f0" }}>Your Formation ({fielded.length}/5)</h4>
                            <button type="button" style={btn("#f59e0b", fielded.length === 0)} disabled={fielded.length === 0} onClick={startRound}>⚔ Fight Round {run.round}</button>
                        </div>
                        {synergies.length > 0 ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                {synergies.map((s) => (
                                    <span key={s.def.key} title={`${s.def.flavor} — ${s.tier.note}`} style={{ display: "inline-flex", gap: 5, alignItems: "center", padding: "3px 9px", borderRadius: 999, background: `${s.def.color}22`, border: `1px solid ${s.def.color}`, color: s.def.color, fontWeight: 700, fontSize: "0.74rem" }}>
                                        <span>{s.def.icon}</span>{s.def.label} ×{s.count} <span style={{ opacity: 0.85 }}>· {s.tier.note}</span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="hint" style={{ margin: "0 0 8px" }}>Draft pets that share an element or role to activate a synergy.</p>
                        )}
                        {run.roster.length === 0
                            ? <p className="hint">Draft pets from the shop below to build your squad.</p>
                            : (
                                <div>
                                    <p className="hint" style={{ margin: "0 0 6px", fontSize: "0.74rem" }}>Click a pet, then a cell, to position it. The <strong style={{ color: "#fca5a5" }}>front row</strong> soaks the enemy melee; the back is protected.</p>
                                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${BOARD_COLS}, 1fr)`, gap: 6, maxWidth: 540, margin: "0 auto" }}>
                                        {Array.from({ length: BOARD_ROWS_PER_SIDE }).flatMap((_, r) =>
                                            Array.from({ length: BOARD_COLS }).map((_, c) => {
                                                const pet = run.roster.find((p) => placement[p.id]?.row === r && placement[p.id]?.col === c) ?? null;
                                                const sel = !!pet && selId === pet.id;
                                                const img = pet ? petCardImage(pet) : "";
                                                return (
                                                    <button key={`${r}-${c}`} type="button" onClick={() => clickCell(r, c)} title={r === 0 ? "Front line" : r === BOARD_ROWS_PER_SIDE - 1 ? "Back line" : "Mid line"}
                                                        style={{ aspectRatio: "1", borderRadius: 8, border: `1px solid ${sel ? "#facc15" : r === 0 ? "#7f3a3a" : "#334155"}`, background: pet ? "rgba(15,23,42,0.72)" : r === 0 ? "rgba(90,32,32,0.28)" : "rgba(30,41,59,0.4)", cursor: "pointer", padding: 2, position: "relative", display: "grid", placeItems: "center", boxShadow: sel ? "0 0 10px rgba(250,204,21,0.6)" : "none" }}>
                                                        {pet && img ? <img src={img} alt={pet.name} draggable={false} style={{ maxWidth: "100%", maxHeight: "84%", objectFit: "contain", mixBlendMode: "screen" }} /> : null}
                                                        {pet && <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: "0.6rem", color: elColor(pet.element) }}>{ROLE_META[roleOf(pet)].icon}</span>}
                                                    </button>
                                                );
                                            }),
                                        )}
                                    </div>
                                    {selId && <div style={{ textAlign: "center", marginTop: 6 }}><button type="button" style={btn("#7f1d1d")} onClick={() => { setRun(releasePet(run, selId)); setSelId(null); }}>✕ Release selected</button></div>}
                                </div>
                            )}
                    </div>

                    {/* Shop */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <h4 style={{ margin: 0, color: "#e2e8f0" }}>Recruit Shop</h4>
                            <button type="button" style={btn("#38bdf8", run.gold < GAUNTLET_REROLL_COST)} disabled={run.gold < GAUNTLET_REROLL_COST} onClick={() => setRun(rerollShop(run))}>
                                🎲 Reroll ({GAUNTLET_REROLL_COST}g)
                            </button>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {run.shop.length === 0
                                ? <p className="hint">Sold out — reroll for fresh recruits.</p>
                                : run.shop.map((offer, i) => {
                                    const blocked = run.gold < offer.cost || rosterFull;
                                    return (
                                        <PetMiniCard key={`${offer.pet.id}-${i}`} pet={offer.pet} footer={
                                            <button type="button" style={btn("#4ade80", blocked)} disabled={blocked} onClick={() => setRun(buyOffer(run, i))}>
                                                {rosterFull ? "Roster full" : `Recruit · ${offer.cost}g`}
                                            </button>
                                        } />
                                    );
                                })}
                        </div>
                    </div>

                    {/* Next opponent preview */}
                    <p className="hint" style={{ margin: 0 }}>
                        Next: {enemySquadForRound(run).map((e) => e.name).join(" + ")} ({enemySquadForRound(run)[0]?.rarity}).
                    </p>
                </>
            )}

            {/* The round fight — full-screen board auto-battle; Continue banks the result. */}
            {fight && (
                <PetBoardArena key={fight.key} result={fight.result} sharedImages={sharedImages} onDone={resolveFight} />
            )}
        </section>
    );
}
