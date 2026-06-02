/*
 * Pet MOVE descriptor model + base-action + status registries (Phases 7-9).
 *
 * Pure + node-testable; no ../App import. The persisted unit stays PetJutsu
 * (balance + saves unchanged); jutsuToPetMove() projects a jutsu into the rich
 * PetMove descriptor (range band, tags, animation, VFX, AI hint) so moves are
 * explicitly typed instead of "all basic contact attacks". PET_BASE_ACTIONS
 * and BATTLE_STATUS_DEFS are the canonical registries for the base turn-choices
 * and the visible status set; collectActorStatuses() maps a fighter's flags to
 * the displayable status list.
 */

import type { Pet, PetJutsu } from "../types/pet";
import type { JutsuElement } from "../types/core";
import { elementVfxKey } from "./pet-battle-anim";
import type {
    PetMove, PetMoveTag, PetAnimationType, PetAiHint, PetVfxKey, PetMoveTargetType,
    PetBaseAction, BattleStatusId, BattleStatusDef, ActiveBattleStatus,
} from "../types/pet-battle";

// Kinds that target the caster (or allies), never an enemy tile.
const SELF_KINDS = new Set<PetJutsu["kind"]>(["heal", "buff", "barrier", "shield", "absorb", "move", "haste"]);

// ── Per-kind descriptor table ───────────────────────────────────────────────
// Maps a PetJutsu.kind onto its tactical descriptor. `vfx: null` means "use the
// pet's element"; an explicit key overrides (status moves read by their kind).
type KindSpec = {
    tags: PetMoveTag[];
    anim: PetAnimationType;
    hint: PetAiHint;
    range: { min: number; max: number };
    accuracy: number;
    vfx: PetVfxKey | null;
    blurb: string;
};

