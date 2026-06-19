// DEV-ONLY harness to eyeball the Battle Tower fight board without a server.
// Served at /towerfx.html by vite dev. Mocks an active session: spread squad,
// enemy FORMATION with the boss in back, pylon FLOWERS (varied elements), ward +
// hazard flowers, on the new top-down arena floor.
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

const session: TowerSession = {
    towerId: "celestial", runId: "preview", floor: 2, seed: 1, partySize: 1,
    map: {
        width: W, height: H, biome: "forest", blockedTiles: [], hazardTiles: [], objectiveTiles: [],
        // Spread, non-overlapping flowers (what the server's procedural placement produces).
        features: [
            { kind: "pylon", tiles: zone(66), element: "Fire", weakenElement: "Water", percent: 25, label: "Flame Pylon" },
            { kind: "pylon", tiles: zone(74), element: "Earth", weakenElement: "Lightning", percent: 25, label: "Stone Pylon" },
            { kind: "pylon", tiles: zone(128), element: "Wind", weakenElement: "Fire", percent: 25, label: "Gale Pylon" },
            { kind: "ward", tiles: zone(156), percent: 20, label: "Warded Stone" },
            { kind: "hazard", tiles: zone(210), percent: 12, label: "Frost Spikes" },
        ],
    },
    actors: [
        {
            id: "sq-0", side: "squad", name: "Rill", ownerSlug: "Rill", ai: false,
            hp: 8200, maxHp: 10000, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            shield: 0, statuses: [], pos: 123,
            character: { specialty: "Ninjutsu", stats: {}, jutsu: [{ id: "fireball", name: "Fireball", element: "Fire", type: "Ninjutsu", ap: 40, range: 2, effectPower: 40 }] },
        },
        // Formation: grunts in two ranks (cols 16-18), boss anchoring the back (col 19).
        enemy("en-0", "bandit", "Bandit", 118),
        enemy("en-1", "archer", "Archer", 117, 270, 270),
        enemy("en-2", "brute", "Brute", 116, 570, 570),
        enemy("en-3", "acolyte", "Acolyte", 198, 250, 250),
        enemy("en-4", "bandit", "Bandit", 197),
        enemy("en-5", "archer", "Archer", 196, 270, 270),
        enemy("boss", "warden", "Spire Warden", 159, 2520, 2520),
    ],
    turnQueue: ["sq-0", "en-0", "en-1", "en-2", "en-3", "en-4", "en-5", "boss"],
    activeIndex: 0, round: 1, activeAp: 100, actionsThisTurn: 0,
    objectiveState: { kind: "defeat-all", completed: false, failed: false },
    phaseState: { bossId: "boss", pendingPhases: [60, 30], triggeredPhases: [] },
    status: "active", winner: null,
    log: ["The fight begins.", "A Spire Warden anchors the enemy formation."],
};

createRoot(document.getElementById("root")!).render(
    <BattleTowerFight character={{ name: "Rill" } as never} runId="preview" initialSession={session} onExit={() => {}} />,
);
