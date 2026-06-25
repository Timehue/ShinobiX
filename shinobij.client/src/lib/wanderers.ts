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
        names: ["Saji Two-Coins", "Lady Miraa", "Old Tatsu", "Kael of Sixes"],
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
        names: ["Sister Yuki", "Brother Mibu", "Wandering Aki", "Old Doteki"],
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
        names: ["Wandering Sage", "Old Hermit Roku", "Sister Kaede", "The Grey Pilgrim", "Master Tobei"],
        greetings: [
            "These roads aren't safe, traveler. Lend your blade to a task?",
            "The wilds grow bold. I'd ask a favor of a capable shinobi.",
            "Walk with purpose — I've a task that needs doing.",
        ],
    },
};

const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as WandererArchetypeId[];

/** Per-device opt-in. Default OFF — the feature stays dark until a device sets it. */
export function isWanderersEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("wanderers.v1") === "on"; } catch { return false; }
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

/**
 * The deterministic roster for a sector at a given 6h bucket. Same inputs →
 * identical roster (verified in wanderers.test.ts), so nothing flickers and the
 * server could re-derive the exact same cast if a later phase needs to.
 */
export function rollWanderers(sector: number, dayBucket: number): Wanderer[] {
    if (!Number.isFinite(sector) || sector <= 0) return [];
    const rng = mulberry32(seedFrom(sector, dayBucket));
    const count = 1 + Math.floor(rng() * 3); // 1..3
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
    { id: "wq-cull",   label: "Win 3 battles against any foe",       metric: "totalAiKills",       target: 3 },
    { id: "wq-purge",  label: "Win 6 battles against any foe",       metric: "totalAiKills",       target: 6 },
    { id: "wq-beasts", label: "Win 2 pet duels in the coliseum",     metric: "totalPetWins",       target: 2 },
    { id: "wq-cards",  label: "Win 2 rounds of Shinobi Card Clash",  metric: "cardClashWins",      target: 2 },
    { id: "wq-scout",  label: "Scout 10 tiles across the sectors",   metric: "totalTilesExplored", target: 10 },
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
