// DEV-ONLY harness to eyeball the Battle Tower fight board without a server.
// Served at /towerfx.html by vite dev. Mocks an active session showcasing EVERY
// board system at once: squad + enemy formation with the boss in back, pylon /
// ward / hazard flowers, TERRAIN PILLARS (biome obstacle art), BOARD OBJECTS
// (healing font + squad-held & enemy-held shrines), a primed VOLLEY telegraph
// (violet tiles + banner), GEYSER VENTS (idle + primed pulse), and the boss-kit
// encounter chips (hunt/strike/aegis/geyser).
//
// TWO MODES
//   /towerfx.html         static board — one sealed snapshot, nothing advances.
//   /towerfx.html?live    SESSION HARNESS — a scripted in-page "server" answers
//                         real commands, so the board actually advances when you
//                         click Attack / a jutsu / Wait.
//
// The live mode drives the screen exclusively through BattleTowerFight's own
// injectable seams (`actionFn` + `stateFn`, which already default to the real
// HTTP calls). Nothing in the combat screen, engine, or adapter is modified or
// special-cased for the harness — it is the same code path a real run takes,
// with the network swapped out. That is what makes it usable as a verification
// fixture: anything you can see here, the real client would render too.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowerFight } from "./screens/BattleTowerFight";
import type {
    TowerSession,
    TowerActor,
    TowerActionInput,
    TowerActionResponse,
} from "./lib/towers-api";

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
        // Dynamic hazards: three geyser vents (tile 85 is PRIMED — it joins the crimson
        // telegraph below to show the about-to-erupt pulse; the other two idle-pulse).
        dynamicHazards: [{ kind: "geyser", tiles: [85, 149, 193], pct: 4, everyRounds: 3 }],
        // The volley's tiles double into the crimson channel like the server's union
        // (the client subtracts them back out for the violet read). The primed vent (85)
        // rides the same channel so its eruption telegraphs a round ahead.
        nextRoundHazardTiles: [...STRIKE_TILES, 85],
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

// ── Session harness ("?live") ────────────────────────────────────────────────
// A deterministic stand-in for api/towers: it owns the session, applies a
// coarse effect per command, and bumps `actionVersion` so the screen's own
// adoption guard (`next.actionVersion >= current.actionVersion`) accepts it.
// Deliberately NOT a combat simulator — it exists to make the real screen
// advance through real state transitions, not to reproduce server damage.
const live = new URLSearchParams(window.location.search).has("live");

// The static board is an ART showcase: it parks the squad at tile 123 and the
// enemy ranks at 116-118, which reads well but leaves every offensive command
// out of range. Live mode starts the player adjacent to the front grunt (138 is
// a neighbour of 118) so Attack / weapons / short-range jutsu are actually
// exercisable. Only the live session is moved; the showcase is untouched.
const LIVE_PLAYER_TILE = 138;
const liveSession: TowerSession = {
    ...session,
    actionVersion: 0,
    actors: session.actors.map((actor) => (actor.id === "sq-0" ? { ...actor, pos: LIVE_PLAYER_TILE } : actor)),
};

let current: TowerSession = live ? liveSession : session;
let version = 0;

/** Rotate to the next actor so turn-dependent UI (active ring, command
 *  enablement, the round counter) actually moves between commands.
 *
 * Every AI in between is resolved in the same step, which is what the real
 * endpoint does: a command returns a session where it is your turn again. Without
 * this the harness hands control to an AI actor and the command bar correctly
 * disables itself, leaving the board un-driveable after exactly one click. */
