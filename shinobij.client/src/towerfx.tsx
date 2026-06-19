// DEV-ONLY harness to eyeball the Battle Tower fight board without a server.
// Mounts BattleTowerFight with a mock active session (squad + spread enemies +
// boss + pylon FLOWERS / ward / hazard). Served at /towerfx.html by vite dev.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowerFight } from "./screens/BattleTowerFight";
import type { TowerSession, TowerActor } from "./lib/towers-api";

const W = 20, H = 14;
// Local copy of the catalog's hexZone (centre + 6 touching tiles) for the mock.
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
        features: [
            { kind: "pylon", tiles: zone(107), element: "Fire", weakenElement: "Water", percent: 25, label: "Flame Pylon" },
            { kind: "pylon", tiles: zone(172), element: "Water", weakenElement: "Fire", percent: 25, label: "Tide Pylon" },
            { kind: "ward", tiles: [130], percent: 20, label: "Warded Stone" },
            { kind: "hazard", tiles: [88], percent: 12, label: "Frost Spikes" },
        ],
    },
    actors: [
        {
            id: "sq-0", side: "squad", name: "Rill", ownerSlug: "Rill", ai: false,
            hp: 8200, maxHp: 10000, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            shield: 0, statuses: [], pos: 121,
            character: { specialty: "Ninjutsu", stats: {}, jutsu: [{ id: "fireball", name: "Fireball", element: "Fire", type: "Ninjutsu", ap: 40, range: 2, effectPower: 40 }] },
        },
        enemy("en-0", "bandit", "Bandit", 39),
        enemy("en-1", "archer", "Archer", 98, 270, 270),
        enemy("en-2", "brute", "Brute", 157, 570, 570),
        enemy("en-3", "acolyte", "Acolyte", 199, 250, 250),
        enemy("boss", "warden", "Spire Warden", 138, 2520, 2520),
        enemy("en-4", "ravager", "Pit Ravager", 237, 2880, 2880),
    ],
    turnQueue: ["sq-0", "en-0", "en-1", "en-2", "en-3", "boss", "en-4"],
    activeIndex: 0, round: 1, activeAp: 100, actionsThisTurn: 0,
    objectiveState: { kind: "defeat-all", completed: false, failed: false },
    phaseState: { bossId: "boss", pendingPhases: [60, 30], triggeredPhases: [] },
    status: "active", winner: null,
    log: ["The fight begins.", "A Spire Warden looms across the glade."],
};

createRoot(document.getElementById("root")!).render(
    <BattleTowerFight character={{ name: "Rill" } as never} runId="preview" initialSession={session} onExit={() => {}} />,
);
