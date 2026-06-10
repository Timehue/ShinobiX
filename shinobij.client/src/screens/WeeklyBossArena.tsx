/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, useCallback } from "react";
import type { Character, PlayerRecord } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { Screen } from "../types/core";

// ─── Weekly Boss Arena ────────────────────────────────────────────────────────
// Shared-HP boss fought by the whole server. Damage is tracked server-side;
// when HP hits 0 every contributor is rewarded. New boss spawns each ISO week.
// Combat is a simple "tap to attack" loop — each attack costs stamina and
// rolls damage based on the player's combat stats. Keeps the system decoupled
// from the full Arena.
export function WeeklyBossArena({
    character,
    creatorAis,
    setScreen,
    playerRoster,
    sharedImages = {},
    onLaunchFight,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    creatorAis: CreatorAi[];
    setPendingAiProfileId?: (id: string) => void;
    setTemporaryStoryAi?: (ai: CreatorAi | null) => void;
    setArenaKey?: (fn: (k: number) => number) => void;
    setScreen: (s: Screen) => void;
    playerRoster: PlayerRecord[];
    sharedImages?: Record<string, string>;
    onLaunchFight?: (bossAiId: string, bossDisplayName?: string) => void;
}) {
    const [bossState, setBossState] = useState<WeeklyBossState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        try {
            const r = await fetch("/api/weekly-boss", { method: "GET" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setBossState(data.boss ?? null);
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const id = setInterval(refresh, 15000);
        return () => clearInterval(id);
    }, [refresh]);

    // Resolve the picked boss AI so the arena page can show its art.
    // Admins pick the active boss in the Admin → AIs / Weekly Boss panel;
    // each AI's image is uploaded via the AI Creator (`ai:<id>` shared
    // image key) and merged onto the AI's `image` field at load time.
    // Prefer sharedImages directly in case the creatorAis list arrived
    // before the image bulk-load finished hydrating.
    const bossAi = bossState ? creatorAis.find(ai => ai.id === bossState.aiId) : null;
    const bossImage = bossState
        ? (sharedImages[`ai:${bossState.aiId}`] || bossAi?.image || "")
        : "";

    if (loading) return <div className="card" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>Loading weekly boss…</div>;

    if (!bossState || !bossState.aiId) {
        return (
            <div className="card" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>
                <h1 style={{ marginTop: 0 }}>👹 Weekly Boss</h1>
                <p style={{ color: "#94a3b8" }}>No boss has been summoned this week. Ask an admin to set the weekly boss AI.</p>
                <button className="back-btn" onClick={() => setScreen("centralHub")}>× Back to Central</button>
            </div>
        );
    }

    const nowMs = Date.now();
    const expiresAt = bossState.expiresAt ?? ((bossState.startedAt ?? nowMs) + 24 * 60 * 60 * 1000);
    const msToDespawn = Math.max(0, expiresAt - nowMs);
    const expired = bossState.rewardsDistributed || msToDespawn <= 0;
    const myKey = character.name.toLowerCase();
    const myDamage = bossState.damageByPlayer?.[myKey] ?? 0;
    const sortedEntries = Object.entries(bossState.damageByPlayer ?? {})
        .sort(([, a], [, b]) => (b as number) - (a as number));
    const top25 = sortedEntries.slice(0, 25);
    const myRank = sortedEntries.findIndex(([n]) => n === myKey);
    const myRankDisplay = myRank >= 0 ? myRank + 1 : null;
    const mySummary = bossState.distributionSummary?.find(e => e.name === myKey);
    // Server caps the player at 3 arena attempts per boss spawn. Show the
    // counter prominently so the player knows when they're about to burn
    // their last try.
    const WEEKLY_BOSS_MAX_ATTEMPTS = 3;
    const attemptsUsed = bossState.attemptsByPlayer?.[myKey] ?? 0;
    const attemptsLeft = Math.max(0, WEEKLY_BOSS_MAX_ATTEMPTS - attemptsUsed);
    const lockedOut = attemptsLeft <= 0;

    // hh:mm:ss countdown to despawn. Re-renders every interval via the
    // existing refresh() poll (15s); even between polls the countdown
    // calc above re-evaluates whenever React re-renders for any reason.
    const hours = Math.floor(msToDespawn / 3_600_000);
    const minutes = Math.floor((msToDespawn % 3_600_000) / 60_000);
    const seconds = Math.floor((msToDespawn % 60_000) / 1000);
    const countdown = expired
        ? "Despawned"
        : `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;

    return (
        <div className="card" style={{ maxWidth: 820, margin: "1rem auto", padding: "1.4rem" }}>
            <h1 style={{ marginTop: 0 }}>👹 Weekly Boss</h1>
            <p style={{ color: "#94a3b8", marginTop: 0 }}>Week: <strong>{bossState.weekKey}</strong></p>
            {error && <div style={{ color: "#f87171", marginBottom: "0.5rem" }}>⚠ {error}</div>}
            <div style={{ background: "#1a1a2e", border: "1px solid #f87171", borderRadius: 8, padding: "0.8rem", margin: "0.8rem 0" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                    {bossImage && (
                        <div style={{ flex: "0 0 96px", width: 96, height: 96, background: "#0a0a1a", border: "1px solid rgba(248,113,113,0.5)", borderRadius: 6, overflow: "hidden" }}>
                            <img
                                src={bossImage}
                                alt={bossState.bossName ?? "Weekly Boss"}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <strong style={{ color: "#f87171", fontSize: "1.05rem" }}>{bossState.bossName ?? bossAi?.name ?? "Weekly Boss"}</strong>
                            <span style={{ fontFamily: "monospace", color: expired ? "#94a3b8" : "#facc15" }}>
                                {expired ? "🪦 Despawned" : `⏱ ${countdown}`}
                            </span>
                        </div>
                        <p className="hint" style={{ margin: 0, fontSize: "0.78rem" }}>
                            The boss has no HP cap — it rampages for 24 hours, then despawns. Damage as much as you can to
                            climb the leaderboard before the timer hits zero.
                        </p>
                    </div>
                </div>
            </div>
            <p>
                Your damage: <strong style={{ color: "#facc15" }}>{myDamage.toLocaleString()}</strong>
                {myRankDisplay !== null && (
                    <span style={{ color: "#94a3b8", marginLeft: "0.5rem" }}>· Rank #{myRankDisplay}</span>
                )}
                <span style={{ color: lockedOut ? "#f87171" : "#94a3b8", marginLeft: "0.5rem" }}>
                    · Attempts: <strong>{attemptsUsed}/{WEEKLY_BOSS_MAX_ATTEMPTS}</strong>
                </span>
            </p>
            <div style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(250,204,21,0.25)", borderRadius: 6, padding: "0.5rem 0.7rem", margin: "0.4rem 0", fontSize: "0.82rem" }}>
                <div>🏆 <strong>Rewards at despawn</strong></div>
                <div>· Top 10 by damage → <strong style={{ color: "#facc15" }}>1 Weekly Boss Core</strong> each</div>
                <div>· Top 25 by damage → <strong style={{ color: "#60a5fa" }}>1 Dungeon Key</strong> each</div>
                <div>· Every contributor → ryo + XP share by damage (MVP = top 1 gets <strong>×2</strong>)</div>
                <div style={{ marginTop: 4, color: "#94a3b8" }}>
                    Each attack launches a full arena fight vs the boss — it has unlimited HP and will eventually
                    knock you out. Whatever damage you dealt is added to the leaderboard. <strong>3 attempts per spawn.</strong>
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginTop: "0.6rem" }}>
                <button
                    disabled={expired || lockedOut || (character.stamina ?? 0) < 20}
                    style={{
                        padding: "0.8rem",
                        background: expired || lockedOut ? "#333" : "linear-gradient(#7f1d1d,#450a0a)",
                        borderColor: "#f87171",
                        fontWeight: 700,
                        opacity: expired || lockedOut ? 0.6 : 1,
                    }}
                    onClick={() => {
                        if (!bossState) return;
                        onLaunchFight?.(bossState.aiId, bossState.bossName ?? bossAi?.name);
                    }}
                >
                    {expired
                        ? "🪦 Despawned"
                        : lockedOut
                            ? "🔒 No attempts left"
                            : `⚔ Fight Boss (${attemptsLeft} left · 20 stamina)`}
                </button>
                <button className="back-btn" onClick={() => setScreen("centralHub")}>× Back</button>
            </div>
            <h3 style={{ marginTop: "1.2rem" }}>Top 25 Contributors</h3>
            <div style={{ display: "grid", gap: 4 }}>
                {top25.length === 0 && <em style={{ color: "#64748b" }}>No damage dealt yet.</em>}
                {top25.map(([name, dmg], i) => {
                    const player = playerRoster.find(p => p.name.toLowerCase() === name);
                    // Tier coloring: MVP gold (rank 1), top-10 core tier (ranks 2-10),
                    // top-25 key tier (ranks 11-25). Self gets a subtle outline.
                    const isMvp = i === 0;
                    const inCoreTier = i < 10;
                    const inKeyTier = i < 25;
                    const isMe = name === myKey;
                    const bg = isMvp
                        ? "rgba(250,204,21,0.18)"
                        : inCoreTier
                            ? "rgba(250,204,21,0.07)"
                            : inKeyTier
                                ? "rgba(96,165,250,0.07)"
                                : "transparent";
                    const tierLabel = isMvp
                        ? "👑 MVP · core + key"
                        : inCoreTier
                            ? "💠 core + key"
                            : inKeyTier
                                ? "🗝 key"
                                : "";
                    return (
                        <div
                            key={name}
                            style={{
                                display: "grid",
                                gridTemplateColumns: "auto 1fr auto auto",
                                gap: 8,
                                padding: "0.3rem 0.55rem",
                                background: bg,
                                outline: isMe ? "1px solid rgba(74,222,128,0.45)" : undefined,
                                borderRadius: 4,
                                alignItems: "center",
                            }}
                        >
                            <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>#{i + 1}</span>
                            <span>{player?.name ?? name} {player?.village ? <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>· {player.village}</span> : null}</span>
                            <small style={{ color: "#cbd5e1", fontSize: "0.72rem" }}>{tierLabel}</small>
                            <strong>{(dmg as number).toLocaleString()}</strong>
                        </div>
                    );
                })}
            </div>
            {expired && mySummary && (
                <div style={{ background: "rgba(15,118,110,0.18)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "0.6rem 0.8rem", margin: "0.8rem 0 0.4rem", fontSize: "0.85rem" }}>
                    <strong style={{ color: "#4ade80" }}>✓ Rewards distributed.</strong> You earned:
                    <ul style={{ margin: "4px 0 0 18px" }}>
                        <li>+{mySummary.ryo.toLocaleString()} ryo · +{mySummary.xp.toLocaleString()} XP{mySummary.isMvp ? " (MVP ×2)" : ""}</li>
                        {mySummary.gotCore && <li>+1 Weekly Boss Core (top 10)</li>}
                        {mySummary.gotKey && <li>+1 Dungeon Key (top 25)</li>}
                    </ul>
                </div>
            )}
            {expired && !mySummary && myDamage > 0 && (
                <p style={{ color: "#94a3b8", marginTop: "0.8rem", fontSize: "0.85rem" }}>
                    Rewards distributed — your save has been credited (refresh to see updated totals).
                </p>
            )}
        </div>
    );
}

type WeeklyBossRewardEntry = {
    name: string;
    damage: number;
    rank: number;
    ryo: number;
    xp: number;
    gotCore: boolean;
    gotKey: boolean;
    isMvp: boolean;
};

type WeeklyBossState = {
    weekKey: string;
    aiId: string;
    bossName?: string;
    hpMax: number;
    hpRemaining: number;
    scaleFactor?: number;
    damageByPlayer: Record<string, number>;
    attemptsByPlayer?: Record<string, number>;
    startedAt: number;
    expiresAt?: number;
    rewardsDistributed?: boolean;
    distributedAt?: number;
    distributionSummary?: WeeklyBossRewardEntry[];
    // Legacy fields — kept for type-compat with pre-despawn state shapes.
    lastKillRewardedAt?: number;
    killRewardedTo?: string[];
};
