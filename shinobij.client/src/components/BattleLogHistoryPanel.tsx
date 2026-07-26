/*
 * Profile → "Battles" tab: your recent fights, each openable as a full record.
 *
 * Two sources, deliberately:
 *   • the DURABLE server index (/api/pvp/combat-history) is authoritative for
 *     PvP — it survives the 15-minute session TTL, a refresh, and signing in on
 *     another device, and opens the full read-only BattleLogScreen;
 *   • the save-embedded `character.battleHistory` remains the fallback for local
 *     PvE fights (which have no receipts) and for when the server is
 *     unreachable, expanding inline the way it always has.
 *
 * mergeBattleHistory dedupes the two by battleId, preferring the server row.
 * The fetch is deliberately lazy — it fires when this tab mounts, not on
 * every profile render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/battle-skin.css";
import type { BattleHistoryAction, BattleHistoryEntry, Character } from "../types/character";
import { BattleActionBlock } from "./BattleActionBlock";
import type { BattleLogAction } from "../lib/battle-log-format";
import { fetchBattleHistory, isAbort } from "../lib/pvp-combat-log-api";
import { mergeBattleHistory } from "../lib/battle-history-merge";
import type { BattleHistorySummary } from "../types/battle-log";

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

const OUTCOME_FROM_SUMMARY: Record<BattleHistorySummary["outcome"], string> = {
    win: "Victory",
    loss: "Defeat",
    draw: "Draw",
    flee: "Fled",
};

/** A durable server battle — opens the full read-only record. */
function ServerBattleCard({
    summary,
    onOpen,
}: {
    summary: BattleHistorySummary;
    onOpen?: (battleId: string) => void;
}) {
    return (
        <button
            type="button"
            className={`bh-card bh-card-server bh-outcome-${summary.outcome}`}
            onClick={() => onOpen?.(summary.battleId)}
            disabled={!onOpen}
        >
            <span className="bh-card-header">
                <span className={`bh-badge bh-badge-${summary.outcome}`}>{OUTCOME_FROM_SUMMARY[summary.outcome]}</span>
                <span className="bh-vs">vs <strong>{summary.opponent || "—"}</strong></span>
                <span className="bh-mode">{summary.mode}</span>
                <span className="bh-meta">{summary.rounds} rd · {relativeTime(summary.endedAt)}</span>
                {onOpen && <span className="bh-open-hint" aria-hidden="true">View record ›</span>}
            </span>
        </button>
    );
}

export function BattleLogHistoryPanel({
    character,
    onOpenBattle,
}: {
    character: Character;
    /** Opens the durable BattleLogScreen. Omitted → server rows render inert. */
    onOpenBattle?: (battleId: string) => void;
}) {
    const legacy = useMemo(() => character.battleHistory ?? [], [character.battleHistory]);
    const [server, setServer] = useState<BattleHistorySummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);
    const abortRef = useRef<AbortController | null>(null);

    // Fires on mount — i.e. when the Battles tab is actually opened, since the
    // parent only mounts this panel then.
    useEffect(() => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        // No synchronous setState here — see BattleLogScreen for the same pattern.
        (async () => {
            try {
                const res = await fetchBattleHistory({ signal: ac.signal });
                if (ac.signal.aborted) return;
                if (!res.ok) {
                    // Keep the legacy list visible; the save copy is still useful.
                    setError(res.message);
                    setLoading(false);
                    return;
                }
                setError(null);
                setServer(res.entries);
                setLoading(false);
            } catch (err) {
                if (isAbort(err)) return;
                setError("Could not load your server battle history.");
                setLoading(false);
            }
        })();
        return () => ac.abort();
    }, [nonce]);

    const rows = useMemo(() => mergeBattleHistory(server, legacy), [server, legacy]);
    const retry = useCallback(() => { setLoading(true); setError(null); setNonce((n) => n + 1); }, []);

    return (
        <section className="battle-history-panel">
            <div className="profile-page-header">
                <div>
                    <h2>Battle Logs</h2>
                    <p>Your recent fights — open one to re-read the full combat record.</p>
                </div>
            </div>

            {loading && rows.length === 0 && <p className="bh-state" role="status">Loading your battles…</p>}

            {error && (
                <div className="bh-state bh-error" role="alert">
                    <p>{error}</p>
                    <button type="button" className="bh-retry" onClick={retry}>Retry</button>
                    {legacy.length > 0 && <small>Showing locally saved battles in the meantime.</small>}
                </div>
            )}

            {!loading && rows.length === 0 ? (
                <div className="bh-empty">
                    <p>⚔️ No battles yet.</p>
                    <small>Fight in the arena, missions, or PvP and your recent battles will appear here to reflect on.</small>
                </div>
            ) : (
                <div className="bh-list">
                    {rows.map((row) => (
                        row.kind === "server"
                            ? <ServerBattleCard key={`s:${row.battleId}`} summary={row.summary} onOpen={onOpenBattle} />
                            : <BattleCard key={`l:${row.entry.id}`} battle={row.entry} />
                    ))}
                </div>
            )}
        </section>
    );
}
