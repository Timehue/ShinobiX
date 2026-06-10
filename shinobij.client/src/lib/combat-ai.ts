/*
 * Combat-AI profiles — loadout classification, rule building, the built-in
 * arena AI roster (builtinAis) and per-village story bosses (storyBossAis),
 * plus normalizeAiProfile (the canonical AI shape-fixer). Extracted verbatim
 * from App.tsx (warning paydown; the cluster became contiguous once the
 * mission helpers moved to data/missions).
 */
import type { Jutsu, Stats } from "../types/combat";
import type { AiLoadoutId, AiRule, CreatorAi } from "../types/creator-ai";
import type { StoryStep } from "../App";
import { MAX_LEVEL } from "../constants/game";
import { starterJutsus } from "../data/jutsu";
import { storylines, storyAiId } from "../data/storylines";
import { makeId } from "./utils";
import { isControlJutsu, isPressureJutsu, isSelfSupportJutsu, normalizeJutsu } from "./jutsu";
import { STAT_KEYS, addToAllStats, maxChakraForLevel, maxStaminaForLevel, normalizeStats } from "./stats";
import { aiArmorFactorFromRaw, aiHpForLevel, aiRawDamageReductionForLevel, aiStatsForLevel } from "./ai-stats";

export function blankAiRule(): AiRule {
    return { id: makeId(), condition: "always", value: 1, action: "use_highest_power_jutsu" };
}

export const aiLoadoutLabels: Record<AiLoadoutId, string> = {
    balanced: "Balanced Duelist",
    control: "Control Sealer",
    burst: "Burst Striker",
    bruiser: "Bruiser Brawler",
    defender: "Defensive Counter",
    hunter: "Hunt Beast",
    boss: "Boss Pressure",
};

function jutsusByIds(allJutsus: Jutsu[], ids: string[]) {
    return ids.map((id) => allJutsus.find((jutsu) => jutsu.id === id)).filter((jutsu): jutsu is Jutsu => Boolean(jutsu));
}

export function aiJutsuLoadout(loadoutId: AiLoadoutId, allJutsus: Jutsu[] = starterJutsus): Jutsu[] {
    const idsByLoadout: Record<AiLoadoutId, string[]> = {
        balanced: [
            "starter-nin-lightning-1",
            "starter-nin-wind-3",
            "starter-nin-fire-2",
            "starter-nin-water-3",
            "starter-universal-flicker",
        ],
        control: [
            "starter-gen-lightning-2",
            "starter-gen-earth-2",
            "starter-gen-fire-3",
            "starter-gen-water-1",
            "starter-gen-wind-3",
            "starter-universal-flicker",
        ],
        burst: [
            "starter-nin-lightning-1",
            "starter-buki-lightning-1",
            "starter-nin-fire-2",
            "starter-gen-fire-2",
            "starter-tai-fire-3",
            "starter-universal-flicker",
        ],
        bruiser: [
            "starter-tai-earth-1",
            "starter-tai-lightning-2",
            "starter-tai-water-2",
            "starter-tai-water-3",
            "starter-tai-fire-3",
            "starter-universal-flicker",
        ],
        defender: [
            "starter-nin-water-3",
            "starter-buki-water-3",
            "starter-tai-lightning-3",
            "starter-gen-water-2",
            "starter-buki-lightning-1",
            "starter-universal-flicker",
        ],
        hunter: [
            "starter-tai-earth-1",
            "starter-buki-wind-1",
            "starter-tai-water-2",
            "starter-nin-earth-3",
            "starter-universal-flicker",
        ],
        boss: [
            "starter-nin-lightning-1",
            "starter-gen-lightning-2",
            "starter-nin-fire-2",
            "starter-buki-water-2",
            "starter-nin-water-3",
            "starter-gen-fire-3",
            "starter-universal-flicker",
        ],
    };
    const selected = jutsusByIds(allJutsus, idsByLoadout[loadoutId]);
    return selected.length ? selected : allJutsus.slice(0, 4);
}

export function aiLoadoutFromJutsus(jutsus: Jutsu[]): AiLoadoutId {
    if (jutsus.some((jutsu) => jutsu.tags.some((tag) => tag.name === "Bloodline Seal" || tag.name === "Elemental Seal" || tag.name === "Stun"))) return "control";
    if (jutsus.filter(isSelfSupportJutsu).length >= 2) return "defender";
    if (jutsus.some(isPressureJutsu)) return "burst";
    if (jutsus.some((jutsu) => jutsu.type === "Taijutsu")) return "bruiser";
    return "balanced";
}

