/*
 * DEV-ONLY Hollow Gate preview harness (hgpreview.html) — mounts the shrine
 * view with a generated floor and a minimal stub character so the dungeon
 * renderer (camera / walls / fog / click-to-walk / avatar / minimap) can be
 * eyeballed without logging in and spending a Hollow Gate Key. Movement here
 * is geometry-only (walls block, tiles reveal, descend regenerates a floor —
 * no battles, no torch/threat economy): it exercises the RENDERER, not the
 * run loop. Not part of the player bundle (its own Vite HTML entry, like
 * petvfx.html).
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { HollowGateShrineView } from "./features/hollowGate/HollowGateShrineView";
import { useHollowGateWalk } from "./features/hollowGate/use-hollow-gate-walk";
import { generateHollowGateShrineRun } from "./lib/hollow-gate-dungeon";
import { markHollowGateSeen } from "./lib/hollow-gate-path";
import type { Character, HollowGateShrineRun } from "./types/character";

const stubCharacter = {
    name: "Kalam",
    avatarImage: undefined,
    pets: [],
    activePetId: null,
    hollowShards: 42,
    inventory: [],
} as unknown as Character;

// Hydrate the shrine art from the LIVE shared-image store (reference URLs, the
// same /api/img form the real client uses) so the harness shows the dungeon
// fully dressed. The ids-list fetch needs CORS (only localhost:5173 is
// allowlisted), so on other dev ports we fall back to a snapshot of the live
// key list (audited 2026-07-09) — /api/img itself needs no CORS. Fully
// offline, everything falls through to the CSS look.
const LIVE_SERVER = "https://shinobijourney.com";
const SHRINE_KEY_SNAPSHOT = [
    "shrine:hidden-chamber-background", "shrine:hollow-gate-background",
    "shrine:icon-battle-1", "shrine:icon-battle-2", "shrine:icon-battle-3", "shrine:icon-battle-4",
    "shrine:icon-boss-1", "shrine:icon-boss-2",
    "shrine:icon-chest-1", "shrine:icon-chest-2", "shrine:icon-chest-3", "shrine:icon-chest-4",
    "shrine:icon-deco-1", "shrine:icon-deco-2", "shrine:icon-deco-3", "shrine:icon-deco-4",
    "shrine:icon-deco-5", "shrine:icon-deco-6", "shrine:icon-deco-7", "shrine:icon-deco-8",
    "shrine:icon-descend", "shrine:icon-descend-1",
    "shrine:icon-elite-1", "shrine:icon-elite-2", "shrine:icon-elite-3", "shrine:icon-elite-4",
    "shrine:icon-exit", "shrine:icon-exit-1", "shrine:icon-locked-1", "shrine:icon-locked-2",
    "shrine:icon-npc-1", "shrine:icon-npc-2", "shrine:icon-npc-3",
    "shrine:icon-pet-1", "shrine:icon-pet-2", "shrine:icon-pet-3",
    "shrine:icon-shardvein-1", "shrine:icon-shardvein-2", "shrine:icon-shrine-1", "shrine:icon-shrine-2",
    "shrine:icon-story-1", "shrine:icon-story-2", "shrine:icon-trap-1", "shrine:icon-trap-2",
    "shrine:icon-trap-3", "shrine:icon-trap-4", "shrine:icon-wall",
    ...["crypt", "ember", "sanctum", "ruins"].flatMap(t =>
        ["corridor", "deco-1", "deco-2", "door", "floor", "wall", "wall-face"].map(r => `shrine:icon-theme-${t}-${r}`)),
    "shrine:intro-1", "shrine:intro-2", "shrine:intro-3",
    "shrine:tile-ancient-chest", "shrine:tile-corridor-floor", "shrine:tile-corridor-floor-0",
    "shrine:tile-corridor-floor-1", "shrine:tile-corrupted-shinobi", "shrine:tile-door",
    "shrine:tile-hollow-beast", "shrine:tile-pet-encounter",
    "shrine:tile-room-floor", "shrine:tile-room-floor-0", "shrine:tile-room-floor-1", "shrine:tile-room-floor-2",
    "shrine:tile-sealed-door", "shrine:tile-shrine-keeper", "shrine:tile-story", "shrine:tile-tile-game",
    "shrine:tile-trap", "shrine:tile-wall", "shrine:tile-wall-0", "shrine:tile-wall-1", "shrine:tile-wall-2",
    "shrine:tile-wall-face",
];

function Harness() {
    const [floorNum, setFloorNum] = useState(1);
    const [run, setRun] = useState<HollowGateShrineRun>(() => generateHollowGateShrineRun(1));
    const [log, setLog] = useState<string[]>(["Preview harness — movement is geometry-only."]);
    const [sharedImages, setSharedImages] = useState<Record<string, string>>({});
    const pushLog = (line: string) => setLog(prev => [line, ...prev].slice(0, 30));
    useEffect(() => {
        let alive = true;
        const apply = (ids: string[]) => {
            if (!alive || !Array.isArray(ids) || ids.length === 0) return;
            const map: Record<string, string> = {};
            for (const id of ids) map[id] = `${LIVE_SERVER}/api/img?id=${encodeURIComponent(id)}`;
            setSharedImages(map);
        };
        fetch(`${LIVE_SERVER}/api/images?cat=shrine&ids=1`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then(apply)
            .catch(() => apply(SHRINE_KEY_SNAPSHOT));   // CORS-blocked port / list hiccup
        return () => { alive = false; };
    }, []);

    // Geometry-only movement: walls block, tiles reveal; stepping on descend
    // regenerates the next floor. No events/economy — renderer test only.
    function moveStep(dx: number, dy: number) {
        setRun(prev => {
            const nx = prev.playerX + dx;
            const ny = prev.playerY + dy;
            if (nx < 0 || ny < 0 || nx >= prev.width || ny >= prev.height) return prev;
            const idx = ny * prev.width + nx;
            const tile = prev.tiles[idx];
            if (tile.kind === "wall" || tile.terrain === "wall") return prev;
            const tiles = prev.tiles.slice();
            tiles[idx] = { ...tile, revealed: true, resolved: true };
            return markHollowGateSeen({ ...prev, playerX: nx, playerY: ny, tiles });
        });
    }
    const { walkTo, walkTarget } = useHollowGateWalk({ active: true, run, blocked: false, moveStep });
    // Dev probe for driving/verifying the harness from the browser console.
    useEffect(() => {
        (window as unknown as Record<string, unknown>).__hg = { run, walkTo, walkTarget };
    });

    // Regenerate floors from the toolbar to eyeball generator variety.
    function regen(floor: number) {
        setFloorNum(floor);
        setRun(generateHollowGateShrineRun(floor));
        pushLog(`Generated floor ${floor}.`);
    }

    return (
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", color: "#e9d5ff" }}>
                <strong>HG preview:</strong>
                {[1, 2, 3, 4, 5].map(f => (
                    <button key={f} onClick={() => regen(f)} style={{ fontWeight: f === floorNum ? 700 : 400 }}>
                        Floor {f}
                    </button>
                ))}
                <span style={{ fontSize: 12, color: "#a78bfa" }}>tap tiles to walk · WASD steps · no combat here</span>
            </div>
            <HollowGateShrineView
                character={stubCharacter}
                hollowGateRun={run}
                hollowGateLog={log}
                sharedImages={sharedImages}
                hollowGateIntroPage={null}
                setHollowGateIntroPage={() => {}}
                hollowGateEvent={null}
                hollowGateHiddenChamber={null}
                moveHollowGatePlayer={moveStep}
                onTileClick={walkTo}
                walkTarget={walkTarget}
                setHollowGateRun={setRun}
                setCharacter={() => {}}
                pushHollowGateLog={pushLog}
                petEligible={false}
                onSearchHiddenChamber={() => {}}
                onTakeHiddenChamberRelic={() => {}}
                onCloseHiddenChamber={() => {}}
            />
        </div>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Harness />
    </StrictMode>,
);
