// DEV-ONLY harness to eyeball the Battle Tower fight board without a server.
// Served at /towerfx.html by vite dev. Mocks an active session showcasing EVERY
// board system at once: squad + enemy formation with the boss in back, pylon /
// ward / hazard flowers, TERRAIN PILLARS (biome obstacle art), BOARD OBJECTS
// (healing font + squad-held & enemy-held shrines), a primed VOLLEY telegraph
// (violet tiles + banner), and the boss-kit encounter chips (hunt/strike/aegis).
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowerFight } from "./screens/BattleTowerFight";
import type { TowerSession, TowerActor } from "./lib/towers-api";

const W = 20, H = 14;
function neighbors(pos: number): number[] {
    const x = pos % W, y = Math.floor(pos / W);
    const even = x % 2 === 0;
    const d = even ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]] : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return d.map(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx < 0 || nx >= W || ny < 0 || ny >= H ? -1 : ny * W + nx; }).filter(n => n >= 0);
}
const zone = (c: number) => [c, ...neighbors(c)];

function enemy(id: string, visual: string, name: string, pos: number, hp = 300, maxHp = 300): TowerActor {
    return {
        id, side: "enemy", name, ownerSlug: null, ai: true,
        hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos, character: { specialty: "Taijutsu", stats: {}, visual },
    };
}

// The Warden's primed volley: a violet telegraph centred on the squad's tile-region.
const STRIKE_TILES = [102, 103, 104, 122, 123, 124, 143];