function aiLoadoutForProfile(ai: Partial<CreatorAi>, jutsus: Jutsu[]): AiLoadoutId {
    if (ai.loadoutId) return ai.loadoutId;
    const label = `${ai.id ?? ""} ${ai.name ?? ""} ${ai.village ?? ""}`.toLowerCase();
    if (label.includes("champion") || label.includes("dragon") || label.includes("ancient") || label.includes("boss") || label.includes("kage")) return "boss";
    if (label.includes("sealer") || label.includes("shadow") || label.includes("serpent") || label.includes("illusion")) return "control";
    if (label.includes("sentinel") || label.includes("bear") || label.includes("warden") || label.includes("guard")) return "defender";
    if (label.includes("ember") || label.includes("hawk") || label.includes("lizard") || label.includes("drake")) return "burst";
    if (label.includes("rogue") || label.includes("boar") || label.includes("wolf") || label.includes("brawler")) return "bruiser";
    if (label.includes("hunt") || label.includes("beast") || label.includes("panther")) return "hunter";
    return aiLoadoutFromJutsus(jutsus);
}

function balanceExistingAiProfile(ai: Partial<CreatorAi>, allJutsus: Jutsu[] = starterJutsus): CreatorAi {
    const currentJutsus = allJutsus.filter((jutsu) => ai.jutsuIds?.includes(jutsu.id));
    const loadoutId = aiLoadoutForProfile(ai, currentJutsus);
    const selectedJutsus = aiJutsuLoadout(loadoutId, allJutsus);
    return normalizeAiProfile({
        ...ai,
        loadoutId,
        jutsuIds: selectedJutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(selectedJutsus, loadoutId),
    }, allJutsus);
}

export function balanceExistingAiProfiles(ais: Partial<CreatorAi>[], allJutsus: Jutsu[] = starterJutsus): CreatorAi[] {
    return ais.map((ai) => balanceExistingAiProfile(ai, allJutsus));
}

export function starterAiProfile(jutsus: Jutsu[] = starterJutsus): CreatorAi {
    const level = 10;
    const loadoutId: AiLoadoutId = "balanced";
    const selectedJutsus = aiJutsuLoadout(loadoutId, jutsus);
    const armorRawDR = aiRawDamageReductionForLevel(level);
    return {
        id: `ai-${makeId()}`,
        name: "Custom Arena AI",
        icon: "EN",
        level,
        village: "Admin Arena",
        hp: aiHpForLevel(level),
        chakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level),
        stats: aiStatsForLevel(level, selectedJutsus),
        armorRawDR,
        armorFactor: aiArmorFactorFromRaw(armorRawDR),
        loadoutId,
        jutsuIds: selectedJutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(selectedJutsus, loadoutId),
    };
}

