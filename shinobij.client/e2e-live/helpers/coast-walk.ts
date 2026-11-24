import { expect, type Page } from '@playwright/test';
import { coastWalkSpace } from '../../../api/_coast-walk-space';
import { coastLayout } from '../../../shared/coast-world';
import type { CoastExit } from '../../../shared/coast-world-rules';
import { pathInMask } from '../../../shared/sector-walk-mask';

/** Walk to the painted road end using only ground currently visible to a player. */
export async function takeCoastTrail(page: Page, fromTile: number, exit: CoastExit, touch: boolean) {
    const layout = coastLayout(exit.sector)!;
    const path = pathInMask(layout.mask, fromTile, exit.tile)!;
    const chunk = coastWalkSpace.chunks.find(entry => entry.sector === exit.sector)!;
    const board = page.locator('.continuous-world-map');
    const canvas = board.locator('> canvas[tabindex]');
    const approaches = Object.values(layout.sites).map(site => site.approach);
    const label = 'Follow the ' + exit.direction + ' trail to ' + coastLayout(exit.destinationSector)!.name;
    await canvas.scrollIntoViewIfNeeded();
    let start = 0;
    while (start < path.length) {
        // A resident can temporarily stand on the road. Pick a patch of ground
        // or a visible part of this trailhead that will actually receive the tap.
        const target = await page.waitForFunction(input => {
            const map = document.querySelector('.continuous-world-map')!;
            const floor = map.querySelector('.continuous-world-chunk')!.getBoundingClientRect();
            const terrain = map.querySelector('canvas[tabindex]');
            const cell = floor.width / 12;
            const patrols = [...map.querySelectorAll('.coast-patrol')].map(button => button.getBoundingClientRect());
            for (let i = input.path.length - 1; i >= input.start; i--) {
                const tile = input.path[i], trail = i === input.path.length - 1;
                if (!trail && (i === 0 || input.approaches.includes(tile))) continue;
                for (const [dx, dy] of [[.5,.5],[.28,.32],[.72,.68],[.28,.68],[.72,.32]]) {
                    const x = floor.left + (tile % 12 + dx) * cell;
                    const y = floor.top + (Math.floor(tile / 12) + dy) * cell;
                    // Leave room for a moving patrol between aiming and touching the glass.
                    // Chromium also adjusts a finger contact toward nearby controls.
                    if (patrols.some(r => Math.hypot(Math.max(r.left - x, 0, x - r.right),
                        Math.max(r.top - y, 0, y - r.bottom)) < cell * .48)) continue;
                    const hit = (px: number, py: number) => {
                        const el = document.elementFromPoint(px, py);
                        return trail ? el?.closest('button')?.title === input.label : el === terrain;
                    };
                    const pad = input.touch ? 9 : 3;
                    if ([[0,0], [-pad,-pad], [pad,pad], [-pad,pad], [pad,-pad]].every(([a,b]) => hit(x+a,y+b))) {
                        return { x, y, i, tile, trail };
                    }
                }
            }
            return null;
        }, { path, start, label, approaches, touch }, { timeout: 30_000 });
        const point = (await target.jsonValue())!;
        await target.dispose();
        if (touch) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        if (point.trail) return;
        const x = chunk.x + point.tile % 12 + .5, y = chunk.y + Math.floor(point.tile / 12) + .5;
        await expect.poll(() => canvas.evaluate((el, dest) => Math.hypot(
            Number(el.getAttribute('data-world-x')) - dest.x, Number(el.getAttribute('data-world-y')) - dest.y
        ), { x, y }), { message: 'Walk onto tile ' + point.tile }).toBeLessThan(.1);
        start = point.i + 1;
    }
}
