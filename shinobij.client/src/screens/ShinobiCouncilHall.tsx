/* eslint-disable react-hooks/purity */
import { useState, useEffect } from "react";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import { GiGreekTemple, GiCrossedSwords, GiBlackFlag, GiCrown, GiTrophy } from "react-icons/gi";
const SCH_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import type { Character, PlayerRecord } from "../types/character";
import type { Screen } from "../types/core";
import { ClanBattlesTab } from "./ClanBattlesTab";
import { VillagePill } from "../components/Pills";
import { villages } from "../data/sectors";
import { type CwChallenge, type CwWar } from "../lib/clan-war-api";
import { VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX, type VillageWar } from "../lib/world-state";
import { type ServerKageState, type ServerKageHistoryEntry, KAGE_END_REASON_LABEL } from "../lib/kage-challenge-state";
import { visiblePoll } from "../lib/poll";
import { CW_DAMAGE } from "../constants/clan";
import { CentralDestinationHeader } from "../components/CentralDestinationHeader";
import councilHallHero from "../assets/council-hall-command-v2.webp";

function CouncilHpBar({ current, max, color }: { current: number; max: number; color: string }) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    return (
        <div className="council-hp-track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={current}>
            <div className="council-hp-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
    );
}

export function ShinobiCouncilHall({ character, setScreen, playerRoster, launchClanWarBattle, onBack }: { character: Character; setScreen: (s: Screen) => void; playerRoster: PlayerRecord[]; launchClanWarBattle: (ch: CwChallenge, warId?: string) => void; onBack: () => void }) {
    const [tab, setTab] = useState<"wars" | "clanBattles" | "kage">("wars");
    // Server-owned Kage state per village (authoritative reign history), fetched
    // when the Kage Records tab opens. Replaces the old client-synthesized,
    // per-viewer Date.now() history.
    const [kageStates, setKageStates] = useState<Record<string, ServerKageState>>({});

    // --- Village Wars ---
    const [activeVillageWars, setActiveVillageWars] = useState<VillageWar[]>([]);
    const [warLoadError, setWarLoadError] = useState("");

    useEffect(() => {
        let alive = true;
        async function refreshVillageWars() {
            try {
                const response = await fetch("/api/world-state");
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json() as { wars?: VillageWar[] };
                if (!alive) return;
                setActiveVillageWars((data.wars ?? []).filter(war => !war.endedAt));
                setWarLoadError("");
            } catch {
                if (alive) setWarLoadError("Live village-war data is temporarily unavailable.");
            }
        }
        void refreshVillageWars();
        const stop = visiblePoll(refreshVillageWars, 15_000);
        return () => { alive = false; stop(); };
    }, []);

    function topContributorForVillage(war: VillageWar, village: string): string {
        const top = Object.values(war.contributions ?? {})
            .filter(entry => entry.side === village)
            .sort((a, b) => b.damage - a.damage || b.pvpKills - a.pvpKills || b.raids - a.raids)[0];
        return top ? `${top.name} · ${top.damage.toLocaleString()} dmg` : "—";
    }

    // --- Clan Wars ---
    const [clanWars, setClanWars] = useState<CwWar[]>([]);
    const [clanWarsLoading, setClanWarsLoading] = useState(true);
    const [clanWarsError, setClanWarsError] = useState("");

    useEffect(() => {
        let alive = true;
        async function refreshClanWars() {
            try {
                const response = await fetch("/api/clan/war/list");
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json() as { wars?: CwWar[] };
                if (!Array.isArray(data.wars)) throw new Error("Malformed clan-war response");
                if (!alive) return;
                setClanWars(data.wars.filter(war => !war.endedAt));
                setClanWarsError("");
            } catch {
                if (alive) setClanWarsError("Live clan-war data is temporarily unavailable.");
            } finally {
                if (alive) setClanWarsLoading(false);
            }
        }
        void refreshClanWars();
        const stop = visiblePoll(refreshClanWars, 15_000);
        return () => { alive = false; stop(); };
    }, []);

    function topContributorForClan(war: CwWar, clan: string): string {
        const tallies = new Map<string, { wins: number; damage: number }>();
        for (const challenge of war.completedChallenges) {
            if (challenge.status !== "completed" || !challenge.result || challenge.result === "draw") continue;
            const won = (challenge.result === "from-wins" && challenge.fromClan === clan)
                || (challenge.result === "to-wins" && challenge.fromClan !== clan);
            if (!won) continue;
            const winners = challenge.fromClan === clan
                ? [challenge.fromPlayer, challenge.fromPlayer2]
                : [challenge.acceptedPlayer, challenge.acceptedPlayer2];
            for (const name of winners.filter((entry): entry is string => Boolean(entry))) {
                const current = tallies.get(name) ?? { wins: 0, damage: 0 };
                current.wins += 1;
                current.damage += CW_DAMAGE[challenge.mode];
                tallies.set(name, current);
            }
        }
        const top = [...tallies.entries()].sort(([, a], [, b]) => b.wins - a.wins || b.damage - a.damage)[0];
        return top ? `${top[0]} · ${top[1].wins} win${top[1].wins === 1 ? "" : "s"}` : "—";
    }

    // Fetch the authoritative Kage state for every village when the tab opens.
    useEffect(() => {
        if (tab !== "kage") return;
        let alive = true;
        Promise.all(villages.map(v =>
            fetch(`/api/village/kage?village=${encodeURIComponent(v)}`)
                .then(r => r.ok ? r.json() : null)
                .then((s: ServerKageState | null) => [v, s] as const)
                .catch(() => [v, null] as const)
        )).then(entries => {
            if (!alive) return;
            const map: Record<string, ServerKageState> = {};
            for (const [v, s] of entries) if (s) map[v] = s;
            setKageStates(map);
        });
        return () => { alive = false; };
    }, [tab]);

    // --- Kage History (server-owned) ---
    const allKageHistory: ServerKageHistoryEntry[] = villages.flatMap(v => {
        const s = kageStates[v];
        if (!s) return [];
        const history = (s.history ?? []).map(e => ({ ...e, village: e.village || v }));
        // Display-only fallback for a legacy pre-history seated Kage: use the
        // server's OWN seatedAt/unlockedAt timestamp — never Date.now() — and do
        // not persist it. Once the seat next changes, real history takes over.
        if (s.seatedKage && !history.some(e => !e.endedAt && e.name === s.seatedKage)) {
            history.push({ name: s.seatedKage, village: v, seatedAt: s.seatedAt ?? s.unlockedAt ?? 0, defenseCount: s.defenseCount });
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

    return (
        <div className="card council-screen">
            <CentralDestinationHeader
                art={councilHallHero}
                backLabel="Central"
                eyebrow="The Thousand Gates · War Council"
                icon={<GiGreekTemple />}
                onBack={onBack}
                statusLabel="Active conflicts"
                statusValue={activeVillageWars.length + clanWars.length}
                subtitle="Live village and clan-war intelligence, command records, and the lineage of the Kage."
                title="Shinobi Council Hall"
                tone="violet"
            />

            <div className="council-tabs">
                <button aria-current={tab === "wars" ? "page" : undefined} className={`council-tab ${tab === "wars" ? "council-tab-active" : ""}`} onClick={() => setTab("wars")}><GiCrossedSwords style={SCH_ICON} />Active Wars</button>
                <button aria-current={tab === "clanBattles" ? "page" : undefined} className={`council-tab ${tab === "clanBattles" ? "council-tab-active" : ""}`} onClick={() => setTab("clanBattles")}><GiBlackFlag style={SCH_ICON} />Clan Battles</button>
                <button aria-current={tab === "kage" ? "page" : undefined} className={`council-tab ${tab === "kage" ? "council-tab-active" : ""}`} onClick={() => setTab("kage")}><GiCrown style={SCH_ICON} />Kage Records</button>
            </div>

            {tab === "wars" && <><section className="council-section">
                <h3 className="council-section-title"><GiCrossedSwords style={SCH_ICON} />Village Wars</h3>
                {warLoadError && <p className="council-empty" role="status">{warLoadError} Retrying automatically…</p>}
                {activeVillageWars.length === 0
                    ? <p className="council-empty">No active village wars. The world is at peace.</p>
                    : activeVillageWars.map(war => {
                        const [vA, vB] = war.villages;
                        const hpA = war.hp[vA] ?? 0;
                        const hpB = war.hp[vB] ?? 0;
                        const topA = topContributorForVillage(war, vA);
                        const topB = topContributorForVillage(war, vB);
                        return (
                            <div key={war.id} className="council-war-card">
                                <div className="council-vs-row">
                                    <div className={`council-side ${character.village === vA ? "council-mine" : ""}`}>
                                        <VillagePill village={vA} highlight={character.village === vA} />
                                        <span className="council-hp-label">{hpA.toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</span>
                                        <CouncilHpBar current={hpA} max={VILLAGE_WAR_HP_MAX} color="var(--success)" />
                                        <span className="council-top"><GiTrophy style={SCH_ICON} />{topA}</span>
                                    </div>
                                    <div className="council-vs">VS</div>
                                    <div className={`council-side council-side-right ${character.village === vB ? "council-mine" : ""}`}>
                                        <VillagePill village={vB} highlight={character.village === vB} />
                                        <span className="council-hp-label">{hpB.toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</span>
                                        <CouncilHpBar current={hpB} max={VILLAGE_WAR_HP_MAX} color="var(--danger)" />
                                        <span className="council-top"><GiTrophy style={SCH_ICON} />{topB}</span>
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
                <h3 className="council-section-title"><GiCrossedSwords style={SCH_ICON} />Clan Wars</h3>
                {clanWarsError && <p className="council-empty" role="status">{clanWarsError} Retrying automatically…</p>}
                {clanWarsLoading
                    ? <p className="council-empty">Loading clan wars…</p>
                    : clanWars.length === 0
                        ? <p className="council-empty">No active clan wars.</p>
                        : clanWars.map(cw => {
                            const [clanA, clanB] = cw.clans;
                            const hpA = cw.hp[clanA] ?? 0;
                            const hpB = cw.hp[clanB] ?? 0;
                            const maxA = cw.hpMax?.[clanA] ?? 1000;
                            const maxB = cw.hpMax?.[clanB] ?? 1000;
                            const topA = topContributorForClan(cw, clanA);
                            const topB = topContributorForClan(cw, clanB);
                            return (
                                <div key={cw.id} className="council-war-card">
                                    <div className="council-vs-row">
                                        <div className={`council-side ${character.clan === clanA ? "council-mine" : ""}`}>
                                            <span className="council-village-name">{clanA}</span>
                                            <span className="council-hp-label">{cw.villages[clanA]} · {hpA.toLocaleString()} / {maxA.toLocaleString()} HP</span>
                                            <CouncilHpBar current={hpA} max={maxA} color="#a78bfa" />
                                            <span className="council-top"><GiTrophy style={SCH_ICON} />{topA}</span>
                                        </div>
                                        <div className="council-vs">VS</div>
                                        <div className={`council-side council-side-right ${character.clan === clanB ? "council-mine" : ""}`}>
                                            <span className="council-village-name">{clanB}</span>
                                            <span className="council-hp-label">{cw.villages[clanB]} · {hpB.toLocaleString()} / {maxB.toLocaleString()} HP</span>
                                            <CouncilHpBar current={hpB} max={maxB} color="#fb923c" />
                                            <span className="council-top"><GiTrophy style={SCH_ICON} />{topB}</span>
                                        </div>
                                    </div>
                                    <div className="council-war-meta">
                                        Started {new Date(cw.startedAt).toLocaleString()} · {cw.completedChallenges.length} settled challenge{cw.completedChallenges.length === 1 ? "" : "s"}
                                    </div>
                                </div>
                            );
                        })
                }
            </section></>}

            {tab === "clanBattles" && <ClanBattlesTab character={character} playerRoster={playerRoster} setScreen={setScreen} launchClanWarBattle={launchClanWarBattle} />}

            {tab === "kage" && <section className="council-section">
                <h3 className="council-section-title"><GiCrown style={SCH_ICON} />Kage Records — All Villages</h3>
                {sortedKageHistory.length === 0
                    ? <p className="council-empty">No Kage have been seated yet. Defeat your village's story boss to open the Kage system.</p>
                    : sortedKageHistory.map((entry, i) => {
                        const isActive = !entry.endedAt;
                        const duration = isActive ? Date.now() - entry.seatedAt : (entry.endedAt! - entry.seatedAt);
                        const isMe = entry.name === character.name;
                        return (
                            <div key={`${entry.name}-${entry.village}-${i}`} className={`council-kage-row ${isMe ? "council-kage-me" : ""} ${isActive ? "council-kage-active" : ""}`}>
                                <div className="council-kage-seal"><GiCrown /></div>
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
                                    {typeof entry.defenseCount === "number" && entry.defenseCount > 0 && <span className="council-kage-date">🛡️ {entry.defenseCount} successful defense{entry.defenseCount === 1 ? "" : "s"}</span>}
                                    {!isActive && entry.endedReason && <span className="council-kage-date">{KAGE_END_REASON_LABEL[entry.endedReason]}{entry.wonBy ? ` by ${entry.wonBy}` : ""}</span>}
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
// ── Clan-war PvP Chronicle Showdown screen ──────────────────────────
// Server-managed Chronicle Showdown. Both players' decks +
// the board live in cw-tilecards:<challengeId> on the server (service-role
// only — NOT anon-readable; the raw row holds both hands and every
// face-down card, so only the handler's per-viewer projection ships). This
// component polls /api/clan/war/tilecards?action=state every 1.5s,
// renders the board + the current player's hand, submits placements
// via action=move, and detects game-end. The server applies HP damage
// to the parent clan war atomically with the game-ending move, so no
// manual report is ever called from here.
