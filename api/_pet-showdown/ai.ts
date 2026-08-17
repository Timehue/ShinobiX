/*
 * Pet Showdown — AI opponents.
 *
 * Team generation samples the real PET_CATALOG (so opponents are recognizable
 * species with authored kits) scaled to the challenger's own pets, and the
 * command picker plays the same rules the player does — stamina, holds,
 * element counters, supers. Three tiers ladder the pressure:
 *   scrapper — softer stats, impulsive move choice, bare statline
 *   warrior  — even stats, sound fundamentals, one trait
 *   champion — harder stats, element-optimal focus fire + super discipline,
 *              trait AND PvP gear
 *
 * Deterministic: all randomness flows through the session rng (or the local
 * mulberry sampler seeded by the caller for team generation).
 */

import { PET_CATALOG } from '../pet/_catalog.js';
import { petPvpGear, petTraits } from '../_pet-sim/pet-config.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_METER_MAX,
    type ShowdownCommand,
    type ShowdownTier,
} from '../../shared/pet-showdown-contract.js';
import { nextRand, SELF_KINDS, storedStatusKind, type ShowdownPet, type ShowdownSession } from './engine.js';

// Local deterministic sampler for team generation (session rng not built yet).
function makeRand(seed: number): () => number {
    let state = seed | 0;
    return () => {
        let t = (state += 0x6d2b79f5) | 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        state = state | 0;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One rarity per pool where the cross-tier gap is steep (standard→rare is the
// catalog's biggest cliff) so a lucky roll inside one AI team can't swing the
// fight more than the tier choice itself.
const TIER_RARITIES: Record<ShowdownTier, string[]> = {
    scrapper: ['standard'],
    warrior: ['rare'],
    champion: ['legendary', 'mythic'],
};

/** Per-level share of the base-stat growth budget the AI team receives. A
 *  balanced player build lands around 0.25/level; champion presses above it. */
const TIER_GROWTH_SHARE: Record<ShowdownTier, number> = {
    scrapper: 0.22,
    warrior: 0.3,
    champion: 0.38,
};

/*
 * The BUILD layer, laddered so the tier itself is legible. An opponent used to
 * be a bare statline whatever the tier, which meant the trait and gear systems
 * the player is asked to invest in were never once shown back to them in play.
 *   scrapper — nothing. Clean fundamentals; a new player learns the base game.
 *   warrior  — a trait.
 *   champion — a trait AND PvP gear.
 * The pools below are narrowed to effects that READ on screen (a shield that
 * raises, a drink of blood, an execute) rather than silent stat nudges,
 * because the point is teaching by example: a champion's Aegis Pendant is the
 * clearest advert the item has.
 */
const TIER_GIVES_TRAIT: Record<ShowdownTier, boolean> = { scrapper: false, warrior: true, champion: true };
const TIER_GIVES_GEAR: Record<ShowdownTier, boolean> = { scrapper: false, warrior: false, champion: true };

/** Drawn from the player's own roster (pet-config's `petTraits`), filtered to
 *  the ones the showdown engine gives a visible combat beat. Loyal (training
 *  speed) and Lucky (a 3% roll shift) teach nothing at a glance. */
const AI_TRAIT_POOL = petTraits.filter((t) => t === 'Aggressive' || t === 'Guardian' || t === 'Battleborn' || t === 'Swift');

/** Proc gear only — the pieces whose whole effect is a passive percentage
 *  would inflate the AI's statline invisibly, which is exactly the kind of
 *  hidden advantage the tier growth share already owns. */
const AI_GEAR_POOL = petPvpGear.filter((g) =>
    g.shieldStartPctOfHp || g.lifestealPctOfDamage || g.executeBelowPct || g.dotOnHitPctOfAtk || g.lastStandBelowPct);

export const SHOWDOWN_TEAM_NAMES: Record<ShowdownTier, string[]> = {
    scrapper: ['Backalley Strays', 'Riverbank Pack', 'Dust Yard Runts'],
    warrior: ['Ironfang Company', 'Stormcaller Kennel', 'Ashen Vanguard'],
    champion: ['The Apex Court', 'Mythwoven Chosen', 'Sovereign Talons'],
};

/** Build an AI team from the live catalog, scaled to the player's pets.
 *
 *  `opts.mirrorLevels` is the SPARRING levelling rule. By default the whole AI
 *  team stands at the player team's AVERAGE level, which is the right shape for
 *  a tier the player chose and for the arena's paid bout — one opposition, one
 *  difficulty. Sparring is a drill against your own roster, so there the AI is
 *  levelled slot-for-slot instead: your Lv 9 leads against a Lv 9, your Lv 1
 *  reserve against a Lv 1. Averaging would hand a lopsided roster a fight its
 *  low pets cannot practise in and its high pets cannot learn from. */
export function buildShowdownAiTeam(
    playerPets: Pet[],
    size: number,
    tier: ShowdownTier,
    seed: number,
    opts?: { mirrorLevels?: boolean },
): { pets: Pet[]; teamName: string } {
    const rand = makeRand(seed);
    const clampLevel = (n: number): number => Math.max(1, Math.min(100, Math.round(n)));
    const avgLevel = clampLevel(
        playerPets.reduce((sum, p) => sum + (Number(p.level) || 1), 0) / Math.max(1, playerPets.length),
    );
    // Slot alignment is exact: every caller builds `size === playerPets.length`
    // (field + bench parity), so slot N faces slot N. A slot with no player pet
    // behind it — or a level the save cannot answer for — falls back to the
    // average, which is what the non-mirrored path uses throughout.
    const levelAt = (slot: number): number => (opts?.mirrorLevels
        ? clampLevel(Number(playerPets[slot]?.level) || avgLevel)
        : avgLevel);
    const rarities = new Set(TIER_RARITIES[tier]);
    const pool = Object.values(PET_CATALOG).filter((tpl) =>
        rarities.has(String(tpl.rarity)) && tpl.wildSpawnable !== false && Array.isArray(tpl.jutsus));

    const growthAt = (level: number): number => 1 + (level - 1) * 0.04 * TIER_GROWTH_SHARE[tier];
    const picked: Pet[] = [];
    const usedElements = new Set<string>();
    /*
     * One catalog template, scaled and kitted for this tier. Trait and gear are
     * drawn from the SEEDED sampler (never Math.random or a clock — the engine
     * is a pure function of its seed and a persisted session has to replay).
     *
     * The trait is a NAME only: player traits bake their stat bonus in at
     * acquisition (applyOwnedPetTrait) and the engine reads stored stats as
     * already-baked, so stamping one here grants the in-combat behavior without
     * a second helping of stats. The tier growth share stays the only stat
     * lever. A template that ships its own trait is overwritten either way, so
     * a scrapper cannot leak one.
     */
    const outfit = (tpl: Record<string, unknown>, slot: number): Pet => {
        const level = levelAt(slot);
        const growth = growthAt(level);
        return {
            ...(tpl as unknown as Pet),
            id: `showdown-ai-${slot}-${String(tpl.id)}`,
            templateId: String(tpl.id),
            level,
            hp: Math.round(Number(tpl.hp) * growth),
            attack: Math.round(Number(tpl.attack) * growth),
            defense: Math.round(Number(tpl.defense) * growth),
            speed: Math.round(Number(tpl.speed) * growth),
            trait: TIER_GIVES_TRAIT[tier] && AI_TRAIT_POOL.length
                ? AI_TRAIT_POOL[Math.floor(rand() * AI_TRAIT_POOL.length)]
                : undefined,
            ...(TIER_GIVES_GEAR[tier] && AI_GEAR_POOL.length
                ? { loadout: { pvp: AI_GEAR_POOL[Math.floor(rand() * AI_GEAR_POOL.length)].id } }
                : {}),
        };
    };
    // Fisher–Yates with the seeded sampler — a rand() sort comparator is not a
    // deterministic shuffle across engines.
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const tpl of shuffled) {
        if (picked.length >= size) break;
        const element = String(tpl.element ?? 'None');
        // Prefer element diversity so 2v2/3v3 teams pose varied matchups.
        if (usedElements.has(element) && shuffled.length > size * 3 && rand() < 0.8) continue;
        usedElements.add(element);
        picked.push(outfit(tpl, picked.length));
    }
    // Pool exhausted (over-filtered) — refill without the diversity preference.
    for (const tpl of shuffled) {
        if (picked.length >= size) break;
        if (picked.some((p) => p.id.endsWith(String(tpl.id)))) continue;
        picked.push(outfit(tpl, picked.length));
    }
    const names = SHOWDOWN_TEAM_NAMES[tier];
    return { pets: picked, teamName: names[Math.floor(rand() * names.length)] };
}

function elementBeats(attacker: string, defender: string): boolean {
    return SHOWDOWN_ELEMENT_BEATS[attacker] === defender;
}

function rngOf(session: ShowdownSession): () => number {
    // The AI shares the session rng stream (and the engine's single PRNG
    // implementation) so replays are exact.
    return () => nextRand(session);
}

/** Pick this round's commands for every living AI FIELD pet.
 *
 *  `side` names WHICH team the AI is commanding. It defaults to `'enemy'` —
 *  the only thing a live match ever needs, and the value every existing caller
 *  gets — so this stays byte-identical for real fights. The parameter exists
 *  for headless resolution (`resolveShowdownHeadless`), where both teams are
 *  machine-driven: clan-war pet duels auto-resolve with no player present, and
 *  the engine-comparison harness needs to play whole matches offline. */
export function chooseShowdownAiCommands(
    session: ShowdownSession,
    side: 'player' | 'enemy' = 'enemy',
): ShowdownCommand[] {
    const rand = rngOf(session);
    const tier = session.tier;
    const mine = side === 'enemy' ? session.enemy : session.player;
    const theirs = side === 'enemy' ? session.player : session.enemy;
    const foes = theirs.filter((p) => !p.ko && !p.benched);
    const commands: ShowdownCommand[] = [];
    if (!foes.length) return commands;

    // At most one voluntary switch per round so the AI never cycles its whole
    // line in a single turn.
    let switchedThisRound = false;
    const reserves = mine.filter((p) => p.benched && !p.ko);
    for (const pet of mine) {
        if (pet.ko || pet.benched) continue;
        // Switch reads (warrior sometimes, champion often). A full element
        // flip is rare — it held in only ~2% of pet-rounds — so the AI also
        // rotates on the HALF flip and on stamina, which is what actually
        // makes the bench visible in play.
        if (!switchedThisRound && tier !== 'scrapper' && reserves.length && pet.hp / pet.maxHp > 0.3) {
            const threatened = foes.some((f) => elementBeats(f.element, pet.element));
            // Full flip: a reserve that beats something on the field.
            const counterpick = reserves.find((ally) => foes.some((f) => elementBeats(ally.element, f.element)));
            // Half flip: a reserve that at least is not itself beaten.
            const safePick = reserves.find((ally) => !foes.some((f) => elementBeats(f.element, ally.element)));
            // Stamina rotation: nothing castable, but a rested reserve waits.
            const cheapest = Math.min(...pet.moves.map((m) => m.cost));
            const spent = pet.stamina < cheapest;
            const restedPick = reserves.find((ally) => ally.stamina / ally.maxStamina >= 0.7);
            const eagerness = tier === 'champion' ? 0.55 : 0.25;

            const rotate = spent && restedPick
                ? restedPick
                : threatened && counterpick && rand() < eagerness
                    ? counterpick
                    : threatened && safePick && rand() < eagerness * 0.6
                        ? safePick
                        : null;
            if (rotate) {
                switchedThisRound = true;
                commands.push({ kind: 'switch', petId: pet.id, benchPetId: rotate.id });
                continue;
            }
        }
        commands.push(choosePetCommand(session, pet, foes, tier, rand));
    }
    return commands;
}

function choosePetCommand(
    session: ShowdownSession,
    pet: ShowdownPet,
    foes: ShowdownPet[],
    tier: ShowdownTier,
    rand: () => number,
): ShowdownCommand {
    // Target selection: focus the kill. Champion weights element advantage in.
    const scored = foes.map((f) => ({
        foe: f,
        score: (1 - f.hp / f.maxHp) * 100
            + (elementBeats(pet.element, f.element) ? (tier === 'champion' ? 60 : 25) : 0)
            + (elementBeats(f.element, pet.element) ? -15 : 0),
    })).sort((a, b) => b.score - a.score);
    const target = tier === 'scrapper' && scored.length > 1 && rand() < 0.35
        ? scored[Math.floor(rand() * scored.length)].foe
        : scored[0].foe;

    // Super discipline: champion holds until it can confirm value; others pop it.
    if (pet.meter >= SHOWDOWN_METER_MAX && pet.readiness >= pet.signatureMove.hold) {
        const eager = tier === 'scrapper' ? 0.9 : tier === 'warrior' ? 0.75 : (target.hp / target.maxHp < 0.75 ? 1 : 0.3);
        if (rand() < eager) {
            return { kind: 'super', petId: pet.id, targetId: target.id };
        }
    }

    const ready = pet.moves
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => pet.readiness >= m.hold);
    const affordable = ready.filter(({ m }) => m.cost <= pet.stamina);

    // Heal check: patch a bloodied self/ally when the kit allows it.
    const allies = session.enemy.filter((p) => !p.ko && !p.benched);
    const worstAllyHp = allies.length
        ? Math.min(...allies.map((a) => a.hp / a.maxHp))
        : 1;
    const healMove = affordable.find(({ m }) => m.kind === 'heal');
    if (healMove && tier !== 'scrapper') {
        const bloodied = allies.filter((a) => a.hp / a.maxHp < 0.45)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        if (bloodied && rand() < 0.8) {
            return { kind: 'move', petId: pet.id, moveIndex: healMove.i, targetId: bloodied.id };
        }
    }

    // Rest only when NOTHING is affordable — an affordable jab always beats
    // idling (the old 28% threshold rested pets that could still fight, which
    // collapsed damage throughput into rest-loops). Champion still smells
    // blood and overexerts deliberately to close a kill.
    if (!affordable.length) {
        const killPower = ready.filter(({ m }) => m.power > 0)
            .sort((a, b) => b.m.power - a.m.power)[0];
        const canExecute = tier === 'champion' && killPower && target.hp / target.maxHp < 0.22;
        if (!canExecute) {
            return rand() < 0.75
                ? { kind: 'rest', petId: pet.id }
                : { kind: 'guard', petId: pet.id };
        }
        return { kind: 'move', petId: pet.id, moveIndex: killPower.i, targetId: target.id };
    }

    // Score the affordable kit: damage value + status opportunism.
    //
    // The "already applied" check must look at the pet the status actually
    // lands on, under the name the ENGINE stores it as. Self-buffs land on the
    // ACTOR (not the target) and several kinds are renamed on write
    // (barrier/absorb -> shield, move -> haste, dot -> burn, movelock ->
    // slow). Checking `target.statuses` for the raw kind meant the -60 penalty
    // never fired for any self-buff: barrier scored `power*0.8 + 45` forever
    // and became 24.8% of all AI commands — more than plain damage.
    const foeStatuses = new Map(target.statuses.map((s) => [s.kind, s]));
    const selfStatuses = new Map(pet.statuses.map((s) => [s.kind, s]));
    const best = affordable
        .map(({ m, i }) => {
            let score = m.power * (elementBeats(pet.element, target.element) ? 1.3 : 1);
            if (m.kind === 'heal') {
                // The engine never stores a 'heal' status, so a lookup is dead
                // here — gate on whether anyone actually needs the healing.
                score = m.power * 0.8 + (worstAllyHp < 0.85 ? 45 : -60);
            } else if (m.kind === 'weather') {
                // Setting the sky is an OPENING play: the window has to be
                // long enough to pay back the lost turn, and re-setting your
                // own standing weather is pure waste. Worth most when the
                // caster's own element gets the boost (it always does) and the
                // fight is young.
                const standing = session.weather;
                const mine = standing?.element === pet.element;
                score = mine ? -120 : 60 + (session.round <= 3 ? 45 : 0) - (session.round >= 10 ? 60 : 0);
            } else if (m.kind === 'protect') {
                // A block is worth a turn only against an incoming hit worth
                // eating: low HP, or a foe sitting on a charged signature.
                // Chaining it fails outright, so never ask twice.
                const spent = pet.statuses.some((s) => s.kind === 'protectSpent');
                const hurt = pet.hp / pet.maxHp;
                const foeCharged = foes.some((f) => f.meter >= 100);
                score = spent ? -200 : (hurt < 0.5 ? 70 : -30) + (foeCharged ? 80 : 0);
            } else if (m.kind !== 'damage' && m.kind !== 'crush' && m.kind !== 'lifesteal') {
                const stored = storedStatusKind(m.kind, session.format, foes.length);
                const onSelf = SELF_KINDS.has(m.kind);
                const held = onSelf ? selfStatuses.get(stored) : foeStatuses.get(stored);
                // A shield already up is only worth recasting if the new pool
                // would be bigger than what remains (mirrors engine.ts).
                const refills = stored === 'shield' && held
                    ? held.magnitude < Math.max(40, Math.round(m.power * 1.05))
                    : false;
                score = m.power * 0.8 + (held && !refills ? -60 : 45);
                if (session.round <= 1) score += 25;
            }
            if (m.kind === 'lifesteal' && pet.hp / pet.maxHp < 0.5) score += 50;

            // ── Stamina pressure ────────────────────────────────────────────
            // Costs are proportional to power now, so raw power alone would
            // make the haymaker the answer to every question — the AI would
            // fire it, run dry, and rest-loop. Weigh what the cast LEAVES the
            // pet with: spending most of the pool is only correct when the
            // hit closes the fight or the pet can absorb the downtime.
            const leftPct = (pet.stamina - m.cost) / Math.max(1, pet.maxStamina);
            if (leftPct < 0.25) score -= (0.25 - leftPct) * 320;
            // A haymaker that kills is always worth the pool — that IS the
            // moment the tempo was being saved for.
            const lethal = m.power > 0 && target.hp / target.maxHp < 0.3 && m.cost > pet.maxStamina * 0.3;
            if (lethal) score += tier === 'champion' ? 140 : tier === 'warrior' ? 90 : 40;

            score += rand() * (tier === 'scrapper' ? 90 : tier === 'warrior' ? 35 : 15);
            return { i, score };
        })
        .sort((a, b) => b.score - a.score)[0];

    return { kind: 'move', petId: pet.id, moveIndex: best.i, targetId: target.id };
}
