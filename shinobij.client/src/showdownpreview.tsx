// ── DEV-ONLY Pet Showdown harness ────────────────────────────────────────────
// Drives PetShowdownBattle with a scripted MOCK turn generator so the cinematic
// playback layer (camera, lunges, projectiles, popups, HUD, attrition, result)
// can be iterated without a backend or login. NOT part of the shipped app —
// reachable only at /showdownpreview.html in `vite dev`, and not listed in the
// production build inputs. The mock mimics the /api/pet/showdown turn contract;
// the real numbers always come from the server engine.
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/layout/adaptive-stages.css";
import "./screens/PetShowdown.css";
import { PetShowdownBattle } from "./components/PetShowdownBattle";
import { rawPetPool } from "./data/pet-pool";
import { balanceBuiltInPetTemplate } from "./lib/pet-balance";
import type { Pet } from "./types/pet";
import {
    SHOWDOWN_COST_BASIC,
    SHOWDOWN_COST_MAX,
    SHOWDOWN_COST_MIN,
    SHOWDOWN_COST_PER_POWER,
    SHOWDOWN_COST_CONTROL_FLOOR,
    SHOWDOWN_COST_SUSTAIN_FLOOR,
    SHOWDOWN_HEAVY_PROMOTE_MULT,
    SHOWDOWN_HEAVY_COST_PREMIUM,
    SHOWDOWN_HOLD_HEAVY,
    SHOWDOWN_HOLD_SUPER,
    SHOWDOWN_PRIORITY_HEAVY,
    SHOWDOWN_PRIORITY_LIGHT,
    SHOWDOWN_PRIORITY_NORMAL,
    SHOWDOWN_PRIORITY_SUPER,
    SHOWDOWN_ATTRITION_START,
    SHOWDOWN_GUARD_COST,
    SHOWDOWN_REST_PCT,
    SHOWDOWN_REST_FLAT,
    SHOWDOWN_STAMINA_REFERENCE,
    SHOWDOWN_STAMINA_POOL_SCALE,
    SHOWDOWN_STAMINA_REGEN_PCT,
    SHOWDOWN_STAMINA_REGEN_FLAT,
    SHOWDOWN_OVERDRAFT_HP_PER_POINT,
    SHOWDOWN_METER_MAX,
    SHOWDOWN_METER_ON_HIT_DEALT,
    SHOWDOWN_METER_ON_HIT_TAKEN,
    SHOWDOWN_SUPER_POWER_MULT,
    SHOWDOWN_FORMAT_SIZE,
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_TURN_CAP,
    showdownAttritionPct,
} from "../../shared/pet-showdown-contract";
import type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownFormat,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTurnResponse,
} from "./lib/pet-showdown-api";

/* Cost/pace/hold are DERIVED from the shared contract, never hardcoded. The
   harness previously carried a copy of the retired three-band table (18/32/52),
   so the one tool for iterating the HUD without a backend could not show the
   thing most recently built — no haymaker row, no charging state, no real EN
   ladder. Deriving keeps it honest: the numbers can only drift if the FORMULA
   changes, and the formula lives here in one place. */
function mockCost(power: number, kind: string): number {
    const base = Math.max(SHOWDOWN_COST_MIN, Math.min(SHOWDOWN_COST_MAX, Math.round(power * SHOWDOWN_COST_PER_POWER)));
    if (kind === "stun" || kind === "freeze" || kind === "confuse") return Math.max(base, SHOWDOWN_COST_CONTROL_FLOOR);
    if (kind === "heal") return Math.max(base, SHOWDOWN_COST_SUSTAIN_FLOOR);
    return base;
}

/* The engine sizes each pool off bulk; the harness has no bulk curve, so it
   takes the reference pet — one number, still off the contract, so the EN bar
   drains at the rate the real ladder is priced against. */
const MOCK_MAX_STAMINA = Math.round(SHOWDOWN_STAMINA_REFERENCE * SHOWDOWN_STAMINA_POOL_SCALE);

