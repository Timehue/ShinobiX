/**
 * Hollow Gate — room-flood visibility.
 *
 * Split out of ./hollow-gate-dungeon so the click-to-move walker and the
 * map-memory stamp (./hollow-gate-path, used by App on every committed step)
 * can compute what the player can see WITHOUT pulling the procedural
 * generator — and its ASCII layouts / BSP / maze modules — onto the startup
 * graph. The generator is now loaded on demand when a run actually starts.
 *
 * Moved verbatim: no behavior change.
 */
import type { HollowGateShrineRun } from "../types/character";

// ── Room-flood visibility ───────────────────────────────────────────────────
// Builds the set of tiles currently lit up around the player.
//
// Rules (matches your "light up the section you're in but not behind doors"
// request):
//   • Player's tile is always visible.
//   • If the player is standing IN a room (tile has roomId), the entire room
//     lights up at once — every cell with the same roomId becomes visible.
//   • Doors at the edge of the lit room are visible (you can see the doorway),
//     but vision STOPS at the door — what's beyond stays fogged. This is what
//     makes choosing the wrong door risky.
//   • If the player is in a corridor (no roomId), vision flood-fills along
//     the corridor in all four directions until it hits a wall or a door.
//     Doors at the end of a corridor are visible but don't reveal beyond.
//   • Walls are NEVER walkable, but neighboring walls of a lit room ARE shown
//     so the room reads as a discrete chamber (its walls trace the perimeter).
export function computeHollowGateVisible(run: HollowGateShrineRun): Set<number> {
    const w = run.width;
    const h = run.height;
    const playerIdx = run.playerY * w + run.playerX;
    const playerTile = run.tiles[playerIdx];
    const visible = new Set<number>([playerIdx]);
    if (!playerTile) return visible;

    function addWallsAroundLitTiles() {
        // Reveal the wall tiles that border any currently-lit cell so each
        // room's perimeter is visible from the inside.
        const litSnapshot = [...visible];
        for (const idx of litSnapshot) {
            const x = idx % w;
            const y = Math.floor(idx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (run.tiles[nIdx]?.terrain === "wall") visible.add(nIdx);
            }
        }
    }

    if (playerTile.roomId != null) {
        // Standing in a room — light up every cell of that room + bordering doors.
        for (let i = 0; i < run.tiles.length; i += 1) {
            if (run.tiles[i]?.roomId === playerTile.roomId) visible.add(i);
        }
        // Add doors adjacent to lit room cells (doors are 'room_floor' typed
        // as 'door' terrain — they belong to the same roomId).
        // They're already included above. But we also want to reveal doors
        // that border the room from the corridor side; check cardinal neighbours.
        const litSnapshot = [...visible];
        for (const idx of litSnapshot) {
            const x = idx % w;
            const y = Math.floor(idx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (run.tiles[nIdx]?.terrain === "door") visible.add(nIdx);
            }
        }
        // Doorway peek: standing IN a doorway shows one tile of whatever lies
        // beyond it (no flood — a sliver of corridor). Without this, vision
        // from a door is room-only and the corridor past it stays unknowable
        // until a blind step — which walled off click-to-move exploration.
        if (playerTile.terrain === "door") {
            const px = playerIdx % w;
            const py = Math.floor(playerIdx / w);
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = px + dx;
                const ny = py + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nIdx = ny * w + nx;
                if (run.tiles[nIdx] && run.tiles[nIdx].terrain !== "wall") visible.add(nIdx);
            }
        }
        addWallsAroundLitTiles();
        return visible;
    }

    // Standing in a corridor (or undefined terrain on legacy runs).
    // DISTANCE-CAPPED flood through corridor cells (stops at walls/doors). The
    // cap matters for maze floors: corridors there form one big connected web,
    // so an uncapped flood would reveal the whole floor. Capping it to
    // MAX_CORRIDOR_SIGHT tiles gives a torch-flashlight reach down the passages;
    // short BSP/layout corridors are well under the cap, so they're unaffected.
    const MAX_CORRIDOR_SIGHT = 6;
    const dist = new Map<number, number>([[playerIdx, 0]]);
    const queue: number[] = [playerIdx];
    while (queue.length > 0) {
        const idx = queue.shift()!;
        const d = dist.get(idx) ?? 0;
        const x = idx % w;
        const y = Math.floor(idx / w);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (visible.has(nIdx)) continue;
            const nTile = run.tiles[nIdx];
            if (!nTile) continue;
            if (nTile.terrain === "wall") continue; // walls handled at the end
            if (nTile.terrain === "door") {
                visible.add(nIdx);
                continue; // can see the door, but vision stops here
            }
            if (nTile.terrain === "corridor_floor" || nTile.terrain == null) {
                visible.add(nIdx);
                if (d + 1 < MAX_CORRIDOR_SIGHT) { dist.set(nIdx, d + 1); queue.push(nIdx); }
            }
            // If we reach a room_floor (legacy runs without doors between
            // corridor and room), reveal one tile but don't flood the room.
            if (nTile.terrain === "room_floor") {
                visible.add(nIdx);
            }
        }
    }
    addWallsAroundLitTiles();
    return visible;
}
