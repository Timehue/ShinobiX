import { useState } from "react";
import type React from "react";
import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { DAILY_MISSION_LIMIT } from "../constants/game";
import type { MissionRank } from "../constants/hunter";
import { DailyProfessionMissions } from "../screens/DailyProfessionMissions";
import { WeeklyBoard } from "../components/WeeklyBoard";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyMissionsCompleted, hasDailyMissionSlot, markMissionCompleted } from "../lib/character-progress";
import { displayCharacterXpGain, effectiveCharacterXpGain } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { mergeBuiltinMissions, missionRaidProgressKey, missionRaidRequirement } from "../data/missions";
import { COMBAT_MISSIONS, type CombatMission } from "../data/combat-missions";
import { gainXp } from "../App";
import { grantTerritoryScrolls } from "../lib/world-state";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import { questbookEntry, questbookStage, metricLabel } from "../lib/questbook";
import { WANDERER_QUEST_CATALOG, questMetricForId } from "../lib/wanderers";

export function Missions({
    character,
    updateCharacter,
    creatorAis,
    creatorMissions,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setPendingAiProfileId,
    setScreen,
    onBack,
    onMissionBattleStart,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: (ids: string[]) => void;
    missionProgress: Record<string, number>;
    setMissionProgress: (progress: Record<string, number>) => void;
    setPendingAiProfileId: (id: string) => void;
    setScreen: (screen: Screen) => void;
    onBack: () => void;
    onMissionBattleStart?: () => void;
}) {
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    function startMissionBattle(mission: CombatMission) { if (character.level < mission.min) return alert(`Requires level ${mission.min}.`); if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); onMissionBattleStart?.(); setPendingAiProfileId(ai.id); setScreen("arena"); }
    // Combat missions are won in the Arena (which only queues the claim on the
    // character) and paid out HERE. Mirrors the field-mission / hunt claim
    // pattern: per-rank XP + ryo (matching the card), +1 Territory Scroll, and
    // the kill-counter / daily-mission bookkeeping that used to run on the win.
    // No stamina — stamina is not part of any mission reward.
    // Server-authoritative: the win only queued the claim (pendingCombatMissionClaims);
    // the SERVER recomputes + pays the reward (so the client can't inflate it), then
    // we mirror the returned amounts onto the local character.
    async function claimCombatMission(mission: CombatMission) {
        if (!(character.pendingCombatMissionClaims ?? []).includes(mission.key)) return;
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        const result = await postClaimMission(character.name, "combat", mission.key);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (!result.applied) return alert(claimReasonMessage(result.reason));
        updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
        alert(`${mission.name} complete! +${effectiveCharacterXpGain(character, result.reward.xpBoosted)} XP, +${result.reward.ryo} ryo. +${result.reward.territoryScrolls} Territory Control Scroll${result.reward.territoryScrolls === 1 ? "" : "s"}.`);
    }
    // Onboarding "Academy Trial" — a one-time, server-authoritative, off-the-daily-cap
    // reward that teaches the do→return→claim loop. Sets academyTrialClaimed, which
    // advances the OnboardingCoach firstMission → logbook beat.
    async function claimAcademyTrial() {
        const result = await postClaimMission(character.name, "academy-trial", "academy-trial");
        if (result === null) return alert("Could not reach the server. Try again.");
        if (!result.applied) return alert(claimReasonMessage(result.reason));
        updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
        alert(`Academy Trial complete! +${effectiveCharacterXpGain(character, result.reward.xpBoosted)} XP, +${result.reward.ryo} ryo, +${result.reward.stamina} stamina. Now open your Logbook to see your goals.`);
    }
    const showAcademyTrial = normalizeOnboardingStep(character.onboardingStep) === "firstMission" && !character.academyTrialClaimed;
    function startCreatorMissionBattle(mission: CreatorMission) { if (!mission.aiProfileId) return alert("No AI assigned to this mission."); if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); onMissionBattleStart?.(); setPendingAiProfileId(ai.id); setScreen("arena"); }
    function acceptFetchMission(mission: CreatorMission) { if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); if (acceptedMissionIds.includes(mission.id)) return; const raidKey = missionRaidProgressKey(mission.id); setAcceptedMissionIds([...acceptedMissionIds, mission.id]); setMissionProgress({ ...missionProgress, [mission.id]: missionProgress[mission.id] ?? 0, [raidKey]: missionProgress[raidKey] ?? 0 }); const raidReq = missionRaidRequirement(mission); alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times${raidReq > 0 ? ` and raid the village ${raidReq} time(s)` : ""}.`); }
    // Server-authoritative for built-in field missions; creator-authored missions
    // (not in the server catalog) fall back to the legacy client payout via the
    // clientFallback signal.
    async function claimFetchMission(mission: CreatorMission) {
        const progress = missionProgress[mission.id] ?? 0;
        const raidReq = missionRaidRequirement(mission);
        const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
        if (progress < mission.exploreCount) return alert(`Explore Sector ${mission.targetSector} ${mission.exploreCount - progress} more time(s).`);
        if (raidProgress < raidReq) return alert(`Raid from Sector ${mission.targetSector} ${raidReq - raidProgress} more time(s).`);
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        const result = await postClaimMission(character.name, "field", mission.id);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied) {
            updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
            setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id));
            setMissionProgress({ ...missionProgress, [mission.id]: 0, [missionRaidProgressKey(mission.id)]: 0 });
            alert(`${mission.name} complete. ${rewardSummary(result.reward.xpBoosted, result.reward.ryo, result.reward.stamina, mission.currencyRewards, character)}. +${result.reward.territoryScrolls} Territory Control Scrolls.`);
            return;
        }
        if (!result.clientFallback) return alert(claimReasonMessage(result.reason));
        // Legacy client payout for creator-authored missions only.
        const boostedXp = boostAmount(mission.xpReward, missionRewardBonus);
        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
        updateCharacter((prev) => {
            if (!prev) return prev;
            const leveled = grantTerritoryScrolls(applyCurrencyRewards(gainXp(prev, boostedXp), mission.currencyRewards), 3);
            return markMissionCompleted({ ...leveled, ryo: leveled.ryo + boostedRyo, stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina) });
        });
        setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id));
        setMissionProgress({ ...missionProgress, [mission.id]: 0, [missionRaidProgressKey(mission.id)]: 0 });
        alert(`${mission.name} complete. ${rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards, character)}. +3 Territory Control Scrolls.`);
    }
    const missionRanks: MissionRank[] = ["Daily", "D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];
    const groupedFetchMissions = missionRanks.map((rank) => ({ rank, missions: mergeBuiltinMissions(creatorMissions).filter((mission) => mission.rank === rank) })).filter((group) => group.missions.length > 0);
    const rankColor: Record<string, string> = { "E Rank": "#14b8a6", "D Rank": "#22c55e", "C Rank": "#3b82f6", "B Rank": "#a855f7", "A Rank": "#f97316", "S Rank": "#ef4444", "Daily": "#facc15" };
    const todayMissions = dailyMissionsCompleted(character);
    // Tab state: default to Profession for players who have one, Combat otherwise.
    const hasProfession = !!character.profession;
    const [activeMissionTab, setActiveMissionTab] = useState<"profession" | "combat" | "field" | "weekly" | "wandering">(
        hasProfession ? "profession" : "combat"
    );
    // Wandering quests (taken from sector wanderers): the single bounty + the active
    // multi-stage epic. Display-only here — you continue/claim out at a Wandering Sage.
    const wanderEpic = character.activeQuestbook ?? null;
    const wanderEpicEntry = wanderEpic ? questbookEntry(wanderEpic.id) : null;
    const wanderEpicStage = wanderEpic && wanderEpicEntry ? questbookStage(wanderEpic.id, wanderEpic.stage) : null;
    const wanderBounty = character.activeWandererQuest ?? null;
    const wanderBountyDef = wanderBounty ? WANDERER_QUEST_CATALOG.find((q) => q.id === wanderBounty.id) : null;
    const hasWanderingQuest = !!(wanderEpicEntry || wanderBounty);

    return (
        <div className="card mission-hall">
            <BackToVillageButton onClick={onBack} label="← Back" />
            {/* -- Header -- */}
            <div className="mh-header">
                <div>
                    <h2>Mission Hall</h2>
                    <p className="mh-sub">Town Hall Reward Bonus: <strong>+{missionRewardBonus.toFixed(1)}%</strong></p>
                </div>
                <div className="mh-stats">
                    <div className="mh-stat-chip">
                        <span className="mh-stat-label">Stamina</span>
                        <span className="mh-stat-value">{character.stamina}<span className="mh-stat-max">/{character.maxStamina}</span></span>
                    </div>
                    <div className="mh-stat-chip">
                        <span className="mh-stat-label">Daily</span>
                        <span className="mh-stat-value">{todayMissions}<span className="mh-stat-max">/20</span></span>
                    </div>
                </div>
            </div>

            {/* -- Academy Trial (onboarding, one-time) -- */}
            {showAcademyTrial && (
                <section
                    className="mh-section"
                    style={{ border: "1px solid #facc15", borderRadius: 12, padding: 14, marginBottom: 14, background: "rgba(250,204,21,0.06)" }}
                >
                    <h3 className="mh-section-title" style={{ marginTop: 0 }}>🎓 Academy Trial</h3>
                    <p className="hint" style={{ marginTop: 0 }}>
                        Your first official mission. You've already done the hard part — claim your reward to graduate the basics.
                    </p>
                    <ul style={{ margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.5 }}>
                        <li>✅ Won your first Academy spar</li>
                        <li>✅ Started stat training</li>
                        <li>✅ Unlocked / equipped a jutsu</li>
                    </ul>
                    <p style={{ margin: "0 0 12px", color: "#cbd5e1", fontSize: 13 }}>
                        Reward: small XP &amp; ryo, a little stamina. (No daily-limit cost.)
                    </p>
                    <button className="start-primary-btn" onClick={() => { void claimAcademyTrial(); }}>
                        Claim Academy Trial reward
                    </button>
                </section>
            )}

            {/* -- Tabs -- */}
            <div className="clan-tabs expanded-tabs" style={{ marginBottom: 12 }}>
                {hasProfession && (
                    <button className={activeMissionTab === "profession" ? "active" : ""} onClick={() => setActiveMissionTab("profession")}>
                        📜 Profession
                    </button>
                )}
                <button className={activeMissionTab === "combat" ? "active" : ""} onClick={() => setActiveMissionTab("combat")}>
                    ⚔️ Combat
                </button>
                <button className={activeMissionTab === "field" ? "active" : ""} onClick={() => setActiveMissionTab("field")}>
                    📍 Field
                </button>
                <button className={activeMissionTab === "weekly" ? "active" : ""} onClick={() => setActiveMissionTab("weekly")}>
                    🗓️ Weekly
                </button>
                <button className={activeMissionTab === "wandering" ? "active" : ""} onClick={() => setActiveMissionTab("wandering")}>
                    🧭 Wandering{hasWanderingQuest ? " •" : ""}
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
                <h3 className="mh-section-title">⚔️ Combat Missions</h3>
                <p className="hint">Defeat the assigned enemy, then return here to claim your reward. No shortcuts.</p>
                <div className="mh-combat-grid">
                    {COMBAT_MISSIONS.map((mission) => {
                        const ai = creatorAis.find((c) => c.id === mission.aiProfileId);
                        const locked = character.level < mission.min;
                        const claimable = (character.pendingCombatMissionClaims ?? []).includes(mission.key);
                        return (
                            <div key={mission.key} className={`mh-combat-card${locked ? " mh-locked" : ""}${claimable ? " mh-fetch-complete" : ""}`}>
                                <div className="mh-combat-rank" style={{ background: rankColor[mission.rank + " Rank"] ?? "#475569" }}>
                                    {mission.rank}-Rank
                                </div>
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
                                        <span>⭐ {displayCharacterXpGain(boostAmount(mission.xp, missionRewardBonus))} XP</span>
                                        <span>💰 {boostAmount(mission.ryo, missionRewardBonus)} ryo</span>
                                    </div>
                                </div>
                                {claimable
                                    ? <button className="mh-combat-btn mh-claim-btn" onClick={() => { void claimCombatMission(mission); }}>✅ Claim Reward</button>
                                    : <button
                                        className="mh-combat-btn"
                                        disabled={locked || todayMissions >= DAILY_MISSION_LIMIT}
                                        onClick={() => startMissionBattle(mission)}
                                    >
                                        {locked ? `Lv ${mission.min} Required` : "⚔️ Begin Mission"}
                                    </button>}
                            </div>
                        );
                    })}
                </div>
            </section>
            )}

            {/* -- Field Missions tab -- */}
            {activeMissionTab === "field" && (
            <section className="mh-section">
                <h3 className="mh-section-title">📍 Field Missions</h3>
                {groupedFetchMissions.length === 0
                    ? <p className="hint">No field missions posted yet.</p>
                    : groupedFetchMissions.map((group) => (
                        <div className="mh-fetch-group" key={group.rank}>
                            <div className="mh-fetch-group-label" style={{ borderColor: rankColor[group.rank] ?? "#475569", color: rankColor[group.rank] ?? "#94a3b8" }}>
                                {group.rank}
                            </div>
                            <div className="mh-fetch-grid">
                                {group.missions.map((mission) => {
                                    const accepted = acceptedMissionIds.includes(mission.id);
                                    const progress = missionProgress[mission.id] ?? 0;
                                    const raidReq = missionRaidRequirement(mission);
                                    const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
                                    const complete = progress >= mission.exploreCount && raidProgress >= raidReq;
                                    const totalRequired = mission.exploreCount + raidReq;
                                    const totalProgress = Math.min(mission.exploreCount, progress) + Math.min(raidReq, raidProgress);
                                    const progressPct = Math.min(100, (totalProgress / Math.max(1, totalRequired)) * 100);
                                    const missionAi = mission.aiProfileId ? creatorAis.find((c) => c.id === mission.aiProfileId) : undefined;
                                    return (
                                        <div key={mission.id} className={`mh-fetch-card${complete && accepted ? " mh-fetch-complete" : ""}`}>
                                            <div className="mh-fetch-top">
                                                <div className="mh-fetch-avatar">
                                                    {missionAi?.image
                                                        ? <img src={missionAi.image} alt={missionAi.name} />
                                                        : <span>📍</span>}
                                                </div>
                                                <div className="mh-fetch-info">
                                                    <strong>{mission.name}</strong>
                                                    <span className="mh-fetch-meta">Sector {mission.targetSector} · Lv {mission.levelReq}+</span>
                                                    <span className="mh-fetch-meta">{mission.description}</span>
                                                </div>
                                            </div>
                                            <div className="mh-fetch-rewards">
                                                <span>⭐ {displayCharacterXpGain(boostAmount(mission.xpReward, missionRewardBonus))} XP</span>
                                                <span>💰 {boostAmount(mission.ryoReward, missionRewardBonus)} ryo</span>
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
                                                    ? <button onClick={() => acceptFetchMission(mission)}>Accept Mission</button>
                                                    : complete
                                                        ? <button className="mh-claim-btn" onClick={() => { void claimFetchMission(mission); }}>✅ Claim Reward</button>
                                                        : <button onClick={() => setScreen("worldMap")}>🗺️ Go to Sector {mission.targetSector}</button>}
                                                {mission.aiProfileId && (
                                                    <button onClick={() => startCreatorMissionBattle(mission)}>⚔️ Battle AI</button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                }
            </section>
            )}

            {/* -- Wandering Quests tab (sector-wanderer bounties + epics) -- */}
            {activeMissionTab === "wandering" && (
            <section className="mh-section">
                <h3 className="mh-section-title">🧭 Wandering Quests</h3>
                <p className="hint">Quests taken from wanderers on the roads. Wanderers <strong>roam the sectors</strong> — find a <strong>Wandering Sage</strong> (📜, the quest-giver) out on the World Map to continue or claim. Epic boss stages start from the Sage's journal.</p>
                {!hasWanderingQuest && <p className="hint">You haven't taken any wandering quests yet. Look for a Wandering Sage in the sectors and accept one.</p>}

                {wanderEpic && wanderEpicEntry && wanderEpicStage && (() => {
                    const metric = wanderEpicStage.metric;
                    const got = Math.max(0, ((character[metric] as number | undefined) ?? 0) - wanderEpic.baseline);
                    const isChoice = !!wanderEpicStage.choice;
                    const isBoss = !!wanderEpicStage.bossId && metric === "totalAiKills";
                    const pct = Math.min(100, (Math.min(got, wanderEpicStage.count) / Math.max(1, wanderEpicStage.count)) * 100);
                    return (
                        <div className="mh-fetch-card">
                            <div className="mh-fetch-info">
                                <strong>📖 {wanderEpicEntry.title}</strong>
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
                    const metric = questMetricForId(wanderBounty.id);
                    const got = Math.max(0, ((character[metric] as number | undefined) ?? 0) - wanderBounty.baseline);
                    const done = got >= wanderBounty.target;
                    const pct = Math.min(100, (Math.min(got, wanderBounty.target) / Math.max(1, wanderBounty.target)) * 100);
                    return (
                        <div className={`mh-fetch-card${done ? " mh-fetch-complete" : ""}`}>
                            <div className="mh-fetch-info">
                                <strong>📜 {wanderBountyDef?.label ?? "Wanderer bounty"}</strong>
                                <span className="mh-fetch-meta">Bounty from a Wandering Sage</span>
                            </div>
                            <div className="mh-fetch-progress-wrap">
                                <div className="mh-fetch-progress-label"><span>{Math.min(got, wanderBounty.target)} / {wanderBounty.target} {metricLabel(metric)}</span></div>
                                <div className="mission-progress"><span style={{ width: `${pct}%` }} /></div>
                            </div>
                            <span className="hint">{done ? "Done — return to any Wandering Sage to claim your reward." : "Return to a Wandering Sage once complete to claim."}</span>
                        </div>
                    );
                })()}

                <div style={{ marginTop: 12 }}>
                    <button onClick={() => setScreen("worldMap")}>🗺️ Go to the World Map</button>
                </div>
            </section>
            )}
        </div>
    );
}

// Hunter rank tables moved to ./constants/hunter.