export function buildBasicCombatAiRules(selectedJutsus: Jutsu[], loadoutId: AiLoadoutId = aiLoadoutFromJutsus(selectedJutsus)): AiRule[] {
    const usableJutsus = selectedJutsus.length ? selectedJutsus : starterJutsus.slice(0, 4);
    const selfJutsu = usableJutsus.find(isSelfSupportJutsu);
    const controlJutsu = usableJutsus.find(isControlJutsu);
    const pressureJutsu = usableJutsus.find(isPressureJutsu);
    const offensiveJutsus = [...usableJutsus]
        .filter((jutsu) => jutsu.target !== "SELF")
        .sort((a, b) => b.effectPower - a.effectPower || b.ap - a.ap);
    const damageJutsu = offensiveJutsus[0];
    const secondaryJutsu = offensiveJutsus[1];
    const longestRange = Math.max(1, ...usableJutsus.filter((jutsu) => jutsu.target !== "SELF").map((jutsu) => jutsu.range || 1));
    const isBoss = loadoutId === "boss";
    const isControl = loadoutId === "control";
    const isDefender = loadoutId === "defender";
    const isBurst = loadoutId === "burst";
    const rules: AiRule[] = [];

    // Self-sustain — defenders and bosses are more proactive about healing
    if (selfJutsu) {
        const healThreshold = isDefender || isBoss ? 70 : isBurst ? 35 : 48;
        rules.push({ id: makeId(), condition: "hp_lower_than", value: healThreshold, action: "use_specific_jutsu", jutsuId: selfJutsu.id });
        if (isDefender) {
            // Defenders shield on round 1 and again at low HP
            rules.push({ id: makeId(), condition: "specific_round", value: 1, action: "use_specific_jutsu", jutsuId: selfJutsu.id });
            rules.push({ id: makeId(), condition: "hp_lower_than", value: 40, action: "use_specific_jutsu", jutsuId: selfJutsu.id });
        }
        if (isBoss) {
            // Boss heals reactively twice — at 70% and again at 35%
            rules.push({ id: makeId(), condition: "hp_lower_than", value: 35, action: "use_specific_jutsu", jutsuId: selfJutsu.id });
        }
    }

    // Control — open with disruption and re-apply on odd rounds or at critical moments
    if (controlJutsu) {
        rules.push({ id: makeId(), condition: "specific_round", value: 1, action: "use_specific_jutsu", jutsuId: controlJutsu.id });
        if (isControl || isBoss) {
            rules.push({ id: makeId(), condition: "specific_round", value: 3, action: "use_specific_jutsu", jutsuId: controlJutsu.id });
            rules.push({ id: makeId(), condition: "specific_round", value: 5, action: "use_specific_jutsu", jutsuId: controlJutsu.id });
            rules.push({ id: makeId(), condition: "hp_lower_than", value: 50, action: "use_specific_jutsu", jutsuId: controlJutsu.id });
        }
    }

    // Pressure — burst AI front-loads, boss AI cycles between rounds
    if (pressureJutsu && !isDefender) {
        const startRound = controlJutsu ? 2 : 1;
        rules.push({ id: makeId(), condition: "specific_round", value: startRound, action: "use_specific_jutsu", jutsuId: pressureJutsu.id });
        if (isBurst) {
            // Burst AI re-applies pressure every 3 rounds
            rules.push({ id: makeId(), condition: "specific_round", value: startRound + 3, action: "use_specific_jutsu", jutsuId: pressureJutsu.id });
            rules.push({ id: makeId(), condition: "specific_round", value: startRound + 6, action: "use_specific_jutsu", jutsuId: pressureJutsu.id });
        }
        if (isBoss) {
            // Boss alternates between primary and secondary damage tool
            rules.push({ id: makeId(), condition: "specific_round", value: 4, action: "use_specific_jutsu", jutsuId: pressureJutsu.id });
            rules.push({ id: makeId(), condition: "specific_round", value: 7, action: "use_specific_jutsu", jutsuId: pressureJutsu.id });
        }
    }

    // Alternate between strongest and second-strongest damage jutsu for boss/bruiser variety
    if (isBoss && secondaryJutsu && secondaryJutsu.id !== damageJutsu?.id) {
        rules.push({ id: makeId(), condition: "specific_round", value: 3, action: "use_specific_jutsu", jutsuId: secondaryJutsu.id });
        rules.push({ id: makeId(), condition: "specific_round", value: 6, action: "use_specific_jutsu", jutsuId: secondaryJutsu.id });
    }

    // Primary offense — always use best damage jutsu when in range
    if (damageJutsu) {
        rules.push({ id: makeId(), condition: "distance_lower_than", value: longestRange + 1, action: "use_specific_jutsu", jutsuId: damageJutsu.id });
        rules.push({ id: makeId(), condition: "distance_lower_than", value: longestRange + 1, action: "use_highest_power_jutsu" });
    }

    // Movement — close the gap
    rules.push({ id: makeId(), condition: "distance_higher_than", value: longestRange, action: "move_towards_opponent" });

    // Fallback
    rules.push({ id: makeId(), condition: "always", value: 0, action: damageJutsu ? "use_highest_power_jutsu" : "use_basic_attack" });
    rules.push({ id: makeId(), condition: "always", value: 0, action: "use_basic_attack" });

    return rules;
}

