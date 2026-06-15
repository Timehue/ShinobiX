"use strict";
/*
 * Pure (kv/auth-free) core for the co-op Tactical Pet Arena lobby. The handler
 * (api/arena/lobby.ts) owns I/O — auth, the KV blob, the lock, seed minting —
 * and delegates every decision to the functions here so they can be unit-tested
 * in isolation (api/arena/_lobby-core.test.ts).
 *
 * MODEL: the arena auto-battle is a DETERMINISTIC replay
 * (shinobij.client/src/lib/pet-arena-sim.ts → runPetArenaMatch(blue, red, seed)).
 * So co-op needs no real-time netcode: the server is a lobby coordinator that,
 * at start, SEALS the match inputs — each player's two pets (snapshotted from
 * their server-side save, so the client can't inject buffed pets) plus a
 * server-minted seed — and hands the identical sealed payload to every client.
 * All four clients run the same seed over the same rosters and see a
 * byte-identical fight. Empty seats are filled from a fixed AI pool so a partial
 * lobby still plays. This is a PREVIEW mode with NO rewards; when rewards are
 * added later the server must recompute the winner from the sealed seed+rosters
 * (the seal already lives in lobby.match), never trust a client-reported result.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_POOL = exports.findPlayerSlot = exports.slotOf = exports.CODE_ALPHABET = exports.CODE_LEN = exports.PETS_PER_PLAYER = void 0;
exports.codeFromBytes = codeFromBytes;
exports.newLobby = newLobby;
exports.openSeat = openSeat;
exports.snapshotPet = snapshotPet;
exports.chooseOwnedPets = chooseOwnedPets;
exports.autoArenaRoles = autoArenaRoles;
exports.resolveMatch = resolveMatch;
exports.startBlock = startBlock;
exports.publicView = publicView;
const ARENA_ROLES = new Set(["defender", "tracker", "assassin", "sage"]);
exports.PETS_PER_PLAYER = 2;
exports.CODE_LEN = 4;
// Unambiguous alphabet (no 0/O/1/I) for shareable join codes.
exports.CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Default seat-fill order for joiners (host already holds blue0): a friend joins
// the host's team first ("team up"), then the opposing side fills.
const JOIN_ORDER = [
    { team: "blue", slot: 1 },
    { team: "red", slot: 0 },
    { team: "red", slot: 1 },
];
/** Generate a join code from a byte source (handler passes crypto bytes). */
function codeFromBytes(bytes) {
    let out = "";
    for (let i = 0; i < exports.CODE_LEN; i++)
        out += exports.CODE_ALPHABET[bytes[i] % exports.CODE_ALPHABET.length];
    return out;
}
function emptySlots() {
    return [
        { team: "blue", slot: 0, name: null, ready: false, pets: [], joinedAt: 0 },
        { team: "blue", slot: 1, name: null, ready: false, pets: [], joinedAt: 0 },
        { team: "red", slot: 0, name: null, ready: false, pets: [], joinedAt: 0 },
        { team: "red", slot: 1, name: null, ready: false, pets: [], joinedAt: 0 },
    ];
}
function newLobby(code, host, now) {
    const slots = emptySlots();
    slots[0].name = host; // host = blue slot 0
    slots[0].joinedAt = now;
    return { code, host, state: "lobby", seed: null, slots, match: null, createdAt: now, startedAt: null };
}
const slotOf = (lobby, team, slot) => lobby.slots.find((s) => s.team === team && s.slot === slot);
exports.slotOf = slotOf;
const findPlayerSlot = (lobby, name) => lobby.slots.find((s) => s.name === name);
exports.findPlayerSlot = findPlayerSlot;
/** Pick the seat a joiner takes. Honors a `prefer` team when it has an open seat,
 *  else falls back to the default join order. Returns null when the lobby is full. */
function openSeat(lobby, prefer) {
    if (prefer) {
        const seat = JOIN_ORDER.find((s) => s.team === prefer && !(0, exports.slotOf)(lobby, s.team, s.slot).name)
            ?? ([{ team: prefer, slot: 0 }, { team: prefer, slot: 1 }].find((s) => !(0, exports.slotOf)(lobby, s.team, s.slot).name));
        if (seat)
            return seat;
    }
    return JOIN_ORDER.find((s) => !(0, exports.slotOf)(lobby, s.team, s.slot).name) ?? null;
}
const clampStat = (v, min, max, dflt) => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
    return Math.max(min, Math.min(max, n));
};
/** Freeze a raw pet (from a save) to the fields the sim/renderer use. */
function snapshotPet(raw) {
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
        role: ARENA_ROLES.has(raw.role) ? raw.role : undefined,
    };
}
/**
 * Resolve the player's two chosen pet ids against the pets they actually own.
 * Consumes one owned pet per requested id (so two distinct instances sharing a
 * template id both work, but a single owned pet can't be picked twice). Returns
 * null when the count is wrong or any id isn't owned — the caller rejects.
 */
