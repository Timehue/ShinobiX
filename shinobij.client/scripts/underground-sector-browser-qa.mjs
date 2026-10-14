// Real exploration views with deterministic layout/presence fixtures. Reward
// authority and war settlement are covered by the backend integration tests.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
import { STRONGHOLD_ROOMS, STRONGHOLD_DIMS } from '../../shared/sector-stronghold.ts';
import { hollowRifts } from '../src/data/hollow-rifts.ts';
const tmp = resolve('.tmp/underground-sector-qa-' + process.pid);
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? '../docs/stronghold/underground-audit');
await mkdir(tmp, { recursive: true });
await mkdir(output, { recursive: true });
await build({ entryPoints: ['scripts/fixtures/underground-sector-qa.tsx'], bundle: true, jsx: 'automatic', outfile: tmp + '/preview.js',
    plugins: [{ name: 'public-assets', setup(build) { build.onResolve({ filter: /^\// }, args => ({ path: args.path, external: true })); } }],
    loader: { '.css': 'css', '.webp': 'file', '.png': 'file', '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.jpg': 'file' },
    define: { 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'true', 'import.meta.env.MODE': '"test"' }, logLevel: 'error' });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') {
            res.setHeader('Content-Type', 'text/html');
            return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preview.css"><style>html,body,#root{margin:0;min-height:100%;background:#080d14}body{padding:0}.hollow-gate-shrine{width:100%;box-sizing:border-box}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>');
        }
        res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        const file = path.startsWith('/preview.') ? await readFile(resolve(tmp, '.' + path))
            : await readFile(resolve('public', '.' + path)).catch(() => readFile(resolve(tmp, '.' + path)));
        return res.end(file);
    } catch { res.statusCode = 404; res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;
const checks = [], errors = [], assetErrors = [];
function watch(page) {
    page.on('pageerror', e => errors.push(String(e)));
    page.on('response', response => { if (response.status() >= 400 && response.request().resourceType() === 'image') assetErrors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => { if (request.resourceType() === 'image') assetErrors.push(`${request.failure()?.errorText} ${request.url()}`); });
}
const quick = process.argv.includes('--quick');
const mobile = process.argv.includes('--mobile');
const depthsOnly = process.argv.includes('--depths-only');
const small = process.argv.includes('--small');
const engineFilter = process.argv.find(a => a.startsWith('--engine='))?.slice(9);
const sceneFilter = process.argv.find(a => a.startsWith('--scene='))?.slice(8);
if (engineFilter && !['chromium', 'webkit'].includes(engineFilter)) throw new Error('Choose chromium or webkit.');
if (sceneFilter && !['stronghold', 'obsidian', 'cave', 'rift'].includes(sceneFilter)) throw new Error('Unknown underground scene.');
const performanceSamples = [];
function sampleMovementFrames(page) {
    return page.evaluate(() => new Promise(resolve => {
        const values = [], start = performance.now(); let previous = start;
        const frame = now => { values.push(now - previous); previous = now;
            if (now - start < 2000) requestAnimationFrame(frame);
            else { values.sort((a,b) => a-b); resolve({ frames: values.length, meanMs: (now - start) / values.length, zeroDeltaFrames: values.filter(value => value === 0).length, p95Ms: values[Math.floor(values.length * .95)], longestMs: values.at(-1), visibility: document.visibilityState, focused: document.hasFocus(), tiles: document.querySelectorAll('.stronghold-tile,.hg-cell').length }); }
        }; requestAnimationFrame(frame);
    }));
}
async function recordMovementFrames(frames, engine, scene, viewport) {
    if (!frames) return;
    const sample = await frames; performanceSamples.push({ engine, scene, viewport, cpuSlowdown: engine === 'chromium' ? 4 : 1, ...sample });
    await writeFile(`${output}/movement-frames.json`, JSON.stringify(performanceSamples, null, 2));
    assert(sample.p95Ms < 100, `${scene} mobile walking frame pacing regressed: ${sample.p95Ms}ms`);
}
try {
    for (const [engineName, engine] of (quick && !mobile ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]]).filter(([name]) => !engineFilter || engineFilter === name)) {
        const browser = await engine.launch({ headless: true });
        try {
            if (process.argv.includes('--resources')) {
                const { auditHollowGateResources } = await import('./hollow-gate-resource-qa.mjs');
                checks.push(...await auditHollowGateResources({ browser, engineName, url, output }));
                continue;
            }
            if (process.argv.includes('--rift-states')) {
                const viewport = { width: 320, height: 568 };
                for (const rift of hollowRifts) {
                    const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: true }); watch(page);
                    const query = `?rift=${rift.id}&floor=${rift.floors}&legacyAtlas&keys=12000&shards=123456789&ryo=900000&risk&threat=95`;
                    await page.goto(url + query);
                    await page.locator('.underground-terrain').waitFor();
                    await page.waitForLoadState('networkidle');
                    await page.screenshot({ path: `${output}/${engineName}-${rift.id}-final-risk.png` });
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${rift.id} risk/threat HUD overflows`);
                    assert.equal(await page.locator('.underground-depths li').count(), rift.floors);
                    assert.equal((await page.locator('.hg-floor-identity strong').last().textContent())?.trim(), rift.bossName, 'guardian intel uses the actual final boss');
                    for (const button of await page.getByRole('button', { name: /^Move / }).all()) {
                        const box = await button.boundingBox();
                        assert(box && box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, 'final-depth HUD keeps controls on screen');
                    }
                    await page.goto(url + query + '&completed');
                    await page.locator('.underground-terrain').waitFor();
                    assert.match(await page.locator('.hg-cave-header h2').innerText(), /The Rift Falls Silent/);
                    assert.equal(await page.locator('.hg-rift-badge').innerText(), 'RIFT');
                    checks.push({ engine: engineName, rift: rift.id, floor: rift.floors, viewport, riskHud: true, completion: true });
                    await page.close();
                }
                continue;
            }
            if (process.argv.includes('--quest-rifts') || process.argv.includes('--rift-motion-only') || process.argv.includes('--rift-motion-smoke')) {
                for (const viewport of (process.argv.includes('--rift-motion-only') || process.argv.includes('--rift-motion-smoke') ? [] : [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }])) for (const rift of hollowRifts) {
                    const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width < 900 }); watch(page);
                    await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                    await page.goto(`${url}?rift=${rift.id}&legacyAtlas`);
                    await page.bringToFront();
                    await page.locator('.underground-terrain').waitFor();
                    await page.waitForLoadState('networkidle');
                    assert.equal(await page.locator('.underground-world--rift').getAttribute('data-hg-rift'), rift.id);
                    assert.equal(await page.locator('.hg-rift-badge').innerText(), 'RIFT');
                    assert(await page.locator('.rift-breach.is-awake').count() > 0, 'the arrival chamber visibly contains the power source');
                    assert(await page.locator('.rift-chamber-floor').count() > 0, 'rift chambers use their authored ritual floor');
                    assert.equal(await page.locator('.rift-energy-ribbon').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion preserves static mystical scenery');
                    assert.equal(await page.locator('.hg-cave-header .act-label').evaluate(el => getComputedStyle(el).color), await page.locator('.hg-rift-badge').evaluate(el => getComputedStyle(el).color), 'rift title follows its theme palette');
                    assert.equal(await page.locator('.hg-cell').evaluateAll(cells => cells.some(cell => cell.style.background)), false, 'legacy atlas must not cover the cavern');
                    assert.equal(await page.locator('.hg-cell .hg-icon-img').count() > 0, true, 'assigned content icons remain available');
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${rift.id} overflows horizontally`);
                    assert.equal(await page.locator('.underground-depths li').count(), rift.floors);
                    const mask = await page.locator('.underground-terrain clipPath').first().evaluate(el => [...el.children].map(tile => Number(tile.getAttribute('data-tile'))));
                    const known = await page.locator('.hg-cell').evaluateAll(cells => cells.map(cell => (Number(cell.getAttribute('aria-rowindex')) - 1) * Number(cell.parentElement.getAttribute('aria-colcount')) + Number(cell.getAttribute('aria-colindex')) - 1));
                    assert(mask.length > 0 && mask.every(i => known.includes(i)), 'rift scenery remains inside explored terrain');
                    const before = await page.locator('body').getAttribute('data-tile');
                    const current = page.locator('.hg-cell[aria-current="location"]');
                    const row = Number(await current.getAttribute('aria-rowindex')), column = Number(await current.getAttribute('aria-colindex'));
                    const adjacent = page.locator(`.hg-cell.hg-clickable:not(.hg-door):is([aria-rowindex="${row}"][aria-colindex="${column - 1}"],[aria-rowindex="${row}"][aria-colindex="${column + 1}"],[aria-rowindex="${row - 1}"][aria-colindex="${column}"],[aria-rowindex="${row + 1}"][aria-colindex="${column}"])`).first();
                    const nextRow = Number(await adjacent.getAttribute('aria-rowindex')), nextColumn = Number(await adjacent.getAttribute('aria-colindex'));
                    const direction = nextRow < row ? 'up' : nextRow > row ? 'down' : nextColumn < column ? 'left' : 'right';
                    const move = page.getByRole('button', { name: `Move ${direction}`, exact: true });
                    try { if (viewport.width < 900) await move.tap(); else await move.click(); }
                    catch (error) { await page.screenshot({ path: `${output}/${engineName}-${rift.id}-failure.png` }); throw error; }
                    await page.waitForFunction(tile => document.body.dataset.tile !== tile, before);
                    await page.screenshot({ path: `${output}/${engineName}-${rift.id}-${viewport.width}x${viewport.height}.png` });
                    for (const button of await page.getByRole('button', { name: /^Move / }).all()) {
                        const box = await button.boundingBox();
                        assert(box && box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height + 1, `${rift.id} keeps movement controls on screen at ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
                    }
                    const palette = await page.locator('.underground-world').evaluate(el => getComputedStyle(el).getPropertyValue('--hg-floor-accent').trim());
                    await page.getByText('Floor map & expedition journal', { exact: true }).click();
                    await page.locator('.hg-minimap').waitFor({ state: 'visible' });
                    await page.getByRole('button', { name: 'Emergency Forfeit', exact: true }).click();
                    await page.getByRole('heading', { name: 'Returned to sector' }).waitFor();
                    checks.push({ engine: engineName, rift: rift.id, viewport, palette, movement: true, exit: true, legacyAtlasSuppressed: true });
                    await page.close();
                }
                if (process.argv.includes('--visual-only')) continue;
                const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference', hasTouch: true }); watch(page);
                await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                await page.goto(`${url}?rift=rift-legacy-echo`); await page.bringToFront(); await page.locator('.rift-breach.is-awake').waitFor();
                assert.equal(await page.locator('.rift-energy-ribbon').first().evaluate(el => getComputedStyle(el).animationName), 'rift-energy-rise');
                await page.waitForLoadState('networkidle');
                if (process.argv.includes('--rift-motion-smoke')) {
                    assert.equal(await page.locator('.rift-energy-ribbon img').first().evaluate(img => img.complete && img.naturalWidth > 0), true);
                    const motion = await page.locator('.rift-energy-ribbon').first().evaluate(async el => {
                        const animation = el.getAnimations()[0], before = Number(animation.currentTime);
                        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        return { running: animation.playState === 'running', advanced: Number(animation.currentTime) > before };
                    });
                    assert.deepEqual(motion, { running: true, advanced: true });
                    await page.screenshot({ path: `${output}/${engineName}-rift-energy-awake.png` });
                    checks.push({ engine: engineName, paintedEnergyLoaded: true, motion }); await page.close(); continue;
                }
                const animatedSamples = [], pausedSamples = [];
                for (let sample = 0; sample < 3; sample++) {
                    animatedSamples.push(await sampleMovementFrames(page));
                    const pausedStyle = await page.addStyleTag({ content: '.rift-energy-overlay * { animation: none !important; }' });
                    pausedSamples.push(await sampleMovementFrames(page));
                    await pausedStyle.evaluate(el => el.remove());
                }
                const middleSample = samples => [...samples].sort((a,b) => a.meanMs - b.meanMs)[1];
                const frames = middleSample(animatedSamples), staticFrames = middleSample(pausedSamples);
                await page.screenshot({ path: `${output}/${engineName}-rift-energy-awake.png` });
                await page.addStyleTag({ content: '.rift-energy-overlay * { animation: none !important; }' });
                const baseline = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference', hasTouch: true }); watch(baseline);
                await baseline.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                await baseline.goto(`${url}?floor=1`); await baseline.bringToFront(); await baseline.waitForLoadState('networkidle');
                const baselineFrames = await sampleMovementFrames(baseline);
                await writeFile(`${output}/${engineName}-rift-motion.json`, JSON.stringify({ rift: frames, staticRift: staticFrames, standardCavern: baselineFrames, animatedSamples, pausedSamples }, null, 2));
                // A loaded host can also stall the unanimated control. Judge
                // the added effect against alternating paused samples; apply
                // the 30fps floor when the control demonstrates that capacity.
                const controlMean = staticFrames.meanMs;
                assert(animatedSamples.every(sample => sample.frames >= 40) && pausedSamples.every(sample => sample.frames >= 40),
                    'Timing is inconclusive: insufficient frame samples under host contention; inspect the saved paired samples.');
                assert((controlMean >= 34 || frames.meanMs < 34) && frames.meanMs <= controlMean * 1.2 + 1,
                    `rift energy frame pacing regressed: ${JSON.stringify({ frames, staticFrames, baselineFrames })}`);
                await baseline.close();
                checks.push({ engine: engineName, riftEnergyMotion: true, ...frames }); await page.close();
                continue;
            }
            if (process.argv.includes('--entry-levels')) {
                for (const viewport of [{ width: 1366, height: 900 }, { width: 320, height: 568 }]) for (const level of [50, 99, 100]) {
                    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' }); watch(page);
                    let raidRequests = 0;
                    await page.route('**/api/**', route => {
                        const body = route.request().postDataJSON() ?? {};
                        if (body.action === 'recover') return route.fulfill({ status: 404, json: { error: 'Run not found or expired.' } });
                        if (body.action === 'start') { raidRequests++; return route.fulfill({ status: 403, json: { error: 'Raid admission reached the server.' } }); }
                        return route.fulfill({ json: { ok: true, visit: { presenceId: body.presenceId, id: 'entry-level-qa', layoutVersion: 1, sector: 12, tile: 697, steps: 0, threat: 0, version: 1, visited: [697, 698] }, peers: [] } });
                    });
                    await page.goto(`${url}?mode=stronghold&raidHost&level=${level}`);
                    await page.locator('.stronghold-anbu-station').waitFor();
                    await page.getByRole('button', { name: 'Move right', exact: true }).click();
                    const dialog = page.getByRole('dialog', { name: 'Challenge the Anbu' }); await dialog.waitFor();
                    if (level < 100) {
                        assert.equal(await dialog.getByRole('button', { name: 'Requires level 100', exact: true }).isDisabled(), true);
                        assert.match(await dialog.getByRole('status').innerText(), /unlock at level 100/);
                        assert.equal(raidRequests, 0);
                    } else {
                        const challenge = dialog.getByRole('button', { name: 'Challenge', exact: true }); assert.equal(await challenge.isEnabled(), true);
                        await challenge.click(); await dialog.getByRole('alert').waitFor(); assert.equal(raidRequests, 1);
                    }
                    if (level === 50) await page.screenshot({ path: `${output}/${engineName}-level-50-anbu-${viewport.width}.png` });
                    await dialog.getByRole('button', { name: 'Retreat', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
                    assert.equal(await page.getByRole('button', { name: 'Move left', exact: true }).isEnabled(), true);
                    checks.push({ engine: engineName, viewport, playerLevel: level, explorationAvailable: true, raidRequires100: true, retreatResumesExploration: true }); await page.close();
                }
                for (const viewport of [{ width: 1366, height: 900 }, { width: 320, height: 568 }]) for (const level of [50, 100]) {
                    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' }); watch(page);
                    let raidRequests = 0;
                    await page.route('**/api/**', route => {
                        const body = route.request().postDataJSON() ?? {}; if (body.action === 'start') raidRequests++;
                        if (body.action === 'recover') return route.fulfill({ status: 404, json: { error: 'Run not found or expired.' } });
                        return route.fulfill({ json: { ok: true, visit: { presenceId: body.presenceId, id: 'defender-entry-qa', layoutVersion: 1, sector: 12, tile: 697, steps: 0, threat: 0, version: 1, visited: [697, 698] }, peers: [] } });
                    });
                    await page.goto(`${url}?mode=stronghold&raidHost&village=Frostfang%20Village&level=${level}`);
                    await page.locator('.stronghold-anbu-station').waitFor();
                    assert.match(await page.locator('.stronghold-anbu-station').innerText(), /Village vault · Protected/);
                    await page.getByRole('button', { name: 'Move right', exact: true }).click();
                    const dialog = page.getByRole('dialog', { name: 'Your village’s Anbu' }); await dialog.waitFor();
                    assert.match(await dialog.innerText(), /Your own treasury cannot be raided/);
                    assert.equal(await dialog.locator('.stronghold-attack').count(), 0); assert.equal(raidRequests, 0);
                    if (level === 50) await page.screenshot({ path: `${output}/${engineName}-level-50-defender-${viewport.width}.png` });
                    await dialog.getByRole('button', { name: 'Return to stronghold', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
                    assert.equal(await page.getByRole('button', { name: 'Move left', exact: true }).isEnabled(), true);
                    checks.push({ engine: engineName, viewport, playerLevel: level, friendlyDefender: true, ownTreasuryProtected: true, explorationAvailable: true }); await page.close();
                }
                continue;
            }
            for (const viewport of (depthsOnly ? [] : small ? [{ width: 320, height: 568 }] : mobile ? [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }] : quick ? [{ width: 1366, height: 900 }, { width: 390, height: 844 }] : [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }])) {
                for (const scene of ['stronghold', 'obsidian', 'cave', 'rift'].filter(name => !sceneFilter || name === sceneFilter)) {
                    const page = await browser.newPage({ viewport, reducedMotion: 'reduce', hasTouch: viewport.width < 900 });
                    watch(page);
                    const sector = scene === 'obsidian' ? 99 : 12;
                    const visit = { id: 'qa', sector, layoutVersion: 1, tile: 153, version: 0, threat: 0, steps: 0, visited: [153] };
                    await page.route('**/api/**', async route => {
                        const body = route.request().postDataJSON() ?? {};
                        if (body.action === 'stronghold-enter') visit.presenceId = body.presenceId;
                        if (body.action === 'stronghold-step') {
                            visit.tile = body.tile; visit.version++; visit.steps++; visit.threat += 4; visit.visited = [...visit.visited, body.tile];
                        }
                        await route.fulfill({ json: { ok: true, visit, peers: [{ name: 'Rival', village: 'Frostfang Village', level: 100, stronghold: { sector, tile: 154 } }] } });
                    });
                    const query = scene === 'stronghold' ? '?mode=stronghold&war=card' : scene === 'obsidian' ? '?mode=stronghold&sector=99' : scene === 'rift' ? '?floor=3&event' : '?floor=2';
                    await page.goto(url + query);
                    await page.bringToFront();
                    await page.locator('.underground-terrain').waitFor();
                    if (mobile && engineName === 'chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
                    if (mobile) await page.waitForLoadState('networkidle');
                    const world = await page.locator(scene === 'stronghold' || scene === 'obsidian' ? '.stronghold-map' : '.hg-board').boundingBox();
                    assert(world && world.width > 500 && world.height > 300, 'world scale is preserved independently of the raster window');
                    const terrain = await page.locator('.underground-terrain').boundingBox();
                    const playfield = await page.locator(scene === 'stronghold' || scene === 'obsidian' ? '.stronghold-viewport' : '.hg-viewport').boundingBox();
                    assert(terrain && playfield && terrain.width >= playfield.width && terrain.height >= playfield.height, 'the raster window covers the complete playfield');
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${scene} overflows horizontally`);
                    if (scene === 'stronghold' || scene === 'obsidian') {
                        await page.getByRole('button', { name: 'Leave stronghold' }).waitFor();
                        const moveRight = await page.getByRole('button', { name: 'Move right', exact: true }).elementHandle();
                        assert(moveRight, 'the movement control is mounted before sampling');
                        const frames = mobile ? sampleMovementFrames(page) : null;
                        if (mobile) await moveRight.tap(); else await moveRight.click();
                        await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '4');
                        assert.equal(visit.tile, 154);
                        await recordMovementFrames(frames, engineName, scene, viewport);
                        await page.locator('.stronghold-peer').click();
                        await page.getByRole('dialog').waitFor();
                        if (scene === 'stronghold') assert.match(await page.getByRole('dialog').innerText(), /Card Battle.*active sector war/s);
                        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
                        await page.getByRole('button', { name: 'Dungeon intel', exact: true }).click();
                        await page.getByRole('dialog').waitFor();
                        await page.keyboard.press('d');
                        assert.equal(visit.steps, 1, 'intel dialog fences movement');
                        await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
                        if (scene === 'stronghold') {
                            await page.getByRole('button', { name: 'Open Card Battle', exact: true }).click();
                            assert.equal(await page.locator('body').getAttribute('data-table'), 'card');
                            await page.getByRole('button', { name: 'Fight garrison', exact: true }).click();
                            assert.equal(await page.locator('body').getAttribute('data-garrison'), 'card');
                        }
                        await page.screenshot({ path: `${output}/${engineName}-${scene}-${viewport.width}x${viewport.height}.png` });
                        await page.getByRole('button', { name: 'View full map', exact: true }).click();
                        await page.keyboard.press('d'); assert.equal(visit.steps, 1, 'overview blocks keyboard movement');
                        await page.getByRole('button', { name: 'Follow player', exact: true }).click();
                        await page.getByRole('button', { name: 'Leave stronghold', exact: true }).click();
                    } else {
                        await page.locator('.hg-viewport').scrollIntoViewIfNeeded();
                        const before = await page.locator('body').getAttribute('data-tile');
                        assert(Number(await page.locator('.hg-board').getAttribute('data-tile-size')) > (viewport.width > 900 ? 96 : 48), 'the cave uses world-scale chambers');
                        const fogMask = await page.evaluate(() => {
                            const terrain = document.querySelector('.underground-terrain');
                            const [left, top, width, height] = terrain.getAttribute('data-render-window').split(',').map(Number);
                            const known = [...document.querySelectorAll('.hg-cell:not(.hg-dark)')].map(cell => ({ x: Number(cell.style.gridColumnStart) - 1, y: Number(cell.style.gridRowStart) - 1 }))
                                .filter(cell => cell.x >= left && cell.x < left + width && cell.y >= top && cell.y < top + height).map(cell => `${cell.x},${cell.y}`).sort();
                            const drawn = [...terrain.querySelectorAll('clipPath[id$="-known"] rect')].map(rect => `${rect.getAttribute('x')},${rect.getAttribute('y')}`).sort();
                            return { known, drawn };
                        });
                        assert.deepEqual(fogMask.drawn, fogMask.known, 'the raster window retains exactly the known fog cells and reveals no unknown tile');
                        const choices = page.locator('.hg-cell.hg-clickable');
                        const count = await choices.count();
                        let chosen = false;
                        let frames = null;
                        for (let n = 0; n < count; n++) {
                            const candidate = choices.nth(n);
                            if (!(await candidate.getAttribute('aria-label'))?.startsWith('explored floor')) continue;
                            const box = await candidate.boundingBox();
                            if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) continue;
                            const hit = await candidate.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
                            if (!hit) continue;
                            const target = await candidate.elementHandle(); assert(target);
                            frames = mobile ? sampleMovementFrames(page) : null;
                            if (mobile) await target.tap(); else await target.click(); chosen = true; break;
                        }
                        assert(chosen, 'there is an accessible walk target');
                        await page.waitForFunction(tile => document.body.dataset.tile !== tile, before);
                        await recordMovementFrames(frames, engineName, scene, viewport);
                        assert.equal(await page.locator('.underground-depths li[aria-current="step"]').count(), 1);
                        assert.equal(await page.locator('.underground-depths li').count(), scene === 'rift' ? 3 : 5);
                        await page.screenshot({ path: `${output}/${engineName}-${scene}-${viewport.width}x${viewport.height}.png` });
                        await page.getByText('Floor map & expedition journal', { exact: true }).click();
                        await page.locator('.hg-minimap').waitFor({ state: 'visible' });
                        await page.getByRole('button', { name: 'Emergency Forfeit', exact: true }).click();
                    }
                    await page.getByRole('heading', { name: 'Returned to sector' }).waitFor();
                    checks.push({ engine: engineName, scene, viewport, movement: true, exit: true });
                    await page.close();
                }
            }
            if (process.argv.includes('--walk-only')) continue;
            if (!depthsOnly) {
            // All five standard depth palettes, including the final boss chamber.
            for (const npc of ['medic', 'wayfarer', 'bandit', 'night-ninja', 'patrol']) {
              for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
                const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
                watch(page);
                let gifts = 0;
                await page.route('**/api/**', route => {
                    const body = route.request().postDataJSON() ?? {};
                    if (route.request().url().endsWith('/event')) gifts++;
                    return route.fulfill({ json: { ok: true, runState: { keys: body.action === 'traveler-key' ? 1 : 0, torch: 10, threat: 0, secondWindArmed: false } } });
                });
                await page.goto(`${url}?floor=2&npc=${npc}`);
                const names = { medic: 'Wandering Medic', wayfarer: 'Relic Wayfarer', bandit: 'Cavern Bandit', 'night-ninja': 'Night Ninja' };
                const actor = page.getByRole('button', { name: npc === 'patrol' ? /Patrol, Hostile/ : new RegExp(`^${names[npc]},`) });
                await actor.waitFor();
                const player = page.locator('.hg-avatar:not(.hg-wanderer)');
                const sizes = await actor.evaluate(el => [el.style.width, document.querySelector('.hg-avatar:not(.hg-wanderer)').style.width]);
                assert.equal(sizes[0], sizes[1], 'NPC and player share the same pin size');
                assert.equal(await page.locator('.hg-cell[style*="linear-gradient"]').count(), 0, 'content has no colored floor blocks');
                assert.equal(await actor.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
                await page.screenshot({ path: `${output}/${engineName}-npc-${npc}-${viewport.width}.png` });
                if (npc === 'medic' || npc === 'wayfarer') {
                    await actor.click(); await page.getByRole('dialog').waitFor().catch(async error => { await page.screenshot({ path: `${output}/npc-failure.png` }); console.error(await page.locator('body').evaluate(el => ({ ...el.dataset })), errors); throw error; });
                    assert.equal(await page.getByRole('dialog').locator('img').evaluate(img => img.naturalWidth > 0), true);
                    await page.screenshot({ path: `${output}/${engineName}-npc-${npc}-conversation-${viewport.width}.png` });
                    await page.getByRole('button', { name: npc === 'medic' ? 'Accept healing' : 'Take a Shrine Key', exact: true }).click();
                    await page.getByRole('dialog').waitFor({ state: 'hidden' });
                    assert.equal(gifts, 1); assert.equal(await actor.count(), 0, 'a spent traveler departs');
                }
                checks.push({ engine: engineName, npc, viewport, art: true, gift: gifts }); await page.close();
              }
            }
            // Inspect the real defender station in its treasury chamber.
            {
                const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); watch(page);
                await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                await page.goto(`${url}?floor=2&npc=medic&confirmForfeit`); await page.getByRole('button', { name: /^Wandering Medic,/ }).click();
                await page.getByRole('button', { name: 'Emergency Forfeit Run', exact: true }).click();
                await page.getByRole('alertdialog', { name: 'Emergency Forfeit', exact: true }).waitFor();
                assert.equal(await page.locator('.hg-event-dialog').evaluate(el => el.open), false, 'encounter yields to the real game confirmation');
                await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('dialog').waitFor();
                await page.evaluate(() => window.dispatchEvent(new Event('qa-session-expired')));
                await page.getByRole('dialog', { name: 'Session timed out', exact: true }).waitFor();
                assert.equal(await page.locator('.hg-event-dialog').evaluate(el => el.open), false, 'encounter yields to reauthentication');
                await page.locator('input[type="password"]').fill('qa-password');
                await page.getByRole('button', { name: /Continue/ }).click(); await page.locator('.hg-event-dialog[open]').waitFor();
                await page.getByRole('button', { name: 'Emergency Forfeit Run', exact: true }).click();
                await page.getByRole('button', { name: 'Forfeit Run', exact: true }).click(); await page.getByRole('heading', { name: 'Returned to sector' }).waitFor();
                checks.push({ engine: engineName, emergencyForfeit: true, nativeModalYield: true, reauth: true }); await page.close();
            }
            for (const query of ['?floor=5&bossIntro', '?floor=1&intro']) {
                const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); watch(page);
                await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                await page.goto(url + query); await page.getByRole('dialog').waitFor();
                const before = await page.locator('body').getAttribute('data-tile');
                for (let n = 0; n < 7; n++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => !!document.activeElement?.closest('dialog'))); }
                await page.keyboard.press('d'); assert.equal(await page.locator('body').getAttribute('data-tile'), before);
                await page.screenshot({ path: `${output}/${engineName}-${query.includes('bossIntro') ? 'alpha-intro' : 'shrine-intro'}-390.png` });
                checks.push({ engine: engineName, intro: query, focusContainment: true, noBackgroundMovement: true }); await page.close();
            }
            for (const npc of ['medic', 'keeper']) {
                const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); watch(page);
                let attempts = 0, release;
                await page.route('**/api/**', async route => {
                    if (!route.request().url().endsWith('/event')) return route.fulfill({ json: { ok: true } });
                    if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'The gift is still sealed. Please try again.' } });
                    await new Promise(resolve => { release = resolve; });
                    return route.fulfill({ json: { ok: true, runState: { keys: 0, torch: 10, threat: 0, secondWindArmed: false } } });
                });
                await page.goto(`${url}?floor=2&npc=${npc}`);
                const actor = page.getByRole('button', { name: npc === 'keeper' ? /^Shrine Keeper,/ : /^Wandering Medic,/ });
                await actor.click(); await page.getByRole('dialog').waitFor();
                if (npc === 'medic') {
                    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
                    assert.equal(attempts, 0, 'dismissal consumes no gift'); await actor.click();
                }
                const before = await page.locator('body').getAttribute('data-tile');
                for (let n = 0; n < 7; n++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => !!document.activeElement?.closest('dialog'))); }
                await page.keyboard.press('d'); assert.equal(await page.locator('body').getAttribute('data-tile'), before, 'dialog gates background movement');
                const choice = page.getByRole('button', { name: npc === 'keeper' ? 'Restore HP (33% of max)' : 'Accept healing', exact: true });
                await choice.click(); await page.getByRole('alert').waitFor(); assert.equal(await choice.isEnabled(), true);
                await choice.click(); await page.getByRole('status').waitFor(); assert.equal(await choice.isDisabled(), true);
                await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1, 'pending gift remains visible');
                await page.screenshot({ path: `${output}/${engineName}-${npc}-pending-gift.png` });
                release(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal(attempts, 2); assert.equal(await actor.count(), 0);
                checks.push({ engine: engineName, npc, retry: true, pending: true, focusContainment: true, noBackgroundMovement: true }); await page.close();
            }
            if (!quick) for (const room of STRONGHOLD_ROOMS) {
                const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' }); watch(page);
                const tile = (room.y + 2) * STRONGHOLD_DIMS.width + room.x + (room.id === 11 ? 2 : 3);
                await page.route('**/api/**', route => { const body = route.request().postDataJSON() ?? {}; return route.fulfill({ json: { ok: true,
                    visit: { presenceId: body.presenceId, id: `room-${room.id}`, layoutVersion: 1, sector: 12, tile, steps: 0, threat: 0, version: 1, visited: [tile] }, peers: [] } }); });
                await page.goto(`${url}?mode=stronghold`); await page.locator('.stronghold-location b').filter({ hasText: room.name }).waitFor();
                await page.waitForFunction(() => { const r = document.querySelector('.stronghold-player')?.getBoundingClientRect(); return r && r.left > 20 && r.right < innerWidth - 20 && r.top > 110 && r.bottom < innerHeight - 50; });
                await page.waitForLoadState('networkidle');
                const props = page.locator(`.underground-fixture[data-room="${room.id}"]`);
                assert((await props.count()) > 0 && (await props.count()) <= 4);
                const purposes = await props.evaluateAll(nodes => nodes.map(el => el.dataset.purpose));
                assert.equal(await page.locator('.underground-floor-feature,.underground-doorway').count(), 0, 'no oblique prop or passage stamps over a painted stronghold');
                assert.equal(await page.locator('.stronghold-tile[style*="background-image"]').count(), 0, 'legacy tile art cannot cover the room painting');
                const bayAlignment = await page.locator(`.underground-architecture-bay[data-room="${room.id}"]`).evaluateAll(bays => bays.map(bay => {
                    const cells = bay.dataset.collision.split(',').map(index => document.querySelector(`.stronghold-tile[data-tile="${index}"]`)?.getBoundingClientRect());
                    if (cells.some(cell => !cell)) return false;
                    // A nested SVG's element bounds may include off-viewport
                    // image content. Measure its clipped viewport in screen
                    // coordinates, which is the actual painted ground region.
                    const view = bay.viewBox.baseVal, matrix = bay.getScreenCTM();
                    const start = new DOMPoint(view.x, view.y).matrixTransform(matrix);
                    const end = new DOMPoint(view.x + view.width, view.y + view.height).matrixTransform(matrix);
                    const bounds = { left: start.x, top: start.y, right: end.x, bottom: end.y };
                    if (bay.getAttribute('overflow') !== 'hidden') return false;
                    return Math.abs(bounds.left - Math.min(...cells.map(c => c.left))) < 1
                        && Math.abs(bounds.right - Math.max(...cells.map(c => c.right))) < 1
                        && Math.abs(bounds.top - cells[0].top) < 1 && Math.abs(bounds.bottom - cells[0].bottom) < 1;
                }));
                assert(bayAlignment.length > 0 && bayAlignment.every(Boolean), 'painted architecture exactly matches the authoritative collision cells');
                await page.screenshot({ path: `${output}/${engineName}-room-${room.id}.png` });
                checks.push({ engine: engineName, room: room.name, purposes, collisionArtAligned: true, noLegacyOverlays: true }); await page.close();
            }
            {
                const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
                watch(page);
                await page.route('**/api/**', route => {
                    const body = route.request().postDataJSON() ?? {};
                    return route.fulfill({ json: { ok: true, visit: { presenceId: body.presenceId, id: 'vault-qa', layoutVersion: 1, sector: 12, tile: 697, steps: 0, threat: 0, version: 1, visited: [697, 698] }, peers: [] } });
                });
                await page.goto(`${url}?mode=stronghold`);
                await page.locator('.stronghold-anbu-station').waitFor();
                await page.waitForFunction(() => { const r = document.querySelector('.stronghold-anbu-station')?.getBoundingClientRect(); return r && r.left > 20 && r.right < innerWidth - 20 && r.top > 110 && r.bottom < innerHeight - 50; });
                assert.equal(await page.locator('.stronghold-anbu').evaluate(img => img.complete && img.naturalWidth > 0), true);
                await page.screenshot({ path: `${output}/${engineName}-anbu-treasury.png` });
                await page.getByRole('button', { name: 'View full map', exact: true }).click();
                assert.equal(await page.locator('.stronghold-anbu-station').evaluate(el => el.style.width), await page.locator('.stronghold-player').evaluate(el => el.style.width));
                await page.getByRole('button', { name: 'Follow player', exact: true }).click();
                await page.getByRole('button', { name: 'Move right', exact: true }).click();
                await page.waitForFunction(() => document.body.dataset.challenge === 'true');
                checks.push({ engine: engineName, vault: true, raidTrigger: true }); await page.close();
            }
            }
            for (const floor of (depthsOnly ? [1, 2, 3, 4, 5] : quick && !mobile ? [] : [1, 3, 4, 5])) for (const viewport of (mobile
                ? [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]
                : [{ width: 1366, height: 900 }])) {
                const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
                watch(page);
                await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
                await page.goto(`${url}?floor=${floor}&explored${mobile && floor === 2 ? '&shards=123456789&keys=12000&ryo=80000&risk' : ''}`);
                await page.locator('.underground-terrain').waitFor();
                await page.screenshot({ path: `${output}/${engineName}-depth-${floor}${mobile ? `-${viewport.width}` : ''}.png` });
                let playfield;
                if (mobile) {
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `depth ${floor} overflows horizontally`);
                    playfield = await page.locator('.hg-viewport').boundingBox();
                    assert(playfield && playfield.height >= (viewport.width < 400 && viewport.height < 700 ? 250 : 140), `depth ${floor} reserves a usable mobile playfield`);
                    for (const button of await page.getByRole('button', { name: /^Move / }).all()) {
                        const box = await button.boundingBox();
                        assert(box && box.width >= 44 && box.height >= 44 && box.y >= 0 && box.y + box.height <= viewport.height + 1, `depth ${floor} at ${viewport.width}×${viewport.height} keeps touch movement on screen: ${JSON.stringify(box)}`);
                    }
                    const lore = await page.locator('.hg-floor-notes summary').boundingBox();
                    if (viewport.width < 620) assert(lore && lore.height >= 44, 'mobile lore remains a full touch target');
                }
                checks.push({ engine: engineName, floor, viewport, playfield, palette: await page.locator('.underground-world').evaluate(el => getComputedStyle(el).getPropertyValue('--under-floor')) });
                await page.close();
            }
        } finally { await browser.close(); }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(assetErrors, []);
    await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, assetErrors, performanceSamples }, null, 2));
    console.log(`${checks.length} underground browser checks passed; screenshots: ${output}`);
} finally { await new Promise(ok => server.close(ok)); }