const KIND_SPECS: Record<PetJutsu["kind"], KindSpec> = {
    damage:    { tags: ["melee"],                     anim: "melee_lunge",       hint: "damage",  range: { min: 1, max: 2 }, accuracy: 95,  vfx: null,        blurb: "Strikes for direct damage." },
    lifesteal: { tags: ["melee", "lifesteal"],        anim: "melee_lunge",       hint: "damage",  range: { min: 1, max: 2 }, accuracy: 95,  vfx: "blood",     blurb: "Drains HP from the target." },
    crush:     { tags: ["melee", "pierce", "debuff"], anim: "ground_impact",     hint: "damage",  range: { min: 1, max: 2 }, accuracy: 90,  vfx: "earth",     blurb: "Shatters armor — damage plus an ATK/DEF strip." },
    dot:       { tags: ["ranged", "dot"],             anim: "ranged_projectile", hint: "debuff",  range: { min: 1, max: 4 }, accuracy: 90,  vfx: "poison",    blurb: "Poisons for damage over time." },
    burn:      { tags: ["ranged", "dot"],             anim: "ranged_projectile", hint: "debuff",  range: { min: 1, max: 4 }, accuracy: 90,  vfx: "fire",      blurb: "Sets the target ablaze for burn damage." },
    debuff:    { tags: ["ranged", "debuff"],          anim: "roar",              hint: "debuff",  range: { min: 1, max: 3 }, accuracy: 90,  vfx: "shadow",    blurb: "Weakens the target's stats." },
    movelock:  { tags: ["ranged", "root"],            anim: "beam",              hint: "control", range: { min: 1, max: 4 }, accuracy: 90,  vfx: "shadow",    blurb: "Roots the target in place." },
    freeze:    { tags: ["ranged", "root", "stun"],    anim: "beam",              hint: "control", range: { min: 1, max: 4 }, accuracy: 85,  vfx: "ice",       blurb: "Freezes — a chance to skip turns." },
    confuse:   { tags: ["ranged", "debuff"],          anim: "ranged_projectile", hint: "control", range: { min: 1, max: 4 }, accuracy: 85,  vfx: "wind",      blurb: "Confuses — the target may strike itself." },
    stun:      { tags: ["ranged", "stun"],            anim: "beam",              hint: "control", range: { min: 1, max: 4 }, accuracy: 85,  vfx: "lightning", blurb: "Stuns — skips the next turn." },
    heal:      { tags: ["heal"],                      anim: "heal",              hint: "heal",    range: { min: 0, max: 0 }, accuracy: 100, vfx: "chakra",    blurb: "Restores HP." },
    buff:      { tags: ["buff"],                      anim: "self_buff",         hint: "buff",    range: { min: 0, max: 0 }, accuracy: 100, vfx: "chakra",    blurb: "Raises ATK and DEF." },
    barrier:   { tags: ["shield"],                    anim: "shield",            hint: "defense", range: { min: 0, max: 0 }, accuracy: 100, vfx: "chakra",    blurb: "Raises a damage-absorbing barrier." },
    shield:    { tags: ["shield"],                    anim: "shield",            hint: "defense", range: { min: 0, max: 0 }, accuracy: 100, vfx: "chakra",    blurb: "Forms a protective ward." },
    absorb:    { tags: ["shield", "buff"],            anim: "guard",             hint: "defense", range: { min: 0, max: 0 }, accuracy: 100, vfx: "chakra",    blurb: "Enters an absorb stance, reducing damage." },
    move:      { tags: ["charge"],                    anim: "dash",              hint: "kite",    range: { min: 0, max: 5 }, accuracy: 100, vfx: "none",      blurb: "Dashes across the arena." },
    // Phase 12 archetype-identity kinds.
    wound:     { tags: ["melee", "dot"],              anim: "melee_lunge",       hint: "debuff",  range: { min: 1, max: 2 }, accuracy: 95,  vfx: "blood",     blurb: "Opens a bleeding wound — damage over time and halved healing." },
    mark:      { tags: ["ranged", "debuff"],          anim: "roar",              hint: "debuff",  range: { min: 1, max: 4 }, accuracy: 100, vfx: "shadow",    blurb: "Marks the target — its next heavy hit bites deeper." },
    slow:      { tags: ["ranged", "slow", "debuff"],  anim: "beam",              hint: "control", range: { min: 1, max: 4 }, accuracy: 90,  vfx: "ice",       blurb: "Chills the target — slower movement and dodge." },
    haste:     { tags: ["buff"],                      anim: "self_buff",         hint: "buff",    range: { min: 0, max: 0 }, accuracy: 100, vfx: "lightning", blurb: "Surges with speed — faster and harder to pin." },
    taunt:     { tags: ["debuff"],                    anim: "roar",              hint: "defense", range: { min: 1, max: 4 }, accuracy: 100, vfx: "none",      blurb: "Taunts the foe into attacking the caster." },
    push:      { tags: ["melee", "push"],             anim: "ground_impact",     hint: "damage",  range: { min: 1, max: 2 }, accuracy: 90,  vfx: "earth",     blurb: "A shove that knocks the target back." },
    pull:      { tags: ["ranged", "pull"],            anim: "beam",              hint: "control", range: { min: 1, max: 4 }, accuracy: 90,  vfx: "wind",      blurb: "Yanks the target in close." },
};

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Project a persisted PetJutsu into the rich PetMove descriptor. Pure. The
 * element supplies the VFX tint for damage moves; status moves keep their own
 * themed VFX. Signature moves pick up the execute + charge tags.
 */