const PREVIEW_PARAMS = new URLSearchParams(window.location.search);
// ?facingqa renders the exact live regression pair from the owner report on the
// real PetShowdownBattle path: Raijin Hound (player) vs Crystal Bear (enemy).
const FACING_QA = PREVIEW_PARAMS.has("facingqa");
const FORMAT: ShowdownFormat = FACING_QA ? "1v1" : "2v2";
const FIELD_SIZE = SHOWDOWN_FORMAT_SIZE[FORMAT];

/** The engine derives an action's presentation weight server-side; mirror it
 *  off the same priority ladder so the VFX tier under test is the one the wire
 *  actually carries. */
function mockWeight(move: ShowdownPetView["moves"][number], superCast: boolean): "light" | "normal" | "heavy" {
    // ?heavy — VFX iteration switch: every damaging cast reports HEAVY so the
    // elemental set-piece tier (tsunami / tornado / fire wash) fires on every
    // strike instead of only when a real haymaker lands. Presentation-only,
    // dev-only, and exactly what this harness exists for.
    if (new URLSearchParams(window.location.search).has("heavy") && move.power > 0) return "heavy";
    if (superCast || move.priority <= SHOWDOWN_PRIORITY_HEAVY) return "heavy";
    return move.priority >= SHOWDOWN_PRIORITY_LIGHT ? "light" : "normal";
}

/** Damage is the one number the harness has to invent — the engine's formula is
 *  server-only. Only the SHAPE is real: a share of the target's bar that tracks
 *  move power, so a fight lasts the handful of rounds a real one does and the
 *  attrition tail is reachable instead of theoretical. */
function mockDamage(target: Pet, power: number, superCast: boolean): number {
    const share = (0.06 + power / 1400) * (superCast ? SHOWDOWN_SUPER_POWER_MULT : 1);
    return Math.max(1, Math.round(Math.max(1, target.hp) * share));
}

