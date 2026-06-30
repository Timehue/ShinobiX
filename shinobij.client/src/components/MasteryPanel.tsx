/*
 * Profession Mastery panel (Profile → Profession section). Lets a player read
 * each specialization path and spend mastery points into it. Mastery points come
 * from profession XP earned past rank 10. Effects are PvE/utility only and are
 * applied elsewhere (Phase 3); this panel only edits character.masterySpec.
 */
import type React from "react";
import { gameConfirm } from "./GameAlert";
import type { Character } from "../types/character";
import {
    MASTERY_TREES, masteryLevel, masteryPointsAvailable, masteryPointsSpent,
    pointsInPath, canIncrement, incrementNode, masteryHasCapstone,
    activeMasteryEffects, MASTERY_RESPEC_COST, CAPSTONE_PATH_GATE, MASTERY_MAX_LEVEL,
} from "../lib/profession-mastery";

// One-line "what is this path" blurbs for the read-about-it flavor.
const PATH_BLURBS: Record<string, string> = {
    triage: "Heal faster and treat the whole ward at once.",
    restoration: "Heal harder and cheaper — full-restore patients.",
    outreach: "Extend your care across the village, any sector.",
    reaver: "Wring more Honor Seals out of every win.",
    quartermaster: "Spend Seals further — cheaper training & speedups.",
    warden: "Stamina, AI hunting, and Seal-fueled grit.",
    expeditioner: "Bigger expedition hauls — run two at once.",
    "beast-handler": "A tougher, deadlier pet in PvE.",
    trainer: "Train pets faster and smarter.",
};

export function MasteryPanel({ character, updateCharacter }: { character: Character; updateCharacter: (c: Character) => void }) {
    if (!character.profession) return null;
    const paths = MASTERY_TREES[character.profession] ?? [];
    const level = masteryLevel(character);
    const spent = masteryPointsSpent(character);
    const available = masteryPointsAvailable(character);
    const spec = character.masterySpec ?? {};

    function invest(nodeId: string) {
        const check = canIncrement(character, nodeId);
        if (!check.ok) { alert(check.reason); return; }
        updateCharacter({ ...character, masterySpec: incrementNode(character, nodeId) });
    }

    async function respec() {
        if (spent <= 0) return;
        if (character.ryo < MASTERY_RESPEC_COST) { alert(`Respec costs ${MASTERY_RESPEC_COST.toLocaleString()} ryo.`); return; }
        if (!(await gameConfirm(`Refund all mastery points for ${MASTERY_RESPEC_COST.toLocaleString()} ryo?`))) return;
        updateCharacter({ ...character, ryo: character.ryo - MASTERY_RESPEC_COST, masterySpec: {} });
    }

    return (
        <div className="mastery-panel" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0 }}>⭐ Mastery — Level {level}/{MASTERY_MAX_LEVEL}</h3>
                <span style={{ color: available > 0 ? "#facc15" : "#94a3b8", fontWeight: 700 }}>
                    {available} point{available === 1 ? "" : "s"} to spend
                </span>
            </div>
            <p className="hint" style={{ marginTop: 4 }}>
                Earn profession XP past rank 10 to gain mastery points. Specialize down one path — you can't max them all. PvE &amp; utility only.
            </p>
            {level === 0 && spent === 0 && (
                <p className="hint" style={{ color: "#94a3b8" }}>Reach rank 10 and keep earning profession XP to unlock your first mastery point.</p>
            )}

            {(() => {
                const active = activeMasteryEffects(character);
                if (active.length === 0) return null;
                return (
                    <div className="summary-box" style={{ padding: 10, marginBottom: 4, borderColor: "rgba(250,204,21,0.4)" }}>
                        <strong style={{ color: "#facc15" }}>Active bonuses</strong>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
                            {active.map((a) => <li key={a}>{a}</li>)}
                        </ul>
                    </div>
                );
            })()}

            <div style={{ display: "grid", gap: 12 }}>
                {paths.map((path) => {
                    const inPath = pointsInPath(character, path.id);
                    return (
                        <div key={path.id} className="summary-box" style={{ padding: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                <strong>{path.name}</strong>
                                <span className="hint" style={{ margin: 0 }}>{inPath} pts</span>
                            </div>
                            <p className="hint" style={{ margin: "2px 0 8px" }}>{PATH_BLURBS[path.id] ?? ""}</p>
                            <div style={{ display: "grid", gap: 6 }}>
                                {path.nodes.map((n) => {
                                    const ranks = Math.max(0, Math.floor(Number(spec[n.id] ?? 0)));
                                    const maxed = ranks >= n.maxRank;
                                    const gateLocked = !!n.capstone && inPath < CAPSTONE_PATH_GATE && !masteryHasCapstone(character, n.id);
                                    const check = canIncrement(character, n.id);
                                    return (
                                        <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 8, opacity: gateLocked ? 0.6 : 1 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600 }}>
                                                    {n.capstone ? "★ " : ""}{n.name}
                                                    <span style={{ marginLeft: 6, color: "#94a3b8", fontWeight: 400, fontSize: "0.85em" }}>
                                                        {n.capstone ? (masteryHasCapstone(character, n.id) ? "Unlocked" : `Needs ${CAPSTONE_PATH_GATE} pts in path`) : `${ranks}/${n.maxRank}`}
                                                    </span>
                                                </div>
                                                <div className="hint" style={{ margin: 0 }}>{n.desc}</div>
                                            </div>
                                            <button
                                                onClick={() => invest(n.id)}
                                                disabled={!check.ok}
                                                title={check.ok ? "" : check.reason}
                                                style={{ minWidth: 64, padding: "4px 10px" }}
                                            >
                                                {maxed ? "Maxed" : n.capstone ? `Unlock (${n.cost})` : `+1 (${n.cost})`}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {spent > 0 && (
                <button onClick={respec} style={{ marginTop: 12, padding: "6px 14px" }}>
                    Respec all ({MASTERY_RESPEC_COST.toLocaleString()} ryo)
                </button>
            )}
        </div>
    );
}
