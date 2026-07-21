/*
 * Hunt tracking decisions — the "read the sign" layer between accepting a
 * Hunter Guild contract and fighting the beast.
 *
 * Previously a track was a single button that silently advanced a counter and
 * teleported the player. Now each track presents a SIGN with two readable
 * choices that trade safety against Hunt Quality: a hidden per-hunt score that
 * decides how the final fight OPENS (the beast cornered and bleeding, or
 * alerted and enraged).
 *
 * Everything here is pure and deterministic except `rollHuntAmbush`, which
 * takes its rng so tests can pin it. Sign selection is hashed from
 * (mission, stage, hunter) so a given player sees a STABLE trail — re-rendering
 * the card never reshuffles the choice in front of them.
 *
 * PvE-only and reward-neutral by construction: Hunt Quality never touches
 * payouts. Hunt rewards are sealed server-side by the ai-fight token
 * (computeAiFightBaseReward) and the Hunter contract is paid by
 * api/missions/claim-mission from its own catalog, so a wounded beast is an
 * easier fight for the SAME reward — never a bigger one.
 */
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission } from "../types/missions";

// ── Hunt Quality ────────────────────────────────────────────────────────────
/** Quality is clamped to this range so a long hunt can't stack an extreme opening. */
export const HUNT_QUALITY_MIN = -3;
export const HUNT_QUALITY_MAX = 3;
/** At or beyond these, the fight opens in the player's / the beast's favour. */
export const HUNT_QUALITY_CORNERED_AT = 2;
export const HUNT_QUALITY_ENRAGED_AT = -2;

export type HuntQualityTier = "cornered" | "even" | "enraged";

export function clampHuntQuality(quality: number): number {
    const n = Math.trunc(Number(quality) || 0);
    return Math.max(HUNT_QUALITY_MIN, Math.min(HUNT_QUALITY_MAX, n));
}

export function huntQualityTier(quality: number): HuntQualityTier {
    const q = clampHuntQuality(quality);
    if (q >= HUNT_QUALITY_CORNERED_AT) return "cornered";
    if (q <= HUNT_QUALITY_ENRAGED_AT) return "enraged";
    return "even";
}

/*
 * ⚖ BALANCE KNOBS — the ONLY combat-affecting numbers this feature introduces.
 * PvE only. Rewards are untouched (see the module header).
 *
 *   cornered : beast max HP x0.80 (-20%)  — you ran it down; it is bleeding.
 *   even     : untouched.
 *   enraged  : +6 to every stat           — it heard you coming and is waiting.
 *
 * A stat bonus is used for `enraged` rather than bonus HP so the fight gets
 * sharper, not longer — matching the "no HP-sponge bosses" direction.
 */
export const HUNT_CORNERED_HP_MULT = 0.80;
export const HUNT_ENRAGED_STAT_BONUS = 6;

export type HuntOpening = {
    tier: HuntQualityTier;
    kicker: string;
    prose: string;
    /** Shown on the encounter card so the player can see what their tracking bought. */
    effect: string;
};

export function huntOpeningFor(quality: number, beastName: string): HuntOpening {
    const tier = huntQualityTier(quality);
    if (tier === "cornered") {
        return {
            tier,
            kicker: "Cornered",
            prose: `${beastName} is blown and bleeding. You pushed it hard enough that it has nowhere left to break to.`,
            effect: `${beastName} fights at ${Math.round(HUNT_CORNERED_HP_MULT * 100)}% health.`,
        };
    }
    if (tier === "enraged") {
        return {
            tier,
            kicker: "Enraged",
            prose: `${beastName} heard you coming a long way off. It is not running — it chose this ground.`,
            effect: `${beastName} fights with +${HUNT_ENRAGED_STAT_BONUS} to every stat.`,
        };
    }
    return {
        tier,
        kicker: "Even ground",
        prose: `${beastName} breaks cover clean and unhurt. Neither of you has the advantage.`,
        effect: "No advantage either way.",
    };
}

/**
 * Apply the opening to the beast profile.
 *
 * CRITICAL: the id is preserved verbatim. api/missions/report-ai-fight matches
 * the fight token's sealed `opponentId` against the accepted hunt via
 * huntMissionByAiProfileId to stamp the kill receipt — change the id and the
 * contract silently becomes unclaimable.
 *
 * `hpFloorExempt` is required for the cornered case: makeBuiltinAi and
 * normalizeAiProfile both raise any sub-curve hp back to aiHpForLevel(level),
 * so without it a REDUCED hp is silently undone (see lib/combat-ai.ts).
 */
export function applyHuntOpening(base: CreatorAi, quality: number): CreatorAi {
    const tier = huntQualityTier(quality);
    if (tier === "cornered") {
        return {
            ...base,
            hp: Math.max(1, Math.floor(base.hp * HUNT_CORNERED_HP_MULT)),
            hpFloorExempt: true,
        };
    }
    if (tier === "enraged") {
        const stats = { ...base.stats };
        for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
            const value = Number(stats[key]);
            if (Number.isFinite(value)) stats[key] = (value + HUNT_ENRAGED_STAT_BONUS) as typeof stats[typeof key];
        }
        return { ...base, stats };
    }
    return base;
}

// ── Signs and choices ───────────────────────────────────────────────────────
export type HuntChoiceOutcome = {
    /** Added to the running Hunt Quality for this contract. */
    quality: number;
    /** Whether taking this choice advances the trail. */
    advances: boolean;
    /** 0..1 chance the pack springs on you instead. */
    ambushChance: number;
};

