import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { safeName } from '../_utils.js';
import type { HollowGateRunToken } from './_run-token.js';

const ERROR = 'The saved shrine floor does not match the sealed run.';

/** Only the sealed run may advance a saved floor. Never adopt client progress,
 * another identity, an absent projection, or a floor ahead of the server. */
export function hollowGateFloorProjection(character: Record<string, unknown>, token: string, run: HollowGateRunToken, targetFloor = run.currentFloor) {
    const saved = character.hollowGateRun as Record<string, unknown> | null | undefined;
    const floor = Number(saved?.floor), sealed = Number(run.currentFloor), target = Number(targetFloor);
    if (!saved || saved.runToken !== token || saved.serverSeed !== run.seed || run.playerName !== safeName(String(character.name ?? ''))
        || !Number.isInteger(floor) || floor < 1 || !Number.isInteger(sealed) || floor > sealed
        || sealed > run.floorDepth || !Number.isInteger(target) || target < sealed || target > run.floorDepth
        || character.hospitalized === true || Number(character.hp) <= 0
        || (Array.isArray(character.redeemedHollowGateRuns) && character.redeemedHollowGateRuns.includes(token))) {
        return { ok: false as const, status: 409, error: ERROR };
    }
    if (floor === target) return { ok: true as const, projection: saved, changed: false };
    const projection: Record<string, unknown> = { ...saved, floor: target };
    // A floor-N drawing cannot become floor N+1 just by changing its label.
    // The normal reload path rebuilds boardless projections from the sealed
    // manifest, position and event receipts; no rewards or vitals change here.
    // Explicit undefined also clears these through mergePreservingImages;
    // deleting a key from the patch would resurrect the stored old drawing.
    for (const key of ['tiles', 'playerX', 'playerY', 'activeCombat']) projection[key] = undefined;
    return { ok: true as const, projection, changed: true };
}

/** Caller holds the run lock and has recovered pending operations. This lazy
 * migration keeps an existing dive playable without a reset or a free heal. */
export async function repairHollowGateFloorProjection(playerName: string, token: string, run: HollowGateRunToken) {
    return mutatePlayerSave(playerName, ({ character }) => {
        const result = hollowGateFloorProjection(character, token, run);
        if (!result.ok) return result;
        return { ok: true as const, character: result.changed ? { ...character, hollowGateRun: result.projection } : character,
            value: null, write: result.changed };
    });
}
