/*
 * Profile → "Battles" tab: your last ~10 fights, each expandable into its full
 * color-coded combat log so you can go back and reflect on what happened. Reads
 * the capped, save-synced `character.battleHistory` (types/character.ts) and
 * renders each action with the same owner-attributed BattleActionBlock the live
 * arena/PvP logs use, so a replay reads exactly like the real thing.
 */
import { useMemo, useState } from "react";
import type { BattleHistoryAction, BattleHistoryEntry, Character } from "../types/character";
import { BattleActionBlock } from "./BattleActionBlock";
import type { BattleLogAction } from "../lib/battle-log-format";

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 0 || !Number.isFinite(diff)) return "";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

const OUTCOME_LABEL: Record<BattleHistoryEntry["outcome"], string> = {
    win: "Victory",
    loss: "Defeat",
    draw: "Draw",
    flee: "Fled",
};

/** Group a battle's flat action list into rounds for the accordion. */
function groupByRound(actions: BattleHistoryAction[]): { round: number; actions: BattleHistoryAction[] }[] {
    const rounds: { round: number; actions: BattleHistoryAction[] }[] = [];
    for (const a of actions) {
        const last = rounds[rounds.length - 1];
        if (last && last.round === a.round) last.actions.push(a);
        else rounds.push({ round: a.round, actions: [a] });
    }
    return rounds;
}

function BattleCard({ battle }: { battle: BattleHistoryEntry }) {
    const [open, setOpen] = useState(false);
    const rounds = useMemo(() => groupByRound(battle.actions ?? []), [battle.actions]);
    return (
        <div className={`bh-card bh-outcome-${battle.outcome}`}>
            <button type="button" className="bh-card-header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                <span className="bh-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
                <span className={`bh-badge bh-badge-${battle.outcome}`}>{OUTCOME_LABEL[battle.outcome]}</span>
                <span className="bh-vs">vs <strong>{battle.opponent || "—"}</strong></span>
                <span className="bh-mode">{battle.mode}</span>
                <span className="bh-meta">{battle.rounds} rd · {relativeTime(battle.ts)}</span>
            </button>
            {open && (
                <div className="bh-log combat-timeline">
                    {rounds.length === 0 ? (
                        <p className="bh-empty-log">No log was recorded for this battle.</p>
                    ) : rounds.map((group) => (
                        <section className="timeline-round open" key={group.round}>
                            <div className="timeline-round-header">
                                <span>Round {group.round}</span>
                                <span className="timeline-round-count">{group.actions.length}</span>
                            </div>
                            {group.actions.map((a, i) => (
                                <BattleActionBlock
                                    key={i}
                                    action={a as BattleLogAction}
                                    selfName={battle.self}
                                    oppName={battle.opponent}
                                />
                            ))}
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}

export function BattleLogHistoryPanel({ character }: { character: Character }) {
    const battles = character.battleHistory ?? [];
    return (
        <section className="battle-history-panel">
            <div className="profile-page-header">
                <div>
                    <h2>Battle Logs</h2>
                    <p>Your last {battles.length || ""} fights — tap one to re-read the combat log.</p>
                </div>
            </div>
            {battles.length === 0 ? (
                <div className="bh-empty">
                    <p>⚔️ No battles yet.</p>
                    <small>Fight in the arena, missions, or PvP and your recent battles will appear here to reflect on.</small>
                </div>
            ) : (
                <div className="bh-list">
                    {battles.map((b) => <BattleCard key={b.id} battle={b} />)}
                </div>
            )}
        </section>
    );
}
