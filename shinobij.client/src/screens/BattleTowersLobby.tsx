import { useCallback, useEffect, useMemo, useState } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character } from "../types/character";
import { fetchTowerFloors, startTowerRun, fetchMyRunStatus, fetchSpireLeaderboard, towerPlayerSlug, SPIRE_MAX_TIER, type TowerFloorMeta, type TowerSession, type TowerHostLoadout, type TowerPartyView, type SpireLeaderboardRow, type SpireWeeklyAffix } from "../lib/towers-api";
import {
    allSpireFloors, spireFloorMeta, keystonesUpTo, SPIRE_KEYSTONE_COLOR,
    SPIRE_SHARDS_PER_TIER,
} from "../lib/spire-catalog";
import { battleEntryCost, BATTLE_FREE_FLOORS } from "../lib/entry-fee";
import { subscribeFollowing } from "../lib/friends";
import { LoadingState } from "../components/ui/LoadingState";
import { TowerReadyRoomPanel } from "../components/TowerReadyRoomPanel";
import { TowerPvpPanel } from "../components/TowerPvpPanel";
import type { TowerPvpMatch } from "../lib/tower-pvp-api";
import { readScreenCache, writeScreenCache } from "../lib/screen-cache";
import spireKeyArt from "../assets/towers/spire-banner.webp";
import { resolveTowerStoryArt, resolveTowerStoryChapterArt, TOWER_KEY_ART, TOWER_SPIRE_PORTRAITS } from "../lib/tower-art-manifest";
import {
    groupTowerStoryChapters,
    isTowerStoryFloorActionable,
    orderedTowerStoryFloors,
    recommendedTowerStoryFloor,
} from "../lib/tower-story-catalog";
import "../styles/tower-lobby.css";

const TOWER_MIN_LEVEL = 30;
const FLOOR_CACHE_KEY = "tower-floors:v4";
const FLOOR_CACHE_TTL_MS = 5 * 60_000;

function isTowerFloorList(value: unknown): value is TowerFloorMeta[] {
    return Array.isArray(value) && value.every((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const floor = candidate as Partial<TowerFloorMeta>;
        const reward = floor.firstClearReward;
        const map = floor.map;
        return Number.isFinite(floor.id)
            && typeof floor.name === "string"
            && typeof floor.biome === "string"
            && typeof floor.objective === "string"
            && Number.isFinite(floor.roundBudget)
            && typeof floor.isBoss === "boolean"
            && Number.isFinite(floor.enemyCount)
            && Array.isArray(floor.dynamicHazards)
            && Array.isArray(floor.reinforcementWaves)
            && floor.reinforcementWaves.every(Number.isFinite)
            && !!reward
            && Number.isFinite(reward.ryo)
            && Number.isFinite(reward.statPoints)
            && Number.isFinite(reward.fateShards)
            && Number.isFinite(reward.boneCharms)
            && !!map
            && Number.isFinite(map.width)
            && Number.isFinite(map.height);
    });
}

// ─── Battle Towers Lobby ──────────────────────────────────────────────────────
// Curated squad tower (lives beside the Endless climb in the Celestial Tower).
// Pick a floor and enter the fullscreen fight. onEnter hands the started runId +
// session to the fight shell.
const OBJECTIVE_LABEL: Record<string, string> = {
    "defeat-all": "Defeat all",
    "defeat-boss": "Defeat the boss",
    "defeat-all-then-boss": "Clear, then the boss",
    "protect-npc": "Timed ally hold",
    "kill-escort": "Escort",
    "reach-tile": "Reach the goal",
    "break-objective": "Break the objective",
    "survive": "Survive",
    "kill-adds-first": "Kill the adds first",
};
const BIOME: Record<string, { color: string; icon: string }> = {
    forest: { color: "var(--green-400)", icon: "🌲" },
    snow: { color: "var(--blue-300)", icon: "❄️" },
    volcano: { color: "#fb7185", icon: "🌋" },
    central: { color: "var(--slate-300)", icon: "🏛️" },
    shadow: { color: "#a78bfa", icon: "🌑" },
};

