import { useCallback, useEffect, useMemo, useState } from "react";
import { starterJutsus } from "../data/jutsu";
import { LEGACY_JUTSU_BY_ID } from "../data/legacy-jutsu";
import { starterItems } from "../data/starter-items";
import { eventItems } from "../data/event-items";

// Diagnostics → Combat Balance. Live usage and win rates per jutsu,
// bloodline, weapon and AI profile, from real settled fights
// (api/_combat-usage.ts). Read-only apart from the full-admin reset.

type Mode = "ranked" | "pvp" | "pve" | "tower" | "clan-boss";
type Kind = "jutsu" | "bloodline" | "weapon" | "ai";
type Counts = { equipped: number; used: number; win: number; loss: number; draw: number; fled: number };
type Aggregate = { since: number; updatedAt: number; fights: number } & Record<Kind, Record<string, Counts>>;
type SortKey = "equipped" | "winRate" | "castRate";

const MODES: Array<{ id: Mode; label: string }> = [
    { id: "ranked", label: "Ranked (equal stats)" },
    { id: "pvp", label: "Open PvP" },
    { id: "pve", label: "Solo PvE" },
    { id: "tower", label: "Towers & Spire" },
    { id: "clan-boss", label: "Clan Boss" },
];
/** Towers and the Clan Boss keep no cast history, so Cast% is unknown there. */
const CAST_TRACKED: ReadonlySet<Mode> = new Set(["ranked", "pvp", "pve"]);
const KINDS: Array<{ id: Kind; label: string }> = [
    { id: "jutsu", label: "Jutsu" },
    { id: "bloodline", label: "Bloodlines" },
    { id: "weapon", label: "Weapons" },
    { id: "ai", label: "AI profiles" },
];

const NAMES: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const j of starterJutsus) out[j.id] = j.name;
    for (const [id, j] of LEGACY_JUTSU_BY_ID) out[id] = j.name;
    for (const i of [...starterItems, ...eventItems]) out[i.id] = i.name;
    return out;
})();

function outcomes(c: Counts): number {
    return c.win + c.loss + c.draw + c.fled;
}
function winRate(c: Counts): number {
    const n = outcomes(c);
    return n ? c.win / n : 0;
}
function pct(x: number): string {
    return `${Math.round(x * 100)}%`;
}

const box = { border: "1px solid #334", borderRadius: 6, padding: 10, marginTop: 10 } as const;
const cell = { padding: "4px 8px", borderBottom: "1px solid #223", textAlign: "right" as const };

