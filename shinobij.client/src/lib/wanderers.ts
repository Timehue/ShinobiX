/*
 * Sector Wanderers — AI shinobi that roam a sector looking like players.
 *
 * This module is the PURE, testable core: a per-sector roster that is generated
 * deterministically from (sector, dayBucket) so the cast of a sector is stable
 * for a while and refreshes on a believable clock — no flicker, no server round
 * trip, no save state. Rendering + movement live in <SectorWanderer>; the
 * encounter wiring (and the only thing that touches combat) lives in <WorldMap>.
 *
 * Phase 1 scope (behind the `wanderers.v1` opt-in flag, default OFF): wanderers
 * spawn, walk/patrol/approach, and the ones whose function is to ROB/ATTACK
 * launch a fight when they reach the player. Gift / gamble archetypes just greet
 * for now (their reward economy is a later, server-authoritative phase — see
 * docs/sector-wanderers-plan.md §5).
 *
 * See also docs/sector-wanderers-content.md for the written character voice.
 */

export type WandererVerb = "attack" | "gift" | "gamble" | "petDuel" | "quest";
export type WandererArchetypeId = "bandit" | "gambler" | "pilgrim" | "beast" | "sage";

export interface Wanderer {
    /** stable within (sector, dayBucket) */
    id: string;
    name: string;
    archetype: WandererArchetypeId;
    verb: WandererVerb;
    /** banded to the sector; drives the AI tier when an attacker engages */
    level: number;
    /** 0..143 grid tile the wanderer starts on */
    homeTile: number;
    /** patrol route (includes home); the wanderer ambles between these */
    waypoints: number[];
    /** the line shown when you meet a non-attacker (and as a bandit's opener) */
    greeting: string;
    /** colour of the small "this is a wanderer" tell ring */
    tellTint: string;
    /** which face from the existing NPC art pool to wear (mapped in the component) */
    avatarKey: WandererArchetypeId;
}

const GRID = 12;

interface ArchetypeMeta {
    verb: WandererVerb;
    weight: number;
    tellTint: string;
    names: string[];
    greetings: string[];
}

// The Phase-1 cast. Voices mirror docs/sector-wanderers-content.md.
const ARCHETYPES: Record<WandererArchetypeId, ArchetypeMeta> = {
    bandit: {
        verb: "attack",
        weight: 0.45,
        tellTint: "#ff6b5a",
        names: ["Kazan the Ashbound", "Goro Two-Blades", "Saito the Cinder", "Renga of the Waste", "Hibiki the Restless"],
        greetings: [
            "This stretch of road is mine. Pay the toll — or bleed.",
            "Hand over your ryo, leaf-rat. Choose quick.",
            "Wrong road to walk alone.",
            "Far from home. That makes this easy.",
        ],
    },
    gambler: {
        verb: "gamble",
        weight: 0.2,
        tellTint: "#ffd24a",
        names: ["Saji Two-Coins", "Miraa the Sly", "Old Tatsu", "Kael of Sixes"],
        greetings: [
            "Care for a hand of cards, friend?",
            "Three locations, one purse. You in?",
            "May the better liar win — and I'm a very good liar.",
        ],
    },
    pilgrim: {
        verb: "gift",
        weight: 0.2,
        tellTint: "#7be0a3",
        names: ["Brother Yuki", "Brother Mibu", "Wandering Aki", "Old Doteki"],
        greetings: [
            "Rest a moment, traveler. The road is long.",
            "A blessing for the road — take it.",
            "You hear it? No. No one does anymore.",
        ],
    },
    beast: {
        verb: "petDuel",
        weight: 0.15,
        tellTint: "#9bf0a6",
        names: ["Wild Emberlynx", "Stray Oni-Hound", "Feral Stormcrow", "Rogue Guardhound", "Lone Sparrowhawk"],
        greetings: [
            "A wild beast bars your path, hackles raised.",
            "It locks eyes with your pet — a challenge.",
            "The creature snarls, daring your beast to step up.",
        ],
    },
    sage: {
        verb: "quest",
        weight: 0.15,
        tellTint: "#8fd0ff",
        names: ["Wandering Sage", "Old Hermit Roku", "Hermit Kaede", "The Grey Pilgrim", "Master Tobei"],
        greetings: [
            "These roads aren't safe, traveler. Lend your blade to a task?",
            "The wilds grow bold. I'd ask a favor of a capable shinobi.",
            "Walk with purpose — I've a task that needs doing.",
        ],
    },
};

const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as WandererArchetypeId[];

