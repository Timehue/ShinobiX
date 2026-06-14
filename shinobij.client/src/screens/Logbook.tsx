import { useState } from "react";
import type { Biome, WeatherType, Screen } from "../types/core";
import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission, CreatorRaid } from "../types/missions";
import type { SavedBloodline } from "../types/combat";
import { CardVisual } from "../components/Marks";
import { DAILY_MISSION_LIMIT, EXAM_LEVEL_GATES } from "../constants/game";
import { mergeBuiltinMissions, missionRaidProgressKey, missionRaidRequirement } from "../data/missions";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { baseStats, rankFromLevel } from "../lib/stats";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { clampNumber, currentDateKey } from "../lib/utils";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { getCharacterElements } from "../lib/elements";
import { hasDailyMissionSlot, markMissionCompleted } from "../lib/character-progress";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { weatherForBiome } from "../data/sectors";
import {
    gainXp,
    type CreatorEvent,
} from "../App";
import { activeVillageWarsFor, claimVillageWarDailyMission, grantTerritoryScrolls, loadVillageState, weatherForSector, VILLAGE_WAR_DAILY_MISSIONS, VILLAGE_WAR_MISSION_DAMAGE, VILLAGE_WAR_RAIDS_PER_MISSION } from "../lib/world-state";

