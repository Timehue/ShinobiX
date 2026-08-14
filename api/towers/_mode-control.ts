/** Emergency launch stop. Existing rooms/runs remain readable and settleable. */
export function towerModeDisabled(): boolean {
    return process.env.TOWER_MODE_DISABLED === '1';
}