const session: TowerSession = {
    towerId: "celestial", runId: "preview", floor: 2, seed: 1, partySize: 1,
    map: {
        width: W, height: H, biome: "forest",
        // Scattered terrain pillars (non-adjacent, like the server's scatterTerrain).
        blockedTiles: [46, 89, 132, 174, 216, 111],
        hazardTiles: [], objectiveTiles: [],
        // Spread, non-overlapping flowers (what the server's procedural placement produces).
        features: [
            { kind: "pylon", tiles: zone(66), element: "Fire", weakenElement: "Water", percent: 25, label: "Flame Pylon" },
            { kind: "pylon", tiles: zone(74), element: "Earth", weakenElement: "Lightning", percent: 25, label: "Stone Pylon" },
            { kind: "pylon", tiles: zone(128), element: "Wind", weakenElement: "Fire", percent: 25, label: "Gale Pylon" },
            { kind: "ward", tiles: zone(156), percent: 20, label: "Warded Stone" },
            { kind: "hazard", tiles: zone(210), percent: 12, label: "Frost Spikes" },
        ],
        // Board objects: a healing spring on the flank, a squad-held shrine (cyan ring —
        // Rill's ally stands on it) and an enemy-held shrine (rose ring).
        boardObjects: [
            { kind: "font", resource: "hp", percent: 8, cap: 120, tiles: [63], label: "Healing Spring" },
            { kind: "shrine", percent: 10, tiles: [105], label: "Battle Shrine" },
            { kind: "shrine", percent: 10, tiles: [176], label: "Battle Shrine" },
        ],
        // The volley's tiles double into the crimson channel like the server's union
        // (the client subtracts them back out for the violet read).
        nextRoundHazardTiles: STRIKE_TILES,
    },
    actors: [
        {
            id: "sq-0", side: "squad", name: "Rill", ownerSlug: "rill", ai: false,
            hp: 8200, maxHp: 10000, chakra: 220, maxChakra: 300, stamina: 180, maxStamina: 250,
            shield: 0, statuses: [{ name: "Increase Damage Given", rounds: 2, kind: "positive", percent: 30 }], pos: 123,
            cooldowns: { "raiton-spear": 1 },
            itemCharges: { "kunai": 3, "rejuvenation-potion": 2, "smoke-bomb": 1 },
            character: {
                specialty: "Ninjutsu", stats: {},
                jutsu: [
                    { id: "fireball", name: "Great Fireball", element: "Fire", type: "Ninjutsu", ap: 60, range: 2, effectPower: 60, chakraCost: 100, staminaCost: 30, method: "AOE_CIRCLE" },
                    { id: "raiton-spear", name: "Lightning Spear", element: "Lightning", type: "Ninjutsu", ap: 60, range: 3, effectPower: 70, chakraCost: 120, staminaCost: 40, cooldown: 2 },
                    { id: "venom-fang", name: "Venom Fang", element: "Earth", type: "Ninjutsu", ap: 60, range: 2, effectPower: 45, chakraCost: 80, staminaCost: 20, tags: [{ name: "Poison", percent: 12 }] },
                    { id: "inner-focus", name: "Inner Focus", type: "Ninjutsu", ap: 40, range: 0, target: "SELF", chakraCost: 40, tags: [{ name: "Heal" }, { name: "Decrease Damage Taken", percent: 25 }] },
                    { id: "poison-mire", name: "Poison Mire", element: "Earth", type: "Ninjutsu", ap: 60, range: 4, target: "EMPTY_GROUND", chakraCost: 60, tags: [{ name: "Poison", percent: 12 }] },
                ],
                pvpItems: [
                    { id: "katana", name: "Katana", slot: "hand", weaponEp: 35, weaponRange: 1, apCost: 40 },
                    { id: "kunai", name: "Kunai", slot: "thrown", weaponEp: 20, weaponRange: 4, apCost: 40 },
                    { id: "rejuvenation-potion", name: "Rejuv. Potion", slot: "potion", restoreChakra: 80, restoreStamina: 60, apCost: 35 },
                    { id: "smoke-bomb", name: "Smoke Bomb", slot: "item", weaponEffect: "Decrease Damage Taken", weaponEffectValue: 25, apCost: 35 },
                ],
                equipment: { hand: "katana", thrown: "kunai", potion: "rejuvenation-potion", item: "smoke-bomb" },
            },
        },
        // A squadmate HOLDING the near shrine (its ring reads cyan).
        { id: "sq-1", side: "squad", name: "Roku", ownerSlug: null, ai: true, hp: 1200, maxHp: 1500, chakra: 90, maxChakra: 120, stamina: 90, maxStamina: 120, shield: 0, statuses: [], pos: 105, character: { specialty: "Taijutsu", stats: {} } },
        // Formation: grunts in two ranks (cols 16-18), boss anchoring the back (col 19).
        enemy("en-0", "bandit", "Bandit", 118),
        enemy("en-1", "archer", "Archer", 117, 270, 270),
        enemy("en-2", "brute", "Brute", 116, 570, 570),
        enemy("en-3", "acolyte", "Acolyte", 198, 250, 250),
        enemy("en-4", "bandit", "Bandit", 197),
        // This one HOLDS the far shrine (its ring reads rose).
        enemy("en-5", "archer", "Archer", 176, 270, 270),
        {
            ...enemy("boss", "warden", "Spire Warden", 159, 2520, 2520),
            shield: 300, // the aegis it raised at the 60% gate
            character: {
                specialty: "Taijutsu", stats: {}, visual: "warden", boss: true,
                aiTargetMode: "squishiest", aegis: { shieldPct: 12 },
                bossStrike: { kind: "volley", pct: 8, radius: 1, everyRounds: 3 },
            },
        },
        { id: "npc-0", side: "npc", name: "Allied Genin", ownerSlug: null, ai: true, hp: 430, maxHp: 600, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, shield: 0, statuses: [{ name: "Poison", rounds: 2, kind: "negative", percent: 12 }], pos: 84, character: { specialty: "Taijutsu", stats: {}, visual: "genin" } },
    ],
    turnQueue: ["sq-0", "sq-1", "en-0", "en-1", "en-2", "en-3", "en-4", "en-5", "boss"],
    activeIndex: 0, round: 3, activeAp: 100, actionsThisTurn: 0,
    objectiveState: { kind: "defeat-all", completed: false, failed: false },
    phaseState: { bossId: "boss", pendingPhases: [30], triggeredPhases: [60] },
    status: "active", winner: null,
    groundEffects: [
        { id: "gz-demo", owner: "p1", name: "Poison Mire", rounds: 2, tiles: [140, 141, 142, 160, 161, 162], tags: [{ name: "Poison", percent: 12 }] },
    ],
    // The primed volley (violet tiles + the danger banner this round).
    bossStrike: { tiles: STRIKE_TILES, round: 3, pct: 8, kind: "volley", label: "Spire Warden's barrage" },
    log: [
        "The fight begins.",
        "A Spire Warden anchors the enemy formation.",
        "Rill lays Poison Mire across 7 tiles for 2 rounds.",
        "Spire Warden enters a new phase (60% HP).",
        "Spire Warden raises an aegis — a shield of 302 forms around it!",
        "Roku restores 120 HP at Healing Spring.",
        "⚠ Spire Warden's barrage charges — the marked ground erupts at round's end!",
    ],
};

createRoot(document.getElementById("root")!).render(
    <BattleTowerFight character={{ name: "Rill" } as never} runId="preview" initialSession={session} onExit={() => {}} />,
);
