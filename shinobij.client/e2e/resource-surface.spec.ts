import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { RESOURCE_NODES, resourceNodePosition } from '../../shared/resource-nodes';
import { nearestWalkableTile } from '../../shared/sector-walk-mask';

const evidence = '../output/resource-node-audit/browser';
mkdirSync(evidence, { recursive: true });
for (const sector of [52, 50, 60, 62, 65, 38, 6, 42]) test(`sector ${sector}: only reviewed resource markers appear on the actual floor`, async ({ page }, info) => {
    const save = uiAuditSave(), now = Date.now();
    save.currentSector = sector; save.currentTile = nearestWalkableTile(sector, 65)!;
    save.character = { ...save.character, starterCardsClaimed: true, wandererCooldowns: quietRoadCooldowns([sector], now) };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/worldMap');
    const back = page.getByRole('button', { name: `Return to Sector ${sector}`, exact: false });
    await expect.poll(async () => await back.isVisible() || await page.locator('.continuous-world-map').isVisible(), { timeout: 60_000 }).toBe(true);
    if (await back.isVisible()) await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator(`[data-world-chunk="${sector}"]`)).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const markers = page.locator('.resource-world-node'), nodes = RESOURCE_NODES.filter(n => n.sector === sector);
    await expect(markers).toHaveCount(nodes.length);
    for (const node of nodes) {
        const marker = page.getByRole('button', { name: `${node.name}, ${node.activity}, 3 attempts remaining, skill ${node.difficulty}`, exact: true });
        await expect(marker).toBeVisible();
        const actual = await marker.evaluate(el => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) })), expected = resourceNodePosition(node);
        expect(actual.left).toBeCloseTo(expected.left); expect(actual.top).toBeCloseTo(expected.top);
    }
    await page.mouse.move(2, 2);
    await page.locator('.continuous-world-map').screenshot({ path: `${evidence}/${info.project.name}-sector-${sector}.png` });
    expect(errors).toEqual([]);
});
