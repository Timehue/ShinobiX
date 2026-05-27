import { useEffect, useState } from "react";
import { type Character, type LbTab } from "../App";
import {
    CharacterCreator,
    IconUser,
    IconLock,
    IconEyeOpen,
    IconEyeOff,
} from "./CharacterCreator";

const DISCORD_URL = "https://discord.gg/shinobi-journey";
const GUIDES_URL = "https://shinobi-journey.com/guides";

type StartView = "main" | "leaderboard";

type RosterEntry = {
    name: string;
    level: number;
    village: string;
    specialty: string;
    online: boolean;
    character?: Partial<Character>;
};

type PublicTournament = {
    id?: string;
    name?: string;
    createdBy?: string;
    startsAt?: number;
    endsAt?: number;
    participants?: string[];
    advancedPlayers?: string[];
} | null;

export function StartScreen({ onCreate, onLogin, onAdmin }: {
    onCreate: (character: Character, password: string) => void;
    onLogin: (name: string, password: string) => void;
    onAdmin: (prefilledPassword?: string) => void;
}) {
    const [view, setView] = useState<StartView>("main");
    const [loginName, setLoginName] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [showLoginPw, setShowLoginPw] = useState(false);
    const [loginStatus, setLoginStatus] = useState("");

    // Detect admin names typed in the player login field. "Admin 1", "admin1",
    // "ADMIN 1", "Admin 2", "admin2" — anything that normalizes to admin1/admin2
    // routes through the admin auth flow instead of the player auth flow. This
    // matches the muscle memory of typing "Admin 1" + password to log in as
    // admin, without exposing a dedicated Admin button on the start screen.
    function normalizeAdminName(raw: string): "admin1" | "admin2" | null {
        const n = raw.trim().toLowerCase().replace(/\s+/g, "");
        if (n === "admin1") return "admin1";
        if (n === "admin2") return "admin2";
        return null;
    }

    async function submitLogin() {
        if (loginName.trim().length < 2) return alert("Enter your player name.");
        if (!loginPassword) return alert("Enter your password.");

        // Admin name? Route to the admin login screen with the password already
        // filled in so they don't have to retype it. The Admin Login screen
        // verifies the password against ADMIN_PASSWORD (Admin 1) or
        // ADMIN_CONTENT_PASSWORD (Admin 2) and lands on the right account.
        if (normalizeAdminName(loginName)) {
            onAdmin(loginPassword);
            return;
        }

        setLoginStatus("Loading...");
        try {
            await onLogin(loginName.trim(), loginPassword);
        } finally {
            setLoginStatus("");
        }
    }

    return (
        <div className="start-screen">
            <div className="start-title-block">
                <h1 className="start-title">
                    Shinobi<span className="start-title-mark">✦</span>Journey
                </h1>
                <p className="start-subtitle">忍 の 道</p>
            </div>

            <div className="start-nav-row">
                <button
                    type="button"
                    className="start-nav-btn"
                    onClick={() => window.open(DISCORD_URL, "_blank", "noopener,noreferrer")}
                >
                    DISCORD
                </button>
                <span className="start-nav-divider">✦</span>
                <button
                    type="button"
                    className="start-nav-btn"
                    onClick={() => window.open(GUIDES_URL, "_blank", "noopener,noreferrer")}
                >
                    GUIDES
                </button>
                <span className="start-nav-divider">✦</span>
                <button
                    type="button"
                    className="start-nav-btn"
                    onClick={() => setView(view === "leaderboard" ? "main" : "leaderboard")}
                >
                    LEADERBOARD
                </button>
            </div>

            {view === "main" && (
                <div className="start-grid-ornate">
                    <CharacterCreator onCreate={onCreate} />

                    <div className="card creator-card start-card">
                        <h2 className="start-card-title">Player Login</h2>

                        <label className="start-field">
                            <span className="start-field-label">
                                <span className="start-field-icon"><IconUser /></span>
                                Name
                            </span>
                            <input
                                className="start-input"
                                value={loginName}
                                onChange={(e) => setLoginName(e.target.value)}
                                placeholder="Enter your shinobi name"
                            />
                        </label>

                        <label className="start-field">
                            <span className="start-field-label">
                                <span className="start-field-icon"><IconLock /></span>
                                Password
                            </span>
                            <span className="start-input-wrap">
                                <input
                                    className="start-input has-toggle"
                                    type={showLoginPw ? "text" : "password"}
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                                    placeholder="Enter your password"
                                />
                                <button
                                    type="button"
                                    className="start-eye-btn"
                                    onClick={() => setShowLoginPw(s => !s)}
                                    aria-label={showLoginPw ? "Hide password" : "Show password"}
                                >
                                    {showLoginPw ? <IconEyeOff /> : <IconEyeOpen />}
                                </button>
                            </span>
                        </label>

                        <button
                            className="start-primary-btn"
                            onClick={submitLogin}
                            disabled={!!loginStatus}
                        >
                            {loginStatus || "Log Back In"}
                        </button>

                        <p className="start-hint">
                            Logging in automatically restores your full save including images.
                        </p>
                    </div>
                </div>
            )}

            {view === "leaderboard" && (
                <PublicLeaderboard onBack={() => setView("main")} />
            )}
        </div>
    );
}