function mockKit(pet: Pet): ShowdownPetView["moves"] {
    const effectFor = (kind: string) => kind === "damage" ? "Straight damage"
        : kind === "barrier" ? "Absorbs incoming damage"
        : kind === "burn" ? "Burns for 2 more rounds · 82% hit"
        : `${kind} · reduced hit`;
    const moves: ShowdownPetView["moves"] = [
        // Sealed neutral/physical exactly like the engine's basicStrike — no
        // STAB, wheel-neutral both ways.
        { name: "Swift Strike", power: 34, kind: "damage", cost: SHOWDOWN_COST_BASIC, signature: false, priority: SHOWDOWN_PRIORITY_LIGHT, hold: 0, effect: "Straight damage", element: "None", cls: "physical" as const },
        // Mirror the engine's kit rule (engine.ts sealShowdownPet): mobility
        // jutsus are stripped BEFORE the slice — there is no board to dash
        // across in this mode, so a `kind: "move"` entry must never reach the
        // list. Without this the harness offered "Red Fox Dash", a technique
        // the real engine refuses to seal.
        ...(pet.jutsus ?? []).filter((j) => j.kind !== "move").slice(0, 3).map((j) => ({
            name: j.name,
            power: j.power,
            kind: j.kind,
            cost: mockCost(j.power, j.kind),
            signature: false,
            priority: j.power <= 80 ? SHOWDOWN_PRIORITY_LIGHT : SHOWDOWN_PRIORITY_NORMAL,
            hold: 0,
            effect: effectFor(j.kind),
            // Mirror the seal: kit techniques carry the pet's element; the
            // class comes from the kind (contact physical, casts special).
            element: pet.element ?? "None",
            cls: (["crush", "wound", "push", "pull", "lifesteal"].includes(j.kind) ? "physical"
                : ["damage", "burn", "dot", "freeze"].includes(j.kind) ? "special" : "status") as ShowdownPetView["moves"][number]["cls"],
            ...(pet.element && SHOWDOWN_ELEMENT_BEATS[pet.element] ? { synergyElement: SHOWDOWN_ELEMENT_BEATS[pet.element] } : {}),
        })),
    ];
    // Mirror promoteHeavy: the kit's biggest damage move becomes the haymaker.
    let best = -1;
    for (let i = 1; i < moves.length; i++) {
        if (moves[i].kind !== "damage" || moves[i].power <= 0) continue;
        if (best < 0 || moves[i].power > moves[best].power) best = i;
    }
    if (best > 0) {
        const power = Math.round(moves[best].power * SHOWDOWN_HEAVY_PROMOTE_MULT);
        moves[best] = {
            ...moves[best],
            power,
            cost: Math.min(SHOWDOWN_COST_MAX, Math.round(mockCost(power, moves[best].kind) * SHOWDOWN_HEAVY_COST_PREMIUM)),
            priority: SHOWDOWN_PRIORITY_HEAVY,
            hold: SHOWDOWN_HOLD_HEAVY,
        };
    }
    moves.push({
        name: `${pet.element ?? "Spirit"} Overdrive`,
        power: 96, kind: "damage", cost: 0, signature: true,
        priority: SHOWDOWN_PRIORITY_SUPER, hold: SHOWDOWN_HOLD_SUPER, effect: "Spends the full meter",
        element: pet.element ?? "None", cls: "special" as const,
        ...(pet.element && SHOWDOWN_ELEMENT_BEATS[pet.element] ? { synergyElement: SHOWDOWN_ELEMENT_BEATS[pet.element] } : {}),
    });
    // Mirror the seal's VARIETY PASS: every pet fields one derived utility
    // keyed to its role (engine.ts derivedUtilityFor). Without this the bench
    // deck would show a kit the real engine never builds.
    const role = String(pet.role ?? "tracker");
    const el = pet.element ?? "None";
    const high = pet.rarity === "legendary" || pet.rarity === "mythic";
    const utilKind = role === "defender" ? "protect"
        : role === "sage" ? "weather"
        : role === "assassin" ? (high ? "mark" : "buff")
        : (high ? "slow" : "debuff");
    const utilName = utilKind === "weather"
        ? (({ Fire: "Heat Haze", Water: "Downpour", Wind: "Gale Front", Earth: "Duststorm", Lightning: "Thunderhead" } as Record<string, string>)[el] ?? "Front")
        : ({ protect: "Bulwark", buff: "Kindle", mark: "Mark", slow: "Mire", debuff: "Glare" }[utilKind] ?? "Focus");
    if (el !== "None") {
        moves.splice(3, 0, {
            name: utilName, power: utilKind === "protect" ? 90 : utilKind === "weather" ? 70 : 110,
            kind: utilKind, cost: 34, signature: false,
            priority: utilKind === "protect" ? SHOWDOWN_PRIORITY_LIGHT : SHOWDOWN_PRIORITY_NORMAL,
            hold: 0, effect: utilKind === "weather" ? "Turns the arena to your element" : "Utility",
            element: el, cls: "special" as const,
        });
    }
    return moves;
}

function poolPet(index: number): Pet {
    return balanceBuiltInPetTemplate({ ...rawPetPool[index] }) as Pet;
}

// ?lineup=0,4,16,8,12 — review switch: pick the pool indices for
// player0,player1,bench,enemy0,enemy1 so any ROLE (and therefore any derived
// utility — protect/weather/mark/slow) is reachable from the bench. Defaults
// to the original fixed cast.
const LINEUP = (() => {
    const raw = new URLSearchParams(window.location.search).get("lineup");
    const picked = (raw ?? "").split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n < rawPetPool.length);
    return picked.length === 5 ? picked : [0, 4, 16, 8, 12];
})();
const crystalBear = rawPetPool.find((pet) => pet.id === "legendary-9");
if (FACING_QA && !crystalBear) throw new Error("facing QA requires legendary-9 Crystal Bear");
const playerPets = FACING_QA
    ? [{
        ...poolPet(LINEUP[0]),
        id: "starter-lightning",
        name: "Raijin Hound",
        element: "Lightning" as const,
        evolutionStage: 2 as const,
        rarity: "legendary" as const,
    }]
    : [poolPet(LINEUP[0]), poolPet(LINEUP[1]), poolPet(LINEUP[2])];
