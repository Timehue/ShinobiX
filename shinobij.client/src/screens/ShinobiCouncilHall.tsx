/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect } from "react";
import type { Character, PlayerRecord } from "../types/character";
import type { Screen } from "../types/core";
import { ClanBattlesTab } from "./ClanBattlesTab";
import { VillagePill } from "../components/Pills";
import { clanContribTotal, enhanceClanData } from "../lib/clan-math";
import { fetchClanData } from "../lib/clan-api";
import { villages } from "../data/sectors";
import { type CwChallenge } from "../lib/clan-war-api";
import {
} from "../App";
import { loadVillageState, loadVillageWar, VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX, type KageHistoryEntry, type VillageWar } from "../lib/world-state";

export function ShinobiCouncilHall({ character, setScreen, playerRoster, launchClanWarBattle }: { character: Character; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[]; launchClanWarBattle: (ch: CwChallenge, warId?: string) => void }) {
    const [tab, setTab] = useState<"wars" | "clanBattles" | "kage">("wars");

    // --- Village Wars ---
    const allVillagePairs: [string, string][] = [];
    for (let i = 0; i < villages.length; i++)
        for (let j = i + 1; j < villages.length; j++)
            allVillagePairs.push([villages[i], villages[j]]);

    const activeVillageWars = allVillagePairs
        .map(([a, b]) => loadVillageWar(a, b))
        .filter((w): w is VillageWar => w !== null && !w.endedAt);

    function topContributorForVillage(village: string): string {
        const players = playerRoster.filter(p => p.village === village);
        if (!players.length) return "—";
        const top = [...players].sort((a, b) =>
            ((b.character.totalVillageRaids ?? 0) + (b.character.clanBattleContrib ?? 0)) -
            ((a.character.totalVillageRaids ?? 0) + (a.character.clanBattleContrib ?? 0))
        )[0];
        return top.name;
    }

    // --- Clan Wars ---
    const [clanWars, setClanWars] = useState<{ clanA: string; clanB: string; scoreA: number; scoreB: number; villageA: string; villageB: string; endsAt: number; topA: string; topB: string }[]>([]);
    const [clanWarsLoading, setClanWarsLoading] = useState(true);

    useEffect(() => {
        const uniqueClans = [...new Set(playerRoster.map(p => p.character.clan).filter(Boolean))] as string[];
        if (!uniqueClans.length) { setClanWarsLoading(false); return; }
        const seen = new Set<string>();
        Promise.all(uniqueClans.map(name => fetchClanData(name))).then(results => {
            const wars: typeof clanWars = [];
            for (const data of results) {
                if (!data) continue;
                const enhanced = enhanceClanData(data);
                if (!enhanced.activeWar) continue;
                const key = [enhanced.name, enhanced.activeWar.opponentClan].sort().join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                const membersA = enhanced.members;
                const topA = membersA.length
                    ? [...membersA].sort((a, b) => clanContribTotal(b) - clanContribTotal(a))[0]?.name ?? "—"
                    : "—";
                wars.push({
                    clanA: enhanced.name,
                    clanB: enhanced.activeWar.opponentClan,
                    scoreA: enhanced.activeWar.ourScore,
                    scoreB: enhanced.activeWar.enemyScore,
                    villageA: enhanced.village,
                    villageB: enhanced.activeWar.enemyVillage,
                    endsAt: enhanced.activeWar.endsAt,
                    topA,
                    topB: "—",
                });
            }
            setClanWars(wars);
            setClanWarsLoading(false);
        });
    }, []);

    // --- Kage History ---
    const allKageHistory: KageHistoryEntry[] = villages.flatMap(v => {
        const state = loadVillageState(v);
        const history = state.kageHistory ?? [];
        // If seatedKage has no history entry yet, synthesize one
        if (state.seatedKage && !history.some(e => e.name === state.seatedKage)) {
            history.push({ name: state.seatedKage, village: v, seatedAt: state.kageSystemUnlocked ? Date.now() - 1 : Date.now() });
        }
        return history;
    });
    // Sort: current Kages first (no endedAt), then by seatedAt desc
    const sortedKageHistory = [...allKageHistory].sort((a, b) => {
        if (!a.endedAt && b.endedAt) return -1;
        if (a.endedAt && !b.endedAt) return 1;
        return b.seatedAt - a.seatedAt;
    });

    function formatDuration(ms: number): string {
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        if (days > 0) return `${days}d ${hours}h`;
        const mins = Math.floor((ms % 3600000) / 60000);
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    function HpBar({ current, max, color }: { current: number; max: number; color: string }) {
        const pct = Math.max(0, Math.min(100, (current / max) * 100));
        return (
            <div className="council-hp-track">
                <div className="council-hp-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
        );
    }

    return (
        <div className="card council-screen">
            <div className="council-header">
                <button className="back-button" onClick={() => setScreen("centralHub")}>← Central Hub</button>
                <div>
                    <h2>🏛️ Shinobi Council Hall</h2>
                    <p className="council-subtitle">Live war status and the eternal record of village leaders.</p>
                </div>
            </div>

            <div className="council-tabs">
                <button className={`council-tab ${tab === "wars" ? "council-tab-active" : ""}`} onClick={() => setTab("wars")}>⚔️ Active Wars</button>
                <button className={`council-tab ${tab === "clanBattles" ? "council-tab-active" : ""}`} onClick={() => setTab("clanBattles")}>🏴 Clan Battles</button>
                <button className={`council-tab ${tab === "kage" ? "council-tab-active" : ""}`} onClick={() => setTab("kage")}>👑 Kage Records</button>
            </div>

            {tab === "wars" && <><section className="council-section">
                <h3 className="council-section-title">⚔️ Village Wars</h3>
                {activeVillageWars.length === 0
                    ? <p className="council-empty">No active village wars. The world is at peace.</p>
                    : activeVillageWars.map(war => {
                        const [vA, vB] = war.villages;
                        const hpA = war.hp[vA] ?? 0;
                        const hpB = war.hp[vB] ?? 0;
                        const topA = topContributorForVillage(vA);
                        const topB = topContributorForVillage(vB);
                        return (
                            <div key={war.id} className="council-war-card">
                                <div className="council-vs-row">
                                    <div className={`council-side ${character.village === vA ? "council-mine" : ""}`}>
                                        <VillagePill village={vA} highlight={character.village === vA} />
                                        <span className="council-hp-label">{hpA.toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</span>
                                        <HpBar current={hpA} max={VILLAGE_WAR_HP_MAX} color="#22c55e" />
                                        <span className="council-top">🏆 {topA}</span>
                                    </div>
                                    <div className="council-vs">VS</div>
                                    <div className={`council-side council-side-right ${character.village === vB ? "council-mine" : ""}`}>
                                        <VillagePill village={vB} highlight={character.village === vB} />
                                        <span className="council-hp-label">{hpB.toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</span>
                                        <HpBar current={hpB} max={VILLAGE_WAR_HP_MAX} color="#ef4444" />
                                        <span className="council-top">🏆 {topB}</span>
                                    </div>
                                </div>
                                <div className="council-war-meta">
                                    War Ground: Sector {war.warGroundSector} · Ground HP {war.warGroundHp.toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()}
                                    {war.capturedBy ? ` · Captured by ${war.capturedBy}` : ""}
                                </div>
                            </div>
                        );
                    })
                }
            </section>

            <section className="council-section">
                <h3 className="council-section-title">⚔️ Clan Wars</h3>
                {clanWarsLoading
                    ? <p className="council-empty">Loading clan wars…</p>
                    : clanWars.length === 0
                        ? <p className="council-empty">No active clan wars.</p>
                        : clanWars.map(cw => {
                            const totalMax = Math.max(cw.scoreA + cw.scoreB, 1);
                            return (
                                <div key={`${cw.clanA}-${cw.clanB}`} className="council-war-card">
                                    <div className="council-vs-row">
                                        <div className={`council-side ${character.clan === cw.clanA ? "council-mine" : ""}`}>
                                            <span className="council-village-name">{cw.clanA}</span>
                                            <span className="council-hp-label">{cw.villageA} · {cw.scoreA.toLocaleString()} pts</span>
                                            <HpBar current={cw.scoreA} max={totalMax} color="#a78bfa" />
                                            <span className="council-top">🏆 {cw.topA}</span>
                                        </div>
                                        <div className="council-vs">VS</div>
                                        <div className={`council-side council-side-right ${character.clan === cw.clanB ? "council-mine" : ""}`}>
                                            <span className="council-village-name">{cw.clanB}</span>
                                            <span className="council-hp-label">{cw.villageB} · {cw.scoreB.toLocaleString()} pts</span>
                                            <HpBar current={cw.scoreB} max={totalMax} color="#fb923c" />
                                            <span className="council-top">🏆 {cw.topB}</span>
                                        </div>
                                    </div>
                                    <div className="council-war-meta">
                                        Ends {new Date(cw.endsAt).toLocaleString()}
                                    </div>
                                </div>
                            );
                        })
                }
            </section></>}

            {tab === "clanBattles" && <ClanBattlesTab character={character} playerRoster={playerRoster} setScreen={setScreen} launchClanWarBattle={launchClanWarBattle} />}

            {tab === "kage" && <section className="council-section">
                <h3 className="council-section-title">👑 Kage Records — All Villages</h3>
                {sortedKageHistory.length === 0
                    ? <p className="council-empty">No Kage have been seated yet. Defeat your village's story boss to open the Kage system.</p>
                    : sortedKageHistory.map((entry, i) => {
                        const isActive = !entry.endedAt;
                        const duration = isActive ? Date.now() - entry.seatedAt : (entry.endedAt! - entry.seatedAt);
                        const isMe = entry.name === character.name;
                        return (
                            <div key={`${entry.name}-${entry.village}-${i}`} className={`council-kage-row ${isMe ? "council-kage-me" : ""} ${isActive ? "council-kage-active" : ""}`}>
                                <div className="council-kage-seal">👑</div>
                                <div className="council-kage-info">
                                    <span className="council-kage-name">{entry.name}</span>
                                    <VillagePill village={entry.village} highlight={entry.village === character.village} />
                                </div>
                                <div className="council-kage-tenure">
                                    {isActive
                                        ? <span className="council-kage-current">⭐ Current Kage</span>
                                        : <span className="council-kage-former">Former</span>
                                    }
                                    <span className="council-kage-time">
                                        {isActive ? `${formatDuration(duration)} in office` : `Served ${formatDuration(duration)}`}
                                    </span>
                                    <span className="council-kage-date">
                                        {isActive
                                            ? `Since ${new Date(entry.seatedAt).toLocaleDateString()}`
                                            : `${new Date(entry.seatedAt).toLocaleDateString()} – ${new Date(entry.endedAt!).toLocaleDateString()}`
                                        }
                                    </span>
                                </div>
                            </div>
                        );
                    })
                }
            </section>}
        </div>
    );
}

// ── ClanBattlesTab ──────────────────────────────────────────────────
// New server-managed clan-war system. Lives inside Shinobi Council
// Hall as a dedicated tab. Owns its own polling loop + state; the
// parent only needs to mount it.
// ── Clan-war PvP tile-card duel screen ──────────────────────────────
// Server-managed Triple-Triad-style 3x3 duel. Both players' decks +
// the board live in cw-tilecards:<challengeId> on the server. This
// component polls /api/clan/war/tilecards?action=state every 1.5s,
// renders the board + the current player's hand, submits placements
// via action=move, and detects game-end. The server applies HP damage
// to the parent clan war atomically with the game-ending move, so no
// manual report is ever called from here.
