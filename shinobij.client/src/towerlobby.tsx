// DEV-ONLY harness to eyeball the Battle Towers LOBBY without a server. Mocks the
// /api/towers/floors response. Served at /towerlobby.html by vite dev.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowersLobby } from "./screens/BattleTowersLobby";
import type { TowerFloorMeta } from "./lib/towers-api";

const storyArena = (id: number): TowerFloorMeta["map"] => {
    if (id <= 4) return { width: 16, height: 10 };
    if (id === 5 || id === 10 || id === 15) return { width: 20, height: 14 };
    return { width: 18, height: 12 };
};

const F = (
    id: number,
    name: string,
    biome: string,
    objective: string,
    roundBudget: number,
    artKey: string,
    isBoss = false,
    milestone: string | null = null,
): TowerFloorMeta => ({
    id,
    name,
    chapter: id <= 10 ? 1 : 2,
    chapterTitle: id <= 10 ? "The Spire Ascent" : "The Stormglass Rebellion",
    artKey,
    biome,
    objective,
    roundBudget,
    isBoss,
    bossMechanic: null,
    bossTargetMode: null,
    bossStrike: null,
    closingRing: null,
    dynamicHazards: [],
    fieldRule: null,
    enemyCount: isBoss ? 6 : 9,
    phaseReinforcementCount: 0,
    reinforcementWaves: [],
    firstClearReward: {
        ryo: id * 400,
        statPoints: id * 4,
        fateShards: milestone ? id * 2 : 0,
        boneCharms: 0,
        milestone,
    },
    milestone,
    map: storyArena(id),
});

const MOCK: TowerFloorMeta[] = [
    F(1, "Foothold", "forest", "defeat-all", 8, "foothold"),
    F(2, "Crossfire Glade", "forest", "defeat-all", 8, "crossfire-glade"),
    F(3, "Frozen Gauntlet", "snow", "defeat-all", 9, "frozen-gauntlet"),
    F(4, "Hold the Line", "central", "protect-npc", 8, "hold-the-line"),
    F(5, "Warden of the Spire", "volcano", "defeat-boss", 14, "spire-warden", true, "tower-floor-5"),
    F(6, "The Acolyte Coven", "shadow", "defeat-all", 10, "acolyte-coven"),
    F(7, "The Hollow Revenant", "shadow", "defeat-all-then-boss", 16, "hollow-revenant", true),
    F(8, "Escort the Vanguard", "central", "kill-escort", 12, "escort-vanguard"),
    F(9, "Pit of Embers", "volcano", "kill-adds-first", 16, "pit-of-embers", true),
    F(10, "The Spire Sovereign", "shadow", "defeat-boss", 18, "spire-sovereign", true, "tower-floor-10"),
    F(11, "Stormglass Breach", "forest", "defeat-all", 12, "stormglass-breach"),
    F(12, "The Thunder Archive", "snow", "break-objective", 17, "thunder-archive", true),
    F(13, "Bridge of a Thousand Bolts", "central", "protect-npc", 10, "thousand-bolt-bridge"),
    F(14, "Hall of Broken Reflections", "shadow", "defeat-all", 14, "broken-reflections"),
    F(15, "The Stormglass Crown", "volcano", "kill-adds-first", 20, "stormglass-crown", true, "tower-floor-15"),
];
const realFetch = window.fetch.bind(window);
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
window.fetch = ((url: RequestInfo | URL, ...rest: unknown[]) => {
    const u = String(url);
    if (u.includes("/api/towers/floors")) return json({ floors: MOCK });
    if (u.includes("/api/towers/party")) return json({ party: null, invitations: [] });
    if (u.includes("/api/towers/my-run")) return json({});
    if (u.includes("/api/towers/spire-leaderboard")) return json({ weekKey: "", total: 0, leaderboard: [] });
    if (u.includes("/api/player/friends")) return json({ following: ["Kazuto", "Mira", "Daichi", "Yuki"] });
    return realFetch(url, ...(rest as []));
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
    <BattleTowersLobby
        character={{ name: "Rill", level: 45, ryo: 12_000, battleTowerBestFloor: 4, battleTowerRating: 1840, battleTowerClearedFloors: [1, 2, 3, 4] } as never}
        updateCharacter={() => {}}
        onEnter={() => {}}
        onBack={() => {}}
    />,
);
