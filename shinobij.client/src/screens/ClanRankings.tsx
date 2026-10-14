// Season and lifetime standings derive from the protected campaign prestige on clan records.
import { useEffect, useState } from "react";
import { GameIcon } from "../components/icons/GameIcon";
import type { Character } from "../types/character";
import type { ClanData, EnhancedClanData } from "../types/clan";
import { enhanceClanData } from "../lib/clan-math";
import { cwListWars } from "../lib/clan-war-api";
import { doctrineName } from "../lib/clan-doctrines";
import { DoctrineCrest } from "../components/DoctrineCrest";
import { ClanImageMark } from "../components/Marks";
import { GameArtIcon } from "../components/GameArtIcon";
import {clanCampaignStandings} from '../../../shared/clan-campaign-standings';
import {clanCampaignSeasonKey} from '../../../shared/clan-campaign-history';

type RankRow = {
    clan: EnhancedClanData;
    wins: number;
    losses: number;
    draws: number;
    inWar: boolean;
    points:number;rank:number;
};

export function ClanRankings({ character }: { character: Character }) {
    const [rows, setRows] = useState<RankRow[] | null>(null);
    const [period,setPeriod]=useState<'season'|'lifetime'>('season');
    const [error,setError]=useState('');
    const [season,setSeason]=useState(()=>clanCampaignSeasonKey(Date.now()));
    const [loadedPeriod,setLoadedPeriod]=useState<'season'|'lifetime'|null>(null);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const [clanRes, wars] = await Promise.all([
                fetch("/api/clans/list").then(r => {if(!r.ok)throw new Error('Clan standings could not load. Reopen Rankings to retry.');return r.json();}),
                cwListWars(),
            ]);
            if (!alive) return;
            const clans: EnhancedClanData[] = Array.isArray(clanRes)
                ? clanRes.map(c => enhanceClanData(c as ClanData & Partial<EnhancedClanData>))
                : [];

            // Current war rows supply only the live campaign marker.
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
                    if (!w.endedAt) t.inWar = true;
                }
            }

            const standings=clanCampaignStandings(clans,period,Date.now());
            const built: RankRow[] = standings.map(standing => {
                const clan=clans.find(entry=>entry.name===standing.name)!;
                const t = tally.get(clan.name.toLowerCase());
                return {clan,...standing,inWar:t?.inWar??false};
            });
            setRows(built);
            setSeason(clanCampaignSeasonKey(Date.now()));setLoadedPeriod(period);setError('');
        })().catch(error=>{if(alive)setError(error instanceof Error?error.message:'Clan standings could not load.');});
        return () => { alive = false; };
    }, [period]);

    if(error)return <div className="summary-box"><h3>Clan Rankings</h3><p role="alert">{error}</p></div>;
    if (!rows||loadedPeriod!==period) return <div className="summary-box"><h3><GameIcon name="medal" size={16} style={{ verticalAlign: "-2px", color: "var(--sj-gold)" }} /> Clan Rankings</h3><p className="hint">Loading clan rankings…</p></div>;
    if (rows.length === 0) return <div className="summary-box"><h3><GameIcon name="medal" size={16} style={{ verticalAlign: "-2px", color: "var(--sj-gold)" }} /> Clan Rankings</h3><p className="hint">No clans exist yet. Found one and be the first on the board.</p></div>;

    return (
        <div className="summary-box">
            <h3><GameIcon name="medal" size={16} style={{ verticalAlign: "-2px", color: "var(--sj-gold)" }} /> Clan Rankings</h3>
            <p className="hint">{period==='season'?season:'Lifetime campaigns'} · 3 prestige per played victory, 1 per draw. Ties share a rank. Service cancellations and empty campaigns earn no prestige.</p>
            <div className="menu"><button aria-pressed={period==='season'} onClick={()=>setPeriod('season')}>Current season</button><button aria-pressed={period==='lifetime'} onClick={()=>setPeriod('lifetime')}>Campaign lifetime</button></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {rows.map((row) => {
                    const isMine = !!character.clan && row.clan.name === character.clan;
                    const record = `${row.wins}W · ${row.losses}L${row.draws ? ` · ${row.draws}D` : ""}`;
                    return (
                        <div key={row.clan.name} className={`clan-member-row-v2${isMine ? " clan-member-me" : ""}`}>
                            <span className="clan-member-pos">#{row.rank}</span>
                            <ClanImageMark image={row.clan.image} name={row.clan.name} village={row.clan.village} frame={!!row.clan.campaignPrestige?.earnedBanners?.length} />
                            <div className="clan-member-info">
                                <span className="clan-member-name">{row.clan.name}{isMine ? " · YOUR CLAN" : ""}{row.inWar ? " · AT WAR" : ""}</span>
                                <span className="clan-member-sub">Lv.{row.clan.level} · {row.clan.members.length} member{row.clan.members.length === 1 ? "" : "s"} · {row.clan.village}</span>
                            </div>
                            <span
                                className="clan-rank-badge"
                                title={`${row.wins} win${row.wins === 1 ? "" : "s"} · ${row.losses} loss${row.losses === 1 ? "" : "es"} · ${row.draws} draw${row.draws === 1 ? "" : "s"}`}
                                style={{ background: "rgba(74,222,128,0.1)", color: "var(--green-400)", borderColor: "rgba(74,222,128,0.28)" }}
                            >
                                {row.points} prestige · {record}
                            </span>
                            <span className="clan-member-sub" style={{ marginLeft: 4, whiteSpace: "nowrap" }}><DoctrineCrest doctrine={row.clan.doctrine ?? "none"} size={18} /> {doctrineName(row.clan.doctrine ?? "none")}</span>
                        </div>
                    );
                })}
            </div>
            <p className="hint" style={{ marginTop: 10, fontSize: "0.72rem" }}><GameArtIcon kind="attack" size={14} /> At-war clans are marked. The board updates as clan wars finish.</p>
        </div>
    );
}
