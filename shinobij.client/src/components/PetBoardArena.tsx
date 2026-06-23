/*
 * PetBoardArena — the Pet Gauntlet BOARD fight view (TFT / Super-Auto-Pets style).
 *
 * Plays a deterministic BoardResult (lib/pet-board-sim) as two lineups of 2.5D-render
 * unit cards facing off — front (slot 0) toward the centre. It steps through the
 * round-by-round snapshot stream (HP bars ease down) and fires the event stream as
 * transient juice: hits flash + shake + float a damage number, abilities pop, faints
 * grey out and topple. Pure DOM/CSS so it natively holds a full squad of N units and
 * is cheap to verify. Full-screen portal, like the duel — but its OWN renderer, not
 * the 2v2-capped PetColiseumDuel.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Pet } from "../types/pet";
import type { BoardResult } from "../lib/pet-board-sim";
import { petCardImage } from "../lib/pet-battle-anim";
import { ROLE_META, derivePetRole, type PetRole } from "../lib/pet-roles";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";

const ROUND_MS = 820;   // per-round playback pacing
const ELEMENT_COLOR: Record<string, string> = { Fire: "#fb923c", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#facc15", Earth: "#a3a380" };
const elColor = (el?: string | null) => (el && ELEMENT_COLOR[el]) || "#94a3b8";
const roleOf = (p: Pet): PetRole => (p.role as PetRole | undefined) ?? derivePetRole(p).role;

function UnitCard({ pet, hp, maxHp, shield, alive, dmg, flash, acted, sharedImages }: {
    pet: Pet; hp: number; maxHp: number; shield: number; alive: boolean; dmg: number; flash: boolean; acted: boolean; sharedImages: Record<string, string>;
}) {
    const role = roleOf(pet);
    const img = petCardImage(pet, sharedImages);
    const pct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    return (
        <div className={`bp-unit${alive ? "" : " bp-dead"}${flash ? " bp-hit" : ""}${acted ? " bp-act" : ""}`}
            style={{ border: `1px solid ${elColor(pet.element)}88`, boxShadow: acted ? `0 0 14px ${elColor(pet.element)}` : undefined }}>
            {dmg > 0 && <span className="bp-dmg" key={`d${dmg}-${hp}`}>-{dmg}</span>}
            {shield > 0 && <span className="bp-shield">🛡 {shield}</span>}
            <div className="bp-portrait">
                {img ? <img src={img} alt={pet.name} draggable={false} /> : <span className="bp-initials">{pet.name.slice(0, 2).toUpperCase()}</span>}
            </div>
            <div className="bp-hpbar"><div className="bp-hpfill" style={{ width: `${pct}%`, background: pct > 50 ? "#4ade80" : pct > 22 ? "#facc15" : "#f87171" }} /></div>
            <div className="bp-name"><span style={{ color: elColor(pet.element) }}>{ROLE_META[role].icon}</span> {pet.name}</div>
        </div>
    );
}

export function PetBoardArena({ result, sharedImages = {}, onDone }: { result: BoardResult; sharedImages?: Record<string, string>; onDone: () => void }) {
    const total = result.snapshots.length;
    const [round, setRound] = useState(0);
    const done = round >= total - 1;   // derived — the last snapshot has been reached

    useEffect(() => {
        if (done) return;
        const t = window.setTimeout(() => setRound((r) => Math.min(total - 1, r + 1)), ROUND_MS);
        return () => window.clearTimeout(t);
    }, [round, total, done]);

    const snap = result.snapshots[Math.min(round, total - 1)];
    // Per-unit transient state for THIS round: damage taken, hit flash, acted.
    const fx = useMemo(() => {
        const m = new Map<string, { dmg: number; flash: boolean; acted: boolean }>();
        for (const e of result.events) {
            if (e.t !== round) continue;
            if (e.targetId && (e.type === "hit")) {
                const cur = m.get(e.targetId) ?? { dmg: 0, flash: false, acted: false };
                cur.dmg += e.dmg ?? 0; cur.flash = true; m.set(e.targetId, cur);
            }
            if (e.actorId && (e.type === "attack" || e.type === "ability")) {
                const cur = m.get(e.actorId) ?? { dmg: 0, flash: false, acted: false };
                cur.acted = true; m.set(e.actorId, cur);
            }
        }
        return m;
    }, [result.events, round]);

    const cardFor = (u: BoardResult["roster"][number]) => {
        const s = snap.units.find((x) => x.id === u.id);
        const f = fx.get(u.id) ?? { dmg: 0, flash: false, acted: false };
        return <UnitCard key={u.id} pet={u.pet} hp={s?.hp ?? 0} maxHp={s?.maxHp ?? u.pet.hp} shield={s?.shield ?? 0} alive={s?.alive ?? false} dmg={f.dmg} flash={f.flash} acted={f.acted} sharedImages={sharedImages} />;
    };
    const cellsFor = (team: "player" | "enemy", row: number) =>
        result.roster.filter((u) => u.team === team && u.row === row).sort((a, b) => a.col - b.col);
    const resultLabel = result.result === "win" ? "Victory" : result.result === "loss" ? "Defeat" : "Draw";

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", display: "grid", gridTemplateRows: "1fr auto 1fr", placeItems: "center", backgroundImage: `linear-gradient(rgba(6,8,16,0.78), rgba(6,8,16,0.9)), url(${gauntletHero})`, backgroundSize: "cover", backgroundPosition: "center" }}>
            <style>{`
                .bp-side { display: flex; flex-direction: column; gap: 8px; align-items: center; }
                .bp-row { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; align-items: flex-end; padding: 4px 14px; min-height: 8px; }
                .bp-row.back { transform: scale(0.84); opacity: 0.9; }
                .bp-unit { position: relative; width: 104px; border-radius: 12px; background: rgba(12,17,30,0.82); padding: 8px 8px 9px; text-align: center; transition: opacity .35s, transform .35s, filter .35s; }
                .bp-unit.bp-dead { opacity: 0.28; filter: grayscale(1); transform: translateY(8px) rotate(-7deg); }
                .bp-unit.bp-hit { animation: bpHit .34s ease-out; }
                .bp-unit.bp-act { animation: bpAct .34s ease-out; }
                @keyframes bpHit { 0%{transform:translateX(0)} 20%{transform:translateX(-5px)} 45%{transform:translateX(5px)} 70%{transform:translateX(-3px)} 100%{transform:translateX(0)} }
                @keyframes bpAct { 0%{transform:translateY(0) scale(1)} 40%{transform:translateY(-8px) scale(1.06)} 100%{transform:translateY(0) scale(1)} }
                .bp-portrait { height: 78px; display: grid; place-items: center; }
                .bp-portrait img { max-height: 78px; max-width: 96px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,.6)); }
                .bp-initials { font: 800 26px Inter, sans-serif; color: #cbd5e1; }
                .bp-hpbar { height: 7px; border-radius: 999px; background: #0b1220; overflow: hidden; margin: 5px 2px 4px; border: 1px solid #00000055; }
                .bp-hpfill { height: 100%; border-radius: 999px; transition: width .5s ease-out; }
                .bp-name { font: 700 11px Inter, sans-serif; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .bp-dmg { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font: 900 18px Inter, sans-serif; color: #fca5a5; text-shadow: 0 2px 5px #000; animation: bpDmg .8s ease-out forwards; pointer-events: none; }
                @keyframes bpDmg { 0%{opacity:0; transform:translate(-50%,4px)} 20%{opacity:1} 100%{opacity:0; transform:translate(-50%,-22px)} }
                .bp-shield { position: absolute; top: 2px; right: 4px; font: 700 10px Inter, sans-serif; color: #bfdbfe; }
            `}</style>

            <div className="bp-side">
                <div className="bp-row back">{cellsFor("enemy", 1).map(cardFor)}</div>
                <div className="bp-row front">{cellsFor("enemy", 0).map(cardFor)}</div>
            </div>

            <div style={{ textAlign: "center", color: "#fcd34d", font: "800 clamp(15px,2.4vw,22px) Cinzel, serif", textShadow: "0 2px 8px #000" }}>
                ⚔️ Round {Math.min(round, result.rounds)} / {result.rounds}
            </div>

            <div className="bp-side">
                <div className="bp-row front">{cellsFor("player", 0).map(cardFor)}</div>
                <div className="bp-row back">{cellsFor("player", 1).map(cardFor)}</div>
            </div>

            {done && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 40px Inter, sans-serif", color: resultLabel === "Victory" ? "#4ade80" : resultLabel === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{resultLabel}</div>
                        <button onClick={onDone} style={{ marginTop: 14, padding: "9px 22px", borderRadius: 10, border: "1px solid #475569", background: "#f59e0b", color: "#0b1220", font: "800 0.95rem Inter, sans-serif", cursor: "pointer" }}>Continue →</button>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
