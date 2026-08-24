/*
 * Sector Wanderer roster — the ONE deterministic roll, shared by client and server.
 *
 * Every player standing in a sector at the same moment must see the SAME NPCs,
 * and the server must be able to re-derive that cast instead of trusting the
 * id/archetype/verb the client reports. So the roll is a pure function of
 * (sector, dayBucket) and NOTHING about the player: no content locks, no name
 * hashing. What a given player may DO with a wanderer (a gambler before the
 * codex, a beast with no pet) is gated at the interaction, not by changing who
 * is on the road — see `wandererVerbLockReason` in lib/wanderers.ts.
 *
 *   client: shinobij.client/src/lib/wanderers.ts re-exports everything here
 *   server: api/sector/_wanderer-encounter.ts + api/missions/_world-ai-fight.ts
 *
 * Keep this module dependency-free apart from shared/sector-geo so both sides
 * can import it (the server compiles it under Node16 resolution, the client
 * under Vite's bundler resolution — plain ESM, no enums, no `.js` imports of
 * anything outside shared/).
 */
import { MAX_WILD_SECTOR } from "./sector-geo.js";

export type WandererVerb =
    | "attack" | "gift" | "gamble" | "petDuel" | "quest"
    | "merchant" | "medic" | "patrol" | "tracker" | "courier" | "bountyHunter"
    | "legacyQuest"
    /** Passive: visible and greets when you walk up, but offers NO action. Used for
     *  a Contract Hunter seen by a bystander — it is hunting someone ELSE. */
    | "watch";
export type WandererArchetypeId =
    | "bandit" | "gambler" | "pilgrim" | "beast" | "sage"
    | "merchant" | "medic" | "patrol" | "tracker" | "courier" | "bountyHunter"
    | "wanderingSage"
    // The eight Legacy Emissaries (lib/legacy-emissaries.ts) — weight-0 like the
    // Sage: never rolled into the natural cast, synthed per window.
    | "storm-caller-ryn" | "veil-mother-suzu" | "iron-pilgrim-daigo" | "blade-keeper-hana"
    | "duel-broker-kesshi" | "hollow-warden" | "lantern-warden-mei" | "mapless-ojii";

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
    /** Optional exact portrait override for authored/story NPCs. */
    avatarImage?: string;
    /** Optional synthetic metadata for chained encounters. */
    targetName?: string;
    bountyAmount?: number;
    originSector?: number;
    targetSector?: number;
    expiresAt?: number;
    factionVillage?: string;
}

export const WANDERER_GRID = 12;
const GRID = WANDERER_GRID;

export interface WandererArchetypeMeta {
    verb: WandererVerb;
    weight: number;
    tellTint: string;
    names: string[];
    greetings: string[];
}