export function AdminCombatUsagePanel({ adminPw, canReset = false }: { adminPw: string; canReset?: boolean }) {
    const [mode, setMode] = useState<Mode>("ranked");
    const [kind, setKind] = useState<Kind>("jutsu");
    const [sort, setSort] = useState<SortKey>("equipped");
    const [minFights, setMinFights] = useState(5);
    const [data, setData] = useState<Aggregate | null>(null);
    const [status, setStatus] = useState("");
    const [confirmReset, setConfirmReset] = useState(false);

    const load = useCallback(async () => {
        setStatus("Loading…");
        try {
            const res = await fetch(`/api/admin/combat-usage?mode=${mode}`, { headers: { "x-admin-password": adminPw } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setStatus(String(body.error ?? `HTTP ${res.status}`)); return; }
            setData(body.usage ?? null);
            setStatus("");
        } catch {
            setStatus("Network error.");
        }
    }, [adminPw, mode]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);

    async function reset() {
        setStatus("Resetting…");
        try {
            const res = await fetch(`/api/admin/combat-usage?mode=${mode}`, { method: "DELETE", headers: { "x-admin-password": adminPw } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setStatus(String(body.error ?? `HTTP ${res.status}`)); return; }
            setConfirmReset(false);
            await load();
        } catch {
            setStatus("Network error.");
        }
    }

    const rows = useMemo(() => {
        const table = data?.[kind] ?? {};
        return Object.entries(table)
            .filter(([, c]) => outcomes(c) >= minFights)
            .sort(([, a], [, b]) => {
                if (sort === "winRate") return winRate(b) - winRate(a);
                if (sort === "castRate") return (b.used / Math.max(1, b.equipped)) - (a.used / Math.max(1, a.equipped));
                return b.equipped - a.equipped;
            });
    }, [data, kind, sort, minFights]);

    return (
        <div>
            <p style={{ color: "#9aa", fontSize: "0.85rem" }}>
                Counted from real settled fights. <b>Win%</b> is the win rate of fighters who brought it; <b>Cast%</b> is how often it was
                actually used when brought (jutsu only; Towers and the Clan Boss don't record casts). Ranked fights use equal stats, so
                they are the cleanest balance signal. For AI profiles, Win% is the AI's win rate against players; a run that ran out of
                rounds counts as a draw.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label>Mode <select value={mode} onChange={(e) => { const next = e.target.value as Mode; setMode(next); if (!CAST_TRACKED.has(next) && sort === "castRate") setSort("equipped"); }}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
                <label>Show <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
                <label>Sort <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    <option value="equipped">Most brought</option>
                    <option value="winRate">Highest win%</option>
                    {CAST_TRACKED.has(mode) && <option value="castRate">Highest cast%</option>}
                </select></label>
                <label>Min fights <select value={minFights} onChange={(e) => setMinFights(Number(e.target.value))}>{[1, 5, 10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <button type="button" onClick={() => void load()}>Refresh</button>
                {status && <span style={{ color: "#f88" }}>{status}</span>}
            </div>
            {!data && !status && <div style={box}>No fights counted in this mode yet.</div>}
            {data && (
                <div style={box}>
                    <div style={{ color: "#9aa", fontSize: "0.8rem" }}>
                        {data.fights.toLocaleString()} fights since {new Date(data.since).toLocaleString()} · updated {new Date(data.updatedAt).toLocaleString()}
                    </div>
                    {rows.length === 0 ? <p style={{ color: "#9aa" }}>Nothing with at least {minFights} fights yet.</p> : (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem", marginTop: 6 }}>
                                <thead><tr>
                                    <th style={{ ...cell, textAlign: "left" }}>Name</th>
                                    <th style={cell}>Brought</th>
                                    {kind === "jutsu" && CAST_TRACKED.has(mode) && <th style={cell}>Cast%</th>}
                                    <th style={cell}>Win%</th>
                                    <th style={cell}>W / L / D / Fled</th>
                                </tr></thead>
                                <tbody>{rows.map(([id, c]) => (
                                    <tr key={id}>
                                        <td style={{ ...cell, textAlign: "left" }}>{NAMES[id] ?? id}{NAMES[id] && <small style={{ color: "#778", marginLeft: 6 }}>{id}</small>}</td>
                                        <td style={cell}>{c.equipped.toLocaleString()}</td>
                                        {kind === "jutsu" && CAST_TRACKED.has(mode) && <td style={cell}>{pct(c.used / Math.max(1, c.equipped))}</td>}
                                        <td style={cell}>{pct(winRate(c))}</td>
                                        <td style={cell}>{c.win} / {c.loss} / {c.draw} / {c.fled}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    )}
                    {/* Resetting needs full admin (the server enforces it too). */}
                    {canReset && <div style={{ marginTop: 10 }}>
                        {confirmReset ? (
                            <span>
                                Start counting {MODES.find((m) => m.id === mode)?.label} from zero? Do this right after a rebalance.{" "}
                                <button type="button" onClick={() => void reset()}>Reset counts</button>{" "}
                                <button type="button" onClick={() => setConfirmReset(false)}>Cancel</button>
                            </span>
                        ) : (
                            <button type="button" onClick={() => setConfirmReset(true)}>Reset this mode</button>
                        )}
                    </div>}
                </div>
            )}
        </div>
    );
}
