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
import { useEffect, useMemo, useRef, useState } from "react";
import type { Pet } from "../types/pet";
import type { Character } from "../types/character";
import { runPetGridBattle, BOARD_COLS, BOARD_ROWS_PER_SIDE, type BoardResult, type GridUnit } from "../lib/pet-board-sim";
import {
    startGauntletRun, buyOffer, buyItem, buyRelic, rerollShop, releasePet, fieldedPets,
    enemySquadForRound, beginFight, applyRoundResult, applyGauntletBuffs, relicDef, hasFreeReroll, boardModsFromRelics,
    GAUNTLET_REROLL_COST, GAUNTLET_ITEMS, GAUNTLET_RELICS, GAUNTLET_START_HEARTS, itemCost,
    type GauntletRun,
} from "../lib/pet-gauntlet";
import { startGauntlet, reportGauntlet, type GauntletReward } from "../lib/pet-gauntlet-api";
import { resolveSynergies, applySynergiesToSquad } from "../lib/pet-synergies";
import { petCardImage } from "../lib/pet-battle-anim";
import { ROLE_META, derivePetRole, type PetRole } from "../lib/pet-roles";
import { PetBoardArena } from "./PetBoardArena";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";
import gauntletBoard from "../assets/coliseum/gauntlet-board.webp";

// Relic icon art (gpt-image-1, transparent). Auto-resolved by filename
// (`<relicId>.webp`); falls back to the relic def's emoji when an image is absent.
const RELIC_ART = import.meta.glob<{ default: string }>("../assets/coliseum/relics/*.webp", { eager: true });
const relicArt = (id: string): string | null => RELIC_ART[`../assets/coliseum/relics/${id}.webp`]?.default ?? null;
// Shopkeeper banner art (gpt-image-1). Optional — the shop still renders without it.
const SHOP_ART = import.meta.glob<{ default: string }>("../assets/coliseum/gauntlet-shop.webp", { eager: true });
const gauntletShop = SHOP_ART["../assets/coliseum/gauntlet-shop.webp"]?.default ?? null;
// The shopkeeper's rotating greeting (deterministic per round → no flicker).
const NPC_LINES = [
    "Welcome, challenger! Spend your Valor wisely — the Gauntlet spares no one.",
    "Fresh recruits and rare relics, straight off the caravan.",
    "A wise shinobi builds a squad, not just a hero.",
    "Relics rotate each round — give the shelf a reroll if nothing catches your eye.",
    "Low on hearts? A Field Medic never goes to waste.",
    "Stack your synergies and the board all but wins itself.",
    "Survive deep enough and the Ryo flows. Now — what'll it be?",
];

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