/** Default ON for everyone; opt out per-device with localStorage `wanderers.v1 = "off"`. */
export function isWanderersEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("wanderers.v1") !== "off"; } catch { return true; }
}

// ── Per-NPC anti-spam cooldown ───────────────────────────────────────────────
// After a player takes a REPEATABLE reward from a wanderer (fight a bandit, take a
// pilgrim's gift, duel a beast/gambler), that specific NPC goes on cooldown so it
// can't be farmed — it vanishes from the sector for a few hours. Sages (quests) are
// NOT cooled: a quest is one-at-a-time already, and you need a sage to continue an
// active epic. Keyed by the wanderer's stable id → expiry ms.
export const WANDERER_NPC_COOLDOWN_MS = 3 * 60 * 60 * 1000; // a few hours
// A SHORTER "back off" cooldown for when you FLEE/decline a bandit instead of
// fighting it. You took no reward, so it shouldn't vanish for the full anti-farm
// window — but it must stop hunting you, or the same bandit re-confronts you every
// single time you re-enter the sector until the 6h roster rolls over.
export const WANDERER_FLEE_COOLDOWN_MS = 30 * 60 * 1000; // half an hour

export function isWandererOnCooldown(
    cooldowns: Record<string, number> | null | undefined,
    id: string,
    now: number,
): boolean {
    const exp = cooldowns?.[id];
    return typeof exp === "number" && exp > now;
}

/** A new cooldown map with `id` cooled until now + `ms` (defaults to the full
 *  anti-farm window; pass WANDERER_FLEE_COOLDOWN_MS for a short flee back-off),
 *  with already-expired entries pruned so the map stays tiny on the save. */
export function withWandererCooldown(
    cooldowns: Record<string, number> | null | undefined,
    id: string,
    now: number,
    ms: number = WANDERER_NPC_COOLDOWN_MS,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cooldowns ?? {})) {
        if (typeof v === "number" && v > now) out[k] = v;
    }
    out[id] = now + ms;
    return out;
}

/** Roster refreshes every 6h so a sector's cast changes a few times a day. */
export function wandererDayBucket(now: Date): number {
    return Math.floor(now.getTime() / (6 * 60 * 60 * 1000));
}

