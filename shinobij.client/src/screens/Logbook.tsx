import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/hub-screens-skin.css";
import type React from "react";
import type { Biome, WeatherType, Screen } from "../types/core";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission, CreatorRaid } from "../types/missions";
import { CardVisual } from "../components/Marks";
import { DAILY_MISSION_LIMIT, FIELD_MISSION_STAT_POINTS } from "../constants/game";
import { builtinFetchMissions, mergeBuiltinMissions, missionRaidProgressKey, missionRaidRequirement } from "../data/missions";
import { rewardSummary, statPointNote } from "../lib/currency";
import { boostAmount, getMissionRewardBonus } from "../lib/village-upgrades";
import { clampNumber, currentDateKey } from "../lib/utils";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { hasDailyMissionSlot } from "../lib/character-progress";
import { buildLogbookObjectives, currentLogbookObjective, objectiveComplete, type LogbookObjective, type ObjectiveRequirement } from "../lib/logbook-objectives";
import { postClaimMission, applyServerMissionReward, claimReasonMessage } from "../lib/claim-mission";
import { commitAuthoritativeMissionClaim } from "../lib/versioned-mission-claim";
import { weatherForBiome } from "../data/sectors";
import {
    gainXp,
    type CreatorEvent,
} from "../App";
import { activeVillageWarsFor, applyVillageWarMissionDamage, loadVillageState, weatherForSector, VILLAGE_WAR_DAILY_MISSIONS, VILLAGE_WAR_MISSION_DAMAGE, VILLAGE_WAR_RAIDS_PER_MISSION } from "../lib/world-state";
import { requestAiFight } from "../lib/ai-fight-request";
import { mintAiRaidToken } from "../lib/ai-raid-api";
import { claimWarMissionServer } from "../lib/world-reward-api";
import { passRankExamServer } from "../lib/exam-api";
import { postFieldTrail, type FieldTrailResult } from "../lib/field-trail-api";

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
    setCurrentSector,
    setCurrentBiome,
    setCurrentWeather,
    setScreen,
    onVersionedCharacter,
    onServerVersion,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    creatorAis: CreatorAi[];
    creatorMissions: CreatorMission[];
    creatorEvents: CreatorEvent[];
    creatorRaids: CreatorRaid[];
    acceptedMissionIds: string[];
    setAcceptedMissionIds: React.Dispatch<React.SetStateAction<string[]>>;
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    setCurrentSector: (sector: number) => void;
    setCurrentBiome: (biome: Biome) => void;
    setCurrentWeather: (weather: WeatherType) => void;
    setScreen: (screen: Screen) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    onServerVersion: (version: unknown) => boolean;
    // Adopt the save version returned by the server-settled war-mission claim,
    // so the next autosave isn't rejected as stale.
}) {
    const [ceremony, setCeremony] = useState<{ title: string; prestige: boolean } | null>(null);
    const [warMissionPending, setWarMissionPending] = useState(false);
    const raidLaunchInFlight = useRef(false);
    const [fieldTrailPending, setFieldTrailPending] = useState<string | null>(null);
    const fieldClaimInFlight = useRef(false);
    const [claimingFieldMissionId, setClaimingFieldMissionId] = useState<string | null>(null);
    const missionRewardBonus = getMissionRewardBonus(character) + getActiveAuraSphereBonuses(character).missionRewardPercent;
    const defeatedAiIds = character.defeatedAiIds ?? [];
    const availableLogbookMissions = mergeBuiltinMissions(creatorMissions);
    const assignedMissions = acceptedMissionIds
        .map((id) => availableLogbookMissions.find((mission) => mission.id === id))
        .filter((mission): mission is CreatorMission => Boolean(mission));
    const acceptedFieldMissionKey = acceptedMissionIds
        .filter((id) => builtinFetchMissions.some((mission) => mission.id === id))
        .sort()
        .join("|");
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
    // Structured progression objectives (Academy checklist + rank exams) are
    // built by the shared lib so the Daily Briefing surfaces the same data and
    // the requirement definitions live in one place. Only the env facts the pure
    // builder can't derive from the save are supplied here.
    const objectiveContext = {
        examProctorExists: creatorAis.some((ai) => ai.id === "builtin-ai-exam-proctor"),
        rogueNinjaExists: creatorAis.some((ai) => ai.id === "builtin-ai-rogue-ninja"),
        isKage: character.level >= 80 && loadVillageState(character.village).seatedKage?.toLowerCase() === character.name.toLowerCase(),
        isElder: loadVillageState(character.village).anbuAppointees.some((name) => name.toLowerCase() === character.name.toLowerCase()),
    };
    const objectives = buildLogbookObjectives(character, objectiveContext);
    const currentObjective = currentLogbookObjective(character, objectiveContext);
    const academyChecklist = objectives.find((o) => o.kind === "academy") ?? null;
    const academyComplete = academyChecklist ? objectiveComplete(academyChecklist) : false;
    const chapterObjectives = objectives.filter((o) => o.kind === "chapter");
    const examMissions = objectives.filter(
        (o): o is LogbookObjective & { examKey: string } => o.kind === "exam" && o.examKey !== undefined,
    );
    const blockingExams = examMissions.filter((exam) => exam.progressionImpact === "blocking");
    const prestigeMilestones = examMissions.filter((exam) => exam.progressionImpact === "prestige");
    const ceremonyBody = ceremony?.prestige
        ? `Distinction recorded for ${character.name}. This recognition grants no extra levels, stats, jutsu power, or content access.`
        : ceremony?.title === "Genin Advancement Exam"
        ? "You graduated from the Academy. The village now trusts you with real shinobi work."
        : `Congratulations, ${character.name}. Your next shinobi path is open.`;

    function applySuccessfulMissionClaim(result: Extract<NonNullable<Awaited<ReturnType<typeof postClaimMission>>>, { applied: true }>): boolean {
        const authoritativeCommit = commitAuthoritativeMissionClaim(result, onVersionedCharacter);
        if (authoritativeCommit !== null) return authoritativeCommit;
        if (!onServerVersion(result._saveVersion)) return false;
        updateCharacter((prev) => (prev ? applyServerMissionReward(prev, result, gainXp) : prev));
        return true;
    }

    // Server-authoritative field claims. Unknown/creator-authored mission ids are
    // rejected by the server instead of paid locally.
    async function claimMission(mission: CreatorMission) {
        if (fieldClaimInFlight.current) return;
        fieldClaimInFlight.current = true;
        setClaimingFieldMissionId(mission.id);
        try {
            await claimMissionOnce(mission);
        } finally {
            fieldClaimInFlight.current = false;
            setClaimingFieldMissionId(null);
        }
    }

    async function claimMissionOnce(mission: CreatorMission) {
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
            alert(`${mission.name} complete. ${statPointNote(result.reward.statPoints)}${rewardSummary(result.reward.ryo, result.reward.stamina, result.reward.currency, character, { territoryScrolls: result.reward.territoryScrolls })}.`);
            return;
        }
        if (result.applied === false) {
            if (result.reason === "already-claimed-today"
                || result.reason === "already-claimed"
                || result.reason === "not-accepted") {
                const state = await postFieldTrail({ playerName: character.name, missionId: mission.id, action: "state" });
                if (!adoptFieldTrail(state)) {
                    return alert("The reward status is still syncing with the Mission Hall. Try Claim again to reconcile it safely.");
                }
                return alert(claimReasonMessage(result.reason, result));
            }
            if (result.serverProgress) {
                const { exploreCount, raidCount } = result.serverProgress;
                setMissionProgress((prev) => ({
                    ...prev,
                    [mission.id]: Math.min(mission.exploreCount, Math.max(0, exploreCount)),
                    [missionRaidProgressKey(mission.id)]: Math.min(raidReq, Math.max(0, raidCount)),
                }));
                return alert(`The Mission Hall corrected this contract to ${exploreCount}/${mission.exploreCount} sweeps${raidReq > 0 ? ` and ${raidCount}/${raidReq} raids` : ""}. Finish the remaining verified work, then claim again.`);
            }
            return alert(claimReasonMessage(result.reason, result));
        }
    }

    const adoptFieldTrail = useCallback((result: FieldTrailResult): boolean => {
        if (!result.character || !onVersionedCharacter(result.character, result._saveVersion)) return false;
        if (result.acceptedMissionIds) setAcceptedMissionIds(result.acceptedMissionIds);
        if (result.missionProgress) setMissionProgress(result.missionProgress);
        return true;
    }, [onVersionedCharacter, setAcceptedMissionIds, setMissionProgress]);

    async function acceptMission(mission: CreatorMission) {
        if (character.level < mission.levelReq) return alert(`Requires level ${mission.levelReq}.`);
        if (!builtinFetchMissions.some((entry) => entry.id === mission.id)) {
            return alert("This creator field mission is awaiting a published server contract. Nothing was accepted.");
        }
        if (acceptedMissionIds.includes(mission.id) || fieldTrailPending) return;
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
            alert(`${mission.name} accepted. Explore Sector ${mission.targetSector} ${mission.exploreCount} times${raidReq > 0 ? ` and raid the village ${raidReq} time(s)` : ""}.`);
        } finally {
            setFieldTrailPending(null);
        }
    }

    function claimRewardEvent(event: CreatorEvent) {
        if (character.level < event.levelReq) return alert(`Requires level ${event.levelReq}.`);
        alert(`${event.name} is narrative-only until its reward is published in the server catalog.`);
    }

    async function startRaid(raid: CreatorRaid) {
        if (character.level < raid.levelReq) return alert(`Requires level ${raid.levelReq}.`);
        if (!raid.targetSector || !raid.aiProfileId) return alert("This raid has not been published with a verified guard and sector.");
        if (raidLaunchInFlight.current) return;
        raidLaunchInFlight.current = true;
        if (raid.targetSector) setCurrentSector(raid.targetSector);
        setCurrentBiome(raid.biome);
        setCurrentWeather(weatherForBiome(raid.biome));
        try {
            const raidProof = await mintAiRaidToken({
                playerName: character.name,
                opponentId: raid.aiProfileId,
                sector: raid.targetSector,
            });
            if (!raidProof) return alert("The raid could not be verified. Try again in a moment.");
            setCurrentSector(raidProof.sector);
            if (!requestAiFight({
                opponentId: raidProof.opponentId,
                opponentLevel: raid.levelReq,
                battleKind: "raidAi",
                opponentName: raid.name,
                sector: raidProof.sector,
                raidToken: raidProof.token,
            })) alert("The combat host is unavailable. Return to the Logbook and try again.");
        } finally {
            raidLaunchInFlight.current = false;
        }
    }

    function goToWarGround() {
        if (!activeVillageWar) return alert("Your village is not in an active war.");
        const biome = "central" as Biome;
        setCurrentSector(activeVillageWar.warGroundSector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(activeVillageWar.warGroundSector, biome));
        setScreen("worldMap");
    }

    // The player half of this mission is settled by /api/village/war-mission —
    // every counter it awards is frozen by the save sanitizer, so the old inline
    // claim burned the day's stamp and paid nothing. Commit the reward FIRST,
    // then apply the war damage, so a refused claim leaves the war untouched.
    async function claimWarMission(index: number) {
        if (warMissionPending) return;
        setWarMissionPending(true);
        try {
            const settled = await claimWarMissionServer(character.name, index);
            if (!settled.character) {
                return alert(settled.error === "not-enough-raids"
                    ? "Raid the enemy village more times before claiming this mission."
                    : settled.error === "out-of-order"
                        ? "Claim earlier village war missions first."
                        : settled.error === "no-village"
                            ? "Your village is not in an active war."
                            : "The mission could not be claimed right now. Try again in a moment.");
            }
            if (!onVersionedCharacter(settled.character, settled.saveVersion)) return;
            const war = applyVillageWarMissionDamage(settled.character, settled.warMissionToken);
            alert(war.note);
        } finally {
            setWarMissionPending(false);
        }
    }

    async function abandonMission(missionId: string) {
        if (fieldTrailPending) return;
        if (!builtinFetchMissions.some((entry) => entry.id === missionId)) {
            return alert("This unpublished mission cannot alter the server contract ledger.");
        }
        setFieldTrailPending(missionId);
        try {
            const result = await postFieldTrail({ playerName: character.name, missionId, action: "abandon" });
            const adopted = adoptFieldTrail(result);
            if (!result.ok) alert(result.error ?? "The Mission Hall could not abandon this contract.");
            else if (!adopted) alert("The Mission Hall is still syncing this contract. Reopen the board to recover it.");
        } finally {
            setFieldTrailPending(null);
        }
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

    function startExamFight(aiId: string) {
        const ai = creatorAis.find((candidate) => candidate.id === aiId);
        if (!ai) return alert("Exam AI is not available.");
        // A practice bout: `practice` grants nothing on either route (see
        // lib/ai-fight-settle) — the exam is a skill check, not a faucet.
        requestAiFight({
            opponentId: ai.id,
            opponentLevel: ai.level ?? character.level,
            battleKind: "practice",
            opponentName: ai.name,
            enemyAvatar: ai.image,
        });
    }

    // Academy graduation capstone — one-time, server-authoritative reward for
    // finishing all of the Academy Training goals. Mirrors claimAcademyTrial in
    // Missions.tsx: the client posts only the type/id, the server resolves the
    // sealed reward (XP + ryo + stamina + Fate Shards), enforces the one-time
    // latch, and returns the amounts we mirror locally.
    async function claimAcademyReward() {
        const result = await postClaimMission(character.name, "academy-checklist", "academy-checklist");
        if (result === null) return alert("Could not reach the server. Try again.");
        if (result.applied === false) return alert(claimReasonMessage(result.reason));
        if (!applySuccessfulMissionClaim(result)) return;
        const shards = result.reward.currency?.fateShards ?? 0;
        alert(`Academy Training complete! +${result.reward.statPoints ?? 0} stat points, +${result.reward.ryo} ryo, +${result.reward.stamina} stamina${shards ? `, +${shards} Fate Shards` : ""}. Keep following your Logbook path toward Genin.`);
    }

    function renderRequirement(requirement: ObjectiveRequirement) {
        const complete = requirement.progress >= requirement.target;
        const progressText = requirement.target === 1
            ? complete ? "Complete" : "Incomplete"
            : `${Math.min(requirement.progress, requirement.target)}/${requirement.target}`;
        return (
            <div key={requirement.label} className={`logbook-requirement-card${complete ? " complete" : ""}`}>
                <h4><span>{complete ? "Done" : "Open"}</span>{requirement.label}</h4>
                <p>{progressText}{requirement.detail ? ` | ${requirement.detail}` : ""}</p>
                <div className="mission-progress" aria-label={`${requirement.label} progress ${progressText}`}><span style={{ width: `${Math.min(100, (requirement.progress / requirement.target) * 100)}%` }}></span></div>
                {requirement.aiId && !complete && <button onClick={() => startExamFight(requirement.aiId as string)}>Fight {requirement.label.replace("Defeat ", "")}</button>}
                {requirement.goScreen && !complete && <button onClick={() => setScreen(requirement.goScreen as Screen)}>{requirement.goLabel ?? "Go"}</button>}
            </div>
        );
    }

    function renderExam(exam: LogbookObjective & { examKey: string }) {
        const passed = (character.examsPassed ?? []).includes(exam.examKey);
        const complete = objectiveComplete(exam);
        const prestige = exam.progressionImpact === "prestige";
        const isBlocking = !prestige && !passed && character.level >= exam.unlockLevel;
        return (
            <section className="summary-box mission-board-section" key={exam.id}>
                <h3>{exam.title} {prestige ? <small className="activity-spine-returner">Optional Prestige</small> : null} {passed ? "✓" : ""}</h3>
                {exam.summary && <p className="hint">{exam.summary}</p>}
                {prestige
                    ? <p className="hint"><strong>Progression impact: none.</strong> This distinction does not block leveling, stats, jutsu, or content.</p>
                    : <p className="hint">Progression hold: level {exam.unlockLevel}. Status: <strong>{passed ? "Passed" : complete ? "Ready to pass" : "In progress"}</strong></p>}
                {isBlocking && !complete && <p style={{ color: "var(--red-400)", fontWeight: "bold" }}>You cannot level past {exam.unlockLevel} until you pass this exam.</p>}
                <div className="location-grid">{exam.requirements.map(renderRequirement)}</div>
                {!passed && <div className="menu">
                    <button disabled={!complete} onClick={() => {
                        void passRankExamServer(character.name, exam.examKey).then((next) => {
                            updateCharacter(next);
                            setCeremony({ title: exam.title, prestige });
                        }).catch((error) => alert(error instanceof Error ? error.message : "Rank exam could not be verified."));
                    }}>{complete ? prestige ? "Claim Distinction" : `Pass ${exam.title}` : "Requirements Incomplete"}</button>
                </div>}
            </section>
        );
    }

    return (
        <div className="card logbook-screen">
            <h2>Logbook</h2>
            {/* Rank-up celebration. Portaled to <body> at z-index 1000000, which is the
                house convention for any full-screen overlay: the desktop nav rail sits at
                999999, so this used to draw BEHIND the rail at its old z-index of 9000 —
                and passing a rank exam is one of the game's few marquee moments. Portaling
                also escapes the .logbook-screen card's own stacking/overflow context. */}
            {ceremony && createPortal(
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000000, padding: 16 }}>
                    <div className="card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
                        <div style={{ fontSize: 48, marginBottom: 4 }}>🎉</div>
                        <h2 style={{ marginTop: 0 }}>{ceremony.prestige ? `${ceremony.title} Recorded` : `${ceremony.title} Passed!`}</h2>
                        <p>{ceremonyBody}</p>
                        <button className="start-primary-btn" style={{ width: "100%" }} onClick={() => setCeremony(null)}>Continue →</button>
                    </div>
                </div>,
                document.body,
            )}
            <p>Progression exams: <strong>{blockingExams.length}</strong> · Prestige milestones: <strong>{prestigeMilestones.length}</strong> · Daily missions: <strong>{dailyMissions.length + (activeVillageWar ? VILLAGE_WAR_DAILY_MISSIONS : 0)}</strong> · Events: <strong>{logbookEvents.length}</strong> · Raids: <strong>{logbookRaids.length}</strong> · Assigned missions: <strong>{assignedMissions.length}</strong></p>
            {academyChecklist && (
                <>
                    <h3>Academy Training</h3>
                    <section className="academy-logbook-panel mission-board-section">
                        <p className="hint">Complete these goals to learn the core loop, then follow the Path to Genin chapters.</p>
                        <div className="logbook-requirement-grid">{academyChecklist.requirements.map(renderRequirement)}</div>
                        {academyComplete && (
                            <div className="menu">
                                <button className="start-primary-btn academy-reward-btn" onClick={claimAcademyReward}>Claim Academy Reward</button>
                            </div>
                        )}
                    </section>
                </>
            )}
            {chapterObjectives.length > 0 && (
                <>
                    <h3>Path to Genin</h3>
                    <section className="academy-logbook-panel chapter-logbook-panel mission-board-section">
                        <p className="hint">Follow these chapters after the tutorial. You become Genin at level 15; the Genin Advancement Exam is the level-20 progression hold.</p>
                        {chapterObjectives.map((chapter) => {
                            const complete = objectiveComplete(chapter);
                            const active = currentObjective?.id === chapter.id;
                            return (
                                <div key={chapter.id} className={`logbook-chapter-card${complete ? " complete" : ""}${active ? " active" : ""}`}>
                                    <div className="logbook-chapter-header">
                                        <div>
                                            <h4>{chapter.title}</h4>
                                            {chapter.summary && <p className="hint">{chapter.summary}</p>}
                                        </div>
                                        <span>{complete ? "Complete" : active ? "Current" : `Lvl ${chapter.unlockLevel}+`}</span>
                                    </div>
                                    <div className="logbook-requirement-grid">{chapter.requirements.map(renderRequirement)}</div>
                                </div>
                            );
                        })}
                    </section>
                </>
            )}
            <details className="summary-box mission-board-section" style={{ marginBottom: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Academy Help - quick basics</summary>
                <div style={{ marginTop: 8, lineHeight: 1.5, fontSize: 14 }}>
                    <p><strong>Next step.</strong> Follow the Academy goals above from top to bottom.</p>
                    <p><strong>Combat.</strong> Spend AP on Basic Attack and Jutsu. When AP runs low, press Wait to end the turn and recover.</p>
                    <p><strong>Growth.</strong> Training raises stats over time. Jutsu grow from Training Hall levels and battle use.</p>
                    <p><strong>Missions.</strong> Finish the task, return to Mission Hall, then claim the reward.</p>
                    <p><strong>Story.</strong> Once the Academy path is complete, your village story finds you on its own. Revisit past chapters and choices any time in the Story Hall.</p>
                </div>
            </details>
            {blockingExams.length > 0 && (
                <>
                    <h3>Rank Exams</h3>
                    {blockingExams.map(renderExam)}
                </>
            )}
            {prestigeMilestones.length > 0 && (
                <>
                    <h3>Prestige Milestones</h3>
                    <p className="hint">Optional recognition for veteran accomplishments. These milestones never hold progression.</p>
                    {prestigeMilestones.map(renderExam)}
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
                            return <div key={mission.title} className="location-button mission-card"><span className="tile-icon">WAR</span><span>{mission.title}</span><small>Raid enemy village from Sector {activeVillageWar.warGroundSector}: {mission.progress}/{VILLAGE_WAR_RAIDS_PER_MISSION}</small><small>Reward: -{VILLAGE_WAR_MISSION_DAMAGE} enemy village HP</small><div className="mission-progress"><span style={{ width: `${(mission.progress / VILLAGE_WAR_RAIDS_PER_MISSION) * 100}%` }}></span></div><div className="menu">{mission.complete ? <button disabled>Complete Today</button> : canClaim ? <button disabled={warMissionPending} onClick={() => { void claimWarMission(mission.index); }}>{warMissionPending ? "Claiming…" : "Claim War Damage"}</button> : <button onClick={goToWarGround}>Go To War Ground</button>}</div></div>;
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
                        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
                        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
                        return (
                            <div key={mission.id} className="location-button mission-card">
                                <CardVisual icon="📜" label={mission.name} />
                                <span>{mission.name}</span>
                                <small>Sector {mission.targetSector} | Explore {progress}/{mission.exploreCount}{raidReq > 0 ? ` | Raid ${raidProgress}/${raidReq}` : ""}</small>
                                <small>Lvl {mission.levelReq} | +{FIELD_MISSION_STAT_POINTS} Stat Pts / {rewardSummary(boostedRyo, boostedStamina, mission.currencyRewards, character)}</small>
                                <p>{mission.description}</p>
                                <div className="mission-progress"><span style={{ width: `${progressPercent}%` }}></span></div>
                                <div className="menu">
                                    {!accepted ? <button disabled={fieldTrailPending !== null || claimingFieldMissionId !== null} onClick={() => { void acceptMission(mission); }}>Accept</button> : complete ? <button disabled={claimingFieldMissionId !== null} onClick={() => { void claimMission(mission); }}>{claimingFieldMissionId === mission.id ? "Claimingâ€¦" : "Claim Reward"}</button> : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>}
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
                            <small>Lvl {event.levelReq} | {event.biome} | {rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards, character)}</small>
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
                                <small>Boss: {raidAi?.name ?? raid.aiProfileId ?? "Default arena AI"} | Reward: {rewardSummary(raid.ryoReward, raid.staminaReward, raid.currencyRewards, character)}</small>
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
                        const boostedRyo = boostAmount(mission.ryoReward, missionRewardBonus);
                        const boostedStamina = boostAmount(mission.staminaReward, missionRewardBonus);
                        return (
                            <div key={mission.id} className="location-button mission-card">
                                <CardVisual image={creatorAis.find((ai) => ai.id === mission.aiProfileId)?.image} icon={mission.rank} label={mission.name} />
                                <span>{mission.name}</span>
                                <small>Sector {mission.targetSector} | Explore {progress}/{mission.exploreCount}{raidReq > 0 ? ` | Raid ${raidProgress}/${raidReq}` : ""}</small>
                                <small>Lvl {mission.levelReq} | {rewardSummary(boostedRyo, boostedStamina, mission.currencyRewards, character)}</small>
                                <p>{mission.description}</p>
                                <div className="mission-progress"><span style={{ width: `${progressPercent}%` }}></span></div>
                                <div className="menu">
                                    {complete ? <button disabled={claimingFieldMissionId !== null} onClick={() => { void claimMission(mission); }}>{claimingFieldMissionId === mission.id ? "Claimingâ€¦" : "Claim Reward"}</button> : <button onClick={() => setScreen("worldMap")}>Go To Sector {mission.targetSector}</button>}
                                    <button className="danger-button" disabled={fieldTrailPending !== null || claimingFieldMissionId !== null} onClick={() => { void abandonMission(mission.id); }}>Abandon</button>
                                </div>
                            </div>
                        );
                    })}
                    {missingMissionIds.map((missionId) => (
                        <div key={missionId} className="location-button mission-card">
                            <span className="tile-icon">OLD</span>
                            <span>Archived Assignment</span>
                            <small>This mission no longer exists on the mission board.</small>
                            <div className="menu"><button className="danger-button" disabled={fieldTrailPending !== null || claimingFieldMissionId !== null} onClick={() => { void abandonMission(missionId); }}>Remove</button></div>
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