const enemyPets = FACING_QA
    ? [balanceBuiltInPetTemplate({ ...crystalBear! }) as Pet]
    : [poolPet(LINEUP[3]), poolPet(LINEUP[4])];

// ?elements=Wind,Earth,None,Lightning,Fire — review switch: remap the lineup's
// elements in order (player0, player1, player2-bench, enemy0, enemy1) so every
// element's volumetric set-piece and Overdrive is reachable from one harness
// session instead of whatever the fixed pool indices happen to carry.
{
    const elementsParam = new URLSearchParams(window.location.search).get("elements");
    if (elementsParam) {
        const list = elementsParam.split(",").map((s) => s.trim()).filter(Boolean);
        [...playerPets, ...enemyPets].forEach((pet, i) => {
            if (list[i]) pet.element = list[i] as Pet["element"];
        });
    }
}

function petView(pet: Pet): ShowdownPetView {
    const maxHp = Math.max(1, Math.round(pet.hp));
    const hp = world.hp.get(pet.id) ?? maxHp;
    return {
        id: pet.id,
        name: pet.name,
        element: pet.element ?? "None",
        role: pet.role ?? "tracker",
        rarity: pet.rarity,
        templateId: pet.id,
        level: 30,
        hp,
        maxHp,
        stamina: world.stamina.get(pet.id) ?? MOCK_MAX_STAMINA,
        maxStamina: MOCK_MAX_STAMINA,
        meter: world.meter.get(pet.id) ?? 0,
        ko: hp <= 0,
        guarding: false,
        benched: world.benched.has(pet.id),
        speed: pet.speed ?? 30,
        // A winded pet loses its next action and may not rotate out — the pair
        // of flags the command deck filters on, so the harness can reach the
        // "nobody can act" round the deck has to resolve on its own.
        skipsNextAction: world.winded.has(pet.id),
        canSwitchOut: !world.winded.has(pet.id),
        // ?meter also satisfies HOLDS: the flag means "the signature is
        // castable NOW", and the hold would otherwise gate it two rounds.
        readiness: new URLSearchParams(window.location.search).has("meter") ? 99 : world.round,
        statuses: [],
        moves: mockKit(pet),
    };
}

// Mutable mock world the fake server advances each turn.
const world = {
    round: 0,
    hp: new Map<string, number>(),
    meter: new Map<string, number>(),
    stamina: new Map<string, number>(),
    winded: new Set<string>(),
    // The third player pet starts on the bench (mirrors the 2v2+bench format).
    benched: new Set<string>([]),
    // Standing arena weather, mirroring the engine's session.weather.
    weather: null as { element: string; until: number } | null,
};
if (playerPets[2]) world.benched.add(playerPets[2].id);
// ?glass — review switch: enemies open at 30% health so one signature is
// lethal and the KO ceremony (impact frame, crowd eruption, scar, extended
// fall beat) is reachable in a single order instead of a five-round grind.
const GLASS_ENEMIES = new URLSearchParams(window.location.search).has("glass");
for (const pet of [...playerPets, ...enemyPets]) {
    world.hp.set(pet.id, Math.round(pet.hp * (GLASS_ENEMIES && enemyPets.some((e) => e.id === pet.id) ? 0.3 : 1)));
    // ?meter — review switch: every pet opens with a FULL signature meter, so
    // the super cinematics are castable from round one instead of after five
    // rounds of charging. Dev-only, presentation-iteration tooling.
    world.meter.set(pet.id, new URLSearchParams(window.location.search).has("meter") ? 100 : 0);
    world.stamina.set(pet.id, MOCK_MAX_STAMINA);
}

