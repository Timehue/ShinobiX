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
// fully dressed. Silent fallback to the CSS look when offline.
const LIVE_SERVER = "https://shinobijourney.com";

function Harness() {
    const [floorNum, setFloorNum] = useState(1);
    const [run, setRun] = useState<HollowGateShrineRun>(() => generateHollowGateShrineRun(1));
    const [log, setLog] = useState<string[]>(["Preview harness — movement is geometry-only."]);
    const [sharedImages, setSharedImages] = useState<Record<string, string>>({});
    const pushLog = (line: string) => setLog(prev => [line, ...prev].slice(0, 30));
    useEffect(() => {
        let alive = true;
        fetch(`${LIVE_SERVER}/api/images?cat=shrine&ids=1`)
            .then(r => (r.ok ? r.json() : []))
            .then((ids: string[]) => {
                if (!alive || !Array.isArray(ids)) return;
                const map: Record<string, string> = {};
                for (const id of ids) map[id] = `${LIVE_SERVER}/api/img?id=${encodeURIComponent(id)}`;
                setSharedImages(map);
            })
            .catch(() => { /* offline — CSS fallback look */ });
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
