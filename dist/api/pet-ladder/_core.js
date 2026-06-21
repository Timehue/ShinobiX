"use strict";
/*
 * Pure (kv/auth-free) core for the global Pet Ladders (Pet Coliseum 1v1 + Pet
 * Tactical 4v4). The handler (api/pet-ladder/ladder.ts) owns I/O — auth, the KV
 * blobs, the lock, seed minting, notifications — and delegates every decision here
 * so it can be unit-tested in isolation (api/pet-ladder/_core.test.ts).
 *
 * MODEL (Sword-x-Staff style positional ladder, rank 1..N over real players):
 *   • You SET A DEFENSE (1 pet for Coliseum, a 4-pet team for Tactical), sealed
 *     server-side from your save so a challenger fights the pet/team YOU chose —
 *     even while you are OFFLINE.
 *   • Clicking Challenge builds a 3-opponent OFFER: up to 3 humans ranked CLOSE
 *     ABOVE you (within a band, nearest first), topped up with easy AI when fewer
 *     than 3 humans are near (early game / the top of the board). You pick one.
 *   • Beating a human above you takes their rank (they + everyone between shift
 *     down one). Beating an AI while UNRANKED inducts you at the bottom. 10
 *     challenges/day.
 *   • SERVER-AUTHORITATIVE: the winner is recomputed here from the sealed seed +
 *     rosters via the ported deterministic engines — the client cinematic is a
 *     replay, never the source of truth.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectLadder = exports.aiIndexOf = exports.isAiId = exports.aiTacticalDefense = exports.aiColiseumDefense = exports.AI_TACTICAL = exports.AI_COLISEUM = exports.petLite = exports.petsForMode = exports.AI_SEED_COUNT = exports.OFFER_SIZE = exports.CLIMB_BAND = exports.DAILY_CHALLENGES = exports.TACTICAL_PETS = exports.COLISEUM_PETS = void 0;
exports.snapshotLadderPet = snapshotLadderPet;
exports.toPet = toPet;
exports.chooseOwnedLadderPets = chooseOwnedLadderPets;
exports.ladderRoles = ladderRoles;
exports.buildOffer = buildOffer;
exports.canChallenge = canChallenge;
exports.applyChallenge = applyChallenge;
exports.resolveColiseum = resolveColiseum;
exports.resolveTactical = resolveTactical;
const _duel_sim_js_1 = require("./_duel-sim.js");
const _arena_sim_js_1 = require("./_arena-sim.js");
exports.COLISEUM_PETS = 1;
exports.TACTICAL_PETS = 4;
exports.DAILY_CHALLENGES = 10; // per ladder per day
exports.CLIMB_BAND = 10; // can only challenge humans within this many ranks above
exports.OFFER_SIZE = 3; // opponents presented per Challenge click
exports.AI_SEED_COUNT = 5; // 5 AI / 5 AI teams per the design
const petsForMode = (mode) => (mode === "tactical" ? exports.TACTICAL_PETS : exports.COLISEUM_PETS);
exports.petsForMode = petsForMode;
// ── Snapshots ────────────────────────────────────────────────────────────────
const ARENA_ROLES = new Set(["defender", "tracker", "assassin", "sage"]);
const clampStat = (v, min, max, dflt) => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
    return Math.max(min, Math.min(max, n));
};
const JUTSU_KINDS = new Set([
    "damage", "buff", "heal", "debuff", "dot", "move", "barrier", "movelock", "lifesteal", "shield",
    "absorb", "burn", "freeze", "confuse", "stun", "crush", "wound", "mark", "slow", "haste", "taunt", "push", "pull",
]);
function snapshotJutsu(raw) {
    const kind = JUTSU_KINDS.has(raw.kind) ? raw.kind : "damage";
    return {
        name: String(raw.name ?? "Strike").slice(0, 40),
        power: clampStat(raw.power, 1, 1000, 80),
        cooldown: clampStat(raw.cooldown, 0, 60, 0),
        kind,
        ...(typeof raw.rounds === "number" ? { rounds: clampStat(raw.rounds, 1, 20, 1) } : {}),
        ...(raw.signature ? { signature: true } : {}),
        ...(raw.aoe ? { aoe: true } : {}),
    };
}
/** Freeze a raw pet (from a save) to the fields the sim/renderer use, incl loadout. */
function snapshotLadderPet(raw) {
    const loadoutRaw = (raw.loadout && typeof raw.loadout === "object" ? raw.loadout : {});
    const pvp = typeof loadoutRaw.pvp === "string" ? loadoutRaw.pvp : undefined;
    const consumable = typeof loadoutRaw.consumable === "string" ? loadoutRaw.consumable : undefined;
    const jutsus = Array.isArray(raw.jutsus) ? raw.jutsus.slice(0, 4).map((j) => snapshotJutsu((j ?? {}))) : [];
    return {
        id: String(raw.id ?? ""),
        name: String(raw.name ?? "Pet").slice(0, 40),
        rarity: String(raw.rarity ?? "standard"),
        level: clampStat(raw.level, 1, 100, 1),
        hp: clampStat(raw.hp, 1, 100000, 600),
        attack: clampStat(raw.attack, 1, 100000, 60),
        defense: clampStat(raw.defense, 0, 100000, 30),
        speed: clampStat(raw.speed, 1, 100000, 50),
        element: String(raw.element ?? "Fire"),
        trait: typeof raw.trait === "string" ? raw.trait : undefined,
        role: ARENA_ROLES.has(raw.role) ? raw.role : undefined,
        jutsus,
        ...(pvp || consumable ? { loadout: { ...(pvp ? { pvp } : {}), ...(consumable ? { consumable } : {}) } } : {}),
    };
}
const petLite = (p) => ({ name: p.name, element: p.element, level: p.level, role: p.role, rarity: p.rarity });
exports.petLite = petLite;
/** Reconstruct a sim-ready Pet from a snapshot. */
function toPet(p) {
    return {
        id: p.id, name: p.name, rarity: p.rarity ?? "standard", level: p.level,
        hp: p.hp, attack: p.attack, defense: p.defense, speed: p.speed,
        element: p.element, trait: p.trait, role: p.role,
        jutsus: p.jutsus,
        ...(p.loadout ? { loadout: p.loadout } : {}),
    };
}
/**
 * Resolve the player's chosen pet ids against the pets they actually own. Consumes
 * one owned pet per id (two distinct instances of a template both work; one owned
 * pet can't be picked twice). Returns null when the count is wrong or any id isn't
 * owned. Mirrors api/arena/_lobby-core.ts:chooseOwnedPets but keeps the loadout.
 */
