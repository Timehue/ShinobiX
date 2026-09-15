import { buildStrongholdTiles, STRONGHOLD_DIMS, STRONGHOLD_ROOMS, STRONGHOLD_SPAWN } from '../../../../shared/sector-stronghold';
import type { HollowGateShrineRun } from '../../types/character';

export const VAULT_DIMS = STRONGHOLD_DIMS;

export function buildVaultInterior(sector = 0): HollowGateShrineRun {
    return {
        ...VAULT_DIMS, tiles: buildStrongholdTiles(sector),
        playerX: STRONGHOLD_SPAWN % VAULT_DIMS.width, playerY: Math.floor(STRONGHOLD_SPAWN / VAULT_DIMS.width),
        floor: 1, threat: 0, torch: 10, keys: 0, completed: false,
        roomThemes: Object.fromEntries(STRONGHOLD_ROOMS.map(room => [room.id, 'warvault'])),
    };
}
