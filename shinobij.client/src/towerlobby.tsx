// DEV-ONLY harness to eyeball the Battle Towers LOBBY without a server. Mocks the
// /api/towers/floors response. Served at /towerlobby.html by vite dev.
import { createRoot } from "react-dom/client";
import "./index.css";
import { BattleTowersLobby } from "./screens/BattleTowersLobby";

const F = (id: number, name: string, biome: string, objective: string, isBoss = false, milestone: string | null = null) =>
    ({ id, name, biome, objective, roundBudget: 8, isBoss, milestone, map: { width: 20, height: 14 } });
const MOCK = [
    F(1, "Foothold", "forest", "defeat-all"),
    F(2, "Crossfire Glade", "forest", "defeat-all"),
    F(3, "Frozen Gauntlet", "snow", "defeat-all"),
    F(4, "Hold the Line", "central", "protect-npc"),
    F(5, "Warden of the Spire", "volcano", "defeat-boss", true, "tower-floor-5"),
    F(6, "The Acolyte Coven", "shadow", "defeat-all"),
    F(7, "The Hollow Revenant", "shadow", "defeat-boss", true),
    F(8, "Escort the Vanguard", "central", "kill-escort"),
    F(9, "Pit of Embers", "volcano", "defeat-boss", true),
    F(10, "The Spire Sovereign", "shadow", "defeat-boss", true, "tower-floor-10"),
];
const realFetch = window.fetch.bind(window);
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
window.fetch = ((url: RequestInfo | URL, ...rest: unknown[]) => {
    const u = String(url);
    if (u.includes("/api/towers/floors")) return json({ floors: MOCK });
    if (u.includes("/api/player/friends")) return json({ following: ["Kazuto", "Mira", "Daichi", "Yuki"] });
    return realFetch(url, ...(rest as []));
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
    <BattleTowersLobby
        character={{ name: "Rill", battleTowerBestFloor: 4, battleTowerRating: 1840, battleTowerClearedFloors: [1, 2, 3, 4] } as never}
        updateCharacter={() => {}} onEnter={() => {}} onBack={() => {}}
    />,
);
