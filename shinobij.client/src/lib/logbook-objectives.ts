/*
 * Logbook objectives — the player's structured progression goals: the Academy
 * Training checklist (level 1-14 onboarding) and the four rank exams (Genin,
 * Chunin, Jonin, Special Jonin). Each objective is a list of requirements, each
 * with a current progress and a target.
 *
 * This is the single source of truth shared by the Logbook screen (which renders
 * every objective and lets the player claim them) and the Daily Briefing modal
 * (which surfaces just the one objective the player is currently working toward).
 * Pure — no world-state/cache imports — so it stays unit-testable; the two
 * environment-specific facts the save can't carry (whether the built-in exam AIs
 * still exist, and the player's seated-Kage / Elder standing) are passed in by
 * the caller. Keep the requirement definitions here in lockstep with how the
 * Logbook awards them.
 */
import type { Screen } from "../types/core";
import type { Character } from "../types/character";
import { baseStats, rankFromLevel } from "./stats";
import { getCharacterElements } from "./elements";

export interface ObjectiveRequirement {
    label: string;
    progress: number;
    target: number;
    detail?: string;
    aiId?: string;
    goScreen?: Screen;
    goLabel?: string;
}

export interface LogbookObjective {
    id: string;
    kind: "academy" | "chapter" | "exam";
    title: string;
    summary?: string;
    examKey?: string;      // exams only — matches Character.examsPassed entries
    unlockLevel: number;
    requirements: ObjectiveRequirement[];
}

/**
 * Environment facts the pure builder can't derive from the save alone:
 *   - whether the built-in exam AIs are still on the roster (detail text only),
 *   - the player's seated-Kage / Elder standing (Special Jonin requirement).
 * Callers that don't know these can omit them; the defaults keep the objective
 * shape stable (Elder is inferred from the save; missing AIs are assumed present).
 */
export interface ObjectiveContext {
    examProctorExists?: boolean;
    rogueNinjaExists?: boolean;
    isKage?: boolean;
    isElder?: boolean;
}

export function objectiveComplete(objective: LogbookObjective): boolean {
    return objective.requirements.every((r) => r.progress >= r.target);
}

/**
 * Every progression objective the player has currently unlocked, in priority
 * order: the Academy checklist (while it's open) followed by each rank exam they
 * have reached. The Logbook renders the whole list; the briefing picks one.
 */
