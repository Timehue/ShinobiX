// DEV-ONLY harness to eyeball the Battle Tower fight board without a server.
// Mounts BattleTowerFight with a mock active session (squad + enemies + boss +
// pylon/ward/hazard features). Served at /towerfx.html by the vite dev server.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowerFight } from "./screens/BattleTowerFight";
import type { TowerSession, TowerActor } from "./lib/towers-api";

function enemy(id: string, visual: string, name: string, pos: number, hp = 300, maxHp = 300): TowerActor {
    return {
        id, side: "enemy", name, ownerSlug: null, ai: true,
        hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos, character: { specialty: "Taijutsu", stats: {}, visual },
    };
}

const session: TowerSession = {
    towerId: "celestial", runId: "preview", floor: 2, seed: 1, partySize: 1,
    map: {
        width: 14, height: 10, biome: "forest", blockedTiles: [], hazardTiles: [], objectiveTiles: [],
        features: [
            { kind: "pylon", tiles: [61], element: "Fire", weakenElement: "Water", percent: 25, label: "Flame Pylon" },
            { kind: "pylon", tiles: [78], element: "Water", weakenElement: "Fire", percent: 25, label: "Tide Pylon" },
            { kind: "ward", tiles: [90], percent: 20, label: "Warded Stone" },
            { kind: "hazard", tiles: [48], percent: 12, label: "Frost Spikes" },
        ],
    },
    actors: [
        {
            id: "sq-0", side: "squad", name: "Rill", ownerSlug: "Rill", ai: false,
            hp: 8200, maxHp: 10000, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            shield: 0, statuses: [], pos: 14,
            character: { specialty: "Ninjutsu", stats: {}, jutsu: [{ id: "fireball", name: "Fireball", element: "Fire", type: "Ninjutsu", ap: 40, range: 2, effectPower: 40 }] },
        },
        enemy("en-0", "bandit", "Bandit", 13),
        enemy("en-1", "archer", "Archer", 27, 270, 270),
        enemy("en-2", "brute", "Brute", 41, 570, 570),
        enemy("en-3", "acolyte", "Acolyte", 55, 250, 250),
        enemy("boss", "warden", "Spire Warden", 69, 2520, 2520),
        enemy("en-4", "ravager", "Pit Ravager", 97, 2880, 2880),
    ],
    turnQueue: ["sq-0", "en-0", "en-1", "en-2", "en-3", "boss", "en-4"],
    activeIndex: 0, round: 1, activeAp: 100, actionsThisTurn: 0,
    objectiveState: { kind: "defeat-all", completed: false, failed: false },
    phaseState: { bossId: "boss", pendingPhases: [60, 30], triggeredPhases: [] },
    status: "active", winner: null,
    log: ["The fight begins.", "Rill steps onto the field.", "A Spire Warden looms on the far side."],
};

createRoot(document.getElementById("root")!).render(
    <BattleTowerFight character={{ name: "Rill" } as never} runId="preview" initialSession={session} onExit={() => {}} />,
);
