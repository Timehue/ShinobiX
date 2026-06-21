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
    // Loadouts are tuned to the POST-rebalanceNonBloodlineJutsu catalog (see
    // data/jutsu.ts), where every starter jutsu is either a 60-AP single-tag
    // DAMAGE move (effectPower 36) or a 40-AP two-tag zero-damage UTILITY, and
    // all carry a 7-turn cooldown. Because each move is on a long cooldown, an
    // AI taking a full multi-action 100-AP turn needs SEVERAL 60-AP damage moves
    // to keep attacking turn-over-turn, plus a 40-AP utility (one defensive) so a
    // turn can read as "damage (60) + buff/debuff (40)". Each loadout therefore
    // carries 3–4 damage moves + 1–2 utilities + Flicker (20 AP reposition), and
    // includes at least one self-support / control / pressure tag so
    // buildBasicCombatAiRules can author a full rule set. (Comments below give
    // each id's real post-rebalance tag, not its literal definition.)
    const idsByLoadout: Record<AiLoadoutId, string[]> = {
        balanced: [
            "starter-gen-lightning-2", // DDG    — 60 dmg, control
            "starter-nin-fire-2",      // Poison — 60 dmg, pressure
            "starter-buki-lightning-2",// Siphon — 60 dmg, pressure/sustain
            "starter-tai-lightning-2", // Reflect— 60 dmg, self-support
            "starter-nin-earth-1",     // Shield+IDT — 40 util, defensive + control
            "starter-universal-flicker",
        ],
        control: [
            "starter-gen-lightning-2", // DDG    — 60 dmg, control
            "starter-gen-water-2",     // Poison — 60 dmg, pressure
            "starter-gen-earth-2",     // Siphon — 60 dmg, pressure/sustain
            "starter-nin-water-1",     // Lifesteal+IDT — 40 util, control
            "starter-gen-fire-1",      // IncreaseHeal+DDT — 40 util, defensive
            "starter-universal-flicker",
        ],
        burst: [
            "starter-tai-water-2",     // IDG    — 60 dmg, self-amp
            "starter-nin-lightning-2", // Wound  — 60 dmg, pressure
            "starter-buki-fire-2",     // Wound  — 60 dmg, pressure
            "starter-tai-fire-2",      // Drain  — 60 dmg, pressure
            "starter-tai-earth-1",     // IDT+Ignition — 40 util, amp target
            "starter-universal-flicker",
        ],
        bruiser: [
            "starter-tai-earth-2",     // Poison  — 60 dmg, pressure (melee)
            "starter-tai-fire-2",      // Drain   — 60 dmg, pressure (melee)
            "starter-tai-wind-2",      // Lifesteal — 60 dmg, sustain (melee)
            "starter-tai-lightning-2", // Reflect — 60 dmg, self-support (melee)
            "starter-tai-earth-1",     // IDT+Ignition — 40 util, control/pressure
            "starter-tai-water-3",     // Reflect+Absorb — 40 util, defensive
            "starter-universal-flicker",
        ],
        defender: [
            "starter-buki-water-1",    // Shield+DDT — 40 util, defensive
            "starter-tai-water-3",     // Reflect+Absorb — 40 util, defensive
            "starter-gen-fire-1",      // IncreaseHeal+DDT — 40 util, defensive
            "starter-gen-lightning-2", // DDG    — 60 dmg, control (weaken attacker)
            "starter-gen-water-2",     // Poison — 60 dmg, pressure (poke)
            "starter-universal-flicker",
        ],
        hunter: [
            "starter-buki-wind-2",     // Wound  — 60 dmg, pressure
            "starter-nin-lightning-2", // Wound  — 60 dmg, pressure
            "starter-tai-fire-2",      // Drain  — 60 dmg, pressure
            "starter-nin-earth-2",     // Ignition — 60 dmg, pressure
            "starter-buki-water-1",    // Shield+DDT — 40 util, beast hide
            "starter-universal-flicker",
        ],
        boss: [
            "starter-gen-lightning-2", // DDG    — 60 dmg, control
            "starter-nin-fire-2",      // Poison — 60 dmg, pressure
            "starter-buki-water-2",    // Siphon — 60 dmg, pressure/sustain
            "starter-tai-lightning-2", // Reflect— 60 dmg, self-support
            "starter-nin-earth-1",     // Shield+IDT — 40 util, defensive + control
            "starter-gen-fire-1",      // IncreaseHeal+DDT — 40 util, defensive
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
    // The Worldstorm Dragon (peer-band L92) is opt-in apex content, but 0.35
    // toughness floored its HP near ~18k, making it a kage-style unwinnable grind.
    // Drop it to 0.18 so its lowered hpOverride (16k) actually lands. Other hunt
    // bosses keep 0.35; their HP is set by hpOverride above that floor anyway.
    const toughness = id === "hunt-ai-worldstorm-dragon"
        ? 0.18
        : id.startsWith("hunt-ai-")
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

// Rebuild a builtin AI at a new level / stat bonus while preserving its identity
// (id, name, icon, village, loadout, jutsus, image, masterAi). Used to align a
// combat-mission foe to the PLAYER's level instead of a fixed boosted one — so a
// D-Rank Errand isn't a level-8 +30 enemy versus a level-3 player. The shared
// catalog builtin is never mutated; this returns a fresh clone with stats / HP /
// armor recomputed for `targetLevel`.
export function relevelBuiltinAi(base: CreatorAi, targetLevel: number, statBonus: number, hpOverride = 0, allJutsus: Jutsu[] = starterJutsus): CreatorAi {
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(targetLevel || 1)));
    const jutsus = base.jutsuIds
        .map((id) => allJutsus.find((j) => j.id === id))
        .filter((j): j is Jutsu => Boolean(j));
    const loadoutId: AiLoadoutId = base.loadoutId ?? aiLoadoutFromJutsus(jutsus);
    // makeBuiltinAi floors HP at max(hpOverride, aiHpForLevel(level)), so an
    // hpOverride below the natural curve is a no-op — the floor only lifts low
    // levels where the natural HP is below it.
    const rebuilt = makeBuiltinAi(
        base.id, base.name, base.icon, level, base.village,
        jutsus.length ? jutsus : aiJutsuLoadout(loadoutId, allJutsus),
        Math.max(0, Math.floor(statBonus || 0)), Math.max(0, Math.floor(hpOverride || 0)), loadoutId,
    );
    // Preserve identity fields makeBuiltinAi doesn't carry over.
    return { ...rebuilt, image: base.image, masterAi: base.masterAi };
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
    // The kage finale uses no toughness HP-floor so its lowered bossHp actually
    // takes effect (a 0.50 floor pinned it back near ~22k regardless of the table).
    // It still floors at aiHpForLevel(100, 0) ≈ 14,553 via normalizeAiProfile, and
    // stays the hardest fight via the peer band, not via a bigger HP pool.
    const bossHp = Math.max(step.bossHp, aiHpForLevel(step.levelReq, step.kageFinale ? 0 : 0.30));
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
    // E-Rank Drill foe — the onboarding "guaranteed win" for level 1-5 players.
    // A deliberately gentle, NO-SUSTAIN kit (two plain damage-over-time moves +
    // reposition; no heal / shield / stun) so it can't out-last a learning
    // player. In a mission it re-levels to the player (floored at the E-Rank min
    // of 1) with statBonus 0 and a low HP floor (see data/combat-missions.ts),
    // and the easy-band onboarding guards (lib/pve-difficulty.pveGuardedEnemyHit:
    // per-hit/turn caps + a low-level mercy floor) keep the fight unloseable.
    makeBuiltinAi("builtin-ai-academy-sparring", "Academy Sparring Partner", "🥋", 3, "Academy Training Grounds", starterJutsus.filter((jutsu) => ["starter-nin-lightning-2", "starter-nin-fire-2", "starter-universal-flicker"].includes(jutsu.id)), 0, undefined, "balanced"),
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
    makeBuiltinAi("hunt-ai-worldstorm-dragon", "Worldstorm Dragon", "🐲", 92, "Central Wilderness", aiJutsuLoadout("boss"), 220, 16000, "boss"),
    // -- Hollow Gate Shrine boss ---------------------------------------------
    // The Hollow Gate Warden is the deepest seal of the shrine. It is flagged
    // isBossAi so the shrine boss-tile picker selects it, and is built at a high
    // base level — the runtime AI selection in startHollowGateBattle rebases
    // its name and level to within ±15 of the player's level on use.
    ((): CreatorAi => {
        // Base HP is multiplied by the run's floor (up to 1.4× on Floor 5), so a
        // 22k base hit ~30.8k at the deepest floor — an unwinnable peer-band grind.
        // 13k base keeps the floor-scaling feel but tops out ~18.2k on Floor 5.
        const base = makeBuiltinAi("boss-hollow-gate-warden", "Hollow Gate Warden", "👹", 60, "Hollow Gate Shrine", aiJutsuLoadout("boss"), 180, 13000, "boss");
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
