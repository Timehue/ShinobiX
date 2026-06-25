/*
 * Profession Mastery — an endgame specialization layer ABOVE rank 10.
 *
 * Funding: profession XP earned past rank 10 (currently wasted) converts to
 * Mastery LEVELS (cap 10) = the point budget. Points are spent in a per-
 * profession tree of 3 PATHS; each path has two 3-rank nodes + a gated capstone.
 * A full path costs 8 points, the budget is 10 → you complete ONE path and dip
 * a little into another. Respec for ryo.
 *
 * STRICTLY PvE / utility. Every combat effect here is applied as a PvE-only
 * modifier at fight/heal time by the caller — this module only resolves the
 * capped magnitudes, it never writes a stored stat (which would leak into PvP).
 *
 * Pure data + pure functions — unit-tested. Effects are wired in by callers
 * (Hospital / Training / PetYard and the server payout paths).
 */
import type { Character } from "../types/character";
import type { Profession } from "../App";
import { PROFESSION_XP_BASELINE, PROFESSION_XP_HEALER } from "../constants/profession";

// Local mirror of App.professionThresholds using the pure constants — so this
// module (and its node test) never imports the App browser monolith.
function thresholdsFor(profession: Profession): ReadonlyArray<number> {
    return profession === "healer" ? PROFESSION_XP_HEALER : PROFESSION_XP_BASELINE;
}

export const MASTERY_XP_PER_LEVEL = 15_000;
export const MASTERY_MAX_LEVEL = 10;
export const MASTERY_RESPEC_COST = 50_000; // ryo

export const NODE_COST = 1;       // per rank for a normal node
export const CAPSTONE_COST = 2;   // for the single-rank capstone
export const CAPSTONE_PATH_GATE = 4; // points in the path before a capstone unlocks

// effectKey: a normal node contributes perRank × ranks to this key (callers read
// it via masteryBonus). Capstones are boolean unlocks (masteryHasCapstone).
export type MasteryNode = {
    id: string;
    pathId: string;
    name: string;
    desc: string;
    maxRank: number;
    cost: number;
    capstone?: boolean;
    effectKey?: string;
    perRank?: number;
};
export type MasteryPath = { id: string; name: string; nodes: MasteryNode[] };

function node(pathId: string, id: string, name: string, desc: string, effectKey: string, perRank: number): MasteryNode {
    return { id, pathId, name, desc, maxRank: 3, cost: NODE_COST, effectKey, perRank };
}
function capstone(pathId: string, id: string, name: string, desc: string): MasteryNode {
    return { id, pathId, name, desc, maxRank: 1, cost: CAPSTONE_COST, capstone: true };
}

