import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { worldPositionModel, CONTINUOUS_WORLD_SPACE, WORLD_LAYOUT_VERSION } from '../../shared/continuous-world-layout';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation';
import type { WorldPosition } from '../../shared/world-position';
import { seedWorldActor, openWorld as open } from './helpers/world-actor';
import { writeFile } from 'node:fs/promises';

const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes, byId = new Map(nodes.map(n => [n.id, n]));
const a = nodes.find(n => n.road === '9-15' && n.neighbors.some(id => byId.get(id)!.sector !== n.sector))!;
const b = byId.get(a.neighbors.find(id => byId.get(id)!.sector !== a.sector)!)!;
const cursor = (progress: number): WorldPosition => ({ layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b.id, progress });

const actor = (request: APIRequestContext, context: BrowserContext, position: WorldPosition) => seedWorldActor(request, context, position, model.location(position));
test.use({ contextOptions: { reducedMotion: 'no-preference' } });
test('quiet comparison measures incremental nearby visibility with one active camera', async ({ page, context, browser, request }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const otherContext = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: info.project.use.viewport, serviceWorkers: 'block' });
    const driver = await actor(request, otherContext, cursor(.2));
    await actor(request, context, cursor(.8));
    try { const other = await otherContext.newPage(); await open(other); } finally { await otherContext.close(); }
    await open(page);
    let showNearby = true;
    await page.route('**/api/player/world-move', async route => {
        if (showNearby || route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES }); return route.fulfill({ response, json: { ...await response.json(), players: [] } });
    });
    const peer = page.locator(`.continuous-world-peer[title^="${driver.name} "]`), results = [];
    for (const enabled of [true, false]) {
        showNearby = enabled;
        await expect(peer).toHaveCount(enabled ? 1 : 0);
        const intervals = await page.evaluate(() => new Promise<number[]>(resolve => {
            const samples: number[] = [], start = performance.now(); let previous = start;
            const frame = (now: number) => { samples.push(now - previous); previous = now;
                if (now - start < 5000) requestAnimationFrame(frame); else resolve(samples); };
            requestAnimationFrame(frame);
        }));
        const sorted = intervals.toSorted((x, y) => x - y);
        results.push({ nearby: enabled, samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)],
            p95Ms: sorted[Math.floor(sorted.length * .95)], over50Ms: sorted.filter(n => n > 50).length });
    }
    expect(errors).toEqual([]);
    await writeFile(info.outputPath('nearby-comparison.json'), JSON.stringify({ project: info.project.name, results, errors,
        scope: 'one active full-motion built-game camera; the neighbouring player remains server-owned; visibility-only response filtering for comparison' }, null, 2));
});
test('two clients remain visible across an invisible boundary with bounded polling and touch travel', async ({ page, context, browser, request }, info) => {
    const viewerContext = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: info.project.use.viewport,
        isMobile: Boolean(info.project.use.isMobile), hasTouch: Boolean(info.project.use.hasTouch), reducedMotion: 'no-preference', serviceWorkers: 'block' });
    try {
        const driver = await actor(request, context, cursor(.2)), observer = await actor(request, viewerContext, cursor(.8));
        expect(driver.sector).not.toBe(observer.sector);
        const viewer = await viewerContext.newPage(), errors: string[] = [], polls: { bytes: number; at: number }[] = [];
        for (const p of [page, viewer]) p.on('pageerror', error => errors.push(error.message));
        viewer.on('response', response => { if (response.url().includes('/api/player/world-move') && response.request().method() === 'GET')
            void response.body().then(body => polls.push({ bytes: body.length, at: Date.now() })).catch(() => {}); });
        await open(page); await open(viewer);
        const peer = viewer.locator(`.continuous-world-peer[title^="${driver.name} "]`);
        await expect(peer).toBeVisible();
        expect((await (await request.get('/api/player/world-move', { headers: driver.headers })).json()).sector).toBe(driver.sector);
        await viewer.screenshot({ path: info.outputPath('nearby-across-boundary.png'), fullPage: true });
        const canvas = page.locator('.continuous-world-map > canvas'), box = (await canvas.boundingBox())!;
        const x = box.x + box.width / 2 + (b.x - a.x) * box.width / 12 * 2;
        const y = box.y + box.height / 2 + (b.y - a.y) * box.width / 12 * 2;
        if (info.project.use.hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
        await expect(canvas).toHaveAttribute('data-world-sector', String(observer.sector));
        await expect(peer).toBeVisible();
        await canvas.focus(); await page.keyboard.press('Escape');
        await viewer.evaluate(() => { const frames: number[] = []; (window as unknown as { peerFrames: number[] }).peerFrames = frames;
            let previous = performance.now(); const sample = (now: number) => { frames.push(now - previous); previous = now; if (frames.length < 600) requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
        await page.waitForTimeout(5200);
        const frames = (await viewer.evaluate(() => (window as unknown as { peerFrames: number[] }).peerFrames)).sort((x, y) => x - y);
        expect(polls.length).toBeLessThanOrEqual(10); expect(Math.max(...polls.map(p => p.bytes))).toBeLessThan(12_000);
        expect(errors).toEqual([]);
        await writeFile(info.outputPath('nearby-performance.json'), JSON.stringify({ polls, frames: frames.length, p95FrameMs: frames[Math.floor(frames.length * .95)], errors }, null, 2));
    } finally { await viewerContext.close(); }
});
