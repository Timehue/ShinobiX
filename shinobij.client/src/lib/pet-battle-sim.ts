/**
 * Pet autobattler simulation engine.
 *
 * Deterministic 1v1 (runPetArenaBattle) and 2v2 party (runPetArenaParty)
 * pet-battle simulators plus their pure helpers: BFS pathfinding,
 * line-of-sight, action AI, seeded combat math (damage / crit / evade /
 * flurry / element multipliers) and the seeded RNG.
 *
 * Extracted verbatim from App.tsx with no behavior change. Determinism is
 * load-bearing for ranked pet PvP (both clients run an identical canonical
 * simulation from the same seed), so the RNG call order here must not change.
 */
import { buildArenaTiles, isAdjacentToAny, petArchetypeFor, petPairBond, petHighGroundTiles, petPickupTiles, petBushTiles, petShrineSeekGoal, makeArena, type PetBattleActor, type BattleStatus, type PetPairBond, type ArenaTile } from "./pet-tactics";
import { petMoveset, jutsuToPetMove } from "./pet-moves";
import { choosePetAction, choosePartyTarget, type PetAiState } from "./pet-ai";
import {
    applyPetPvpGear,
    petConsumableCharges,
    petGearStartShield,
    petGearExecuteMult,
    petGearLastStandMult,
    petGearDotOnHit,
    petGearLifestealHeal,
    PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT,
} from "../data/pet-config";
import {
    PET_GRID_COLS,
    PET_GRID_ROWS,
    PET_GRID_SIZE,
    PET_OBSTACLE_LAYOUTS,
    PET_ELEMENT_BEATS,
} from "../constants/pet-arena";
import type { Pet, PetJutsu } from "../types/pet";
import type { PetArenaFrame, PetBattleFighter } from "../App";

/** Horizontal mirror of a grid tile index (left↔right within its row). */
export function mirrorPetTile(tile: number): number {
    const row = Math.floor(tile / PET_GRID_COLS);
    const col = tile % PET_GRID_COLS;
    return row * PET_GRID_COLS + (PET_GRID_COLS - 1 - col);
}

// Render a canonical (deterministic) ranked replay from the OTHER side's
// perspective: swap every player/enemy frame field and mirror positions so
// the local player's pet still appears on the left. Used by ranked 1v1 pet
// battles, where both clients run an identical canonical simulation but the
// non-canonical side needs its own pet shown as "player". Pure transform.
export function swapPetArenaFrame(f: PetArenaFrame): PetArenaFrame {
    return {
        ...f,
        playerHp: f.enemyHp,
        enemyHp: f.playerHp,
        playerPos: mirrorPetTile(f.enemyPos),
        enemyPos: mirrorPetTile(f.playerPos),
        actor: f.actor === "player" ? "enemy" : f.actor === "enemy" ? "player" : "system",
        traitFlash: f.traitFlash
            ? { ...f.traitFlash, actor: f.traitFlash.actor === "player" ? "enemy" : "player" }
            : f.traitFlash,
        signatureMove: f.signatureMove
            ? { ...f.signatureMove, side: f.signatureMove.side === "player" ? "enemy" : "player" }
            : f.signatureMove,
        playerStatus: f.enemyStatus,
        enemyStatus: f.playerStatus,
    };
}

/** BFS: returns the next tile to step onto when moving from `from` toward `to`, avoiding obstacles. */
function bfsNextStep(from: number, to: number, obstacles: ReadonlySet<number>): number {
    if (from === to) return from;
    const queue: number[] = [from];
    const parent = new Map<number, number>();
    parent.set(from, -1);
    while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === to) {
            let step = curr;
            while (parent.get(step) !== from) step = parent.get(step)!;
            return step;
        }
        const r = Math.floor(curr / PET_GRID_COLS), c = curr % PET_GRID_COLS;
        const ns: number[] = [];
        if (r > 0)              ns.push(curr - PET_GRID_COLS);
        if (r < PET_GRID_ROWS - 1) ns.push(curr + PET_GRID_COLS);
        if (c > 0)              ns.push(curr - 1);
        if (c < PET_GRID_COLS - 1) ns.push(curr + 1);
        for (const n of ns) {
            if (!parent.has(n) && !obstacles.has(n)) {
                parent.set(n, curr);
                queue.push(n);
            }
        }
    }
    return from; // no path — stay put
}

/** One retreat step: the adjacent non-obstacle tile that maximizes distance
 *  from `to` (kiting). Returns `from` if no neighbor opens more space. */
function bfsStepAway(from: number, to: number, obstacles: ReadonlySet<number>): number {
    const r = Math.floor(from / PET_GRID_COLS), c = from % PET_GRID_COLS;
    let best = from;
    let bestDist = tileDistance(from, to);
    const ns: number[] = [];
    if (r > 0)                 ns.push(from - PET_GRID_COLS);
    if (r < PET_GRID_ROWS - 1) ns.push(from + PET_GRID_COLS);
    if (c > 0)                 ns.push(from - 1);
    if (c < PET_GRID_COLS - 1) ns.push(from + 1);
    for (const n of ns) {
        if (obstacles.has(n) || n === to) continue;
        const d = tileDistance(n, to);
        if (d > bestDist) { bestDist = d; best = n; }
    }
    return best;
}

// Bresenham's line algorithm — walks the tiles between from/to and returns
// false if any intermediate tile is an obstacle. The from + to tiles
// themselves are NOT checked (actor isn't on an obstacle by construction,
// and the target tile isn't either). Adjacent tiles (Manhattan dist 1) are
// always in sight by definition.
function hasLineOfSight(from: number, to: number, obstacles: ReadonlySet<number>): boolean {
    if (from === to) return true;
    const x0 = from % PET_GRID_COLS;
    const y0 = Math.floor(from / PET_GRID_COLS);
    const x1 = to   % PET_GRID_COLS;
    const y1 = Math.floor(to   / PET_GRID_COLS);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;
    // Safety cap so a degenerate input can't infinite-loop.
    for (let steps = 0; steps < PET_GRID_SIZE; steps++) {
        if (x === x1 && y === y1) return true;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 <  dx) { err += dx; y += sy; }
        if (x === x1 && y === y1) return true;
        if (obstacles.has(y * PET_GRID_COLS + x)) return false;
    }
    return true;
}

// Does this jutsu kind need an unobstructed path to the target?
// Self / ally targets and adjacent basic attacks don't.
function petJutsuNeedsLineOfSight(kind: PetJutsu["kind"] | "basic"): boolean {
    if (kind === "buff" || kind === "heal" || kind === "move" || kind === "barrier" || kind === "shield" || kind === "absorb") return false;
    if (kind === "haste") return false;  // self-buff (Phase 12)
    if (kind === "basic") return false; // adjacent, no LOS issue
    return true;
}

function petJutsuInRange(
    kind: PetJutsu["kind"] | "basic",
    dist: number,
    // Optional positional context — when provided, ranged kinds also
    // require line-of-sight. AI callers pass these; legacy callers don't.
    fromPos?: number,
    toPos?: number,
    obstacles?: ReadonlySet<number>,
): boolean {
    let inRange: boolean;
    if (kind === "buff" || kind === "heal" || kind === "move" || kind === "barrier" || kind === "shield" || kind === "absorb" || kind === "haste") inRange = true;
    else if (kind === "dot" || kind === "movelock" || kind === "burn" || kind === "freeze" || kind === "confuse" || kind === "stun" || kind === "slow" || kind === "mark" || kind === "taunt" || kind === "pull") inRange = dist <= 4;
    else if (kind === "debuff") inRange = dist <= 3;
    // crush/wound/push are melee slams — closer range than plain debuff.
    else if (kind === "damage" || kind === "lifesteal" || kind === "crush" || kind === "wound" || kind === "push") inRange = dist <= 2;
    else inRange = dist <= 1; // basic attack
    if (!inRange) return false;
    // LOS check when caller supplied positional context.
    if (fromPos !== undefined && toPos !== undefined && obstacles && petJutsuNeedsLineOfSight(kind)) {
        return hasLineOfSight(fromPos, toPos, obstacles);
    }
    return true;
}

export function tileDistance(a: number, b: number): number {
    return Math.abs((a % PET_GRID_COLS) - (b % PET_GRID_COLS))
         + Math.abs(Math.floor(a / PET_GRID_COLS) - Math.floor(b / PET_GRID_COLS));
}


/**
 * Smart situational pet AI — replaces the old rule-list system.
 * Reads current HP, enemy HP, round number, trait, and available jutsus,
 * then returns the best jutsu to use this turn, "basic" for a melee attack, or null to move.
 *
 * Each trait has a distinct personality:
 *   Guardian  — sustain + debuff + heavy hits, heals often
 *   Aggressive — debuff opener ? spam fast ? nuke finisher, barely heals
 *   Swift      — debuff every chance, rapid chip damage, mobile
 *   Lucky      — opportunistic healer, unpredictable order
 *   Battleborn — mandatory early buff ? debuff ? finisher
 *   (none)     — balanced generalist
 */
// Estimate damage dealt this turn for lethal-detection. Mirrors applyDamage
// modifiers (dmgBonus, guardianBlock, absorbMult, elementMult) but skips
// Lucky-dodge (it's a coinflip — if it lands, it's lethal) and crit
// (treat as non-crit baseline; crit is a free upside). Returns 0 for
// non-damaging kinds (burn/freeze/etc don't kill this turn).
function estimatePetActionDamage(
    actor: PetBattleFighter,
    target: PetBattleFighter,
    action: PetJutsu | "basic",
): number {
    const dmgBonus     = actor.pet.trait === "Battleborn" ? 1.10 : 1.0;
    const guardianBlock = target.pet.trait === "Guardian"   ? 0.85 : 1.0;
    const elementMult  = petElementMultiplier(actor.pet, target.pet);
    const absorbMult   = target.absorbRounds > 0 ? (1 - target.absorbPercent) : 1;
    // Item-aware: fold in the same PVP-gear / consumable multipliers the real
    // hit uses so the AI's lethal-detection matches reality — it goes for the
    // kill when its Executioner's Talon makes the math work, and won't waste a
    // nuke into a foe's last-stand gear or Smoke Pellet. Crit is left out on
    // purpose (treated as a free upside, keeps "lethal" calls conservative).
    const executeMult   = petGearExecuteMult(actor.pet, target.hp, target.pet.hp);
    const lastStandMult = petGearLastStandMult(target.pet, target.hp, target.pet.hp);
    const mitigateMult  = (target.consMitigate ?? 0) > 0 ? (1 - (target.consMitigate ?? 0) / 100) : 1;
    // Base-action mods so lethal detection matches the real hit (Phases 7-8).
    const guardMult = target.guardRounds > 0 ? 0.6 : 1;
    const focusMult = actor.focusReady ? 1.3 : 1;
    const mods = dmgBonus * guardianBlock * absorbMult * elementMult * executeMult * lastStandMult * mitigateMult * guardMult * focusMult;
    if (action === "basic") {
        const raw = actor.pet.attack + actor.attackBuff - (target.pet.defense + target.defenseBuff) * 0.45;
        return Math.max(1, Math.floor(raw * mods));
    }
    const jutsu = action;
    if (jutsu.kind === "damage" || jutsu.kind === "lifesteal") {
        const raw = actor.pet.attack + actor.attackBuff + jutsu.power - (target.pet.defense + target.defenseBuff) * 0.5;
        return Math.max(1, Math.floor(raw * mods));
    }
    if (jutsu.kind === "crush") {
        // Crush damage component is power × 0.5 (the other half is the
        // ATK/DEF strip, which doesn't help with KO this turn).
        const raw = actor.pet.attack + actor.attackBuff + (jutsu.power * 0.5) - (target.pet.defense + target.defenseBuff) * 0.5;
        return Math.max(1, Math.floor(raw * mods));
    }
    return 0; // burn/freeze/confuse/stun/heal/buff/etc — no immediate damage
}

// Lethal-detection: returns the action that KOs the target this turn,
// preferring the smallest "overkill" so the AI saves bigger jutsus for
// later if a smaller one is enough. Returns null when no action lethals.
function findLethalAction(
    actor: PetBattleFighter,
    target: PetBattleFighter,
    avail: PetJutsu[],
    dist: number,
): PetJutsu | "basic" | null {
    // Can't actually KO this turn if the target holds a charged dodge (the next
    // hit is fully negated) or a Second Wind (survives any lethal blow at 1 HP).
    // Innate speed evasion is only a chance, so we still take the shot for that.
    if ((target.consDodge ?? 0) > 0 || (target.consEndure ?? 0) > 0) return null;
    const requiredHp = target.hp + target.shieldHp;
    const candidates: Array<{ action: PetJutsu | "basic"; dmg: number }> = [];
    for (const j of avail) {
        if (j.kind !== "damage" && j.kind !== "lifesteal" && j.kind !== "crush") continue;
        const dmg = estimatePetActionDamage(actor, target, j);
        if (dmg >= requiredHp) candidates.push({ action: j, dmg });
    }
    if (dist <= 1) {
        const basicDmg = estimatePetActionDamage(actor, target, "basic");
        if (basicDmg >= requiredHp) candidates.push({ action: "basic", dmg: basicDmg });
    }
    if (candidates.length === 0) return null;
    // Pick the smallest overkill — save the bigger hit for the next opponent.
    candidates.sort((a, b) => a.dmg - b.dmg);
    return candidates[0].action;
}