function chooseOwnedLadderPets(owned, petIds, count) {
    if (!Array.isArray(petIds) || petIds.length !== count)
        return null;
    const pool = owned.slice();
    const chosen = [];
    for (const id of petIds) {
        const idx = pool.findIndex((p) => String(p.id ?? "") === String(id));
        if (idx < 0)
            return null;
        chosen.push(snapshotLadderPet(pool[idx]));
        pool.splice(idx, 1);
    }
    return chosen;
}
/** Index of the max/min-scoring entry; ties → lowest index. */
function pickIdx(idx, score, dir) {
    let best = idx[0];
    for (const i of idx) {
        const better = dir === "max" ? score(i) > score(best) : score(i) < score(best);
        if (better)
            best = i;
    }
    return best;
}
/** Roles for a team: each pet's native role when present, else a stat-profile fallback
 *  (toughest → defender, best atk+spd → assassin, weakest atk → sage, rest → tracker).
 *  Mirrors api/arena/_lobby-core.ts:autoArenaRoles. Deterministic; sealed into defense. */
function ladderRoles(pets) {
    if (pets.length > 0 && pets.every((p) => p.role))
        return pets.map((p) => p.role);
    const n = pets.length;
    if (n <= 2)
        return pets.map((_, i) => (i === 0 ? "defender" : "assassin"));
    const all = pets.map((_, i) => i);
    const def = pickIdx(all, (i) => pets[i].defense, "max");
    const rest1 = all.filter((i) => i !== def);
    const asn = pickIdx(rest1, (i) => pets[i].attack + pets[i].speed, "max");
    const rest2 = rest1.filter((i) => i !== asn);
    const sge = pickIdx(rest2, (i) => pets[i].attack, "min");
    return all.map((i) => (i === def ? "defender" : i === asn ? "assassin" : i === sge ? "sage" : "tracker"));
}
// ── AI seed opponents (easy, beatable — the on-ramp / fallback fill) ───────────
const J = (name, kind, power) => ({ name, kind, power, cooldown: 2 });
const aiPet = (id, name, rarity, level, hp, attack, defense, speed, element, role, jutsus) => ({ id, name, rarity, level, hp, attack, defense, speed, element, role, jutsus });
// 5 easy single pets for the Coliseum ladder.
exports.AI_COLISEUM = [
    aiPet("ai-col-0", "Straw Sentinel", "standard", 8, 300, 26, 22, 22, "Earth", "defender", [J("Bash", "damage", 60)]),
    aiPet("ai-col-1", "Cinder Pup", "standard", 9, 260, 34, 16, 30, "Fire", "assassin", [J("Nip", "damage", 70)]),
    aiPet("ai-col-2", "Tide Sprite", "standard", 9, 280, 28, 20, 28, "Water", "sage", [J("Splash", "damage", 60), J("Mend", "heal", 80)]),
    aiPet("ai-col-3", "Gale Chick", "standard", 10, 250, 32, 16, 36, "Wind", "tracker", [J("Peck", "damage", 66)]),
    aiPet("ai-col-4", "Spark Mite", "standard", 10, 240, 36, 14, 34, "Lightning", "assassin", [J("Zap", "damage", 72)]),
];
// 5 easy 4-pet teams for the Tactical ladder.
exports.AI_TACTICAL = [
    { name: "Academy Cubs", pets: [
            aiPet("ai-tac-0-0", "Cub Guard", "standard", 9, 360, 30, 30, 24, "Earth", "defender", []),
            aiPet("ai-tac-0-1", "Cub Scout", "standard", 9, 280, 34, 18, 36, "Wind", "tracker", []),
            aiPet("ai-tac-0-2", "Cub Striker", "standard", 9, 250, 40, 16, 38, "Fire", "assassin", []),
            aiPet("ai-tac-0-3", "Cub Mender", "standard", 9, 300, 26, 22, 28, "Water", "sage", []),
        ] },
    { name: "Straw Patrol", pets: [
            aiPet("ai-tac-1-0", "Straw Wall", "standard", 10, 380, 30, 32, 22, "Earth", "defender", []),
            aiPet("ai-tac-1-1", "Straw Runner", "standard", 10, 290, 36, 18, 38, "Lightning", "tracker", []),
            aiPet("ai-tac-1-2", "Straw Fang", "standard", 10, 255, 42, 16, 40, "Fire", "assassin", []),
            aiPet("ai-tac-1-3", "Straw Sage", "standard", 10, 300, 26, 24, 28, "Water", "sage", []),
        ] },
    { name: "Tide Recruits", pets: [
            aiPet("ai-tac-2-0", "Tide Bulwark", "standard", 11, 400, 32, 34, 24, "Water", "defender", []),
            aiPet("ai-tac-2-1", "Tide Tracker", "standard", 11, 300, 38, 20, 40, "Wind", "tracker", []),
            aiPet("ai-tac-2-2", "Tide Edge", "standard", 11, 260, 44, 16, 42, "Lightning", "assassin", []),
            aiPet("ai-tac-2-3", "Tide Healer", "standard", 11, 310, 28, 24, 30, "Water", "sage", []),
        ] },
    { name: "Ember Drills", pets: [
            aiPet("ai-tac-3-0", "Ember Shield", "standard", 12, 410, 34, 34, 26, "Fire", "defender", []),
            aiPet("ai-tac-3-1", "Ember Hunter", "standard", 12, 305, 40, 20, 42, "Wind", "tracker", []),
            aiPet("ai-tac-3-2", "Ember Blade", "standard", 12, 265, 46, 18, 44, "Fire", "assassin", []),
            aiPet("ai-tac-3-3", "Ember Warder", "standard", 12, 315, 30, 26, 30, "Earth", "sage", []),
        ] },
    { name: "Gale Cadets", pets: [
            aiPet("ai-tac-4-0", "Gale Tower", "standard", 13, 420, 36, 36, 26, "Earth", "defender", []),
            aiPet("ai-tac-4-1", "Gale Stalker", "standard", 13, 310, 42, 22, 44, "Wind", "tracker", []),
            aiPet("ai-tac-4-2", "Gale Talon", "standard", 13, 270, 48, 18, 46, "Lightning", "assassin", []),
            aiPet("ai-tac-4-3", "Gale Oracle", "standard", 13, 320, 32, 26, 32, "Water", "sage", []),
        ] },
];
const aiColiseumDefense = (i) => {
    const p = exports.AI_COLISEUM[i % exports.AI_COLISEUM.length];
    return { slug: `ai:${i}`, name: p.name, mode: "coliseum", pets: [p], roles: ladderRoles([p]), updatedAt: 0 };
};
exports.aiColiseumDefense = aiColiseumDefense;
const aiTacticalDefense = (i) => {
    const t = exports.AI_TACTICAL[i % exports.AI_TACTICAL.length];
    return { slug: `ai:${i}`, name: t.name, mode: "tactical", pets: t.pets, roles: ladderRoles(t.pets), updatedAt: 0 };
};
exports.aiTacticalDefense = aiTacticalDefense;
const isAiId = (id) => id.startsWith("ai:");
exports.isAiId = isAiId;
const aiIndexOf = (id) => { const n = Number(id.slice(3)); return Number.isInteger(n) && n >= 0 ? n : -1; };
exports.aiIndexOf = aiIndexOf;
const rankOf = (order, slug) => order.findIndex((e) => e.slug === slug); // 0-based, -1 = unranked
/**
 * Build the 3-opponent offer for `challenger`: up to OFFER_SIZE humans ranked CLOSE
 * ABOVE within CLIMB_BAND (nearest first), then top up with AI seeds. `aiSummary`
 * maps an AI index → its light summary. `aiPick` chooses the AI fill order (handler
 * passes a rotating/random start so rerolls vary; not result-authoritative).
 */
