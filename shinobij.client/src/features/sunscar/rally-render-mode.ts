import { rallyStartsLight } from './rally-quality';

export type RallyRenderPreference = 'auto' | '3d' | 'economy';
export const RALLY_RENDER_KEY = 'petRally.render.v1';

/** Economy bypasses WebGL and model downloads, including on weak laptops. */
export function rallyUsesEconomy(preference: RallyRenderPreference, cores?: number, memoryGB?: number): boolean {
    return preference === 'economy' || preference === 'auto' && rallyStartsLight(cores, memoryGB);
}

export function readRallyRenderPreference(): RallyRenderPreference {
    try {
        const saved = localStorage.getItem(RALLY_RENDER_KEY);
        if (saved === 'economy' || saved === '3d') return saved;
    } catch { /* A render preference does not require writable storage. */ }
    return 'auto';
}