function choosePetActionSmart(
    actor: PetBattleFighter,
    target: PetBattleFighter,
    round: number,
    dist: number,
    // Optional obstacles set — when provided, the AI excludes ranged jutsus
    // that have no line-of-sight to the target. Without LOS the AI falls
    // through to movement (which already routes around obstacles via BFS),
    // so it naturally walks into a firing position.
    obstacles?: ReadonlySet<number>,
    // Base tactical actions (guard/evade/focus/brace) are 1v1-only for now; the
    // 2v2 party engine doesn't tick their state, so it opts out (default false).
    allowBaseActions = false,
): PetJutsu | "basic" | "guard" | "evade" | "focus" | "brace" | null {
    const hpPct     = (actor.hp / Math.max(1, actor.pet.hp)) * 100;
    const targetPct = (target.hp / Math.max(1, target.pet.hp)) * 100;
    const trait     = actor.pet.trait ?? "";

    // ── Status counter-play awareness ──────────────────────────────────
    // Skip statuses whose target trait fully resists them. Otherwise
    // we'd cast freeze on Swift (immune), 1-round stun on Aggressive
    // (shrugged off), confuse on Lucky (immune) — wasting cooldowns.
    function statusIsWorthwhile(jutsu: PetJutsu | undefined): jutsu is PetJutsu {
        if (!jutsu) return false;
        const targetTrait = target.pet.trait;
        if (jutsu.kind === "freeze"  && targetTrait === "Swift") return false;
        if (jutsu.kind === "confuse" && targetTrait === "Lucky") return false;
        if (jutsu.kind === "stun"    && targetTrait === "Aggressive" && (jutsu.rounds ?? 1) <= 1) return false;
        // burn vs Guardian: still half-damage, still useful — don't skip
        // crush vs Battleborn: half-strip, still useful (damage portion lands) — don't skip
        // Don't re-apply a status that's already active on the target.
        if (jutsu.kind === "burn"    && target.burnRounds    > 0) return false;
        if (jutsu.kind === "freeze"  && target.freezeRounds  > 0) return false;
        if (jutsu.kind === "confuse" && target.confuseRounds > 0) return false;
        if (jutsu.kind === "stun"    && target.stunRounds    > 0) return false;
        return true;
    }

    // Jutsus available this turn — off cooldown, in range, not the move jutsu.
    // When obstacles are provided, ranged jutsus also require line-of-sight
    // to the target (LOS check inside petJutsuInRange).
    const avail = actor.pet.jutsus.filter(j =>
        j.kind !== "move" &&
        (actor.cooldowns[j.name] ?? 0) <= 0 &&
        petJutsuInRange(j.kind, dist, actor.pos, target.pos, obstacles),
    );

    // ── Lethal detection (highest-priority pre-check) ───────────────────
    // If any damage/lifesteal/crush/basic action available this turn would
    // KO the target through their HP + shield, take it immediately. The
    // smallest-overkill option is preferred — save bigger hits for the
    // next opponent. Beats the entire trait-priority tree below because
    // a guaranteed KO is always the best play, regardless of personality.
    // `avail` is already LOS-filtered for ranged kinds, so any candidate
    // here can actually fire this turn.
    const lethal = findLethalAction(actor, target, avail, dist);
    if (lethal) return lethal;

    const heal      = avail.find(j => j.kind === "heal");
    const buff      = avail.find(j => j.kind === "buff");
    const debuff    = avail.find(j => j.kind === "debuff");
    const barrier   = avail.find(j => j.kind === "barrier");
    const shield    = avail.find(j => j.kind === "shield");
    const absorb    = avail.find(j => j.kind === "absorb");
    const lifesteal = avail.find(j => j.kind === "lifesteal");
    const movelock  = avail.find(j => j.kind === "movelock");
    const dot       = avail.find(j => j.kind === "dot");
    // New status kinds — gated through statusIsWorthwhile so the AI skips
    // them when the target's trait fully resists or the status already ticks.
    const rawBurn    = avail.find(j => j.kind === "burn");
    const rawFreeze  = avail.find(j => j.kind === "freeze");
    const rawConfuse = avail.find(j => j.kind === "confuse");
    const rawStun    = avail.find(j => j.kind === "stun");
    const burn    = statusIsWorthwhile(rawBurn)    ? rawBurn    : undefined;
    const freeze  = statusIsWorthwhile(rawFreeze)  ? rawFreeze  : undefined;
    const confuse = statusIsWorthwhile(rawConfuse) ? rawConfuse : undefined;
    const stun    = statusIsWorthwhile(rawStun)    ? rawStun    : undefined;
    // Crush is hybrid damage+debuff — always worth casting (the damage
    // portion lands even when Battleborn halves the strip).
    const crush   = avail.find(j => j.kind === "crush");
    // The pet's flagged signature move (its iconic crush/lifesteal jutsu). Used
    // to give it a deliberate priority slot below so the AI reaches for it when
    // it makes sense — not hoarded, not spammed — and the cut-in fires on it.
    const signature = avail.find(j => j.signature);

    // Pre-compute the strongest non-wasted disruption status for quick
    // priority slotting. Stun > Freeze ≈ Confuse > Burn (raw value order).
    const bestStatus = stun ?? freeze ?? confuse ?? burn;

    const dmgs   = avail.filter(j => j.kind === "damage").sort((a, b) => b.power - a.power);
    const heavy  = dmgs[0];                                                      // highest power
    const fast   = dmgs.find(j => j.cooldown <= 2) ?? dmgs[dmgs.length - 1];   // fastest cooldown
    const alreadyAbsorbing = actor.absorbRounds > 0;

    const critical       = hpPct     <= 25;
    const hurting        = hpPct     <= 50;
    const finishing      = targetPct <= 30;
    const earlyGame      = round     <= 3;
    const midGame        = round >= 4 && round <= 8;
    const alreadyBuffed  = actor.attackBuff > 0 || actor.defenseBuff > 0;
    const targetPoisoned = target.dotRounds > 0;

    // ── Phase 12 archetype kit moves (shared, 2v2 rule-list) ───────────────
    // Use the pet's identity moves when worthwhile — never re-applying a status
    // the foe already carries (the utility-AI "waste avoidance" principle). Each
    // applies once then falls through to the trait trees / damage below, so the
    // pet still mostly attacks.
    const hasteMv  = avail.find(j => j.kind === "haste");
    const woundMv  = avail.find(j => j.kind === "wound");
    const markMv   = avail.find(j => j.kind === "mark");
    const slowMv   = avail.find(j => j.kind === "slow");
    const tauntMv  = avail.find(j => j.kind === "taunt");
    const pushPull = avail.find(j => j.kind === "push" || j.kind === "pull");
    if (hasteMv && !alreadyBuffed && actor.hasteRounds <= 0)            return hasteMv;
    if (tauntMv && hpPct <= 65 && actor.pet.trait !== "Aggressive")     return tauntMv;
    if (woundMv && target.woundRounds <= 0 && !finishing)              return woundMv;
    if (slowMv && target.slowRounds <= 0)                              return slowMv;
    if (markMv && target.markedRounds <= 0 && !finishing)             return markMv;
    // Positioning-aware (avail is already range-filtered): pull yanks a spacing
    // foe into melee (anti-kite — pointless once adjacent); push shoves a
    // crowding foe away (peel). Each serves its archetype's range preference.
    if (pushPull && !finishing) {
        if (pushPull.kind === "pull" && dist >= 2) return pushPull;
        if (pushPull.kind === "push" && dist <= 2) return pushPull;
    }

    // ── Element matchup awareness ──────────────────────────────────────
    // If the actor is super-effective vs the target, prefer damage and crush
    // (they multiply through type chart). If resisted, lean on status pressure
    // and DoT — those bypass the multiplier and still chip the target down.
    const elementMult     = petElementMultiplier(actor.pet, target.pet);
    const superEffective  = elementMult > 1;
    const resisted        = elementMult < 1;

    // ── Base tactical actions (Phases 7-8) — a pet does NOT attack every turn.
    // Situational, and throttled by defensiveCd so the pet still mostly fights.
    // Sits BELOW lethal (above) so it never skips a guaranteed KO, and a brief
    // setup is only taken when it's clearly worth it.
    const canDefendWithJutsu = !!heal || !!barrier || !!shield || alreadyAbsorbing;
    if (allowBaseActions && actor.defensiveCd <= 0 && !finishing) {
        // Brace against a heavy hitter when wounded.
        if (actor.braceRounds <= 0 && hurting && target.pet.attack >= actor.pet.defense * 1.6) return "brace";
        // Guard when hurt with no defensive jutsu ready and the foe is in reach.
        if (actor.guardRounds <= 0 && critical && !canDefendWithJutsu && dist <= 2) return "guard";
        // Evade for nimble pets under pressure (the kite/Swift fantasy).
        if (actor.evadeRounds <= 0 && hurting && dist <= 2 && (trait === "Swift" || actor.pet.speed > target.pet.speed * 1.15)) return "evade";
        // Focus to load up when healthy but only holding a weak hit this turn
        // (no damage jutsu off-cooldown), so the next big move lands harder.
        if (!actor.focusReady && hpPct > 60 && !superEffective && dmgs.length === 0
            && actor.pet.jutsus.some(j => j.kind === "damage" || j.kind === "lifesteal" || j.kind === "crush") && dist <= 2) {
            return "focus";
        }
    }

    // ── PVP gear / consumable counter-play (every personality) ─────────────
    // These sit above the trait trees but below lethal + critical-survival
    // (the `!critical` guards defer to a trait's emergency heal).
    //
    // 1) The foe holds a charged dodge — its next hit is fully negated no
    //    matter what we throw. Spend a cheap basic to burn the charge instead
    //    of a real jutsu, then commit next turn.
    if ((target.consDodge ?? 0) > 0 && dist <= 1 && !critical) return "basic";
    // 2) Execute hunt — our gear (Executioner's Talon / Apex Predator Fang)
    //    deals bonus damage to low-HP foes and the target is in that window:
    //    slam the heaviest hit to cash it in.
    if (heavy && !critical && petGearExecuteMult(actor.pet, target.hp, target.pet.hp) > 1) return heavy;
    // 3) On-basic gear procs (Venomfang poison / Bloodthirster lifesteal) only
    //    fire on basic attacks, so weave one in when it's worth more than a
    //    jutsu this turn — otherwise the gear would never trigger.
    if (dist <= 1 && !critical && !finishing && !superEffective) {
        if (petGearDotOnHit(actor.pet) && target.dotRounds <= 0) return "basic";          // keep the foe poisoned
        if (petGearLifestealHeal(actor.pet, 100) > 0 && hpPct <= 55 && hpPct > 25) return "basic"; // drain to sustain
    }

    // ── Signature move (every personality) ─────────────────────────────────
    // The pet's iconic jutsu is a strong damage-with-effect move. Reach for it
    // when it's the right call: a super-effective matchup, pressing a wounded
    // foe, or as a mid-game offensive beat — but only when healthy enough to be
    // on the offensive (gated by !critical && !hurting so a wounded pet still
    // defends/heals via its trait tree first). It's in `avail`, so it's already
    // off-cooldown and in range; lethal is checked above, so this never robs a
    // guaranteed KO. This makes the AI deliberately showcase its signature
    // "when it makes sense" rather than only stumbling into it.
    if (signature && !critical && !hurting && (superEffective || finishing || midGame)) {
        return signature;
    }

    // -- GUARDIAN: outlast and wear down ---------------------------------------
    if (trait === "Guardian") {
        if (critical && heal)                        return heal;
        if (critical && barrier)                     return barrier;
        if (critical && shield)                      return shield;
        if (earlyGame && absorb && !alreadyAbsorbing) return absorb; // defensive opener
        if (earlyGame && buff && !alreadyBuffed)     return buff;
        // Element pivot — when damage matchup is bad, status pressure bypasses
        // the elemental resistance and chips the target down regardless.
        if (resisted && bestStatus && !finishing)    return bestStatus;
        if (burn && !targetPoisoned)                 return burn;    // stack burn early for chip pressure
        if (crush && dist <= 2)                      return crush;
        if (bestStatus)                              return bestStatus;
        if (debuff && !finishing && dist <= 3)       return debuff;
        if (movelock && !finishing && dist <= 4)     return movelock;
        if (hurting && heal)                         return heal;
        if (hurting && barrier)                      return barrier;
        if (hurting && shield)                       return shield;
        if (dot && !targetPoisoned)                  return dot;
        if (heavy)                                   return heavy;
        if (dist <= 1)                               return "basic";
        return null;
    }

    // -- AGGRESSIVE: status disruption → lifesteal sustain → nuke --------------
    if (trait === "Aggressive") {
        if (critical && heal)                        return heal;
        // If we're super-effective, skip the status setup — just hit hard.
        if (superEffective && heavy)                 return heavy;
        // If we're RESISTED, status pressure bypasses the multiplier — don't
        // waste the cooldown swinging 0.8× damage attacks. Bad-matchup
        // recognition for the offensive personalities, not just Default.
        if (resisted && bestStatus)                  return bestStatus;
        if (earlyGame && bestStatus)                 return bestStatus;
        if (earlyGame && crush && dist <= 2)         return crush;
        if (earlyGame && debuff)                     return debuff;
        if (earlyGame && movelock)                   return movelock;
        if (burn && !targetPoisoned)                 return burn;
        if (dot && !targetPoisoned)                  return dot;
        if (lifesteal && dist <= 2)                  return lifesteal; // drain to sustain aggression
        if (finishing && heavy)                      return heavy;
        if (fast)                                    return fast;
        if (heavy)                                   return heavy;
        if (dist <= 1)                               return "basic";
        return null;
    }

    // -- SWIFT: constant harassment, status every window -----------------------
    if (trait === "Swift") {
        if (critical && heal)                        return heal;
        if (critical && shield)                      return shield; // quick defensive dash
        if (superEffective && heavy)                 return heavy;  // capitalize on advantage
        if (resisted && bestStatus)                  return bestStatus; // bad matchup → pivot
        if (bestStatus)                              return bestStatus;
        if (crush && dist <= 2)                      return crush;
        if (debuff)                                  return debuff;
        if (movelock)                                return movelock;
        if (lifesteal && dist <= 2)                  return lifesteal; // drain on the move
        if (burn && !targetPoisoned)                 return burn;
        if (fast)                                    return fast;
        if (dot && !targetPoisoned)                  return dot;
        if (hurting && heal)                         return heal;
        if (heavy)                                   return heavy;
        if (dist <= 1)                               return "basic";
        return null;
    }

    // -- LUCKY: opportunistic, generous healer, slightly chaotic ---------------
    if (trait === "Lucky") {
        if (hurting && heal)                         return heal;
        if (hurting && barrier)                      return barrier;
        if (hurting && shield)                       return shield;
        if (superEffective && heavy)                 return heavy;
        if (resisted && bestStatus)                  return bestStatus; // bad matchup → pivot
        if (earlyGame && bestStatus)                 return bestStatus;
        if (earlyGame && crush && dist <= 2)         return crush;
        if (earlyGame && debuff)                     return debuff;
        if (earlyGame && movelock)                   return movelock;
        if (lifesteal && dist <= 2)                  return lifesteal; // lucky drain
        if (burn && !targetPoisoned)                 return burn;
        if (dot && !targetPoisoned)                  return dot;
        if (finishing && heavy)                      return heavy;
        if (fast)                                    return fast;
        if (heavy)                                   return heavy;
        if (dist <= 1)                               return "basic";
        return null;
    }

    // -- BATTLEBORN: front-load buff → absorb → status → finishers -------------
    if (trait === "Battleborn") {
        if (earlyGame && buff && !alreadyBuffed)     return buff;
        if (earlyGame && absorb && !alreadyAbsorbing) return absorb; // tanky opener
        if (superEffective && heavy)                 return heavy;
        if (resisted && bestStatus)                  return bestStatus; // bad matchup → pivot
        if (midGame && bestStatus)                   return bestStatus;
        if (midGame && crush && dist <= 2)           return crush;
        if (midGame && debuff)                       return debuff;
        if (midGame && movelock)                     return movelock;
        if (finishing && heavy)                      return heavy;
        if (lifesteal && dist <= 2)                  return lifesteal;
        if (burn && !targetPoisoned)                 return burn;
        if (dot && !targetPoisoned)                  return dot;
        if (fast)                                    return fast;
        if (critical && heal)                        return heal;
        if (critical && barrier)                     return barrier;
        if (heavy)                                   return heavy;
        if (dist <= 1)                               return "basic";
        return null;
    }

    // -- DEFAULT (no trait): balanced generalist -------------------------------
    if (critical && heal)                            return heal;
    if (critical && barrier)                         return barrier;
    if (critical && shield)                          return shield;
    if (earlyGame && buff && !alreadyBuffed)         return buff;
    if (earlyGame && absorb && !alreadyAbsorbing)    return absorb;
    if (superEffective && heavy)                     return heavy;
    if (earlyGame && bestStatus)                     return bestStatus;
    if (earlyGame && crush && dist <= 2)             return crush;
    if (earlyGame && debuff)                         return debuff;
    if (earlyGame && movelock)                       return movelock;
    if (hurting && heal)                             return heal;
    if (hurting && barrier)                          return barrier;
    if (burn && !targetPoisoned)                     return burn;
    if (dot && !targetPoisoned)                      return dot;
    if (lifesteal && dist <= 2)                      return lifesteal;
    if (movelock && dist <= 4)                       return movelock;
    if (resisted && bestStatus)                      return bestStatus; // pivot from damage when matchup is bad
    if (heavy)                                       return heavy;
    if (fast && fast !== heavy)                      return fast;
    if (dist <= 1)                                   return "basic";
    return null;
}

function petBasicDamage(attacker: PetBattleFighter, defender: PetBattleFighter) {
    return Math.max(1, Math.floor(attacker.pet.attack + attacker.attackBuff - (defender.pet.defense + defender.defenseBuff) * 0.45));
}

// ── Speed & swing helpers — make all four stats (HP/ATK/DEF/SPD) matter and
// keep pet battles dramatic. Every roll uses the battle's seeded RNG so synced
// (ranked) battles stay deterministic. ──────────────────────────────────────
export const PET_CRIT_MULT = 1.85; // a crit hits for nearly double — big, visible spikes

// Crit chance: a base rate, lifted by how much faster the attacker is than the
// defender (quick pets find openings), and by the Aggressive trait. Capped.
function petCritChance(attacker: PetBattleFighter, defender: PetBattleFighter): number {
    const base = attacker.pet.trait === "Aggressive" ? 0.32 : 0.16;
    const speedEdge = Math.max(0, attacker.pet.speed - defender.pet.speed) / 1100;
    return Math.min(0.5, base + speedEdge);
}

// Innate evasion: a defender meaningfully faster than the attacker slips some
// blows entirely. Separate from the Lucky trait and dodge consumables. Capped
// low so it adds "oh!" moments without feeling unfair.
function petEvadeChance(attacker: PetBattleFighter, defender: PetBattleFighter): number {
    return Math.min(0.18, Math.max(0, (defender.pet.speed - attacker.pet.speed) / 950));
}

// Per-hit damage roll (±12%) so no two strikes look identical.
function petDamageVariance(rng: () => number): number {
    return 0.88 + rng() * 0.24;
}

// Flurry: a faster pet gets bonus actions — the core reason to invest in Speed.
// Scales with the speed ratio for ANY pet; the Swift trait amplifies it.
//   ratio 1.5× → ~25% bonus-action chance, 2.0× → ~50%, Swift adds +25%.
function petFlurryChance(mySpeed: number, oppSpeed: number, swift: boolean): number {
    const ratio = mySpeed / Math.max(1, oppSpeed);
    let chance = Math.min(0.55, Math.max(0, (ratio - 1) * 0.5));
    if (swift) chance = Math.min(0.85, chance + 0.25);
    return chance;
}

// A pet's "signature" jutsu — its strongest damaging move. Using it triggers
// the anime cut-in. undefined when the pet has no real offensive jutsu.
function petSignatureJutsu(pet: Pet): string | undefined {
    // Prefer the explicitly-flagged signature move (every built-in pet gets one
    // via balanceBuiltInPetTemplate). This is what the cut-in announces.
    const flagged = pet.jutsus.find(j => j.signature);
    if (flagged) return flagged.name;
    // Fallback for creator/custom or pre-signature legacy pets that carry no
    // flag: treat their strongest damage-class move as the signature.
    let best: PetJutsu | undefined;
    for (const j of pet.jutsus) {
        if (j.kind !== "damage" && j.kind !== "crush" && j.kind !== "lifesteal") continue;
        if (!best || j.power > best.power) best = j;
    }
    return best && best.power > 0 ? best.name : undefined;
}

// Cinematic pacing — how long each replay frame should linger. Dramatic beats
// (KO, finisher, signature cut-in, clutch save, crit) breathe; routine actions
// snap by. Shared by every pet-battle replay loop.
export function petFramePace(f: PetArenaFrame | undefined): number {
    if (!f) return 1000;
    if (f.isPrefight) return 5000;                                       // pre-fight card: pets + ranked record, 5s
    if (f.actionKind === "result") return 2800;                          // final outcome
    if (f.isKO) return 2200;                                             // KO — slow-mo
    if (f.signatureMove) return 1800;                                   // cut-in dwell
    if (/endures at 1 HP|Lifeline heals/.test(f.message)) return 1700;  // clutch survival
    if (f.crit) return 1600;                                            // savor the crit
    if (/dodges|evades|blunts the blow/.test(f.message)) return 1150;   // a near-miss
    switch (f.actionKind) {
        case "damage":
        case "lifesteal": return 1100;
        case "debuff":
        case "heal":      return 950;
        case "movelock":  return 900;
        case "dot":       return 850;
        case "shield":
        case "barrier":
        case "absorb":    return 800;
        case "basic":     return 750;
        case "buff":      return 700;
        case "move":      return 600;
        default:          break;
    }
    if (f.traitFlash) return 1300;
    return 1000;
}