export function Logbook({
    character,
    updateCharacter,
    creatorAis,
    creatorMissions,
    creatorEvents,
    creatorRaids,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    setPendingAiProfileId,
    setRaidBattleKind,
    setCurrentSector,
    setCurrentBiome,
    setCurrentWeather,
    setScreen,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    creatorEvents: CreatorEvent[];
    creatorRaids: CreatorRaid[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: (ids: string[]) => void;
    missionProgress: Record<string, number>;
    setMissionProgress: (progress: Record<string, number>) => void;
    savedBloodlines: SavedBloodline[];
    setPendingAiProfileId: (id: string) => void;
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    setCurrentSector: (sector: number) => void;
    setCurrentBiome: (biome: Biome) => void;
    setCurrentWeather: (weather: WeatherType) => void;
    setScreen: (screen: Screen) => void;
}) {
    // Rank-up ceremony: set to the exam title when a promotion is claimed, so we
    // celebrate with a modal instead of a bare alert().
    const [ceremonyTitle, setCeremonyTitle] = useState<string | null>(null);
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    const ownedElements = getCharacterElements(character);
    const baseStatTotal = Object.values(baseStats()).reduce((sum, value) => sum + value, 0);
    const currentStatTotal = Object.values(character.stats).reduce((sum, value) => sum + value, 0);
    const statsTrained = Math.max(character.totalStatsTrained ?? 0, Math.max(0, currentStatTotal - baseStatTotal));
    const defeatedAiIds = character.defeatedAiIds ?? [];
    const examProctor = creatorAis.find((ai) => ai.id === "builtin-ai-exam-proctor");
    const rogueNinja = creatorAis.find((ai) => ai.id === "builtin-ai-rogue-ninja");
    type ExamRequirement = { label: string; progress: number; target: number; detail?: string; aiId?: string; goScreen?: Screen; goLabel?: string };
    type ExamLogbookMission = { title: string; examKey: string; unlockLevel: number; requirements: ExamRequirement[] };
    const availableLogbookMissions = mergeBuiltinMissions(creatorMissions);
    const assignedMissions = acceptedMissionIds
        .map((id) => availableLogbookMissions.find((mission) => mission.id === id))
        .filter((mission): mission is CreatorMission => Boolean(mission));
    const dailyMissions = availableLogbookMissions.filter((mission) => mission.rank === "Daily");
    const logbookEvents = creatorEvents.filter((event) => (event.eventKind ?? "reward") !== "visualNovel");
    const logbookRaids = creatorRaids;
    const activeVillageWar = activeVillageWarsFor(character.village)[0];
    const activeVillageWarEnemy = activeVillageWar?.villages.find(village => village !== character.village);
    const todayWarProgress = character.villageWarMissionDate === currentDateKey() ? character.villageWarRaidProgress ?? 0 : 0;
    const todayWarCompleted = character.villageWarMissionDate === currentDateKey() ? character.villageWarMissionsCompleted ?? 0 : 0;
    const villageWarDailyMissions = Array.from({ length: VILLAGE_WAR_DAILY_MISSIONS }, (_, index) => ({
        index,
        title: `Village War Raid Mission ${index + 1}`,
        progress: clampNumber(todayWarProgress - index * VILLAGE_WAR_RAIDS_PER_MISSION, 0, VILLAGE_WAR_RAIDS_PER_MISSION),
        complete: todayWarCompleted > index,
    }));
    const missingMissionIds = acceptedMissionIds.filter((id) => !availableLogbookMissions.some((mission) => mission.id === id));
    const maybeExamMissions: Array<ExamLogbookMission | null> = [
        character.level >= 11 ? {
            title: "Genin Exam",
            examKey: "genin",
            unlockLevel: 11,
            requirements: [
                { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "No element awakened" },
                { label: "Train 400 stats", progress: statsTrained, target: 400 },
                { label: "Complete 20 missions", progress: character.totalMissionsCompleted ?? character.clanMissionContrib ?? 0, target: 20 },
                { label: "Kill 20 AI", progress: character.totalAiKills ?? 0, target: 20 },
                { label: "Explore 50 tiles", progress: character.totalTilesExplored ?? 0, target: 50 },
                { label: "Sharpen a jutsu to Lv 3", progress: Math.max(0, ...((character.jutsuMastery ?? []).map((m) => m.level))), target: 3, detail: "Use a jutsu in battle to level it" },
            ],
        } : null,
        character.level >= 21 ? {
            title: "Chunin Exam",
            examKey: "chunin",
            unlockLevel: 21,
            requirements: [
                { label: "Awaken your second element", progress: ownedElements.length, target: 2, detail: ownedElements[1] ?? "Second element not awakened" },
                { label: "Complete 50 missions", progress: character.totalMissionsCompleted ?? character.clanMissionContrib ?? 0, target: 50 },
                { label: "Explore 100 tiles", progress: character.totalTilesExplored ?? 0, target: 100 },
                { label: "Join a clan", progress: character.clan ? 1 : 0, target: 1, detail: character.clan ?? "No clan joined" },
                { label: "Defeat Exam Proctor", progress: defeatedAiIds.includes("builtin-ai-exam-proctor") ? 1 : 0, target: 1, detail: examProctor ? "Level 25 arena AI" : "Exam Proctor missing", aiId: "builtin-ai-exam-proctor" },
            ],
        } : null,
        character.level >= 41 ? {
            title: "Jonin Exam",
            examKey: "jonin",
            unlockLevel: 41,
            requirements: [
                { label: "Get 10 PvP kills", progress: character.totalPvpKills ?? 0, target: 10 },
                { label: "Raid a village 20 times", progress: character.totalVillageRaids ?? 0, target: 20 },
                { label: "Defeat Rogue Ninja", progress: defeatedAiIds.includes("builtin-ai-rogue-ninja") ? 1 : 0, target: 1, detail: rogueNinja ? "Level 47 arena AI" : "Rogue Ninja missing", aiId: "builtin-ai-rogue-ninja" },
            ],
        } : null,
        character.level >= 80 ? (() => {
            const villageState = loadVillageState(character.village);
            const isKage = villageState.seatedKage?.toLowerCase() === character.name.toLowerCase();
            const isElder = Boolean(character.elderFocus);
            return {
            title: "Special Jonin Exam",
            examKey: "specialJonin",
            unlockLevel: 80,
            requirements: [
                { label: "Kill 100 players in PvP", progress: character.totalPvpKills ?? 0, target: 100 },
                { label: "Become Kage or Elder", progress: (isKage || isElder) ? 1 : 0, target: 1, detail: isKage ? `Seated Kage of ${character.village}` : isElder ? `${character.elderFocus} Elder` : "Not a Kage or Elder" },
            ],
        };})() : null,
    ];
    const examMissions = maybeExamMissions.filter((mission): mission is ExamLogbookMission => mission !== null);

    // Academy Training checklist — the level 1-14 onboarding guidance that fills
    // the gap before the first rank exam (Genin) appears. Soft, teach-by-doing
    // goals that each read an existing counter; hidden once claimed or once the
    // player outgrows Academy rank. Same row format as the exams.
    const highestJutsuMastery = Math.max(0, ...((character.jutsuMastery ?? []).map((m) => m.level)));
    const academyChecklist: { title: string; requirements: ExamRequirement[] } | null =
        (!character.academyChecklistClaimed && rankFromLevel(character.level) === "Academy Student")
            ? {
                title: "Academy Training",
                requirements: [
                    { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "Free roll at Level 2", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                    { label: "Equip your jutsu loadout", progress: character.equippedJutsuIds.length, target: 4, detail: "Add a 4th jutsu", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                    { label: "Win your first battle", progress: character.totalAiKills ?? 0, target: 1, detail: "Fight in the Arena or a hunt", goScreen: "battleArena", goLabel: "Go Arena" },
                    { label: "Train at the grounds", progress: statsTrained, target: 5, detail: "Train a stat at the Training Grounds", goScreen: "training", goLabel: "Go Train" },
                    { label: "Complete your first mission", progress: character.totalMissionsCompleted ?? 0, target: 1, detail: "Accept a D-rank mission below", goScreen: "missions", goLabel: "Go to Mission Hall" },
                    { label: "Sharpen a jutsu (mastery Lv 3)", progress: highestJutsuMastery, target: 3, detail: "Using a jutsu in battle levels it", goScreen: "battleArena", goLabel: "Go Arena" },
                ],
            }
            : null;
    const academyComplete = academyChecklist ? academyChecklist.requirements.every((r) => r.progress >= r.target) : false;

    // Server-authoritative for built-in field missions; creator-authored missions
    // fall back to the legacy client payout (clientFallback). Mirrors Missions.claimFetchMission.
    async function claimMission(mission: CreatorMission) {
        const progress = missionProgress[mission.id] ?? 0;
        const raidReq = missionRaidRequirement(mission);
        const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
        if (progress < mission.exploreCount) return alert(`Explore Sector ${mission.targetSector} ${mission.exploreCount - progress} more time(s).`);
        if (raidProgress < raidReq) return alert(`Raid from Sector ${mission.targetSector} ${raidReq - raidProgress} more time(s).`);
        if (!hasDailyMissionSlot(character)) return alert(`Daily mission limit reached (${DAILY_MISSION_LIMIT}/${DAILY_MISSION_LIMIT}). Resets at midnight UTC.`);
        const result = await postClaimMission(character.name, "field", mission.id);
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied) {
            updateCharacter(applyServerMissionReward(character, result, gainXp));
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
        const leveled = grantTerritoryScrolls(applyCurrencyRewards(gainXp(character, boostedXp), mission.currencyRewards), 3);
        updateCharacter(markMissionCompleted({
            ...leveled,
            ryo: leveled.ryo + boostedRyo,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + boostedStamina),
        }));
        setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== mission.id));
        setMissionProgress({ ...missionProgress, [mission.id]: 0, [missionRaidProgressKey(mission.id)]: 0 });
        alert(`${mission.name} complete. ${rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards, character)}. +3 Territory Control Scrolls.`);
    }

    function acceptMission(mission: CreatorMission) {
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if (acceptedMissionIds.includes(mission.id)) return;
        const raidKey = missionRaidProgressKey(mission.id);
        setAcceptedMissionIds([...acceptedMissionIds, mission.id]);
        setMissionProgress({ ...missionProgress, [mission.id]: missionProgress[mission.id] ?? 0, [raidKey]: missionProgress[raidKey] ?? 0 });
        const raidReq = missionRaidRequirement(mission);
        alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times${raidReq > 0 ? ` and raid the village ${raidReq} time(s)` : ""}.`);
    }

    function claimRewardEvent(event: CreatorEvent) {
        if (character.level < event.levelReq) return alert(`Requires level ${event.levelReq}.`);
        const leveled = gainXp(character, event.xpReward);
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({
            ...rewarded,
            ryo: rewarded.ryo + event.ryoReward,
            stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward),
            clanEventContrib: (rewarded.clanEventContrib ?? 0) + 1,
            clanContribMonth: new Date().toISOString().slice(0, 7),
        });
        alert(`${event.name} complete. ${rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards, character)}.`);
    }

    function startRaid(raid: CreatorRaid) {
        if (character.level < raid.levelReq) return alert(`Requires level ${raid.levelReq}.`);
        if (raid.targetSector) setCurrentSector(raid.targetSector);
        setPendingAiProfileId(raid.aiProfileId || "");
        setRaidBattleKind("raidAi");
        setCurrentBiome(raid.biome);
        setCurrentWeather(weatherForBiome(raid.biome));
        setScreen("arena");
    }

    function goToWarGround() {
        if (!activeVillageWar) return alert("Your village is not in an active war.");
        const biome = "central" as Biome;
        setCurrentSector(activeVillageWar.warGroundSector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(activeVillageWar.warGroundSector, biome));
        setScreen("worldMap");
    }

    function claimWarMission(index: number) {
        const result = claimVillageWarDailyMission(character, index);
        updateCharacter(result.character);
        alert(result.note);
    }

    function abandonMission(missionId: string) {
        const nextProgress = { ...missionProgress };
        delete nextProgress[missionId];
        delete nextProgress[missionRaidProgressKey(missionId)];
        setAcceptedMissionIds(acceptedMissionIds.filter((id) => id !== missionId));
        setMissionProgress(nextProgress);
    }

    function startExamFight(aiId: string) {
        const ai = creatorAis.find((candidate) => candidate.id === aiId);
        if (!ai) return alert("Exam AI is not available.");
        setPendingAiProfileId(ai.id);
        setScreen("arena");
    }

    function renderRequirement(requirement: ExamRequirement) {
        const complete = requirement.progress >= requirement.target;
        const progressText = requirement.target === 1
            ? complete ? "Complete" : "Incomplete"
            : `${Math.min(requirement.progress, requirement.target)}/${requirement.target}`;
        return (
            <div key={requirement.label} className="summary-box">
                <h4>{complete ? "Done" : "Open"} - {requirement.label}</h4>
                <p>{progressText}{requirement.detail ? ` | ${requirement.detail}` : ""}</p>
                <div className="mission-progress"><span style={{ width: `${Math.min(100, (requirement.progress / requirement.target) * 100)}%` }}></span></div>
                {requirement.aiId && !complete && <button onClick={() => startExamFight(requirement.aiId as string)}>Fight {requirement.label.replace("Defeat ", "")}</button>}
                {requirement.goScreen && !complete && <button onClick={() => setScreen(requirement.goScreen as Screen)}>{requirement.goLabel ?? "Go"}</button>}
            </div>
        );
    }

    return (
        <div className="card logbook-screen">
            <h2>Logbook</h2>
            {ceremonyTitle && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000, padding: 16 }}>
                    <div className="card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
                        <div style={{ fontSize: 48, marginBottom: 4 }}>🎉</div>
                        <h2 style={{ marginTop: 0 }}>{ceremonyTitle} Passed!</h2>
                        <p>Congratulations, {character.name} — you've been promoted. Your level cap is lifted and new content awaits.</p>
                        <button className="start-primary-btn" style={{ width: "100%" }} onClick={() => setCeremonyTitle(null)}>Continue →</button>
                    </div>
                </div>
            )}
            <p>Exam missions: <strong>{examMissions.length}</strong> · Daily missions: <strong>{dailyMissions.length + (activeVillageWar ? VILLAGE_WAR_DAILY_MISSIONS : 0)}</strong> · Events: <strong>{logbookEvents.length}</strong> · Raids: <strong>{logbookRaids.length}</strong> · Assigned missions: <strong>{assignedMissions.length}</strong></p>
            {academyChecklist && (
                <>
                    <h3>Academy Training</h3>
                    <section className="summary-box mission-board-section">
                        <p className="hint">New shinobi: complete these to prepare for the Genin Exam.</p>
                        <div className="location-grid">{academyChecklist.requirements.map(renderRequirement)}</div>
                        {academyComplete && (
                            <div className="menu">
                                <button onClick={() => updateCharacter({ ...character, academyChecklistClaimed: true })}>Claim Academy Reward</button>
                            </div>
                        )}
                    </section>
                </>
            )}
            <details className="summary-box mission-board-section" style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>🎓 Academy Help — how the game works</summary>
                <div style={{ marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
                    <p><strong>What should I do next?</strong> Follow your Academy goals above, top to bottom. Each one teaches a system and rewards you.</p>
                    <p><strong>AP (Action Points).</strong> Each turn in battle you spend AP on Basic Attacks and Jutsu. When AP runs low, press End Turn / Wait to recover it.</p>
                    <p><strong>Training.</strong> At the Training Grounds you pick a stat and a timer. Short timers are quick active play; long timers keep progressing while you're away.</p>
                    <p><strong>Jutsu.</strong> Jutsu are your combat identity. Your bloodline gives you a starter set; unlock and equip more, and using them in battle raises their mastery.</p>
                    <p><strong>Missions.</strong> Accept a mission, complete the task (fight or explore), then return to the Mission Hall and claim the reward. That do → return → claim loop is the core of the game.</p>
                    <p><strong>Pets.</strong> Your companion fights with you in PvE and the Pet Arena. Manage pets, training, and expeditions at the Pet Yard.</p>
                    <p><strong>Healing.</strong> After a tough fight, visit the Hospital to recover HP.</p>
                    <p><strong>Story.</strong> Your village story unlocks once you finish Academy Training — then visit the Story Hall.</p>
                    <p><strong>Reaching Genin.</strong> Level up to 15 and pass the Genin Exam (it appears here in your Logbook) to graduate from Academy Student.</p>
                </div>
            </details>
            {examMissions.length > 0 && (
                <>
                    <h3>Rank Exams</h3>
                    {examMissions.map((exam) => {
                        const passed = (character.examsPassed ?? []).includes(exam.examKey);
                        const complete = exam.requirements.every((requirement) => requirement.progress >= requirement.target);
                        const gate = EXAM_LEVEL_GATES.find(g => g.exam === exam.examKey);
                        const isBlocking = !passed && character.level >= (gate?.level ?? 999);
                        return (
                            <section className="summary-box mission-board-section" key={exam.title}>
                                <h3>{exam.title} {passed ? "✓" : ""}</h3>
                                <p className="hint">Unlocked at level {exam.unlockLevel}. Status: <strong>{passed ? "Passed" : complete ? "Ready to pass" : "In progress"}</strong></p>
                                {isBlocking && !complete && <p style={{ color: "#f87171", fontWeight: "bold" }}>You cannot level past {gate!.level} until you pass this exam.</p>}
                                <div className="location-grid">{exam.requirements.map(renderRequirement)}</div>
                                {!passed && <div className="menu">
                                    <button disabled={!complete} onClick={() => {
                                        updateCharacter({ ...character, examsPassed: [...(character.examsPassed ?? []), exam.examKey] });
                                        setCeremonyTitle(exam.title);
                                    }}>{complete ? `Pass ${exam.title}` : "Requirements Incomplete"}</button>
                                </div>}
                            </section>
                        );
                    })}
                </>
            )}
            {activeVillageWar && (
                <>
                    <h3>Village War Missions</h3>
                    <section className="summary-box mission-board-section">
                        <h3>{character.village} vs {activeVillageWarEnemy}</h3>
                        <p className="hint">War Ground: Sector {activeVillageWar.warGroundSector}. Each mission needs 3 successful enemy-village raids and claims for -30 enemy village HP.</p>
                        <div className="location-grid">{villageWarDailyMissions.map((mission) => {
                            const canClaim = !mission.complete && todayWarCompleted === mission.index && mission.progress >= VILLAGE_WAR_RAIDS_PER_MISSION;
                            return <div key={mission.title} className="location-button mission-card"><span className="tile-icon">WAR</span><span>{mission.title}</span><small>Raid enemy village from Sector {activeVillageWar.warGroundSector}: {mission.progress}/{VILLAGE_WAR_RAIDS_PER_MISSION}</small><small>Reward: -{VILLAGE_WAR_MISSION_DAMAGE} enemy village HP</small><div className="mission-progress"><span style={{ width: `${(mission.progress / VILLAGE_WAR_RAIDS_PER_MISSION) * 100}%` }}></span></div><div className="menu">{mission.complete ? <button disabled>Complete Today</button> : canClaim ? <button onClick={() => claimWarMission(mission.index)}>Claim War Damage</button> : <button onClick={goToWarGround}>Go To War Ground</button>}</div></div>;
                        })}</div>
                    </section>
                </>
            )}
            {dailyMissions.length > 0 && (
                <>
                    <h3>Daily Missions</h3>
                    <div className="location-grid">{dailyMissions.map((mission) => {
                        const accepted = acceptedMissionIds.includes(mission.id);
                        const progress = missionProgress[mission.id] ?? 0;
                        const raidReq = missionRaidRequirement(mission);
                        const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
                        const complete = progress >= mission.exploreCount && raidProgress >= raidReq;
                        const progressPercent = Math.min(100, ((Math.min(mission.exploreCount, progress) + Math.min(raidReq, raidProgress)) / Math.max(1, mission.exploreCount + raidReq)) * 100);
                        const boostedXp = boostAmount(mission.xpReward, missionRewardBonus);
                        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
                        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
                        return (
                            <div key={mission.id} className="location-button mission-card">
                                <CardVisual icon="📜" label={mission.name} />
                                <span>{mission.name}</span>
                                <small>Sector {mission.targetSector} | Explore {progress}/{mission.exploreCount}{raidReq > 0 ? ` | Raid ${raidProgress}/${raidReq}` : ""}</small>
                                <small>Lvl {mission.levelReq} | {rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards, character)}</small>
                                <p>{mission.description}</p>
                                <div className="mission-progress"><span style={{ width: `${progressPercent}%` }}></span></div>
                                <div className="menu">
                                    {!accepted ? <button onClick={() => acceptMission(mission)}>Accept</button> : complete ? <button onClick={() => { void claimMission(mission); }}>Claim Reward</button> : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>}
                                </div>
                            </div>
                        );
                    })}</div>
                </>
            )}
            {logbookEvents.length > 0 && (
                <>
                    <h3>Events</h3>
                    <div className="location-grid">{logbookEvents.map((event) => (
                        <div key={event.id} className="location-button mission-card">
                            <CardVisual image={(event.image || event.avatarImage || '')} icon={event.icon} label={event.name} />
                            <span>{event.name}</span>
                            <small>Lvl {event.levelReq} | {event.biome} | {rewardSummary(event.xpReward, event.ryoReward, event.staminaReward, event.currencyRewards, character)}</small>
                            <p>{event.dialogue.join(" ")}</p>
                            <div className="menu"><button onClick={() => claimRewardEvent(event)}>Claim Event Reward</button></div>
                        </div>
                    ))}</div>
                </>
            )}
            {logbookRaids.length > 0 && (
                <>
                    <h3>Raids</h3>
                    <div className="location-grid">{logbookRaids.map((raid) => {
                        const raidAi = raid.aiProfileId ? creatorAis.find((ai) => ai.id === raid.aiProfileId) : undefined;
                        return (
                            <div key={raid.id} className="location-button mission-card">
                                <CardVisual image={raidAi?.image} icon={raid.icon} label={raid.name} />
                                <span>{raid.name}</span>
                                <small>{raid.waves} waves | Lvl {raid.levelReq} | {raid.biome}</small>
                                <small>Boss: {raidAi?.name ?? raid.aiProfileId ?? "Default arena AI"} | Reward: {rewardSummary(raid.xpReward, raid.ryoReward, raid.staminaReward, raid.currencyRewards, character)}</small>
                                <p>{raid.description}</p>
                                <div className="menu"><button onClick={() => startRaid(raid)}>Start Raid</button></div>
                            </div>
                        );
                    })}</div>
                </>
            )}
            <h3>Assigned Missions</h3>
            {assignedMissions.length === 0 && missingMissionIds.length === 0 ? (
                <div className="summary-box">
                    <h3>No Active Assignments</h3>
                    <p className="hint">Accept a fetch mission from the Mission Hall to track it here.</p>
                    <button onClick={() => setScreen("missions")}>Open Mission Hall</button>
                </div>
            ) : (
                <div className="location-grid">
                    {assignedMissions.map((mission) => {
                        const progress = missionProgress[mission.id] ?? 0;
                        const raidReq = missionRaidRequirement(mission);
                        const raidProgress = missionProgress[missionRaidProgressKey(mission.id)] ?? 0;
                        const complete = progress >= mission.exploreCount && raidProgress >= raidReq;
                        const progressPercent = Math.min(100, ((Math.min(mission.exploreCount, progress) + Math.min(raidReq, raidProgress)) / Math.max(1, mission.exploreCount + raidReq)) * 100);
                        const boostedXp = boostAmount(mission.xpReward, missionRewardBonus);
                        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
                        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
                        return (
                            <div key={mission.id} className="location-button mission-card">
                                <CardVisual image={creatorAis.find((ai) => ai.id === mission.aiProfileId)?.image} icon={mission.rank} label={mission.name} />
                                <span>{mission.name}</span>
                                <small>Sector {mission.targetSector} | Explore {progress}/{mission.exploreCount}{raidReq > 0 ? ` | Raid ${raidProgress}/${raidReq}` : ""}</small>
                                <small>Lvl {mission.levelReq} | {rewardSummary(boostedXp, boostedRyo, boostedStamina, mission.currencyRewards, character)}</small>
                                <p>{mission.description}</p>
                                <div className="mission-progress"><span style={{ width: `${progressPercent}%` }}></span></div>
                                <div className="menu">
                                    {complete ? <button onClick={() => { void claimMission(mission); }}>Claim Reward</button> : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>}
                                    <button className="danger-button" onClick={() => abandonMission(mission.id)}>Abandon</button>
                                </div>
                            </div>
                        );
                    })}
                    {missingMissionIds.map((missionId) => (
                        <div key={missionId} className="location-button mission-card">
                            <span className="tile-icon">OLD</span>
                            <span>Archived Assignment</span>
                            <small>This mission no longer exists on the mission board.</small>
                            <div className="menu"><button className="danger-button" onClick={() => abandonMission(missionId)}>Remove</button></div>
                        </div>
                    ))}
                </div>
            )}
            {defeatedAiIds.length > 0 && (
                <>
                    <h3>Bestiary</h3>
                    <p className="hint">Foes defeated: <strong>{defeatedAiIds.length}</strong> logged. Repeated kills raise each foe's rank (Novice → Veteran 10 → Expert 25 → Master 100).</p>
                    <div className="location-grid">
                        {defeatedAiIds.map((id) => {
                            const ai = creatorAis.find((a) => a.id === id);
                            const kills = character.aiKills?.[id] ?? 0;
                            const shown = kills || 1; // legacy entries (logged before kill-counts) show ×1
                            const tier = shown >= 100 ? "Master" : shown >= 25 ? "Expert" : shown >= 10 ? "Veteran" : "Novice";
                            const nextThreshold = shown >= 25 ? 100 : shown >= 10 ? 25 : 10;
                            return (
                                <div key={id} className="location-button mission-card">
                                    <CardVisual image={ai?.image} icon={ai?.icon ?? "🐉"} label={ai?.name ?? "Unknown"} />
                                    <span>{ai?.name ?? "Unknown Foe"}</span>
                                    <small>{ai ? `Lv ${ai.level} · ${ai.village}` : "No longer roams the world"}</small>
                                    <small>Defeated ×{shown} · {tier}</small>
                                    <div className="mission-progress"><span style={{ width: `${Math.min(100, (shown / nextThreshold) * 100)}%` }} /></div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}
