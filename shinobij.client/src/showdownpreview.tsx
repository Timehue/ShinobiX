// ── DEV-ONLY Pet Showdown harness ────────────────────────────────────────────
// Drives PetShowdownBattle with a scripted MOCK turn generator so the cinematic
// playback layer (camera, lunges, projectiles, popups, HUD, needle, result)
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
    SHOWDOWN_HOLD_HEAVY,
    SHOWDOWN_PRIORITY_HEAVY,
    SHOWDOWN_PRIORITY_LIGHT,
    SHOWDOWN_PRIORITY_NORMAL,
    SHOWDOWN_ATTRITION_START,
} from "../../shared/pet-showdown-contract";
import type {
    ShowdownCommand,
    ShowdownEvent,
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

function mockKit(pet: Pet): ShowdownPetView["moves"] {
    const effectFor = (kind: string) => kind === "damage" ? "Straight damage"
        : kind === "barrier" ? "Absorbs incoming damage"
        : kind === "burn" ? "Burns for 2 more rounds · 82% hit"
        : `${kind} · reduced hit`;
    const moves: ShowdownPetView["moves"] = [
        { name: "Swift Strike", power: 34, kind: "damage", cost: SHOWDOWN_COST_BASIC, signature: false, priority: SHOWDOWN_PRIORITY_LIGHT, hold: 0, effect: "Straight damage" },
        ...(pet.jutsus ?? []).slice(0, 3).map((j) => ({
            name: j.name,
            power: j.power,
            kind: j.kind,
            cost: mockCost(j.power, j.kind),
            signature: false,
            priority: j.power <= 80 ? SHOWDOWN_PRIORITY_LIGHT : SHOWDOWN_PRIORITY_NORMAL,
            hold: 0,
            effect: effectFor(j.kind),
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
            cost: Math.min(SHOWDOWN_COST_MAX, Math.round(mockCost(power, moves[best].kind) * 1.3)),
            priority: SHOWDOWN_PRIORITY_HEAVY,
            hold: SHOWDOWN_HOLD_HEAVY,
        };
    }
    moves.push({
        name: `${pet.element ?? "Spirit"} Overdrive`,
        power: 96, kind: "damage", cost: 0, signature: true,
        priority: 0.75, hold: 2, effect: "Spends the full meter",
    });
    return moves;
}

function poolPet(index: number): Pet {
    return balanceBuiltInPetTemplate({ ...rawPetPool[index] }) as Pet;
}

const playerPets = [poolPet(0), poolPet(4), poolPet(16)];
const enemyPets = [poolPet(8), poolPet(12)];

function petView(pet: Pet, hp?: number): ShowdownPetView {
    const maxHp = Math.max(1, Math.round(pet.hp));
    return {
        id: pet.id,
        name: pet.name,
        element: pet.element ?? "None",
        role: pet.role ?? "tracker",
        rarity: pet.rarity,
        templateId: pet.id,
        level: 30,
        hp: hp ?? maxHp,
        maxHp,
        stamina: 105,
        maxStamina: 105,
        meter: 0,
        ko: (hp ?? maxHp) <= 0,
        guarding: false,
        benched: world.benched.has(pet.id),
        speed: pet.speed ?? 30,
        skipsNextAction: false,
        canSwitchOut: true,
        readiness: world.round,
        statuses: [],
        moves: mockKit(pet),
    };
}

// Mutable mock world the fake server advances each turn.
const world = {
    round: 0,
    hp: new Map<string, number>(),
    meter: new Map<string, number>(),
    // The third player pet starts on the bench (mirrors the 2v2+bench format).
    benched: new Set<string>([]),
};
world.benched.add(playerPets[2].id);
for (const pet of [...playerPets, ...enemyPets]) world.hp.set(pet.id, Math.round(pet.hp));
for (const pet of [...playerPets, ...enemyPets]) world.meter.set(pet.id, 0);

function stateView(finished = false, outcome: "win" | "loss" | null = null): ShowdownStateView {
    const view = (pet: Pet): ShowdownPetView => {
        const v = petView(pet, world.hp.get(pet.id));
        v.meter = world.meter.get(pet.id) ?? 0;
        v.stamina = Math.max(8, 105 - world.round * 22);
        return v;
    };
    return {
        sessionId: "devharness",
        format: "2v2",
        tier: "warrior",
        round: world.round,
        attritionAt: SHOWDOWN_ATTRITION_START,
        finished,
        outcome,
        player: playerPets.map(view),
        enemy: enemyPets.map(view),
        enemyTeamName: "Harness Pack",
        nextOrder: [...playerPets, ...enemyPets]
            .filter((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id))
            .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0))
            .map((p) => p.id),
    };
}

function hit(targetId: string, damage: number): boolean {
    const hp = Math.max(0, (world.hp.get(targetId) ?? 1) - damage);
    world.hp.set(targetId, hp);
    return hp <= 0;
}

async function mockSubmitTurn(commands: ShowdownCommand[]): Promise<ShowdownTurnResponse | null> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    world.round += 1;
    const events: ShowdownEvent[] = [{ t: "roundStart", round: world.round }];
    const livingEnemy = () => enemyPets.find((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id));
    const livingPlayer = () => playerPets.find((p) => (world.hp.get(p.id) ?? 0) > 0 && !world.benched.has(p.id));

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
        const target = livingEnemy();
        if (!actor || (world.hp.get(actor.id) ?? 0) <= 0) continue;
        if (c.kind === "guard" || c.kind === "rest") {
            events.push({
                t: "action", actorId: actor.id, actorSide: "player", moveName: c.kind === "guard" ? "Guard" : "Catch Breath",
                moveKind: c.kind, element: actor.element ?? "None", delivery: "self", super: false,
                targets: [{ id: actor.id, damage: 0, heal: c.kind === "rest" ? 32 : 0, effectiveness: "neutral", guarded: false, ko: false, applied: c.kind }],
                staminaAfter: 80, meterAfter: world.meter.get(actor.id) ?? 0, overexerted: false,
            });
            continue;
        }
        if (!target) break;
        const superCast = c.kind === "super";
        const damage = superCast ? 340 : 120 + world.round * 18;
        const ko = hit(target.id, damage);
        const meter = superCast ? 0 : Math.min(100, (world.meter.get(actor.id) ?? 0) + 34);
        world.meter.set(actor.id, meter);
        events.push({
            t: "action", actorId: actor.id, actorSide: "player",
            moveName: superCast ? `${actor.element} Overdrive` : "Swift Strike",
            moveKind: "damage", element: actor.element ?? "None",
            delivery: actor.role === "assassin" || actor.role === "defender" ? "melee" : "ranged",
            super: superCast,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: world.round % 3 === 0 ? "super" : "neutral", guarded: false, ko }],
            staminaAfter: Math.max(0, 100 - world.round * 25), meterAfter: meter,
            overexerted: world.round === 3,
        });
        if (ko && !livingEnemy()) {
            events.push({ t: "end", outcome: "win" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "win"), reward: 84, balances: { ryo: 1234 } };
        }
    }

    // Enemy replies.
    for (const enemy of enemyPets) {
        if ((world.hp.get(enemy.id) ?? 0) <= 0) continue;
        const target = livingPlayer();
        if (!target) break;
        const damage = 90 + world.round * 12;
        const ko = hit(target.id, damage);
        const meter = Math.min(100, (world.meter.get(target.id) ?? 0) + 22);
        world.meter.set(target.id, meter);
        events.push({
            t: "action", actorId: enemy.id, actorSide: "enemy", moveName: "Fang Rush",
            moveKind: "damage", element: enemy.element ?? "None", delivery: "melee", super: false,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: "neutral", guarded: false, ko }],
            staminaAfter: 60, meterAfter: 40, overexerted: false,
        });
        if (ko && !livingPlayer()) {
            events.push({ t: "end", outcome: "loss" }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "loss") };
        }
    }
    if (world.round === 2) {
        const victim = livingPlayer();
        if (victim) events.push({ t: "dot", targetId: victim.id, targetSide: "player", kind: "burn", damage: 24, ko: false });
    }
    events.push({ t: "roundEnd", round: world.round });
    if (world.round >= 14) {
        // Mirror the real engine's round-cap judge so the harness never plays R15+.
        const hpPct = (pets: Pet[]) => pets.reduce((sum, p) => sum + (world.hp.get(p.id) ?? 0) / Math.max(1, p.hp), 0);
        const outcome = hpPct(playerPets) > hpPct(enemyPets) ? "win" as const : "loss" as const;
        events.push({ t: "end", outcome });
        return { ok: true, events, state: stateView(true, outcome), ...(outcome === "win" ? { reward: 84, balances: { ryo: 1234 } } : {}) };
    }
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

createRoot(document.getElementById("root")!).render(<Harness />);

// The battle portals into document.body; an HMR re-eval would orphan the old
// portal and stack a second HUD. Full reload keeps the harness truthful.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