export function buildLogbookObjectives(character: Character, ctx: ObjectiveContext = {}): LogbookObjective[] {
    const {
        examProctorExists = true,
        rogueNinjaExists = true,
        isKage = false,
        isElder = Boolean(character.elderFocus),
    } = ctx;

    const ownedElements = getCharacterElements(character);
    const baseStatTotal = Object.values(baseStats()).reduce((sum, value) => sum + value, 0);
    const currentStatTotal = Object.values(character.stats).reduce((sum, value) => sum + value, 0);
    const statsTrained = Math.max(character.totalStatsTrained ?? 0, Math.max(0, currentStatTotal - baseStatTotal));
    const defeatedAiIds = character.defeatedAiIds ?? [];
    const highestJutsuMastery = Math.max(0, ...((character.jutsuMastery ?? []).map((m) => m.level)));
    const totalAiKills = character.totalAiKills ?? 0;
    const totalMissionsCompleted = character.totalMissionsCompleted ?? character.clanMissionContrib ?? 0;
    const totalTilesExplored = character.totalTilesExplored ?? 0;
    const hasGeninExamPassed = (character.examsPassed ?? []).includes("genin");
    const academyPathOpen =
        character.academyChecklistClaimed ||
        character.academyTrialClaimed ||
        character.onboardingStep === "done" ||
        character.level >= 3;

    const objectives: LogbookObjective[] = [];

    // Academy Training — soft, teach-by-doing onboarding goals that fill the gap
    // before the first rank exam (Genin). Hidden once claimed or once the player
    // outgrows Academy rank.
    if (!character.academyChecklistClaimed && rankFromLevel(character.level) === "Academy Student") {
        objectives.push({
            id: "academy-training",
            kind: "academy",
            title: "Academy Training",
            summary: "Learn the basic growth loop before the village sends you into real work.",
            unlockLevel: 1,
            requirements: [
                { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "Free roll at Level 2", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                { label: "Equip your jutsu loadout", progress: character.equippedJutsuIds.length, target: 4, detail: "Add a 4th jutsu", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                { label: "Win your first battle", progress: totalAiKills, target: 1, detail: "Fight in the Arena or a hunt", goScreen: "battleArena", goLabel: "Go Arena" },
                { label: "Train at the grounds", progress: statsTrained, target: 5, detail: "Train a stat at the Training Grounds", goScreen: "training", goLabel: "Go Train" },
                { label: "Complete your first mission", progress: totalMissionsCompleted, target: 1, detail: "Accept a D-rank mission below", goScreen: "missions", goLabel: "Go to Mission Hall" },
                { label: "Sharpen a jutsu (mastery Lv 3)", progress: highestJutsuMastery, target: 3, detail: "Using a jutsu in battle levels it", goScreen: "battleArena", goLabel: "Go Arena" },
            ],
        });
    }

    // Rank exams — each appears once the player reaches its unlock level.
    // Early chapters bridge the gap between the tutorial and the first rank gate.
    // They do not mint rewards themselves; they point into existing server-paid
    // combat, mission, and training loops.
    const showEarlyChapters = academyPathOpen && !hasGeninExamPassed && character.level < 20;
    if (showEarlyChapters) {
        const firstStepsRequirements: ObjectiveRequirement[] = [
            { label: "Reach level 3", progress: character.level, target: 3, detail: "Run rookie missions for XP", goScreen: "missions", goLabel: "Go Missions" },
            { label: "Win 3 AI battles", progress: totalAiKills, target: 3, detail: "Combat missions count after you claim them", goScreen: "missions", goLabel: "Go Combat" },
            { label: "Complete 3 missions", progress: totalMissionsCompleted, target: 3, detail: "Return to Mission Hall to claim rewards", goScreen: "missions", goLabel: "Go Missions" },
            { label: "Train 18 stat points", progress: statsTrained, target: 18, detail: "Three short sessions is enough", goScreen: "training", goLabel: "Go Train" },
            { label: "Equip 4 jutsu", progress: character.equippedJutsuIds.length, target: 4, detail: "Keep a full starter loadout", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
        ];
        if ((character.pets ?? []).length > 0 || character.activePetId) {
            firstStepsRequirements.push({
                label: "Check your starter companion",
                progress: character.activePetId ? 1 : 0,
                target: 1,
                detail: "Your companion grows with you; deep pet battles can wait",
                goScreen: "pets",
                goLabel: "Visit Pet Yard",
            });
        }

        const firstSteps: LogbookObjective = {
            id: "first-steps",
            kind: "chapter",
            title: "First Steps as a Shinobi",
            summary: "Repeat the core loop: fight, claim rewards, train, and keep your loadout ready.",
            unlockLevel: 1,
            requirements: firstStepsRequirements,
        };
        objectives.push(firstSteps);

        const firstStepsComplete = objectiveComplete(firstSteps);
        if (firstStepsComplete || character.level >= 5 || totalMissionsCompleted >= 3 || totalAiKills >= 3) {
            const fieldTraining: LogbookObjective = {
                id: "field-training",
                kind: "chapter",
                title: "Field Training",
                summary: "Step outside the village carefully and learn how field work feeds progression.",
                unlockLevel: 5,
                requirements: [
                    { label: "Reach level 7", progress: character.level, target: 7, detail: "Rookie missions are the fastest early XP", goScreen: "missions", goLabel: "Go Missions" },
                    { label: "Scout 5 world map tiles", progress: totalTilesExplored, target: 5, detail: "Explore safely and return for rewards", goScreen: "worldMap", goLabel: "Open World Map" },
                    { label: "Complete 5 missions", progress: totalMissionsCompleted, target: 5, detail: "Combat and field claims both count", goScreen: "missions", goLabel: "Go Missions" },
                    { label: "Win 5 AI battles", progress: totalAiKills, target: 5, detail: "Use Basic Attack, jutsu, then Wait when AP is low", goScreen: "missions", goLabel: "Go Combat" },
                    { label: "Train 60 stat points", progress: statsTrained, target: 60, detail: "Training raises the power your rank cap can use", goScreen: "training", goLabel: "Go Train" },
                ],
            };
            objectives.push(fieldTraining);

            const fieldTrainingComplete = objectiveComplete(fieldTraining);
            if (fieldTrainingComplete || character.level >= 10 || totalMissionsCompleted >= 7 || totalAiKills >= 7) {
                objectives.push({
                    id: "ready-for-genin",
                    kind: "chapter",
                    title: "Ready for Genin",
                    summary: "Genin is the first real graduation milestone. Build enough fundamentals to pass the capstone.",
                    unlockLevel: 10,
                    requirements: [
                        { label: "Reach level 15", progress: character.level, target: 15, detail: "Level 15 changes your rank to Genin", goScreen: "missions", goLabel: "Earn XP" },
                        { label: "Complete 10 missions", progress: totalMissionsCompleted, target: 10, detail: "Claim rewards back at Mission Hall", goScreen: "missions", goLabel: "Go Missions" },
                        { label: "Win 10 AI battles", progress: totalAiKills, target: 10, detail: "Rookie combat missions are safe practice", goScreen: "missions", goLabel: "Go Combat" },
                        { label: "Train 120 stat points", progress: statsTrained, target: 120, detail: "Short or long timers both count", goScreen: "training", goLabel: "Go Train" },
                        { label: "Scout 10 world map tiles", progress: totalTilesExplored, target: 10, detail: "Learn the field route before harder work", goScreen: "worldMap", goLabel: "Open World Map" },
                        { label: "Keep 4 jutsu equipped", progress: character.equippedJutsuIds.length, target: 4, detail: "A complete loadout matters more than one trick", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                        { label: "Sharpen a jutsu to Lv 3", progress: highestJutsuMastery, target: 3, detail: "Use jutsu in battle to raise mastery", goScreen: "battleArena", goLabel: "Go Arena" },
                    ],
                });
            }
        }
    }

    if (character.level >= 20) {
        objectives.push({
            id: "exam-genin",
            kind: "exam",
            title: "Genin Exam",
            summary: "You are at the level-20 hold. Pass this exam to continue leveling as a trusted Genin.",
            examKey: "genin",
            unlockLevel: 20,
            requirements: [
                { label: "Reach the Genin exam gate (Level 20)", progress: character.level, target: 20, detail: "The level hold lifts once you pass", goScreen: "missions", goLabel: "Earn XP" },
                { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "No element awakened" },
                { label: "Train 400 stats", progress: statsTrained, target: 400, goScreen: "training", goLabel: "Go Train" },
                { label: "Complete 20 missions", progress: totalMissionsCompleted, target: 20, goScreen: "missions", goLabel: "Go Missions" },
                { label: "Kill 20 AI", progress: totalAiKills, target: 20, goScreen: "missions", goLabel: "Go Combat" },
                { label: "Explore 50 tiles", progress: totalTilesExplored, target: 50, goScreen: "worldMap", goLabel: "Open World Map" },
                { label: "Sharpen a jutsu to Lv 3", progress: highestJutsuMastery, target: 3, detail: "Use a jutsu in battle to level it", goScreen: "battleArena", goLabel: "Go Arena" },
            ],
        });
    }
    if (character.level >= 39) {
        objectives.push({
            id: "exam-chunin",
            kind: "exam",
            title: "Chunin Exam",
            summary: "You are at the level-39 hold. Pass this exam to continue leveling toward Jonin.",
            examKey: "chunin",
            unlockLevel: 39,
            requirements: [
                { label: "Reach the Chunin exam gate (Level 39)", progress: character.level, target: 39, detail: "The level hold lifts once you pass", goScreen: "missions", goLabel: "Earn XP" },
                { label: "Awaken your second element", progress: ownedElements.length, target: 2, detail: ownedElements[1] ?? "Second element not awakened" },
                { label: "Complete 50 missions", progress: character.totalMissionsCompleted ?? character.clanMissionContrib ?? 0, target: 50 },
                { label: "Explore 100 tiles", progress: character.totalTilesExplored ?? 0, target: 100 },
                // Solo-clearable on a low-population server: founding your own clan
                // satisfies this just as well as joining one — no invite needed (L-2).
                { label: "Join or found a clan", progress: character.clan ? 1 : 0, target: 1, detail: character.clan ?? "Join one, or create your own at the Clan Hall — no invite needed", goScreen: "clan", goLabel: "Go Clan" },
                { label: "Defeat Exam Proctor", progress: defeatedAiIds.includes("builtin-ai-exam-proctor") ? 1 : 0, target: 1, detail: examProctorExists ? "Level 25 arena AI" : "Exam Proctor missing", aiId: "builtin-ai-exam-proctor" },
            ],
        });
    }
    if (character.level >= 50) {
        objectives.push({
            id: "exam-jonin",
            kind: "exam",
            title: "Jonin Exam",
            summary: "Jonin rank begins at level 50. This is advanced combat and raid work for veteran shinobi.",
            examKey: "jonin",
            unlockLevel: 50,
            requirements: [
                { label: "Get 10 PvP kills", progress: character.totalPvpKills ?? 0, target: 10 },
                { label: "Raid a village 20 times", progress: character.totalVillageRaids ?? 0, target: 20 },
                { label: "Defeat Rogue Ninja", progress: defeatedAiIds.includes("builtin-ai-rogue-ninja") ? 1 : 0, target: 1, detail: rogueNinjaExists ? "Level 47 arena AI" : "Rogue Ninja missing", aiId: "builtin-ai-rogue-ninja" },
            ],
        });
    }
    if (character.level >= 80) {
        objectives.push({
            id: "exam-special-jonin",
            kind: "exam",
            title: "Special Jonin Exam",
            summary: "A late-game leadership and PvP milestone.",
            examKey: "specialJonin",
            unlockLevel: 80,
            requirements: [
                { label: "Kill 100 players in PvP", progress: character.totalPvpKills ?? 0, target: 100 },
                { label: "Become Kage or Elder", progress: (isKage || isElder) ? 1 : 0, target: 1, detail: isKage ? `Seated Kage of ${character.village}` : isElder ? `${character.elderFocus} Elder` : "Not a Kage or Elder" },
            ],
        });
    }

    return objectives;
}

/**
 * The one objective the player is actively working toward, for the Daily
 * Briefing: the Academy checklist while it's still open, otherwise the
 * lowest-rank exam they've unlocked but not yet passed. Null when nothing is
 * pending (every unlocked exam passed, or nothing unlocked yet).
 */
export function currentLogbookObjective(character: Character, ctx: ObjectiveContext = {}): LogbookObjective | null {
    const objectives = buildLogbookObjectives(character, ctx);
    const academy = objectives.find((o) => o.kind === "academy");
    if (academy) return academy;
    const chapter = objectives.find((o) => o.kind === "chapter" && !objectiveComplete(o));
    if (chapter) return chapter;
    const passed = new Set(character.examsPassed ?? []);
    return objectives.find((o) => o.kind === "exam" && !passed.has(o.examKey ?? "")) ?? null;
}