function readableTowerSlug(value: string): string {
    return value.replace(/-/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function towerRoundPaceLabel(objective: string, roundBudget: number): string {
    if (objective === "protect-npc") return `Hold ${roundBudget} rounds`;
    if (objective === "survive") return `Survive ${roundBudget} rounds`;
    return `Par / score pace · ${roundBudget} rounds`;
}

function towerFieldRuleLabel(rule: TowerFloorMeta["fieldRule"]): string {
    if (!rule) return "No floor-wide modifier";
    const kind = rule.kind === "buff" ? "Field boon" : rule.kind === "debuff" ? "Field pressure" : "Field hazard";
    return `${kind}: ${readableTowerSlug(rule.tag)}${rule.percent ? ` ${rule.percent}%` : ""}`;
}

function towerRewardParts(reward: TowerFloorMeta["firstClearReward"]): string[] {
    return [
        reward.ryo > 0 ? `${reward.ryo.toLocaleString()} ryo` : null,
        reward.statPoints > 0 ? `${reward.statPoints} stat point${reward.statPoints === 1 ? "" : "s"}` : null,
        reward.fateShards > 0 ? `${reward.fateShards} Fate Shards` : null,
        reward.boneCharms > 0 ? `${reward.boneCharms} Bone Charms` : null,
        reward.milestone ? `Milestone: ${readableTowerSlug(reward.milestone)}` : null,
    ].filter((part): part is string => Boolean(part));
}

function towerTargetModeLabel(mode: TowerFloorMeta["bossTargetMode"]): string | null {
    if (mode === "lowest-hp") return "Finishes wounded squad members";
    if (mode === "squishiest") return "Hunts the lowest-defense squad member";
    if (mode === "support") return "Prioritizes sustain and support users";
    return null;
}

function towerStrikeLabel(strike: TowerFloorMeta["bossStrike"]): string | null {
    if (!strike) return null;
    const attack = strike.kind === "volley" ? "Volley around a squad target"
        : strike.kind === "slam" ? "Boss-centered slam and knockback"
        : "Boss-centered nova";
    return `${attack} · starts round ${strike.firstRound}, every ${strike.everyRounds} rounds · radius ${strike.radius}`;
}

function towerDynamicHazardLabel(hazard: TowerFloorMeta["dynamicHazards"][number]): string {
    const hazardName = readableTowerSlug(hazard.kind);
    return `${hazard.count} ${hazardName}${hazard.count === 1 ? "" : "s"} · starts round ${hazard.firstRound}, every ${hazard.everyRounds} rounds`;
}

function StoryFloorCard({
    floor,
    selected,
    cleared,
    locked,
    recommended,
    levelEligible,
    onSelect,
}: {
    floor: TowerFloorMeta;
    selected: boolean;
    cleared: boolean;
    locked: boolean;
    recommended: boolean;
    levelEligible: boolean;
    onSelect: (floor: number) => void;
}) {
    const biome = BIOME[floor.biome] ?? { color: "var(--text-dim)", icon: "🗺️" };
    const floorArt = resolveTowerStoryArt(floor.artKey);
    const status = cleared ? "First clear complete"
        : locked ? (levelEligible ? `Locked; clear through Floor ${Math.max(1, floor.id - 1)} first` : `Locked until level ${TOWER_MIN_LEVEL}`)
        : recommended ? "Next story floor"
        : "Available";
    const detailsId = `tower-story-floor-${floor.id}-details`;
    return (
        <div role="listitem" className="tower-story-floor-item">
            <button
                type="button"
                className={`tower-story-floor-card${selected ? " is-selected" : ""}${locked ? " is-locked" : ""}${recommended ? " is-recommended" : ""}`}
                onClick={() => onSelect(floor.id)}
                aria-pressed={selected}
                aria-describedby={detailsId}
                title={locked || recommended ? status : undefined}
                style={{ ["--tower-floor-accent" as string]: biome.color }}
            >
                <span className="tower-story-floor-stripe" aria-hidden="true" />
                <span className={`tower-story-floor-icon${floorArt.kind === "authored" ? " has-art" : ""}`} aria-hidden="true">
                    {floorArt.kind === "authored"
                        ? <><img src={floorArt.src} alt="" loading="lazy" /><span className="tower-story-floor-art-fallback">{floor.isBoss ? "👑" : biome.icon}</span></>
                        : floor.isBoss ? "👑" : biome.icon}
                </span>
                <span className="tower-story-floor-copy">
                    <span className="tower-story-floor-name">
                        <strong>F{floor.id}</strong>
                        <b>{floor.name}</b>
                        {floor.milestone ? <span title="Milestone" aria-label="Milestone floor">⭐</span> : null}
                    </span>
                    <span id={detailsId} className="tower-story-floor-details">
                        {OBJECTIVE_LABEL[floor.objective] ?? readableTowerSlug(floor.objective)} · {readableTowerSlug(floor.biome)}{floor.isBoss ? " · Boss" : ""}
                    </span>
                </span>
                <span className={`tower-story-floor-state${cleared ? " is-cleared" : locked ? " is-locked" : recommended ? " is-next" : ""}`} aria-label={status}>
                    {cleared ? "✓" : locked ? "🔒" : recommended ? "Next" : "Open"}
                </span>
            </button>
        </div>
    );
}

export function BattleTowersLobby({
    character,
    updateCharacter,
    hostLoadout,
    onEnter,
    onEnterPvp,
    onPvpMatchChange,
    onBack,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
    hostLoadout?: TowerHostLoadout;
    onEnter: (runId: string, session: TowerSession) => void;
    onEnterPvp: (match: TowerPvpMatch) => void;
    onPvpMatchChange: (matchId: string | null) => void;
    onBack: () => void;
}) {
    const [floors, setFloors] = useState<TowerFloorMeta[]>(() => orderedTowerStoryFloors(readScreenCache(FLOOR_CACHE_KEY, isTowerFloorList) ?? []));
    const [selected, setSelected] = useState<number | null>(null);
    const [loading, setLoading] = useState(() => !readScreenCache(FLOOR_CACHE_KEY, isTowerFloorList));
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [floorError, setFloorError] = useState<string | null>(null);
    const [floorReloadKey, setFloorReloadKey] = useState(0);
    const [following, setFollowing] = useState<string[]>([]);
    const [pendingRun, setPendingRun] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [runRecoveryPending, setRunRecoveryPending] = useState(false);
    const [activeReadyRoom, setActiveReadyRoom] = useState<TowerPartyView | null>(null);
    const [activePvpMatchId, setActivePvpMatchId] = useState<string | null>(null);
    const handlePvpMatchChange = useCallback((matchId: string | null) => {
        setActivePvpMatchId(matchId);
        onPvpMatchChange(matchId);
    }, [onPvpMatchChange]);
    // Endless Spire (dedicated ascension boss gauntlet). You may enter up to one tier above
    // your highest cleared; the default selection is the next unlocked floor.
    const spireUnlocked = character.battleTowerAscension ?? 0;
    // Admins (authFetch auto-attaches the admin token / password → server bypasses
    // the unlock gate) may SELECT any floor to preview/test it; regular players
    // stay capped at unlocked+1.
    const isAdmin = (() => { try { return !!(sessionStorage.getItem("admin:token") || sessionStorage.getItem("admin:pw")); } catch { return false; } })();
    const spireMaxSelectable = isAdmin ? SPIRE_MAX_TIER : Math.min(SPIRE_MAX_TIER, spireUnlocked + 1);
    const [spireTier, setSpireTier] = useState(Math.min(SPIRE_MAX_TIER, spireUnlocked + 1));
    const [spireBoard, setSpireBoard] = useState<SpireLeaderboardRow[]>([]);
    const [spireAffix, setSpireAffix] = useState<SpireWeeklyAffix | null>(null);

    const bestFloor = character.battleTowerBestFloor ?? 0;
    const rating = character.battleTowerRating ?? 0;
    const cleared = useMemo(() => new Set(character.battleTowerClearedFloors ?? []), [character.battleTowerClearedFloors]);
    const orderedFloors = useMemo(() => orderedTowerStoryFloors(floors), [floors]);
    const storyChapters = useMemo(() => groupTowerStoryChapters(orderedFloors), [orderedFloors]);
    const nextStoryFloor = orderedFloors.some(floor => floor.id === Math.floor(bestFloor) + 1)
        ? Math.floor(bestFloor) + 1
        : null;
    const clearedCatalogFloorCount = orderedFloors.filter(floor => cleared.has(floor.id)).length;
    const me = character.name;
    const entryFee = battleEntryCost(character);
    const towerLevelEligible = isAdmin || (character.level ?? 0) >= TOWER_MIN_LEVEL;
    const storyFloorActionable = (floor: number) => isTowerStoryFloorActionable({
        floor,
        bestFloor,
        clearedFloors: cleared,
        levelEligible: towerLevelEligible,
        admin: isAdmin,
    });
    const readyRoomActive = activeReadyRoom != null && activeReadyRoom.status !== "closed";
    const soloStartBlocked = readyRoomActive || activePvpMatchId != null;

    useEffect(() => {
        let alive = true;
        const cached = readScreenCache(FLOOR_CACHE_KEY, isTowerFloorList);
        const applyCatalog = (list: TowerFloorMeta[]) => {
            const ordered = orderedTowerStoryFloors(list);
            const recommended = recommendedTowerStoryFloor(ordered, bestFloor);
            setFloors(ordered);
            setSelected(current => current != null && ordered.some(floor => floor.id === current) ? current : recommended);
            return ordered;
        };
        // Promote the tab-local cache in a microtask instead of issuing
        // synchronous state updates from this effect body.
        queueMicrotask(() => {
            if (!alive) return;
            if (cached) {
                applyCatalog(cached);
                setLoading(false);
            } else {
                setLoading(true);
            }
        });
        fetchTowerFloors()
            .then(f => {
                if (!isTowerFloorList(f)) throw new Error("The Tower floor catalog was incomplete. Please retry.");
                if (alive) { const ordered = applyCatalog(f); setFloorError(null); writeScreenCache(FLOOR_CACHE_KEY, ordered, FLOOR_CACHE_TTL_MS); }
            })
            .catch(e => { if (alive) setFloorError(String(e?.message ?? e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [bestFloor, floorReloadKey]);

    // Followed players remain available as authenticated Ready Room invite targets.
    useEffect(() => subscribeFollowing(me, setFollowing), [me]);

    // Weekly Spire leaderboard (best-effort; refreshes on mount).
    useEffect(() => {
        let alive = true;
        fetchSpireLeaderboard(25).then(b => { if (alive) { setSpireBoard(b.leaderboard); setSpireAffix(b.affix ?? null); } }).catch(() => {});
        return () => { alive = false; };
    }, []);

    // Backward-compatible active-run fallback. Ready-room members normally enter from
    // the room's own fast poll, but the durable run invite can still recover that handoff.
    useEffect(() => {
        let alive = true;
        // Ignore clan-boss assault runs (`cboss-` prefix) — those settle via the Clan
        // Boss flow, not the tower settle, so they must only be joined from the Clan
        // Boss tab. Joining one here would pay the wrong (tower) settle.
        const check = () => fetchMyRunStatus(me).then(status => {
            if (!alive) return;
            const isTowerRun = Boolean(status?.runId && !status.runId.startsWith("cboss-"));
            setPendingRun(isTowerRun && status?.runId && status.session ? { runId: status.runId, session: status.session } : null);
            setRunRecoveryPending(Boolean(isTowerRun && !status?.session && status?.recoveryPending));
        }).catch(() => {});
        check();
        const stop = visiblePoll(check, 4000);
        return () => { alive = false; stop(); };
    }, [me]);

    async function enterSoloFloor() {
        if (selected == null || starting) return;
        if (soloStartBlocked) {
            setError("Leave your Ready Room or Team Arena match before starting a solo Tower run.");
            return;
        }
        if (!towerLevelEligible) {
            setError(`Battle Towers unlock at level ${TOWER_MIN_LEVEL}.`);
            return;
        }
        if (!storyFloorActionable(selected)) {
            setError(`Clear through Story Floor ${Math.max(1, selected - 1)} before entering Floor ${selected}.`);
            return;
        }
        // Ryo entry fee (first BATTLE_FREE_FLOORS floors/day free). Charged only on a
        // SUCCESSFUL start, so a failed entry never costs ryo.
        const requiredEntryFee = cleared.has(selected) ? 0 : entryFee;
        if (requiredEntryFee > 0 && (character.ryo ?? 0) < requiredEntryFee) {
            setError(`Entry costs ${requiredEntryFee.toLocaleString()} ryo after your ${BATTLE_FREE_FLOORS} free floors today — not enough ryo.`);
            return;
        }
        setStarting(true);
        setError(null);
        try {
            const { runId, session, character: authoritativeCharacter } = await startTowerRun(me, selected, hostLoadout);
            if (authoritativeCharacter) updateCharacter(authoritativeCharacter);
            onEnter(runId, session);
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
            setStarting(false);
        }
    }

    const selFloor = orderedFloors.find(f => f.id === selected);
    const readyRoomBinding = activeReadyRoom?.binding;
    const readyRoomStoryFloor = readyRoomBinding?.mode === "story"
        ? orderedFloors.find(floor => floor.id === readyRoomBinding.floor) ?? null
        : activeReadyRoom ? null : selFloor ?? null;
    const selectedFloorCleared = selFloor ? cleared.has(selFloor.id) : false;
    const selectedFloorActionable = selFloor ? storyFloorActionable(selFloor.id) : false;
    const selectedEntryFee = selectedFloorCleared ? 0 : entryFee;
    const selectedRewardParts = selFloor ? towerRewardParts(selFloor.firstClearReward) : [];
    const selectedTargetMode = selFloor ? towerTargetModeLabel(selFloor.bossTargetMode) : null;
    const selectedStrike = selFloor ? towerStrikeLabel(selFloor.bossStrike) : null;
    const selectedFloorArt = selFloor ? resolveTowerStoryArt(selFloor.artKey) : null;
    const selectedLockReason = selFloor && !selectedFloorActionable
        ? (!towerLevelEligible
            ? `Locked · Battle Towers unlock at level ${TOWER_MIN_LEVEL}.`
            : `Locked · clear through Floor ${Math.max(1, selFloor.id - 1)} to reach this encounter.`)
        : null;

    function focusReadyRoom() {
        const openSpire = document.getElementById("tower-ready-room-open-spire") as HTMLButtonElement | null;
        const room = document.getElementById("tower-ready-room");
        const target = openSpire && !openSpire.disabled ? openSpire : room;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    }

    return (
        <div style={{ maxWidth: 880, margin: "1rem auto", padding: "0 0.8rem 1.5rem", color: "var(--slate-200)" }}>
            {/* Hero banner */}
            <section className="tower-lobby-hero" style={{ ["--tower-lobby-key-art" as string]: `url(${TOWER_KEY_ART})` }} aria-labelledby="tower-lobby-title">
                <div className="tower-lobby-hero-copy">
                    <span className="tower-lobby-hero-kicker">Squad tactical ascent</span>
                    <h1 id="tower-lobby-title">⚔️ Battle Towers</h1>
                    <p>
                        Curated squad floors — objectives, battlefield gimmicks, and bosses with signature mechanics.
                        First few floors free daily, then a small ryo toll; unlimited retries — the gate is tactics, not stamina.
                    </p>
                </div>
            </section>

            {/* Durable active-run fallback if the ready-room launch response was missed. */}
            {pendingRun && (
                <button type="button" onClick={() => onEnter(pendingRun.runId, pendingRun.session)}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
                        padding: "0.85rem", marginBottom: 14, borderRadius: 12, fontWeight: 800, fontSize: "0.98rem",
                        cursor: "pointer", color: "#dbeafe", background: "linear-gradient(180deg,#1e3a8a,#172554)",
                        border: "1px solid var(--blue-400)", boxShadow: "0 0 18px rgba(96,165,250,0.45)",
                    }}>
                    ⚔️ You've been called to a squad run — Floor {pendingRun.session.floor} · Join now ▶
                </button>
            )}
            {runRecoveryPending && !pendingRun && (
                <div className="tower-run-publication" role="status" aria-live="polite">
                    <strong>Your squad run is being recovered</strong>
                    <span>The server is republishing the battlefield. This page will reconnect automatically.</span>
                </div>
            )}

            {/* Stat chips */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <Stat label="Deepest floor" value={String(bestFloor)} color="var(--gold)" />
                <Stat label="Tower rating" value={rating.toLocaleString()} color="#a78bfa" />
                <Stat label="Floors cleared" value={`${clearedCatalogFloorCount}/${orderedFloors.length || "—"}`} color="var(--green-400)" />
            </div>

            {!towerLevelEligible && <div className="tower-level-gate" role="status">Battle Towers unlock at level {TOWER_MIN_LEVEL}. Floors remain visible so you can plan the climb.</div>}

            <TowerPvpPanel
                playerName={character.name}
                unlocked={towerLevelEligible}
                blockedReason={readyRoomActive ? "Leave your co-op Ready Room before entering public 2v2 matchmaking." : null}
                onMatchLockChange={handlePvpMatchChange}
                onEnter={onEnterPvp}
            />

            <TowerReadyRoomPanel
                character={character}
                following={following}
                storyFloor={selected}
                storyFloorMeta={readyRoomStoryFloor}
                storyFloorActionable={selectedFloorActionable}
                spireTier={spireTier}
                towersUnlocked={towerLevelEligible}
                externalBattleActive={activePvpMatchId != null}
                hostLoadout={hostLoadout}
                updateCharacter={updateCharacter}
                onPartyChange={setActiveReadyRoom}
                onEnter={onEnter}
            />

            {/* ── Endless Spire — dedicated ascension boss gauntlet ── */}
            <SpireLadder
                me={me}
                spireUnlocked={spireUnlocked}
                spireMaxSelectable={spireMaxSelectable}
                spireTier={spireTier}
                setSpireTier={setSpireTier}
                weeklyBest={character.battleTowerSpireWeeklyBest ?? 0}
                board={spireBoard}
                affix={spireAffix}
                isAdmin={isAdmin}
                towerUnlocked={towerLevelEligible}
                roomActive={soloStartBlocked}
                onPrepareRoom={focusReadyRoom}
            />

            {loading && <LoadingState>Loading floors…</LoadingState>}
            {floorError && (
                <div className="tower-floor-load-error" role="alert">
                    <span>{orderedFloors.length > 0 ? "Showing the saved floor list; the live briefing refresh failed." : "The Story Tower floor list could not be loaded."} {floorError}</span>
                    <button type="button" onClick={() => setFloorReloadKey(key => key + 1)}>Retry floor list</button>
                </div>
            )}
            {error && <p role="alert" style={{ color: "var(--red-400)" }}>{error}</p>}
            {!loading && orderedFloors.length === 0 && !floorError && (
                <div className="tower-floor-empty" role="status">
                    <strong>No Story Tower floors are available right now.</strong>
                    <button type="button" onClick={() => setFloorReloadKey(key => key + 1)}>Check again</button>
                </div>
            )}

            {!loading && orderedFloors.length > 0 && <h2 id="tower-story-floors-title" className="tower-story-floors-title">Story Tower Campaign</h2>}

            {!loading && orderedFloors.length > 0 && (
                <div className="tower-story-campaign" aria-labelledby="tower-story-floors-title">
                    {storyChapters.map(chapter => {
                        const chapterTitleId = `tower-story-chapter-${chapter.number}-title`;
                        const chapterCleared = chapter.floors.filter(floor => cleared.has(floor.id)).length;
                        const chapterArt = resolveTowerStoryChapterArt(chapter.number, chapter.artKey);
                        return (
                            <section key={chapter.key} className={`tower-story-chapter tower-story-chapter-${chapter.number}`} aria-labelledby={chapterTitleId}>
                                <header
                                    className="tower-story-chapter-head has-art"
                                    data-art-fallback={chapterArt.kind === "fallback" ? "true" : undefined}
                                    style={{ ["--tower-chapter-art" as string]: `url(${chapterArt.src})` }}
                                >
                                    <div className="tower-story-chapter-copy">
                                        <span>Chapter {chapter.number}</span>
                                        <h3 id={chapterTitleId}>{chapter.title}</h3>
                                        {chapter.subtitle ? <p>{chapter.subtitle}</p> : null}
                                        {chapter.summary ? <small>{chapter.summary}</small> : null}
                                    </div>
                                    <div className="tower-story-chapter-progress" aria-label={`${chapterCleared} of ${chapter.floors.length} chapter floors cleared`}>
                                        <strong>{chapterCleared}/{chapter.floors.length}</strong>
                                        <span>cleared</span>
                                    </div>
                                </header>
                                <div className="tower-story-floor-grid" role="list" aria-label={`${chapter.title} floors`}>
                                    {chapter.floors.map(floor => (
                                        <StoryFloorCard
                                            key={floor.id}
                                            floor={floor}
                                            selected={selected === floor.id}
                                            cleared={cleared.has(floor.id)}
                                            locked={!storyFloorActionable(floor.id)}
                                            recommended={floor.id === nextStoryFloor}
                                            levelEligible={towerLevelEligible}
                                            onSelect={setSelected}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {selFloor && (
                <section
                    className="tower-floor-briefing has-art"
                    aria-labelledby="tower-floor-briefing-title"
                    data-art-fallback={selectedFloorArt?.kind === "fallback" ? "true" : undefined}
                >
                    {selectedFloorArt ? (
                        <div
                            className="tower-floor-briefing-hero"
                            aria-hidden="true"
                            style={{ ["--tower-floor-briefing-art" as string]: `url(${selectedFloorArt.src})` }}
                        />
                    ) : null}
                    <div className="tower-floor-briefing-copy">
                        <span className="tower-floor-briefing-kicker">
                            {selFloor.chapter ? `Chapter ${selFloor.chapter} · ` : ""}Selected floor briefing
                        </span>
                        <h2 id="tower-floor-briefing-title">Floor {selFloor.id} · {selFloor.name}</h2>
                        {selFloor.briefing?.situation ? <p className="tower-floor-situation">{selFloor.briefing.situation}</p> : null}
                        <div className="tower-floor-briefing-tags">
                            <span>🎯 {selFloor.objective === "protect-npc"
                                ? "Protect the ally"
                                : OBJECTIVE_LABEL[selFloor.objective] ?? readableTowerSlug(selFloor.objective)}</span>
                            <span>⏱ {towerRoundPaceLabel(selFloor.objective, selFloor.roundBudget)}</span>
                            <span>👹 {selFloor.phaseReinforcementCount
                                ? `${selFloor.enemyCount} starting + ${selFloor.phaseReinforcementCount} phase reinforcements`
                                : <>{selFloor.enemyCount} starting combatant{selFloor.enemyCount === 1 ? "" : "s"}</>}</span>
                        </div>
                        {selFloor.bossMechanic && <p><strong>Boss mechanic:</strong> {readableTowerSlug(selFloor.bossMechanic)}</p>}
                        {selectedTargetMode && <p><strong>🎯 Boss focus:</strong> {selectedTargetMode}</p>}
                        {selectedStrike && <p><strong>⚠️ Telegraph:</strong> {selectedStrike}</p>}
                        {selFloor.closingRing && <p><strong>🔥 Closing ring:</strong> After round {selFloor.closingRing.fromRound};
                            {` ${selFloor.closingRing.percent}% max HP outside the safe radius, shrinking to ${selFloor.closingRing.minRadius} hexes`}</p>}
                        <p><strong>Field rule:</strong> {towerFieldRuleLabel(selFloor.fieldRule)}</p>
                        <p><strong>Reinforcements:</strong> {selFloor.reinforcementWaves.length > 0
                            ? `Rounds ${selFloor.reinforcementWaves.join(", ")}`
                            : "None scheduled"}</p>
                        {selFloor.dynamicHazards.map((hazard, index) => (
                            <p key={`${hazard.kind}-${index}`}><strong>♨️ Field hazard:</strong> {towerDynamicHazardLabel(hazard)}</p>
                        ))}
                        {selFloor.briefing && (selFloor.briefing.tactics.length > 0 || selFloor.briefing.warnings.length > 0) ? (
                            <div className="tower-floor-intel">
                                {selFloor.briefing.tactics.length > 0 ? (
                                    <div>
                                        <strong>Squad plan</strong>
                                        <ul>{selFloor.briefing.tactics.map((tactic, index) => <li key={`${index}-${tactic}`}>{tactic}</li>)}</ul>
                                    </div>
                                ) : null}
                                {selFloor.briefing.warnings.length > 0 ? (
                                    <div className="tower-floor-intel-warnings">
                                        <strong>Watch for</strong>
                                        <ul>{selFloor.briefing.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <div className={`tower-floor-reward${selectedFloorCleared ? " is-claimed" : ""}`}>
                        <span>{selectedFloorCleared ? "First clear recorded" : "First-clear reward"}</span>
                        <strong>{selectedRewardParts.length > 0 ? selectedRewardParts.join(" · ") : "No first-clear package"}</strong>
                        {selectedFloorCleared
                            ? <small>Cleared replay · no entry fee · this one-time package is not paid again.</small>
                            : <small>{selectedEntryFee > 0 ? `Entry preview: ${selectedEntryFee.toLocaleString()} ryo` : "Entry preview: daily free entry available"}</small>}
                        {selectedLockReason ? <small>{selectedLockReason}</small> : null}
                    </div>
                </section>
            )}

            {/* Enter / back */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button
                    style={{
                        flex: "1 1 240px", padding: "0.85rem 1rem", borderRadius: 10, fontWeight: 800, fontSize: "1rem",
                        cursor: selected != null ? "pointer" : "not-allowed", color: "#dcfce7",
                        background: "linear-gradient(180deg,#16803a,#0c5226)", border: "1px solid var(--green-400)",
                        boxShadow: "0 4px 16px rgba(34,197,94,0.3)", opacity: selected == null || loading ? 0.5 : 1,
                    }}
                    onClick={enterSoloFloor}
                    disabled={selected == null || starting || loading || !selectedFloorActionable || soloStartBlocked}
                >
                    {starting ? "Entering solo run…" : soloStartBlocked ? "Finish current Tower activity to start solo" : selFloor ? !selectedFloorActionable ? `🔒 Floor ${selFloor.id} locked` : `▶ Enter Floor ${selFloor.id} solo${selectedEntryFee > 0 ? ` · ${selectedEntryFee.toLocaleString()} ryo` : selectedFloorCleared ? " · free cleared replay" : ""}` : "Select a floor"}
                </button>
                <button className="back-btn tower-lobby-back" onClick={onBack} disabled={starting}
                    title={activeReadyRoom ? "Your Ready Room remains open until you leave it or it expires." : undefined}>
                    × Back to Central{activeReadyRoom ? " · room stays open" : ""}
                </button>
            </div>
        </div>
    );
}

// ─── Endless Spire — the ascension ladder (the flagship climb) ────────────────
// A cinematic hero card for the SELECTED floor (boss portrait, mechanic, keystones,
// reward) atop a 20-rung ladder that makes the whole climb legible at a glance, plus a
// weekly leaderboard. All display data comes from lib/spire-catalog (server mirror).
function SpireLadder({
    me, spireUnlocked, spireMaxSelectable, spireTier, setSpireTier, weeklyBest, board, affix, isAdmin, towerUnlocked, roomActive, onPrepareRoom,
}: {
    me: string;
    spireUnlocked: number;
    spireMaxSelectable: number;
    spireTier: number;
    setSpireTier: (t: number) => void;
    weeklyBest: number;
    board: SpireLeaderboardRow[];
    affix: SpireWeeklyAffix | null;
    isAdmin: boolean;
    towerUnlocked: boolean;
    roomActive: boolean;
    onPrepareRoom: () => void;
}) {
    const floors = allSpireFloors();
    const sel = spireFloorMeta(spireTier);
    const nextFloor = Math.min(SPIRE_MAX_TIER, spireUnlocked + 1); // real progression frontier
    const locked = spireTier > spireMaxSelectable;
    const activeKeystones = keystonesUpTo(spireTier);
    const myRank = board.find(r => towerPlayerSlug(r.name) === towerPlayerSlug(me));
    const progressPct = Math.round((spireUnlocked / SPIRE_MAX_TIER) * 100);
    const accent = sel.boss.accent;

    return (
        <div className="spire-panel" style={{ marginBottom: 14 }}>
            {/* Cinematic banner header — bespoke Endless Spire key art */}
            <div className="spire-banner" style={{ backgroundImage: `url(${spireKeyArt})` }}>
                <div className="spire-banner-overlay">
                    <span className="spire-title">🗼 The Endless Spire</span>
                    <span className="spire-head-stats">
                        <b style={{ color: "#f4c48a" }}>{spireUnlocked}</b><span>/{SPIRE_MAX_TIER} cleared</span>
                        <span className="spire-head-dot">·</span>
                        <span>this week</span> <b style={{ color: "#f4c48a" }}>{weeklyBest}</b>
                        {myRank && <><span className="spire-head-dot">·</span><span>rank</span> <b style={{ color: "var(--gold)" }}>#{myRank.rank}</b></>}
                        {isAdmin && <><span className="spire-head-dot">·</span><b style={{ color: "#5eead4" }} title="Admin: every floor unlocked for testing (you don't need to win — enter to view)">🔓 all floors</b></>}
                    </span>
                </div>
            </div>

            {/* Ascension progress bar with milestone ticks */}
            <div className="spire-progress" title={`${spireUnlocked} of ${SPIRE_MAX_TIER} floors conquered`}>
                <div className="spire-progress-fill" style={{ width: `${progressPct}%` }} />
                {[5, 10, 15, 20].map(m => (
                    <span key={m} className={`spire-progress-tick${spireUnlocked >= m ? " lit" : ""}`} style={{ left: `${(m / SPIRE_MAX_TIER) * 100}%` }} title={`Milestone — Floor ${m}`} />
                ))}
            </div>

            {/* Weekly Blessing — this week's player-favourable affix, telegraphed up front */}
            {affix && (
                <div className="spire-blessing" title={affix.blurb}>
                    <span className="spire-blessing-icon">{affix.icon}</span>
                    <span className="spire-blessing-body">
                        <span className="spire-blessing-label">This Week's Blessing</span>
                        <span className="spire-blessing-name">{affix.name}</span>
                    </span>
                    <span className="spire-blessing-blurb">{affix.blurb}</span>
                </div>
            )}

            {/* Hero — the selected floor's boss */}
            <div className="spire-hero" style={{ ["--boss-accent" as string]: accent, ["--boss-glow" as string]: sel.boss.glow }}>
                <div className="spire-hero-portrait">
                    <img src={TOWER_SPIRE_PORTRAITS[sel.boss.key]} alt={sel.boss.name} loading="lazy" />
                    <span className="spire-hero-floornum">{sel.tier}</span>
                    {sel.isMilestone && <span className="spire-hero-milestone" title={`Clears grant the “${sel.milestoneTitle}” title`}>★</span>}
                </div>
                <div className="spire-hero-body">
                    <div className="spire-hero-band" style={{ color: sel.band.color }}>{sel.band.label} · Floor {sel.tier}</div>
                    <div className="spire-hero-name" style={{ color: accent }}>{sel.boss.name}</div>
                    <div className="spire-hero-tags">
                        <span className="spire-tag" style={{ borderColor: accent, color: accent }}>{sel.boss.mechanicLabel}</span>
                        <span className="spire-tag">🎯 {towerTargetModeLabel(sel.boss.targetMode)}</span>
                        <span className="spire-tag">⚠ {towerStrikeLabel(sel.boss.strike)}</span>
                        {sel.isMilestone && <span className="spire-tag milestone">★ Milestone — {sel.milestoneTitle}</span>}
                        <span className="spire-tag reward">💠 Weekly best · +{SPIRE_SHARDS_PER_TIER} Fate Shards</span>
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
                        {!towerUnlocked ? (
                            <button className="spire-ascend locked" disabled>🔒 Unlocks at level {TOWER_MIN_LEVEL}</button>
                        ) : locked ? (
                            <button className="spire-ascend locked" disabled title={`Clear floor ${spireMaxSelectable} to unlock this`}>
                                🔒 Clear Floor {spireMaxSelectable} first
                            </button>
                        ) : (
                            <button className="spire-ascend" type="button" onClick={onPrepareRoom}
                                title="Progression Spire runs require exactly four live Ready Room members."
                                style={{ ["--boss-accent" as string]: accent }}>
                                {roomActive ? "Review current Ready Room" : "Prepare Spire Ready Room"}
                            </button>
                        )}
                        <small className="spire-practice-note">Select this floor, then open a Spire Ready Room above. Direct AI entry is unavailable for progression integrity.</small>
                    </div>
                </div>
            </div>

            {/* The 20-rung ladder */}
            <div className="spire-ladder">
                {floors.map(f => {
                    const cleared = f.tier <= spireUnlocked;
                    const rungLocked = f.tier > spireMaxSelectable;
                    const next = f.tier === nextFloor && !cleared;
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
                                    : <img src={TOWER_SPIRE_PORTRAITS[f.boss.key]} alt={f.boss.name} loading="lazy" />}
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
                            <li key={r.rank} className={towerPlayerSlug(r.name) === towerPlayerSlug(me) ? "me" : ""}>
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
            <div style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>{label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
        </div>
    );
}