function advanceTurn(from: TowerSession): TowerSession {
    const queue = from.turnQueue;
    const isLocal = (id: string) => from.actors.some((a) => a.id === id && !a.ai);
    let index = from.activeIndex;
    let round = from.round;
    const skipped: string[] = [];
    for (let step = 0; step < queue.length; step++) {
        index = (index + 1) % queue.length;
        if (index === 0) round += 1;
        if (isLocal(queue[index])) break;
        skipped.push(queue[index]);
    }
    const barks = skipped.map((id) => {
        const actor = from.actors.find((a) => a.id === id);
        return `${actor?.name ?? id} takes its turn.`;
    });
    return {
        ...from,
        activeIndex: index,
        round,
        activeAp: 100,
        actionsThisTurn: 0,
        log: [...from.log, ...barks].slice(-40),
    };
}

function describe(action: TowerActionInput): string {
    switch (action.type) {
        case "jutsu": return `Rill casts ${action.jutsuId}.`;
        case "attack": return `Rill strikes ${action.targetId}.`;
        case "weapon": return `Rill swings ${action.itemId ?? "a weapon"}.`;
        case "item": return `Rill uses ${action.itemId ?? "an item"}.`;
        case "move": case "dash": return `Rill moves to tile ${action.tile}.`;
        default: return `Rill performs ${action.type}.`;
    }
}

/** Apply a visible consequence so it is obvious the board advanced. Offensive
 *  commands chip the nearest enemy; movement relocates the player. */
function applyAction(from: TowerSession, action: TowerActionInput): TowerSession {
    const actors = from.actors.map((actor) => ({ ...actor }));
    if (action.type === "move" || action.type === "dash") {
        const me = actors.find((a) => a.id === "sq-0");
        if (me) me.pos = action.tile;
    }
    const targetId = "targetId" in action ? action.targetId : undefined;
    const victim = actors.find((a) => a.id === targetId) ?? actors.find((a) => a.side === "enemy");
    if (victim && (action.type === "attack" || action.type === "jutsu" || action.type === "weapon")) {
        victim.hp = Math.max(0, victim.hp - 140);
    }
    return advanceTurn({ ...from, actors, log: [...from.log, describe(action)].slice(-40) });
}

/** Mirror the engine's plate authoring (api/towers/_engine.ts towerActionVfx)
 *  closely enough to exercise the client renderer: an actor-anchored burst for
 *  offensive commands, a tile-anchored one for movement. */
function harnessVfx(action: TowerActionInput, victimId?: string): TowerSession["vfx"] {
    if (action.type === "move" || action.type === "dash") {
        return [{ key: "move", anchor: "tile", tiles: [action.tile] }];
    }
    if (action.type === "attack" || action.type === "weapon") {
        return victimId ? [{ key: "impact", target: victimId, anchor: "target" }] : [];
    }
    if (action.type === "jutsu") {
        // Stand in for an elemental AOE so the tile-spread path renders too.
        return victimId ? [{ key: "fire60", target: victimId, anchor: "area", tiles: [118, 119, 138] }] : [];
    }
    return [];
}

const harnessActionFn = async (
    _runId: string,
    _playerName: string,
    action: TowerActionInput,
): Promise<TowerActionResponse> => {
    version += 1;
    const victimId = "targetId" in action && action.targetId
        ? action.targetId
        : current.actors.find((a) => a.side === "enemy")?.id;
    current = {
        ...applyAction(current, action),
        actionVersion: version,
        vfx: harnessVfx(action, victimId),
        vfxSeq: version,
    };
    return { applied: true, session: current, currentVersion: version, actionVersion: version };
};

/** Polls and the on-mount reconcile both read back the same authored session,
 *  so a refresh never rolls the board backwards mid-inspection. */
const harnessStateFn = async (): Promise<TowerSession> => current;

createRoot(document.getElementById("root")!).render(
    live
        ? <BattleTowerFight
            character={{ name: "Rill" } as never}
            runId="preview"
            initialSession={liveSession}
            onExit={() => {}}
            actionFn={harnessActionFn}
            stateFn={harnessStateFn}
        />
        : <BattleTowerFight character={{ name: "Rill" } as never} runId="preview" initialSession={session} onExit={() => {}} />,
);