function seededPetBattleRandom(seed: number) {
    let state = Math.max(1, Math.floor(seed) >>> 0);
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

// Tie-break key kept as a helper for future pet-arena ordering work — unused
// at present but cheap to retain. Prefixed underscore silences the lint.
function _petBattleTieKey(pet: Pet) {
    return `${pet.speed}:${pet.id}:${pet.name}`;
}
void _petBattleTieKey;

// PET_ELEMENT_BEATS moved to ./constants/pet-arena.
function petElementMultiplier(attacker: Pet | undefined, defender: Pet | undefined): number {
    const a = attacker?.element;
    const d = defender?.element;
    if (!a || a === "None" || !d || d === "None") return 1;
    if (PET_ELEMENT_BEATS[a] === d) return 1.25;
    if (PET_ELEMENT_BEATS[d] === a) return 0.80;
    return 1;
}
function petElementLabel(mult: number): string {
    if (mult > 1) return "🔆 Super effective!";
    if (mult < 1) return "⛔ Not very effective…";
    return "";
}

export function runPetArenaBattle(playerPetIn: Pet, opponentPetIn: Pet, opponentOwner: string, seed = Date.now(), playerDamageMult = 1) {
    // Apply each pet's equipped PVP gear (stat modifiers) before the fight.
    // Driven by each pet's own loadout, so a synced battle stays deterministic.
    const playerPet = applyPetPvpGear(playerPetIn);
    const opponentPet = applyPetPvpGear(opponentPetIn);
    // Reactive battle-consumable charges (dodge / endure / thorns / lifeline /
    // cleanse). Read from each pet's loadout, so synced battles stay in sync.
    const playerCons = petConsumableCharges(playerPet);
    const enemyCons = petConsumableCharges(opponentPet);
    const rng = seededPetBattleRandom(seed);
    // 10×5 grid — player starts col 1 (tile 21), enemy starts col 8 (tile 28), distance = 7
    // Pick a random obstacle layout for this battle
    const layoutIndex = Math.floor(rng() * PET_OBSTACLE_LAYOUTS.length);
    const obstacleLayout = PET_OBSTACLE_LAYOUTS[layoutIndex];
    const obstacles = new Set<number>(obstacleLayout);
    // ── Tactical tile types (Phases 5-6) ────────────────────────────────────
    // Derive cover / hazard / healing / slow tiles DETERMINISTICALLY from the
    // chosen layout — consumes NO rng, so the existing roll sequence (initiative,
    // crits, flurries) is untouched and only the tile effects change outcomes.
    // `obstacles` (blocked ∪ cover) stays the full pathing-blocker set, so BFS
    // routing around the centre obstacles is unchanged. Cover reduces ranged
    // damage to an adjacent defender; hazard/healing tick at end of round; slow
    // tiles cut a mover's step count.
    const arenaTiles = buildArenaTiles(obstacleLayout, layoutIndex);
    const coverTiles = arenaTiles.cover;
    const hazardTiles = arenaTiles.hazard;
    const healingTiles = arenaTiles.healing;
    const slowTiles = arenaTiles.slow;
    // Central high ground (terrain depth) — holding it grants a round-end ward.
    const highGroundTiles = petHighGroundTiles(obstacles);
    // Power-pickup shrines (terrain depth) — claimed for a one-time surge. Mutable
    // (claimed shrines are removed); each frame carries the remaining set so the
    // renderer can draw + vanish them.
    const pickups = new Set<number>(petPickupTiles(obstacles));
    // Bushes / tall grass (terrain depth) — concealment grants a round-end evade.
    const bushTiles = petBushTiles(obstacles);
    // Compiled tile-type lookup for the scored AI (Phase 10).
    const arena = makeArena(arenaTiles.tiles);

    // 14×6 grid: player col 1 row 2 = tile 29; enemy col 12 row 2 = tile 40
    // Starting positions on the 14×7 grid: player col 1 row 3 (=43),
    // enemy col 12 row 3 (=54). Row 3 is the visual centre (row 0 = top
    // breathing-room row, row 6 = bottom).
    //
    // Defensive clamp: pet.hp can be undefined for custom/creator pets,
    // or for opponent pets that were stripped by an earlier roster
    // projection (now restored — but the clamp stays as belt-and-
    // suspenders). Without this, NaN propagates through the damage
    // pipeline and the KO check `fighter.hp <= 0` is never true,
    // looping the fight to the round cap with no resolution.
    const safeHp = (h: unknown): number => Math.max(1, Number(h) || 100);
    let player: PetBattleFighter = { owner: "You",        pet: playerPet,   hp: safeHp(playerPet.hp),   pos: 43, attackBuff: 0, defenseBuff: 0, cooldowns: {}, dotDamage: 0, dotRounds: 0, shieldHp: petGearStartShield(playerPet),   moveLocked: 0, absorbRounds: 0, absorbPercent: 0, burnRounds: 0, burnDamage: 0, freezeRounds: 0, confuseRounds: 0, stunRounds: 0, consDodge: playerCons.dodge, consMitigate: playerCons.mitigate, consEndure: playerCons.endure, consThorns: playerCons.thorns, consLifeline: playerCons.lifeline, consCleanse: playerCons.cleanse, guardRounds: 0, evadeRounds: 0, braceRounds: 0, focusReady: false, defensiveCd: 0, woundRounds: 0, woundDamage: 0, markedRounds: 0, slowRounds: 0, hasteRounds: 0, tauntedRounds: 0, tauntById: "" };
    let enemy:  PetBattleFighter = { owner: opponentOwner, pet: opponentPet, hp: safeHp(opponentPet.hp), pos: 54, attackBuff: 0, defenseBuff: 0, cooldowns: {}, dotDamage: 0, dotRounds: 0, shieldHp: petGearStartShield(opponentPet), moveLocked: 0, absorbRounds: 0, absorbPercent: 0, burnRounds: 0, burnDamage: 0, freezeRounds: 0, confuseRounds: 0, stunRounds: 0, consDodge: enemyCons.dodge, consMitigate: enemyCons.mitigate, consEndure: enemyCons.endure, consThorns: enemyCons.thorns, consLifeline: enemyCons.lifeline, consCleanse: enemyCons.cleanse, guardRounds: 0, evadeRounds: 0, braceRounds: 0, focusReady: false, defensiveCd: 0, woundRounds: 0, woundDamage: 0, markedRounds: 0, slowRounds: 0, hasteRounds: 0, tauntedRounds: 0, tauntById: "" };
    // One-time coin flip for first-move advantage, consistent with
    // PvP and tile-card duels. Previously this was decided every round
    // by raw speed comparison, which guaranteed the faster pet always
    // struck first (and made Speed a dual-purpose stat: initiative
    // + Swift bonus). Now: 50/50 random opener; speed only drives
    // Swift bonus actions (≥1.2× / 1.5× / 2.0× thresholds below).
    // Uses the seeded RNG so the result is deterministic per battle
    // seed — both clients in a synced battle see the same coin flip.
    const faster = player.pet.speed >= enemy.pet.speed ? player : enemy;
    const logs: string[] = [
        `${player.pet.name} enters against ${enemy.owner}'s ${enemy.pet.name}.`,
        `⚡ ${faster.pet.name} is quicker on its feet — speed will decide who strikes first.`,
    ];
    const frames: PetArenaFrame[] = [];
    let playerCombo = 0;
    let enemyCombo = 0;

    function pushFrame(
        round: number, message: string, actor: PetArenaFrame["actor"],
        actionKind?: PetArenaFrame["actionKind"], damage?: number, crit?: boolean,
        traitFlash?: PetArenaFrame["traitFlash"], combo?: number, isPrefight?: boolean, isKO?: boolean,
        signatureMove?: PetArenaFrame["signatureMove"],
    ) {
        const statusOf = (f: PetBattleFighter) => ({
            poisoned: f.dotRounds > 0 ? f.dotRounds : undefined,
            atkBuff: f.attackBuff > 0 || undefined,
            defBuff: f.defenseBuff > 0 || undefined,
            shield: f.shieldHp > 0 ? f.shieldHp : undefined,
            moveLocked: f.moveLocked > 0 || undefined,
            absorbing: f.absorbRounds > 0 || undefined,
            burn: f.burnRounds > 0 ? f.burnRounds : undefined,
            freeze: f.freezeRounds > 0 ? f.freezeRounds : undefined,
            confuse: f.confuseRounds > 0 ? f.confuseRounds : undefined,
            stun: f.stunRounds > 0 ? f.stunRounds : undefined,
            guarding: f.guardRounds > 0 || undefined,
            focused: f.focusReady || undefined,
            evading: f.evadeRounds > 0 || undefined,
            bracing: f.braceRounds > 0 || undefined,
            wound: f.woundRounds > 0 ? f.woundRounds : undefined,
            marked: f.markedRounds > 0 || undefined,
            slow: f.slowRounds > 0 ? f.slowRounds : undefined,
            haste: f.hasteRounds > 0 ? f.hasteRounds : undefined,
            taunted: f.tauntedRounds > 0 || undefined,
        });
        const playerStatus = statusOf(player);
        const enemyStatus  = statusOf(enemy);
        frames.push({ round, message, playerHp: player.hp, enemyHp: enemy.hp, playerPos: player.pos, enemyPos: enemy.pos, actor, actionKind, damage, crit, traitFlash, combo, isPrefight, isKO, signatureMove, playerStatus, enemyStatus, pickups: Array.from(pickups) });
    }

    // Pre-fight face-off frame
    pushFrame(0, `${player.pet.name} vs ${enemy.pet.name} — FIGHT!`, "system", undefined, undefined, undefined, undefined, undefined, true);
    pushFrame(0, logs[0], "system");

    function tick(fighter: PetBattleFighter): PetBattleFighter {
        return {
            ...fighter,
            attackBuff:   fighter.attackBuff  > 0 ? Math.max(0, fighter.attackBuff  - 1) : Math.min(0, fighter.attackBuff  + 1),
            defenseBuff:  fighter.defenseBuff > 0 ? Math.max(0, fighter.defenseBuff - 1) : Math.min(0, fighter.defenseBuff + 1),
            cooldowns:    Object.fromEntries(Object.entries(fighter.cooldowns).map(([name, value]) => [name, Math.max(0, value - 1)])),
            moveLocked:   Math.max(0, fighter.moveLocked   - 1),
            absorbRounds: Math.max(0, fighter.absorbRounds - 1),
            // burnRounds ticks in the round loop with the burn DoT (like wound), so
            // a 3-round burn deals 3 ticks — it was decremented here pre-apply = 2.
            freezeRounds: Math.max(0, fighter.freezeRounds - 1),
            confuseRounds:Math.max(0, fighter.confuseRounds - 1),
            stunRounds:   Math.max(0, fighter.stunRounds   - 1),
            guardRounds:  Math.max(0, fighter.guardRounds  - 1),
            evadeRounds:  Math.max(0, fighter.evadeRounds  - 1),
            braceRounds:  Math.max(0, fighter.braceRounds  - 1),
            defensiveCd:  Math.max(0, fighter.defensiveCd  - 1),
            markedRounds: Math.max(0, fighter.markedRounds - 1),
            slowRounds:   Math.max(0, fighter.slowRounds   - 1),
            hasteRounds:  Math.max(0, fighter.hasteRounds  - 1),
            tauntedRounds:Math.max(0, fighter.tauntedRounds - 1),
            // woundRounds ticks in the round loop (with the wound DoT), like burn.
        };
    }

    // Trait-based status resistance. Balanced so each trait gets ONE thematic
    // resistance, keeping total trait power roughly equal:
    //   Aggressive → resists stun  (it's too pissed off to be stunned)
    //   Guardian   → resists burn/DoT (defensive — half-damage from over-time)
    //   Swift      → immune to freeze (too fast to be frozen)
    //   Lucky      → immune to confuse self-hit
    //   Battleborn → halves stat-debuff durations
    function applyStatus(target: PetBattleFighter, status: "burn" | "freeze" | "confuse" | "stun", rounds: number, burnDmgIfBurn = 0): PetBattleFighter {
        const trait = target.pet.trait;
        if (status === "stun"    && trait === "Aggressive") rounds = Math.max(0, rounds - 1);
        if (status === "freeze"  && trait === "Swift") return target;        // immune
        if (status === "confuse" && trait === "Lucky") return target;        // immune
        if (rounds <= 0) return target;
        switch (status) {
            case "burn":    return { ...target, burnRounds: Math.max(target.burnRounds, rounds), burnDamage: Math.max(target.burnDamage, burnDmgIfBurn), attackBuff: target.attackBuff - 2 };
            case "freeze":  return { ...target, freezeRounds: Math.max(target.freezeRounds, rounds) };
            case "confuse": return { ...target, confuseRounds: Math.max(target.confuseRounds, rounds) };
            case "stun":    return { ...target, stunRounds: Math.max(target.stunRounds, rounds) };
        }
    }

    // ── Scored AI adapter (Phase 10) ────────────────────────────────────────
    // Projects the two fighters into a PetAiState, runs the pure scorer, and
    // maps the decision back to the engine's action union. Replaces the rule-list
    // in the 1v1 act(); deterministic (no rng), so ranked replays stay in sync.
    function fighterToActor(f: PetBattleFighter): PetBattleActor {
        const statuses: BattleStatus[] = [];
        if (f.moveLocked > 0)   statuses.push({ kind: "moveLock", rounds: f.moveLocked });
        if (f.stunRounds > 0)   statuses.push({ kind: "stun", rounds: f.stunRounds });
        if (f.freezeRounds > 0) statuses.push({ kind: "freeze", rounds: f.freezeRounds });
        if (f.dotRounds > 0)    statuses.push({ kind: "poison", rounds: f.dotRounds });
        if (f.burnRounds > 0)   statuses.push({ kind: "burn", rounds: f.burnRounds });
        if (f.shieldHp > 0)     statuses.push({ kind: "shield", rounds: 1, magnitude: f.shieldHp });
        // Phase-12 statuses → let the scorer avoid re-applying them (anti-waste).
        if (f.woundRounds > 0)  statuses.push({ kind: "wound", rounds: f.woundRounds });
        if (f.markedRounds > 0) statuses.push({ kind: "marked", rounds: f.markedRounds });
        if (f.slowRounds > 0)   statuses.push({ kind: "slow", rounds: f.slowRounds });
        if (f.hasteRounds > 0)  statuses.push({ kind: "haste", rounds: f.hasteRounds });
        const cooldowns: Record<string, number> = { __defensiveCd: f.defensiveCd };
        for (const j of f.pet.jutsus) cooldowns[jutsuToPetMove(j, f.pet).id] = f.cooldowns[j.name] ?? 0;
        return {
            id: f.owner === "You" ? "player" : "enemy",
            name: f.pet.name,
            hp: f.hp,
            maxHp: f.pet.hp,
            position: { row: Math.floor(f.pos / PET_GRID_COLS), col: f.pos % PET_GRID_COLS },
            archetype: petArchetypeFor(f.pet),
            statuses,
            cooldowns,
            // The scorer reads isCharging as "winding up a big hit" — Focus is our
            // current stand-in for a telegraphed charge.
            isCharging: f.focusReady || undefined,
        };
    }
    function petScoredDecision(
        actor: PetBattleFighter, target: PetBattleFighter, round: number,
    ): PetJutsu | "basic" | "guard" | "evade" | "focus" | "brace" | "retreat" | null {
        const a = fighterToActor(actor);
        const t = fighterToActor(target);
        // Both actors get distinct ids by side; the acting side is "player" only
        // when it actually is the player — otherwise relabel so the scorer's
        // nearest-enemy logic is correct regardless of who's acting.
        const aId = actor.owner === "You" ? "player" : "enemy";
        const tId = aId === "player" ? "enemy" : "player";
        a.id = aId; t.id = tId;
        const state: PetAiState = {
            actors: [a, t],
            teamOf: { [aId]: aId === "player" ? "player" : "enemy", [tId]: tId === "player" ? "player" : "enemy" },
            movesByActor: { [aId]: petMoveset(actor.pet), [tId]: petMoveset(target.pet) },
            statsByActor: {
                [aId]: { attack: actor.pet.attack + actor.attackBuff, defense: actor.pet.defense + actor.defenseBuff, speed: actor.pet.speed },
                [tId]: { attack: target.pet.attack + target.attackBuff, defense: target.pet.defense + target.defenseBuff, speed: target.pet.speed },
            },
            arena,
            round,
        };
        const decision = choosePetAction(state, aId);
        switch (decision.action) {
            case "basicAttack": return "basic";
            case "guard": case "evade": case "focus": case "brace": return decision.action;
            case "move": return decision.moveDir === "away" ? "retreat" : null;
            case "useMove": {
                const jutsu = actor.pet.jutsus.find(j => jutsuToPetMove(j, actor.pet).id === decision.moveId);
                return jutsu ?? null;
            }
            default: return null;
        }
    }

    function act(actor: PetBattleFighter, target: PetBattleFighter, round: number): [PetBattleFighter, PetBattleFighter] {
        const dist      = tileDistance(actor.pos, target.pos);
        const actorSide: PetArenaFrame["actor"] = actor.owner === "You" ? "player" : "enemy";
        const targetSide: PetArenaFrame["actor"] = actorSide === "player" ? "enemy" : "player";
        const isFinisher = target.hp < target.pet.hp * 0.25;

        // ── Pre-action status checks ───────────────────────────────────
        // Stun: full skip, no choice. Decremented by tick() at round start
        // so a stun applied last round is still active this turn.
        if (actor.stunRounds > 0) {
            const msg = `Round ${round}: ${actor.pet.name} is stunned — turn skipped.`;
            logs.push(msg);
            pushFrame(round, msg, actorSide, "movelock");
            return [actor, target];
        }
        // Freeze: 50% chance to skip each round.
        if (actor.freezeRounds > 0 && rng() < 0.5) {
            const msg = `Round ${round}: ${actor.pet.name} is frozen solid — turn skipped.`;
            logs.push(msg);
            pushFrame(round, msg, actorSide, "movelock");
            return [actor, target];
        }
        // Confuse: 50% chance to hit yourself for a small amount.
        if (actor.confuseRounds > 0 && rng() < 0.5) {
            const selfHit = Math.max(1, Math.floor(actor.pet.attack * 0.4));
            const hurtSelf = { ...actor, hp: Math.max(0, actor.hp - selfHit) };
            const msg = `Round ${round}: ${actor.pet.name} is confused and hits itself for ${selfHit}!`;
            logs.push(msg);
            if (actorSide === "player") player = hurtSelf; else enemy = hurtSelf;
            pushFrame(round, msg, actorSide, "damage", selfHit);
            return [hurtSelf, target];
        }

        // Trait modifiers
        const dmgBonus       = actor.pet.trait === "Battleborn"  ? 1.10 : 1.0;
        const guardianBlock  = target.pet.trait === "Guardian"   ? 0.85 : 1.0;
        const luckyDodgeRoll = target.pet.trait === "Lucky" && rng() < 0.10;

        function doMove(reason: string): [PetBattleFighter, PetBattleFighter] {
            // Movement step count: slow tiles (Phase 5-6) and the Slow status
            // (Phase 12) each cut a step; Haste (Phase 12) adds one. Min 1.
            const baseSteps = actor.pet.moveRange ?? 2;
            const stepMod = (slowTiles.has(actor.pos) ? -1 : 0) + (actor.slowRounds > 0 ? -1 : 0) + (actor.hasteRounds > 0 ? 1 : 0);
            const steps = Math.max(1, baseSteps + stepMod);
            // Detour to grab an un-claimed power shrine if one is on the way.
            const goal = petShrineSeekGoal(actor.pos, target.pos, pickups);
            let newPos = actor.pos;
            for (let s = 0; s < steps; s++) {
                const next = bfsNextStep(newPos, goal, obstacles);
                if (next === newPos || next === goal || next === target.pos) break; // arrived / wall / would collide
                newPos = next;
            }
            const moved  = { ...actor, pos: newPos };
            const msg = `Round ${round}: ${actor.pet.name} ${reason}`;
            logs.push(msg);
            if (actorSide === "player") player = moved; else enemy = moved;
            pushFrame(round, msg, actorSide, "move");
            return [moved, target];
        }

        function applyDamage(base: number, jutsuName: string, kind: "damage" | "basic", actor2: PetBattleFighter, target2: PetBattleFighter): [PetBattleFighter, PetBattleFighter] {
            if (luckyDodgeRoll) {
                if (actorSide === "player") playerCombo = 0; else enemyCombo = 0;
                const msg = `Round ${round}: ${target2.pet.name}'s Lucky instinct lets it dodge ${actor2.pet.name}'s attack!`;
                logs.push(msg);
                pushFrame(round, msg, targetSide, kind, undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "Lucky" });
                return [actor2, target2];
            }
            // Consumable: Phantom Charm / Evasion Draught — a charged dodge that
            // fully negates the incoming attack, then ticks down.
            if ((target2.consDodge ?? 0) > 0) {
                if (actorSide === "player") playerCombo = 0; else enemyCombo = 0;
                const dodged = { ...target2, consDodge: (target2.consDodge ?? 0) - 1 };
                const left = dodged.consDodge ?? 0;
                const msg = `Round ${round}: ${target2.pet.name} slips aside and dodges ${actor2.pet.name}'s attack!${left > 0 ? ` (${left} dodge${left === 1 ? "" : "s"} left)` : ""}`;
                logs.push(msg);
                pushFrame(round, msg, targetSide, kind, undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "consumDodge" });
                return [actor2, dodged];
            }
            // Innate speed evasion — a faster defender slips the blow entirely.
            // The Evade base action adds a flat +25% while active (Phases 7-8).
            const evadeBonus = (target2.evadeRounds > 0 ? 0.25 : 0) + (target2.hasteRounds > 0 ? 0.12 : 0) - (target2.slowRounds > 0 ? 0.1 : 0);
            if (rng() < petEvadeChance(actor2, target2) + evadeBonus) {
                if (actorSide === "player") playerCombo = 0; else enemyCombo = 0;
                const msg = `Round ${round}: ${target2.pet.name} blurs out of reach — evades ${actor2.pet.name}'s attack!`;
                logs.push(msg);
                pushFrame(round, msg, targetSide, kind, undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "petEvade" });
                return [actor2, target2];
            }
            const crit     = rng() < petCritChance(actor2, target2);
            const variance = petDamageVariance(rng);
            // Absorb stance reduces incoming damage by absorbPercent
            const absorbMult = target2.absorbRounds > 0 ? (1 - target2.absorbPercent) : 1;
            // Pet Tamer profession: +5–20% pet damage in PvE (player's pet only).
            // Multiplier is computed at the call site and passed in via runPetArenaBattle.
            const tamerMult = actorSide === "player" ? playerDamageMult : 1;
            // Element type effectiveness — Fire > Wind > Lightning > Earth > Water > Fire.
            // Neutral if either pet has no element. Applies to all damage jutsus equally.
            const elementMult = petElementMultiplier(actor2.pet, target2.pet);
            // PVP gear: attacker's execute bonus vs a low-HP foe, and the
            // target's last-stand damage reduction while it is low. Both read
            // from each pet's own loadout, so synced battles stay deterministic.
            const executeMult  = petGearExecuteMult(actor2.pet, target2.hp, target2.pet.hp);
            const lastStandMult = petGearLastStandMult(target2.pet, target2.hp, target2.pet.hp);
            // Consumable: Smoke Pellet — the next hit deals less damage (spent below).
            const mitigateMult = (target2.consMitigate ?? 0) > 0 ? (1 - (target2.consMitigate ?? 0) / 100) : 1;
            // Tactical cover (Phases 5-6): a RANGED hit (attacker not adjacent)
            // against a defender hugging a cover tile lands for 30% less. Melee
            // (dist ≤ 1) ignores cover. Deterministic — no rng.
            const defenderBehindCover = dist > 1 && isAdjacentToAny(target2.pos, coverTiles);
            const coverMult = defenderBehindCover ? 0.7 : 1;
            // Base-action modifiers (Phases 7-8): Guard cuts incoming 40%; Brace
            // softens a crit; Focus powers up the attacker's strike (then spent).
            const guardMult = target2.guardRounds > 0 ? 0.6 : 1;
            const critMult = crit ? (target2.braceRounds > 0 ? 1.35 : PET_CRIT_MULT) : 1;
            const focusMult = actor2.focusReady ? 1.3 : 1;
            // Mark (Phase 12): the marked target's next damage hit lands harder.
            const markMult = target2.markedRounds > 0 ? 1.3 : 1;
            const damage = Math.max(1, Math.floor(base * critMult * variance * dmgBonus * guardianBlock * absorbMult * tamerMult * elementMult * executeMult * lastStandMult * mitigateMult * coverMult * guardMult * focusMult * markMult));
            // Shield absorbs damage before HP
            const shieldAbsorb  = Math.min(target2.shieldHp, damage);
            const remainDamage  = damage - shieldAbsorb;
            const damagedTarget = { ...target2, hp: Math.max(0, target2.hp - remainDamage), shieldHp: target2.shieldHp - shieldAbsorb };
            // PVP gear procs on a landed basic attack: poison-on-hit + lifesteal.
            let procActor = actor2;
            let procTarget = damagedTarget;
            let procNote = "";
            let consFlash: string | undefined; // banner key for a consumable proc
            // Focus is consumed by the strike it empowers.
            if (actor2.focusReady) { procActor = { ...procActor, focusReady: false }; procNote += " 🎯 Focused strike!"; }
            if (guardMult < 1) procNote += " 🛡️ Guarded!";
            // Mark is spent the moment it amplifies a hit.
            if (markMult > 1) { procTarget = { ...procTarget, markedRounds: 0 }; procNote += " 🔻 Marked!"; }
            if (kind === "basic" && remainDamage > 0) {
                const dot = petGearDotOnHit(actor2.pet);
                if (dot) { procTarget = { ...procTarget, dotDamage: dot.damage, dotRounds: dot.rounds }; procNote += " ☠️ Poisoned!"; }
                const lsHeal = petGearLifestealHeal(actor2.pet, damage);
                if (lsHeal > 0) { procActor = { ...procActor, hp: Math.min(procActor.pet.hp, procActor.hp + lsHeal) }; procNote += ` 🩸 +${lsHeal} HP`; }
            }
            // Reactive battle-consumable triggers on the defender (target2).
            // Smoke Pellet — the mitigation applied above is now spent.
            if (mitigateMult < 1) {
                procTarget = { ...procTarget, consMitigate: 0 };
                procNote += ` 💨 ${target2.pet.name} blunts the blow!`;
                consFlash = "consumBlock";
            }
            // Thornmail Oil — reflect a cut of the hit back at the attacker.
            if ((target2.consThorns ?? 0) > 0 && remainDamage > 0) {
                const reflect = Math.max(1, Math.floor(damage * (target2.consThorns ?? 0) / 100));
                procActor = { ...procActor, hp: Math.max(0, procActor.hp - reflect) };
                procTarget = { ...procTarget, consThorns: 0 };
                procNote += ` 🌵 ${target2.pet.name} reflects ${reflect}!`;
                consFlash = "consumReflect";
            }
            // Second Wind — survive an otherwise-lethal blow at 1 HP.
            if (procTarget.hp <= 0 && (procTarget.consEndure ?? 0) > 0) {
                procTarget = { ...procTarget, hp: 1, consEndure: (procTarget.consEndure ?? 0) - 1 };
                procNote += ` 💪 ${procTarget.pet.name} endures at 1 HP!`;
                consFlash = "consumEndure";
            }
            // Lifeline Elixir — first dip below the threshold instantly heals.
            const lifelineMax = target2.pet.hp;
            if ((procTarget.consLifeline ?? 0) > 0 && procTarget.hp > 0
                && (procTarget.hp / lifelineMax) * 100 < PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT
                && (target2.hp / lifelineMax) * 100 >= PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT) {
                const heal = Math.max(1, Math.floor(lifelineMax * (procTarget.consLifeline ?? 0) / 100));
                procTarget = { ...procTarget, hp: Math.min(lifelineMax, procTarget.hp + heal), consLifeline: 0 };
                procNote += ` ✨ Lifeline heals ${heal}!`;
                consFlash = "consumLifeline";
            }
            // Combo tracking
            if (actorSide === "player") { playerCombo++; enemyCombo = 0; } else { enemyCombo++; playerCombo = 0; }
            const currentCombo = actorSide === "player" ? playerCombo : enemyCombo;
            // Trait flash selection — a consumable proc on the defender takes
            // priority over trait flashes so the player sees the item fire.
            const traitFlash: PetArenaFrame["traitFlash"] =
                consFlash                                   ? { actor: targetSide as "player" | "enemy", trait: consFlash } :
                (guardMult < 1)                             ? { actor: targetSide as "player" | "enemy", trait: "guardBlock" } :
                (crit && actor2.pet.trait === "Aggressive") ? { actor: actorSide as "player" | "enemy", trait: "Aggressive" } :
                (guardianBlock < 1)                         ? { actor: targetSide as "player" | "enemy", trait: "Guardian"   } :
                (dmgBonus > 1 && actor2.pet.trait === "Battleborn") ? { actor: actorSide as "player" | "enemy", trait: "Battleborn" } :
                undefined;
            const elementNote = petElementLabel(elementMult);
            const coverNote = defenderBehindCover ? " 🧱 Behind cover!" : "";
            // Signature cut-in when this jutsu is the actor's strongest move.
            const sigMove: PetArenaFrame["signatureMove"] = (jutsuName && jutsuName === petSignatureJutsu(actor2.pet))
                ? { name: jutsuName, petName: actor2.pet.name, side: actorSide as "player" | "enemy", flagship: actor2.pet.rarity === "mythic" }
                : undefined;
            const msg = `Round ${round}: ${actor2.pet.name}${jutsuName ? ` uses ${jutsuName}` : " basic attacks"} for ${damage} damage${crit ? " — CRITICAL HIT!" : ""}${elementNote ? ` ${elementNote}` : ""}${coverNote}${procNote}.`;
            logs.push(msg);
            if (actorSide === "player") { player = procActor; enemy = procTarget; } else { enemy = procActor; player = procTarget; }
            pushFrame(round, msg, actorSide, kind, damage, crit, traitFlash, currentCombo >= 3 ? currentCombo : undefined, undefined, undefined, sigMove);
            // KO frame
            if (procTarget.hp <= 0) {
                const koMsg = `💥 K.O.! ${actor2.pet.name} knocks out ${target2.pet.name}!`;
                logs.push(koMsg);
                pushFrame(round, koMsg, actorSide, "result", undefined, undefined, undefined, undefined, undefined, true);
            }
            return [procActor, procTarget];
        }

        // Finisher mode: close the gap aggressively when target is near death.
        // A movement-locked (rooted) pet cannot advance even to finish a low-HP
        // foe — fall through to the scored decision (which has its own movelock
        // handling) instead of silently breaking the root via doMove().
        if (isFinisher && dist > 2 && actor.moveLocked <= 0) {
            return doMove("lunges in for the kill!");
        }

        // Scored AI decision (Phase 10) — a pure, archetype-weighted scorer over
        // distance / range / HP / cooldowns / statuses / charging / cover /
        // melee-vs-ranged. Replaces the old rule-list for 1v1. Returns a jutsu,
        // "basic", a base action, "retreat" (kite back), or null (advance).
        const chosen = petScoredDecision(actor, target, round);

        if (chosen === "basic") {
            return applyDamage(petBasicDamage(actor, target), "", "basic", actor, target);
        }

        // Retreat — a nimble/ranged pet kites away from the foe (Phase 10).
        if (chosen === "retreat") {
            if (actor.moveLocked > 0) {
                const msg = `Round ${round}: ${actor.pet.name} is rooted and cannot retreat!`;
                logs.push(msg); pushFrame(round, msg, actorSide, "movelock");
                return [actor, target];
            }
            const steps = slowTiles.has(actor.pos) ? 1 : 2;
            let newPos = actor.pos;
            for (let s = 0; s < steps; s++) {
                const next = bfsStepAway(newPos, target.pos, obstacles);
                if (next === newPos) break;
                newPos = next;
            }
            const moved = { ...actor, pos: newPos };
            const msg = `Round ${round}: ${actor.pet.name} kites back, keeping its distance.`;
            logs.push(msg);
            if (actorSide === "player") player = moved; else enemy = moved;
            pushFrame(round, msg, actorSide, "move");
            return [moved, target];
        }

        // ── Base tactical actions (Phases 7-8) — the pet sets up instead of
        // attacking this turn. Each marks defensiveCd so it stays occasional.
        if (chosen === "guard" || chosen === "evade" || chosen === "focus" || chosen === "brace") {
            const setup: Record<string, Partial<PetBattleFighter> & { msg: string; kind: PetArenaFrame["actionKind"] }> = {
                guard: { guardRounds: 1, msg: `${actor.pet.name} raises its guard — incoming damage cut.`,          kind: "barrier" },
                evade: { evadeRounds: 1, msg: `${actor.pet.name} reads the foe, ready to slip the next blow.`,        kind: "buff" },
                focus: { focusReady: true, msg: `${actor.pet.name} focuses — its next strike will hit harder.`,       kind: "buff" },
                brace: { braceRounds: 1, msg: `${actor.pet.name} braces — shrugging off knockback and crits.`,         kind: "absorb" },
            };
            const s = setup[chosen];
            const acted = { ...actor, ...s, defensiveCd: 3 } as PetBattleFighter;
            logs.push(`Round ${round}: ${s.msg}`);
            if (actorSide === "player") player = acted; else enemy = acted;
            pushFrame(round, `Round ${round}: ${s.msg}`, actorSide, s.kind);
            return [acted, target];
        }

        if (chosen) {
            const jutsu = chosen;
            const nextActor = { ...actor, cooldowns: { ...actor.cooldowns, [jutsu.name]: Math.max(1, jutsu.cooldown) } };

            if (jutsu.kind === "buff") {
                const atkGain = Math.max(1, Math.floor(jutsu.power / 2));
                const defGain = Math.max(1, Math.floor(jutsu.power / 3));
                const buffed  = { ...nextActor, attackBuff: nextActor.attackBuff + atkGain, defenseBuff: nextActor.defenseBuff + defGain };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, gaining +${atkGain} ATK and +${defGain} DEF.`;
                logs.push(msg);
                if (actorSide === "player") player = buffed; else enemy = buffed;
                pushFrame(round, msg, actorSide, "buff");
                return [buffed, target];
            }

            if (jutsu.kind === "heal") {
                // Wound (Phase 12) halves healing the wounded pet receives.
                const woundCut = nextActor.woundRounds > 0 ? 0.5 : 1;
                const healAmt = Math.max(1, Math.floor(jutsu.power * 0.6 * woundCut));
                const healed  = { ...nextActor, hp: Math.min(nextActor.pet.hp, nextActor.hp + healAmt) };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, restoring ${healAmt} HP${woundCut < 1 ? " (halved — wounded)" : ""}.`;
                logs.push(msg);
                if (actorSide === "player") player = healed; else enemy = healed;
                pushFrame(round, msg, actorSide, "heal");
                return [healed, target];
            }

            if (jutsu.kind === "barrier") {
                const shieldAmt = Math.max(10, Math.floor(jutsu.power * 0.7));
                const shielded  = { ...nextActor, shieldHp: nextActor.shieldHp + shieldAmt };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, raising a barrier absorbing ${shieldAmt} damage!`;
                logs.push(msg);
                if (actorSide === "player") player = shielded; else enemy = shielded;
                pushFrame(round, msg, actorSide, "barrier");
                return [shielded, target];
            }

            if (jutsu.kind === "movelock") {
                const lockRounds = 2;
                const locked = { ...target, moveLocked: target.moveLocked + lockRounds };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name} — ${target.pet.name} is movement-locked for ${lockRounds} rounds!`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = locked; } else { enemy = nextActor; player = locked; }
                pushFrame(round, msg, actorSide, "movelock");
                return [nextActor, locked];
            }

            if (jutsu.kind === "debuff") {
                // Battleborn trait halves stat-debuff magnitude (its thematic resistance).
                const battlebornCut = target.pet.trait === "Battleborn" ? 0.5 : 1;
                const atkCut   = Math.max(1, Math.floor((jutsu.power / 4) * battlebornCut));
                const defCut   = Math.max(1, Math.floor((jutsu.power / 5) * battlebornCut));
                const weakened = { ...target, attackBuff: target.attackBuff - atkCut, defenseBuff: target.defenseBuff - defCut };
                const battlebornNote = target.pet.trait === "Battleborn" ? " (Battleborn shrugs off half the debuff.)" : "";
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name} — ${target.pet.name} loses ${atkCut} ATK and ${defCut} DEF.${battlebornNote}`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = weakened; } else { enemy = nextActor; player = weakened; }
                pushFrame(round, msg, actorSide, "debuff");
                return [nextActor, weakened];
            }

            if (jutsu.kind === "dot") {
                // Guardian halves DoT damage (its thematic resistance — applies to
                // both poison and burn so the resistance is consistent).
                const baseDot = Math.max(1, Math.floor(jutsu.power * 0.28));
                const dotDmg  = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(baseDot * 0.5)) : baseDot;
                const poisoned = { ...target, dotDamage: dotDmg, dotRounds: 3 };
                const guardianNote = target.pet.trait === "Guardian" ? " (Guardian halves the poison.)" : "";
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, poisoning ${target.pet.name} for ${dotDmg}/round (3 rounds).${guardianNote}`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = poisoned; } else { enemy = nextActor; player = poisoned; }
                pushFrame(round, msg, actorSide, "dot");
                return [nextActor, poisoned];
            }

            if (jutsu.kind === "shield") {
                const shieldAmt = Math.max(5, Math.floor(jutsu.power * 0.45));
                const shielded  = { ...nextActor, shieldHp: nextActor.shieldHp + shieldAmt };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name}, forming a ward that absorbs ${shieldAmt} damage!`;
                logs.push(msg);
                if (actorSide === "player") player = shielded; else enemy = shielded;
                pushFrame(round, msg, actorSide, "shield");
                return [shielded, target];
            }

            if (jutsu.kind === "absorb") {
                const rounds  = 3;
                const pct     = 0.35;
                const absorbed = { ...nextActor, absorbRounds: rounds, absorbPercent: pct };
                const msg = `Round ${round}: ${actor.pet.name} uses ${jutsu.name} — entering absorb stance for ${rounds} rounds (35% damage reduction)!`;
                logs.push(msg);
                if (actorSide === "player") player = absorbed; else enemy = absorbed;
                pushFrame(round, msg, actorSide, "absorb");
                return [absorbed, target];
            }

            if (jutsu.kind === "burn") {
                const burnDmg = Math.max(1, Math.floor(jutsu.power * 0.15));
                // Guardian halves DoT damage (its thematic resistance).
                const effectiveBurn = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(burnDmg * 0.5)) : burnDmg;
                const burnRoundsToApply = Math.max(1, jutsu.rounds ?? 3);
                const burned = applyStatus(target, "burn", burnRoundsToApply, effectiveBurn);
                const msg = `Round ${round}: ${actor.pet.name} burns ${target.pet.name} for ${effectiveBurn}/round (${burnRoundsToApply} rounds) — −2 ATK!${target.pet.trait === "Guardian" ? " (Guardian shrugs off half the burn.)" : ""}`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = burned; } else { enemy = nextActor; player = burned; }
                pushFrame(round, msg, actorSide, "dot");
                return [nextActor, burned];
            }

            if (jutsu.kind === "freeze") {
                if (target.pet.trait === "Swift") {
                    const msg = `Round ${round}: ${actor.pet.name} tries to freeze ${target.pet.name}, but Swift speed shakes off the ice!`;
                    logs.push(msg);
                    if (actorSide === "player") { player = nextActor; } else { enemy = nextActor; }
                    pushFrame(round, msg, targetSide, "buff", undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "Swift" });
                    return [nextActor, target];
                }
                const freezeRoundsToApply = Math.max(1, jutsu.rounds ?? 2);
                const frozen = applyStatus(target, "freeze", freezeRoundsToApply);
                const msg = `Round ${round}: ${actor.pet.name} freezes ${target.pet.name} — 50% chance to skip turn for ${freezeRoundsToApply} round${freezeRoundsToApply === 1 ? "" : "s"}!`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = frozen; } else { enemy = nextActor; player = frozen; }
                pushFrame(round, msg, actorSide, "movelock");
                return [nextActor, frozen];
            }

            if (jutsu.kind === "confuse") {
                if (target.pet.trait === "Lucky") {
                    const msg = `Round ${round}: ${actor.pet.name} tries to confuse ${target.pet.name}, but Lucky instinct sees through it!`;
                    logs.push(msg);
                    if (actorSide === "player") { player = nextActor; } else { enemy = nextActor; }
                    pushFrame(round, msg, targetSide, "buff", undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "Lucky" });
                    return [nextActor, target];
                }
                const confuseRoundsToApply = Math.max(1, jutsu.rounds ?? 2);
                const confused = applyStatus(target, "confuse", confuseRoundsToApply);
                const msg = `Round ${round}: ${actor.pet.name} confuses ${target.pet.name} — 50% chance to self-hit for ${confuseRoundsToApply} round${confuseRoundsToApply === 1 ? "" : "s"}!`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = confused; } else { enemy = nextActor; player = confused; }
                pushFrame(round, msg, actorSide, "debuff");
                return [nextActor, confused];
            }

            if (jutsu.kind === "stun") {
                // Aggressive trait shrugs off one round of stun (so 1-round stuns are no-ops).
                const baseRounds = Math.max(1, jutsu.rounds ?? 1);
                const reduced = target.pet.trait === "Aggressive" ? baseRounds - 1 : baseRounds;
                if (reduced <= 0) {
                    const msg = `Round ${round}: ${actor.pet.name} tries to stun ${target.pet.name}, but Aggressive rage shrugs it off!`;
                    logs.push(msg);
                    if (actorSide === "player") { player = nextActor; } else { enemy = nextActor; }
                    pushFrame(round, msg, targetSide, "buff", undefined, undefined, { actor: targetSide as "player" | "enemy", trait: "Aggressive" });
                    return [nextActor, target];
                }
                const stunned = applyStatus(target, "stun", reduced);
                const msg = `Round ${round}: ${actor.pet.name} stuns ${target.pet.name} — skips next ${reduced} turn(s)!`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = stunned; } else { enemy = nextActor; player = stunned; }
                pushFrame(round, msg, actorSide, "movelock");
                return [nextActor, stunned];
            }

            if (jutsu.kind === "crush") {
                // Earth special — hybrid jutsu: deals real damage AND strips
                // larger ATK/DEF than a plain debuff. Damage portion uses
                // ~50% of jutsu power (so it's not as strong as a pure
                // damage jutsu of the same number), and the strip is
                // significantly larger to compensate.
                // Battleborn halves the debuff portion (its thematic resist)
                // but doesn't reduce the damage component, keeping Battleborn
                // a partial counter — not a full immunity.
                const battlebornCut = target.pet.trait === "Battleborn" ? 0.5 : 1;
                const atkCut = Math.max(1, Math.floor((jutsu.power / 3) * battlebornCut));
                const defCut = Math.max(1, Math.floor((jutsu.power / 4) * battlebornCut));
                const battlebornNote = target.pet.trait === "Battleborn" ? " (Battleborn shrugs off half the strip.)" : "";

                const rawDmg = actor.pet.attack + actor.attackBuff + (jutsu.power * 0.5) - (target.pet.defense + target.defenseBuff) * 0.5;
                const [returnedActor, damagedTarget] = applyDamage(rawDmg, jutsu.name, "damage", nextActor, target);

                // KO'd by the damage portion — skip the debuff write.
                if (damagedTarget.hp <= 0) {
                    return [returnedActor, damagedTarget];
                }

                const crushed = {
                    ...damagedTarget,
                    attackBuff: damagedTarget.attackBuff - atkCut,
                    defenseBuff: damagedTarget.defenseBuff - defCut,
                };
                const msg = `Round ${round}: 🌍 ${actor.pet.name} crushes ${target.pet.name} — strips ${atkCut} ATK / ${defCut} DEF.${battlebornNote}`;
                logs.push(msg);
                if (actorSide === "player") { player = returnedActor; enemy = crushed; } else { enemy = returnedActor; player = crushed; }
                pushFrame(round, msg, actorSide, "debuff");
                return [returnedActor, crushed];
            }

            // ── Phase 12 archetype kinds (pet battles only) ────────────────
            if (jutsu.kind === "wound") {
                const baseW = Math.max(1, Math.floor(jutsu.power * 0.22));
                const wDmg = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(baseW * 0.5)) : baseW;
                const wRounds = Math.max(2, jutsu.rounds ?? 3);
                const wounded = { ...target, woundRounds: Math.max(target.woundRounds, wRounds), woundDamage: Math.max(target.woundDamage, wDmg) };
                const msg = `Round ${round}: ${actor.pet.name} wounds ${target.pet.name} — ${wDmg}/round and halved healing (${wRounds} rounds).`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = wounded; } else { enemy = nextActor; player = wounded; }
                pushFrame(round, msg, actorSide, "dot");
                return [nextActor, wounded];
            }
            if (jutsu.kind === "mark") {
                const mRounds = Math.max(2, jutsu.rounds ?? 2);
                const marked = { ...target, markedRounds: Math.max(target.markedRounds, mRounds) };
                const msg = `Round ${round}: ${actor.pet.name} marks ${target.pet.name} — its next heavy hit bites deeper.`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = marked; } else { enemy = nextActor; player = marked; }
                pushFrame(round, msg, actorSide, "debuff");
                return [nextActor, marked];
            }
            if (jutsu.kind === "slow") {
                const sRounds = Math.max(1, jutsu.rounds ?? 2);
                const slowed = { ...target, slowRounds: Math.max(target.slowRounds, sRounds) };
                const msg = `Round ${round}: ${actor.pet.name} slows ${target.pet.name} — sluggish footing (${sRounds} rounds).`;
                logs.push(msg);
                if (actorSide === "player") { player = nextActor; enemy = slowed; } else { enemy = nextActor; player = slowed; }
                pushFrame(round, msg, actorSide, "movelock");
                return [nextActor, slowed];
            }
            if (jutsu.kind === "haste") {
                const hRounds = Math.max(1, jutsu.rounds ?? 2);
                const hasted = { ...nextActor, hasteRounds: Math.max(nextActor.hasteRounds, hRounds) };
                const msg = `Round ${round}: ${actor.pet.name} surges with haste — quicker and harder to pin (${hRounds} rounds).`;
                logs.push(msg);
                if (actorSide === "player") player = hasted; else enemy = hasted;
                pushFrame(round, msg, actorSide, "buff");
                return [hasted, target];
            }
            if (jutsu.kind === "taunt") {
                const tRounds = Math.max(1, jutsu.rounds ?? 2);
                const taunted = { ...target, tauntedRounds: Math.max(target.tauntedRounds, tRounds), tauntById: actor.pet.id };
                // 1v1 has a single foe (taunt's targeting is moot), so the taunter
                // also raises a brief guard — the move still does something useful.
                const guardedSelf = { ...nextActor, guardRounds: Math.max(nextActor.guardRounds, 1) };
                const msg = `Round ${round}: ${actor.pet.name} taunts ${target.pet.name}, drawing its aggression.`;
                logs.push(msg);
                if (actorSide === "player") { player = guardedSelf; enemy = taunted; } else { enemy = guardedSelf; player = taunted; }
                pushFrame(round, msg, actorSide, "debuff");
                return [guardedSelf, taunted];
            }
            if (jutsu.kind === "push" || jutsu.kind === "pull") {
                const rawDmg = actor.pet.attack + actor.attackBuff + (jutsu.power * 0.5) - (target.pet.defense + target.defenseBuff) * 0.5;
                const [returnedActor, damagedTarget] = applyDamage(rawDmg, jutsu.name, "damage", nextActor, target);
                if (damagedTarget.hp <= 0) return [returnedActor, damagedTarget];
                let movedTarget = damagedTarget;
                // Brace negates the reposition. Push = away from the actor; pull = toward.
                if (damagedTarget.braceRounds <= 0) {
                    const newPos = jutsu.kind === "push"
                        ? bfsStepAway(damagedTarget.pos, returnedActor.pos, obstacles)
                        : (() => { const n = bfsNextStep(damagedTarget.pos, returnedActor.pos, obstacles); return n === returnedActor.pos ? damagedTarget.pos : n; })();
                    if (newPos !== damagedTarget.pos) {
                        movedTarget = { ...damagedTarget, pos: newPos };
                        logs.push(`Round ${round}: ${target.pet.name} is ${jutsu.kind === "push" ? "shoved back" : "dragged in"}.`);
                    }
                }
                if (actorSide === "player") { player = returnedActor; enemy = movedTarget; } else { enemy = returnedActor; player = movedTarget; }
                return [returnedActor, movedTarget];
            }

            if (jutsu.kind === "lifesteal") {
                const rawDmg = actor.pet.attack + actor.attackBuff + jutsu.power - (target.pet.defense + target.defenseBuff) * 0.5;
                const preTargetHp = target.hp;
                const [returnedActor, damagedTarget] = applyDamage(rawDmg, jutsu.name, "damage", nextActor, target);
                // Drain 40% of actual HP lost back to attacker
                const actualDmg = Math.max(0, preTargetHp - damagedTarget.hp);
                const stealAmt  = Math.max(1, Math.floor(actualDmg * 0.40));
                const healed    = { ...returnedActor, hp: Math.min(returnedActor.pet.hp, returnedActor.hp + stealAmt) };
                if (actualDmg > 0) {
                    const lsMsg = `Round ${round}: ${actor.pet.name} drains ${stealAmt} HP from the attack!`;
                    logs.push(lsMsg);
                    if (actorSide === "player") player = healed; else enemy = healed;
                    pushFrame(round, lsMsg, actorSide, "lifesteal", stealAmt);
                }
                return [healed, damagedTarget];
            }

            // damage jutsu
            const rawDmg = actor.pet.attack + actor.attackBuff + jutsu.power - (target.pet.defense + target.defenseBuff) * 0.5;
            return applyDamage(rawDmg, jutsu.name, "damage", nextActor, target);
        }

        // Movement fallback: use Dash jutsu for 3-tile burst if available, else 1-tile step
        // Movement-locked pets cannot use move jutsus or advance
        if (actor.moveLocked > 0) {
            const msg = `Round ${round}: ${actor.pet.name} is movement-locked and cannot advance!`;
            logs.push(msg);
            pushFrame(round, msg, actorSide, "movelock");
            return [actor, target];
        }
        const moveJutsu = actor.pet.jutsus.find(j => j.kind === "move" && (actor.cooldowns[j.name] ?? 0) <= 0);
        if (moveJutsu && dist > 2) {
            const nextActor = { ...actor, cooldowns: { ...actor.cooldowns, [moveJutsu.name]: Math.max(1, moveJutsu.cooldown) } };
            let newPos = actor.pos;
            const dashSteps = slowTiles.has(actor.pos) ? 2 : 3;   // slow tile clips the dash
            for (let step = 0; step < dashSteps; step++) {
                const next = bfsNextStep(newPos, target.pos, obstacles);
                if (next === newPos) break;
                newPos = next;
            }
            const moved = { ...nextActor, pos: newPos };
            const msg = `Round ${round}: ${actor.pet.name} uses ${moveJutsu.name}, dashing 3 tiles toward ${target.pet.name}!`;
            logs.push(msg);
            if (actorSide === "player") player = moved; else enemy = moved;
            pushFrame(round, msg, actorSide, "move");
            return [moved, target];
        }
        return doMove(`advances toward ${target.pet.name}.`);
    }

    // Cleansing Incense — at the top of a round, if a fighter is afflicted and
    // still holds a cleanse charge, purge all poisons/burns and control effects.
    function consumableCleanse(f: PetBattleFighter, side: "player" | "enemy", round: number): PetBattleFighter {
        const afflicted = f.dotRounds > 0 || f.burnRounds > 0 || f.freezeRounds > 0 || f.confuseRounds > 0 || f.stunRounds > 0;
        if ((f.consCleanse ?? 0) <= 0 || !afflicted) return f;
        const cleansed = { ...f, dotRounds: 0, dotDamage: 0, burnRounds: 0, burnDamage: 0, freezeRounds: 0, confuseRounds: 0, stunRounds: 0, consCleanse: (f.consCleanse ?? 0) - 1 };
        const msg = `Round ${round}: ${f.pet.name} burns away every affliction with Cleansing Incense!`;
        logs.push(msg);
        pushFrame(round, msg, side, "buff", undefined, undefined, { actor: side, trait: "consumCleanse" });
        return cleansed;
    }

    // ── Round structure (Phase 10) ──────────────────────────────────────────
    // Each round flows through six clear phases. The cinematic windup → impact →
    // reaction beats are realized per-frame by the animation event queue
    // (buildPetAnimationEvents); the simulator resolves an action atomically
    // inside act() and emits the frames the renderer choreographs.
    //   1. INTENT   — petScoredDecision() picks the action from the tactical state
    //   2. MOVEMENT — doMove / retreat / dash reposition (rooted pets can't)
    //   3. WINDUP   — telegraph (move callout + charge/wind-up pose)
    //   4. IMPACT   — applyDamage / status / heal / shield lands
    //   5. REACTION — dodge / block / guard / recoil / shield-absorb / proc
    //   6. CLEANUP  — DoT ticks, tile effects, cooldown/buff decay, KO check
    for (let round = 1; round <= 30 && player.hp > 0 && enemy.hp > 0; round += 1) {
        // ── Phase 6 (start-of-round CLEANUP): decay cooldowns/buffs/statuses,
        // purge with cleanse, then tick damage-over-time + tile hazards. ──
        player = tick(player);
        enemy  = tick(enemy);
        player = consumableCleanse(player, "player", round);
        enemy  = consumableCleanse(enemy, "enemy", round);

        // Apply DOT poison damage
        if (player.dotRounds > 0) {
            const dotDmg = player.dotDamage;
            player = { ...player, hp: Math.max(0, player.hp - dotDmg), dotRounds: player.dotRounds - 1 };
            const dotMsg = `Round ${round}: ${player.pet.name} writhes in poison — ${dotDmg} damage.`;
            logs.push(dotMsg);
            pushFrame(round, dotMsg, "player", "dot", dotDmg);
            if (player.hp <= 0) break;
        }
        if (enemy.dotRounds > 0) {
            const dotDmg = enemy.dotDamage;
            enemy = { ...enemy, hp: Math.max(0, enemy.hp - dotDmg), dotRounds: enemy.dotRounds - 1 };
            const dotMsg = `Round ${round}: ${enemy.pet.name} writhes in poison — ${dotDmg} damage.`;
            logs.push(dotMsg);
            pushFrame(round, dotMsg, "enemy", "dot", dotDmg);
            if (enemy.hp <= 0) break;
        }

        // Burn DoT — applied each round while burnRounds > 0, separate from
        // poison so a pet can suffer both at once.
        if (player.burnRounds > 0 && player.burnDamage > 0) {
            player = { ...player, hp: Math.max(0, player.hp - player.burnDamage), burnRounds: player.burnRounds - 1 };
            const msg = `Round ${round}: 🔥 ${player.pet.name} burns for ${player.burnDamage} damage.`;
            logs.push(msg);
            pushFrame(round, msg, "player", "dot", player.burnDamage);
            if (player.hp <= 0) break;
        }
        if (enemy.burnRounds > 0 && enemy.burnDamage > 0) {
            enemy = { ...enemy, hp: Math.max(0, enemy.hp - enemy.burnDamage), burnRounds: enemy.burnRounds - 1 };
            const msg = `Round ${round}: 🔥 ${enemy.pet.name} burns for ${enemy.burnDamage} damage.`;
            logs.push(msg);
            pushFrame(round, msg, "enemy", "dot", enemy.burnDamage);
            if (enemy.hp <= 0) break;
        }

        // Wound DoT (Phase 12) — bleeds each round and ticks its own counter
        // (the heal-reduction lives in the heal handler). Mirrors burn.
        if (player.woundRounds > 0 && player.woundDamage > 0) {
            player = { ...player, hp: Math.max(0, player.hp - player.woundDamage), woundRounds: player.woundRounds - 1 };
            const msg = `Round ${round}: 🩸 ${player.pet.name} bleeds for ${player.woundDamage} damage.`;
            logs.push(msg);
            pushFrame(round, msg, "player", "dot", player.woundDamage);
            if (player.hp <= 0) break;
        }
        if (enemy.woundRounds > 0 && enemy.woundDamage > 0) {
            enemy = { ...enemy, hp: Math.max(0, enemy.hp - enemy.woundDamage), woundRounds: enemy.woundRounds - 1 };
            const msg = `Round ${round}: 🩸 ${enemy.pet.name} bleeds for ${enemy.woundDamage} damage.`;
            logs.push(msg);
            pushFrame(round, msg, "enemy", "dot", enemy.woundDamage);
            if (enemy.hp <= 0) break;
        }

        // Initiative is rolled EACH round, weighted by speed: the faster pet is
        // likelier to strike first (a 2× speed lead wins the opener ~67% of
        // rounds) but it's never guaranteed, so fights stay unpredictable.
        const playerFirst = rng() < player.pet.speed / Math.max(1, player.pet.speed + enemy.pet.speed);
        // Flurry — a faster pet earns a bonus action this round. Universal (any
        // pet, scaling with the speed ratio); the Swift trait amplifies it. This
        // is the core payoff for investing in Speed: more turns = more pressure.
        const playerFlurry = rng() < petFlurryChance(player.pet.speed, enemy.pet.speed, player.pet.trait === "Swift");
        const enemyFlurry  = rng() < petFlurryChance(enemy.pet.speed, player.pet.speed, enemy.pet.trait === "Swift");
        if (playerFlurry) { logs.push(`Round ${round}: ${player.pet.name} blurs into a flurry — bonus action!`); }
        if (enemyFlurry)  { logs.push(`Round ${round}: ${enemy.pet.name} blurs into a flurry — bonus action!`); }

        if (playerFirst) {
            [player, enemy] = act(player, enemy, round);
            if (playerFlurry && enemy.hp > 0) [player, enemy] = act(player, enemy, round);
            if (enemy.hp <= 0) break;
            [enemy, player] = act(enemy, player, round);
            if (enemyFlurry && player.hp > 0) [enemy, player] = act(enemy, player, round);
        } else {
            [enemy, player] = act(enemy, player, round);
            if (enemyFlurry && player.hp > 0) [enemy, player] = act(enemy, player, round);
            if (player.hp <= 0) break;
            [player, enemy] = act(player, enemy, round);
            if (playerFlurry && enemy.hp > 0) [player, enemy] = act(player, enemy, round);
        }

        // ── End-of-round tile effects (Phases 5-6) — hazard chips, healing
        // restores. Small (≈4% max HP) so a pet that fights on bad ground bleeds
        // out a little, and a pet holding a healing tile sustains. Deterministic.
        if (player.hp > 0 && (hazardTiles.has(player.pos) || healingTiles.has(player.pos))) {
            const hz = hazardTiles.has(player.pos);
            const amt = Math.max(2, Math.floor(player.pet.hp * 0.04));
            player = { ...player, hp: hz ? Math.max(0, player.hp - amt) : Math.min(player.pet.hp, player.hp + amt) };
            const msg = `Round ${round}: ${player.pet.name} ${hz ? `is scorched by the hazard for ${amt}` : `recovers ${amt} on the healing field`}.`;
            logs.push(msg);
            pushFrame(round, msg, "player", hz ? "dot" : "heal", hz ? amt : undefined);
        }
        if (enemy.hp > 0 && (hazardTiles.has(enemy.pos) || healingTiles.has(enemy.pos))) {
            const hz = hazardTiles.has(enemy.pos);
            const amt = Math.max(2, Math.floor(enemy.pet.hp * 0.04));
            enemy = { ...enemy, hp: hz ? Math.max(0, enemy.hp - amt) : Math.min(enemy.pet.hp, enemy.hp + amt) };
            const msg = `Round ${round}: ${enemy.pet.name} ${hz ? `is scorched by the hazard for ${amt}` : `recovers ${amt} on the healing field`}.`;
            logs.push(msg);
            pushFrame(round, msg, "enemy", hz ? "dot" : "heal", hz ? amt : undefined);
        }
        // High-ground ward — a pet that ends the round holding the central high
        // ground tops up a protective shield (refreshed to a floor, not stacked).
        const hgWard = (f: PetBattleFighter) => Math.max(2, Math.floor(Math.max(1, f.pet.hp || 0) * 0.08));
        if (player.hp > 0 && highGroundTiles.has(player.pos) && player.shieldHp < hgWard(player)) {
            player = { ...player, shieldHp: hgWard(player) };
            logs.push(`Round ${round}: ${player.pet.name} holds the high ground — warded (${player.shieldHp}).`);
        }
        if (enemy.hp > 0 && highGroundTiles.has(enemy.pos) && enemy.shieldHp < hgWard(enemy)) {
            enemy = { ...enemy, shieldHp: hgWard(enemy) };
            logs.push(`Round ${round}: ${enemy.pet.name} holds the high ground — warded (${enemy.shieldHp}).`);
        }
        // Power pickups — the nearest pet within reach (≤1 tile) of a shrine
        // claims a one-time attack surge + a small restore, then it's consumed.
        const claimSurge = (f: PetBattleFighter): PetBattleFighter => { const mhp = Math.max(1, f.pet.hp || 0); return { ...f, attackBuff: f.attackBuff + Math.max(3, Math.floor((f.pet.attack || 0) * 0.2)), hp: Math.min(mhp, f.hp + Math.floor(mhp * 0.1)) }; };
        for (const tile of [...pickups]) {
            const dp = player.hp > 0 ? tileDistance(player.pos, tile) : Infinity;
            const de = enemy.hp > 0 ? tileDistance(enemy.pos, tile) : Infinity;
            if (Math.min(dp, de) > 1) continue;
            if (dp <= de) { player = claimSurge(player); logs.push(`Round ${round}: ${player.pet.name} claims a power shrine — empowered!`); }
            else { enemy = claimSurge(enemy); logs.push(`Round ${round}: ${enemy.pet.name} claims a power shrine — empowered!`); }
            pickups.delete(tile);
        }
        // Bush concealment — a pet ending the round in tall grass refreshes its
        // evasion (2 so it survives next round's status tick into the hit phase).
        if (player.hp > 0 && bushTiles.has(player.pos) && player.evadeRounds < 2) player = { ...player, evadeRounds: 2 };
        if (enemy.hp > 0 && bushTiles.has(enemy.pos) && enemy.evadeRounds < 2) enemy = { ...enemy, evadeRounds: 2 };
        if (player.hp <= 0 || enemy.hp <= 0) break;

        const roundMessage = `Round ${round}: ${player.pet.name} ${player.hp}/${player.pet.hp} HP | ${enemy.pet.name} ${enemy.hp}/${enemy.pet.hp} HP`;
        logs.push(roundMessage);
        pushFrame(round, roundMessage, "system");
    }

    // ── Result resolution ──────────────────────────────────────────────────
    // Cases:
    //   1. One pet down, the other alive → standard win / loss
    //   2. Both pets at 0 HP same round (double KO from DoT, simultaneous
    //      finishers, etc.) → DRAW (was: player auto-wins, unfair)
    //   3. 30-round stalemate, both still alive → HP% tiebreak with a 5%
    //      tolerance band that produces DRAW (was: equal HP gave player win)
    const playerWon = player.hp > 0 && enemy.hp <= 0;
    const enemyWon = enemy.hp > 0 && player.hp <= 0;
    let result: "win" | "loss" | "draw";
    if (playerWon) result = "win";
    else if (enemyWon) result = "loss";
    else if (player.hp <= 0 && enemy.hp <= 0) result = "draw";
    else {
        // Stalemate after round cap. Compare remaining HP percent (fair
        // across different max HP pools) with a 5% draw band.
        const playerPct = player.hp / Math.max(1, player.pet.hp);
        const enemyPct = enemy.hp / Math.max(1, enemy.pet.hp);
        if (Math.abs(playerPct - enemyPct) < 0.05) result = "draw";
        else result = playerPct > enemyPct ? "win" : "loss";
    }
    const finalMessage =
        result === "win" ? `${player.pet.name} wins the Pet Arena match.` :
        result === "loss" ? `${enemy.pet.name} wins the Pet Arena match.` :
        `Draw — neither pet could finish the fight.`;
    logs.push(finalMessage);
    pushFrame(21, finalMessage, "system", "result");
    return { result, player, enemy, logs, frames, obstacles: [...obstacles], tiles: arenaTiles.tiles };
}

// ── Reactive battle-consumable resolvers (shared by the 2v2 party engine) ──
// Mirror the 1v1 hooks. Pre-hit handles dodge (full negate) and mitigate
// (damage reduction); post-hit handles thorns (reflect), endure (survive
// lethal), and lifeline (heal on first dip below threshold). All consume the
// charge they trigger so the item is one-shot.
function petReactivePreHit(defender: PetBattleFighter, rawDamage: number): { damage: number; defender: PetBattleFighter; dodged: boolean; note: string; flash?: string } {
    if ((defender.consDodge ?? 0) > 0) {
        return { damage: 0, defender: { ...defender, consDodge: (defender.consDodge ?? 0) - 1 }, dodged: true, note: ` 💨 ${defender.pet.name} dodges!`, flash: "consumDodge" };
    }
    if ((defender.consMitigate ?? 0) > 0) {
        return { damage: Math.max(1, Math.floor(rawDamage * (1 - (defender.consMitigate ?? 0) / 100))), defender: { ...defender, consMitigate: 0 }, dodged: false, note: ` 💨 ${defender.pet.name} blunts the blow!`, flash: "consumBlock" };
    }
    return { damage: rawDamage, defender, dodged: false, note: "" };
}
function petReactivePostHit(attacker: PetBattleFighter, defender: PetBattleFighter, preHitHp: number, damageDealt: number): { attacker: PetBattleFighter; defender: PetBattleFighter; note: string; flash?: string } {
    let a = attacker, d = defender, note = "";
    let flash: string | undefined;
    if ((d.consThorns ?? 0) > 0 && damageDealt > 0) {
        const reflect = Math.max(1, Math.floor(damageDealt * (d.consThorns ?? 0) / 100));
        a = { ...a, hp: Math.max(0, a.hp - reflect) };
        d = { ...d, consThorns: 0 };
        note += ` 🌵 ${d.pet.name} reflects ${reflect}!`;
        flash = "consumReflect";
    }
    if (d.hp <= 0 && (d.consEndure ?? 0) > 0) {
        d = { ...d, hp: 1, consEndure: (d.consEndure ?? 0) - 1 };
        note += ` 💪 ${d.pet.name} endures at 1 HP!`;
        flash = "consumEndure";
    }
    const maxHp = d.pet.hp;
    if ((d.consLifeline ?? 0) > 0 && d.hp > 0
        && (d.hp / maxHp) * 100 < PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT
        && (preHitHp / maxHp) * 100 >= PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT) {
        const heal = Math.max(1, Math.floor(maxHp * (d.consLifeline ?? 0) / 100));
        d = { ...d, hp: Math.min(maxHp, d.hp + heal), consLifeline: 0 };
        note += ` ✨ Lifeline heals ${heal}!`;
        flash = "consumLifeline";
    }
    return { attacker: a, defender: d, note, flash };
}

// ── 2v2 Party Battle AI: matchup scoring and party ordering ───────────────
//
// 2v2 matches play out as two SEQUENTIAL 1v1s (lead vs lead, reserve vs
// reserve, both fresh HP). The team that wins more matches takes the set.
// That means the order you put your pets in matters: a Fire pet on a Wind
// opponent (super-effective) is far stronger than the same Fire pet on a
// Water opponent (resisted).
//
// scorePetMatchup → numeric "expected edge" of one pet vs another:
//   • stat ratio (HP × ATK power roughly)
//   • element multiplier (1.25 super-effective, 0.80 resisted, else 1.0)
//   • trait counter penalty (my element's signature wasted against
//     a counter-trait — e.g. Lightning vs Aggressive)
//
// pickBestPartyOrder → given my available pets and the opponent's locked
// [lead, reserve] order, try every combination of [lead, reserve] from my
// roster and pick the ordering with the highest summed matchup score. So
// the AI deliberately puts a Fire pet against a Wind opposing lead and
// holds back a Water pet for the opponent's Fire reserve, even if Water
// is the higher-level pet.
export function scorePetMatchup(me: Pet, them: Pet): number {
    // Raw stat power — attack × hp/100 to favor both offense and survivability.
    const myPower = (me.attack ?? 1) * Math.max(1, (me.hp ?? 1) / 100);
    const theirPower = (them.attack ?? 1) * Math.max(1, (them.hp ?? 1) / 100);
    const statRatio = myPower / Math.max(1, theirPower);

    // Element multiplier — apply both directions: my advantage vs me, and
    // their advantage vs them. A double-good matchup (super-effective AND
    // they're resisted hitting me) is the strongest pick.
    const mineToThem = petElementMultiplier(me, them);
    const themToMine = petElementMultiplier(them, me);
    const elementEdge = mineToThem / Math.max(0.01, themToMine);

    // Trait counter penalty — if my elemental special is fully resisted
    // by the opponent's trait, my signature is wasted.
    //   Fire/burn → no full counter (Guardian only halves)
    //   Water/freeze vs Swift → wasted
    //   Wind/confuse vs Lucky → wasted
    //   Lightning/stun vs Aggressive → 1-round stuns wasted (most tiers)
    //   Earth/crush → no full counter (Battleborn only halves strip)
    let traitPenalty = 1.0;
    if (me.element === "Water" && them.trait === "Swift") traitPenalty *= 0.85;
    if (me.element === "Wind" && them.trait === "Lucky") traitPenalty *= 0.85;
    if (me.element === "Lightning" && them.trait === "Aggressive") traitPenalty *= 0.85;
    // Inverse: their special is wasted against MY trait → I get a bonus
    if (them.element === "Water" && me.trait === "Swift") traitPenalty *= 1.15;
    if (them.element === "Wind" && me.trait === "Lucky") traitPenalty *= 1.15;
    if (them.element === "Lightning" && me.trait === "Aggressive") traitPenalty *= 1.15;

    return statRatio * elementEdge * traitPenalty;
}

export function pickBestPartyOrder(
    available: Pet[],
    opposingLeadReserve: [Pet, Pet],
): [Pet, Pet] | null {
    if (available.length < 2) return null;
    const [theirLead, theirReserve] = opposingLeadReserve;
    let best: { pair: [Pet, Pet]; score: number } | null = null;
    // Try every ordered pair (mineLead, mineReserve) with distinct ids.
    for (const myLead of available) {
        for (const myReserve of available) {
            if (myLead.id === myReserve.id) continue;
            const score =
                scorePetMatchup(myLead, theirLead) +
                scorePetMatchup(myReserve, theirReserve);
            if (!best || score > best.score) {
                best = { pair: [myLead, myReserve], score };
            }
        }
    }
    return best?.pair ?? null;
}

// ── 2v2 Party Battle (simultaneous, Pokémon-doubles style) ────────────────
// All 4 pets on the 14×7 grid at once:
//   Player team in column 1 (rows 2 and 4 — tiles 29 and 57)
//   Enemy team in column 12 (rows 2 and 4 — tiles 40 and 68)
// Each round all living pets act in initiative order (speed desc).
// Targeting: damage/status jutsus auto-target the highest-priority opposing
// pet (lowest-HP-first, with element-matchup + trait-counter awareness from
// scorePetMatchup). Heal/buff jutsus target the lowest-HP ally (which can
// be self). Pets can NEVER target a teammate with a damaging jutsu — the
// target picker only ever returns an opposing-team pet for damage/status
// kinds, and heals always go to allies.
// Win when one team has 0 living pets. 30-round cap → HP% tiebreak.
export type PetPartyBattleMatch = {
    playerPet: Pet | null;
    opponentPet: Pet | null;
    result: "win" | "loss" | "draw" | "forfeit-player" | "forfeit-opponent";
    playerHpRemaining: number;
    enemyHpRemaining: number;
    logs: string[];
    frames: PetArenaFrame[];
    obstacles: number[];
    /** Typed effect-tiles (hazard/healing/slow/cover) for the renderer — parity
     *  with the 1v1 engine. Lives on matches[0] alongside obstacles. */
    tiles?: ArenaTile[];
};

export type PetPartyBattleResult = {
    result: "win" | "loss" | "draw";
    matches: PetPartyBattleMatch[];
    playerWins: number;
    opponentWins: number;
    draws: number;
    summaryLogs: string[];
};

// Slot identifier — one of 4 pet positions in a 2v2 simultaneous battle.
type PartySlot = "playerLead" | "playerReserve" | "enemyLead" | "enemyReserve";
const ALL_SLOTS: PartySlot[] = ["playerLead", "playerReserve", "enemyLead", "enemyReserve"];
function isPlayerSlot(s: PartySlot): boolean { return s === "playerLead" || s === "playerReserve"; }
// Slot-pair helper kept for future 2v2 partner-assist mechanics. Unused at
// present — prefixed underscore silences the lint.
function _partnerSlot(s: PartySlot): PartySlot {
    if (s === "playerLead")    return "playerReserve";
    if (s === "playerReserve") return "playerLead";
    if (s === "enemyLead")     return "enemyReserve";
    return "enemyLead";
}
void _partnerSlot;

export function runPetArenaParty(
    playerParty: [Pet | null, Pet | null],
    opponentParty: [Pet | null, Pet | null],
    opponentOwner: string,
    seed = Date.now(),
    playerDamageMult = 1,
): PetPartyBattleResult {
    const summaryLogs: string[] = [];
    const logs: string[] = [];
    const frames: PetArenaFrame[] = [];

    // Forfeit short-circuit: a party battle needs at least one pet on each
    // side. The picker upstream guarantees at least the lead is filled
    // when both sides chose to engage, so the only true "forfeit" is when
    // one side has zero pets at all. Otherwise empty slots just mean
    // fewer fighters on the field.
    const livePlayer = playerParty.filter(Boolean) as Pet[];
    const liveEnemy  = opponentParty.filter(Boolean) as Pet[];
    if (livePlayer.length === 0 && liveEnemy.length === 0) {
        return { result: "draw", matches: [{ playerPet: null, opponentPet: null, result: "draw", playerHpRemaining: 0, enemyHpRemaining: 0, logs: ["Both sides forfeited."], frames: [], obstacles: [] }], playerWins: 0, opponentWins: 0, draws: 1, summaryLogs: ["Both sides forfeited."] };
    }
    if (livePlayer.length === 0) return { result: "loss", matches: [{ playerPet: null, opponentPet: liveEnemy[0] ?? null, result: "forfeit-player", playerHpRemaining: 0, enemyHpRemaining: liveEnemy[0]?.hp ?? 0, logs: ["You fielded no pets — auto-loss."], frames: [], obstacles: [] }], playerWins: 0, opponentWins: liveEnemy.length, draws: 0, summaryLogs: ["You fielded no pets — auto-loss."] };
    if (liveEnemy.length === 0) return { result: "win", matches: livePlayer.map(p => ({ playerPet: p, opponentPet: null, result: "forfeit-opponent" as const, playerHpRemaining: p.hp, enemyHpRemaining: 0, logs: [`${p.name} wins by forfeit.`], frames: [], obstacles: [] })), playerWins: liveEnemy.length === 0 ? livePlayer.length : 0, opponentWins: 0, draws: 0, summaryLogs: ["Opponent fielded no pets — auto-win."] };

    // ── Init RNG, obstacles, fighters ─────────────────────────────
    const rng = seededPetBattleRandom(seed);
    const layoutIndex = Math.floor(rng() * PET_OBSTACLE_LAYOUTS.length);
    const obstacleLayout = PET_OBSTACLE_LAYOUTS[layoutIndex];
    const obstacles = new Set<number>(obstacleLayout);
    // Typed terrain (parity with the 1v1 engine) — derived deterministically from
    // the layout (consumes no rng): hazard/healing chip at round end, slow tiles
    // cut a mover's steps. Cover stays a wall here (no ranged-reduction port yet).
    const arenaTiles = buildArenaTiles(obstacleLayout, layoutIndex);
    const hazardTiles = arenaTiles.hazard;
    const healingTiles = arenaTiles.healing;
    const slowTiles = arenaTiles.slow;
    // Central high ground (terrain depth) — holding it grants a round-end ward.
    const highGroundTiles = petHighGroundTiles(obstacles);
    // Power-pickup shrines (terrain depth) — claimed for a one-time surge; the
    // mutable set rides out on each frame so the renderer draws + vanishes them.
    const pickups = new Set<number>(petPickupTiles(obstacles));
    // Bushes / tall grass (terrain depth) — concealment grants a round-end evade.
    const bushTiles = petBushTiles(obstacles);

    // Starting positions on the 14×7 grid:
    //   playerLead    = col 1, row 2 = 29
    //   playerReserve = col 1, row 4 = 57
    //   enemyLead     = col 12, row 2 = 40
    //   enemyReserve  = col 12, row 4 = 68
    function makeFighter(petIn: Pet, owner: string, pos: number): PetBattleFighter {
        // Apply the pet's equipped PVP gear (stat mods) + seed its reactive
        // battle-consumable charges from its own loadout — deterministic, so
        // synced 2v2 battles stay in sync.
        const pet = applyPetPvpGear(petIn);
        const ch = petConsumableCharges(pet);
        return { owner, pet, hp: pet.hp, pos, attackBuff: 0, defenseBuff: 0, cooldowns: {}, dotDamage: 0, dotRounds: 0, shieldHp: petGearStartShield(pet), moveLocked: 0, absorbRounds: 0, absorbPercent: 0, burnRounds: 0, burnDamage: 0, freezeRounds: 0, confuseRounds: 0, stunRounds: 0, consDodge: ch.dodge, consMitigate: ch.mitigate, consEndure: ch.endure, consThorns: ch.thorns, consLifeline: ch.lifeline, consCleanse: ch.cleanse, guardRounds: 0, evadeRounds: 0, braceRounds: 0, focusReady: false, defensiveCd: 0, woundRounds: 0, woundDamage: 0, markedRounds: 0, slowRounds: 0, hasteRounds: 0, tauntedRounds: 0, tauntById: "" };
    }
    const fighters: Partial<Record<PartySlot, PetBattleFighter>> = {};
    if (playerParty[0])   fighters.playerLead    = makeFighter(playerParty[0],   "You",        29);
    if (playerParty[1])   fighters.playerReserve = makeFighter(playerParty[1],   "You",        57);
    if (opponentParty[0]) fighters.enemyLead     = makeFighter(opponentParty[0], opponentOwner, 40);
    if (opponentParty[1]) fighters.enemyReserve  = makeFighter(opponentParty[1], opponentOwner, 68);

    // ── 2v2 team bonds (type/trait teamwork) ──────────────────────
    // How well each side's two pets work together — drives whether they stick
    // and focus-fire one foe (cohesive) or spread to pressure both (split).
    // Computed once from the rosters; pure + deterministic so ranked stays synced.
    const playerBond: PetPairBond = playerParty[0] && playerParty[1] ? petPairBond(playerParty[0], playerParty[1]) : "neutral";
    const enemyBond: PetPairBond = opponentParty[0] && opponentParty[1] ? petPairBond(opponentParty[0], opponentParty[1]) : "neutral";

    function isAlive(slot: PartySlot): boolean {
        const f = fighters[slot];
        return !!f && f.hp > 0;
    }
    function livingOpposing(actorSlot: PartySlot): PartySlot[] {
        return ALL_SLOTS.filter(s => isAlive(s) && isPlayerSlot(s) !== isPlayerSlot(actorSlot));
    }
    function livingAllies(actorSlot: PartySlot): PartySlot[] {
        return ALL_SLOTS.filter(s => isAlive(s) && isPlayerSlot(s) === isPlayerSlot(actorSlot));
    }
    function statusObj(f: PetBattleFighter | undefined) {
        if (!f) return { poisoned: undefined, burn: undefined, freeze: undefined, confuse: undefined, stun: undefined, shield: undefined, absorbing: undefined };
        return {
            poisoned: f.dotRounds > 0 ? f.dotRounds : undefined,
            burn:     f.burnRounds > 0 ? f.burnRounds : undefined,
            freeze:   f.freezeRounds > 0 ? f.freezeRounds : undefined,
            confuse:  f.confuseRounds > 0 ? f.confuseRounds : undefined,
            stun:     f.stunRounds > 0 ? f.stunRounds : undefined,
            shield:   f.shieldHp > 0 ? f.shieldHp : undefined,
            absorbing: f.absorbRounds > 0 || undefined,
            wound:    f.woundRounds > 0 ? f.woundRounds : undefined,
            marked:   f.markedRounds > 0 || undefined,
            slow:     f.slowRounds > 0 ? f.slowRounds : undefined,
            haste:    f.hasteRounds > 0 ? f.hasteRounds : undefined,
            taunted:  f.tauntedRounds > 0 || undefined,
        };
    }
    function slotSnapshot(slot: PartySlot) {
        const f = fighters[slot];
        if (!f) return { hp: 0, maxHp: 1, pos: 0, name: "", ko: true, status: statusObj(undefined) };
        return {
            hp: f.hp,
            maxHp: f.pet.hp,
            pos: f.pos,
            name: f.pet.name,
            rarity: f.pet.rarity,
            element: f.pet.element,
            ko: f.hp <= 0,
            status: statusObj(f),
        };
    }
    function pushPartyFrame(round: number, message: string, actorSlot: PartySlot | "system", actionKind: PetArenaFrame["actionKind"], damage?: number, crit?: boolean, traitFlash?: PetArenaFrame["traitFlash"], combo?: number, isKO?: boolean, targetSlot?: PartySlot, signatureMove?: PetArenaFrame["signatureMove"], isPrefight = false) {
        // Pick 1v1-style player/enemy "primary" pet for legacy fields:
        // most recently-acting on each side, else lead, else reserve.
        const primPlayer  = fighters.playerLead  ?? fighters.playerReserve;
        const primEnemy   = fighters.enemyLead   ?? fighters.enemyReserve;
        frames.push({
            round, message,
            playerHp: primPlayer?.hp ?? 0,
            enemyHp:  primEnemy?.hp  ?? 0,
            playerPos: primPlayer?.pos ?? 0,
            enemyPos:  primEnemy?.pos  ?? 0,
            actor: actorSlot === "system" ? "system" : (isPlayerSlot(actorSlot) ? "player" : "enemy"),
            actionKind, damage, crit, traitFlash, combo, signatureMove,
            isPrefight, isKO,
            playerStatus: statusObj(primPlayer),
            enemyStatus:  statusObj(primEnemy),
            pickups: Array.from(pickups),
            party4v4: {
                playerLead:    slotSnapshot("playerLead"),
                playerReserve: slotSnapshot("playerReserve"),
                enemyLead:     slotSnapshot("enemyLead"),
                enemyReserve:  slotSnapshot("enemyReserve"),
                actorSlot: actorSlot === "system" ? undefined : actorSlot,
                targetSlot,
            },
        });
    }

    // Pre-fight face-off frame. isPrefight=true so PetArenaBattlefield renders
    // the pet-prefight-overlay + 5s countdown in 2v2 PvP, matching the 1v1 path.
    logs.push("2v2 party battle begins — all 4 pets on the field!");
    pushPartyFrame(0, "2v2 — FIGHT!", "system", /*actionKind*/ undefined, /*damage*/ undefined, /*crit*/ undefined, /*traitFlash*/ undefined, /*combo*/ undefined, /*isKO*/ undefined, /*targetSlot*/ undefined, /*signatureMove*/ undefined, /*isPrefight*/ true);

    // ── Target selection ──────────────────────────────────────────
    // For damage / status: prefer lowest-HP opposing pet, weighted by
    // matchup score (super-effective + good trait counter raises priority).
    // For heal / buff / barrier / shield / absorb: target lowest-HP ally
    // (can be self).
    function pickTargetSlot(
        actorSlot: PartySlot,
        jutsuKind: PetJutsu["kind"] | "basic",
        // Optional: which target the actor's TEAMMATE just attacked this round.
        // If that slot is still alive, the actor weights it higher so the two
        // partners converge on focus-fire (guaranteed KO > spreading damage).
        partnerFocusSlot?: PartySlot,
    ): PartySlot | null {
        const self = fighters[actorSlot]!;
        const allyKinds = new Set<string>(["heal", "buff", "barrier", "shield", "absorb"]);
        if (allyKinds.has(jutsuKind)) {
            // Heal/defensive targets an ally — the lowest-HP ally (incl. self).
            const allies = livingAllies(actorSlot);
            if (allies.length === 0) return null;
            return allies.sort((a, b) => {
                const fa = fighters[a]!, fb = fighters[b]!;
                return (fa.hp / fa.pet.hp) - (fb.hp / fb.pet.hp);
            })[0];
        }
        // Damage / status / debuff target opposing team.
        const opps = livingOpposing(actorSlot);
        if (opps.length === 0) return null;
        // Score each opponent: lower HP% is more finishable; matchup score
        // rewards super-effective + bad trait counters; focus-fire on the
        // teammate's last target adds a +50% bonus weight so two partners
        // tend to converge on the same KO instead of splitting damage across
        // two targets and KO'ing neither.
        return opps.sort((a, b) => {
            const fa = fighters[a]!, fb = fighters[b]!;
            const hpA = fa.hp / fa.pet.hp;
            const hpB = fb.hp / fb.pet.hp;
            const mA = scorePetMatchup(self.pet, fa.pet);
            const mB = scorePetMatchup(self.pet, fb.pet);
            const focusBonusA = partnerFocusSlot === a ? 1.5 : 1.0;
            const focusBonusB = partnerFocusSlot === b ? 1.5 : 1.0;
            const scoreA = (mA * focusBonusA) / Math.max(0.1, hpA);
            const scoreB = (mB * focusBonusB) / Math.max(0.1, hpB);
            return scoreB - scoreA; // higher score first
        })[0];
    }

    // Archetype-aware enemy pick (Phase 13) — runs the shared choosePartyTarget
    // over all 4 fielded pets so a pet considers BOTH enemies by its role
    // (assassin→lowest HP, control/tank→biggest threat, etc.). Falls back to
    // pickTargetSlot's HP/matchup/focus-fire score when it can't decide. Pure +
    // deterministic (target choice reads only HP/attack/distance), so ranked
    // party replays stay in sync.
    function pickArchetypeTargetSlot(actorSlot: PartySlot): PartySlot | undefined {
        const actors: PetBattleActor[] = [];
        const teamOf: Record<string, "player" | "enemy"> = {};
        const statsByActor: Record<string, { attack: number; defense: number; speed: number }> = {};
        for (const s of ALL_SLOTS) {
            const f = fighters[s];
            if (!f || f.hp <= 0) continue;
            actors.push({
                id: s, name: f.pet.name, hp: f.hp, maxHp: f.pet.hp,
                position: { row: Math.floor(f.pos / PET_GRID_COLS), col: f.pos % PET_GRID_COLS },
                archetype: petArchetypeFor(f.pet), statuses: [], cooldowns: {},
            });
            teamOf[s] = isPlayerSlot(s) ? "player" : "enemy";
            statsByActor[s] = { attack: f.pet.attack + f.attackBuff, defense: f.pet.defense + f.defenseBuff, speed: f.pet.speed };
        }
        const aiState: PetAiState = { actors, teamOf, movesByActor: {}, statsByActor, arena: makeArena([]), round: 0 };
        const id = choosePartyTarget(aiState, actorSlot);
        return id && (ALL_SLOTS as string[]).includes(id) ? (id as PartySlot) : undefined;
    }

    // Team-bond focus (type/trait teamwork). COHESIVE partners pile onto the
    // SAME foe their teammate just hit — so they converge and fight side-by-side;
    // SPLIT partners deliberately take the OTHER living foe — so they fan out to
    // pressure both. Returns undefined (→ normal archetype/HP pickers decide)
    // for a neutral bond, before the partner has acted, or when it can't apply
    // (foe already dead / only one foe left). Pure target PREFERENCE only — it
    // never touches damage, odds, or rewards.
    function synergyFocusSlot(actorSlot: PartySlot, partnerFocusSlot: PartySlot | undefined): PartySlot | undefined {
        if (!partnerFocusSlot) return undefined;
        const bond = isPlayerSlot(actorSlot) ? playerBond : enemyBond;
        if (bond === "neutral") return undefined;
        const opps = livingOpposing(actorSlot);
        const partnerAlive = opps.includes(partnerFocusSlot);
        if (!partnerAlive) return undefined;
        if (bond === "cohesive") return partnerFocusSlot;       // stick: same foe
        return opps.find(s => s !== partnerFocusSlot);          // split: the other foe (undefined if none)
    }

    // ── tick + status helpers (cloned from 1v1 engine) ────────────
    function tick(f: PetBattleFighter): PetBattleFighter {
        return {
            ...f,
            attackBuff:   f.attackBuff  > 0 ? Math.max(0, f.attackBuff  - 1) : Math.min(0, f.attackBuff  + 1),
            defenseBuff:  f.defenseBuff > 0 ? Math.max(0, f.defenseBuff - 1) : Math.min(0, f.defenseBuff + 1),
            cooldowns:    Object.fromEntries(Object.entries(f.cooldowns).map(([n, v]) => [n, Math.max(0, v - 1)])),
            moveLocked:   Math.max(0, f.moveLocked   - 1),
            absorbRounds: Math.max(0, f.absorbRounds - 1),
            // burnRounds ticks in the round loop with the burn DoT (like wound).
            freezeRounds: Math.max(0, f.freezeRounds - 1),
            confuseRounds: Math.max(0, f.confuseRounds - 1),
            stunRounds:   Math.max(0, f.stunRounds   - 1),
            markedRounds: Math.max(0, f.markedRounds - 1),
            slowRounds:   Math.max(0, f.slowRounds   - 1),
            hasteRounds:  Math.max(0, f.hasteRounds  - 1),
            tauntedRounds:Math.max(0, f.tauntedRounds - 1),
            // woundRounds ticks with the wound DoT in the round loop.
        };
    }
    function applyStatusToFighter(target: PetBattleFighter, status: "burn" | "freeze" | "confuse" | "stun", rounds: number, burnDmgIfBurn = 0): PetBattleFighter {
        const trait = target.pet.trait;
        if (status === "stun"    && trait === "Aggressive") rounds = Math.max(0, rounds - 1);
        if (status === "freeze"  && trait === "Swift") return target;
        if (status === "confuse" && trait === "Lucky") return target;
        if (rounds <= 0) return target;
        switch (status) {
            case "burn":    return { ...target, burnRounds: Math.max(target.burnRounds, rounds), burnDamage: Math.max(target.burnDamage, burnDmgIfBurn), attackBuff: target.attackBuff - 2 };
            case "freeze":  return { ...target, freezeRounds: Math.max(target.freezeRounds, rounds) };
            case "confuse": return { ...target, confuseRounds: Math.max(target.confuseRounds, rounds) };
            case "stun":    return { ...target, stunRounds: Math.max(target.stunRounds, rounds) };
        }
    }

    // Outer-scope memory of the opposing slot most recently attacked by
    // each side. Updated as a side-effect of act() so the round loop can
    // pass it as partnerFocusSlot for the same side's next actor.
    let lastOpposingAttacked: PartySlot | undefined;

    // ── Per-actor turn (4v4 act) ──────────────────────────────────
    // partnerFocusSlot: the opposing-team slot that the actor's TEAMMATE
    // just attacked this round. Adds a focus-fire bias to the target
    // picker so partners converge on a single KO instead of splitting
    // damage. Caller passes whichever opponent the same-side ally last
    // attacked (undefined for the first actor of each side).
    function act(actorSlot: PartySlot, round: number, partnerFocusSlot?: PartySlot): void {
        lastOpposingAttacked = undefined; // reset for this actor
        const actor = fighters[actorSlot]!;
        const actorIsPlayer = isPlayerSlot(actorSlot);

        // Helper: call when an opposing slot is the target of this action.
        // Sets the closure-level variable that the round loop reads after
        // act() returns to thread focus-fire to the partner.
        function noteAttack(slot: PartySlot) {
            if (isPlayerSlot(slot) !== actorIsPlayer) lastOpposingAttacked = slot;
        }

        // Pre-action status checks (stun / freeze / confuse).
        if (actor.stunRounds > 0) {
            const msg = `Round ${round}: ${actor.pet.name} is stunned — turn skipped.`;
            logs.push(msg);
            pushPartyFrame(round, msg, actorSlot, "movelock");
            return;
        }
        if (actor.freezeRounds > 0 && rng() < 0.5) {
            const msg = `Round ${round}: ${actor.pet.name} is frozen solid — turn skipped.`;
            logs.push(msg);
            pushPartyFrame(round, msg, actorSlot, "movelock");
            return;
        }
        if (actor.confuseRounds > 0 && rng() < 0.5) {
            const selfHit = Math.max(1, Math.floor(actor.pet.attack * 0.4));
            fighters[actorSlot] = { ...actor, hp: Math.max(0, actor.hp - selfHit) };
            const msg = `Round ${round}: ${actor.pet.name} is confused and hits itself for ${selfHit}!`;
            logs.push(msg);
            pushPartyFrame(round, msg, actorSlot, "damage", selfHit, false, undefined, undefined, fighters[actorSlot]!.hp <= 0);
            return;
        }

        // Pick a provisional target — used to filter "in range" jutsus.
        // We pick a damage-target first (for the AI selection's purposes),
        // then re-pick if the chosen jutsu is heal/buff (ally-targeted).
        // partnerFocusSlot weights the picker toward the slot our teammate
        // just attacked, so partners converge on focus-fire.
        // Phase 12: a taunted pet is forced to attack the specific taunter (if it
        // is still alive on the opposing side); otherwise pick by archetype.
        const tauntSlot = actor.tauntedRounds > 0
            ? ALL_SLOTS.find(s => { const f = fighters[s]; return !!f && f.hp > 0 && isPlayerSlot(s) !== actorIsPlayer && f.pet.id === actor.tauntById; })
            : undefined;
        // Taunt forces the target; otherwise the team bond's stick/split focus
        // wins when it applies; otherwise fall back to the archetype / HP pickers.
        const damageTargetSlot = tauntSlot
            ?? synergyFocusSlot(actorSlot, partnerFocusSlot)
            ?? pickArchetypeTargetSlot(actorSlot)
            ?? pickTargetSlot(actorSlot, "damage", partnerFocusSlot);
        if (!damageTargetSlot) return; // no opposing pets left — shouldn't happen, loop checks first
        const damageTarget = fighters[damageTargetSlot]!;
        const dist = tileDistance(actor.pos, damageTarget.pos);

        // Pass obstacles so the AI filters out ranged jutsus blocked by
        // line-of-sight. When all ranged options are blocked the AI gets
        // null back and falls into the movement branch below, which uses
        // BFS to route around obstacles into a firing position.
        const chosen = choosePetActionSmart(actor, damageTarget, round, dist, obstacles);
        if (!chosen) {
            // Movement fallback: advance toward damage target.
            if (actor.moveLocked === 0) {
                // Dynamic blockers: static obstacles PLUS every other live
                // fighter's tile, so two pets never stack on the same square.
                // The damage target's own square stays walkable so BFS can
                // route to it — the existing `next === damageTarget.pos`
                // break stops the actor one tile short.
                const blockers = new Set<number>(obstacles);
                for (const s of ALL_SLOTS) {
                    if (s === actorSlot) continue;
                    const f = fighters[s];
                    if (!f || f.hp <= 0) continue;
                    if (f.pos === damageTarget.pos) continue;
                    blockers.add(f.pos);
                }
                let newPos = actor.pos;
                // Slow tiles (mud) cut a step, like the 1v1 engine.
                const moveSteps = Math.max(1, (actor.pet.moveRange ?? 2) - (slowTiles.has(actor.pos) ? 1 : 0));
                // Detour to grab an un-claimed power shrine if one is on the way.
                const goal = petShrineSeekGoal(actor.pos, damageTarget.pos, pickups);
                for (let s = 0; s < moveSteps; s++) {
                    const next = bfsNextStep(newPos, goal, blockers);
                    if (next === newPos || next === goal || next === damageTarget.pos) break;
                    // Extra guard: never step onto a tile another live pet
                    // already occupies, even if BFS somehow picked it
                    // (e.g. if the target's tile is the only path).
                    if (ALL_SLOTS.some(s2 => s2 !== actorSlot && fighters[s2] && fighters[s2]!.hp > 0 && fighters[s2]!.pos === next)) break;
                    newPos = next;
                }
                fighters[actorSlot] = { ...actor, pos: newPos };
                const msg = `Round ${round}: ${actor.pet.name} advances toward ${damageTarget.pet.name}.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "move", undefined, undefined, undefined, undefined, undefined, damageTargetSlot);
            }
            return;
        }
        if (chosen === "basic") {
            noteAttack(damageTargetSlot);
            // Innate speed evasion — a faster defender slips the blow entirely.
            // Bush concealment (evadeRounds) adds +25%, matching the 1v1 engine.
            if (rng() < petEvadeChance(actor, damageTarget) + (damageTarget.evadeRounds > 0 ? 0.25 : 0)) {
                const emsg = `Round ${round}: ${damageTarget.pet.name} blurs out of reach — evades ${actor.pet.name}'s attack!`;
                logs.push(emsg);
                pushPartyFrame(round, emsg, damageTargetSlot, "basic", undefined, false, { actor: isPlayerSlot(damageTargetSlot) ? "player" : "enemy", trait: "petEvade" }, undefined, false, damageTargetSlot);
                return;
            }
            const dmgRaw = actor.pet.attack + actor.attackBuff - (damageTarget.pet.defense + damageTarget.defenseBuff) * 0.45;
            const tamerMult = actorIsPlayer ? playerDamageMult : 1;
            const elementMult = petElementMultiplier(actor.pet, damageTarget.pet);
            // PVP gear: attacker execute vs low-HP foe + target last-stand reduction.
            const executeMult = petGearExecuteMult(actor.pet, damageTarget.hp, damageTarget.pet.hp);
            const lastStandMult = petGearLastStandMult(damageTarget.pet, damageTarget.hp, damageTarget.pet.hp);
            const crit = rng() < petCritChance(actor, damageTarget);
            const variance = petDamageVariance(rng);
            const baseDmg = Math.max(1, Math.floor(dmgRaw * (crit ? PET_CRIT_MULT : 1) * variance * tamerMult * elementMult * executeMult * lastStandMult));
            // Reactive consumable pre-hit (dodge / mitigate).
            const pre = petReactivePreHit(damageTarget, baseDmg);
            if (pre.dodged) {
                fighters[damageTargetSlot] = pre.defender;
                const dmsg = `Round ${round}: ${damageTarget.pet.name} dodges ${actor.pet.name}'s attack!${pre.note}`;
                logs.push(dmsg);
                pushPartyFrame(round, dmsg, damageTargetSlot, "basic", undefined, false, { actor: isPlayerSlot(damageTargetSlot) ? "player" : "enemy", trait: "consumDodge" }, undefined, false, damageTargetSlot);
                return;
            }
            const dmg = pre.damage;
            const preHitHp = damageTarget.hp;
            // PVP gear procs: poison-on-hit + lifesteal on the basic attack.
            let hitTarget = { ...pre.defender, hp: Math.max(0, pre.defender.hp - dmg) };
            let procNote = pre.note;
            const dot = petGearDotOnHit(actor.pet);
            if (dot) { hitTarget = { ...hitTarget, dotDamage: dot.damage, dotRounds: dot.rounds }; procNote += " ☠️ Poisoned!"; }
            let hitActor = actor;
            const lsHeal = petGearLifestealHeal(actor.pet, dmg);
            if (lsHeal > 0) { hitActor = { ...hitActor, hp: Math.min(hitActor.pet.hp, hitActor.hp + lsHeal) }; procNote += ` 🩸 +${lsHeal} HP`; }
            // Reactive consumable post-hit (thorns / endure / lifeline).
            const post = petReactivePostHit(hitActor, hitTarget, preHitHp, dmg);
            fighters[damageTargetSlot] = post.defender;
            fighters[actorSlot] = post.attacker;
            procNote += post.note;
            const consFlashKey = post.flash ?? pre.flash;
            const basicFlash: PetArenaFrame["traitFlash"] = consFlashKey ? { actor: isPlayerSlot(damageTargetSlot) ? "player" : "enemy", trait: consFlashKey } : undefined;
            const elementNote = elementMult > 1 ? " 🔆 Super effective!" : elementMult < 1 ? " ⛔ Resisted." : "";
            const msg = `Round ${round}: ${actor.pet.name} basic-attacks ${damageTarget.pet.name} for ${dmg} damage${crit ? " — CRITICAL HIT!" : ""}.${elementNote}${procNote}`;
            logs.push(msg);
            pushPartyFrame(round, msg, actorSlot, "basic", dmg, crit, basicFlash, undefined, fighters[damageTargetSlot]!.hp <= 0, damageTargetSlot);
            return;
        }
        // The 2v2 party engine opts out of base tactical actions (it calls
        // choosePetActionSmart with allowBaseActions=false), so a base-action
        // string never reaches here — this guard narrows `chosen` to a jutsu.
        if (chosen === "guard" || chosen === "evade" || chosen === "focus" || chosen === "brace") return;

        // Resolve actual target slot based on jutsu kind.
        const allyKinds = new Set<PetJutsu["kind"]>(["heal", "buff", "barrier", "shield", "absorb"]);
        const targetSlot = allyKinds.has(chosen.kind) ? pickTargetSlot(actorSlot, chosen.kind, partnerFocusSlot) : damageTargetSlot;
        if (!targetSlot) return;
        const target = fighters[targetSlot]!;
        const targetIsAlly = isPlayerSlot(targetSlot) === actorIsPlayer;
        // Mark for partner focus-fire if this action hits an opponent.
        noteAttack(targetSlot);
        const cdActor = { ...actor, cooldowns: { ...actor.cooldowns, [chosen.name]: Math.max(1, chosen.cooldown) } };
        fighters[actorSlot] = cdActor;

        // Helper for damage application — mirrors the 1v1 engine path.
        function applyDmg(rawDmg: number, jutsuName: string, kind: "damage" | "basic") {
            const luckyDodgeRoll = target.pet.trait === "Lucky" && rng() < 0.10;
            if (luckyDodgeRoll) {
                const msg = `Round ${round}: ${target.pet.name}'s Lucky instinct dodges ${actor.pet.name}'s ${jutsuName}!`;
                logs.push(msg);
                pushPartyFrame(round, msg, targetSlot!, kind, undefined, undefined, { actor: isPlayerSlot(targetSlot!) ? "player" : "enemy", trait: "Lucky" }, undefined, undefined, targetSlot!);
                return;
            }
            // Consumable: charged dodge fully negates the attack, then ticks down.
            if ((target.consDodge ?? 0) > 0) {
                fighters[targetSlot!] = { ...target, consDodge: (target.consDodge ?? 0) - 1 };
                const msg = `Round ${round}: ${target.pet.name} dodges ${actor.pet.name}'s ${jutsuName}!`;
                logs.push(msg);
                pushPartyFrame(round, msg, targetSlot!, kind, undefined, undefined, { actor: isPlayerSlot(targetSlot!) ? "player" : "enemy", trait: "consumDodge" }, undefined, undefined, targetSlot!);
                return;
            }
            // Innate speed evasion — a faster defender slips the blow entirely.
            // Phase 12: Haste adds dodge, Slow removes it (mirrors the 1v1 engine).
            // Bush concealment (evadeRounds) adds +25%, matching the 1v1 evadeBonus.
            const evadeMod = (target.evadeRounds > 0 ? 0.25 : 0) + (target.hasteRounds > 0 ? 0.12 : 0) - (target.slowRounds > 0 ? 0.1 : 0);
            if (rng() < petEvadeChance(actor, target) + evadeMod) {
                const msg = `Round ${round}: ${target.pet.name} blurs out of reach — evades ${actor.pet.name}'s ${jutsuName}!`;
                logs.push(msg);
                pushPartyFrame(round, msg, targetSlot!, kind, undefined, undefined, { actor: isPlayerSlot(targetSlot!) ? "player" : "enemy", trait: "petEvade" }, undefined, undefined, targetSlot!);
                return;
            }
            const crit = rng() < petCritChance(actor, target);
            const variance = petDamageVariance(rng);
            const dmgBonus = actor.pet.trait === "Battleborn" ? 1.10 : 1.0;
            const guardianBlock = target.pet.trait === "Guardian" ? 0.85 : 1.0;
            const absorbMult = target.absorbRounds > 0 ? (1 - target.absorbPercent) : 1;
            const tamerMult = actorIsPlayer ? playerDamageMult : 1;
            const elementMult = petElementMultiplier(actor.pet, target.pet);
            // PVP gear: attacker execute vs low-HP foe + target last-stand reduction.
            const executeMult = petGearExecuteMult(actor.pet, target.hp, target.pet.hp);
            const lastStandMult = petGearLastStandMult(target.pet, target.hp, target.pet.hp);
            // Consumable: Smoke Pellet reduces this hit (spent below).
            const mitigateMult = (target.consMitigate ?? 0) > 0 ? (1 - (target.consMitigate ?? 0) / 100) : 1;
            // Phase 12: Mark amplifies the next damage hit (spent below).
            const markMult = target.markedRounds > 0 ? 1.3 : 1;
            const damage = Math.max(1, Math.floor(rawDmg * (crit ? PET_CRIT_MULT : 1) * variance * dmgBonus * guardianBlock * absorbMult * tamerMult * elementMult * executeMult * lastStandMult * mitigateMult * markMult));
            const shieldAbsorb = Math.min(target.shieldHp, damage);
            const remainDamage = damage - shieldAbsorb;
            const preHitHp = target.hp;
            let hitTarget = { ...target, hp: Math.max(0, target.hp - remainDamage), shieldHp: target.shieldHp - shieldAbsorb };
            if (mitigateMult < 1) hitTarget = { ...hitTarget, consMitigate: 0 };
            if (markMult > 1) hitTarget = { ...hitTarget, markedRounds: 0 }; // mark is spent on the amplified hit
            // Reactive consumable post-hit (thorns / endure / lifeline).
            const post = petReactivePostHit(fighters[actorSlot]!, hitTarget, preHitHp, remainDamage > 0 ? damage : 0);
            fighters[targetSlot!] = post.defender;
            fighters[actorSlot] = post.attacker;
            const elementNote = elementMult > 1 ? " 🔆 Super effective!" : elementMult < 1 ? " ⛔ Resisted." : "";
            const consNote = `${mitigateMult < 1 ? ` 💨 ${target.pet.name} blunts the blow!` : ""}${post.note}`;
            const msg = `Round ${round}: ${actor.pet.name} uses ${jutsuName} on ${target.pet.name} for ${damage} damage${crit ? " — CRITICAL HIT!" : ""}.${elementNote}${consNote}`;
            logs.push(msg);
            const consFlashKey = post.flash ?? (mitigateMult < 1 ? "consumBlock" : undefined);
            const traitFlash: PetArenaFrame["traitFlash"] =
                consFlashKey                               ? { actor: isPlayerSlot(targetSlot!) ? "player" : "enemy", trait: consFlashKey } :
                (crit && actor.pet.trait === "Aggressive") ? { actor: actorIsPlayer ? "player" : "enemy", trait: "Aggressive" } :
                (guardianBlock < 1)                        ? { actor: isPlayerSlot(targetSlot!) ? "player" : "enemy", trait: "Guardian"   } :
                (dmgBonus > 1 && actor.pet.trait === "Battleborn") ? { actor: actorIsPlayer ? "player" : "enemy", trait: "Battleborn" } :
                undefined;
            const sigMove: PetArenaFrame["signatureMove"] = (jutsuName === petSignatureJutsu(actor.pet))
                ? { name: jutsuName, petName: actor.pet.name, side: actorIsPlayer ? "player" : "enemy", flagship: actor.pet.rarity === "mythic" }
                : undefined;
            pushPartyFrame(round, msg, actorSlot, kind, damage, crit, traitFlash, undefined, fighters[targetSlot!]!.hp <= 0, targetSlot!, sigMove);
        }

        switch (chosen.kind) {
            case "heal": {
                if (!targetIsAlly) return;
                // ×0.6 to match the 1v1 heal formula (was full power in 2v2, making
                // 2v2 heals ~1.67× stronger than 1v1 for the same jutsu).
                const healed = Math.min(target.pet.hp, target.hp + Math.floor(chosen.power * 0.6 * (target.woundRounds > 0 ? 0.5 : 1)));
                fighters[targetSlot] = { ...target, hp: healed };
                const msg = targetSlot === actorSlot
                    ? `Round ${round}: ${actor.pet.name} heals itself for ${healed - target.hp} HP.`
                    : `Round ${round}: ${actor.pet.name} heals ally ${target.pet.name} for ${healed - target.hp} HP.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "heal", healed - target.hp, false, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "buff": {
                // Match the 1v1 buff formula (+power/2 ATK, +power/3 DEF) — 2v2 was
                // +power ATK / +power/2 DEF, ~2× the ATK gain for the same jutsu.
                const atkGain = Math.max(1, Math.floor(chosen.power / 2));
                const defGain = Math.max(1, Math.floor(chosen.power / 3));
                fighters[actorSlot] = { ...cdActor, attackBuff: cdActor.attackBuff + atkGain, defenseBuff: cdActor.defenseBuff + defGain };
                const msg = `Round ${round}: ${actor.pet.name} buffs itself (+${atkGain} ATK, +${defGain} DEF).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "buff");
                return;
            }
            case "barrier": {
                fighters[actorSlot] = { ...cdActor, shieldHp: cdActor.shieldHp + chosen.power };
                const msg = `Round ${round}: ${actor.pet.name} raises a barrier for ${chosen.power} HP.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "barrier");
                return;
            }
            case "shield": {
                const shieldAmt = Math.max(5, Math.floor(chosen.power * 0.45));
                fighters[actorSlot] = { ...cdActor, shieldHp: cdActor.shieldHp + shieldAmt };
                const msg = `Round ${round}: ${actor.pet.name} forms a ward (${shieldAmt} HP).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "shield");
                return;
            }
            case "absorb": {
                fighters[actorSlot] = { ...cdActor, absorbRounds: 3, absorbPercent: 0.35 };
                const msg = `Round ${round}: ${actor.pet.name} enters absorb stance (3 rounds, −35% damage).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "absorb");
                return;
            }
            case "debuff": {
                const battlebornCut = target.pet.trait === "Battleborn" ? 0.5 : 1;
                const atkCut = Math.max(1, Math.floor((chosen.power / 4) * battlebornCut));
                const defCut = Math.max(1, Math.floor((chosen.power / 5) * battlebornCut));
                fighters[targetSlot] = { ...target, attackBuff: target.attackBuff - atkCut, defenseBuff: target.defenseBuff - defCut };
                const msg = `Round ${round}: ${actor.pet.name} weakens ${target.pet.name} (−${atkCut} ATK, −${defCut} DEF).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "debuff", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "movelock": {
                fighters[targetSlot] = { ...target, moveLocked: target.moveLocked + 2 };
                const msg = `Round ${round}: ${actor.pet.name} pins ${target.pet.name} (movelock 2 rounds).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "movelock", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "dot": {
                const baseDot = Math.max(1, Math.floor(chosen.power * 0.28));
                const dotDmg = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(baseDot * 0.5)) : baseDot;
                fighters[targetSlot] = { ...target, dotDamage: dotDmg, dotRounds: 3 };
                const msg = `Round ${round}: ${actor.pet.name} poisons ${target.pet.name} for ${dotDmg}/round (3 rounds).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "dot", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "burn": {
                const burnDmg = Math.max(1, Math.floor(chosen.power * 0.15));
                const effectiveBurn = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(burnDmg * 0.5)) : burnDmg;
                const burnRounds = Math.max(1, chosen.rounds ?? 2);
                fighters[targetSlot] = applyStatusToFighter(target, "burn", burnRounds, effectiveBurn);
                const msg = `Round ${round}: 🔥 ${actor.pet.name} burns ${target.pet.name} for ${effectiveBurn}/round.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "dot", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "freeze": {
                const rounds = Math.max(1, chosen.rounds ?? 2);
                fighters[targetSlot] = applyStatusToFighter(target, "freeze", rounds);
                const msg = `Round ${round}: 🧊 ${actor.pet.name} freezes ${target.pet.name}.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "movelock", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "confuse": {
                const rounds = Math.max(1, chosen.rounds ?? 2);
                fighters[targetSlot] = applyStatusToFighter(target, "confuse", rounds);
                const msg = `Round ${round}: 🌀 ${actor.pet.name} confuses ${target.pet.name}.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "debuff", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "stun": {
                const baseRounds = Math.max(1, chosen.rounds ?? 1);
                const reduced = target.pet.trait === "Aggressive" ? baseRounds - 1 : baseRounds;
                if (reduced <= 0) {
                    const msg = `Round ${round}: ${target.pet.name}'s Aggressive rage shrugs off ${actor.pet.name}'s ${chosen.name}.`;
                    logs.push(msg);
                    pushPartyFrame(round, msg, targetSlot, "buff", undefined, undefined, { actor: isPlayerSlot(targetSlot) ? "player" : "enemy", trait: "Aggressive" }, undefined, undefined, targetSlot);
                    return;
                }
                fighters[targetSlot] = applyStatusToFighter(target, "stun", reduced);
                const msg = `Round ${round}: 💤 ${actor.pet.name} stuns ${target.pet.name}.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "movelock", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "crush": {
                const battlebornCut = target.pet.trait === "Battleborn" ? 0.5 : 1;
                const atkCut = Math.max(1, Math.floor((chosen.power / 3) * battlebornCut));
                const defCut = Math.max(1, Math.floor((chosen.power / 4) * battlebornCut));
                const rawDmg = actor.pet.attack + actor.attackBuff + (chosen.power * 0.5) - (target.pet.defense + target.defenseBuff) * 0.5;
                applyDmg(rawDmg, chosen.name, "damage");
                // Apply strip only if target survived the damage portion.
                const after = fighters[targetSlot]!;
                if (after.hp > 0) {
                    fighters[targetSlot] = { ...after, attackBuff: after.attackBuff - atkCut, defenseBuff: after.defenseBuff - defCut };
                    const msg2 = `Round ${round}: 🌍 ${actor.pet.name}'s crush strips ${atkCut} ATK / ${defCut} DEF.`;
                    logs.push(msg2);
                    pushPartyFrame(round, msg2, actorSlot, "debuff", undefined, undefined, undefined, undefined, undefined, targetSlot);
                }
                return;
            }
            case "lifesteal": {
                const rawDmg = actor.pet.attack + actor.attackBuff + chosen.power - (target.pet.defense + target.defenseBuff) * 0.5;
                const preHp = target.hp;
                applyDmg(rawDmg, chosen.name, "damage");
                const after = fighters[targetSlot]!;
                const actualDmg = Math.max(0, preHp - after.hp);
                const steal = Math.max(1, Math.floor(actualDmg * 0.40));
                // Heal from the POST-hit attacker: applyDmg may have written
                // thorns/reflect damage (or a KO) into fighters[actorSlot].
                // Rebuilding from the pre-hit cdActor snapshot erased that and
                // could even revive a thorns-killed attacker. (1v1 path heals
                // from returnedActor — the post-hit actor — and is correct.)
                const lsActor = fighters[actorSlot]!;
                fighters[actorSlot] = { ...lsActor, hp: Math.min(lsActor.pet.hp, lsActor.hp + steal) };
                return;
            }
            // ── Phase 12 archetype kinds (2v2) ─────────────────────────
            case "wound": {
                const baseW = Math.max(1, Math.floor(chosen.power * 0.22));
                const wDmg = target.pet.trait === "Guardian" ? Math.max(1, Math.floor(baseW * 0.5)) : baseW;
                const wRounds = Math.max(2, chosen.rounds ?? 3);
                fighters[targetSlot] = { ...target, woundRounds: Math.max(target.woundRounds, wRounds), woundDamage: Math.max(target.woundDamage, wDmg) };
                const msg = `Round ${round}: ${actor.pet.name} wounds ${target.pet.name} for ${wDmg}/round (halved healing).`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "dot", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "mark": {
                const mRounds = Math.max(2, chosen.rounds ?? 2);
                fighters[targetSlot] = { ...target, markedRounds: Math.max(target.markedRounds, mRounds) };
                const msg = `Round ${round}: ${actor.pet.name} marks ${target.pet.name} — its next heavy hit bites deeper.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "debuff", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "slow": {
                const sRounds = Math.max(1, chosen.rounds ?? 2);
                fighters[targetSlot] = { ...target, slowRounds: Math.max(target.slowRounds, sRounds) };
                const msg = `Round ${round}: ${actor.pet.name} slows ${target.pet.name}.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "movelock", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "haste": {
                const hRounds = Math.max(1, chosen.rounds ?? 2);
                fighters[actorSlot] = { ...cdActor, hasteRounds: Math.max(cdActor.hasteRounds, hRounds) };
                const msg = `Round ${round}: ${actor.pet.name} surges with haste.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "buff");
                return;
            }
            case "taunt": {
                const tRounds = Math.max(1, chosen.rounds ?? 2);
                fighters[targetSlot] = { ...target, tauntedRounds: Math.max(target.tauntedRounds, tRounds), tauntById: actor.pet.id };
                const msg = `Round ${round}: ${actor.pet.name} taunts ${target.pet.name}, drawing its aggression.`;
                logs.push(msg);
                pushPartyFrame(round, msg, actorSlot, "debuff", undefined, undefined, undefined, undefined, undefined, targetSlot);
                return;
            }
            case "push":
            case "pull": {
                const rawDmg = actor.pet.attack + actor.attackBuff + (chosen.power * 0.5) - (target.pet.defense + target.defenseBuff) * 0.5;
                applyDmg(rawDmg, chosen.name, "damage");
                const after = fighters[targetSlot]!;
                if (after.hp > 0 && after.braceRounds <= 0) {
                    const newPos = chosen.kind === "push"
                        ? bfsStepAway(after.pos, actor.pos, obstacles)
                        : (() => { const n = bfsNextStep(after.pos, actor.pos, obstacles); return n === actor.pos ? after.pos : n; })();
                    if (newPos !== after.pos) {
                        fighters[targetSlot] = { ...after, pos: newPos };
                        logs.push(`Round ${round}: ${target.pet.name} is ${chosen.kind === "push" ? "shoved back" : "dragged in"}.`);
                    }
                }
                return;
            }
            case "damage":
            default: {
                const rawDmg = actor.pet.attack + actor.attackBuff + chosen.power - (target.pet.defense + target.defenseBuff) * 0.5;
                applyDmg(rawDmg, chosen.name, "damage");
                return;
            }
        }
    }

    // ── Main round loop ───────────────────────────────────────────
    const liveSlots = (): PartySlot[] => ALL_SLOTS.filter(isAlive);
    const playerLiving = (): number => liveSlots().filter(isPlayerSlot).length;
    const enemyLiving  = (): number => liveSlots().filter(s => !isPlayerSlot(s)).length;

    for (let round = 1; round <= 30 && playerLiving() > 0 && enemyLiving() > 0; round += 1) {
        // tick status counters on all live fighters
        for (const s of liveSlots()) fighters[s] = tick(fighters[s]!);

        // Cleansing Incense — purge afflictions on any fighter holding a charge.
        for (const s of liveSlots()) {
            const f = fighters[s]!;
            const afflicted = f.dotRounds > 0 || f.burnRounds > 0 || f.freezeRounds > 0 || f.confuseRounds > 0 || f.stunRounds > 0;
            if ((f.consCleanse ?? 0) > 0 && afflicted) {
                fighters[s] = { ...f, dotRounds: 0, dotDamage: 0, burnRounds: 0, burnDamage: 0, freezeRounds: 0, confuseRounds: 0, stunRounds: 0, consCleanse: (f.consCleanse ?? 0) - 1 };
                pushPartyFrame(round, `${f.pet.name} burns away every affliction with Cleansing Incense!`, s, "buff", undefined, undefined, { actor: isPlayerSlot(s) ? "player" : "enemy", trait: "consumCleanse" });
            }
        }

        // DoT (poison + burn) damage
        for (const s of liveSlots()) {
            const f = fighters[s]!;
            if (f.dotRounds > 0) {
                fighters[s] = { ...f, hp: Math.max(0, f.hp - f.dotDamage), dotRounds: f.dotRounds - 1 };
                pushPartyFrame(round, `${f.pet.name} writhes in poison — ${f.dotDamage} damage.`, s, "dot", f.dotDamage);
            }
            const g = fighters[s]!;
            if (g.burnRounds > 0 && g.burnDamage > 0) {
                fighters[s] = { ...g, hp: Math.max(0, g.hp - g.burnDamage), burnRounds: g.burnRounds - 1 };
                pushPartyFrame(round, `🔥 ${g.pet.name} burns for ${g.burnDamage} damage.`, s, "dot", g.burnDamage);
            }
            // Phase 12: wound bleed (ticks its own counter, like burn).
            const w = fighters[s]!;
            if (w.woundRounds > 0 && w.woundDamage > 0) {
                fighters[s] = { ...w, hp: Math.max(0, w.hp - w.woundDamage), woundRounds: w.woundRounds - 1 };
                pushPartyFrame(round, `🩸 ${w.pet.name} bleeds for ${w.woundDamage} damage.`, s, "dot", w.woundDamage);
            }
        }
        if (playerLiving() === 0 || enemyLiving() === 0) break;

        // Initiative — faster pets act earlier, but a per-pet random jitter
        // keeps the order from being perfectly rigid (so Speed matters without
        // fully rigging the round). Seeded so synced battles stay in sync.
        const order = liveSlots();
        const initKey = new Map(order.map((s) => [s, fighters[s]!.pet.speed * (0.8 + rng() * 0.4)]));
        order.sort((a, b) => (initKey.get(b) ?? 0) - (initKey.get(a) ?? 0));
        // Track the last opposing slot each side attacked this round.
        // Passed to subsequent same-side actors as partnerFocusSlot so
        // partners converge their focus-fire on the same target.
        const lastTargetBySide: { player?: PartySlot; enemy?: PartySlot } = {};
        for (const slot of order) {
            if (!isAlive(slot)) continue;
            const oppLiving = livingOpposing(slot);
            if (oppLiving.length === 0) break;
            const sideKey: "player" | "enemy" = isPlayerSlot(slot) ? "player" : "enemy";
            const focusHint = lastTargetBySide[sideKey];
            // act() sets lastOpposingAttacked as a side-effect when it
            // attacks an opposing slot. Reset before the call (act does
            // this internally too) and read after.
            act(slot, round, focusHint);
            if (lastOpposingAttacked) {
                lastTargetBySide[sideKey] = lastOpposingAttacked;
            }
            // Flurry — a faster pet may immediately act again (Swift amplifies).
            if (isAlive(slot) && livingOpposing(slot).length > 0) {
                const oppSpeeds = livingOpposing(slot).map((o) => fighters[o]!.pet.speed);
                const avgOpp = oppSpeeds.reduce((sum, v) => sum + v, 0) / Math.max(1, oppSpeeds.length);
                if (rng() < petFlurryChance(fighters[slot]!.pet.speed, avgOpp, fighters[slot]!.pet.trait === "Swift")) {
                    logs.push(`Round ${round}: ${fighters[slot]!.pet.name} blurs into a flurry — bonus action!`);
                    act(slot, round, lastTargetBySide[sideKey]);
                    if (lastOpposingAttacked) lastTargetBySide[sideKey] = lastOpposingAttacked;
                }
            }
        }

        // End-of-round tile effects (parity with 1v1) — hazard chips, healing
        // restores (≈4% maxHp) for every pet standing on bad/good ground.
        for (const s of ALL_SLOTS) {
            const f = fighters[s];
            if (!f || f.hp <= 0) continue;
            const onHazard = hazardTiles.has(f.pos), onHeal = healingTiles.has(f.pos);
            if (!onHazard && !onHeal) continue;
            const mhp = Math.max(1, f.pet.hp || 0);
            const amt = Math.max(2, Math.floor(mhp * 0.04));
            fighters[s] = { ...f, hp: onHazard ? Math.max(0, f.hp - amt) : Math.min(mhp, f.hp + amt) };
            logs.push(`Round ${round}: ${f.pet.name} ${onHazard ? `is scorched by the hazard for ${amt}` : `recovers ${amt} on the healing field`}.`);
        }

        // High-ground ward (terrain depth) — every pet holding the central high
        // ground at round end tops up a protective shield (refreshed, not stacked).
        for (const s of ALL_SLOTS) {
            const f = fighters[s];
            if (!f || f.hp <= 0 || !highGroundTiles.has(f.pos)) continue;
            const ward = Math.max(2, Math.floor(Math.max(1, f.pet.hp || 0) * 0.08));
            if (f.shieldHp < ward) {
                fighters[s] = { ...f, shieldHp: ward };
                logs.push(`Round ${round}: ${f.pet.name} holds the high ground — warded (${ward}).`);
            }
        }

        // Power pickups — the nearest pet within reach (≤1 tile) of a shrine
        // claims a one-time attack surge + small restore, then it's consumed.
        for (const tile of [...pickups]) {
            let bestSlot: PartySlot | undefined, bestD = Infinity;
            for (const s of ALL_SLOTS) {
                const f = fighters[s];
                if (!f || f.hp <= 0) continue;
                const d = tileDistance(f.pos, tile);
                if (d < bestD) { bestD = d; bestSlot = s; }
            }
            if (!bestSlot || bestD > 1) continue;
            const f = fighters[bestSlot]!;
            const mhp = Math.max(1, f.pet.hp || 0);
            fighters[bestSlot] = { ...f, attackBuff: f.attackBuff + Math.max(3, Math.floor((f.pet.attack || 0) * 0.2)), hp: Math.min(mhp, f.hp + Math.floor(mhp * 0.1)) };
            logs.push(`Round ${round}: ${f.pet.name} claims a power shrine — empowered!`);
            pickups.delete(tile);
        }

        // Bush concealment — a pet ending the round in tall grass refreshes its
        // evasion (2 so it survives next round's status tick into the hit phase).
        for (const s of ALL_SLOTS) {
            const f = fighters[s];
            if (f && f.hp > 0 && bushTiles.has(f.pos) && f.evadeRounds < 2) fighters[s] = { ...f, evadeRounds: 2 };
        }

        // Round summary frame
        const summary = `Round ${round} — You: ${playerLiving()} alive | Opponent: ${enemyLiving()} alive`;
        logs.push(summary);
        pushPartyFrame(round, summary, "system", undefined);
    }

    // ── Resolve set result ─────────────────────────────────────────
    const playerAlive = playerLiving();
    const enemyAlive  = enemyLiving();
    let result: "win" | "loss" | "draw";
    if (playerAlive > 0 && enemyAlive === 0) result = "win";
    else if (enemyAlive > 0 && playerAlive === 0) result = "loss";
    else if (playerAlive === 0 && enemyAlive === 0) result = "draw";
    else {
        // 30-round cap, both sides have living pets. HP% tiebreak.
        const sumHpPct = (slots: PartySlot[]) => slots.reduce((acc, s) => {
            const f = fighters[s]; if (!f) return acc;
            return acc + (f.hp / Math.max(1, f.pet.hp));
        }, 0);
        const myPct = sumHpPct(ALL_SLOTS.filter(isPlayerSlot));
        const enPct = sumHpPct(ALL_SLOTS.filter(s => !isPlayerSlot(s)));
        if (Math.abs(myPct - enPct) < 0.1) result = "draw";
        else result = myPct > enPct ? "win" : "loss";
    }

    // Wins-counted = number of opposing pets KO'd (drives reward grants).
    const playerWins = (opponentParty.filter(Boolean).length) - enemyAlive;
    const opponentWins = (playerParty.filter(Boolean).length) - playerAlive;

    const finalMsg = result === "win" ? "You win the 2v2 set!" : result === "loss" ? "Opponent wins the 2v2 set." : "2v2 set ends in a draw.";
    logs.push(finalMsg);
    summaryLogs.push(finalMsg);
    pushPartyFrame(31, finalMsg, "system", "result");

    // Build matches[] — one entry per pet pairing (same slot index), with
    // result reflecting whether the opposing slot survived. ALL logs+frames
    // live in matches[0]; matches[1] is metadata-only. This preserves the
    // existing PetPartyBattleResult shape so consumers (PetArena UI +
    // /api/pet/battle-result loop) keep working.
    const matches: PetPartyBattleMatch[] = [];
    for (let slot = 0; slot < 2; slot++) {
        const mine = playerParty[slot];
        const theirs = opponentParty[slot];
        const mineSlot: PartySlot = slot === 0 ? "playerLead" : "playerReserve";
        const theirsSlot: PartySlot = slot === 0 ? "enemyLead" : "enemyReserve";
        const mineAlive = mine ? isAlive(mineSlot) : false;
        const theirsAlive = theirs ? isAlive(theirsSlot) : false;
        let matchResult: PetPartyBattleMatch["result"];
        if (!mine && !theirs) matchResult = "draw";
        else if (!mine) matchResult = "forfeit-player";
        else if (!theirs) matchResult = "forfeit-opponent";
        else if (mineAlive && !theirsAlive) matchResult = "win";
        else if (!mineAlive && theirsAlive) matchResult = "loss";
        else matchResult = "draw";
        matches.push({
            playerPet: mine ?? null,
            opponentPet: theirs ?? null,
            result: matchResult,
            playerHpRemaining: mine && fighters[mineSlot] ? fighters[mineSlot]!.hp : 0,
            enemyHpRemaining:  theirs && fighters[theirsSlot] ? fighters[theirsSlot]!.hp : 0,
            // Put the entire battle's logs+frames on slot 0; slot 1 is empty.
            logs:   slot === 0 ? logs   : [],
            frames: slot === 0 ? frames : [],
            obstacles: slot === 0 ? Array.from(obstacles) : [],
            tiles: slot === 0 ? arenaTiles.tiles : [],
        });
    }

    return { result, matches, playerWins, opponentWins, draws: 0, summaryLogs };
}
