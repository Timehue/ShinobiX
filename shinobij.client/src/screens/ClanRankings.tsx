/*
 * Clan Rankings — a server-wide leaderboard of every clan, ranked by clan-war
 * record (then clan level, then size). This is the "stakes" layer for the
 * clan-vs-clan system: wars now feed a standing every clan can see and climb,
 * instead of vanishing into each clan's private history.
 *
 * Read-only + additive: it derives wins/losses from the authoritative clan-war
 * records (/api/clan/war/list) and the clan directory (/api/clans/list). No new
 * server endpoint, no balance impact. Sized for a small server (≤100 players →
 * a few dozen clans), so a single flat board is the right shape — no tiers.
 */
import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import type { ClanData, EnhancedClanData } from "../types/clan";
import { enhanceClanData } from "../lib/clan-math";
import { cwListWars } from "../lib/clan-war-api";
import { doctrineIcon, doctrineName } from "../lib/clan-doctrines";
import { ClanImageMark } from "../components/Marks";

type RankRow = {
    clan: EnhancedClanData;
    wins: number;
    losses: number;
    draws: number;
    inWar: boolean;
};

export function ClanRankings({ character }: { character: Character }) {
    const [rows, setRows] = useState<RankRow[] | null>(null);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const [clanRes, wars] = await Promise.all([
                fetch("/api/clans/list").then(r => (r.ok ? r.json() : [])).catch(() => []),
                cwListWars(),
            ]);
            if (!alive) return;
            const clans: EnhancedClanData[] = Array.isArray(clanRes)
                ? clanRes.map(c => enhanceClanData(c as ClanData & Partial<EnhancedClanData>))
                : [];

            // Tally each clan's record from the authoritative clan-war records.
            const tally = new Map<string, { wins: number; losses: number; draws: number; inWar: boolean }>();
            const slot = (name: string) => {
                const key = name.toLowerCase();
                let t = tally.get(key);
                if (!t) { t = { wins: 0, losses: 0, draws: 0, inWar: false }; tally.set(key, t); }
                return t;
            };
            for (const w of wars) {
                for (const c of w.clans) {
                    const t = slot(c);
                    if (!w.endedAt) { t.inWar = true; continue; }
                    if (!w.winnerClan) t.draws++;
                    else if (w.winnerClan.toLowerCase() === c.toLowerCase()) t.wins++;
                    else t.losses++;
                }
            }

            const built: RankRow[] = clans.map(clan => {
                const t = tally.get(clan.name.toLowerCase());
                return { clan, wins: t?.wins ?? 0, losses: t?.losses ?? 0, draws: t?.draws ?? 0, inWar: t?.inWar ?? false };
            });
            // Wins first (war performance is the point), then level, then roster size.
            built.sort((a, b) =>
                b.wins - a.wins ||
                b.clan.level - a.clan.level ||
                b.clan.members.length - a.clan.members.length ||
                a.clan.name.localeCompare(b.clan.name));
            setRows(built);
        })();
        return () => { alive = false; };
    }, []);

    if (!rows) return <div className="summary-box"><h3>🏆 Clan Rankings</h3><p className="hint">Loading clan rankings…</p></div>;
    if (rows.length === 0) return <div className="summary-box"><h3>🏆 Clan Rankings</h3><p className="hint">No clans exist yet. Found one and be the first on the board.</p></div>;

    return (
        <div className="summary-box">
            <h3>🏆 Clan Rankings</h3>
            <p className="hint">Every clan on the server, ranked by clan-war wins, then clan level, then size. Win clan wars to climb the board.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {rows.map((row, idx) => {
                    const isMine = !!character.clan && row.clan.name === character.clan;
                    const record = `${row.wins}W · ${row.losses}L${row.draws ? ` · ${row.draws}D` : ""}`;
                    return (
                        <div key={row.clan.name} className={`clan-member-row-v2${isMine ? " clan-member-me" : ""}`}>
                            <span className="clan-member-pos">#{idx + 1}</span>
                            <ClanImageMark image={row.clan.image} name={row.clan.name} village={row.clan.village} />
                            <div className="clan-member-info">
                                <span className="clan-member-name">{row.clan.name}{isMine ? " ⭐" : ""}{row.inWar ? " 🔥" : ""}</span>
                                <span className="clan-member-sub">Lv.{row.clan.level} · {row.clan.members.length} member{row.clan.members.length === 1 ? "" : "s"} · {row.clan.village}</span>
                            </div>
                            <span
                                className="clan-rank-badge"
                                title={`${row.wins} win${row.wins === 1 ? "" : "s"} · ${row.losses} loss${row.losses === 1 ? "" : "es"} · ${row.draws} draw${row.draws === 1 ? "" : "s"}`}
                                style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", borderColor: "rgba(74,222,128,0.28)" }}
                            >
                                {record}
                            </span>
                            <span className="clan-member-sub" style={{ marginLeft: 4, whiteSpace: "nowrap" }}>{doctrineIcon(row.clan.doctrine ?? "none")} {doctrineName(row.clan.doctrine ?? "none")}</span>
                        </div>
                    );
                })}
            </div>
            <p className="hint" style={{ marginTop: 10, fontSize: "0.72rem" }}>🔥 = currently at war · ⭐ = your clan. The board updates as clan wars finish.</p>
        </div>
    );
}
