/*
 * Scored pet-battle decision system (Phase 10).
 *
 * Replaces rule-list move selection with a numeric scorer: every candidate
 * action (use a move, basic attack, guard / evade / focus / brace, reposition)
 * is scored from the tactical state — distance, move range, archetype, both HP
 * percents, cooldowns, statuses, whether the enemy is charging, whether the
 * actor is rooted / stunned / slowed, cover availability + whether the enemy is
 * behind cover, and melee-vs-ranged identity — and the highest score wins.
 *
 * Pure + node-testable; no ../App import and NO randomness (ties break on a
 * stable key), so ranked replays stay in sync. The simulator adapts its
 * fighters into a PetAiState, calls choosePetAction, and resolves the
 * returned decision with its full damage fidelity.
 */

import type { PetMove } from "../types/pet-battle";
import type { PetBattleActor, PetArchetype, Arena } from "./pet-tactics";
import { getDistance, arenaTileType, tileToIndex, isAdjacentToAny } from "./pet-tactics";

export type PetActionKind =
    | "useMove" | "basicAttack" | "move" | "guard" | "evade" | "focus" | "brace";

export type PetBattleDecision = {
    action: PetActionKind;
    moveId?: string;
    targetId?: string;
    moveDir?: "toward" | "away";
    score: number;
    reason: string;
};

export type PetActorStats = { attack: number; defense: number; speed: number };

export type PetAiState = {
    actors: PetBattleActor[];
    teamOf: Record<string, "player" | "enemy">;
    movesByActor: Record<string, PetMove[]>;
    statsByActor?: Record<string, PetActorStats>;
    arena: Arena;
    round: number;
};

const RANGED_ARCHETYPES = new Set<PetArchetype>(["kite", "support", "control"]);
const MELEE_ARCHETYPES = new Set<PetArchetype>(["bruiser", "tank", "assassin"]);

function nearestEnemy(state: PetAiState, actor: PetBattleActor): PetBattleActor | undefined {
    const myTeam = state.teamOf[actor.id];
    let best: PetBattleActor | undefined;
    let bestD = Infinity;
    for (const a of state.actors) {
        if (a.id === actor.id || a.hp <= 0 || state.teamOf[a.id] === myTeam) continue;
        const d = getDistance(actor, a);
        if (d < bestD) { bestD = d; best = a; }
    }
    return best;
}

function coverTilesOf(arena: Arena): Set<number> {
    const out = new Set<number>();
    for (const [idx, type] of arena.types) if (type === "cover") out.add(idx);
    return out;
}

function hasStatus(actor: PetBattleActor, ...kinds: string[]): boolean {
    return actor.statuses.some(s => kinds.includes(s.kind) && s.rounds > 0);
}

/** Rough damage estimate for lethal / value scoring (power + ATK − ½DEF). */
function estimateDamage(move: PetMove, atk: number, def: number): number {
    if (move.power <= 0) return 0;
    return Math.max(1, Math.round(move.power + atk - def * 0.5));
}

/**
 * Score the whole candidate set for `actorId` and return the best decision.
 * The per-archetype weighting encodes the documented behaviors (kite retreats
 * when crowded, tank guards a charge, assassin executes a low foe, etc.).
 */