export function jutsuToPetMove(jutsu: PetJutsu, pet?: Pick<Pet, "element">): PetMove {
    const spec = KIND_SPECS[jutsu.kind] ?? KIND_SPECS.damage;
    const element: JutsuElement | undefined = pet?.element;
    const vfx: PetVfxKey = spec.vfx ?? elementVfxKey(element);
    const tags: PetMoveTag[] = [...spec.tags];
    if (jutsu.signature) {
        if (!tags.includes("charge")) tags.push("charge");
        if (!tags.includes("execute")) tags.push("execute");
    }
    if (jutsu.aoe && !tags.includes("aoe")) tags.push("aoe");
    const hint: PetAiHint = jutsu.signature && (jutsu.kind === "damage" || jutsu.kind === "lifesteal" || jutsu.kind === "crush")
        ? "execute"
        : spec.hint;
    // Target rule: AoE-tagged offensive moves hit all enemies; AoE self/ally
    // kinds blanket all allies; non-AoE self kinds cast on the caster;
    // everything else is a single-enemy strike. (2v2 may retarget allies.)
    const targetType: PetMoveTargetType = tags.includes("aoe")
        ? (SELF_KINDS.has(jutsu.kind) ? "allAllies" : "allEnemies")
        : SELF_KINDS.has(jutsu.kind) ? "self"
        : "singleEnemy";
    return {
        id: slug(jutsu.name),
        name: jutsu.name,
        description: `${jutsu.name} — ${spec.blurb}`,
        power: jutsu.power,
        accuracy: spec.accuracy,
        cooldown: jutsu.cooldown,
        range: { ...spec.range },
        tags,
        animationType: spec.anim,
        vfxKey: vfx,
        aiHint: hint,
        targetType,
    };
}

/** Every move in a pet's kit, as descriptors. */
export function petMoveset(pet: Pick<Pet, "jutsus" | "element">): PetMove[] {
    return (pet.jutsus ?? []).map(j => jutsuToPetMove(j, pet));
}

// ── Base actions ────────────────────────────────────────────────────────────

export type PetBaseActionDef = {
    name: string;
    description: string;
    animationType: PetAnimationType;
    aiHint?: PetAiHint;
};

export const PET_BASE_ACTIONS: Record<PetBaseAction, PetBaseActionDef> = {
    move:        { name: "Move",     description: "Reposition toward or away from the foe.",                 animationType: "dash" },
    basicAttack: { name: "Strike",   description: "A basic contact attack.",                                 animationType: "melee_lunge", aiHint: "damage" },
    guard:       { name: "Guard",    description: "Brace behind a guard — incoming damage −40% for 1 round.", animationType: "guard", aiHint: "defense" },
    evade:       { name: "Evade",    description: "Read the foe — dodge chance +25% for 1 round.",            animationType: "dodge", aiHint: "kite" },
    focus:       { name: "Focus",    description: "Skip the attack to focus — the next offensive move is stronger.", animationType: "self_buff", aiHint: "buff" },
    brace:       { name: "Brace",    description: "Dig in — immune to push/pull and takes less crit damage.", animationType: "guard", aiHint: "defense" },
    useMove:     { name: "Use Move", description: "Use a chosen jutsu.",                                      animationType: "melee_lunge" },
};

// ── Status registry ──────────────────────────────────────────────────────────