export function PetGauntlet({ sharedImages = {}, character, updateCharacter }: { sharedImages?: Record<string, string>; character: Character; updateCharacter: (c: Character) => void }) {
    // run is null until the server hands back the weekly seed + run token.
    const [run, setRun] = useState<GauntletRun | null>(null);
    const [meta, setMeta] = useState<{ token: string; weekKey: string; rewardEligible: boolean } | null>(null);
    const [reward, setReward] = useState<GauntletReward | null>(null);   // shown on the end screen
    const reportedRef = useRef(false);                                   // report the finished run exactly once
    const shopRef = useRef<HTMLDivElement>(null);                        // "🛒 Shop" button scroll target
    // The active fight: the precomputed board result the board renderer plays.
    const [fight, setFight] = useState<{ result: BoardResult; key: number } | null>(null);
    // Latest character for the (single, async) reward credit — avoids a stale closure.
    const charRef = useRef(character);
    useEffect(() => { charRef.current = character; }, [character]);

    const fielded = useMemo(() => (run ? fieldedPets(run) : []), [run]);
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
        const roster = run?.roster ?? [];
        for (const p of roster) { const c = cells[p.id]; if (c) { next[p.id] = c; taken.add(`${c.row},${c.col}`); } }
        for (const p of roster) {
            if (next[p.id]) continue;
            const order = roleOf(p) === "defender" ? [0, 1, 2] : [2, 1, 0];
            let done = false;
            for (const r of order) { for (let c = 0; c < BOARD_COLS && !done; c++) if (!taken.has(`${r},${c}`)) { next[p.id] = { row: r, col: c }; taken.add(`${r},${c}`); done = true; } if (done) break; }
        }
        return next;
    }, [cells, run]);

    // Start a fresh run on the WEEKLY shared seed (so the leaderboard is fair) +
    // mint a single-use reward token. Falls back to a local seed (unrewarded) if
    // the server is unreachable, so the mode is always playable.
    // Loading the run is keyed on `nonce` so the "New Run" button can re-trigger it
    // by bumping the nonce. All setState lives in the async continuation (after the
    // await), never synchronously in the effect body.
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        let alive = true;
        void (async () => {
            const s = await startGauntlet();
            if (!alive) return;
            setMeta(s ? { token: s.runToken, weekKey: s.weekKey, rewardEligible: s.rewardEligible } : null);
            setCells({});
            setSelId(null);
            setFight(null);
            setReward(null);
            reportedRef.current = false;
            setRun(startGauntletRun(s ? s.seed : ((Date.now() & 0x7fffffff) >>> 0)));
        })();
        return () => { alive = false; };
    }, [nonce]);

    // When a run ends, report it once → the server pays Ryo (sealed schedule) and
    // returns the credited amount + weekly rank, which we mirror onto the local
    // character (reconcile pattern). No-op (no rewards) when offline / no token.
    useEffect(() => {
        if (!run || !meta || reportedRef.current) return;
        if (run.status !== "won" && run.status !== "lost") return;
        reportedRef.current = true;
        const { token } = meta;
        const rc = run.roundsCleared;
        const hl = run.hearts;
        void (async () => {
            const rep = await reportGauntlet(token, rc, hl);
            if (!rep) return;
            setReward(rep);
            if (rep.ryo > 0) { const c = charRef.current; updateCharacter({ ...c, ryo: (c.ryo ?? 0) + rep.ryo }); }
        })();
    }, [run, meta, updateCharacter]);

    if (!run) {
        return <section className="summary-box" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Entering the weekly Gauntlet…</section>;
    }
    // Non-null alias: TS keeps the guard's narrowing here at top level, but not
    // inside the nested function declarations below — close over `activeRun`.
    const activeRun: GauntletRun = run;

    function clickCell(r: number, c: number) {
        const occupant = activeRun.roster.find((p) => placement[p.id]?.row === r && placement[p.id]?.col === c) ?? null;
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
    // The next opponent's formation, shown across the top of the placement board so
    // you can counter-position (deterministic per round; the real fight uses it too).
    const enemyPreview = enemyUnits(enemySquadForRound(activeRun));

    function startRound() {
        const squad = applySynergiesToSquad(applyGauntletBuffs(fielded, activeRun.buffs));
        const enemy = enemySquadForRound(activeRun);
        if (!squad.length || !enemy.length) return;
        const playerUnits: GridUnit[] = squad.map((pet) => ({ pet, row: placement[pet.id]?.row ?? 2, col: placement[pet.id]?.col ?? 0 }));
        const result = runPetGridBattle(playerUnits, enemyUnits(enemy), fightSeed(activeRun), { playerMods: boardModsFromRelics(activeRun.relics) });
        setRun(beginFight(activeRun));
        setFight({ result, key: activeRun.round });
    }

    // Watched the board fight → bank the result and return to drafting (or end the run).
    function resolveFight() {
        if (!fight) return;
        const won = fight.result.result === "win";
        setRun((r) => (r ? applyRoundResult(r, won) : r));
        setFight(null);
    }

    const newRun = () => { setRun(null); setNonce((n) => n + 1); };

    const rosterFull = run.roster.length >= 5;
    const over = run.status === "won" || run.status === "lost";
    const rerollCost = hasFreeReroll(run.relics) && run.rerolls === 0 ? 0 : GAUNTLET_REROLL_COST;

    return (
        <section className="summary-box" style={{ marginTop: "0.2rem", display: "grid", gap: "0.9rem" }}>
            {/* Hero header — generated banner (fal Flux) under a dark gradient for text legibility. */}
            <div style={{ borderRadius: 12, padding: "22px 20px", border: "1px solid #3b2f55", backgroundImage: `linear-gradient(105deg, rgba(8,11,22,0.86), rgba(8,11,22,0.4) 70%), url(${gauntletHero})`, backgroundSize: "cover", backgroundPosition: "center 38%" }}>
                <h3 style={{ margin: 0, font: "800 1.15rem Cinzel, serif", color: "#fcd34d" }}>🗡️ Pet Gauntlet</h3>
                <p className="hint" style={{ margin: "4px 0 0" }}>
                    Draft a run-only squad from the wilds, chase element &amp; role synergies, and survive {run.maxRounds} escalating rounds.
                    Drafted pets vanish when the run ends — but clearing rounds pays <strong style={{ color: "#fcd34d" }}>Ryo</strong>, and
                    everyone runs the <strong style={{ color: "#c4b5fd" }}>same weekly gauntlet</strong> for the Hall of Legends board.
                    {meta && !meta.rewardEligible && <em style={{ color: "#fca5a5" }}> · Daily Ryo cap reached — this run is for the leaderboard.</em>}
                </p>
            </div>

            {/* Run status bar */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "8px 14px", background: "rgba(15,23,42,0.55)", border: "1px solid #334155", borderRadius: 10, fontWeight: 800 }}>
                <span style={{ color: "#fca5a5" }}>{"❤".repeat(Math.max(0, run.hearts))}{"🖤".repeat(Math.max(0, GAUNTLET_START_HEARTS - run.hearts))}</span>
                <span title="Valor — the Gauntlet's run-only shop currency (not your Ryo)" style={{ color: "#fcd34d" }}>✦ {run.valor} Valor</span>
                <span style={{ color: "#93c5fd" }}>Round {Math.min(run.round, run.maxRounds)} / {run.maxRounds}</span>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                    {!over && <button type="button" style={btn("#a855f7")} onClick={() => shopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>🛒 Shop</button>}
                    <button type="button" style={btn("#475569")} onClick={newRun}>↻ New Run</button>
                </span>
            </div>

            {over ? (
                <div style={{ textAlign: "center", padding: "1.4rem" }}>
                    <div style={{ font: "900 2rem Inter, sans-serif", color: run.status === "won" ? "#4ade80" : "#f87171" }}>
                        {run.status === "won" ? "🏆 Gauntlet Cleared!" : "Run Over"}
                    </div>
                    <p className="hint">{run.log[run.log.length - 1]}</p>
                    <p className="hint" style={{ margin: "2px 0 10px" }}>Cleared {run.roundsCleared} / {run.maxRounds} rounds.</p>
                    {reward ? (
                        <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, padding: "10px 18px", margin: "0 auto 12px", borderRadius: 12, background: "rgba(120,53,15,0.3)", border: "1px solid rgba(250,204,21,0.5)" }}>
                            <span style={{ font: "800 1.1rem Inter, sans-serif", color: "#fcd34d" }}>{reward.ryo > 0 ? `+${reward.ryo.toLocaleString()} Ryo` : "No Ryo this run"}</span>
                            <span className="hint" style={{ fontSize: "0.78rem" }}>Weekly score {reward.score.toLocaleString()}{reward.rank ? ` · rank #${reward.rank}` : ""} · see the Hall of Legends → Gauntlet board</span>
                        </div>
                    ) : (
                        <p className="hint" style={{ fontSize: "0.74rem", opacity: 0.75 }}>Tallying the result…</p>
                    )}
                    <div><button type="button" style={{ ...btn("#f59e0b"), padding: "8px 18px", fontSize: "0.9rem" }} onClick={newRun}>Run the weekly Gauntlet again</button></div>
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
                                    <p className="hint" style={{ margin: "0 0 6px", fontSize: "0.74rem" }}>Click a pet, then a cell on <strong style={{ color: "#93c5fd" }}>your side</strong> (bottom), to position it — this is the board you'll fight on. Your front line meets the enemy's in the middle.</p>
                                    <div style={{ maxWidth: 560, margin: "0 auto", borderRadius: 12, border: "1px solid #3b2f55", padding: 7, backgroundImage: `linear-gradient(rgba(8,11,20,0.32), rgba(8,11,20,0.32)), url(${gauntletBoard})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                                        <div style={{ fontSize: "0.64rem", fontWeight: 700, color: "#fca5a5", letterSpacing: "0.08em", margin: "0 0 3px 2px" }}>ENEMY</div>
                                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${BOARD_COLS}, 1fr)`, gap: 5 }}>
                                            {Array.from({ length: BOARD_ROWS_PER_SIDE * 2 }).flatMap((_, gr) =>
                                                Array.from({ length: BOARD_COLS }).map((_, c) => {
                                                    if (gr < BOARD_ROWS_PER_SIDE) {
                                                        // Enemy half (top): front toward centre = bottom of this block.
                                                        const eu = enemyPreview.find((u) => u.row === (BOARD_ROWS_PER_SIDE - 1 - gr) && u.col === c);
                                                        const eimg = eu ? petCardImage(eu.pet) : "";
                                                        return (
                                                            <div key={`e${gr}-${c}`} style={{ aspectRatio: "1", borderRadius: 6, border: "1px solid rgba(220,90,90,0.26)", background: "rgba(80,25,25,0.22)", position: "relative", display: "grid", placeItems: "center", opacity: 0.72 }}>
                                                                {eu && eimg ? <img src={eimg} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "82%", objectFit: "contain", mixBlendMode: "screen", transform: "scaleX(-1)" }} /> : null}
                                                            </div>
                                                        );
                                                    }
                                                    // Your half (bottom): front toward centre = top of this block.
                                                    const pRow = gr - BOARD_ROWS_PER_SIDE;
                                                    const pet = run.roster.find((p) => placement[p.id]?.row === pRow && placement[p.id]?.col === c) ?? null;
                                                    const sel = !!pet && selId === pet.id;
                                                    const img = pet ? petCardImage(pet) : "";
                                                    return (
                                                        <button key={`p${gr}-${c}`} type="button" onClick={() => clickCell(pRow, c)} title={pRow === 0 ? "Front line" : pRow === BOARD_ROWS_PER_SIDE - 1 ? "Back line" : "Mid line"}
                                                            style={{ aspectRatio: "1", borderRadius: 6, border: `1px solid ${sel ? "#facc15" : "rgba(96,165,250,0.42)"}`, background: pet ? "rgba(15,23,42,0.5)" : "rgba(30,52,82,0.3)", cursor: "pointer", padding: 2, position: "relative", display: "grid", placeItems: "center", boxShadow: sel ? "0 0 10px rgba(250,204,21,0.7)" : "none" }}>
                                                            {pet && img ? <img src={img} alt={pet.name} draggable={false} style={{ maxWidth: "100%", maxHeight: "82%", objectFit: "contain", mixBlendMode: "screen" }} /> : null}
                                                            {pet && <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: "0.58rem", color: elColor(pet.element) }}>{ROLE_META[roleOf(pet)].icon}</span>}
                                                        </button>
                                                    );
                                                }),
                                            )}
                                        </div>
                                        <div style={{ fontSize: "0.64rem", fontWeight: 700, color: "#93c5fd", letterSpacing: "0.08em", margin: "3px 0 0 2px", textAlign: "right" }}>YOU</div>
                                    </div>
                                    {selId && <div style={{ textAlign: "center", marginTop: 6 }}><button type="button" style={btn("#7f1d1d")} onClick={() => { setRun(releasePet(run, selId)); setSelId(null); }}>✕ Release selected</button></div>}
                                </div>
                            )}
                    </div>

                    {/* Shopkeeper banner — the scroll target for the 🛒 Shop button */}
                    <div ref={shopRef} style={{ borderRadius: 12, padding: "14px 16px", border: "1px solid #3b2f55", backgroundImage: gauntletShop ? `linear-gradient(90deg, rgba(8,11,22,0.88), rgba(8,11,22,0.3) 62%), url(${gauntletShop})` : "linear-gradient(90deg, rgba(30,18,52,0.9), rgba(15,23,42,0.6))", backgroundSize: "cover", backgroundPosition: "center 28%", scrollMarginTop: 12 }}>
                        <strong style={{ color: "#fcd34d", font: "800 1rem Cinzel, serif" }}>🛒 The Beastmaster's Bazaar</strong>
                        <p className="hint" style={{ margin: "4px 0 0", fontStyle: "italic", color: "#e7d9b0", maxWidth: 470 }}>“{NPC_LINES[(run.round - 1) % NPC_LINES.length]}”</p>
                    </div>

                    {/* Shop */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <h4 style={{ margin: 0, color: "#e2e8f0" }}>Recruit Shop</h4>
                            <button type="button" style={btn("#38bdf8", run.valor < rerollCost)} disabled={run.valor < rerollCost} onClick={() => setRun(rerollShop(run))}>
                                🎲 Reroll ({rerollCost === 0 ? "free" : `${rerollCost}✦`})
                            </button>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {run.shop.length === 0
                                ? <p className="hint">Sold out — reroll for fresh recruits.</p>
                                : run.shop.map((offer, i) => {
                                    const blocked = run.valor < offer.cost || rosterFull;
                                    return (
                                        <PetMiniCard key={`${offer.pet.id}-${i}`} pet={offer.pet} footer={
                                            <button type="button" style={btn("#4ade80", blocked)} disabled={blocked} onClick={() => setRun(buyOffer(run, i))}>
                                                {rosterFull ? "Roster full" : `Recruit · ${offer.cost}✦`}
                                            </button>
                                        } />
                                    );
                                })}
                        </div>
                    </div>

                    {/* Item shop — Valor consumables that buff the whole run */}
                    <div>
                        <h4 style={{ margin: "0 0 6px", color: "#e2e8f0" }}>Quartermaster <span className="hint" style={{ fontWeight: 400, fontSize: "0.74rem" }}>· run-wide upgrades</span></h4>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {GAUNTLET_ITEMS.map((def) => {
                                const owned = run.itemsBought[def.id] ?? 0;
                                const maxed = owned >= def.max;
                                const atFullHearts = def.id === "mend" && run.hearts >= GAUNTLET_START_HEARTS;
                                const cost = itemCost(def, owned);
                                const blocked = maxed || atFullHearts || run.valor < cost;
                                const label = maxed ? "Maxed" : atFullHearts ? "Full ❤" : `Buy · ${cost}✦`;
                                return (
                                    <div key={def.id} style={{ border: "1px solid #334155", borderRadius: 10, background: "rgba(15,23,42,0.6)", padding: "8px 10px", width: 150 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <strong style={{ fontSize: "0.84rem", color: "#e2e8f0" }}>{def.icon} {def.name}</strong>
                                            {def.max > 1 && <span style={{ fontSize: "0.64rem", color: "#64748b" }}>{owned}/{def.max}</span>}
                                        </div>
                                        <p className="hint" style={{ margin: "3px 0 6px", fontSize: "0.7rem", minHeight: 28 }}>{def.blurb}</p>
                                        <button type="button" style={btn("#f59e0b", blocked)} disabled={blocked} onClick={() => setRun(buyItem(run, def.id))}>{label}</button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Relics — permanent run-long boons, bought with Valor (rolled shelf + owned strip) */}
                    <div>
                        <h4 style={{ margin: "0 0 6px", color: "#e2e8f0" }}>Relics <span className="hint" style={{ fontWeight: 400, fontSize: "0.74rem" }}>· permanent run-long boons · a fresh selection from {GAUNTLET_RELICS.length} relics rotates in each round (reroll for more)</span></h4>
                        {run.relics.length > 0 && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                {run.relics.map((id) => { const d = relicDef(id); const art = relicArt(id); return (
                                    <span key={id} title={d.blurb} style={{ display: "inline-flex", gap: 5, alignItems: "center", padding: "3px 9px", borderRadius: 999, background: "rgba(168,85,247,0.16)", border: "1px solid #a855f7", color: "#d8b4fe", fontWeight: 700, fontSize: "0.74rem" }}>
                                        {art ? <img src={art} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} /> : <span>{d.icon}</span>}{d.name}
                                    </span>
                                ); })}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {run.relicShop.length === 0
                                ? <p className="hint">No relics on offer — reroll to seek new boons.</p>
                                : run.relicShop.map((id) => { const d = relicDef(id); const blocked = run.valor < d.cost; const art = relicArt(id); return (
                                    <div key={id} style={{ border: "1px solid #6d28d9", borderRadius: 10, background: "rgba(30,18,52,0.6)", padding: "8px 10px", width: 170 }}>
                                        <strong style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: "#e9d5ff" }}>
                                            {art ? <img src={art} alt="" style={{ width: 28, height: 28, objectFit: "contain", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }} /> : <span>{d.icon}</span>}
                                            {d.name}
                                        </strong>
                                        <p className="hint" style={{ margin: "3px 0 6px", fontSize: "0.7rem", minHeight: 28 }}>{d.blurb}</p>
                                        <button type="button" style={btn("#a855f7", blocked)} disabled={blocked} onClick={() => setRun(buyRelic(run, id))}>Buy · {d.cost}✦</button>
                                    </div>
                                ); })}
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
