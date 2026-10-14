import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { nearestWalkableTile, isWalkableTile } from '../../shared/sector-walk-mask';
import { wandererDayBucketFromMs, wandererPresenceGate } from '../../shared/wanderer-roster';

async function assertArrivalAndWalk(page: Page, sector: number, touch: boolean) {
    await expect(page.locator('.map-instance')).toHaveAttribute('data-gamepad-mode', 'sector');
    const floor = page.locator('.sector-image-map').first();
    await expect(floor).toBeVisible();
    const canvas = page.locator('.continuous-world-map > canvas');
    if (await canvas.count()) {
        await expect(canvas).toHaveAttribute('data-world-sector', String(sector));
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    }
    const avatar = page.locator('[data-world-self], .sector-avatar-overlay > .sector-avatar-figure');
    await expect(avatar).toHaveCount(1);
    const before = page.getByRole('button', { name: /^Current tile row/ });
    await expect(before).toHaveCount(1);
    const label = await before.getAttribute('aria-label');
    const match = /row (\d+) column (\d+)/.exec(label!)!;
    const tile = (Number(match[1]) - 1) * 12 + Number(match[2]) - 1;
    const next = [tile - 12, tile + 12, tile - 1, tile + 1].find(candidate =>
        candidate >= 0 && candidate < 144 && isWalkableTile(sector, candidate)
        && Math.abs(candidate % 12 - tile % 12) + Math.abs(Math.floor(candidate / 12) - Math.floor(tile / 12)) === 1)!;
    expect(next).toBeDefined();
    const target = page.getByRole('button', { name: `Move to tile row ${Math.floor(next / 12) + 1} column ${next % 12 + 1}`, exact: true });
    if (await canvas.count()) {
        // Continuous-world tiles are keyboard landmarks; pointer input goes
        // through the terrain canvas, exactly as it does for a player.
        const cell = await target.boundingBox(), surface = await canvas.boundingBox();
        const position = { x: cell!.x + cell!.width / 2 - surface!.x, y: cell!.y + cell!.height / 2 - surface!.y };
        if (touch) await canvas.tap({ position });
        else await canvas.click({ position });
    } else await target.click();
    if (await canvas.count()) {
        // Pointer navigation selects the nearest reachable world anchor. The
        // current-tile label changes only after a server movement reply, so
        // this proves both movement and its projection into the sector UI.
        await expect.poll(() => before.getAttribute('aria-label')).not.toBe(label);
        await expect(canvas).toHaveAttribute('data-world-sector', String(sector));
    } else {
        await expect(page.getByRole('button', { name: `Current tile row ${Math.floor(next / 12) + 1} column ${next % 12 + 1}`, exact: true })).toBeVisible();
    }
    const bounds = await floor.boundingBox(), actor = await avatar.boundingBox();
    expect(actor!.x + actor!.width / 2).toBeGreaterThan(bounds!.x);
    expect(actor!.x + actor!.width / 2).toBeLessThan(bounds!.x + bounds!.width);
    expect(actor!.y + actor!.height).toBeGreaterThan(bounds!.y);
    expect(actor!.y + actor!.height).toBeLessThan(bounds!.y + bounds!.height);
}

for (const refused of [false, true]) {
test(refused ? 'Senna travel refusal keeps the original avatar and movement working'
    : 'Senna acceptance travels to sector 57, shows the avatar, and permits movement', async ({ page }, info) => {
    const bucket = wandererDayBucketFromMs(Date.now());
    const origin = Array.from({ length: 51 }, (_, i) => i + 1).find(sector =>
        wandererPresenceGate(`rift#rift-legacy-echo#${sector}#${bucket}`, .1))!;
    const save = uiAuditSave(); save.currentSector = origin; save.currentTile = nearestWalkableTile(origin, 78); save.worldGeoV = 2;
    save.character = { ...save.character, level: 12, starterCardsClaimed: true,
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    const runtime = await installUiAuditRuntime(page, save);
    const requests: number[] = [];
    await page.route('**/api/player/travel', async route => {
        requests.push(route.request().postDataJSON().destinationSector);
        if (refused) return route.fulfill({ status: 409, json: { error: 'Road blocked for handoff verification' } });
        await route.fallback();
    });
    await page.route('**/api/sector/rift-quest', async route => {
        const activeRiftQuest = { id: 'rift-legacy-echo', targetSector: 57, stage: 'travel', baseline: 0, bossName: 'The Unremembered' };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter({ ...save.character, activeRiftQuest }, version);
        await route.fulfill({ json: { ok: true, activeRiftQuest, _saveVersion: version } });
    });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    const here = page.locator('.village-back-button').filter({ hasText: `Return to Sector ${origin}` });
    await expect(here).toBeVisible(); await here.click();
    const senna = page.locator('[title^="Senna Graveward ·"]');
    await expect(senna).toBeVisible(); await senna.click();
    const accept = page.getByRole('button', { name: 'I will recover the mark and stop the copy.', exact: true });
    for (let i = 0; i < 20 && !await accept.isVisible(); i++) {
        await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(accept).toBeEnabled(); await accept.click();
    await expect.poll(() => requests).toEqual([57]);
    if (refused) await expect(page.getByText('Road blocked for handoff verification', { exact: true })).toBeVisible();
    await assertArrivalAndWalk(page, refused ? origin : 57, info.project.name === 'mobile');
    await page.screenshot({ path: info.outputPath(refused ? 'senna-refused-still-walking.png' : 'senna-sector-57-walking.png'), fullPage: true });
});
}

test('the admin logbook raid destination survives map navigation and arrives playable', async ({ page }, info) => {
    const save = uiAuditSave(); save.currentSector = 12; save.currentTile = nearestWalkableTile(12, 78); save.worldGeoV = 2;
    save.character = { ...save.character, name: 'Admin1', starterCardsClaimed: true,
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    save.creatorRaids = [{ id: 'qa-sector-raid', name: 'Travel Handoff Guard', biome: 'shadow', targetSector: 57,
        icon: 'guard', levelReq: 1, aiProfileId: 'bandit', waves: 1, xpReward: 0, ryoReward: 0, staminaReward: 0, description: 'Travel verification' }];
    await installUiAuditRuntime(page, save, false, 'Admin1');
    await page.route('**/api/save/**', async route => {
        const slot = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!).toLowerCase();
        if (slot === 'admin 1' || slot === 'admin 2') {
            return route.fulfill({ json: { ...save, character: { ...save.character, name: 'Admin 1' }, _saveVersion: 1 } });
        }
        await route.fallback();
    });
    const requests: number[] = [];
    await page.route('**/api/player/travel', async route => {
        requests.push(route.request().postDataJSON().destinationSector);
        await route.fallback();
    });
    await page.goto('/#/logbook', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'logbook');
    await page.getByRole('button', { name: 'Go to raid sector', exact: true }).click();
    await expect.poll(() => requests).toEqual([57]);
    await assertArrivalAndWalk(page, 57, info.project.name === 'mobile');
    await page.screenshot({ path: info.outputPath('logbook-sector-57-walking.png'), fullPage: true });
});