// The Phase-1 cast. Voices mirror docs/sector-wanderers-content.md.
export const WANDERER_ARCHETYPES: Record<WandererArchetypeId, WandererArchetypeMeta> = {
    bandit: {
        // 2026-07 clutter pass: 0.30 → 0.24. The bandit is the only archetype that
        // WALKS AT YOU and forces a Fight/Flee choice, so it sets how intrusive the
        // road feels — it was ~2× the support cast. Knock-on: the robberStreak
        // ambush gauntlet (5 fends → gang) now triggers proportionally less often.
        verb: "attack",
        weight: 0.24,
        tellTint: "#ff6b5a",
        names: ["Kazan the Ashbound", "Goro Two-Blades", "Saito the Cinder", "Renga of the Waste", "Hibiki the Restless"],
        greetings: [
            "This stretch of road is mine. Pay the toll — or bleed.",
            "Hand over your ryo, leaf-rat. Choose quick.",
            "Wrong road to walk alone.",
            "Far from home. That makes this easy.",
            "Toll road. New policy. Started about when I saw you coming.",
        ],
    },
    gambler: {
        verb: "gamble",
        weight: 0.18,
        tellTint: "#ffd24a",
        names: ["Saji Two-Coins", "Miraa the Sly", "Old Tatsu", "Kael of Sixes"],
        greetings: [
            "Care for a hand, friend? Small stakes. Mostly.",
            "May the better liar win — and I'm a very good liar.",
            "Fresh Chronicle deck, and nobody on this road brave enough to sit down. You look brave.",
            "One game. I win, we call it tuition. You win, the purse is yours.",
        ],
    },
    pilgrim: {
        verb: "gift",
        weight: 0.18,
        tellTint: "#7be0a3",
        names: ["Brother Yuki", "Brother Mibu", "Wandering Aki", "Old Doteki"],
        greetings: [
            "Rest a moment, traveler. The road is long.",
            "Here — take something for the road. An old man's pack is too heavy already.",
            "Sit, sit — well, don't sit, you're in a hurry, I can tell. Take this anyway.",
            "Take it, take it. An old man needs a lighter pack more than he needs ryo.",
        ],
    },
    beast: {
        verb: "petDuel",
        weight: 0.16,
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
        weight: 0.16,
        tellTint: "#8fd0ff",
        names: ["Old Hermit Roku", "Hermit Kaede", "The Grey Ascetic", "Master Tobei", "Sister Uzune"],
        greetings: [
            "These roads aren't safe, traveler. Lend your blade to a task?",
            "You look capable, and I'm past pretending I can handle this myself. A task, for fair pay?",
            "I've been waiting all day for someone who doesn't walk like a victim. Got a moment?",
        ],
    },
    merchant: {
        verb: "merchant",
        weight: 0.15,
        tellTint: "#fbbf24",
        names: ["Miko of the Pack", "Suri Lantern-Hands", "Jin the Mule", "Tama Roadstall"],
        greetings: [
            "Road prices, friend. Everything costs more out where the patrols don't reach.",
            "Keep your blade low and your coins ready.",
            "Everything's for sale except the mule. People keep asking about the mule.",
        ],
    },
    medic: {
        verb: "medic",
        weight: 0.14,
        tellTint: "#67e8f9",
        names: ["Nurse Enka", "Field Medic Ren", "Old Stitch", "Sister Koma"],
        greetings: [
            "You look like the road has been chewing on you.",
            "Bandage, tonic, steady hands. Sit down if you need mending.",
            "I don't ask who hit first. I patch whoever's bleeding.",
        ],
    },
    patrol: {
        verb: "patrol",
        weight: 0.14,
        tellTint: "#93c5fd",
        names: ["Storm Road Patrol", "Ashen Border Patrol", "Frostfang Scout", "Moonshadow Sentry"],
        greetings: [
            "State your village and your business.",
            "These roads are watched. Move along and we've got no quarrel.",
            "Patrol coming through. Seen anything on the road we should hear about?",
        ],
    },
    tracker: {
        verb: "tracker",
        weight: 0.14,
        tellTint: "#a7f3d0",
        names: ["Ibo the Tracker", "Kana Reed-Eyes", "Old Pawprint", "Shin of the Bent Grass"],
        greetings: [
            "Fresh tracks cross this dirt. Something bold is nearby.",
            "Something big crossed here before dawn, dragging a paw. If that beast of yours is game, it's worth following.",
            "I can point you toward teeth, coin, or trouble. Sometimes all three.",
        ],
    },
    courier: {
        verb: "courier",
        weight: 0,
        tellTint: "#fde68a",
        names: ["Road Courier"],
        greetings: [
            "Package sealed. Name checked. You made good time.",
        ],
    },
    bountyHunter: {
        verb: "bountyHunter",
        weight: 0,
        tellTint: "#f87171",
        names: ["Contract Hunter"],
        greetings: [
            "Your face matches the bounty slip.",
        ],
    },
    // The Legacy system's Wandering Sage (lib/legacy.ts synthSageWanderer).
    // weight 0 = never rolled into the natural cast; spawned server-side only,
    // per-player, when a Legacy offer is waiting (api/legacy/sage.ts).
    wanderingSage: {
        verb: "quest",
        weight: 0,
        tellTint: "#c084fc",
        names: ["The Wandering Sage"],
        greetings: [
            "I've watched your path a long while, shinobi.",
        ],
    },
    // The eight Legacy Emissaries. All weight 0: like the Sage they are synthed
    // per window (lib/legacy-emissaries.ts rollEmissarySpawn), never rolled into
    // the natural cast — these entries exist to satisfy the archetype record;
    // the synth supplies the real voice/tint from EMISSARY_DEFS.
    "storm-caller-ryn":   { verb: "legacyQuest", weight: 0, tellTint: "#60a5fa", names: ["Storm-Caller Ryn"],   greetings: ["The clouds told me you were coming."] },
    "veil-mother-suzu":   { verb: "legacyQuest", weight: 0, tellTint: "#c084fc", names: ["Veil-Mother Suzu"],   greetings: ["Don't mind the moths."] },
    "iron-pilgrim-daigo": { verb: "legacyQuest", weight: 0, tellTint: "#f59e0b", names: ["Iron Disciple Daigo"], greetings: ["Every bead is a fight without a weapon."] },
    "blade-keeper-hana":  { verb: "legacyQuest", weight: 0, tellTint: "#e2e8f0", names: ["Blade-Keeper Hana"],  greetings: ["The swords are listening."] },
    "duel-broker-kesshi": { verb: "legacyQuest", weight: 0, tellTint: "#f87171", names: ["Duel-Broker Kesshi"], greetings: ["Everything's a wager, friend."] },
    "hollow-warden":      { verb: "legacyQuest", weight: 0, tellTint: "#4ade80", names: ["The Hollow Warden"],  greetings: ["Speak softly, or interestingly."] },
    "lantern-warden-mei": { verb: "legacyQuest", weight: 0, tellTint: "#fbbf24", names: ["Lantern-Warden Mei"], greetings: ["Shield in one hand, lantern in the other."] },
    "mapless-ojii":       { verb: "legacyQuest", weight: 0, tellTint: "#7be0a3", names: ["Mapless Ojii"],       greetings: ["This map is blank on purpose."] },
};