export const MASTERY_TREES: Record<Profession, MasteryPath[]> = {
    healer: [
        { id: "triage", name: "Triage", nodes: [
            node("triage", "heal-cooldown", "Field Triage", "-5% heal cooldown per rank.", "healCooldownPct", 5),
            node("triage", "heal-tireless", "Tireless", "A further -5% heal cooldown per rank.", "healCooldownPct", 5),
            capstone("triage", "chakra-conduit", "Chakra Conduit", "Your heals cost 10% chakra of the HP restored, instead of 25%."),
        ] },
        { id: "restoration", name: "Restoration", nodes: [
            node("restoration", "heal-xp", "Diligent Care", "+6% heal XP per rank (faster Healer progression).", "healXpPct", 6),
            node("restoration", "heal-discharge", "Conservation", "-6% chakra cost of your heals per rank.", "healChakraCostPct", 6),
            capstone("restoration", "full-recovery", "Full Recovery", "Removes the per-target heal cooldown — heal anyone, anytime."),
        ] },
        { id: "outreach", name: "Outreach", nodes: [
            node("outreach", "heal-support", "Wandering Medic", "+6% heal XP while supporting the village per rank.", "healXpPct", 6),
            node("outreach", "heal-vigil", "Vigil", "-5% heal cooldown per rank.", "healCooldownPct", 5),
            capstone("outreach", "village-lifeline", "Village Lifeline", "Heal injured villagers anywhere in the village, any sector."),
        ] },
    ],
    vanguard: [
        { id: "reaver", name: "Reaver", nodes: [
            node("reaver", "seal-gap", "Bloodletter", "Softens the level-gap seal penalty (+10% kept per rank).", "sealGapSoftenPct", 10),
            node("reaver", "seal-cap", "Relentless", "+5 to your daily Honor-Seal cap per rank.", "sealDailyCapFlat", 5),
            capstone("reaver", "warmonger", "Warmonger", "Every PvP win pays at least 1 Honor Seal (still under the daily cap)."),
        ] },
        { id: "quartermaster", name: "Quartermaster", nodes: [
            node("quartermaster", "seal-train-cost", "Efficient Forging", "-5% Honor-Seal cost of jutsu training per rank.", "sealTrainCostPct", 5),
            node("quartermaster", "seal-speedup", "Stockpile", "-5% Honor-Seal cost of jutsu speedups per rank.", "sealSpeedupCostPct", 5),
            capstone("quartermaster", "logistician", "Logistician", "One free jutsu-training speedup per week."),
        ] },
        { id: "warden", name: "Warden", nodes: [
            node("warden", "stamina", "Seal of Vigor", "+4% max stamina per rank (utility).", "maxStaminaPct", 4),
            node("warden", "ai-damage", "Hardened", "+3% damage vs AI per rank (PvE only).", "pveAiDamagePct", 3),
            capstone("warden", "ironclad", "Ironclad", "Defeating an AI has a chance to drop a Bone Charm."),
        ] },
    ],
    petTamer: [
        { id: "expeditioner", name: "Expeditioner", nodes: [
            node("expeditioner", "exp-rewards", "Trailblazer", "+5% expedition rewards per rank.", "expRewardPct", 5),
            node("expeditioner", "exp-materials", "Forager", "+5% expedition materials per rank.", "expMaterialPct", 5),
            capstone("expeditioner", "caravan-master", "Caravan Master", "+2 to your daily expedition reward cap."),
        ] },
        { id: "beast-handler", name: "Beast Handler", nodes: [
            node("beast-handler", "pet-damage", "Savagery", "+2% PvE pet damage per rank.", "petPveDamagePct", 2),
            node("beast-handler", "pet-hp", "Toughened Hide", "+4% pet HP in PvE battles per rank.", "petPveHpPct", 4),
            capstone("beast-handler", "alpha-bond", "Alpha Bond", "Your lead pet revives once per PvE battle."),
        ] },
        { id: "trainer", name: "Trainer", nodes: [
            node("trainer", "train-time", "Drill Sergeant", "-5% pet training time per rank.", "petTrainTimePct", 5),
            node("trainer", "train-xp", "Mentor", "+6% pet training XP per rank.", "petTrainXpPct", 6),
            capstone("trainer", "prodigy", "Prodigy", "Once per day, a pet training session finishes instantly with doubled XP."),
        ] },
    ],
};

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** All nodes for a profession, flattened. */
export function masteryNodes(profession: Profession): MasteryNode[] {
    return (MASTERY_TREES[profession] ?? []).flatMap(p => p.nodes);
}
export function findNode(profession: Profession, nodeId: string): MasteryNode | undefined {
    return masteryNodes(profession).find(n => n.id === nodeId);
}

/** Mastery LEVEL = the point budget, from profession XP past the rank-10 wall. */
export function masteryLevel(character: Character | null | undefined): number {
    if (!character?.profession) return 0;
    const thresholds = thresholdsFor(character.profession);
    const finite = thresholds.filter(t => Number.isFinite(t));
    const capXp = finite.length ? finite[finite.length - 1] : 0; // XP at rank 10
    const overflow = num(character.professionXp) - capXp;
    if (overflow <= 0) return 0;
    return Math.min(MASTERY_MAX_LEVEL, Math.floor(overflow / MASTERY_XP_PER_LEVEL));
}