export function choosePetAction(state: PetAiState, actorId: string): PetBattleDecision {
    const actor = state.actors.find(a => a.id === actorId);
    if (!actor) return { action: "focus", score: 0, reason: "no actor" };
    const enemy = nearestEnemy(state, actor);
    if (!enemy) return { action: "focus", score: 0, reason: "no target" };

    const dist = getDistance(actor, enemy);
    const hpPct = (actor.hp / Math.max(1, actor.maxHp)) * 100;
    const enemyPct = (enemy.hp / Math.max(1, enemy.maxHp)) * 100;
    const arch = actor.archetype;
    const rooted = hasStatus(actor, "moveLock");
    const stunned = hasStatus(actor, "stun", "freeze");
    const slowed = arenaTileType(state.arena, actor.position.row, actor.position.col) === "slow";
    const enemyCharging = !!enemy.isCharging;

    const cover = coverTilesOf(state.arena);
    const coverAvailable = cover.size > 0;
    const enemyIdx = tileToIndex(enemy.position.row, enemy.position.col);
    const enemyBehindCover = isAdjacentToAny(enemyIdx, cover);

    const moves = state.movesByActor[actorId] ?? [];
    const stats = state.statsByActor?.[actorId] ?? { attack: 20, defense: 20, speed: 20 };
    const isRanged = RANGED_ARCHETYPES.has(arch) || moves.some(m => m.tags.includes("ranged"));
    const isMelee = MELEE_ARCHETYPES.has(arch) && !RANGED_ARCHETYPES.has(arch);
    const crowded = dist <= 1;                  // enemy is in the actor's face
    // Anti-waste signals (utility-AI: a re-applied/immune action has near-zero
    // value — like casting fire on a fire-immune target). Reading the foe's
    // current statuses lets control/DoT pets avoid stomping their own effects.
    const enemyControlled = hasStatus(enemy, "moveLock", "stun", "freeze");
    const enemyAfflicted = hasStatus(enemy, "poison", "burn");
    const livingEnemies = state.actors.filter(a => a.hp > 0 && state.teamOf[a.id] !== state.teamOf[actorId]).length;
    // The actor's longest ranged reach (across its whole kit, not just ready
    // moves) — the band a kite/ranged pet wants to hold so it stays in firing
    // distance while a move recharges instead of being walked down into melee.
    const rangedReach = Math.max(0, ...moves.filter(m => m.tags.includes("ranged")).map(m => m.range.max));
    // Throttle on the base defensive actions (set by the engine) so a pet can't
    // guard/evade/brace/focus every single turn — it still mostly fights.
    const defenseOnCd = (actor.cooldowns["__defensiveCd"] ?? 0) > 0;
    const defPenalty = defenseOnCd ? 60 : 0;
    const offCooldown = (m: PetMove) => (actor.cooldowns[m.id] ?? 0) <= 0;
    // A move with max range 0 is a self-cast (heal/buff/shield) — always usable;
    // otherwise the enemy must sit within the move's range band.
    const inRange = (m: PetMove) => m.range.max === 0 || (dist >= m.range.min && dist <= m.range.max);

    const candidates: PetBattleDecision[] = [];
    const add = (action: PetActionKind, score: number, reason: string, extra: Partial<PetBattleDecision> = {}) =>
        candidates.push({ action, score, reason, ...extra });

    // ── Score every available move ──────────────────────────────────────────
    for (const m of moves) {
        if (!offCooldown(m)) continue;
        const dmg = estimateDamage(m, stats.attack, stats.defense);
        const lethal = dmg > 0 && dmg >= enemy.hp;
        let s = 0;
        switch (m.aiHint) {
            case "execute": s = 46 + (enemyPct <= 35 ? 60 : 0); break;
            case "damage":  s = 44; break;
            case "control": s = 36 + (enemyCharging ? 42 : 0); break;  // punish/interrupt a charge
            case "debuff":  s = 32; break;
            case "heal":    s = (100 - hpPct) * 0.85; break;
            case "defense": s = (100 - hpPct) * 0.5 + (enemyCharging ? 30 : 0); break;
            case "buff":    s = state.round <= 3 ? 26 : 14; break;
            case "kite":    s = crowded ? 40 : 12; break;
        }
        if (lethal) s += 120;                                    // a guaranteed KO trumps everything
        // Ranged value rises when the foe is slowed/rooted (free hits) and falls
        // when it's hugging cover (the hit is reduced).
        if (m.tags.includes("ranged")) {
            if (hasStatus(enemy, "moveLock") || enemy.position && (arenaTileType(state.arena, enemy.position.row, enemy.position.col) === "slow")) s += 16;
            if (enemyBehindCover) s -= 16;
        }
        // Melee moves want the foe adjacent; ranged moves want spacing.
        if (m.tags.includes("melee") && dist > m.range.max) s -= 12;
        // Anti-waste (don't stomp your own effects): re-rooting a locked foe or
        // re-applying a DoT it already has is near-pointless — score it down so
        // the pet does something useful instead. Control on a NOT-yet-locked foe
        // is worth more (uptime is a control pet's win-condition).
        const isControl = m.tags.includes("root") || m.tags.includes("stun");
        if (isControl && enemyControlled) s -= 32;
        if (isControl && !enemyControlled) s += 10;
        if (m.tags.includes("dot") && enemyAfflicted) s -= 20;
        // AoE: excellent into two enemies, wasteful (and weaker) into one.
        if (m.tags.includes("aoe")) s += livingEnemies >= 2 ? 26 : -16;
        // Archetype affinity.
        if (arch === "kite" && m.tags.includes("ranged")) s += 14;
        if (arch === "kite" && m.tags.includes("melee") && crowded) s -= 16;
        if (arch === "control" && isControl) s += 18;
        if (arch === "support" && (m.tags.includes("heal") || m.tags.includes("shield"))) s += 16;
        if (arch === "bruiser" && (m.aiHint === "damage" || m.tags.includes("lifesteal"))) s += 14;
        if (arch === "bruiser" && m.tags.includes("lifesteal") && hpPct <= 60) s += 10; // sustain when hurt
        if (arch === "assassin" && m.aiHint === "execute") s += 10;

        // ── Phase-12 archetype-mechanic affinity (deterministic, bounded) ─────
        // Without this the scorer always prefers a raw damage move, so a pet
        // never reaches for its identity tool. Each is anti-waste (won't re-apply
        // a status the foe already carries) and positioning-aware.
        const isWoundMove = m.tags.includes("dot") && m.tags.includes("melee"); // bleed (vs ranged DoT)
        const isPushMove  = m.tags.includes("push");                            // shove away (peel)
        const isPullMove  = m.tags.includes("pull");                            // yank in (anti-kite)
        const enemyWounded = hasStatus(enemy, "wound");
        const enemySlowed  = hasStatus(enemy, "slow");
        if ((arch === "bruiser" || arch === "assassin") && isWoundMove) {
            // Open with the bleed on a healthy foe; never stack it on a bleeding one.
            s += enemyWounded ? -34 : (enemyPct > 40 ? 28 : 8);
        }
        // Bruiser pull — drag a spacing / fleeing foe back into mauling range
        // (anti-kite). Worthwhile from a step away; pointless once adjacent, and
        // it won't chase a foe it can't reach (the move offer below handles that).
        if (arch === "bruiser" && isPullMove) s += dist >= 3 ? 28 : dist === 2 ? 14 : -16;
        // Control / kite push — peel a foe that has closed into melee (dist ≤2)
        // to restore the ranged kill-zone; never chase out to use it.
        if ((arch === "control" || arch === "kite") && isPushMove) s += dist <= 2 ? 24 : -15;
        // Control values slowing an un-slowed foe (kiting uptime); skip if slowed.
        if (arch === "control" && m.tags.includes("slow")) s += enemySlowed ? -22 : 12;

        if (inRange(m)) {
            add("useMove", s, `use ${m.name}`, { moveId: m.id, targetId: enemy.id });
        } else {
            // Out of range — offer to reposition for it (worth a fraction of the move).
            const dir = dist > m.range.max ? "toward" : "away";
            add("move", s * 0.45 + 6, `close for ${m.name}`, { moveDir: dir, moveId: m.id });
        }
    }

    // ── Basic attack ──────────────────────────────────────────────────────
    if (dist <= 1) add("basicAttack", 20 + (isMelee ? 8 : 0), "basic strike", { targetId: enemy.id });

    // ── Base tactical actions (archetype-weighted) ────────────────────────
    // Guard — react to a charge, or hunker when wounded (or when slowed and
    // pinned, since retreating won't open much space).
    add("guard", (enemyCharging ? 50 : 0) + (hpPct <= 40 ? 30 : 0)
        + (arch === "tank" ? 18 : 0) + (crowded ? 6 : -8) + (slowed && crowded ? 10 : 0) - defPenalty, "guard");
    // Evade — nimble pets slip a charge or a crowded melee.
    add("evade", (enemyCharging ? 38 : 0) + (crowded && isRanged ? 30 : 0)
        + (arch === "kite" || arch === "assassin" ? 18 : 0) + (hpPct <= 55 ? 10 : -6) - defPenalty, "evade");
    // Focus — set up a big hit when healthy and safe (no in-range damage move).
    const hasReadyDamage = moves.some(m => offCooldown(m) && inRange(m) && (m.aiHint === "damage" || m.aiHint === "execute"));
    add("focus", (!actor.isCharging && hpPct > 60 && !hasReadyDamage && !enemyCharging ? 28 : -20)
        + (arch === "assassin" && enemyPct > 50 ? 14 : 0) - defPenalty, "focus");
    // Brace — dig in versus a heavy charge / when bracing-archetypes are pressured.
    add("brace", (enemyCharging ? 26 : 0) + (arch === "tank" && hpPct <= 60 ? 18 : -4) - defPenalty, "brace");

    // ── Movement ──────────────────────────────────────────────────────────
    // Advance to close the gap (melee / out-of-range), retreat to kite.
    const wantClose = dist > 1 && (isMelee || !moves.some(m => offCooldown(m) && inRange(m)));
    add("move", (wantClose ? 24 : 4) + (arch === "bruiser" || arch === "tank" ? 8 : 0)
        + (enemyPct <= 35 && arch === "assassin" ? 40 : 0), "advance", { moveDir: "toward", targetId: enemy.id });
    // Kite back — a ranged/kite pet holds a RANGE BAND, not just "flee when
    // touched". It retreats whenever the foe is inside its comfortable firing
    // distance (dist < readyRangedMax − 1), strongest when point-blank. Cover
    // nearby sweetens it; being slowed makes escaping pointless.
    const tooClose = isRanged && dist < Math.max(2, rangedReach - 1);
    add("move", (crowded && (arch === "kite" || isRanged) ? 34 : tooClose ? 18 : -30)
        + (arch === "kite" ? 12 : 0) + (hpPct <= 50 ? 8 : 0)
        + (coverAvailable && isRanged ? 6 : 0) + (slowed ? -12 : 0), "kite back", { moveDir: "away", targetId: enemy.id });

    // Rooted / slowed pets can't (usefully) reposition.
    let pool = candidates;
    if (rooted) pool = pool.filter(c => c.action !== "move");
    if (stunned) return { action: "guard", score: 0, reason: "stunned — brace", targetId: enemy.id };

    // Highest score wins; deterministic tiebreak on a stable key (no RNG).
    pool.sort((a, b) => b.score - a.score
        || `${a.action}:${a.moveId ?? ""}:${a.moveDir ?? ""}`.localeCompare(`${b.action}:${b.moveId ?? ""}:${b.moveDir ?? ""}`));
    return pool[0] ?? { action: "basicAttack", score: 0, reason: "fallback", targetId: enemy.id };
}