export const BATTLE_STATUS_DEFS: Record<BattleStatusId, BattleStatusDef> = {
    burn:        { id: "burn",        icon: "🔥",  label: "Burn",         kind: "dot",     description: "Medium damage over time." },
    poison:      { id: "poison",      icon: "☠️",  label: "Poison",       kind: "dot",     description: "Low damage over a longer duration." },
    wound:       { id: "wound",       icon: "🩸",  label: "Wound",        kind: "dot",     description: "Damage over time and reduced healing." },
    slow:        { id: "slow",        icon: "🐌",  label: "Slow",         kind: "debuff",  description: "Reduced movement and dodge." },
    haste:       { id: "haste",       icon: "💨",  label: "Haste",        kind: "buff",    description: "Increased movement and dodge." },
    root:        { id: "root",        icon: "🌿",  label: "Root",         kind: "control", description: "Cannot move, but can still attack in range." },
    stun:        { id: "stun",        icon: "💫",  label: "Stun",         kind: "control", description: "Skips its action." },
    guarding:    { id: "guarding",    icon: "🛡️",  label: "Guarding",     kind: "buff",    description: "Incoming damage reduced." },
    shielded:    { id: "shielded",    icon: "🔰",  label: "Shielded",     kind: "shield",  description: "Absorbs damage before HP." },
    focused:     { id: "focused",     icon: "🎯",  label: "Focused",      kind: "buff",    description: "Next move is stronger." },
    marked:      { id: "marked",      icon: "🔻",  label: "Marked",       kind: "debuff",  description: "Next heavy hit deals bonus damage." },
    blinded:     { id: "blinded",     icon: "🌀",  label: "Blinded",      kind: "debuff",  description: "Lower accuracy." },
    taunted:     { id: "taunted",     icon: "❗",  label: "Taunted",      kind: "debuff",  description: "Forced to target the taunter." },
    armorBroken: { id: "armorBroken", icon: "🪓",  label: "Armor Broken", kind: "debuff",  description: "Takes more melee damage." },
    countering:  { id: "countering",  icon: "↩️",  label: "Countering",   kind: "buff",    description: "Retaliates against melee." },
    reflecting:  { id: "reflecting",  icon: "🪞",  label: "Reflecting",   kind: "buff",    description: "Returns part of incoming damage." },
};

// ── Example moves (Phase 10) — reference designs in the new PetMove system,
// spanning melee-DoT, kite-retreat, self-shield, ranged-poison, and charge. ──
export const EXAMPLE_PET_MOVES: PetMove[] = [
    {
        id: "ember-pounce",
        name: "Ember Pounce",
        description: "Leap forward and strike with burning claws.",
        power: 32, accuracy: 90, cooldown: 2,
        range: { min: 1, max: 2 },
        tags: ["melee", "dot"],
        animationType: "melee_lunge",
        vfxKey: "fire",
        aiHint: "damage",
        targetType: "singleEnemy",
    },
    {
        id: "moonstep-retreat",
        name: "Moonstep Retreat",
        description: "Dash backward, gain evade, and prepare a counterattack.",
        power: 0, accuracy: 100, cooldown: 3,
        range: { min: 0, max: 6 },
        tags: ["buff", "counter"],
        animationType: "dash",
        vfxKey: "shadow",
        aiHint: "kite",
        targetType: "self",
    },
    {
        id: "iron-hide",
        name: "Iron Hide",
        description: "Harden defenses and reduce incoming damage.",
        power: 0, accuracy: 100, cooldown: 3,
        range: { min: 0, max: 0 },
        tags: ["shield", "buff"],
        animationType: "shield",
        vfxKey: "earth",
        aiHint: "defense",
        targetType: "self",
    },
    {
        id: "venom-needle",
        name: "Venom Needle",
        description: "Fire a toxic spike from range. Applies poison.",
        power: 18, accuracy: 95, cooldown: 1,
        range: { min: 2, max: 5 },
        tags: ["ranged", "dot"],
        animationType: "ranged_projectile",
        vfxKey: "poison",
        aiHint: "debuff",
        targetType: "singleEnemy",
    },
    {
        id: "thunder-break",
        name: "Thunder Break",
        description: "Charge lightning, then strike hard next round.",
        power: 60, accuracy: 80, cooldown: 4,
        range: { min: 1, max: 4 },
        tags: ["charge", "stun"],
        animationType: "beam",
        vfxKey: "lightning",
        aiHint: "damage",
        targetType: "singleEnemy",
    },
];

/** Display order — control/DoT threats first, then defenses, then buffs. */
const STATUS_ORDER: BattleStatusId[] = [
    "stun", "root", "burn", "poison", "wound", "blinded", "slow", "marked", "armorBroken", "taunted",
    "shielded", "guarding", "focused", "haste", "countering", "reflecting",
];

/** Loose flag bag (numbers = rounds, booleans = present) → status list. Accepts
 *  the PetArenaFrame status shape as well as raw fighter fields. */