/** Points already allocated across the spec (ranks × node cost). */
export function masteryPointsSpent(character: Character | null | undefined): number {
    if (!character?.profession) return 0;
    const spec = character.masterySpec ?? {};
    let spent = 0;
    for (const n of masteryNodes(character.profession)) {
        const ranks = Math.max(0, Math.min(n.maxRank, num(spec[n.id])));
        spent += ranks * n.cost;
    }
    return spent;
}
export function masteryPointsAvailable(character: Character | null | undefined): number {
    return Math.max(0, masteryLevel(character) - masteryPointsSpent(character));
}

/** Non-capstone points invested in a given path (drives the capstone gate). */
export function pointsInPath(character: Character | null | undefined, pathId: string): number {
    if (!character?.profession) return 0;
    const spec = character.masterySpec ?? {};
    let pts = 0;
    for (const n of masteryNodes(character.profession)) {
        if (n.pathId !== pathId || n.capstone) continue;
        pts += Math.max(0, Math.min(n.maxRank, num(spec[n.id]))) * n.cost;
    }
    return pts;
}

export type SpendCheck = { ok: true } | { ok: false; reason: string };

/** Can the player put one more rank into this node right now? */
export function canIncrement(character: Character | null | undefined, nodeId: string): SpendCheck {
    if (!character?.profession) return { ok: false, reason: "No profession." };
    const n = findNode(character.profession, nodeId);
    if (!n) return { ok: false, reason: "Unknown node." };
    const current = Math.max(0, num((character.masterySpec ?? {})[nodeId]));
    if (current >= n.maxRank) return { ok: false, reason: "Already maxed." };
    if (masteryPointsAvailable(character) < n.cost) return { ok: false, reason: "Not enough mastery points." };
    if (n.capstone && pointsInPath(character, n.pathId) < CAPSTONE_PATH_GATE) {
        return { ok: false, reason: `Invest ${CAPSTONE_PATH_GATE} points in this path first.` };
    }
    return { ok: true };
}

/** Returns a NEW spec with one rank added (caller persists it). No-op if illegal. */
export function incrementNode(character: Character, nodeId: string): Record<string, number> {
    const spec = { ...(character.masterySpec ?? {}) };
    if (!canIncrement(character, nodeId).ok) return spec;
    spec[nodeId] = Math.max(0, num(spec[nodeId])) + 1;
    return spec;
}

/**
 * Validate (and clamp) a spec to what `masteryLevel` allows: legal node ids,
 * ranks within maxRank, capstone gates satisfied, and total spend ≤ budget.
 * Used by the server anti-tamper validator AND defensively on the client.
 * Greedily keeps nodes (non-capstones first) until the budget runs out.
 */
export function sanitizeSpec(profession: Profession | undefined, rawSpec: unknown, budget: number): Record<string, number> {
    if (!profession || !rawSpec || typeof rawSpec !== "object") return {};
    const raw = rawSpec as Record<string, unknown>;
    const out: Record<string, number> = {};
    let spent = 0;
    // Pass 1: normal nodes (clamped to maxRank), within budget.
    for (const n of masteryNodes(profession)) {
        if (n.capstone) continue;
        const want = Math.max(0, Math.min(n.maxRank, Math.floor(num(raw[n.id]))));
        const afford = Math.max(0, Math.min(want, Math.floor((budget - spent) / n.cost)));
        if (afford > 0) { out[n.id] = afford; spent += afford * n.cost; }
    }
    // Pass 2: capstones — only if the path gate is met and budget allows.
    for (const n of masteryNodes(profession)) {
        if (!n.capstone) continue;
        const want = Math.max(0, Math.min(1, Math.floor(num(raw[n.id]))));
        if (want < 1) continue;
        const pathPts = Object.entries(out).reduce((s, [id, r]) => {
            const nn = findNode(profession, id);
            return nn && nn.pathId === n.pathId && !nn.capstone ? s + r * nn.cost : s;
        }, 0);
        if (pathPts >= CAPSTONE_PATH_GATE && spent + n.cost <= budget) { out[n.id] = 1; spent += n.cost; }
    }
    return out;
}