function buildOffer(order, challenger, aiSummary, aiStart, excludeId) {
    const my = rankOf(order, challenger);
    const effIdx = my < 0 ? order.length : my; // unranked sits just below the lowest human
    const offer = [];
    for (let i = effIdx - 1; i >= 0 && offer.length < exports.OFFER_SIZE; i--) {
        if (effIdx - i > exports.CLIMB_BAND)
            break; // outside the climb band
        const e = order[i];
        if (e.slug === challenger || e.slug === excludeId)
            continue; // skip self + the just-fought opponent (no back-to-back rematch)
        offer.push({ kind: "player", id: e.slug, name: e.name, village: e.village, rank: i + 1, summary: e.summary });
    }
    for (let k = 0; offer.length < exports.OFFER_SIZE && k < exports.AI_SEED_COUNT; k++) {
        const idx = (aiStart + k) % exports.AI_SEED_COUNT;
        if (`ai:${idx}` === excludeId)
            continue; // don't immediately re-offer the just-fought AI either
        offer.push(aiSummary(idx));
    }
    return offer;
}
/** Is `target` a legal challenge for `challenger`? AI is always legal; a human must be
 *  ranked above and within the climb band (server enforces — can't snipe rank 1). */
function canChallenge(order, challenger, targetId, excludeId) {
    if (excludeId && targetId === excludeId)
        return false; // no back-to-back rematch of the same opponent
    if ((0, exports.isAiId)(targetId))
        return (0, exports.aiIndexOf)(targetId) >= 0 && (0, exports.aiIndexOf)(targetId) < exports.AI_SEED_COUNT;
    const my = rankOf(order, challenger);
    const tgt = rankOf(order, targetId);
    if (tgt < 0)
        return false;
    const effIdx = my < 0 ? order.length : my;
    return tgt < effIdx && effIdx - tgt <= exports.CLIMB_BAND;
}
const blankRecord = () => ({ wins: 0, losses: 0, defended: 0, defeated: 0 });
const ensure = (e) => ({ ...e, record: { ...blankRecord(), ...e.record } });
const bumpWin = (e, won) => ({ ...e, record: { ...e.record, ...(won ? { wins: e.record.wins + 1 } : { losses: e.record.losses + 1 }) } });
/**
 * Apply a resolved challenge to the ladder order. Returns the new (whole) order — the
 * handler persists it as one KV doc — plus `notifySlug`, the human defender to message
 * offline (null for an AI fight). Pure.
 *   • beat a HUMAN above → challenger takes their index (target + everyone between shift
 *     down one); records updated.
 *   • beat an AI while UNRANKED → inducted at the bottom (a loss never ranks you).
 *   • a ranked challenger's AI fight only touches their W/L record, no movement.
 */
