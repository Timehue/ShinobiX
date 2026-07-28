import { useEffect, useState } from "react";
import { GameIcon, type GameIconName } from "../components/icons/GameIcon";

const SS_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;

type PublicTournament = {
    id?: string;
    name?: string;
    createdBy?: string;
    startsAt?: number;
    endsAt?: number;
    participants?: string[];
    advancedPlayers?: string[];
} | null;

type PublicLeaderboardBoardId =
    | "ranked"
    | "petRanked"
    | "level"
    | "xp"
    | "kills"
    | "pets"
    | "endless"
    | "villageWars"
    | "professions"
    | "battleTower"
    | "clans";
type PublicLeaderboardTab = PublicLeaderboardBoardId | "tournament";
type PublicLeaderboardRow = {
    rank: number;
    name: string;
    value: number;
    label: string;
    level?: number;
    village?: string;
    specialty?: string;
    clan?: string;
    online?: boolean;
    lastSeenAt?: number;
    members?: number;
    onlineMembers?: number;
};
type PublicLeaderboardBoard = {
    id: PublicLeaderboardBoardId;
    label: string;
    valueLabel: string;
    suffix: string;
    rows: PublicLeaderboardRow[];
};

export function PublicLeaderboard({ onBack }: { onBack: () => void }) {
    const [tab, setTab] = useState<PublicLeaderboardTab>("ranked");
    const [boards, setBoards] = useState<Partial<Record<PublicLeaderboardBoardId, PublicLeaderboardBoard>>>({});
    const [tournament, setTournament] = useState<PublicTournament>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError("");
            try {
                const [leaderboardRes, gameStateRes] = await Promise.all([
                    fetch("/api/player/leaderboards?limit=25"),
                    fetch("/api/game-state").catch(() => null),
                ]);
                if (!leaderboardRes.ok) throw new Error(`Leaderboard HTTP ${leaderboardRes.status}`);
                const leaderboardData = await leaderboardRes.json() as { boards?: PublicLeaderboardBoard[] };
                if (!cancelled) {
                    const nextBoards: Partial<Record<PublicLeaderboardBoardId, PublicLeaderboardBoard>> = {};
                    for (const board of Array.isArray(leaderboardData.boards) ? leaderboardData.boards : []) {
                        nextBoards[board.id] = board;
                    }
                    setBoards(nextBoards);
                }

                if (gameStateRes && gameStateRes.ok) {
                    const gs = await gameStateRes.json() as { arenaTournament?: PublicTournament };
                    if (!cancelled) setTournament(gs.arenaTournament ?? null);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load leaderboard");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const tabs: { id: PublicLeaderboardTab; label: string; icon: GameIconName }[] = [
        { id: "ranked",      label: "Ranked",       icon: "medal" },
        { id: "petRanked",   label: "Pet Rating",   icon: "paw" },
        { id: "level",       label: "Level",        icon: "chakra" },
        { id: "kills",       label: "Kill Streaks", icon: "sword" },
        { id: "xp",          label: "Most Points",  icon: "bolt" },
        { id: "clans",       label: "Top Clans",    icon: "sigil" },
        { id: "pets",        label: "Pet Wins",     icon: "paw" },
        { id: "endless",     label: "Endless",      icon: "chakra" },
        { id: "villageWars", label: "Village Wars", icon: "sword" },
        { id: "professions", label: "Professions",  icon: "dumbbell" },
        { id: "battleTower", label: "Battle Tower", icon: "medal" },
        { id: "tournament",  label: "Tournament",   icon: "medal" },
    ];

    function getLabel(t: PublicLeaderboardTab): string {
        if (t !== "tournament" && boards[t]?.label) return boards[t]!.label;
        switch (t) {
            case "ranked": return "Ranked Battle Rating (Elo)";
            case "petRanked": return "Pet Arena Rating (Elo)";
            case "level": return "Highest Level";
            case "kills": return "Total PvP Kills";
            case "xp": return "Total Stat Points Earned";
            case "pets": return "Pet Coliseum Wins";
            case "endless": return "Endless Tower - Waves Survived";
            case "villageWars": return "Village War Raids Completed";
            case "clans": return "Clan Power (Ranked Wins + PvP Kills)";
            case "tournament": return "Last Tournament";
            case "professions": return "Top Profession XP (all professions)";
            case "battleTower": return "Battle Tower Best Floor";
        }
    }

    const activeBoard = tab === "tournament" ? null : boards[tab];
    const activeRows = activeBoard?.rows ?? [];

    return (
        <div className="card start-leaderboard">
            <div className="start-back-row">
                <button className="start-back-button" onClick={onBack}>Back</button>
            </div>

            <div className="start-leaderboard-header">
                <div style={{ flex: 1 }}>
                    <h2><GameIcon name="medal" style={SS_ICON} />Hall of Legends</h2>
                    <p className="start-leaderboard-subtitle">Eternal records of the world's greatest shinobi.</p>
                </div>
            </div>

            <div className="start-leaderboard-tabs">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        className={`start-leaderboard-tab ${tab === t.id ? "is-active" : ""}`}
                        onClick={() => setTab(t.id)}
                    >
                        <GameIcon name={t.icon} /> {t.label}
                    </button>
                ))}
            </div>

            <div className="start-leaderboard-board">
                <p className="start-leaderboard-board-label">{getLabel(tab)}</p>

                {loading && <p className="start-leaderboard-empty">Summoning legends...</p>}
                {!loading && error && (
                    <p className="start-leaderboard-empty">Could not load leaderboard ({error}).</p>
                )}

                {!loading && !error && tab !== "tournament" && (
                    activeRows.length === 0
                        ? <p className="start-leaderboard-empty">No shinobi have recorded glory yet.</p>
                        : activeRows.map((row, i) => {
                            const rankCls = i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : "";
                            const medal = `#${row.rank || i + 1}`;
                            const detail = row.members
                                ? `${row.members} member${row.members !== 1 ? "s" : ""}${row.onlineMembers ? `, ${row.onlineMembers} online` : ""}`
                                : row.clan || row.village || "";
                            return (
                                <div key={`${tab}:${row.name}`} className={`start-leaderboard-row ${rankCls}`}>
                                    <span className="start-leaderboard-rank">{medal}</span>
                                    <span className="start-leaderboard-name">
                                        {row.name}
                                        {detail ? <span className="start-leaderboard-village"> - {detail}</span> : null}
                                    </span>
                                    <span className="start-leaderboard-value">{row.label || row.value.toLocaleString()}</span>
                                </div>
                            );
                        })
                )}

                {!loading && !error && tab === "tournament" && (
                    !tournament
                        ? <p className="start-leaderboard-empty">No tournament has been held yet.</p>
                        : (
                            <div className="start-tournament-card">
                                <h3>{tournament.name ?? "Arena Tournament"}</h3>
                                {tournament.createdBy && <p><strong>Hosted by:</strong> {tournament.createdBy}</p>}
                                <p>
                                    <strong>Participants ({tournament.participants?.length ?? 0}):</strong>{" "}
                                    {(tournament.participants ?? []).join(", ") || "-"}
                                </p>
                                {tournament.advancedPlayers && tournament.advancedPlayers.length > 0 && (
                                    <p><strong>Advanced Players:</strong> {tournament.advancedPlayers.join(", ")}</p>
                                )}
                                {tournament.endsAt && (
                                    <p className="start-tournament-ended">
                                        Ended {new Date(tournament.endsAt).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        )
                )}
            </div>
        </div>
    );
}