/**
 * Pick WHICH enemy to attack when more than one is fielded (2v2). Considers
 * every living enemy per the actor's archetype, deterministically:
 *   assassin / striker / bruiser → the lowest-HP enemy (finish it)
 *   control                      → a charging enemy, else the biggest threat
 *   tank                         → the biggest threat (highest attack)
 *   kite / support / default     → the nearest enemy (avoid over-committing)
 * Returns the chosen enemy id, or undefined if none are alive. Pure; ties keep
 * the first-seen enemy so replays stay in sync.
 */
export function choosePartyTarget(state: PetAiState, actorId: string): string | undefined {
    const actor = state.actors.find(a => a.id === actorId);
    if (!actor) return undefined;
    const myTeam = state.teamOf[actorId];
    const enemies = state.actors.filter(a => a.hp > 0 && state.teamOf[a.id] !== myTeam);
    if (!enemies.length) return undefined;
    const atk = (id: string) => state.statsByActor?.[id]?.attack ?? 0;
    const arch = actor.archetype;
    let pick: PetBattleActor;
    if (arch === "assassin" || arch === "striker" || arch === "bruiser") {
        pick = enemies.reduce((lo, e) => (e.hp < lo.hp ? e : lo));
    } else if (arch === "control") {
        pick = enemies.find(e => e.isCharging) ?? enemies.reduce((hi, e) => (atk(e.id) > atk(hi.id) ? e : hi));
    } else if (arch === "tank") {
        pick = enemies.reduce((hi, e) => (atk(e.id) > atk(hi.id) ? e : hi));
    } else {
        pick = enemies.reduce((near, e) => (getDistance(actor, e) < getDistance(actor, near) ? e : near));
    }
    return pick.id;
}
