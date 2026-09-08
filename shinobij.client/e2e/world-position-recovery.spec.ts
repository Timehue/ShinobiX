import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { sectorBiomeOf } from '../../shared/sector-geo';

test('a refreshed outbound journey recovers its map, arrival tile, and presence without returning to town', async ({ page }) => {
    const errors: string[] = [];
    const frames: Array<{ sector: number; tile: number; enterTown: boolean }> = [];
    const saves: Array<{ currentSector?: number; currentBiome?: string }> = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (new URL(request.url()).pathname.toLowerCase() === '/api/save/auditninja' && request.method() === 'POST') {
            saves.push(request.postDataJSON());
        }
    });
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0, currentTile: 17,
        pendingTravel: { destinationSector: 13, arrivalAt: Date.now() + 60_000, remainingMs: 1500 } });
    // The server has arrived while the browser is still restoring its local
    // mask. This is the timing that previously turned stale 0s into town entry.
    await page.route('**/api/player/heartbeat', async route => {
        frames.push(route.request().postDataJSON());
        await route.fulfill({ json: { sector: 13, tile: 44, traveling: false,
            sectorMates: [], pendingChallenges: [], pendingNotices: [] } });
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    await expect(page.getByRole('complementary', { name: 'Sector 13 command panel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Current tile row 4 column 9' })).toHaveCount(1);
    await expect.poll(() => frames.some(frame => frame.sector === 13 && frame.tile === 44)).toBe(true);
    await expect.poll(() => saves.some(save => save.currentSector === 13 && save.currentBiome === sectorBiomeOf(13))).toBe(true);
    expect(frames.filter(frame => frame.sector === 0).every(frame => frame.enterTown === false)).toBe(true);
    await expect(page.getByRole('complementary', { name: 'Device and server saves diverged' })).toHaveCount(0);
    expect(errors).toEqual([]);
});
