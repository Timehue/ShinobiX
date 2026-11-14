import { expect, type Locator, type Page } from '@playwright/test';

/** The sector itself: 12 tiles across on every screen. On a phone the camera shows
 *  about 7 of them around the player, so the visible map is no longer the sector. */
export async function sectorBox(page: Page) {
    const box = await page.locator('.continuous-world-map .continuous-world-chunk').first().boundingBox();
    expect(box, 'the sector chunk is laid out').not.toBeNull();
    return { ...box!, tile: box!.width / 12 };
}

/** Walk the player toward `target` until it is on the visible map, the way a phone player
 *  walks up to someone before talking to them. Done when the target's centre is well inside
 *  the map, or when the player stands within a tile of it (a building larger than the view).
 *  Each step is the game's own tap-to-travel, sent to the world canvas so a figure under the
 *  tap point cannot catch it, and aimed half a tile short of the target so the tap never
 *  lands on the target's own tiles (tapping a building tile opens that building).
 *  `advance` moves an installed fake clock; without one the walk runs on real time. */
export async function walkUntilOnMap(page: Page, target: Locator, advance?: (ms: number) => Promise<unknown>) {
    const map = page.locator('.continuous-world-map'), canvas = map.locator('canvas').first();
    // A fixed ground-floor map (an isolated village) has no follow camera to walk.
    if (!await map.count()) return;
    for (let step = 0; step < 16; step++) {
        const [view, body, sector] = await Promise.all([map.boundingBox(), target.boundingBox(), sectorBox(page)]);
        expect(view, 'the world map is laid out').not.toBeNull();
        expect(body, 'the walk target is laid out').not.toBeNull();
        const margin = Math.min(view!.width, view!.height) * .2, tile = sector.tile;
        const centre = { x: view!.x + view!.width / 2, y: view!.y + view!.height / 2 };
        const x = body!.x + body!.width / 2, y = body!.y + body!.height / 2;
        const inside = (v: number, from: number, size: number) => v >= from + margin && v <= from + size - margin;
        if (inside(x, view!.x, view!.width) && inside(y, view!.y, view!.height)) return;
        // The point of the target nearest the player, and how far away it is.
        const near = { x: Math.min(body!.x + body!.width, Math.max(body!.x, centre.x)), y: Math.min(body!.y + body!.height, Math.max(body!.y, centre.y)) };
        const distance = Math.hypot(near.x - centre.x, near.y - centre.y);
        if (distance <= tile) return;
        const reach = Math.min(distance - tile / 2, Math.min(view!.width, view!.height) / 2 - margin);
        // A tap on any landmark's footprint (a building, shrine or boss) opens it instead of walking:
        // aim at the farthest point toward the target that stays off every footprint.
        const footprints = new Set((await page.locator('.continuous-world-chunk [data-footprint]:not(:disabled)')
            .evaluateAll(nodes => nodes.flatMap(node => (node.getAttribute('data-footprint') ?? '').split(' ')))).filter(Boolean).map(Number));
        const heading = Math.atan2(near.y - centre.y, near.x - centre.x);
        const candidates = [1, .75, .5].flatMap(share => [0, .4, -.4, .8, -.8].map(turn =>
            ({ x: centre.x + Math.cos(heading + turn) * reach * share, y: centre.y + Math.sin(heading + turn) * reach * share })));
        const point = candidates.find(p => {
            const col = Math.floor((p.x - sector.x) / tile), row = Math.floor((p.y - sector.y) / tile);
            return col >= 0 && col < 12 && row >= 0 && row < 12 && !footprints.has(row * 12 + col);
        });
        if (!point) throw new Error('every walk point toward the target is on a landmark');
        const dialogs = await page.getByRole('dialog').count();
        await canvas.evaluate((node, p) => {
            // A synthetic pointer has no live id to capture; capture changes nothing for a tap.
            const init = { clientX: p.x, clientY: p.y, pointerId: 41, isPrimary: true, bubbles: true };
            const capture = Object.getOwnPropertyDescriptor(node, 'setPointerCapture');
            Object.defineProperty(node, 'setPointerCapture', { configurable: true, value: () => undefined });
            try { node.dispatchEvent(new PointerEvent('pointerdown', init)); node.dispatchEvent(new PointerEvent('pointerup', init)); }
            finally { if (capture) Object.defineProperty(node, 'setPointerCapture', capture); else delete (node as { setPointerCapture?: unknown }).setPointerCapture; }
        }, point);
        await expect(page.getByRole('dialog'), 'a walk tap must not open anything').toHaveCount(dialogs, { timeout: 1000 });
        if (advance) for (let i = 0; i < 10; i++) await advance(150); else await page.waitForTimeout(1500);
    }
    throw new Error('the player could not walk close enough to bring the target onto the map');
}
