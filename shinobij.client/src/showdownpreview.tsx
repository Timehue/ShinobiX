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
import type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTurnResponse,
} from "./lib/pet-showdown-api";

function poolPet(index: number): Pet {
    return balanceBuiltInPetTemplate({ ...rawPetPool[index] }) as Pet;
}

const playerPets = [poolPet(0), poolPet(4)];
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
        stamina: 100,
        meter: 0,
        ko: (hp ?? maxHp) <= 0,
        guarding: false,
        winded: false,
        statuses: [],
        moves: [
            { name: "Swift Strike", power: 55, kind: "damage", cost: 20, cooldown: 0, currentCooldown: 0, signature: false },
            ...(pet.jutsus ?? []).slice(0, 3).map((j) => ({
                name: j.name, power: j.power, kind: j.kind, cost: j.power <= 120 ? 30 : j.power <= 220 ? 45 : 60,
                cooldown: j.cooldown, currentCooldown: 0, signature: false,
            })),
            { name: `${pet.element ?? "Spirit"} Overdrive`, power: 260, kind: "damage", cost: 0, cooldown: 0, currentCooldown: 0, signature: true },
        ],
    };
}

// Mutable mock world the fake server advances each turn.
const world = {
    round: 0,
    hp: new Map<string, number>(),
    meter: new Map<string, number>(),
};
for (const pet of [...playerPets, ...enemyPets]) world.hp.set(pet.id, Math.round(pet.hp));
for (const pet of [...playerPets, ...enemyPets]) world.meter.set(pet.id, 0);

function stateView(finished = false, outcome: "win" | "loss" | null = null): ShowdownStateView {
    const view = (pet: Pet): ShowdownPetView => {
        const v = petView(pet, world.hp.get(pet.id));
        v.meter = world.meter.get(pet.id) ?? 0;
        v.stamina = Math.max(10, 100 - world.round * 15);
        return v;
    };
    return {
        sessionId: "devharness",
        format: "2v2",
        tier: "warrior",
        round: world.round,
        maxRounds: 14,
        finished,
        outcome,
        player: playerPets.map(view),
        enemy: enemyPets.map(view),
        enemyTeamName: "Harness Pack",
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
    const livingEnemy = () => enemyPets.find((p) => (world.hp.get(p.id) ?? 0) > 0);
    const livingPlayer = () => playerPets.find((p) => (world.hp.get(p.id) ?? 0) > 0);

    // Player commands play out roughly as issued.
    for (const c of commands) {
        const actor = playerPets.find((p) => p.id === c.petId);
        const target = livingEnemy();
        if (!actor || (world.hp.get(actor.id) ?? 0) <= 0) continue;
        if (c.kind === "guard" || c.kind === "rest") {
            events.push({
                t: "action", actorId: actor.id, actorSide: "player", moveName: c.kind === "guard" ? "Guard" : "Catch Breath",
                moveKind: c.kind, element: actor.element ?? "None", delivery: "self", super: false, timing: 0,
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
            super: superCast, timing: c.timing ?? 0,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: world.round % 3 === 0 ? "super" : "neutral", guarded: false, ko }],
            staminaAfter: Math.max(0, 100 - world.round * 25), meterAfter: meter,
            overexerted: world.round === 3,
        });
        if (ko && !livingEnemy()) {
            events.push({ t: "end", outcome: "win", byJudge: false }, { t: "roundEnd", round: world.round });
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
            moveKind: "damage", element: enemy.element ?? "None", delivery: "melee", super: false, timing: 0,
            targets: [{ id: target.id, damage, heal: 0, effectiveness: "neutral", guarded: false, ko }],
            staminaAfter: 60, meterAfter: 40, overexerted: false,
        });
        if (ko && !livingPlayer()) {
            events.push({ t: "end", outcome: "loss", byJudge: false }, { t: "roundEnd", round: world.round });
            return { ok: true, events, state: stateView(true, "loss") };
        }
    }
    if (world.round === 2) {
        const victim = livingPlayer();
        if (victim) events.push({ t: "dot", targetId: victim.id, targetSide: "player", kind: "burn", damage: 24, ko: false });
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

createRoot(document.getElementById("root")!).render(<Harness />);