// ── deterministic RNG (mulberry32 over an FNV-1a seed) ───────────────────────
function seedFrom(sector: number, dayBucket: number): number {
    let h = 2166136261 >>> 0;
    for (const n of [sector | 0, dayBucket | 0]) {
        h ^= n & 0xff;        h = Math.imul(h, 16777619);
        h ^= (n >>> 8) & 0xff; h = Math.imul(h, 16777619);
        h ^= (n >>> 16) & 0xff; h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickWeightedArchetype(r: number): WandererArchetypeId {
    const total = ARCHETYPE_IDS.reduce((s, id) => s + ARCHETYPES[id].weight, 0);
    let x = r * total;
    for (const id of ARCHETYPE_IDS) {
        x -= ARCHETYPES[id].weight;
        if (x <= 0) return id;
    }
    return "bandit";
}

// Keep wanderers in the interior of the 12×12 board (away from the corners/edges
// where the UI chrome and the player's spawn tend to sit).
function interiorTile(rng: () => number): number {
    const col = 2 + Math.floor(rng() * 8); // 2..9
    const row = 2 + Math.floor(rng() * 8); // 2..9
    return row * GRID + col;
}

function nearbyTile(tile: number, rng: () => number): number {
    const col = tile % GRID;
    const row = Math.floor(tile / GRID);
    const nc = Math.max(1, Math.min(10, col + (Math.floor(rng() * 5) - 2)));
    const nr = Math.max(1, Math.min(10, row + (Math.floor(rng() * 5) - 2)));
    return nr * GRID + nc;
}

/** Banded to the sector so an attacker scales to where the player is. */
export function wandererLevelFor(sector: number, rng: () => number): number {
    const base = 6 + sector * 1.4;
    const jitter = Math.floor(rng() * 7) - 3; // ±3
    return Math.max(3, Math.min(95, Math.round(base + jitter)));
}

// Spawn rarity — a wanderer is an OCCASIONAL encounter, not a fixture. Most wild
// sectors are empty in a given 6h window; some have one; a pair is rare. Tune
// these two thresholds to taste (raise EMPTY_CHANCE for rarer, lower for busier).
const WANDERER_EMPTY_CHANCE = 0.6;   // ~60% of sectors: nobody this window
const WANDERER_SINGLE_CHANCE = 0.92; // 0.6–0.92 → one; 0.92–1.0 → two
export function wandererCount(roll: number): 0 | 1 | 2 {
    if (roll < WANDERER_EMPTY_CHANCE) return 0;
    if (roll < WANDERER_SINGLE_CHANCE) return 1;
    return 2;
}

/**
 * The deterministic roster for a sector at a given 6h bucket. Same inputs →
 * identical roster (verified in wanderers.test.ts), so nothing flickers and the
 * server could re-derive the exact same cast if a later phase needs to.
 */
export function rollWanderers(sector: number, dayBucket: number): Wanderer[] {
    if (!Number.isFinite(sector) || sector <= 0) return [];
    const rng = mulberry32(seedFrom(sector, dayBucket));
    const count = wandererCount(rng());
    const used = new Set<number>();
    const out: Wanderer[] = [];

    for (let i = 0; i < count; i++) {
        const archetype = pickWeightedArchetype(rng());
        const meta = ARCHETYPES[archetype];

        let home = interiorTile(rng);
        let guard = 0;
        while (used.has(home) && guard++ < 8) home = interiorTile(rng);
        used.add(home);

        const waypoints = [home];
        const legs = 2 + Math.floor(rng() * 2); // 2..3 extra stops
        for (let w = 0; w < legs; w++) waypoints.push(nearbyTile(home, rng));

        out.push({
            id: `w-${sector}-${dayBucket}-${i}`,
            name: meta.names[Math.floor(rng() * meta.names.length)],
            archetype,
            verb: meta.verb,
            level: wandererLevelFor(sector, rng),
            homeTile: home,
            waypoints: Array.from(new Set(waypoints)),
            greeting: meta.greetings[Math.floor(rng() * meta.greetings.length)],
            tellTint: meta.tellTint,
            avatarKey: archetype,
        });
    }
    return out;
}

// ── Relocation: a wanderer you've dealt with moves ON, not back ───────────────
// The per-NPC cooldown above hides a wanderer in its sector for a few hours — but
// the deterministic roster would otherwise drop it right back in the SAME sector
// the moment its cooldown lifts, so it "sits" there and can be re-farmed on a slow
// timer. Relocation closes that: interacting with a wanderer also records the
// sector it wanders off to (id → destination sector). Its home sector then stops
// listing it for the rest of the window, and it re-surfaces (once its cooldown has
// lifted) in the NEW sector instead — where dealing with it again nudges it on once
// more. We persist ONLY the destination (a number); the visiting wanderer is
// re-derived from its id, which already encodes its home sector + roster index, so
// nothing about the wanderer is duplicated onto the save. Merc/synthetic ids don't
// match the id shape and never relocate (they're server-driven). Keyed, like the
// cooldowns, by the wanderer's stable id. The whole map self-clears every 6h window
// (a stale-bucket prune), so it stays tiny.
const SECTOR_COUNT = 60;

/** Parse the home sector + window bucket + roster index out of a wanderer id
 *  (`w-<sector>-<dayBucket>-<index>`). Returns null for ids that aren't real
 *  wanderers (e.g. server-synthesised `merc-…` NPCs), which therefore never
 *  relocate. */
export function parseWandererId(id: string): { sector: number; dayBucket: number; index: number } | null {
    const m = /^w-(\d+)-(\d+)-(\d+)$/.exec(id);
    if (!m) return null;
    return { sector: Number(m[1]), dayBucket: Number(m[2]), index: Number(m[3]) };
}

/** The sector a wanderer wanders off to after being dealt with — deterministic
 *  from (id, the sector it was just found in) and always a DIFFERENT sector, so a
 *  repeat encounter nudges it somewhere new instead of back where it started. */
export function wandererRelocationSector(id: string, fromSector: number, maxSector: number = SECTOR_COUNT): number {
    let h = 2166136261 >>> 0;
    const key = `${id}#${fromSector}`;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const span = Math.max(1, maxSector - 1);
    let dest = 1 + ((h >>> 0) % span);      // 1..maxSector-1
    if (dest >= fromSector) dest += 1;      // skip `fromSector` → 1..maxSector minus it
    return Math.max(1, Math.min(maxSector, dest));
}

/** Drop relocation entries from a stale window (the id's dayBucket no longer
 *  matches the current one) so the map clears itself every 6h and never grows
 *  without bound on the save. */
export function pruneWandererMoves(
    moves: Record<string, number> | null | undefined,
    currentDayBucket: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, dest] of Object.entries(moves ?? {})) {
        const parsed = parseWandererId(id);
        if (!parsed || parsed.dayBucket !== currentDayBucket) continue;
        if (typeof dest === "number" && dest >= 1) out[id] = dest;
    }
    return out;
}

