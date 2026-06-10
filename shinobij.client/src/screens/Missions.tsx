import { useState } from "react";
import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";
import type { Screen } from "../types/core";
import { DAILY_MISSION_LIMIT } from "../constants/game";
import type { MissionRank } from "../constants/hunter";
import { DailyProfessionMissions } from "../screens/DailyProfessionMissions";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { dailyMissionsCompleted, hasDailyMissionSlot, markMissionCompleted } from "../lib/character-progress";
import { displayCharacterXpGain } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { mergeBuiltinMissions, missionRaidProgressKey, missionRaidRequirement } from "../data/missions";
import { gainXp, grantTerritoryScrolls } from "../App";

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
    onMissionBattleStart,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: (ids: string[]) => void;
    missionProgress: Record<string, number>;
    setMissionProgress: (progress: Record<string, number>) => void;
    setPendingAiProfileId: (id: string) => void;
    setScreen: (screen: Screen) => void;
    onMissionBattleStart?: () => void;
}) {
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    function startMissionBattle(mission: { min: number; cost: number; aiProfileId: string }) { if (character.level < mission.min) return alert(`Requires level ${mission.min}.`); if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); onMissionBattleStart?.(); setPendingAiProfileId(ai.id); setScreen("arena"); }
    function startCreatorMissionBattle(mission: CreatorMission) { if (!mission.aiProfileId) return alert("No AI assigned to this mission."); if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`); const ai = creatorAis.find((candidate) => candidate.id === mission.aiProfileId); if (!ai) return alert("Mission AI is not available."); onMissionBattleStart?.(); setPendingAiProfileId(ai.id); setScreen("arena"); }
    function acceptFetchMission(mission: CreatorMission) { if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`); if (acceptedMissionIds.includes(mission.id)) return; const raidKey = missionRaidProgressKey(mission.id); setAcceptedMissionIds([...acceptedMissionIds, mission.id]); setMissionProgress({ ...missionProgress, [mission.id]: missionProgress[mission.id] ?? 0, [raidKey]: missionProgress[raidKey] ?? 0 }); const raidReq = missionRaidRequirement(mission); alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times${raidReq > 0 ? ` and raid the village ${raidReq} time(s)` : ""}.`); }
    function claimFetchMission(mission: CreatorMission) { const progress = missionProgress[mission.id] ?? 0; const raidReq = missionRaidRequirement(mission); const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0; if (progress < mission.exploreCount) return alert(`Explore Sector ${mission.targetSector} ${mission.exploreCount - progress} more time(s).`); if (raidProgress < raidReq) return alert(`Raid from Sector ${mission.targetSector} ${raidReq - raidProgress} more time(s).`); if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`); const boostedXp = boostAmount(mission.xpReward, missionRewardBonus); const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus); const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus); const leveled = grantTerritoryScrolls(applyCurrencyRewards(gainXp(character, boostedXp), mission.currencyRewards), 3); updateCharacter(markMissionCompleted({ ...leveled, ryo: leveled.ryo + boostedRyo, stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina) })); setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id)); setMissionProgress({ ...missionProgress, [mission.id]: 0, [missionRaidProgressKey(mission.id)]: 0 }); alert(`${mission.name} complete. ${rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards, character)}. +3 Territory Control Scrolls.`); }
    const missions = [
        { name: "D-Rank Errand", xp: 25, ryo: 20, cost: 5, recover: 3, min: 1, icon: "D", aiProfileId: "builtin-ai-mist-sentinel" },
        { name: "C-Rank Patrol", xp: 75, ryo: 60, cost: 10, recover: 5, min: 10, icon: "C", aiProfileId: "builtin-ai-ember-duelist" },
        { name: "B-Rank Escort", xp: 150, ryo: 125, cost: 20, recover: 10, min: 30, icon: "B", aiProfileId: "builtin-ai-frost-sealer" },
        { name: "A-Rank Hunt", xp: 300, ryo: 250, cost: 35, recover: 18, min: 50, icon: "A", aiProfileId: "builtin-ai-shadow-weaver" },
        { name: "S-Rank Crisis", xp: 700, ryo: 600, cost: 60, recover: 30, min: 70, icon: "S", aiProfileId: "builtin-ai-central-champion" },
    ];
    const missionRanks: MissionRank[] = ["Daily", "D Rank", "C Rank", "B Rank", "A Rank", "S Rank"];
    const groupedFetchMissions = missionRanks.map((rank) => ({ rank, missions: mergeBuiltinMissions(creatorMissions).filter((mission) => mission.rank === rank) })).filter((group) => group.missions.length > 0);
    const rankColor: Record<string, string> = { "D Rank": "#22c55e", "C Rank": "#3b82f6", "B Rank": "#a855f7", "A Rank": "#f97316", "S Rank": "#ef4444", "Daily": "#facc15" };
    const todayMissions = dailyMissionsCompleted(character);
    // Tab state: default to Profession for players who have one, Combat otherwise.
    const hasProfession = !!character.profession;
    const [activeMissionTab, setActiveMissionTab] = useState<"profession" | "combat" | "field">(
        hasProfession ? "profession" : "combat"
    );

    return (
        <div className="card mission-hall">
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
            </div>

            {/* -- Profession tab -- */}
            {activeMissionTab === "profession" && hasProfession && (
                <DailyProfessionMissions character={character} />
            )}

            {/* -- Combat Missions tab -- */}
            {activeMissionTab === "combat" && (
            <section className="mh-section">
                <h3 className="mh-section-title">⚔️ Combat Missions</h3>
                <p className="hint">Defeat the assigned enemy to earn rewards. No shortcuts.</p>
                <div className="mh-combat-grid">
                    {missions.map((mission) => {
                        const ai = creatorAis.find((c) => c.id === mission.aiProfileId);
                        const locked = character.level < mission.min;
                        return (
                            <div key={mission.name} className={`mh-combat-card${locked ? " mh-locked" : ""}`}>
                                <div className="mh-combat-rank" style={{ background: rankColor[(mission.name.split("-")[0]?.trim() ?? "") + " Rank"] ?? "#475569" }}>
                                    {(mission.name.split("-")[0]?.trim() ?? "") + "-Rank"}
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
                                        <span className="mh-tag mh-tag-sta">-{mission.cost} STA</span>
                                    </div>
                                    <div className="mh-combat-rewards">
                                        <span>⭐ {displayCharacterXpGain(boostAmount(mission.xp, missionRewardBonus))} XP</span>
                                        <span>💰 {boostAmount(mission.ryo, missionRewardBonus)} ryo</span>
                                    </div>
                                </div>
                                <button
                                    className="mh-combat-btn"
                                    disabled={locked || character.stamina < mission.cost || todayMissions >= DAILY_MISSION_LIMIT}
                                    onClick={() => startMissionBattle(mission)}
                                >
                                    {locked ? `Lv ${mission.min} Required` : "⚔️ Begin Mission"}
                                </button>
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
                                                        ? <button className="mh-claim-btn" onClick={() => claimFetchMission(mission)}>✅ Claim Reward</button>
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
        </div>
    );
}

// Hunter rank tables moved to ./constants/hunter.
