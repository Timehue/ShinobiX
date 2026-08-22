import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/hub-screens-skin.css";
import type React from "react";
import type { CSSProperties } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { DAILY_MISSION_LIMIT, FIELD_MISSION_STAT_POINTS } from "../constants/game";
import { DailyProfessionMissions } from "../screens/DailyProfessionMissions";
import { WeeklyBoard } from "../components/WeeklyBoard";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { EmptyState } from "../components/ui/EmptyState";
// Currency rewards keep the game's own emblems; navigation uses typography
// and destination artwork instead of repeating the same chrome glyphs.
import { GameIcon } from "../components/icons/GameIcon";
import { rewardSummary, statPointNote } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyMissionsCompleted, hasDailyMissionSlot } from "../lib/character-progress";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { builtinFetchMissions, mergeBuiltinMissions, missionRaidProgressKey, missionRaidRequirement, sortFieldMissions } from "../data/missions";
import { COMBAT_MISSIONS, type CombatMission } from "../data/combat-missions";
import { gainXp } from "../App";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { commitAuthoritativeMissionClaim } from "../lib/versioned-mission-claim";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { questbookEntry, questbookStage, metricLabel } from "../lib/questbook";
import { WANDERER_QUEST_CATALOG, questMetricForId } from "../lib/wanderers";
import { emissaryQuestById, emissaryByQuestId } from "../lib/legacy-emissaries";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { reportPveFightOutcome } from "../lib/pve-outcome-api";
import { sectorPhrase } from "../lib/hollow-rifts";
import { MissionArenaFight } from "./MissionArenaFight";
import type { SoloPveSession } from "../lib/solo-pve-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import type { GameItem, SavedBloodline, Jutsu } from "../types/combat";
import { enqueueClaim, removeClaim } from "../lib/claim-outbox";
import { queueCombatMissionClaim } from "../lib/mission-combat-claim";
import { postFieldTrail, type FieldTrailResult } from "../lib/field-trail-api";
import missionHallArt from "../assets/facilities/mission-hall.webp";
import { sectorArtKey, sectorName, sectorRegionLabel } from "../../../shared/sector-geo";