function chooseOwnedPets(owned, petIds) {
    if (!Array.isArray(petIds) || petIds.length !== exports.PETS_PER_PLAYER)
        return null;
    const pool = owned.slice();
    const chosen = [];
    for (const id of petIds) {
        const idx = pool.findIndex((p) => String(p.id ?? "") === String(id));
        if (idx < 0)
            return null;
        chosen.push(snapshotPet(pool[idx]));
        pool.splice(idx, 1);
    }
    return chosen;
}
/** Index of the array entry with the max (or min) score; ties → lowest index. */
function pick(idx, score, dir) {
    let best = idx[0];
    for (const i of idx) {
        const better = dir === "max" ? score(i) > score(best) : score(i) < score(best);
        if (better)
            best = i;
    }
    return best;
}
/**
 * Roles for a team. Prefers each pet's NATIVE role (from the owner's save) so
 * players field their OWN comps — no forced rebalance. Falls back to a
 * stat-profile assignment only when a pet is missing a role (e.g. a pre-feature
 * save): toughest → Defender, best attack+speed → Assassin, weakest attacker →
 * Sage, the rest → Tracker. Deterministic; the result is sealed into the match.
 */
function autoArenaRoles(pets) {
    if (pets.length > 0 && pets.every((p) => p.role))
        return pets.map((p) => p.role);
    const n = pets.length;
    if (n <= 2)
        return pets.map((_, i) => (i === 0 ? "defender" : "assassin"));
    const all = pets.map((_, i) => i);
    const def = pick(all, (i) => pets[i].defense, "max");
    const rest1 = all.filter((i) => i !== def);
    const asn = pick(rest1, (i) => pets[i].attack + pets[i].speed, "max");
    const rest2 = rest1.filter((i) => i !== asn);
    const sge = pick(rest2, (i) => pets[i].attack, "min");
    return all.map((i) => (i === def ? "defender" : i === asn ? "assassin" : i === sge ? "sage" : "tracker"));
}
// Fixed AI pool for empty seats. Ids are ones the client already renders in the
// arena (pose flipbooks exist), and stats are arena-balanced mids. Picked in
// order across all empty seats at start, so a sealed match is fully concrete and
// identical for every client (no client-side AI rolling → no replay divergence).
exports.AI_POOL = [
    { id: "legendary-0", name: "Aegis Sentinel", rarity: "legendary", level: 30, hp: 920, attack: 84, defense: 88, speed: 64, element: "Earth", role: "defender" },
    { id: "legendary-1", name: "Stormtalon", rarity: "legendary", level: 30, hp: 660, attack: 132, defense: 38, speed: 122, element: "Lightning", role: "assassin" },
    { id: "legendary-2", name: "Cinderfang", rarity: "legendary", level: 30, hp: 720, attack: 124, defense: 48, speed: 96, element: "Fire", role: "assassin" },
    { id: "legendary-3", name: "Tidepriest", rarity: "legendary", level: 30, hp: 780, attack: 78, defense: 70, speed: 72, element: "Water", role: "sage" },
    { id: "generic-ai-pet-guardhound", name: "Guardhound", rarity: "rare", level: 28, hp: 840, attack: 92, defense: 80, speed: 70, element: "Earth", role: "defender" },
    { id: "generic-ai-pet-emberlynx", name: "Emberlynx", rarity: "rare", level: 28, hp: 680, attack: 120, defense: 44, speed: 108, element: "Fire", role: "tracker" },
    { id: "legendary-4", name: "Galewing", rarity: "legendary", level: 30, hp: 700, attack: 110, defense: 52, speed: 116, element: "Wind", role: "tracker" },
    { id: "legendary-5", name: "Mossward", rarity: "legendary", level: 30, hp: 880, attack: 80, defense: 84, speed: 60, element: "Earth", role: "defender" },
];
/**
 * Seal the match. For each team, take its two player seats in order — each
 * contributes its 2 pets, and an empty seat draws the next 2 from the AI pool —
 * giving 4 pets per team, then assign roles. Pet order is [seat0.a, seat0.b,
 * seat1.a, seat1.b] so each player's pair shares a spawn seal (the sim seats
 * slots 0-1 at seal A, 2-3 at seal B).
 */
function resolveMatch(lobby, seed) {
    let aiCursor = 0;
    const buildTeam = (team) => {
        const pets = [];
        for (const slot of [0, 1]) {
            const s = (0, exports.slotOf)(lobby, team, slot);
            if (s.name && s.pets.length === exports.PETS_PER_PLAYER) {
                pets.push(s.pets[0], s.pets[1]);
            }
            else {
                pets.push(exports.AI_POOL[aiCursor % exports.AI_POOL.length], exports.AI_POOL[(aiCursor + 1) % exports.AI_POOL.length]);
                aiCursor += 2;
            }
        }
        const roles = autoArenaRoles(pets);
        return pets.map((pet, i) => ({ pet, role: roles[i] }));
    };
    return { seed, blue: buildTeam("blue"), red: buildTeam("red") };
}
/** Can the host start? Everyone who JOINED must be ready; empty seats are AI. */
function startBlock(lobby, requester) {
    if (lobby.state !== "lobby")
        return "Match already started.";
    if (lobby.host !== requester)
        return "Only the host can start the match.";
    const joined = lobby.slots.filter((s) => s.name);
    if (!joined.some((s) => s.name === lobby.host && s.ready))
        return "Pick your two pets first.";
    if (joined.some((s) => !s.ready))
        return "Waiting for all players to pick their pets.";
    return null;
}
function publicView(lobby, viewer) {
    const mine = (0, exports.findPlayerSlot)(lobby, viewer);
    return {
        code: lobby.code,
        host: lobby.host,
        state: lobby.state,
        you: mine ? { team: mine.team, slot: mine.slot } : null,
        seats: lobby.slots.map((s) => ({ team: s.team, slot: s.slot, name: s.name, ready: s.ready, petCount: s.pets.length, isYou: s.name === viewer })),
        match: lobby.state === "running" ? lobby.match : null,
        createdAt: lobby.createdAt,
    };
}