export function makeBuiltinAi(
    id: string,
    name: string,
    icon: string,
    level: number,
    village: string,
    jutsus: Jutsu[],
    statBonus: number,
    hpOverride?: number,
    loadoutId: AiLoadoutId = aiLoadoutFromJutsus(jutsus)
): CreatorAi {
    const selectedJutsus = (jutsus.length ? jutsus : aiJutsuLoadout(loadoutId, starterJutsus)).map(normalizeJutsu);
    const toughness = id.startsWith("hunt-ai-")
        ? level >= 70 ? 0.35 : 0.18
        : 0;
    const armorRawDR = aiRawDamageReductionForLevel(level, toughness);
    return normalizeAiProfile({
        id,
        name,
        icon,
        level,
        village,
        hp: Math.max(hpOverride ?? 0, aiHpForLevel(level, toughness)),
        chakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level),
        stats: addToAllStats(aiStatsForLevel(level, selectedJutsus), statBonus),
        armorRawDR,
        armorFactor: aiArmorFactorFromRaw(armorRawDR),
        loadoutId,
        jutsuIds: selectedJutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(selectedJutsus, loadoutId),
    }, starterJutsus);
}

function makeStoryBossAi(village: string, step: StoryStep): CreatorAi {
    const villageJutsus = starterJutsus.filter((jutsu) => {
        if (village === "Stormveil Village") return ["Wind", "Lightning", "Water"].includes(jutsu.element);
        if (village === "Ashen Leaf Village") return ["Fire", "Earth"].includes(jutsu.element);
        if (village === "Frostfang Village") return ["Water", "Lightning", "Wind"].includes(jutsu.element);
        if (village === "Moonshadow Village") return jutsu.type === "Genjutsu" || ["Lightning", "Wind"].includes(jutsu.element);
        return true;
    });
    const jutsuCount = step.levelReq >= 85 ? 6 : step.levelReq >= 50 ? 5 : 4;
    const selectedJutsus = (villageJutsus.length ? villageJutsus : starterJutsus).slice(0, jutsuCount);
    const statBonus = Math.max(25, Math.floor(step.bossDamage * 0.9));
    const bossHp = Math.max(step.bossHp, aiHpForLevel(step.levelReq, step.kageFinale ? 0.50 : 0.30));
    return makeBuiltinAi(
        step.aiProfileId ?? storyAiId(village, step.levelReq),
        step.bossName,
        step.bossIcon,
        step.levelReq,
        village,
        selectedJutsus,
        statBonus,
        bossHp
    );
}
export const storyBossAis = Object.entries(storylines).flatMap(([village, steps]) => steps.map((step) => makeStoryBossAi(village, step)));

export const builtinAis: CreatorAi[] = [
    makeBuiltinAi("builtin-ai-mist-sentinel", "Mist Sentinel", "MS", 8, "Stormveil Patrol", aiJutsuLoadout("defender"), 30, undefined, "defender"),
    makeBuiltinAi("builtin-ai-ember-duelist", "Ember Duelist", "ED", 18, "Ashen Leaf Duelist", aiJutsuLoadout("burst"), 50, undefined, "burst"),
    makeBuiltinAi("builtin-ai-exam-proctor", "Exam Proctor", "EP", 25, "Central Exam Hall", aiJutsuLoadout("balanced"), 62, undefined, "balanced"),
    makeBuiltinAi("builtin-ai-frost-sealer", "Frost Sealer", "FS", 32, "Frostfang Hunter", aiJutsuLoadout("control"), 75, undefined, "control"),
    makeBuiltinAi("builtin-ai-rogue-ninja", "Rogue Ninja", "RN", 47, "Rogue Territory", aiJutsuLoadout("bruiser"), 100, undefined, "bruiser"),
    makeBuiltinAi("builtin-ai-shadow-weaver", "Shadow Weaver", "SW", 48, "Moonshadow Operative", aiJutsuLoadout("control"), 102, undefined, "control"),
    makeBuiltinAi("builtin-ai-central-champion", "Central Champion", "CC", 70, "Central Arena", aiJutsuLoadout("boss"), 160, undefined, "boss"),
    ...storyBossAis,
    // -- Hunt beast AIs ------------------------------------------------------
    makeBuiltinAi("hunt-ai-wild-boar", "Wild Boar", "🐗", 5, "Forest Territory", aiJutsuLoadout("hunter"), 18, 720, "hunter"),
    makeBuiltinAi("hunt-ai-forest-hawk", "Forest Hawk", "🦅", 8, "Forest Territory", aiJutsuLoadout("burst"), 25, 1100, "burst"),
    makeBuiltinAi("hunt-ai-frost-wolf", "Frost Wolf", "🐺", 18, "Snow Territory", aiJutsuLoadout("hunter"), 42, 2500, "hunter"),
    makeBuiltinAi("hunt-ai-ash-lizard", "Ash Lizard", "🦎", 22, "Volcano Territory", aiJutsuLoadout("burst"), 50, 3200, "burst"),
    makeBuiltinAi("hunt-ai-shadow-panther", "Shadow Panther", "🐈", 38, "Shadow Territory", aiJutsuLoadout("control"), 78, 5800, "control"),
    makeBuiltinAi("hunt-ai-ironback-bear", "Ironback Bear", "🐻", 42, "Forest Territory", aiJutsuLoadout("defender"), 85, 6500, "defender"),
    makeBuiltinAi("hunt-ai-ember-drake", "Ember Drake", "🐉", 65, "Volcano Territory", aiJutsuLoadout("boss"), 150, 12000, "boss"),
    makeBuiltinAi("hunt-ai-moon-serpent", "Moon Serpent", "🐍", 68, "Shadow Territory", aiJutsuLoadout("control"), 158, 13000, "control"),
    makeBuiltinAi("hunt-ai-ancient-chakra-beast", "Ancient Chakra Beast", "👺", 88, "Central Wilderness", aiJutsuLoadout("boss"), 205, 18000, "boss"),
    makeBuiltinAi("hunt-ai-worldstorm-dragon", "Worldstorm Dragon", "🐲", 92, "Central Wilderness", aiJutsuLoadout("boss"), 220, 20000, "boss"),
    // -- Hollow Gate Shrine boss ---------------------------------------------
    // The Hollow Gate Warden is the deepest seal of the shrine. It is flagged
    // isBossAi so the shrine boss-tile picker selects it, and is built at a high
    // base level — the runtime AI selection in startHollowGateBattle rebases
    // its name and level to within ±15 of the player's level on use.
    ((): CreatorAi => {
        const base = makeBuiltinAi("boss-hollow-gate-warden", "Hollow Gate Warden", "👹", 60, "Hollow Gate Shrine", aiJutsuLoadout("boss"), 180, 22000, "boss");
        return { ...base, isBossAi: true };
    })(),
];