function stateView(finished = false, outcome: "win" | "loss" | null = null): ShowdownStateView {
    return {
        sessionId: "devharness",
        format: FORMAT,
        tier: "warrior",
        turnCap: SHOWDOWN_TURN_CAP,
        round: world.round,
        attritionAt: SHOWDOWN_ATTRITION_START,
        finished,
        outcome,
        player: playerPets.map((p) => petView(p)),
        enemy: enemyPets.map((p) => petView(p)),
        enemyTeamName: "Harness Pack",
        ...(world.weather && world.round <= world.weather.until
            ? { weather: { element: world.weather.element, roundsLeft: Math.max(0, world.weather.until - world.round + 1) } }
            : {}),
    };
}

function hit(targetId: string, damage: number): boolean {
    const hp = Math.max(0, (world.hp.get(targetId) ?? 1) - damage);
    world.hp.set(targetId, hp);
    return hp <= 0;
}

/** A side is beaten only when its BENCH is gone too — a fallen field slot is
 *  refilled at round end, not a defeat. */
function teamAlive(team: Pet[]): boolean {
    return team.some((p) => (world.hp.get(p.id) ?? 0) > 0);
}

/** Stamina moves by the contract's own numbers, so the EN bar in the HUD
 *  empties, refills and gates the deck the way it does against the engine. */
function spendStamina(petId: string, cost: number): number {
    const left = Math.max(0, (world.stamina.get(petId) ?? MOCK_MAX_STAMINA) - cost);
    world.stamina.set(petId, left);
    return left;
}

function restStamina(petId: string): number {
    const gained = Math.round(MOCK_MAX_STAMINA * SHOWDOWN_REST_PCT) + SHOWDOWN_REST_FLAT;
    const left = Math.min(MOCK_MAX_STAMINA, (world.stamina.get(petId) ?? 0) + gained);
    world.stamina.set(petId, left);
    return left;
}