export type HuntChoice = {
    id: string;
    label: string;
    detail: string;
    /** Player-facing risk note; "" renders as no warning. */
    risk: string;
    outcome: HuntChoiceOutcome;
};

export type HuntSign = {
    id: string;
    kicker: string;
    prose: string;
    choices: HuntChoice[];
};

const SIGNS: readonly HuntSign[] = [
    {
        id: "blood-trail",
        kicker: "Blood sign",
        prose: "Dark blood beads along the fern-tips, still tacky. Whatever bled here was moving fast and not bothering to hide it.",
        choices: [
            {
                id: "push", label: "Push the blood trail",
                detail: "Run it down before the bleeding stops. Tires the beast out.",
                risk: "It knows it is being chased.",
                outcome: { quality: 1, advances: true, ambushChance: 0.35 },
            },
            {
                id: "downwind", label: "Circle downwind",
                detail: "Give up the pace to keep your scent off it. Slower, but nothing hears you.",
                risk: "",
                outcome: { quality: 0, advances: true, ambushChance: 0 },
            },
        ],
    },
    {
        id: "lair",
        kicker: "Lair sign",
        prose: "A hollow under the root-shelf, packed flat and rank with musk. Something big sleeps here between kills.",
        choices: [
            {
                id: "wait", label: "Lie in wait",
                detail: "Take the hollow and hold still. It comes back to you, on your terms.",
                risk: "",
                outcome: { quality: 1, advances: true, ambushChance: 0 },
            },
            {
                id: "smoke", label: "Smoke it out",
                detail: "Fire the bracken and force it into the open. Fast, and loud.",
                risk: "Every animal within a mile will move.",
                outcome: { quality: -1, advances: true, ambushChance: 0.20 },
            },
        ],
    },
    {
        id: "fork",
        kicker: "The trail forks",
        prose: "Two sets of tracks leave the streambed. One is deep, dragging, favouring a side. The other is light and even — and there are several of it.",
        choices: [
            // A readable skill-check, not a coin flip: the prose states the tell
            // (deep, dragging, favouring a side = weight and a bad leg). Reading it
            // correctly is the safe line; misreading it walks you into the pack.
            {
                id: "heavy", label: "Follow the dragging track",
                detail: "Deep and uneven means weight and a bad leg. That is your contract.",
                risk: "",
                outcome: { quality: 1, advances: true, ambushChance: 0 },
            },
            {
                id: "light", label: "Follow the light tracks",
                detail: "Fresher and easier to read, and there are more of them.",
                risk: "Several sets of one animal's tracks is rarely one animal.",
                outcome: { quality: -1, advances: true, ambushChance: 0.30 },
            },
        ],
    },
    {
        id: "pack-sign",
        kicker: "You are not alone",
        prose: "Scat, claw-scores on the bark at two different heights, and a half-eaten kill nobody bothered to bury. More than one animal works this ground.",
        choices: [
            {
                id: "press", label: "Press on regardless",
                detail: "The contract is the contract. Walk through them if you have to.",
                risk: "They are already circling.",
                outcome: { quality: 1, advances: true, ambushChance: 0.55 },
            },
            {
                id: "withdraw", label: "Withdraw and re-read the ground",
                detail: "Back out clean and pick the trail up somewhere they are not.",
                risk: "Costs you the trail — no progress.",
                outcome: { quality: 0, advances: false, ambushChance: 0 },
            },
        ],
    },
];

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/**
 * The sign waiting at a given track stage. Stable for a (mission, stage,
 * hunter) triple so re-rendering the card cannot reroll the player's options.
 */
export function huntSignFor(
    mission: Pick<CreatorMission, "id">,
    stage: number,
    hunterName = "",
): HuntSign {
    const safeStage = Math.max(0, Math.floor(Number(stage) || 0));
    const seed = hashString(`${mission.id}:${hunterName.toLowerCase()}:sign:${safeStage}`);
    return SIGNS[seed % SIGNS.length];
}

/** Roll a choice's ambush chance. `rng` is injectable so tests can pin it. */
export function rollHuntAmbush(chance: number, rng: () => number = Math.random): boolean {
    const p = Math.max(0, Math.min(1, Number(chance) || 0));
    if (p <= 0) return false;
    return rng() < p;
}

// ── Pack ambush ─────────────────────────────────────────────────────────────
/** Pack members fought before the contract target, reusing the wanderer ambush chain. */
export const HUNT_PACK_STAGES = 3;
/** Surviving the whole pack corners the target; being routed by it alerts them. */
export const HUNT_PACK_SURVIVED_QUALITY = 1;
export const HUNT_PACK_ROUTED_QUALITY = -1;

/**
 * Identity for one pack member. These deliberately do NOT use the contract
 * beast's id — only the real target may carry it, or report-ai-fight would
 * stamp the kill receipt off a pack mook.
 */
export function huntPackMember(mission: Pick<CreatorMission, "id">, beastName: string, stage: number): { id: string; name: string } {
    const index = Math.max(0, Math.min(HUNT_PACK_STAGES - 1, Math.floor(stage)));
    const descriptor = ["Yearling", "Outrider", "Packmate"][index] ?? "Packmate";
    // Strip a leading article so "the Frost Wolf" reads as "Frost Wolf Outrider".
    const stem = beastName.replace(/^the\s+/i, "").trim() || "Beast";
    return { id: `hunt-pack-${mission.id}-${index}`, name: `${stem} ${descriptor}` };
}