/** True if the wanderer with this id has wandered off (has an active relocation),
 *  so its HOME sector should stop listing it. */
export function hasWandererRelocated(
    moves: Record<string, number> | null | undefined,
    id: string,
): boolean {
    return moves != null && typeof moves[id] === "number";
}

/** Re-home a wanderer into `sector` at a deterministic interior tile + patrol, so a
 *  visiting wanderer holds still in its new sector instead of jumping around. */
function relocateWandererInto(w: Wanderer, sector: number): Wanderer {
    let h = 2166136261 >>> 0;
    const key = `${w.id}@${sector}`;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rng = mulberry32(h >>> 0);
    const home = interiorTile(rng);
    const waypoints = [home];
    const legs = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < legs; i++) waypoints.push(nearbyTile(home, rng));
    return { ...w, homeTile: home, waypoints: Array.from(new Set(waypoints)) };
}

/** Wanderers that have wandered INTO `sector` from elsewhere and are ready to be
 *  found again (their cooldown has lifted). Re-derived from their ids against the
 *  current window; entries pointing at other sectors, still on cooldown, or from a
 *  stale window are skipped. */
export function wanderersVisitingSector(
    sector: number,
    dayBucket: number,
    moves: Record<string, number> | null | undefined,
    cooldowns: Record<string, number> | null | undefined,
    now: number,
): Wanderer[] {
    const out: Wanderer[] = [];
    for (const [id, dest] of Object.entries(moves ?? {})) {
        if (dest !== sector) continue;
        if (isWandererOnCooldown(cooldowns, id, now)) continue; // still on the road
        const parsed = parseWandererId(id);
        if (!parsed || parsed.dayBucket !== dayBucket) continue; // stale window
        const w = rollWanderers(parsed.sector, dayBucket)[parsed.index];
        if (!w) continue;
        out.push(relocateWandererInto(w, sector));
    }
    return out;
}

// ── Quests (sage wanderers) ──────────────────────────────────────────────────
// Display catalog mirrored by the server (api/sector/_wanderer-quest.ts owns the
// authoritative targets + reward). Each quest tracks a real character counter, and
// the label states honestly what that counter measures (no "these roads" promise
// the mechanic can't keep — any qualifying win/explore counts).
export type WandererQuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored";
export interface WandererQuestDef {
    id: string;
    label: string;
    metric: WandererQuestMetric;
    target: number;
}
export const WANDERER_QUEST_CATALOG: WandererQuestDef[] = [
    { id: "wq-cull",       label: "Win 3 battles against any foe",        metric: "totalAiKills",       target: 3 },
    { id: "wq-purge",      label: "Win 6 battles against any foe",        metric: "totalAiKills",       target: 6 },
    { id: "wq-warpath",    label: "Cut down 10 foes — a real warpath",    metric: "totalAiKills",       target: 10 },
    { id: "wq-beasts",     label: "Win 2 pet duels in the coliseum",      metric: "totalPetWins",       target: 2 },
    { id: "wq-menagerie",  label: "Win 4 pet duels in the coliseum",      metric: "totalPetWins",       target: 4 },
    { id: "wq-cards",      label: "Win 2 rounds of Shinobi Card Clash",   metric: "cardClashWins",      target: 2 },
    { id: "wq-highroller", label: "Win 4 rounds of Shinobi Card Clash",   metric: "cardClashWins",      target: 4 },
    { id: "wq-scout",      label: "Scout 10 tiles across the sectors",    metric: "totalTilesExplored", target: 10 },
    { id: "wq-trailblaze", label: "Scout 25 tiles across the sectors",    metric: "totalTilesExplored", target: 25 },
];

/** The (stable) quest a given sage offers — deterministic from its id. */
export function questForWanderer(w: Wanderer): WandererQuestDef {
    let h = 0;
    for (let i = 0; i < w.id.length; i++) h = (Math.imul(h, 31) + w.id.charCodeAt(i)) >>> 0;
    return WANDERER_QUEST_CATALOG[h % WANDERER_QUEST_CATALOG.length];
}

/** Which character counter an active quest tracks (for client-side progress). */
export function questMetricForId(id: string): WandererQuestMetric {
    return WANDERER_QUEST_CATALOG.find((q) => q.id === id)?.metric ?? "totalAiKills";
}
