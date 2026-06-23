/*
 * Pure core for the Daily Briefing modal — login-reward preview, the
 * "what should I do next?" recommendation engine, and the recommended mission
 * for a level band. No runtime imports beyond the static mission catalog and
 * the erased Screen type, so it is unit-testable and carries no bundle weight.
 *
 * The cache-reading world report lives in ./daily-briefing (which imports the
 * polled war caches and re-exports everything here).
 */
import type { Screen } from "../types/core";
import { builtinHuntMissions } from "../data/missions";

// ── Login reward preview ────────────────────────────────────────────────────
// The SERVER is authoritative (api/player/_daily-login.ts); this mirrors the
// same curve so the modal can show the amount before/independent of the claim
// round-trip. Keep the constants in sync across the two files.
const LOGIN_RYO_BASE = 500;
const LOGIN_RYO_PER_LEVEL = 100;
const LOGIN_RYO_CAP = 8000;
export const STREAK_SHARD_INTERVAL = 7;
export const STREAK_SHARD_REWARD = 5;

export function dailyLoginRyo(level: number): number {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(LOGIN_RYO_CAP, LOGIN_RYO_BASE + LOGIN_RYO_PER_LEVEL * lv);
}

// ── Recommended mission for the player's level band ─────────────────────────
// Picks the highest level-gated hunt the player qualifies for (best XP/ryo).
export function recommendedMission(level: number): { name: string; rank: string } | null {
    const eligible = builtinHuntMissions.filter((m) => (m.levelReq ?? 1) <= level);
    if (!eligible.length) return null;
    const best = eligible.reduce((a, b) => ((b.levelReq ?? 1) >= (a.levelReq ?? 1) ? b : a));
    return { name: best.name, rank: best.rank };
}

// ── Recommendation engine ───────────────────────────────────────────────────
export interface Recommendation {
    id: string;
    icon: string;
    title: string;
    detail: string;
    cta: string;
    screen: Screen;
}

export interface RecoInput {
    hospitalized: boolean;
    onboardingStep: string;        // normalized canonical step ("" or "done" = finished)
    unspentStats: number;
    level: number;
    hasMissionSlot: boolean;
    missionsDone: number;
    missionCap: number;
    recommendedMissionName?: string;
    hasProfession: boolean;
    trainingIdle: boolean;
    jutsuTrainingIdle: boolean;
    hasJutsu: boolean;
    petTrainingIdle: boolean;
    hasPets: boolean;
}

const ONBOARDING_TARGET: Record<string, { screen: Screen; label: string }> = {
    academyIntro: { screen: "village", label: "Begin your Academy training" },
    starter: { screen: "pets", label: "Choose your starter companion" },
    academySpar: { screen: "training", label: "Spar at the Academy" },
    training: { screen: "training", label: "Train your stats" },
    jutsu: { screen: "jutsuTraining", label: "Learn a jutsu" },
    firstMission: { screen: "missions", label: "Take your first mission" },
    logbook: { screen: "logbook", label: "Check your Logbook" },
    storyUnlocked: { screen: "storyHall", label: "Begin your story" },
};

/**
 * Ordered list of suggested next actions, most impactful first. The modal shows
 * the top few. Order encodes priority: blockers (hospital) → tutorial → wasted
 * potential (unspent points, idle training) → daily content → growth → explore.
 */
export function buildRecommendations(i: RecoInput): Recommendation[] {
    const out: Recommendation[] = [];

    if (i.hospitalized) {
        out.push({ id: "heal", icon: "🏥", title: "You're hospitalized", detail: "Recover your health before heading back into a fight.", cta: "Go to Hospital", screen: "hospital" });
    }

    if (i.onboardingStep && i.onboardingStep !== "done") {
        const t = ONBOARDING_TARGET[i.onboardingStep];
        if (t) out.push({ id: "tutorial", icon: "🎓", title: "Continue the Academy Path", detail: `${t.label} to keep your training on track.`, cta: t.label, screen: t.screen });
    }

    if (i.unspentStats > 0) {
        out.push({ id: "stats", icon: "✨", title: `${i.unspentStats} unspent stat point${i.unspentStats === 1 ? "" : "s"}`, detail: "Spend them to grow stronger — they do nothing sitting unused.", cta: "Allocate stats", screen: "profile" });
    }

    if (i.trainingIdle) {
        out.push({ id: "training", icon: "💪", title: "Training grounds are idle", detail: "Start a timed session — your stats keep growing while you're away.", cta: "Start training", screen: "training" });
    }

    if (i.hasMissionSlot && !i.hospitalized) {
        const m = i.recommendedMissionName;
        out.push({ id: "mission", icon: "📜", title: m ? `Recommended: ${m}` : "Run a mission", detail: `You've done ${i.missionsDone}/${i.missionCap} missions today — there's XP and ryo waiting.`, cta: "Go to Missions", screen: "missions" });
    }

    if (i.jutsuTrainingIdle && i.hasJutsu) {
        out.push({ id: "jutsu", icon: "⚡", title: "Train a jutsu", detail: "Level up a jutsu to raise your combat power.", cta: "Jutsu training", screen: "jutsuTraining" });
    }

    if (i.hasPets && i.petTrainingIdle) {
        out.push({ id: "pet", icon: "🐾", title: "A companion is idle", detail: "Send a pet to train while you're out adventuring.", cta: "Pet yard", screen: "pets" });
    }

    if (!i.hasProfession && i.level >= 10) {
        out.push({ id: "profession", icon: "🛠️", title: "Choose a profession", detail: "Unlock a dedicated path — Healer, Vanguard, or Pet Tamer.", cta: "Pick a profession", screen: "professionPicker" });
    }

    if (!out.length) {
        out.push({ id: "explore", icon: "🗺️", title: "Explore the world", detail: "Travel the map, advance your story, and seek out new challenges.", cta: "Open the map", screen: "worldMap" });
    }

    return out;
}
