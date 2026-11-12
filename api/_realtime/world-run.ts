import { WORLD_RUN_MS, WORLD_RUN_REFILL_MS, type WorldRunAction, type WorldRunWindow } from '../../shared/world-run.js';
import { sectorPlayerGaitsEnabled } from '../_release-flags.js';
import type { OnlinePlayer } from './types.js';

// A short-lived account timer survives a disconnect or sector change without writing to the save.
const windows = new Map<string, Omit<WorldRunWindow, 'serverTime'>>();

export function worldRunWindow(name: string, now = Date.now()): WorldRunWindow {
    const current = windows.get(name);
    if (current && now < current.readyAt) return { ...current, serverTime: now };
    if (current) windows.delete(name);
    return { endsAt: 0, readyAt: 0, serverTime: now };
}

export function changeWorldRun(player: OnlinePlayer, action: WorldRunAction, now = Date.now()) {
    const current = worldRunWindow(player.name, now);
    if (action === 'start-run' && (!sectorPlayerGaitsEnabled() || player.locationUnverified ||
        player.inBattle || (player.travelingUntil ?? 0) > now))
        return { ok: false, run: current };
    if (action === 'start-run' ? current.readyAt > now : current.endsAt <= now)
        return { ok: false, run: current };
    // Prune abandoned sessions even when they never reconnect.
    for (const [name, window] of windows) if (window.readyAt <= now) windows.delete(name);
    const endsAt = action === 'start-run' ? now + WORLD_RUN_MS : now;
    const window = { endsAt, readyAt: endsAt + WORLD_RUN_REFILL_MS };
    windows.set(player.name, window);
    return { ok: true, run: { ...window, serverTime: now } };
}