function applyChallenge(order, challengerEntry, targetId, challengerWon) {
    const next = order.map(ensure);
    const myIdx = rankOf(next, challengerEntry.slug);
    const wasRanked = myIdx >= 0;
    // ── AI target: induction (unranked win) or record-only (ranked) ────────────
    if ((0, exports.isAiId)(targetId)) {
        if (wasRanked) {
            next[myIdx] = bumpWin(next[myIdx], challengerWon);
            return { order: next, notifySlug: null };
        }
        if (!challengerWon)
            return { order: next, notifySlug: null }; // a loss never ranks you
        next.push(bumpWin(ensure(challengerEntry), true)); // inducted at the bottom
        return { order: next, notifySlug: null };
    }
    // ── Human target ───────────────────────────────────────────────────────────
    const tgtIdx = rankOf(next, targetId);
    const effIdx = wasRanked ? myIdx : next.length; // unranked sits below all
    if (tgtIdx < 0 || tgtIdx >= effIdx) { // target gone / not above → no-op
        if (wasRanked)
            next[myIdx] = bumpWin(next[myIdx], challengerWon);
        return { order: next, notifySlug: null };
    }
    let meIdx = myIdx;
    if (!wasRanked) {
        next.push(ensure(challengerEntry));
        meIdx = next.length - 1;
    }
    if (challengerWon) {
        next[meIdx] = { ...next[meIdx], record: { ...next[meIdx].record, wins: next[meIdx].record.wins + 1 } };
        next[tgtIdx] = { ...next[tgtIdx], record: { ...next[tgtIdx].record, defeated: next[tgtIdx].record.defeated + 1 } };
        const [mover] = next.splice(meIdx, 1); // pull the challenger out…
        next.splice(tgtIdx, 0, mover); // …and insert at the target's rank (shifts the rest down one)
    }
    else {
        next[tgtIdx] = { ...next[tgtIdx], record: { ...next[tgtIdx].record, defended: next[tgtIdx].record.defended + 1 } };
        if (wasRanked)
            next[meIdx] = { ...next[meIdx], record: { ...next[meIdx].record, losses: next[meIdx].record.losses + 1 } };
        else
            next.splice(meIdx, 1); // unranked + lost → does not join the board
    }
    return { order: next, notifySlug: targetId }; // a human defender — message them their rank was contested
}
/** Light list projection for the GET endpoint (already light — rank is the index). */
const projectLadder = (order) => order.map((e, i) => ({ rank: i + 1, slug: e.slug, name: e.name, village: e.village, record: e.record, summary: e.summary }));
exports.projectLadder = projectLadder;
// ── Server-authoritative resolution (ported deterministic engines) ─────────────
/** Coliseum 1v1: true ⇒ the ATTACKER (challenger) won. Items applied for both. */
function resolveColiseum(attacker, defender, seed) {
    return (0, _duel_sim_js_1.runPetDuel)(toPet(attacker), toPet(defender), seed, 1, 1, false, true).result === "win";
}
/** Tactical 4v4: true ⇒ the ATTACKER (blue) won. Items applied for both teams. */
function resolveTactical(attacker, defender, seed) {
    const blue = attacker.pets.map((p, i) => ({ pet: toPet(p), role: attacker.roles[i] ?? "tracker" }));
    const red = defender.pets.map((p, i) => ({ pet: toPet(p), role: defender.roles[i] ?? "tracker" }));
    return (0, _arena_sim_js_1.runPetArenaMatch)(blue, red, seed, true).winner === "blue";
}
