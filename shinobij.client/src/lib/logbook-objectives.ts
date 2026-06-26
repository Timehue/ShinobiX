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
    kind: "academy" | "exam";
    title: string;
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

    const objectives: LogbookObjective[] = [];

    // Academy Training — soft, teach-by-doing onboarding goals that fill the gap
    // before the first rank exam (Genin). Hidden once claimed or once the player
    // outgrows Academy rank.
    if (!character.academyChecklistClaimed && rankFromLevel(character.level) === "Academy Student") {
        objectives.push({
            kind: "academy",
            title: "Academy Training",
            unlockLevel: 1,
            requirements: [
                { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "Free roll at Level 2", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                { label: "Equip your jutsu loadout", progress: character.equippedJutsuIds.length, target: 4, detail: "Add a 4th jutsu", goScreen: "jutsuTraining", goLabel: "Go Jutsu" },
                { label: "Win your first battle", progress: character.totalAiKills ?? 0, target: 1, detail: "Fight in the Arena or a hunt", goScreen: "battleArena", goLabel: "Go Arena" },
                { label: "Train at the grounds", progress: statsTrained, target: 5, detail: "Train a stat at the Training Grounds", goScreen: "training", goLabel: "Go Train" },
                { label: "Complete your first mission", progress: character.totalMissionsCompleted ?? 0, target: 1, detail: "Accept a D-rank mission below", goScreen: "missions", goLabel: "Go to Mission Hall" },
                { label: "Sharpen a jutsu (mastery Lv 3)", progress: highestJutsuMastery, target: 3, detail: "Using a jutsu in battle levels it", goScreen: "battleArena", goLabel: "Go Arena" },
            ],
        });
    }

    // Rank exams — each appears once the player reaches its unlock level.
    if (character.level >= 11) {
        objectives.push({
            kind: "exam",
            title: "Genin Exam",
            examKey: "genin",
            unlockLevel: 11,
            requirements: [
                { label: "Awaken your first element", progress: ownedElements.length, target: 1, detail: ownedElements[0] ?? "No element awakened" },
                { label: "Train 400 stats", progress: statsTrained, target: 400 },
                { label: "Complete 20 missions", progress: character.totalMissionsCompleted ?? character.clanMissionContrib ?? 0, target: 20 },
                { label: "Kill 20 AI", progress: character.totalAiKills ?? 0, target: 20 },
                { label: "Explore 50 tiles", progress: character.totalTilesExplored ?? 0, target: 50 },
                { label: "Sharpen a jutsu to Lv 3", progress: highestJutsuMastery, target: 3, detail: "Use a jutsu in battle to level it" },
            ],
        });
    }
    if (character.level >= 21) {
        objectives.push({
            kind: "exam",
            title: "Chunin Exam",
            examKey: "chunin",
            unlockLevel: 21,
            requirements: [
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
    if (character.level >= 41) {
        objectives.push({
            kind: "exam",
            title: "Jonin Exam",
            examKey: "jonin",
            unlockLevel: 41,
            requirements: [
                { label: "Get 10 PvP kills", progress: character.totalPvpKills ?? 0, target: 10 },
                { label: "Raid a village 20 times", progress: character.totalVillageRaids ?? 0, target: 20 },
                { label: "Defeat Rogue Ninja", progress: defeatedAiIds.includes("builtin-ai-rogue-ninja") ? 1 : 0, target: 1, detail: rogueNinjaExists ? "Level 47 arena AI" : "Rogue Ninja missing", aiId: "builtin-ai-rogue-ninja" },
            ],
        });
    }
    if (character.level >= 80) {
        objectives.push({
            kind: "exam",
            title: "Special Jonin Exam",
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
    const passed = new Set(character.examsPassed ?? []);
    return objectives.find((o) => o.kind === "exam" && !passed.has(o.examKey ?? "")) ?? null;
}
