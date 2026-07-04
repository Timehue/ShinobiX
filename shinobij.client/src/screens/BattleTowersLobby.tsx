import { useEffect, useState } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character } from "../types/character";
import { fetchTowerFloors, startTowerRun, startSpireRun, fetchMyRun, fetchSpireLeaderboard, SPIRE_MAX_TIER, type TowerFloorMeta, type TowerSession, type TowerHostLoadout, type SpireLeaderboardRow } from "../lib/towers-api";
import {
    allSpireFloors, spireFloorMeta, keystonesUpTo, SPIRE_KEYSTONE_COLOR,
    SPIRE_SHARDS_PER_TIER, type SpireBossKey,
} from "../lib/spire-catalog";
import { battleEntryCost, payBattleEntry, BATTLE_FREE_FLOORS } from "../lib/entry-fee";
import { subscribeFollowing } from "../lib/friends";
import { LoadingState } from "../components/ui/LoadingState";
import spireBanner from "../assets/towers/spire.webp";
import wardenPortrait from "../assets/towers/enemies/warden.webp";
import revenantPortrait from "../assets/towers/enemies/revenant.webp";
import ravagerPortrait from "../assets/towers/enemies/ravager.webp";
import sovereignPortrait from "../assets/towers/enemies/sovereign.webp";

const MAX_ALLIES = 3; // you + up to 3 = a 4-player squad
const SPIRE_PORTRAIT: Record<SpireBossKey, string> = {
    warden: wardenPortrait, revenant: revenantPortrait, ravager: ravagerPortrait, sovereign: sovereignPortrait,
};

// ─── Battle Towers Lobby ──────────────────────────────────────────────────────
// Curated squad tower (lives beside the Endless climb in the Celestial Tower).
// Pick a floor and enter the fullscreen fight. onEnter hands the started runId +
// session to the fight shell.
const OBJECTIVE_LABEL: Record<string, string> = {
    "defeat-all": "Defeat all",
    "defeat-boss": "Defeat the boss",
    "defeat-all-then-boss": "Clear, then the boss",
    "protect-npc": "Protect the ally",
    "kill-escort": "Escort",
    "reach-tile": "Reach the goal",
    "break-objective": "Break the objective",
    "survive": "Survive",
    "kill-adds-first": "Kill the adds first",
};
const BIOME: Record<string, { color: string; icon: string }> = {
    forest: { color: "#4ade80", icon: "🌲" },
    snow: { color: "#93c5fd", icon: "❄️" },
    volcano: { color: "#fb7185", icon: "🌋" },
    central: { color: "#cbd5e1", icon: "🏛️" },
    shadow: { color: "#a78bfa", icon: "🌑" },
};