export type StatusFlags = {
    poisoned?: number; burn?: number; freeze?: number; confuse?: number; stun?: number;
    moveLocked?: number | boolean; slow?: number; haste?: number;
    shield?: number; guarding?: number | boolean; focused?: number | boolean;
    evading?: number | boolean; wound?: number; marked?: number | boolean; blinded?: number;
    taunted?: number | boolean; armorBroken?: number; countering?: number | boolean; reflecting?: number;
};

function rounds(v: number | boolean | undefined): number {
    return typeof v === "number" ? v : v ? 1 : 0;
}

/**
 * Map a fighter / frame status bag to the visible status list (icon + rounds),
 * sorted into a stable display order. Freeze folds into stun and confuse into
 * blinded (the canonical set has no separate id for them).
 */
export function collectActorStatuses(f: StatusFlags): ActiveBattleStatus[] {
    const r: Partial<Record<BattleStatusId, number>> = {};
    const set = (id: BattleStatusId, v: number) => { if (v > 0) r[id] = Math.max(r[id] ?? 0, v); };
    set("burn", rounds(f.burn));
    set("poison", rounds(f.poisoned));
    set("wound", rounds(f.wound));
    set("stun", Math.max(rounds(f.stun), rounds(f.freeze)));
    set("root", rounds(f.moveLocked));
    set("blinded", Math.max(rounds(f.blinded), rounds(f.confuse)));
    set("slow", rounds(f.slow));
    set("marked", rounds(f.marked));
    set("armorBroken", rounds(f.armorBroken));
    set("taunted", rounds(f.taunted));
    set("guarding", rounds(f.guarding));
    set("focused", rounds(f.focused));
    set("haste", Math.max(rounds(f.haste), rounds(f.evading)));
    set("countering", rounds(f.countering));
    set("reflecting", rounds(f.reflecting));
    if (rounds(f.shield) > 0) r.shielded = rounds(f.shield);
    return STATUS_ORDER.filter(id => (r[id] ?? 0) > 0).map(id => ({ id, rounds: r[id]! }));
}

// ── Multi-target / AoE resolution (Phase 13c) ───────────────────────────────

/** Per-target damage multiplier for a multi-enemy AoE — strictly < 1 so AoE
 *  always deals LESS per head than a single-target hit (the ranked-safety
 *  "AoE damage < single-target" rule). Single-target / ally moves are 1×. */
export const PET_AOE_DAMAGE_MULT = 0.6;

export function aoeDamageMultiplier(targetType: PetMoveTargetType): number {
    return targetType === "allEnemies" || targetType === "allPets" || targetType === "area"
        ? PET_AOE_DAMAGE_MULT
        : 1;
}

/**
 * Resolve which actor ids a move affects from its target type. `primaryTargetId`
 * is the engine-chosen single target (for singleEnemy/singleAlly/area). Pure.
 */
export function petMoveTargetIds(
    targetType: PetMoveTargetType,
    actorId: string,
    teamOf: Record<string, "player" | "enemy">,
    livingIds: string[],
    primaryTargetId?: string,
): string[] {
    const myTeam = teamOf[actorId];
    const enemies = livingIds.filter(id => teamOf[id] && teamOf[id] !== myTeam);
    const allies = livingIds.filter(id => teamOf[id] === myTeam);
    switch (targetType) {
        case "self":        return [actorId];
        case "singleEnemy": return primaryTargetId && enemies.includes(primaryTargetId) ? [primaryTargetId] : enemies.slice(0, 1);
        case "singleAlly":  return primaryTargetId && allies.includes(primaryTargetId) ? [primaryTargetId] : allies.slice(0, 1);
        case "allEnemies":  return enemies;
        case "allAllies":   return allies;
        case "allPets":     return [...livingIds];
        case "area":        return primaryTargetId ? [primaryTargetId] : enemies.slice(0, 1);
        default:            return enemies.slice(0, 1);
    }
}