function PublicLeaderboard({ onBack }: { onBack: () => void }) {
    const [tab, setTab] = useState<LbTab>("ranked");
    const [players, setPlayers] = useState<RosterEntry[]>([]);
    const [tournament, setTournament] = useState<PublicTournament>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError("");
            try {
                const [rosterRes, gameStateRes] = await Promise.all([
                    fetch("/api/player/roster"),
                    fetch("/api/game-state").catch(() => null),
                ]);
                if (!rosterRes.ok) throw new Error(`Roster HTTP ${rosterRes.status}`);
                const rosterData = await rosterRes.json() as { players?: RosterEntry[] };
                if (!cancelled) setPlayers(Array.isArray(rosterData.players) ? rosterData.players : []);

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

    const tabs: { id: LbTab; label: string; icon: string }[] = [
        { id: "ranked",      label: "Ranked",       icon: "🎖" },
        { id: "kills",       label: "Kill Streaks", icon: "🗡" },
        { id: "xp",          label: "Most XP",      icon: "✦" },
        { id: "clans",       label: "Top Clans",    icon: "🏴" },
        { id: "pets",        label: "Pet Wins",     icon: "🐾" },
        { id: "endless",     label: "Endless",      icon: "🌀" },
        { id: "villageWars", label: "Village Wars", icon: "⚔" },
        { id: "tournament",  label: "Tournament",   icon: "🏆" },
    ];

    function getValue(p: RosterEntry, t: LbTab): number {
        const c = p.character ?? {};
        switch (t) {
            case "ranked": return Number(c.rankedRating ?? 1000);
            case "kills": return Number(c.totalPvpKills ?? 0);
            case "xp": return Number(c.xp ?? 0);
            case "pets": return Number(c.totalPetWins ?? 0);
            case "endless": return Number(c.totalEndlessTowerWins ?? 0);
            case "villageWars": return Number(c.totalVillageRaids ?? 0);
            case "professions": return Number(c.professionXp ?? 0);
            case "weeklyBoss":
            case "clans":
            case "tournament":
                return 0;
        }
    }

    function getSuffix(t: LbTab): string {
        switch (t) {
            case "ranked": return " Elo";
            case "kills": return " kills";
            case "xp": return " XP";
            case "pets": return " wins";
            case "endless": return " waves";
            case "villageWars": return " raids";
            case "weeklyBoss": return " dmg";
            case "professions": return " XP";
            case "clans":
            case "tournament":
                return "";
        }
    }

    function getLabel(t: LbTab): string {
        switch (t) {
            case "ranked": return "Ranked Battle Rating (Elo)";
            case "kills": return "Total PvP Kills";
            case "xp": return "Total XP Earned";
            case "pets": return "Pet Arena Wins";
            case "endless": return "Endless Tower — Waves Survived";
            case "villageWars": return "Village War Raids Completed";
            case "weeklyBoss": return "Weekly Boss — Top Damage";
            case "clans": return "Clan Power (Ranked Wins + PvP Kills)";
            case "tournament": return "Last Tournament";
            case "professions": return "Top Profession XP (all professions)";
        }
    }

    const playersWithChar = players.filter(p => p.character);

    // Player leaderboards (per-stat sort, top 25)
    const rankedPlayers = (tab === "clans" || tab === "tournament")
        ? []
        : [...playersWithChar]
            .sort((a, b) => getValue(b, tab) - getValue(a, tab))
            .slice(0, 25);

    // Clan aggregation — matches HallOfLegends logic
    const clanMap = new Map<string, { score: number; members: number; topVillage: string }>();
    for (const p of playersWithChar) {
        const c = p.character ?? {};
        if (!c.clan) continue;
        const existing = clanMap.get(c.clan) ?? { score: 0, members: 0, topVillage: p.village };
        clanMap.set(c.clan, {
            score: existing.score + Number(c.rankedWins ?? 0) + Number(c.totalPvpKills ?? 0),
            members: existing.members + 1,
            topVillage: existing.topVillage,
        });
    }
    const topClans = [...clanMap.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 25);

    return (
        <div className="card start-leaderboard">
            <div className="start-back-row">
                <button className="start-back-button" onClick={onBack}>← Back</button>
            </div>

            <div className="start-leaderboard-header">
                <div style={{ flex: 1 }}>
                    <h2>🏆 Hall of Legends</h2>
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
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            <div className="start-leaderboard-board">
                <p className="start-leaderboard-board-label">{getLabel(tab)}</p>

                {loading && <p className="start-leaderboard-empty">Summoning legends...</p>}
                {!loading && error && (
                    <p className="start-leaderboard-empty">Could not load leaderboard ({error}).</p>
                )}

                {!loading && !error && tab !== "clans" && tab !== "tournament" && (
                    rankedPlayers.length === 0
                        ? <p className="start-leaderboard-empty">No shinobi have recorded glory yet.</p>
                        : rankedPlayers.map((p, i) => {
                            const v = getValue(p, tab);
                            const rankCls = i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : "";
                            const medal = i < 3 ? ["🥇","🥈","🥉"][i] : `#${i + 1}`;
                            return (
                                <div key={p.name} className={`start-leaderboard-row ${rankCls}`}>
                                    <span className="start-leaderboard-rank">{medal}</span>
                                    <span className="start-leaderboard-name">
                                        {p.name}
                                        {p.village ? <span className="start-leaderboard-village"> · {p.village}</span> : null}
                                    </span>
                                    <span className="start-leaderboard-value">{v.toLocaleString()}{getSuffix(tab)}</span>
                                </div>
                            );
                        })
                )}

                {!loading && !error && tab === "clans" && (
                    topClans.length === 0
                        ? <p className="start-leaderboard-empty">No clan data available yet.</p>
                        : topClans.map(([clan, data], i) => {
                            const rankCls = i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : "";
                            const medal = i < 3 ? ["🥇","🥈","🥉"][i] : `#${i + 1}`;
                            return (
                                <div key={clan} className={`start-leaderboard-row ${rankCls}`}>
                                    <span className="start-leaderboard-rank">{medal}</span>
                                    <span className="start-leaderboard-name">
                                        {clan}
                                        <span className="start-leaderboard-village"> · {data.members} member{data.members !== 1 ? "s" : ""}</span>
                                    </span>
                                    <span className="start-leaderboard-value">{data.score.toLocaleString()} pts</span>
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
                                    {(tournament.participants ?? []).join(", ") || "—"}
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