export function BattleTowersLobby({
    character,
    updateCharacter,
    hostLoadout,
    onEnter,
    onBack,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    hostLoadout?: TowerHostLoadout;
    onEnter: (runId: string, session: TowerSession) => void;
    onBack: () => void;
}) {
    const [floors, setFloors] = useState<TowerFloorMeta[]>([]);
    const [selected, setSelected] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [allies, setAllies] = useState<string[]>([]);
    const [following, setFollowing] = useState<string[]>([]);
    const [inviteName, setInviteName] = useState("");
    const [pendingRun, setPendingRun] = useState<{ runId: string; session: TowerSession } | null>(null);
    // Endless Spire (dedicated ascension boss gauntlet). You may enter up to one tier above
    // your highest cleared; the default selection is the next unlocked floor.
    const spireUnlocked = character.battleTowerAscension ?? 0;
    const spireMaxSelectable = Math.min(SPIRE_MAX_TIER, spireUnlocked + 1);
    const [spireTier, setSpireTier] = useState(spireMaxSelectable);
    const [spireBoard, setSpireBoard] = useState<SpireLeaderboardRow[]>([]);

    // Invite any player by name (the server validates the save exists; unknown names are
    // skipped). Deduped case-insensitively against yourself + the existing squad.
    function addAlly(name: string) {
        const n = name.trim();
        const key = n.toLowerCase();
        if (!n || key === me.toLowerCase() || allies.some(a => a.toLowerCase() === key) || allies.length >= MAX_ALLIES) return;
        setAllies([...allies, n]);
        setInviteName("");
    }

    const bestFloor = character.battleTowerBestFloor ?? 0;
    const rating = character.battleTowerRating ?? 0;
    const cleared = new Set(character.battleTowerClearedFloors ?? []);
    const me = character.name;
    const entryFee = battleEntryCost(character);
    const availableAllies = following.filter(f =>
        f.toLowerCase() !== me.toLowerCase() && !allies.some(a => a.toLowerCase() === f.toLowerCase()));

    useEffect(() => {
        let alive = true;
        fetchTowerFloors()
            .then(f => { if (alive) { setFloors(f); setSelected(f[0]?.id ?? null); } })
            .catch(e => { if (alive) setError(String(e?.message ?? e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    // Recruitable allies = the players you follow.
    useEffect(() => subscribeFollowing(me, setFollowing), [me]);

    // Weekly Spire leaderboard (best-effort; refreshes on mount).
    useEffect(() => {
        let alive = true;
        fetchSpireLeaderboard(25).then(b => { if (alive) setSpireBoard(b.leaderboard); }).catch(() => {});
        return () => { alive = false; };
    }, []);

    // Co-op: poll for an active run a host invited us into, so we can JOIN it. Re-checks
    // every few seconds so the banner appears shortly after a friend starts the run.
    useEffect(() => {
        let alive = true;
        const check = () => fetchMyRun(me).then(r => { if (alive) setPendingRun(r); }).catch(() => {});
        check();
        const stop = visiblePoll(check, 4000);
        return () => { alive = false; stop(); };
    }, [me]);

    async function enterFloor() {
        if (selected == null || starting) return;
        // Ryo entry fee (first BATTLE_FREE_FLOORS floors/day free). Charged only on a
        // SUCCESSFUL start, so a failed entry never costs ryo.
        if (entryFee > 0 && (character.ryo ?? 0) < entryFee) {
            setError(`Entry costs ${entryFee.toLocaleString()} ryo after your ${BATTLE_FREE_FLOORS} free floors today — not enough ryo.`);
            return;
        }
        setStarting(true);
        setError(null);
        try {
            const { runId, session } = await startTowerRun(me, selected, allies, hostLoadout);
            const paid = payBattleEntry(character);
            if (paid) updateCharacter(paid);
            onEnter(runId, session);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
            setStarting(false);
        }
    }

    // Endless Spire — fee-exempt (no payBattleEntry); the tier is the escalation, retries are free.
    async function enterSpire() {
        if (starting) return;
        const tier = Math.max(1, Math.min(spireMaxSelectable, spireTier));
        setStarting(true);
        setError(null);
        try {
            const { runId, session } = await startSpireRun(me, tier, allies, hostLoadout);
            onEnter(runId, session);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
            setStarting(false);
        }
    }

    const selFloor = floors.find(f => f.id === selected);

    return (
        <div style={{ maxWidth: 880, margin: "1rem auto", padding: "0 0.8rem 1.5rem", color: "#e2e8f0" }}>
            {/* Hero banner */}
            <div style={{
                position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 14,
                border: "1px solid #334155", boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                background: `linear-gradient(180deg, rgba(8,12,24,0.25) 0%, rgba(8,12,24,0.92) 100%), url(${spireBanner}) center 30%/cover no-repeat`,
                minHeight: 168, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "1.1rem 1.3rem",
            }}>
                <h1 style={{ margin: 0, fontSize: "2.1rem", letterSpacing: 0.5, textShadow: "0 3px 12px rgba(0,0,0,0.9)" }}>⚔️ Battle Towers</h1>
                <p style={{ margin: "4px 0 0", color: "#cbd5e1", maxWidth: 620, fontSize: "0.9rem", textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>
                    Curated squad floors — objectives, battlefield gimmicks, and bosses with signature mechanics.
                    First few floors free daily, then a small ryo toll; unlimited retries — the gate is tactics, not stamina.
                </p>
            </div>

            {/* Co-op join banner — appears when a host has invited you into their run */}
            {pendingRun && (
                <button onClick={() => onEnter(pendingRun.runId, pendingRun.session)}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
                        padding: "0.85rem", marginBottom: 14, borderRadius: 12, fontWeight: 800, fontSize: "0.98rem",
                        cursor: "pointer", color: "#dbeafe", background: "linear-gradient(180deg,#1e3a8a,#172554)",
                        border: "1px solid #60a5fa", boxShadow: "0 0 18px rgba(96,165,250,0.45)",
                    }}>
                    ⚔️ You've been called to a squad run — Floor {pendingRun.session.floor} · Join now ▶
                </button>
            )}

            {/* Stat chips */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Stat label="Deepest floor" value={String(bestFloor)} color="#facc15" />
                <Stat label="Tower rating" value={rating.toLocaleString()} color="#a78bfa" />
                <Stat label="Floors cleared" value={`${cleared.size}/${floors.length || "—"}`} color="#4ade80" />
            </div>

            {/* ── Endless Spire — dedicated ascension boss gauntlet ── */}
            <SpireLadder
                me={me}
                spireUnlocked={spireUnlocked}
                spireMaxSelectable={spireMaxSelectable}
                spireTier={spireTier}
                setSpireTier={setSpireTier}
                weeklyBest={character.battleTowerSpireWeeklyBest ?? 0}
                board={spireBoard}
                starting={starting}
                onAscend={enterSpire}
            />

            {/* Squad assembly */}
            <div style={{ padding: "0.8rem 0.9rem", borderRadius: 12, border: "1px solid #293548", background: "linear-gradient(180deg,#0e1626,#0a111f)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.98rem" }}>🛡 Your Squad <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: "0.8rem" }}>· you + up to {MAX_ALLIES} allies</span></strong>
                    <span style={{ color: "#64748b", fontSize: "0.76rem" }}>Invited players get a “join” prompt and fight live alongside you</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <SquadChip name={me} you />
                    {allies.map(a => <SquadChip key={a} name={a} onRemove={() => setAllies(allies.filter(x => x !== a))} />)}
                    {allies.length < MAX_ALLIES && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {/* Invite ANY player by name */}
                            <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addAlly(inviteName); } }}
                                placeholder="Invite player by name…" maxLength={24}
                                style={{ padding: "0.4rem 0.7rem", borderRadius: 20, background: "#0b1220", color: "#e2e8f0", border: "1px solid #475569", fontSize: "0.82rem", width: 170 }} />
                            <button onClick={() => addAlly(inviteName)} disabled={!inviteName.trim()}
                                style={{ padding: "0.4rem 0.8rem", borderRadius: 20, fontWeight: 700, fontSize: "0.8rem", cursor: inviteName.trim() ? "pointer" : "default", color: "#dbeafe", background: "linear-gradient(180deg,#1e3a8a,#172554)", border: "1px solid #3b5278", opacity: inviteName.trim() ? 1 : 0.5 }}>
                                + Invite
                            </button>
                            {/* Quick-add from players you follow */}
                            {availableAllies.length > 0 && (
                                <select value="" onChange={e => { if (e.target.value) addAlly(e.target.value); }}
                                    style={{ padding: "0.4rem 0.6rem", borderRadius: 20, background: "#0b1220", color: "#cbd5e1", border: "1px dashed #475569", cursor: "pointer", fontSize: "0.82rem" }}>
                                    <option value="">+ From follows…</option>
                                    {availableAllies.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            )}
                        </span>
                    )}
                </div>
            </div>

            {loading && <LoadingState>Loading floors…</LoadingState>}
            {error && <p style={{ color: "#f87171" }}>{error}</p>}

            {!loading && floors.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginBottom: 16 }}>
                    {floors.map(f => {
                        const isCleared = cleared.has(f.id);
                        const isSel = selected === f.id;
                        const b = BIOME[f.biome] ?? { color: "#94a3b8", icon: "🗺️" };
                        return (
                            <button
                                key={f.id}
                                onClick={() => setSelected(f.id)}
                                style={{
                                    position: "relative", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                    padding: "0.7rem 0.8rem 0.7rem 0.9rem", borderRadius: 10, overflow: "hidden",
                                    border: `1px solid ${isSel ? "#60a5fa" : "#293548"}`,
                                    background: isSel ? "linear-gradient(180deg,#16263f,#0d1830)" : "linear-gradient(180deg,#0e1626,#0a111f)",
                                    boxShadow: isSel ? "0 0 0 1px #60a5fa, 0 6px 18px rgba(37,99,235,0.25)" : "0 2px 8px rgba(0,0,0,0.4)",
                                    cursor: "pointer", color: "#e2e8f0",
                                }}
                            >
                                {/* biome color stripe */}
                                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: b.color }} />
                                <span style={{ fontSize: 22, width: 34, textAlign: "center", flexShrink: 0 }}>{f.isBoss ? "👑" : b.icon}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <strong style={{ color: b.color, fontSize: "0.78rem", letterSpacing: 0.5 }}>F{f.id}</strong>
                                        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</strong>
                                        {f.milestone && <span title="Milestone" style={{ fontSize: 13 }}>⭐</span>}
                                    </span>
                                    <span style={{ display: "block", color: "#94a3b8", fontSize: "0.78rem", marginTop: 2 }}>
                                        {OBJECTIVE_LABEL[f.objective] ?? f.objective} · {f.biome}{f.isBoss ? " · boss" : ""}
                                    </span>
                                </span>
                                {isCleared && <span title="First-cleared" style={{ color: "#4ade80", fontWeight: 800, flexShrink: 0 }}>✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Enter / back */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                    style={{
                        flex: "1 1 240px", padding: "0.85rem 1rem", borderRadius: 10, fontWeight: 800, fontSize: "1rem",
                        cursor: selected != null ? "pointer" : "not-allowed", color: "#dcfce7",
                        background: "linear-gradient(180deg,#16803a,#0c5226)", border: "1px solid #4ade80",
                        boxShadow: "0 4px 16px rgba(34,197,94,0.3)", opacity: selected == null || loading ? 0.5 : 1,
                    }}
                    onClick={enterFloor}
                    disabled={selected == null || starting || loading}
                >
                    {starting ? "Entering…" : selFloor ? `▶ Enter Floor ${selFloor.id} — ${selFloor.name}${allies.length ? ` · ${allies.length + 1}-player squad` : ""}${entryFee > 0 ? ` · ${entryFee.toLocaleString()} ryo` : ""}` : "Select a floor"}
                </button>
                <button className="back-btn" onClick={onBack}>× Back to Central</button>
            </div>
        </div>
    );
}

// ─── Endless Spire — the ascension ladder (the flagship climb) ────────────────
// A cinematic hero card for the SELECTED floor (boss portrait, mechanic, keystones,
// reward) atop a 20-rung ladder that makes the whole climb legible at a glance, plus a
// weekly leaderboard. All display data comes from lib/spire-catalog (server mirror).
function SpireLadder({
    me, spireUnlocked, spireMaxSelectable, spireTier, setSpireTier, weeklyBest, board, starting, onAscend,
}: {
    me: string;
    spireUnlocked: number;
    spireMaxSelectable: number;
    spireTier: number;
    setSpireTier: (t: number) => void;
    weeklyBest: number;
    board: SpireLeaderboardRow[];
    starting: boolean;
    onAscend: () => void;
}) {
    const floors = allSpireFloors();
    const sel = spireFloorMeta(spireTier);
    const locked = spireTier > spireMaxSelectable;
    const isNext = spireTier === spireMaxSelectable && spireUnlocked < SPIRE_MAX_TIER;
    const activeKeystones = keystonesUpTo(spireTier);
    const myRank = board.find(r => r.name.toLowerCase() === me.toLowerCase());
    const progressPct = Math.round((spireUnlocked / SPIRE_MAX_TIER) * 100);
    const accent = sel.boss.accent;

    return (
        <div className="spire-panel" style={{ marginBottom: 14 }}>
            {/* Header */}
            <div className="spire-panel-head">
                <span className="spire-title">🗼 The Endless Spire</span>
                <span className="spire-head-stats">
                    <b style={{ color: "#f4c48a" }}>{spireUnlocked}</b><span>/{SPIRE_MAX_TIER} cleared</span>
                    <span className="spire-head-dot">·</span>
                    <span>this week</span> <b style={{ color: "#f4c48a" }}>{weeklyBest}</b>
                    {myRank && <><span className="spire-head-dot">·</span><span>rank</span> <b style={{ color: "#facc15" }}>#{myRank.rank}</b></>}
                </span>
            </div>

            {/* Ascension progress bar with milestone ticks */}
            <div className="spire-progress" title={`${spireUnlocked} of ${SPIRE_MAX_TIER} floors conquered`}>
                <div className="spire-progress-fill" style={{ width: `${progressPct}%` }} />
                {[5, 10, 15, 20].map(m => (
                    <span key={m} className={`spire-progress-tick${spireUnlocked >= m ? " lit" : ""}`} style={{ left: `${(m / SPIRE_MAX_TIER) * 100}%` }} title={`Milestone — Floor ${m}`} />
                ))}
            </div>

            {/* Hero — the selected floor's boss */}
            <div className="spire-hero" style={{ ["--boss-accent" as string]: accent, ["--boss-glow" as string]: sel.boss.glow }}>
                <div className="spire-hero-portrait">
                    <img src={SPIRE_PORTRAIT[sel.boss.key]} alt={sel.boss.name} loading="lazy" />
                    <span className="spire-hero-floornum">{sel.tier}</span>
                    {sel.isMilestone && <span className="spire-hero-milestone" title={`Clears grant the “${sel.milestoneTitle}” title`}>★</span>}
                </div>
                <div className="spire-hero-body">
                    <div className="spire-hero-band" style={{ color: sel.band.color }}>{sel.band.label} · Floor {sel.tier}</div>
                    <div className="spire-hero-name" style={{ color: accent }}>{sel.boss.name}</div>
                    <div className="spire-hero-tags">
                        <span className="spire-tag" style={{ borderColor: accent, color: accent }}>{sel.boss.mechanicLabel}</span>
                        {sel.isMilestone && <span className="spire-tag milestone">★ Milestone — {sel.milestoneTitle}</span>}
                        <span className="spire-tag reward">💠 +{SPIRE_SHARDS_PER_TIER} Fate Shards</span>
                    </div>
                    <p className="spire-hero-blurb">{sel.boss.blurb}</p>

                    {activeKeystones.length > 0 && (
                        <div className="spire-keystones">
                            <span className="spire-keystones-label">Threats in play</span>
                            <div className="spire-keystones-chips">
                                {activeKeystones.map(k => (
                                    <span key={k.tier} className="spire-keystone-chip" title={k.blurb}
                                        style={{ color: SPIRE_KEYSTONE_COLOR[k.kind], borderColor: SPIRE_KEYSTONE_COLOR[k.kind] + "55" }}>
                                        {k.name}{k.tier === sel.tier ? " ⟵ new" : ""}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="spire-hero-cta">
                        <div className="spire-stepper">
                            <button onClick={() => setSpireTier(Math.max(1, spireTier - 1))} disabled={spireTier <= 1} aria-label="Lower floor">−</button>
                            <span>Floor {spireTier}</span>
                            <button onClick={() => setSpireTier(Math.min(spireMaxSelectable, spireTier + 1))} disabled={spireTier >= spireMaxSelectable} aria-label="Higher floor">+</button>
                        </div>
                        {locked ? (
                            <button className="spire-ascend locked" disabled title={`Clear floor ${spireMaxSelectable} to unlock this`}>
                                🔒 Clear Floor {spireMaxSelectable} first
                            </button>
                        ) : (
                            <button className="spire-ascend" onClick={onAscend} disabled={starting}
                                style={{ ["--boss-accent" as string]: accent }}>
                                {starting ? "Entering…" : isNext ? `▲ Ascend — Floor ${spireTier}` : `⟳ Re-climb Floor ${spireTier}`}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* The 20-rung ladder */}
            <div className="spire-ladder">
                {floors.map(f => {
                    const cleared = f.tier <= spireUnlocked;
                    const rungLocked = f.tier > spireMaxSelectable;
                    const next = f.tier === spireMaxSelectable && !cleared;
                    const state = rungLocked ? "locked" : next ? "next" : cleared ? "cleared" : "open";
                    return (
                        <button key={f.tier} className={`spire-rung ${state}${f.tier === spireTier ? " selected" : ""}`}
                            onClick={() => { if (!rungLocked) setSpireTier(f.tier); }} disabled={rungLocked}
                            style={{ ["--boss-accent" as string]: f.boss.accent, ["--band" as string]: f.band.color }}
                            title={`Floor ${f.tier} — ${f.boss.name}${f.isMilestone ? ` (★ ${f.milestoneTitle})` : ""}`}>
                            <span className="spire-rung-num">{f.tier}</span>
                            <span className="spire-rung-portrait">
                                {rungLocked
                                    ? <span className="spire-rung-lock">🔒</span>
                                    : <img src={SPIRE_PORTRAIT[f.boss.key]} alt={f.boss.name} loading="lazy" />}
                            </span>
                            <span className="spire-rung-info">
                                <span className="spire-rung-boss">{f.boss.name}</span>
                                <span className="spire-rung-mech">{f.boss.mechanicLabel}</span>
                            </span>
                            {f.isMilestone && <span className="spire-rung-star" title={f.milestoneTitle}>★</span>}
                            {cleared && <span className="spire-rung-check">✓</span>}
                            {next && <span className="spire-rung-next">▶</span>}
                        </button>
                    );
                })}
            </div>

            {/* Weekly leaderboard */}
            {board.length > 0 && (
                <div className="spire-board">
                    <div className="spire-board-head">🏆 This Week's Ascendants</div>
                    <ol className="spire-board-list">
                        {board.slice(0, 5).map(r => (
                            <li key={r.rank} className={r.name.toLowerCase() === me.toLowerCase() ? "me" : ""}>
                                <span className="spire-board-rank">#{r.rank}</span>
                                <span className="spire-board-name">{r.name}</span>
                                <span className="spire-board-tier">Floor {r.tier}</span>
                            </li>
                        ))}
                        {myRank && myRank.rank > 5 && (
                            <li className="me distant">
                                <span className="spire-board-rank">#{myRank.rank}</span>
                                <span className="spire-board-name">{myRank.name}</span>
                                <span className="spire-board-tier">Floor {myRank.tier}</span>
                            </li>
                        )}
                    </ol>
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div style={{ flex: "1 1 140px", padding: "0.7rem 0.9rem", borderRadius: 10, background: "linear-gradient(180deg,#0e1626,#0a111f)", border: "1px solid #293548" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
        </div>
    );
}

function SquadChip({ name, you, onRemove }: { name: string; you?: boolean; onRemove?: () => void }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "0.35rem 0.7rem", borderRadius: 20, fontSize: "0.84rem",
            background: you ? "linear-gradient(180deg,#15301f,#0d2014)" : "linear-gradient(180deg,#142036,#0d1830)",
            border: `1px solid ${you ? "#4ade80" : "#3b5278"}`, color: "#e2e8f0",
        }}>
            <span style={{ fontSize: 14 }}>{you ? "🥷" : "🤝"}</span>
            <strong style={{ fontWeight: 700, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
            {you
                ? <span style={{ color: "#86efac", fontSize: "0.72rem" }}>you</span>
                : onRemove && <button onClick={onRemove} title="Remove" style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>}
        </span>
    );
}
