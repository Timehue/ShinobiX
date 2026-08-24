/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect, useCallback } from "react";
// Compact local chrome glyphs shared with the rest of the game.
import { GiOgre, GiTrophy, GiTombstone, GiPadlock, GiCrossedSwords } from "../components/icons/LightweightGameIcons";
const WB_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import { visiblePoll } from "../lib/poll";
import { isWeeklyBossRoamEnabled, weeklyBossRoamState } from "../lib/weekly-boss-roam";
import { weeklyBossHpView } from "../lib/weekly-boss-hp";
import type { Character, PlayerRecord, VersionedCharacterCommit } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { Screen } from "../types/core";
import { CentralDestinationHeader } from "../components/CentralDestinationHeader";
import { WeeklyBossFight } from "./WeeklyBossFight";
import type { SoloPveSession } from "../lib/solo-pve-api";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
    useLiveCapabilities,
} from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";

// ─── Weekly Boss Arena ────────────────────────────────────────────────────────
// Shared WORLD boss (one server HP pool; never dies — "Broken" at 0 HP, gone
// only on its 72h timer) fought through the authoritative Solo PvE runtime.
// The server derives each contribution from the terminal sealed session and
// distributes the weekly leaderboard rewards after the spawn expires.
export function WeeklyBossArena({
    character,
    onVersionedCharacter,
    creatorAis,
    setScreen,
    playerRoster,
    sharedImages = {},
}: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
    creatorAis: CreatorAi[];
    setPendingAiProfileId?: (id: string) => void;
    setTemporaryStoryAi?: (ai: CreatorAi | null) => void;
    setArenaKey?: (fn: (k: number) => number) => void;
    setScreen: (s: Screen) => void;
    playerRoster: PlayerRecord[];
    sharedImages?: Record<string, string>;
}) {
    const weeklyBossViewAvailability = useCapabilityViewAvailability();
    const weeklyBossMutationAvailability = useCapabilityMutationAvailability();
    const guardCycleAvailability = useCapabilityViewAvailability("weeklyBossGuardCycle");
    const { mutationAvailability, viewAvailability } = useLiveCapabilities();
    const weeklyBossViewOpen = capabilityAdmissionAllowed(weeklyBossViewAvailability);
    const weeklyBossActionsAvailable = capabilityAdmissionAllowed(weeklyBossMutationAvailability);
    const [bossState, setBossState] = useState<WeeklyBossState | null>(null);
    const [fightEnabled, setFightEnabled] = useState(true);
    const [fightDisabledReason, setFightDisabledReason] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [startingFight, setStartingFight] = useState(false);
    const [fight, setFight] = useState<{ runId: string; session: SoloPveSession } | null>(null);

    const refresh = useCallback(async () => {
        // This return sits before the try/finally below, so it must settle the
        // spinner itself or a closed capability gate leaves "loading" stuck on.
        if (!capabilityAdmissionAllowed(viewAvailability())) { setLoading(false); return; }
        try {
            const r = await fetch("/api/weekly-boss", { method: "GET" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setBossState(data.boss ?? null);
            setFightEnabled(data.fightEnabled !== false);
            setFightDisabledReason(typeof data.fightDisabledReason === "string" ? data.fightDisabledReason : null);
        } catch (e) {
            setError(String((e as Error).message || e));
        } finally {
            setLoading(false);
        }
    }, [viewAvailability]);

    useEffect(() => {
        if (!weeklyBossViewOpen) return;
        void refresh();
        return visiblePoll(refresh, 15000);
    }, [refresh, weeklyBossViewOpen]);

    async function launchAuthoritativeFight() {
        if (startingFight) return;
        if (!weeklyBossActionsAvailable || !capabilityAdmissionAllowed(mutationAvailability())) {
            setError("New Weekly Boss fights are paused. Leaderboard status and accepted-fight recovery remain available.");
            return;
        }
        setStartingFight(true);
        try {
            const response = await fetch("/api/weekly-boss", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "startFight", weekKey: bossState?.weekKey }),
            });
            const data = await response.json().catch(() => ({})) as { runId?: string; session?: SoloPveSession; character?: Character; _saveVersion?: number; error?: string };
            if (!response.ok || !data?.runId || !data?.session) {
                setError(data?.error ?? "The Weekly Boss fight could not be started.");
                return;
            }
            if (data.character && !onVersionedCharacter(data.character, data._saveVersion)) return;
            setFight({ runId: data.runId, session: data.session });
        } catch (cause) {
            setError(String((cause as Error).message || cause));
        } finally {
            setStartingFight(false);
        }
    }

    async function recoverAuthoritativeFight() {
        if (startingFight) return;
        if (!capabilityAdmissionAllowed(viewAvailability())) {
            setError("Weekly Boss recovery status is temporarily unavailable.");
            return;
        }
        const weekKey = bossState?.weekKey;
        if (!weekKey) {
            setError("Weekly Boss status changed. Refresh and try recovery again.");
            return;
        }
        setStartingFight(true);
        try {
            let response = await fetch(`/api/weekly-boss?recoverFight=1&weekKey=${encodeURIComponent(weekKey)}`, {
                method: "GET",
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            let data = await response.json().catch(() => ({})) as {
                runId?: string;
                session?: SoloPveSession;
                character?: Character;
                _saveVersion?: number;
                code?: string;
                error?: string;
            };

            // A process can fail after persisting a prepared session but before
            // its idempotent attempt/stamina saga reaches ready. Discovery above
            // remains read-only; this separately named mutation may finish only
            // that exact accepted run and is incapable of creating a new one.
            if (response.status === 409
                && data.code === "weekly-boss-recovery-needs-finalization"
                && data.runId) {
                if (!capabilityAdmissionAllowed(mutationAvailability())) {
                    setError("Your interrupted fight was found. Resume it after progress-changing actions reopen.");
                    return;
                }
                response = await fetch("/api/weekly-boss", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "resumeFight", weekKey, runId: data.runId }),
                });
                data = await response.json().catch(() => ({})) as typeof data;
            }

            if (!response.ok || !data.runId || !data.session) {
                setError(data.error ?? "No interrupted Weekly Boss fight is available.");
                return;
            }
            if (data.character && !onVersionedCharacter(data.character, data._saveVersion)) return;
            setFight({ runId: data.runId, session: data.session });
        } catch (cause) {
            setError(String((cause as Error).message || cause));
        } finally {
            setStartingFight(false);
        }
    }

    async function settleAuthoritativeFight(runId: string): Promise<unknown> {
        if (!capabilityAdmissionAllowed(mutationAvailability())) {
            throw new Error("Weekly Boss settlement is paused. Keep this fight open and retry when live actions return.");
        }
        const response = await fetch("/api/weekly-boss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "logFight", runId }),
        });
        const data = await response.json().catch(() => ({})) as { boss?: WeeklyBossState; character?: Character; _saveVersion?: number; error?: string };
        if (!response.ok) throw new Error(data?.error ?? "Weekly Boss settlement failed.");
        if (data?.boss) setBossState(data.boss);
        if (data.character && !onVersionedCharacter(data.character, data._saveVersion)) throw new Error("A newer Weekly Boss result is already active.");
        return data;
    }

    if (fight) {
        return (
            <>
                {!weeklyBossActionsAvailable && (
                    <div className="card" role="status" style={{ padding: "0.8rem 1rem", maxWidth: 720, margin: "1rem auto" }}>
                        <strong><GiPadlock style={WB_ICON} />Weekly Boss actions paused.</strong>{" "}
                        This accepted fight stays mounted for inspection and recovery; combat requests resume only after live admission returns.
                    </div>
                )}
                <WeeklyBossFight
                    character={character}
                    sharedImages={sharedImages}
                    runId={fight.runId}
                    initialSession={fight.session}
                    settleFn={settleAuthoritativeFight}
                    onExit={() => { setFight(null); void refresh(); }}
                />
            </>
        );
    }

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

    if (!weeklyBossViewOpen) return <div className="card" role="status" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>Checking Weekly Boss availability…</div>;
    if (loading) return <div className="card" style={{ padding: "1.4rem", maxWidth: 720, margin: "1rem auto" }}>Loading weekly boss…</div>;

    if (!bossState || !bossState.aiId) {
        return (
            <div className="card weekly-boss-screen weekly-boss-screen-empty">
                <CentralDestinationHeader
                    eyebrow="The Thousand Gates · World Threat"
                    title="Weekly Boss"
                    subtitle="Track the realm's shared target, contribution window, attempts, and reward tiers."
                    icon={<GiOgre />}
                    tone="crimson"
                    statusLabel="Ritual status"
                    statusValue="Dormant"
                    onBack={() => setScreen("centralHub")}
                />
                <section className="weekly-boss-empty-state" aria-label="Weekly Boss status">
                    <span aria-hidden="true"><GiTombstone /></span>
                    <div>
                        <p className="weekly-boss-kicker">No active incursion</p>
                        <h2>The arena is quiet—for now.</h2>
                        <p>No boss has been summoned this week. Return when the next world threat is announced.</p>
                    </div>
                </section>
            </div>
        );
    }

    const nowMs = Date.now();
    // Fallback window mirrors api/weekly-boss.ts WEEKLY_BOSS_LIFETIME_MS (72h, M-3).
    const expiresAt = bossState.expiresAt ?? ((bossState.startedAt ?? nowMs) + 72 * 60 * 60 * 1000);
    const msToDespawn = Math.max(0, expiresAt - nowMs);
    const expired = bossState.rewardsDistributed || msToDespawn <= 0;
    const myKey = character.name.toLowerCase();
    const myDamage = bossState.damageByPlayer?.[myKey] ?? 0;
    // ONE shared world HP pool (server: hpRemaining = max(0, hpMax − Σ damage)).
    // Derived locally too so a stale/legacy payload still reads correctly — and
    // so that a payload with NO pool draws no bar and claims no kill. See
    // lib/weekly-boss-hp.ts.
    const { hpMax, hpRemaining, hpPct, hpPctLabel, broken, showBar: showHpBar } = weeklyBossHpView(bossState);
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
    const staminaBlocked = (character.stamina ?? 0) < 20;
    // When local guards or the global mutation freeze block the ordinary
    // button, expose the server's read-only accepted-run probe. The probe cannot
    // turn stale local state into a fresh attempt or stamina debit.
    const acceptedFightRecoveryNeeded = lockedOut || staminaBlocked || !weeklyBossActionsAvailable;
    const contributionDisabled = !fightEnabled;
    const contributionDisabledCopy = fightDisabledReason === "weekly_boss_server_authority_required"
        ? "Weekly Boss contribution is paused for public beta until server-authoritative settlement is live."
        : "Weekly Boss contribution is currently disabled.";

    // hh:mm:ss countdown to despawn. Re-renders every interval via the
    // existing refresh() poll (15s); even between polls the countdown
    // calc above re-evaluates whenever React re-renders for any reason.
    const hours = Math.floor(msToDespawn / 3_600_000);
    const minutes = Math.floor((msToDespawn % 3_600_000) / 60_000);
    const seconds = Math.floor((msToDespawn % 60_000) / 1000);
    const countdown = expired
        ? "Despawned"
        : `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;

    // Roaming mode (weeklyBossRoam.v1): the boss is fought by finding it on the
    // world map, so this screen becomes a TRACKER — where it's roaming + the
    // leaderboard + your attempts — rather than a menu fight-launcher. Flag off →
    // this screen behaves exactly as before.
    const roaming = isWeeklyBossRoamEnabled();
    const roam = roaming ? weeklyBossRoamState(bossState, nowMs) : null;

    return (
        <div className="card weekly-boss-screen">
            <CentralDestinationHeader
                eyebrow="The Thousand Gates · World Threat"
                title="Weekly Boss"
                subtitle={`Incursion ${bossState.weekKey} · every verified strike advances the shared leaderboard.`}
                icon={<GiOgre />}
                tone="crimson"
                statusLabel={expired ? "Incursion" : "Time remaining"}
                statusValue={countdown}
                onBack={() => setScreen("centralHub")}
            />
            {error && <div style={{ color: "var(--red-400)", marginBottom: "0.5rem" }}>⚠ {error}</div>}
            {guardCycleAvailability !== "available" && (
                <div role="status" style={{ background: "rgba(15,23,42,0.55)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 6, padding: "0.55rem 0.75rem", margin: "0.5rem 0", fontSize: "0.84rem", color: "var(--slate-300)" }}>
                    <GiPadlock style={WB_ICON} />{guardCycleAvailability === "unknown" ? "Guard-cycle status is being checked. The core Weekly Boss fight remains available." : "The Weekly Boss guard cycle is temporarily disabled. The core fight remains available."}
                </div>
            )}
            <div style={{ background: "#1a1a2e", border: "1px solid var(--red-400)", borderRadius: 8, padding: "0.8rem", margin: "0.8rem 0" }}>
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
                            <strong style={{ color: "var(--red-400)", fontSize: "1.05rem" }}>{bossState.bossName ?? bossAi?.name ?? "Weekly Boss"}</strong>
                            <span style={{ fontFamily: "monospace", color: expired ? "var(--text-dim)" : "var(--gold)" }}>
                                {expired ? <><GiTombstone style={WB_ICON} />Despawned</> : `⏱ ${countdown}`}
                            </span>
                        </div>
                        {/* A stale or partial payload can arrive with hpMax 0. That used to
                            render a triumphant gold "BROKEN · staggered" bar reading 0 / 0 —
                            announcing a world-first kill that never happened. With no pool
                            there is nothing to draw, so draw nothing. */}
                        {showHpBar && (
                            <div style={{ margin: "0 0 6px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.78rem", marginBottom: 3 }}>
                                    <span style={{ color: broken ? "var(--gold)" : "var(--red-400)", fontWeight: 700, letterSpacing: "0.04em" }}>
                                        {broken ? "Broken — staggered" : "World HP"}
                                    </span>
                                    <span style={{ fontFamily: "monospace", color: "var(--text-dim)" }}>
                                        {hpRemaining.toLocaleString()} / {hpMax.toLocaleString()} · {hpPctLabel}%
                                    </span>
                                </div>
                                {/* role="progressbar" belongs on the TRACK, not on a wrapper
                                    that also contains the label text — a progressbar's
                                    accessible name comes from aria-label, and its contents
                                    are not announced. */}
                                <div
                                    role="progressbar"
                                    aria-label="Shared boss HP"
                                    aria-valuemin={0}
                                    aria-valuemax={hpMax}
                                    aria-valuenow={hpRemaining}
                                    aria-valuetext={`${hpRemaining.toLocaleString()} of ${hpMax.toLocaleString()} HP remaining — ${hpPctLabel}%${broken ? ", broken and staggered" : ""}`}
                                    style={{ height: 10, background: "#0a0a1a", border: "1px solid rgba(248,113,113,0.45)", borderRadius: 5, overflow: "hidden" }}
                                >
                                    <div style={{ width: `${hpPct}%`, height: "100%", background: broken ? "linear-gradient(90deg, #facc15, #f59e0b)" : "linear-gradient(90deg, #dc2626, #f87171)", transition: "width 0.4s ease" }} />
                                </div>
                            </div>
                        )}
                        <p className="hint" style={{ margin: 0, fontSize: "0.78rem" }}>
                            {broken
                                ? "The realm's shinobi have broken it together. It is staggered, not slain — it fights on at a fraction of its strength until its seventy-two hours run out, and every blow landed still counts on the ledger."
                                : roaming
                                    ? "One boss, one shared HP pool. It roams the world map for 72 hours — track it down and challenge it where it's rampaging. Your fight picks up exactly where the last shinobi left its HP."
                                    : "One boss, one shared HP pool. Every shinobi on the server chips at the same bar — your fight picks up exactly where the last one left its HP. It leaves only when its 72-hour timer hits zero."}
                        </p>
                    </div>
                </div>
            </div>
            {roaming && roam?.active && (
                <div style={{ background: "rgba(236,91,56,0.12)", border: "1px solid rgba(236,91,56,0.5)", borderRadius: 6, padding: "0.55rem 0.75rem", margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    🗺️ Now rampaging in <strong>Sector {roam.currentSector}</strong> · moves on in ~{Math.max(1, Math.ceil(roam.nextHopInMs / 60000))}m.
                    <span style={{ color: "var(--text-dim)" }}> Find it there on the World Map to challenge it.</span>
                </div>
            )}
            <p>
                Your damage: <strong style={{ color: "var(--gold)" }}>{myDamage.toLocaleString()}</strong>
                {myRankDisplay !== null && (
                    <span style={{ color: "var(--text-dim)", marginLeft: "0.5rem" }}>· Rank #{myRankDisplay}</span>
                )}
                <span style={{ color: lockedOut ? "var(--red-400)" : "var(--text-dim)", marginLeft: "0.5rem" }}>
                    · Attempts: <strong>{attemptsUsed}/{WEEKLY_BOSS_MAX_ATTEMPTS}</strong>
                </span>
            </p>
            <div style={{ background: "rgba(15,23,42,0.5)", border: "1px solid rgba(250,204,21,0.25)", borderRadius: 6, padding: "0.5rem 0.7rem", margin: "0.4rem 0", fontSize: "0.82rem" }}>
                <div><GiTrophy style={WB_ICON} /><strong>Rewards at despawn</strong></div>
                <div>· Top 10 by damage → <strong style={{ color: "var(--gold)" }}>1 Weekly Boss Core</strong> each</div>
                <div>· Top 25 by damage → <strong style={{ color: "var(--blue-400)" }}>1 Dungeon Key</strong> each</div>
                <div>· Every contributor → a ryo share by damage + 10 stat points (MVP = top 1 gets <strong>×2</strong> ryo)</div>
                <div style={{ marginTop: 4, color: "var(--text-dim)" }}>
                    {roaming
                        ? "Find the boss roaming the World Map and challenge it where it stands — each fight adds your damage to the leaderboard. "
                        : "Each attack launches a full arena fight vs the boss at its CURRENT shared HP. Whatever damage you deal comes off the world bar and is added to the leaderboard — even once it's Broken. "}
                    <strong>3 attempts per spawn.</strong>
                </div>
            </div>
            {contributionDisabled && (
                <div style={{ background: "rgba(15,23,42,0.55)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 6, padding: "0.55rem 0.75rem", margin: "0.5rem 0", fontSize: "0.84rem", color: "var(--slate-300)" }}>
                    <GiPadlock style={WB_ICON} />{contributionDisabledCopy}
                </div>
            )}
            {!weeklyBossActionsAvailable && (
                <div role="status" style={{ background: "rgba(15,23,42,0.55)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 6, padding: "0.55rem 0.75rem", margin: "0.5rem 0", fontSize: "0.84rem", color: "var(--slate-300)" }}>
                    <GiPadlock style={WB_ICON} />New fights are paused. Leaderboard and attempt status remain readable.
                </div>
            )}
            {!roaming && !expired && acceptedFightRecoveryNeeded && (
                <button
                    type="button"
                    disabled={startingFight || !weeklyBossViewOpen}
                    style={{ width: "100%", padding: "0.65rem", opacity: weeklyBossViewOpen ? 1 : 0.6 }}
                    onClick={() => { void recoverAuthoritativeFight(); }}
                >
                    {startingFight ? "Checking for interrupted fight…" : "Check for interrupted fight"}
                </button>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginTop: "0.6rem" }}>
                {roaming ? (
                    <button
                        disabled={expired || lockedOut || contributionDisabled}
                        style={{ padding: "0.8rem", background: expired || lockedOut || contributionDisabled ? "#333" : "linear-gradient(#7f1d1d,#450a0a)", borderColor: "var(--red-400)", fontWeight: 700, opacity: expired || lockedOut || contributionDisabled ? 0.6 : 1 }}
                        onClick={() => setScreen("worldMap")}
                    >
                        {expired
                            ? <><GiTombstone style={WB_ICON} />Despawned</>
                            : contributionDisabled
                                ? <><GiPadlock style={WB_ICON} />Contribution paused</>
                            : lockedOut
                                ? <><GiPadlock style={WB_ICON} />No attempts left</>
                                : <><GiCrossedSwords style={WB_ICON} />Hunt it on the World Map</>}
                    </button>
                ) : (
                    <button
                        disabled={startingFight || !weeklyBossActionsAvailable || expired || lockedOut || contributionDisabled || staminaBlocked}
                        style={{
                            padding: "0.8rem",
                            background: expired || lockedOut || contributionDisabled ? "#333" : "linear-gradient(#7f1d1d,#450a0a)",
                            borderColor: "var(--red-400)",
                            fontWeight: 700,
                            opacity: expired || lockedOut || contributionDisabled || !weeklyBossActionsAvailable ? 0.6 : 1,
                        }}
                        onClick={() => { void launchAuthoritativeFight(); }}
                    >
                        {expired
                            ? <><GiTombstone style={WB_ICON} />Despawned</>
                            : !weeklyBossActionsAvailable
                                ? <><GiPadlock style={WB_ICON} />Fight paused</>
                            : contributionDisabled
                                ? <><GiPadlock style={WB_ICON} />Contribution paused</>
                            : lockedOut
                                ? <><GiPadlock style={WB_ICON} />No attempts left</>
                                : <><GiCrossedSwords style={WB_ICON} />Fight Boss ({attemptsLeft} left · 20 stamina)</>}
                    </button>
                )}
                <button className="back-btn" onClick={() => setScreen("centralHub")}>× Back</button>
            </div>
            <h3 style={{ marginTop: "1.2rem" }}>Top 25 Contributors</h3>
            <div style={{ display: "grid", gap: 4 }}>
                {top25.length === 0 && <em style={{ color: "var(--text-muted)" }}>No damage dealt yet.</em>}
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
                            <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>#{i + 1}</span>
                            <span>{player?.name ?? name} {player?.village ? <span style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>· {player.village}</span> : null}</span>
                            <small style={{ color: "var(--slate-300)", fontSize: "0.72rem" }}>{tierLabel}</small>
                            <strong>{(dmg as number).toLocaleString()}</strong>
                        </div>
                    );
                })}
            </div>
            {expired && mySummary && (
                <div style={{ background: "rgba(15,118,110,0.18)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "0.6rem 0.8rem", margin: "0.8rem 0 0.4rem", fontSize: "0.85rem" }}>
                    <strong style={{ color: "var(--green-400)" }}>✓ Rewards distributed.</strong> You earned:
                    <ul style={{ margin: "4px 0 0 18px" }}>
                        <li>+{mySummary.ryo.toLocaleString()} ryo · +10 stat points{mySummary.isMvp ? " (MVP ×2 ryo)" : ""}</li>
                        {mySummary.gotCore && <li>+1 Weekly Boss Core (top 10)</li>}
                        {mySummary.gotKey && <li>+1 Dungeon Key (top 25)</li>}
                    </ul>
                </div>
            )}
            {expired && !mySummary && myDamage > 0 && (
                <p style={{ color: "var(--text-dim)", marginTop: "0.8rem", fontSize: "0.85rem" }}>
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
    /** Shared world pool — max(0, hpMax − Σ damageByPlayer), server-derived. */
    hpRemaining: number;
    /** Server-derived: pool exhausted. Also derived locally as a fallback. */
    broken?: boolean;
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