export function Missions({
    character,
    updateCharacter,
    onVersionedCharacter,
    onServerVersion,
    creatorAis,
    creatorMissions,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setScreen,
    onBack,
    onMissionBattleStart,
    onMissionBattleEnd,
    sharedImages,
    creatorItems,
    savedBloodlines,
    creatorJutsus,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onVersionedCharacter: VersionedCharacterCommit;
    onServerVersion?: (version?: number) => boolean | void;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: React.Dispatch<React.SetStateAction<string[]>>;
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    setScreen: (screen: Screen) => void;
    onBack: () => void;
    onMissionBattleStart?: () => void;
    onMissionBattleEnd?: () => void;
    sharedImages?: Record<string, string>;
    creatorItems?: GameItem[];
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
}) {
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    const [authoritativeFight, setAuthoritativeFight] = useState<{ mission: CombatMission; runId: string; session: SoloPveSession } | null>(null);
    const onMissionBattleEndRef = useRef(onMissionBattleEnd);
    useEffect(() => { onMissionBattleEndRef.current = onMissionBattleEnd; }, [onMissionBattleEnd]);
    useEffect(() => () => { onMissionBattleEndRef.current?.(); }, []);
    const [startingCombat, setStartingCombat] = useState(false);
    const [fieldTrailPending, setFieldTrailPending] = useState<string | null>(null);
    // Keep every hook above the authoritative-fight early return so hook order is
    // stable while entering and leaving the inline server-resolved battle.
    const [activeMissionTab, setActiveMissionTab] = useState<"profession" | "combat" | "field" | "weekly" | "wandering">(
        character.profession ? "profession" : "combat"
    );

    // One claim at a time, across every claim button on this screen.
    //
    // The buttons had no in-flight guard, and the eligibility checks inside each
    // handler read state that only updates AFTER the await — so a double-tap (easy on
    // a phone) fired two requests. Rewards are server-authoritative, so nothing was
    // ever paid twice; what the player saw was worse than a dupe. The first reply
    // alerted "mission complete, +240 XP" and the second alerted the already-claimed
    // rejection, and because alerts are queued blocking modals they read in sequence
    // as "your reward was taken back".
    //
    // The guard is a REF, not just state: React state updates are asynchronous, so two
    // taps in the same tick would both see the old value. The ref flips synchronously;
    // `claimingKey` exists only to drive the disabled state and label.
    //
    // It is also deliberately global rather than per-mission: every claim mutates the
    // same character and the same daily-mission counter, so two different claims in
    // flight together can both pass hasDailyMissionSlot.
    const claimInFlightRef = useRef(false);
    const [claimingKey, setClaimingKey] = useState<string | null>(null);
    const runClaim = useCallback(async (key: string, claim: () => Promise<void>) => {
        if (claimInFlightRef.current) return;
        claimInFlightRef.current = true;
        setClaimingKey(key);
        try {
            await claim();
        } finally {
            // Always clear, including on throw — a stuck flag would disable every
            // claim button for the rest of the session.
            claimInFlightRef.current = false;
            setClaimingKey(null);
        }
    }, []);
    const adoptFieldTrail = useCallback((result: FieldTrailResult): boolean => {
        if (!result.character || !onVersionedCharacter(result.character, result._saveVersion)) return false;
        if (result.acceptedMissionIds) setAcceptedMissionIds(result.acceptedMissionIds);
        if (result.missionProgress) setMissionProgress(result.missionProgress);
        return true;
    }, [onVersionedCharacter, setAcceptedMissionIds, setMissionProgress]);
    const acceptedFieldMissionKey = acceptedMissionIds
        .filter((id) => builtinFetchMissions.some((mission) => mission.id === id))
        .sort()
        .join("|");

    async function startMissionBattle(mission: CombatMission) {
        if (character.level < mission.min) return alert(`Requires level ${mission.min}.`);
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        if (startingCombat) return;
        onMissionBattleStart?.();
        setStartingCombat(true);
        let fightMounted = false;
        try {
            const response = await fetch("/api/missions/combat-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, missionId: mission.key }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.runId || !data?.session) {
                alert(data?.error ?? "The mission fight could not be started.");
                return;
            }
            setAuthoritativeFight({ mission, runId: data.runId, session: data.session });
            fightMounted = true;
        } finally {
            setStartingCombat(false);
            if (!fightMounted) onMissionBattleEnd?.();
        }
    }

    async function settleAuthoritativeMission(runId: string, playerName: string): Promise<unknown> {
        if (!authoritativeFight) return null;
        const missionId = authoritativeFight.mission.key;
        enqueueClaim(playerName, missionId, runId);
        const data = await queueCombatMissionClaim(playerName, missionId, runId, 1);
        if (data.disposition === "retryable") {
            throw new Error("Mission settlement is saved for reconnect and will retry automatically.");
        }
        removeClaim(playerName, missionId, runId);
        if (data.disposition !== "accepted" || data.queued !== true || !data.character || typeof data.saveVersion !== "number") {
            throw new Error(data.reason ?? "Mission settlement failed.");
        }
        if (!onVersionedCharacter(data.character, data.saveVersion)) {
            throw new Error("A newer save was already loaded. The mission result will reconcile from the server.");
        }
        return data;
    }

    /** The mission fight's physical cost — surviving HP, or the hospital stay on
     *  a defeat or a forfeit. Pays nothing; the reward stays on the claim step. */
    async function reportMissionFightOutcome(runId: string, playerName: string) {
        const applied = await reportPveFightOutcome(runId, playerName);
        if (applied?.character) {
            if (!onVersionedCharacter(applied.character, applied._saveVersion)) return;
        }
        return applied;
    }

    useEffect(() => {
        const owner = character.name;
        const ids = acceptedFieldMissionKey ? acceptedFieldMissionKey.split("|") : [];
        if (ids.length === 0) return;
        let cancelled = false;
        void (async () => {
            for (const missionId of ids) {
                const result = await postFieldTrail({ playerName: owner, missionId, action: "state" });
                if (cancelled) return;
                if (!adoptFieldTrail(result)) continue;
                if (result.migrated) window.setTimeout(() => alert("The Mission Hall recalibrated an older field contract onto its verified ledger."), 40);
            }
        })();
        return () => { cancelled = true; };
    }, [acceptedFieldMissionKey, adoptFieldTrail, character.name]);

    if (authoritativeFight) {
        return (
            <MissionArenaFight
                character={character}
                sharedImages={sharedImages}
                runId={authoritativeFight.runId}
                initialSession={soloPveSessionForArena(authoritativeFight.session)}
                transport={soloPveArenaTransport}
                missionName={authoritativeFight.mission.name}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                settleFn={settleAuthoritativeMission}
                onBattleResolved={onMissionBattleEnd}
                // A failed mission has to cost something. settleAuthoritativeMission
                // only runs on a win, so without this a defeat left the player at
                // full HP and free to re-enter immediately.
                outcomeFn={reportMissionFightOutcome}
                onExit={() => { onMissionBattleEnd?.(); setAuthoritativeFight(null); }}
            />
        );
    }
    // Combat missions are won in the Arena (which only queues the claim on the
    // character) and paid out HERE. Mirrors the field-mission / hunt claim
    // pattern: per-rank XP + ryo (matching the card), +1 Territory Scroll, and
    // the kill-counter / daily-mission bookkeeping that used to run on the win.
    // No stamina — stamina is not part of any mission reward.
    // Server-authoritative: the win only queued the claim (pendingCombatMissionClaims);
    // the SERVER recomputes + pays the reward (so the client can't inflate it), then
    // we mirror the returned amounts onto the local character.
    function applySuccessfulMissionClaim(result: Extract<NonNullable<Awaited<ReturnType<typeof postClaimMission>>>, { applied: true }>): boolean {
        const authoritativeCommit = commitAuthoritativeMissionClaim(result, onVersionedCharacter);
        if (authoritativeCommit !== null) return authoritativeCommit;
        if (onServerVersion?.(result._saveVersion) === false) return false;
        updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
        return true;
    }

    async function claimCombatMission(mission: CombatMission) {
        if (!(character.pendingCombatMissionClaims ?? []).includes(mission.key)) return;
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        const result = await postClaimMission(character.name, "combat", mission.key);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === false) {
            // Stale-flag trap: the server self-heals by clearing its durable pending
            // flag and returning this reason (the authority token expired / predates
            // the token gate). Mirror the clear so the card flips back to "Begin
            // Mission" now, instead of waiting for a save refetch — then re-fighting
            // re-mints the token and pays out.
            if (result.reason === "server_authoritative_combat_required") {
                updateCharacter((prev) => (prev
                    ? { ...prev, pendingCombatMissionClaims: (prev.pendingCombatMissionClaims ?? []).filter((k) => k !== mission.key) }
                    : prev));
            }
            return alert(claimReasonMessage(result.reason));
        }
        if (!applySuccessfulMissionClaim(result)) return;
        alert(`${mission.name} complete! ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina,result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls })}.`);
    }
    // Onboarding "Academy Trial" — a one-time, server-authoritative, off-the-daily-cap
    // reward that teaches the do→return→claim loop. Sets academyTrialClaimed, which
    // advances the OnboardingCoach firstMission → logbook beat.
    async function claimAcademyTrial() {
        const result = await postClaimMission(character.name, "academy-trial", "academy-trial");
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === false) return alert(claimReasonMessage(result.reason));
        if (!applySuccessfulMissionClaim(result)) return;
        alert(`Academy Trial complete! ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina,result.reward.currency, character)}. Now open your Logbook to see your goals.`);
    }
    const showAcademyTrial = normalizeOnboardingStep(character.onboardingStep) === "firstMission" && !character.academyTrialClaimed;
    function startCreatorMissionBattle(_mission: CreatorMission) {
        // Creator-authored field missions do not yet have a server-sealed mission
        // run/claim receipt. A generic AI token would pay an ordinary fight while
        // leaving the field card locally claimable, so fail closed until publish
        // produces the same run-bound contract as built-in Combat Missions.
        alert("This creator mission battle is awaiting a sealed Mission Hall contract. No attempt or reward was consumed.");
    }
    async function acceptFetchMission(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        if (!builtinFetchMissions.some((entry) => entry.id === mission.id)) {
            return alert("This creator field mission is awaiting a published server contract. Nothing was accepted.");
        }
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if (fieldTrailPending || acceptedMissionIds.includes(mission.id)) return;
        setFieldTrailPending(mission.id);
        try {
            const result = await postFieldTrail({ playerName: character.name, missionId: mission.id, action: "accept" });
            const adopted = adoptFieldTrail(result);
            if (!result.ok) return alert(result.error ?? "The Mission Hall could not accept this contract.");
            if (!adopted) return alert("The Mission Hall accepted this contract, but its ledger is still syncing. Reopen the board to recover it.");
            if (result.reason === "already-claimed-today") {
                return alert("That contract was already claimed today. The Mission Hall refreshed your ledger instead of accepting it again.");
            }
            if (!result.state) return alert("The Mission Hall did not issue an active run. Reopen the board before attempting this contract.");
            const raidReq = missionRaidRequirement(mission);
            alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times${raidReq > 0 ? ` and raid the village ${raidReq} time(s)` : ""}, then return to the Mission Hall to claim the posted reward.`);
        } finally {
            setFieldTrailPending(null);
        }
    }
    async function abandonFetchMission(mission: CreatorMission) {
        if (fieldTrailPending) return;
        if (!builtinFetchMissions.some((entry) => entry.id === mission.id)) {
            return alert("This unpublished mission cannot alter the server contract ledger.");
        }
        setFieldTrailPending(mission.id);
        try {
            const result = await postFieldTrail({ playerName: character.name, missionId: mission.id, action: "abandon" });
            const adopted = adoptFieldTrail(result);
            if (!result.ok) return alert(result.error ?? "The Mission Hall could not abandon this contract.");
            if (!adopted) return alert("The Mission Hall is still syncing this contract. Reopen the board to recover it.");
        } finally {
            setFieldTrailPending(null);
        }
    }

    // Server-authoritative field claims. Unknown/creator-authored mission ids are
    // rejected by the server instead of paid locally.
    async function claimFetchMission(mission: CreatorMission) {
        if (!requireServerSettlement("fieldHuntMissions")) return;
        const progress = missionProgress[mission.id] ?? 0;
        const raidReq = missionRaidRequirement(mission);
        const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
        if (progress < mission.exploreCount) return alert(`Explore Sector ${mission.targetSector} ${mission.exploreCount - progress} more time(s).`);
        if (raidProgress < raidReq) return alert(`Raid from Sector ${mission.targetSector} ${raidReq - raidProgress} more time(s).`);
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        const result = await postClaimMission(character.name, "field", mission.id);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === true) {
            if (!applySuccessfulMissionClaim(result)) return;
            setAcceptedMissionIds((prev) => prev.filter((id) => id !== mission.id));
            setMissionProgress((prev) => ({ ...prev, [mission.id]: 0, [missionRaidProgressKey(mission.id)]: 0 }));
            alert(`${mission.name} complete. ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina,result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls })}.`);
            return;
        }
        if (result.applied === false) {
            if (result.reason === "already-claimed-today"
                || result.reason === "already-claimed"
                || result.reason === "not-accepted") {
                // A dropped claim ACK can replay after the server already paid
                // and cleared this exact run. Re-read the durable field ledger
                // so the paid character/version and cleared card arrive together;
                // never manufacture that reconciliation from local counters.
                const state = await postFieldTrail({ playerName: character.name, missionId: mission.id, action: "state" });
                if (!adoptFieldTrail(state)) {
                    return alert("The reward status is still syncing with the Mission Hall. Try Claim again to reconcile it safely.");
                }
                return alert(claimReasonMessage(result.reason, result));
            }
            if (result.serverProgress) {
                // Self-heal the stale-claim trap, mirroring HunterBoard's hunt fix.
                // Local explore/raid counters are optimistic; the server receipt is
                // the truth. When they disagree the card renders "Claim Reward"
                // forever — full bar, permanent rejection, nothing the player can
                // do. Snap local progress back to what the server actually witnessed
                // so the objectives relight and the work can be redone.
                const { exploreCount, raidCount } = result.serverProgress;
                setMissionProgress((prev) => ({
                    ...prev,
                    [mission.id]: Math.min(mission.exploreCount, Math.max(0, exploreCount)),
                    [missionRaidProgressKey(mission.id)]: Math.min(raidReq, Math.max(0, raidCount)),
                }));
                const exploresLeft = Math.max(0, mission.exploreCount - exploreCount);
                const raidsLeft = Math.max(0, raidReq - raidCount);
                return alert(
                    `The Mission Hall only logged ${exploreCount}/${mission.exploreCount} sweeps${raidReq > 0 ? ` and ${raidCount}/${raidReq} raids` : ""} for this contract, so it can't be paid yet. Your board has been corrected — explore Sector ${mission.targetSector} ${exploresLeft} more time(s)${raidsLeft > 0 ? ` and raid ${raidsLeft} more time(s)` : ""} to finish it.`,
                );
            }
            return alert(claimReasonMessage(result.reason, result));
        }
    }
    const sortedFieldMissions = sortFieldMissions(mergeBuiltinMissions(creatorMissions));
    const rankColor: Record<string, string> = { "E Rank": "#14b8a6", "D Rank": "var(--success)", "C Rank": "#3b82f6", "B Rank": "var(--purple-500)", "A Rank": "#f97316", "S Rank": "var(--danger)", "Daily": "var(--gold)" };
    const todayMissions = dailyMissionsCompleted(character);
    // Tab state: default to Profession for players who have one, Combat otherwise.
    const hasProfession = !!character.profession;
    const showRookieOrders = character.level < 20 && !(character.examsPassed ?? []).includes("genin");
    // Wandering quests (taken from sector wanderers): the single bounty + the active
    // multi-stage epic. Display-only here — you continue/claim out at a Wandering Sage.
    const wanderEpic = character.activeQuestbook ?? null;
    const wanderEpicEntry = wanderEpic ? questbookEntry(wanderEpic.id) : null;
    const wanderEpicStage = wanderEpic && wanderEpicEntry ? questbookStage(wanderEpic.id, wanderEpic.stage) : null;
    const wanderBounty = character.activeWandererQuest ?? null;
    // Emissary errands (eq-*) share the bounty slot — resolve their catalog first.
    const wanderBountyDef = wanderBounty
        ? (emissaryQuestById(wanderBounty.id) ?? WANDERER_QUEST_CATALOG.find((q) => q.id === wanderBounty.id) ?? null)
        : null;
    const hasWanderingQuest = !!(wanderEpicEntry || wanderBounty);
    // An accepted Hollow Gate rift shows here as a world-quest marker (the rift
    // structure itself stands out in its target sector, never on the overview).
    const activeRift = character.activeRiftQuest ?? null;

    return (
        <div className="card mission-hall">
            <BackToVillageButton onClick={onBack} label="← Back" />
            {/* -- Header -- */}
            <div
                className="mh-header"
                style={{ "--mh-header-art": `url(${missionHallArt})` } as CSSProperties}
            >
                <div className="mh-header-copy">
                    <span className="mh-header-eyebrow">Village operations desk</span>
                    <h2>Mission Hall</h2>
                    <p className="mh-sub">Choose the work, read the route, then return to settle the posted reward.</p>
                    <span className="mh-reward-signal">Town Hall reward bonus <strong>+{missionRewardBonus.toFixed(1)}%</strong></span>
                </div>
                <div className="mh-stats">
                    <div className="mh-stat-chip">
                        <span className="mh-stat-label">Daily</span>
                        <span className="mh-stat-value">{todayMissions}<span className="mh-stat-max">/20</span></span>
                    </div>
                </div>
            </div>

            {/* -- Academy Trial (onboarding, one-time) -- */}
            {showAcademyTrial && (
                <section
                    className="mh-section academy-trial-card"
                >
                    <h3 className="mh-section-title" style={{ marginTop: 0 }}>Academy Trial</h3>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Your first official mission. Claim this one-time reward, then open your Logbook for the next Academy checklist.
                    </p>
                    <ul style={{ margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.5 }}>
                        <li>✅ Won your first Academy spar</li>
                        <li>✅ Started stat training</li>
                        <li>✅ Unlocked / equipped a jutsu</li>
                    </ul>
                    <p style={{ margin: "0 0 12px", color: "var(--slate-300)", fontSize: 13 }}>
                        Reward: stat points, ryo, and stamina. This does not use one of today's mission slots.
                    </p>
                    <button
                        className="start-primary-btn"
                        disabled={claimingKey !== null}
                        onClick={() => { void runClaim("academy-trial", claimAcademyTrial); }}
                    >
                        {claimingKey === "academy-trial" ? "Claiming…" : "Claim Academy Trial Reward"}
                    </button>
                </section>
            )}

            {showRookieOrders && !showAcademyTrial && (
                <section className="mh-section rookie-orders-card">
                    <h3 className="mh-section-title" style={{ marginTop: 0 }}>Rookie Orders</h3>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Build toward the level-20 Genin Advancement Exam: you earn the Genin title at level 15, then this later gate qualifies you to keep progressing. Train stats and clear your field and hunt dailies — those are what level you. Combat missions and the Arena pay the ryo that funds your gear and jutsu.
                    </p>
                    <div className="rookie-orders-actions">
                        <button className="start-primary-btn" onClick={() => setActiveMissionTab("combat")}>
                            Combat Missions
                        </button>
                        <button onClick={() => setActiveMissionTab("field")}>
                            Field Missions
                        </button>
                        <button onClick={() => setScreen("logbook")}>
                            Logbook
                        </button>
                    </div>
                </section>
            )}

            {/* -- Tabs -- */}
            <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                {hasProfession && (
                    <button data-tab="profession" className={activeMissionTab === "profession" ? "active" : ""} onClick={() => setActiveMissionTab("profession")}>
                        <span aria-hidden="true">01</span>Profession
                    </button>
                )}
                <button data-tab="combat" className={activeMissionTab === "combat" ? "active" : ""} onClick={() => setActiveMissionTab("combat")}>
                    <span aria-hidden="true">{hasProfession ? "02" : "01"}</span>Combat
                </button>
                <button data-tab="field" className={activeMissionTab === "field" ? "active" : ""} onClick={() => setActiveMissionTab("field")}>
                    <span aria-hidden="true">{hasProfession ? "03" : "02"}</span>Field
                </button>
                <button data-tab="weekly" className={activeMissionTab === "weekly" ? "active" : ""} onClick={() => setActiveMissionTab("weekly")}>
                    <span aria-hidden="true">{hasProfession ? "04" : "03"}</span>Weekly
                </button>
                <button data-tab="world" className={activeMissionTab === "wandering" ? "active" : ""} onClick={() => setActiveMissionTab("wandering")}>
                    <span aria-hidden="true">{hasProfession ? "05" : "04"}</span>World{(hasWanderingQuest || activeRift) ? " •" : ""}
                </button>
            </div>

            {/* -- Profession tab -- */}
            {activeMissionTab === "profession" && hasProfession && (
                <DailyProfessionMissions character={character} />
            )}

            {/* -- Weekly Board tab -- */}
            {activeMissionTab === "weekly" && (
                <WeeklyBoard character={character} updateCharacter={updateCharacter} />
            )}

            {/* -- Combat Missions tab -- */}
            {activeMissionTab === "combat" && (
            <section className="mh-section">
                <h3 className="mh-section-title">Combat Missions</h3>
                <p className="hint">Defeat the assigned enemy, then return here to claim your reward. New shinobi should start with the E-Rank Drill.</p>
                <div className="mh-combat-grid">
                    {COMBAT_MISSIONS.map((mission) => {
                        const ai = creatorAis.find((c) => c.id === mission.aiProfileId);
                        const locked = character.level < mission.min;
                        const claimable = (character.pendingCombatMissionClaims ?? []).includes(mission.key);
                        const recommended = showRookieOrders && mission.key === "combat-e-drill" && !claimable;
                        return (
                            <div key={mission.key} className={`mh-combat-card${locked ? " mh-locked" : ""}${claimable ? " mh-fetch-complete" : ""}${recommended ? " mh-recommended-card" : ""}`}>
                                <div className="mh-combat-rank" style={{ background: rankColor[mission.rank + " Rank"] ?? "var(--slate-600)" }}>
                                    {mission.rank}-Rank
                                </div>
                                {recommended && <span className="mh-recommended-badge">Recommended First Mission</span>}
                                <div className="mh-combat-avatar">
                                    {ai?.image
                                        ? <img src={ai.image} alt={ai.name} />
                                        : <span>{mission.icon}</span>}
                                </div>
                                <div className="mh-combat-body">
                                    <strong className="mh-combat-name">{mission.name}</strong>
                                    <span className="mh-combat-enemy">{ai?.name ?? "Unknown Enemy"}</span>
                                    <div className="mh-combat-tags">
                                        <span className="mh-tag mh-tag-req">Lv {mission.min}+</span>
                                    </div>
                                    <div className="mh-combat-rewards">
                                        <span><GameIcon name="ryo" size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />{boostAmount(mission.ryo, missionRewardBonus)} ryo</span>
                                    </div>
                                </div>
                                {claimable
                                    ? <button
                                        className="mh-combat-btn mh-claim-btn"
                                        disabled={claimingKey !== null}
                                        onClick={() => { void runClaim(`combat:${mission.key}`, () => claimCombatMission(mission)); }}
                                    >
                                        {claimingKey === `combat:${mission.key}` ? "Claiming…" : "✅ Claim Reward"}
                                    </button>
                                    : <button
                                        className="mh-combat-btn"
                                        disabled={locked || todayMissions >= DAILY_MISSION_LIMIT}
                                        onClick={() => startMissionBattle(mission)}
                                    >
                                        {locked ? `Lv ${mission.min} Required` : "Begin Mission"}
                                    </button>}
                            </div>
                        );
                    })}
                </div>
            </section>
            )}

            {/* -- Field Missions tab -- */}
            {activeMissionTab === "field" && (
            <section className="mh-section mh-field-section">
                <div className="mh-field-heading">
                    <div>
                        <span className="mh-field-eyebrow">Open operations</span>
                        <h3 className="mh-section-title">Field Missions</h3>
                        <p>Each contract now shows the exact territory you will enter before you accept it.</p>
                    </div>
                    <span className="mh-field-sort">Rank order · D → C → B → A → S</span>
                </div>
                {sortedFieldMissions.length === 0
                    ? <EmptyState icon={<span aria-hidden="true">—</span>}>No field missions posted yet.</EmptyState>
                    : <div className="mh-field-grid">
                        {sortedFieldMissions.map((mission) => {
                            const accepted = acceptedMissionIds.includes(mission.id);
                            const progress = missionProgress[mission.id] ?? 0;
                            const raidReq = missionRaidRequirement(mission);
                            const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
                            const complete = progress >= mission.exploreCount && raidProgress >= raidReq;
                            const totalRequired = mission.exploreCount + raidReq;
                            const totalProgress = Math.min(mission.exploreCount, progress) + Math.min(raidReq, raidProgress);
                            const progressPct = Math.min(100, (totalProgress / Math.max(1, totalRequired)) * 100);
                            const recommended = showRookieOrders && mission.id === "fetch-d-supply-trail" && !accepted;
                            const locked = character.level < mission.levelReq;
                            const placeName = sectorName(mission.targetSector) ?? `Sector ${mission.targetSector}`;
                            const regionName = sectorRegionLabel(mission.targetSector) ?? "Outer territory";
                            const art = `/sector-map/s${sectorArtKey(mission.targetSector)}.webp`;
                            const accent = rankColor[mission.rank] ?? "var(--slate-500)";
                            return (
                                <article
                                    key={mission.id}
                                    className={`mh-field-card${complete && accepted ? " mh-fetch-complete" : ""}${recommended ? " mh-recommended-card" : ""}${locked ? " mh-field-locked" : ""}`}
                                    style={{ "--mission-rank-color": accent } as CSSProperties}
                                >
                                    <div className="mh-field-art">
                                        <img src={art} alt="" loading="lazy" decoding="async" />
                                        <span className="mh-field-rank">{mission.rank}</span>
                                        <span className="mh-field-sector">
                                            <small>Sector {mission.targetSector} · {regionName}</small>
                                            <strong>{placeName}</strong>
                                        </span>
                                    </div>
                                    <div className="mh-field-body">
                                        <div className="mh-field-title-row">
                                            <div>
                                                <span>Level {mission.levelReq}+</span>
                                                <h4>{mission.name}</h4>
                                            </div>
                                            {accepted && <span className="mh-field-status">{complete ? "Ready to claim" : "In progress"}</span>}
                                        </div>
                                        {recommended && <span className="mh-recommended-badge">Recommended First Field Mission</span>}
                                        <p className="mh-field-description">{mission.description}</p>
                                        <div className="mh-field-objectives" aria-label="Mission objectives">
                                            <span><small>Sweep</small><strong>×{mission.exploreCount}</strong></span>
                                            {raidReq > 0 && <span><small>Raid</small><strong>×{raidReq}</strong></span>}
                                        </div>
                                        <div className="mh-fetch-rewards">
                                            <span><GameIcon name="medal" size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />+{FIELD_MISSION_STAT_POINTS} Stat Pts</span>
                                            <span><GameIcon name="ryo" size={14} style={{ verticalAlign: "-2px", marginRight: 3 }} />{boostAmount(mission.ryoReward, missionRewardBonus)} ryo</span>
                                        </div>
                                        {accepted && (
                                            <div className="mh-fetch-progress-wrap">
                                                <div className="mh-fetch-progress-label">
                                                    <span>Explore {Math.min(progress, mission.exploreCount)}/{mission.exploreCount}</span>
                                                    {raidReq > 0 && <span>Raid {Math.min(raidProgress, raidReq)}/{raidReq}</span>}
                                                </div>
                                                <div className="mission-progress">
                                                    <span style={{ width: `${progressPct}%` }} />
                                                </div>
                                            </div>
                                        )}
                                        <div className="mh-fetch-actions">
                                            {!accepted
                                                ? <button disabled={fieldTrailPending !== null || locked} onClick={() => { void acceptFetchMission(mission); }}>
                                                    {locked ? `Level ${mission.levelReq} required` : "Accept Mission"}
                                                </button>
                                                : complete
                                                    ? <button
                                                        className="mh-claim-btn"
                                                        disabled={claimingKey !== null}
                                                        onClick={() => { void runClaim(`field:${mission.id}`, () => claimFetchMission(mission)); }}
                                                    >
                                                        {claimingKey === `field:${mission.id}` ? "Claiming…" : "Claim Reward"}
                                                    </button>
                                                    : <button onClick={() => setScreen("worldMap")}>Go to Sector {mission.targetSector}</button>}
                                            {accepted && <button className="danger-button" disabled={fieldTrailPending !== null} onClick={() => { void abandonFetchMission(mission); }}>Abandon</button>}
                                            {mission.aiProfileId && (
                                                <button onClick={() => startCreatorMissionBattle(mission)}>Battle AI</button>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                }
            </section>
            )}

            {/* -- Wandering Quests tab (sector-wanderer bounties + epics) -- */}
            {activeMissionTab === "wandering" && (
            <section className="mh-section">
                <h3 className="mh-section-title">World Quests</h3>
                <p className="hint">Quests you pick up out in the world. Wanderers and rift-seers <strong>roam the sectors</strong> — find a <strong>Wandering Sage</strong> (📜) on the World Map to continue or claim, or travel to a <strong>marked sector</strong> to enter a Hollow Gate rift. Epic boss stages start from the Sage's journal.</p>
                {!hasWanderingQuest && !activeRift && <p className="hint">You haven't taken any world quests yet. Look for a wanderer or a rift-seer out in the sectors and accept one.</p>}

                {activeRift && (
                    <div className="mh-fetch-card">
                        <div className="mh-fetch-info">
                            <strong>Hollow Gate Rift: {activeRift.bossName}</strong>
                            <span className="mh-fetch-meta">A rift has torn open in {sectorPhrase(activeRift.targetSector)}.</span>
                        </div>
                        <div className="mh-fetch-progress-wrap">
                            <div className="mh-fetch-progress-label"><span>Travel to the sector and descend the Hollow Gate.</span></div>
                        </div>
                        <span className="hint">Find the 🌀 rift structure there, descend, and defeat {activeRift.bossName} to complete the quest.</span>
                    </div>
                )}

                {wanderEpic && wanderEpicEntry && wanderEpicStage && (() => {
                    const metric = wanderEpicStage.metric;
                    const got = Math.max(0, ((character[metric] as number | undefined) ?? 0) - wanderEpic.baseline);
                    const isChoice = !!wanderEpicStage.choice;
                    const isBoss = !!wanderEpicStage.bossId && metric === "totalAiKills";
                    const pct = Math.min(100, (Math.min(got, wanderEpicStage.count) / Math.max(1, wanderEpicStage.count)) * 100);
                    return (
                        <div className="mh-fetch-card">
                            <div className="mh-fetch-info">
                                <strong>{wanderEpicEntry.title}</strong>
                                <span className="mh-fetch-meta">Epic · Stage {wanderEpic.stage + 1} of {wanderEpicEntry.stages.length}</span>
                                <span className="mh-fetch-meta">{wanderEpicStage.text}</span>
                            </div>
                            <div className="mh-fetch-progress-wrap">
                                <div className="mh-fetch-progress-label">
                                    {isChoice
                                        ? <span>A choice awaits — decide at a Wandering Sage.</span>
                                        : <span>{Math.min(got, wanderEpicStage.count)} / {wanderEpicStage.count} {metricLabel(metric)}</span>}
                                </div>
                                {!isChoice && <div className="mission-progress"><span style={{ width: `${pct}%` }} /></div>}
                            </div>
                            <span className="hint">{isBoss ? "Start the boss fight from a Wandering Sage's journal." : "Continue at any Wandering Sage out in the sectors."}</span>
                        </div>
                    );
                })()}

                {wanderBounty && (() => {
                    const metric = emissaryQuestById(wanderBounty.id)?.metric ?? questMetricForId(wanderBounty.id);
                    const got = Math.max(0, ((character[metric] as number | undefined) ?? 0) - wanderBounty.baseline);
                    const done = got >= wanderBounty.target;
                    const pct = Math.min(100, (Math.min(got, wanderBounty.target) / Math.max(1, wanderBounty.target)) * 100);
                    return (
                        <div className={`mh-fetch-card${done ? " mh-fetch-complete" : ""}`}>
                            <div className="mh-fetch-info">
                                <strong>{wanderBountyDef?.label ?? "Wanderer bounty"}</strong>
                                <span className="mh-fetch-meta">{(() => {
                                    const em = emissaryByQuestId(wanderBounty.id);
                                    return em ? `Errand for ${em.name}` : "Bounty from a Wandering Sage";
                                })()}</span>
                            </div>
                            <div className="mh-fetch-progress-wrap">
                                <div className="mh-fetch-progress-label"><span>{Math.min(got, wanderBounty.target)} / {wanderBounty.target} {metricLabel(metric)}</span></div>
                                <div className="mission-progress"><span style={{ width: `${pct}%` }} /></div>
                            </div>
                            <span className="hint">{(() => {
                                // Any quest-giving wanderer can settle the claim —
                                // don't send the player hunting one specific NPC.
                                const em = emissaryByQuestId(wanderBounty.id);
                                const who = em ? `${em.name} — or any wandering sage —` : "any Wandering Sage";
                                return done ? `Done — return to ${who} to claim your reward.` : `Return to ${who} once complete to claim.`;
                            })()}</span>
                        </div>
                    );
                })()}

                <div style={{ marginTop: 12 }}>
                    <button onClick={() => setScreen("worldMap")}>Go to the World Map</button>
                </div>
            </section>
            )}
        </div>
    );
}

// Hunter rank tables moved to ./constants/hunter.