const ARCHETYPE_IDS = Object.keys(WANDERER_ARCHETYPES) as WandererArchetypeId[];

// ── Clock ────────────────────────────────────────────────────────────────────
export const WANDERER_BUCKET_MS = 6 * 60 * 60 * 1000;

/** Roster refreshes every 6h so a sector's cast changes a few times a day.
 *  Takes epoch MILLISECONDS — callers on the client should pass `serverNow()`
 *  so a skewed device never rolls a window the server refuses. */
export function wandererDayBucketFromMs(nowMs: number): number {
    return Math.floor(nowMs / WANDERER_BUCKET_MS);
}

// ── deterministic RNG (mulberry32 over an FNV-1a seed) ───────────────────────
export function wandererSeedFrom(sector: number, dayBucket: number): number {
    let h = 2166136261 >>> 0;
    for (const n of [sector | 0, dayBucket | 0]) {
        h ^= n & 0xff;        h = Math.imul(h, 16777619);
        h ^= (n >>> 8) & 0xff; h = Math.imul(h, 16777619);
        h ^= (n >>> 16) & 0xff; h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** FNV-1a over a string key → 32-bit seed. */
export function wandererHash32(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministic presence gate for the "the road finds you" quest-giver NPCs
 * (story road events, rift givers): instead of following you into EVERY sector
 * until dealt with — which reads as wallpaper — the NPC is present in roughly
 * `chance` of sectors per 6h window. Same key → same answer, so nothing
 * flickers; the blocked sectors reshuffle when the window rolls over. Callers
 * key by (feature, npc/quest id, sector, dayBucket) — NEVER by player, so
 * everyone in the sector agrees on who is standing there.
 */
export function wandererPresenceGate(key: string, chance: number): boolean {
    return mulberry32(wandererHash32(key))() < chance;
}

/** Weighted draw over the natural cast (weight > 0). Consumes exactly one rng
 *  value. */
function pickWeightedArchetype(r: number): WandererArchetypeId {
    const pool = ARCHETYPE_IDS.filter((id) => WANDERER_ARCHETYPES[id].weight > 0);
    const total = pool.reduce((s, id) => s + WANDERER_ARCHETYPES[id].weight, 0);
    let x = r * total;
    for (const id of pool) {
        x -= WANDERER_ARCHETYPES[id].weight;
        if (x <= 0) return id;
    }
    return pool[pool.length - 1];
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

// Spawn rarity — a wanderer is an OCCASIONAL encounter, not a fixture. Roughly
// half of wild sectors are empty in a given 6h window; most of the rest have one;
// a pair is uncommon. Tune these two thresholds to taste (raise EMPTY_CHANCE for
// rarer, lower for busier). 2026-07 balance pass: 0.6/0.92 → 0.52/0.88 so the
// flattened archetype weights above actually get room to show their whole cast.
const WANDERER_EMPTY_CHANCE = 0.52;  // ~52% of sectors: nobody this window
// 2026-07 clutter pass: 0.88 → 0.93, so a two-wanderer sector drops from ~12% to
// ~7%. The EMPTY chance is deliberately left alone — raising it would undo the
// earlier pass that gave the flattened archetype weights room to show the whole
// cast. It's the CROWDED tail, not the occupancy rate, that reads as clutter.
const WANDERER_SINGLE_CHANCE = 0.93; // 0.52–0.93 → one; 0.93–1.0 → two
export function wandererCount(roll: number): 0 | 1 | 2 {
    if (roll < WANDERER_EMPTY_CHANCE) return 0;
    if (roll < WANDERER_SINGLE_CHANCE) return 1;
    return 2;
}
/** Highest roster index a natural wanderer id may carry. */
export const WANDERER_MAX_INDEX = 1;

/**
 * The deterministic roster for a sector at a given 6h bucket. Same inputs →
 * identical roster, for EVERY player and for the server, so nothing flickers
 * and the server re-derives the exact cast before paying anything out.
 */
export function rollWanderers(sector: number, dayBucket: number): Wanderer[] {
    if (!Number.isFinite(sector) || sector <= 0) return [];
    const rng = mulberry32(wandererSeedFrom(sector, dayBucket));
    const count = wandererCount(rng());
    const used = new Set<number>();
    const out: Wanderer[] = [];

    for (let i = 0; i < count; i++) {
        const archetype = pickWeightedArchetype(rng());
        const meta = WANDERER_ARCHETYPES[archetype];

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

// ── Ids + relocation ─────────────────────────────────────────────────────────
export const WANDERER_SECTOR_COUNT = MAX_WILD_SECTOR;

/** Parse the home sector + window bucket + roster index out of a wanderer id
 *  (`w-<sector>-<dayBucket>-<index>`). Returns null for ids that aren't real
 *  wanderers (e.g. server-synthesised `merc-…` NPCs), which therefore never
 *  relocate. */
export function parseWandererId(id: string): { sector: number; dayBucket: number; index: number } | null {
    const m = /^w-(\d+)-(\d+)-(\d+)$/.exec(String(id ?? ""));
    if (!m) return null;
    return { sector: Number(m[1]), dayBucket: Number(m[2]), index: Number(m[3]) };
}

/**
 * Server-side authority: the wanderer an id names, IF AND ONLY IF the id is a
 * well-formed natural id for the CURRENT window and the shared roll actually
 * places someone at that roster index. Anything else — a forged sector, a stale
 * or future bucket, an index past the rolled count — resolves to null, so a
 * caller can never be paid for an NPC the world does not contain right now.
 */
export function resolveWandererById(id: string, nowMs: number): Wanderer | null {
    const parsed = parseWandererId(id);
    if (!parsed
        || !Number.isSafeInteger(parsed.sector) || parsed.sector < 1 || parsed.sector > WANDERER_SECTOR_COUNT
        || !Number.isSafeInteger(parsed.dayBucket) || parsed.dayBucket < 0
        || !Number.isSafeInteger(parsed.index) || parsed.index < 0 || parsed.index > WANDERER_MAX_INDEX
        || parsed.dayBucket !== wandererDayBucketFromMs(nowMs)) return null;
    return rollWanderers(parsed.sector, parsed.dayBucket)[parsed.index] ?? null;
}

/** The sector a wanderer wanders off to after being dealt with — deterministic
 *  from (id, the sector it was just found in) and always a DIFFERENT sector, so a
 *  repeat encounter nudges it somewhere new instead of back where it started. */
export function wandererRelocationSector(id: string, fromSector: number, maxSector: number = WANDERER_SECTOR_COUNT): number {
    const h = wandererHash32(`${id}#${fromSector}`);
    const span = Math.max(1, maxSector - 1);
    let dest = 1 + (h % span);              // 1..maxSector-1
    if (dest >= fromSector) dest += 1;      // skip `fromSector` → 1..maxSector minus it
    return Math.max(1, Math.min(maxSector, dest));
}

/** Re-home a wanderer into `sector` at a deterministic interior tile + patrol, so a
 *  visiting wanderer holds still in its new sector instead of jumping around. */
export function relocateWandererInto(w: Wanderer, sector: number): Wanderer {
    const rng = mulberry32(wandererHash32(`${w.id}@${sector}`));
    const home = interiorTile(rng);
    const waypoints = [home];
    const legs = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < legs; i++) waypoints.push(nearbyTile(home, rng));
    return { ...w, homeTile: home, waypoints: Array.from(new Set(waypoints)) };
}