async function mockSubmitTurn(commands: ShowdownCommand[]): Promise<ShowdownTurnResponse | null> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    world.round += 1;
    const events: ShowdownEvent[] = [{ t: "roundStart", round: world.round }];
    const livingEnemy = () => enemyPets.find((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id));
    const livingPlayer = () => playerPets.find((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id));

    // The overdraft's stolen turn is paid at the top of the round, before
    // anything else can be spent on it.
    for (const pet of [...playerPets, ...enemyPets]) {
        if (!world.winded.has(pet.id)) continue;
        world.winded.delete(pet.id);
        if ((world.hp.get(pet.id) ?? 0) <= 0 || world.benched.has(pet.id)) continue;
        events.push({
            t: "skip", actorId: pet.id, reason: "winded",
            actorSide: playerPets.some((p) => p.id === pet.id) ? "player" : "enemy",
        });
    }

    // Switches resolve first, like the real engine.
    for (const c of commands) {
        if (c.kind !== "switch") continue;
        world.benched.add(c.petId);
        world.benched.delete(c.benchPetId);
        events.push({ t: "switch", side: "player", outId: c.petId, inId: c.benchPetId, reinforcement: false });
    }

    // Player commands play out roughly as issued.
    for (const c of commands) {
        if (c.kind === "switch") continue;
        const actor = playerPets.find((p) => p.id === c.petId);
        // Honor the PICKED target like the real engine's resolveTarget does
        // (requested id if alive, first living foe as the fallback). The mock
        // used to always hit the first living enemy, which made the bench lie
        // about targeting: every attack landed on the same pet regardless of
        // what the player selected.
        const requested = c.kind === "move" || c.kind === "super" ? c.targetId : "";
        const target = enemyPets.find((p) => p.id === requested && (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id)) ?? livingEnemy();
        if (!actor || (world.hp.get(actor.id) ?? 0) <= 0) continue;
        if (c.kind === "guard" || c.kind === "rest") {
            // Rest buys stamina back and heals NOTHING — what you give the turn
            // up for is the pool, never the bar above it.
            const staminaAfter = c.kind === "guard" ? spendStamina(actor.id, SHOWDOWN_GUARD_COST) : restStamina(actor.id);
            events.push({
                t: "action", actorId: actor.id, actorSide: "player", moveName: c.kind === "guard" ? "Guard" : "Catch Breath",
                moveKind: c.kind, element: actor.element ?? "None", delivery: "self", weight: "light", super: false,
                targets: [{ id: actor.id, damage: 0, heal: 0, effectiveness: "neutral", guarded: false, ko: false, applied: c.kind }],
                staminaAfter, meterAfter: world.meter.get(actor.id) ?? 0, overexerted: false,
            });
            continue;
        }
        const kitPeek = mockKit(actor);
        const peeked = c.kind === "super" ? kitPeek[kitPeek.length - 1] : kitPeek[c.moveIndex] ?? kitPeek[0];
        if (peeked?.kind === "weather") {
            // Mirror the engine: the arena takes the caster's element for a
            // fixed window, overwriting whatever stood before.
            world.weather = { element: actor.element ?? "None", until: world.round + 3 };
            const staminaAfterW = spendStamina(actor.id, peeked.cost);
            events.push({
                t: "action", actorId: actor.id, actorSide: "player", moveName: peeked.name,
                moveKind: "weather", element: actor.element ?? "None", delivery: "self", weight: "light", super: false,
                targets: [{ id: actor.id, damage: 0, heal: 0, effectiveness: "neutral", guarded: false, ko: false, applied: "weather" }],
                staminaAfter: staminaAfterW, meterAfter: world.meter.get(actor.id) ?? 0, overexerted: false,
            });
            continue;
        }
        if (!target) break;
        const kit = mockKit(actor);
        const superCast = c.kind === "super";
        const move = superCast ? kit[kit.length - 1] : kit[c.moveIndex] ?? kit[0];
        // Overdraft: the move fires whatever the pool says, and the shortfall is
        // paid in HP now and in next round's action.
        const pool = world.stamina.get(actor.id) ?? MOCK_MAX_STAMINA;
        const cost = superCast ? 0 : move.cost;
        const overexerted = cost > pool;
        const staminaAfter = spendStamina(actor.id, cost);
        const overexertDamage = overexerted ? (cost - pool) * SHOWDOWN_OVERDRAFT_HP_PER_POINT : 0;
        if (overexertDamage > 0) hit(actor.id, overexertDamage);
        if (overexerted) world.winded.add(actor.id);
        const damage = mockDamage(target, move.power, superCast);
        const ko = hit(target.id, damage);
        const meter = superCast ? 0 : Math.min(SHOWDOWN_METER_MAX, (world.meter.get(actor.id) ?? 0) + SHOWDOWN_METER_ON_HIT_DEALT);
        world.meter.set(actor.id, meter);
        events.push({
            t: "action", actorId: actor.id, actorSide: "player",
            moveName: move.name,
            // Mirror the engine: the MOVE decides the staging — contact
            // kinds and the neutral jab charge in, elemental casts throw.
            moveKind: move.kind, element: move.element,
            delivery: move.cls === "physical" || move.element === "None" ? "melee" : "ranged",
            weight: mockWeight(move, superCast), super: superCast,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: world.round % 3 === 0 ? "super" : "neutral", guarded: false, ko }],
            staminaAfter, meterAfter: meter,
            overexerted, ...(overexertDamage > 0 ? { overexertDamage } : {}),
        });
        if (ko && !teamAlive(enemyPets)) {
            events.push({ t: "end", outcome: "win" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "win"), practice: true };
        }
    }

    // Enemy replies.
    for (const enemy of enemyPets) {
        if ((world.hp.get(enemy.id) ?? 0) <= 0 || world.benched.has(enemy.id)) continue;
        const target = livingPlayer();
        if (!target) break;
        const damage = mockDamage(target, 60, false);
        const ko = hit(target.id, damage);
        const meter = Math.min(SHOWDOWN_METER_MAX, (world.meter.get(target.id) ?? 0) + SHOWDOWN_METER_ON_HIT_TAKEN);
        world.meter.set(target.id, meter);
        events.push({
            t: "action", actorId: enemy.id, actorSide: "enemy", moveName: "Fang Rush",
            moveKind: "damage", element: enemy.element ?? "None", delivery: "melee", weight: "normal", super: false,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: "neutral", guarded: false, ko }],
            staminaAfter: spendStamina(enemy.id, SHOWDOWN_COST_BASIC), meterAfter: world.meter.get(enemy.id) ?? 0,
            overexerted: false,
        });
        if (ko && !teamAlive(playerPets)) {
            events.push({ t: "end", outcome: "loss" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "loss") };
        }
    }
    if (world.round === 2) {
        const victim = livingPlayer();
        if (victim) events.push({ t: "dot", targetId: victim.id, targetSide: "player", kind: "burn", damage: 24, ko: false });
    }

    // End-of-round upkeep: stamina turns over for everyone, bench included.
    for (const pet of [...playerPets, ...enemyPets]) {
        if ((world.hp.get(pet.id) ?? 0) <= 0) continue;
        const regen = Math.round(MOCK_MAX_STAMINA * SHOWDOWN_STAMINA_REGEN_PCT) + SHOWDOWN_STAMINA_REGEN_FLAT;
        world.stamina.set(pet.id, Math.min(MOCK_MAX_STAMINA, (world.stamina.get(pet.id) ?? 0) + regen));
    }

    // Reinforcements: the bench fills an empty field slot at round end.
    for (const [side, team] of [["player", playerPets], ["enemy", enemyPets]] as const) {
        let fielded = team.filter((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id)).length;
        for (const pet of team) {
            if (fielded >= FIELD_SIZE) break;
            if ((world.hp.get(pet.id) ?? 0) <= 0 || !world.benched.has(pet.id)) continue;
            world.benched.delete(pet.id);
            fielded += 1;
            const fallen = team.find((p) => (world.hp.get(p.id) ?? 0) <= 0 && !world.benched.has(p.id));
            events.push({ t: "switch", side, outId: fallen?.id ?? pet.id, inId: pet.id, reinforcement: true });
        }
    }

    // There is no round limit and no judge — a fight ends when a team falls.
    // What stops it running forever is attrition: from SHOWDOWN_ATTRITION_START
    // every living pet bleeds a ramping share of its own bar, both sides alike.
    const bleedPct = showdownAttritionPct(world.round);
    if (bleedPct > 0) {
        for (const pet of [...playerPets, ...enemyPets]) {
            if ((world.hp.get(pet.id) ?? 0) <= 0 || world.benched.has(pet.id)) continue;
            const damage = Math.max(1, Math.round(Math.max(1, pet.hp) * bleedPct));
            const ko = hit(pet.id, damage);
            events.push({
                t: "dot", targetId: pet.id, kind: "attrition", damage, ko,
                targetSide: playerPets.some((p) => p.id === pet.id) ? "player" : "enemy",
            });
        }
        if (!teamAlive(enemyPets)) {
            events.push({ t: "end", outcome: "win" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "win"), practice: true };
        }
        if (!teamAlive(playerPets)) {
            events.push({ t: "end", outcome: "loss" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "loss") };
        }
    }
    events.push({ t: "roundEnd", round: world.round });
    return { ok: true, events, state: stateView() };
}

function Harness() {
    return (
        <PetShowdownBattle
            initialState={stateView()}
            playerPets={playerPets}
            sharedImages={{}}
            submitTurn={mockSubmitTurn}
            onForfeit={() => window.location.reload()}
            onFinished={(outcome, settlement) => console.log("[harness] finished", outcome, settlement)}
            onExit={() => window.location.reload()}
            onRematch={() => window.location.reload()}
        />
    );
}

/* Warm both sides before the first frame, exactly as every shipping entry
 * does. The harness fields REAL pets with real templateIds, so it resolves real
 * GLBs — and an unwarmed model suspends against a null fallback. Skipping this
 * would leave the tool used to review the battle's visuals showing an empty
 * arena for its opening seconds. */
void import("./lib/pet-model-preload")
    .then((m) => m.warmShowdownModels(stateView(), playerPets))
    .catch(() => undefined)
    .finally(() => createRoot(document.getElementById("root")!).render(<Harness />));

// The battle portals into document.body; an HMR re-eval would orphan the old
// portal and stack a second HUD. Full reload keeps the harness truthful.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