// Human labels for each effect key (for the "active bonuses" summary). v is the
// resolved magnitude. Reductions show a minus sign.
export const EFFECT_LABELS: Record<string, (v: number) => string> = {
    healCooldownPct: (v) => `−${v}% heal cooldown`,
    healXpPct: (v) => `+${v}% heal XP`,
    healChakraCostPct: (v) => `−${v}% heal chakra cost`,
    sealGapSoftenPct: (v) => `+${v}% seals kept vs higher-level targets`,
    sealDailyCapFlat: (v) => `+${v} daily Honor-Seal cap`,
    sealTrainCostPct: (v) => `−${v}% Honor-Seal cost of jutsu training`,
    sealSpeedupCostPct: (v) => `−${v}% Honor-Seal cost of speedups`,
    maxStaminaPct: (v) => `+${v}% max stamina`,
    pveAiDamagePct: (v) => `+${v}% damage vs AI (PvE)`,
    expRewardPct: (v) => `+${v}% expedition rewards`,
    expMaterialPct: (v) => `+${v}% expedition materials`,
    petPveDamagePct: (v) => `+${v}% PvE pet damage`,
    petPveHpPct: (v) => `+${v}% pet HP (PvE)`,
    petTrainTimePct: (v) => `−${v}% pet training time`,
    petTrainXpPct: (v) => `+${v}% pet training XP`,
};

/** Resolved, human-readable list of the player's active mastery bonuses. */
export function activeMasteryEffects(character: Character | null | undefined): string[] {
    if (!character?.profession) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of masteryNodes(character.profession)) {
        if (n.capstone) {
            if (masteryHasCapstone(character, n.id)) out.push(`★ ${n.name}`);
            continue;
        }
        if (!n.effectKey || seen.has(n.effectKey)) continue;
        const v = masteryBonus(character, n.effectKey);
        if (v > 0) { seen.add(n.effectKey); out.push((EFFECT_LABELS[n.effectKey] ?? ((x: number) => `${n.name} ${x}`))(v)); }
    }
    return out;
}

// ── Effect resolvers (callers apply these PvE-only) ────────────────────────
/** Summed magnitude for an effectKey across all invested nodes. */
export function masteryBonus(character: Character | null | undefined, effectKey: string): number {
    if (!character?.profession) return 0;
    const spec = character.masterySpec ?? {};
    let total = 0;
    for (const n of masteryNodes(character.profession)) {
        if (n.effectKey !== effectKey || !n.perRank) continue;
        total += Math.max(0, Math.min(n.maxRank, num(spec[n.id]))) * n.perRank;
    }
    return total;
}
// Pet Tamer PvE-only combat helpers (passed into the pet sims at PvE call sites
// only — never ranked, so ranked stays deterministic). Auto-gated: a non-petTamer
// has no petTamer spec, so these resolve to no-op (1 / false).
export function petPveHpMult(character: Character | null | undefined): number {
    return 1 + masteryBonus(character, "petPveHpPct") / 100;
}
export function petAlphaBond(character: Character | null | undefined): boolean {
    return masteryHasCapstone(character, "alpha-bond");
}

/** Is a capstone unlocked? */
export function masteryHasCapstone(character: Character | null | undefined, capstoneId: string): boolean {
    if (!character?.profession) return false;
    const n = findNode(character.profession, capstoneId);
    if (!n?.capstone) return false;
    return num((character.masterySpec ?? {})[capstoneId]) >= 1;
}
