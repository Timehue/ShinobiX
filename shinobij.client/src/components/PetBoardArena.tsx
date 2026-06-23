/*
 * PetBoardArena — the Pet Gauntlet BOARD fight view (TFT / Dota-Underlords style).
 *
 * Renders a tilted, tiled board with both squads STANDING ON the squares (their
 * 2.5D renders), not cards in rows. Plays a deterministic BoardResult
 * (lib/pet-board-sim) round-by-round: HP bars ease down, hits flash + float
 * damage, faints grey out and topple. Pure DOM/CSS (a perspective-transformed
 * grid + counter-rotated standees), so it holds a full squad and is cheap to
 * verify. Full-screen portal. Its OWN renderer — not the 2v2 PetColiseumDuel.
 *
 * Cell mapping (4 board rows): 0 = enemy back, 1 = enemy front, 2 = player front,
 * 3 = player back. So both FRONT lines meet in the middle, backs sit at the edges.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Pet } from "../types/pet";
import type { BoardResult } from "../lib/pet-board-sim";
import { petCardImage } from "../lib/pet-battle-anim";
import { ROLE_META, derivePetRole, type PetRole } from "../lib/pet-roles";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";

const ROUND_MS = 820;
const COLS = 4;            // board columns
const TILT = 42;           // board tilt in degrees
const ELEMENT_COLOR: Record<string, string> = { Fire: "#fb923c", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#facc15", Earth: "#a3a380" };
const elColor = (el?: string | null) => (el && ELEMENT_COLOR[el]) || "#94a3b8";
const roleOf = (p: Pet): PetRole => (p.role as PetRole | undefined) ?? derivePetRole(p).role;

export function PetBoardArena({ result, sharedImages = {}, onDone }: { result: BoardResult; sharedImages?: Record<string, string>; onDone: () => void }) {
    const total = result.snapshots.length;
    const [round, setRound] = useState(0);
    const done = round >= total - 1;

    useEffect(() => {
        if (done) return;
        const t = window.setTimeout(() => setRound((r) => Math.min(total - 1, r + 1)), ROUND_MS);
        return () => window.clearTimeout(t);
    }, [round, total, done]);

    const snap = result.snapshots[Math.min(round, total - 1)];
    const fx = useMemo(() => {
        const m = new Map<string, { dmg: number; flash: boolean; acted: boolean }>();
        for (const e of result.events) {
            if (e.t !== round) continue;
            if (e.targetId && e.type === "hit") {
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

    // unit → board row (0 enemy-back … 3 player-back). Clamp engine rows to 0/1.
    const boardRow = (u: BoardResult["roster"][number]) => (u.team === "enemy" ? 1 - Math.min(1, u.row) : 2 + Math.min(1, u.row));
    const unitAt = (br: number, bc: number) => result.roster.find((u) => boardRow(u) === br && u.col === bc);

    const resultLabel = result.result === "win" ? "Victory" : result.result === "loss" ? "Defeat" : "Draw";

    const standee = (u: BoardResult["roster"][number]) => {
        const s = snap.units.find((x) => x.id === u.id);
        const f = fx.get(u.id) ?? { dmg: 0, flash: false, acted: false };
        const alive = s?.alive ?? false;
        const pct = Math.max(0, Math.min(100, ((s?.hp ?? 0) / Math.max(1, s?.maxHp ?? u.pet.hp)) * 100));
        const img = petCardImage(u.pet, sharedImages);
        return (
            <div className={`bp-standee${alive ? "" : " dead"}${f.flash ? " hit" : ""}${f.acted ? " act" : ""}`} style={{ ["--el" as string]: elColor(u.pet.element) }}>
                {f.dmg > 0 && <span className="bp-dmg" key={`${round}-${f.dmg}`}>-{f.dmg}</span>}
                <div className="bp-hp"><div className="bp-hpfill" style={{ width: `${pct}%`, background: pct > 50 ? "#4ade80" : pct > 22 ? "#facc15" : "#f87171" }} /></div>
                {img ? <img src={img} alt={u.pet.name} draggable={false} /> : <span className="bp-init">{u.pet.name.slice(0, 2).toUpperCase()}</span>}
                <span className="bp-tag" style={{ color: elColor(u.pet.element) }}>{ROLE_META[roleOf(u.pet)].icon}</span>
            </div>
        );
    };

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", display: "grid", placeItems: "center", backgroundImage: `linear-gradient(rgba(8,11,20,0.48), rgba(8,11,20,0.74)), url(${gauntletHero})`, backgroundSize: "cover", backgroundPosition: "center" }}>
            <style>{`
                .bp-stage { perspective: 1700px; perspective-origin: 50% 46%; }
                .bp-board { transform: rotateX(${TILT}deg); transform-style: preserve-3d; display: grid; grid-template-columns: repeat(${COLS}, 168px); grid-template-rows: repeat(4, 122px); gap: 8px; box-shadow: 0 40px 90px rgba(0,0,0,0.6); }
                .bp-cell { position: relative; border-radius: 4px; border: 1px solid rgba(148,163,184,0.16); }
                .bp-cell.enemy { background: rgba(80,30,30,0.34); }
                .bp-cell.enemy.dark { background: rgba(60,22,22,0.5); }
                .bp-cell.player { background: rgba(30,52,82,0.34); }
                .bp-cell.player.dark { background: rgba(22,38,64,0.5); }
                .bp-cell.mid { box-shadow: inset 0 0 0 1px rgba(250,204,21,0.12); }
                /* Stand the sprite UP out of the tilted tile, anchored at the tile's near edge. */
                .bp-standee { position: absolute; left: 50%; bottom: 8px; width: 150px; transform: translateX(-50%) rotateX(-${TILT}deg); transform-origin: bottom center; text-align: center; transition: opacity .35s, filter .35s; z-index: 2; }
                .bp-standee.dead { opacity: 0.22; filter: grayscale(1); }
                .bp-standee.hit { animation: bpHit .34s ease-out; }
                .bp-standee.act { animation: bpAct .34s ease-out; }
                @keyframes bpHit { 0%{transform:translateX(-50%) rotateX(-${TILT}deg)} 25%{transform:translateX(-58%) rotateX(-${TILT}deg)} 60%{transform:translateX(-44%) rotateX(-${TILT}deg)} 100%{transform:translateX(-50%) rotateX(-${TILT}deg)} }
                @keyframes bpAct { 0%{filter:none} 40%{filter:drop-shadow(0 0 10px var(--el))} 100%{filter:none} }
                .bp-standee img { width: 148px; height: 168px; object-fit: contain; object-position: bottom; display: block; margin: 0 auto; filter: drop-shadow(0 8px 7px rgba(0,0,0,.75)); }
                .bp-init { display: inline-block; height: 168px; line-height: 168px; font: 800 36px Inter, sans-serif; color: #cbd5e1; }
                .bp-hp { height: 8px; width: 124px; margin: 0 auto 4px; border-radius: 999px; background: #0b1220; overflow: hidden; border: 1px solid #00000066; }
                .bp-hpfill { height: 100%; border-radius: 999px; transition: width .5s ease-out; }
                .bp-tag { position: absolute; right: 2px; bottom: 2px; font-size: 13px; filter: drop-shadow(0 1px 2px #000); }
                .bp-dmg { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); font: 900 18px Inter, sans-serif; color: #fecaca; text-shadow: 0 2px 5px #000; animation: bpDmg .8s ease-out forwards; }
                @keyframes bpDmg { 0%{opacity:0; transform:translate(-50%,4px)} 20%{opacity:1} 100%{opacity:0; transform:translate(-50%,-20px)} }
            `}</style>

            <div style={{ position: "absolute", top: "6%", left: 0, right: 0, textAlign: "center", color: "#fcd34d", font: "800 clamp(15px,2.4vw,22px) Cinzel, serif", textShadow: "0 2px 8px #000" }}>
                ⚔️ Round {Math.min(round, result.rounds)} / {result.rounds}
            </div>

            <div className="bp-stage">
                <div className="bp-board">
                    {Array.from({ length: 4 }).flatMap((_, br) =>
                        Array.from({ length: COLS }).map((_, bc) => {
                            const u = unitAt(br, bc);
                            const side = br < 2 ? "enemy" : "player";
                            const mid = br === 1 || br === 2;
                            return (
                                <div key={`${br}-${bc}`} className={`bp-cell ${side}${(br + bc) % 2 ? " dark" : ""}${mid ? " mid" : ""}`} style={{ zIndex: br + 1 }}>
                                    {u && standee(u)}
                                </div>
                            );
                        }),
                    )}
                </div>
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