export function normalizeAiProfile(ai: Partial<CreatorAi>, allJutsus: Jutsu[] = starterJutsus): CreatorAi {
    const fallback = starterAiProfile(allJutsus);
    const level = Math.max(1, Math.min(MAX_LEVEL, Number(ai.level ?? fallback.level)));
    const jutsuIds = ai.jutsuIds ?? fallback.jutsuIds;
    const selectedJutsus = allJutsus.filter((jutsu) => jutsuIds.includes(jutsu.id));
    const loadoutId = ai.loadoutId ?? fallback.loadoutId ?? aiLoadoutFromJutsus(selectedJutsus);
    const recommendedStats = aiStatsForLevel(level, selectedJutsus.length ? selectedJutsus : allJutsus.slice(0, 4));
    const mergedStats = normalizeStats({ ...recommendedStats, ...(ai.stats ?? fallback.stats) });
    const sturdyStats = STAT_KEYS.reduce((next, key) => {
        next[key] = Math.max(recommendedStats[key], mergedStats[key]);
        return next;
    }, { ...mergedStats } as Stats);
    const armorRawDR = Math.max(
        aiRawDamageReductionForLevel(level),
        Number(ai.armorRawDR ?? fallback.armorRawDR ?? 0)
    );
    return {
        ...fallback,
        ...ai,
        id: ai.id ?? fallback.id,
        name: ai.name ?? fallback.name,
        icon: ai.icon ?? fallback.icon,
        image: ai.image ?? fallback.image,
        level,
        hp: Math.max(aiHpForLevel(level), Number(ai.hp ?? fallback.hp)),
        chakra: Math.max(maxChakraForLevel(level), Number(ai.chakra ?? fallback.chakra)),
        stamina: Math.max(maxStaminaForLevel(level), Number(ai.stamina ?? fallback.stamina)),
        stats: sturdyStats,
        armorRawDR,
        armorFactor: aiArmorFactorFromRaw(armorRawDR),
        loadoutId,
        jutsuIds,
        rules: (ai.rules?.length ? ai.rules : fallback.rules).map((rule) => ({
            id: rule.id ?? makeId(),
            condition: rule.condition ?? "always",
            value: Number(rule.value ?? 0),
            action: rule.action ?? "use_highest_power_jutsu",
            jutsuId: rule.jutsuId,
        })),
    };
}
