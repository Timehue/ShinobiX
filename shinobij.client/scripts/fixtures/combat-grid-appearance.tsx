// Local-only visual fixture: real combat screens, deterministic in-memory transport.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/styles/late-normalize.css";
import "../../src/styles/veiled-steel.css";
import "../../src/styles/layout/adaptive-shell.css";
import "../../src/styles/layout/adaptive-stages.css";
import "../../src/styles/layout/adaptive-tools.css";
import "../../src/styles/lite-fx-compositing.css";
import { MissionArenaFight } from "../../src/screens/MissionArenaFight";
import { PvpBattleScreen } from "../../src/screens/PvpBattleScreen";
import type { ServerArenaSession } from "../../src/lib/server-arena-runtime";
import type { PvpSessionState } from "../../src/types/pvp-ui";
import { viewportClassForWidth } from "../../src/lib/viewport-contract";

// Match the viewport attribute normally installed by App's useViewportContract.
const syncViewport = () => { document.documentElement.dataset.vp = viewportClassForWidth(window.innerWidth); };
syncViewport();
window.addEventListener("resize", syncViewport);

const params = new URLSearchParams(location.search);
const biome = params.get("biome") ?? "forest";
const jutsu = { id: "qa-fire", name: "Fireball", element: "Fire", type: "Ninjutsu", ap: 40, range: 4, effectPower: 40, chakraCost: 20, staminaCost: 10, method: "SINGLE", target: "OPPONENT", tags: [], description: "Fireball" };
const character = {
    name: "Rill", avatar: "/portraits/male.png", level: 20, village: "Ashen Leaf Village", specialty: "Ninjutsu", bloodline: "None",
    hp: 1500, maxHp: 2000, chakra: 200, maxChakra: 300, stamina: 200, maxStamina: 300,
    stats: { ninjutsuOffense: 100, ninjutsuDefense: 80, taijutsuOffense: 80, taijutsuDefense: 80, genjutsuOffense: 80, genjutsuDefense: 80, bukijutsuOffense: 80, bukijutsuDefense: 80, speed: 100, intelligence: 100, willpower: 100 },
    jutsu: [jutsu], equippedJutsu: [jutsu.id], jutsuMastery: [], equipment: {}, inventory: [], pets: [], ryo: 0,
};
const fighter = (name: string, pos: number) => ({ name, pos, hp: 1500, maxHp: 2000, chakra: 200, maxChakra: 300, stamina: 200, maxStamina: 300, shield: 0, statuses: [], character: { ...character, name } });
let solo: ServerArenaSession = {
    sessionId: "grid-qa", runtimeVersion: 1,
    map: { width: 12, height: 10, biome, blockedTiles: [19] },
    actors: [
        { ...fighter("Rill", 52), id: "player", side: "squad", ownerSlug: "rill", ai: false, cooldowns: {} },
        { ...fighter("Raider", 55), id: "enemy", side: "enemy", ownerSlug: null, ai: true },
    ],
    groundEffects: [{ id: "poison", owner: "enemy", name: "Poison Mire", tiles: [76, 77], rounds: 3, tags: [{ name: "Poison", percent: 10 }] }],
    turnQueue: ["player", "enemy"], activeIndex: 0, round: 2, activeAp: 100, actionsThisTurn: 0, status: "active", winner: null, log: ["The fight begins."],
};
let pvp: PvpSessionState = {
    battleId: "grid-qa", stateRevision: 1, p1: fighter("Rill", 52), p2: fighter("Raider", 55),
    biome: biome as never, round: 2, activePlayer: "p1", ap: { p1: 100, p2: 100 }, actionsThisTurn: 0,
    cooldowns: { p1: {}, p2: {} }, joined: { p1: true, p2: true }, status: "active", winner: null, log: ["The fight begins."],
};
// No production endpoint is called by this fixture.
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/api/")) return originalFetch(input, init);
    if (url.includes("/pvp/move") && init?.body) {
        const body = JSON.parse(String(init.body));
        if (body.action === "move") pvp = { ...pvp, stateRevision: pvp.stateRevision + 1, p1: { ...pvp.p1, pos: body.tile }, ap: { p1: 90, p2: 100 } };
    }
    return Response.json(url.includes("/pvp/session") || url.includes("/pvp/move") ? pvp : { messages: [], spectators: [], locked: false });
};
createRoot(document.getElementById("root")!).render(params.get("mode") === "pvp"
    ? <PvpBattleScreen character={character as never} accountSessionEpoch={1} battleId="grid-qa" role="p1" setScreen={() => {}}
        equippedJutsu={[jutsu] as never} equippedItems={[]} currentBiome={biome as never} currentWeather="clear" currentSector={1} sharedImages={{}} seedSession={pvp} />
    : <MissionArenaFight character={character as never} runId="grid-qa" initialSession={solo} creatorJutsus={[jutsu] as never}
        missionName="Battlefield preview" onExit={() => {}} settleFn={async () => ({})}
        transport={{ turnTimeoutMs: 3600000, fetchState: async () => solo, submitAction: async (_id, _name, _current, action) => {
            if (params.has("reject-action")) return { applied: false, reason: "Not enough AP for this action.", session: solo };
            if (action.type === "move") solo = { ...solo, runtimeVersion: (solo.runtimeVersion ?? 1) + 1, actors: solo.actors.map(actor => actor.id === "player" ? { ...actor, pos: action.tile } : actor) };
            return { applied: true, session: solo };
        } }} />);
