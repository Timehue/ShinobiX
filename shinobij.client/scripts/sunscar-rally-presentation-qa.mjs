import { chromium, expect as baseExpect } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Gait review deliberately freezes the world. It replaces only the source
// atlas cell in this browser; production simulation and artwork stay intact.
const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-presentation-qa/', import.meta.url);
const expect = baseExpect.configure({ timeout: 45000 });
const report = { errors: [], checks: [], frames: [], modelDownloads: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl'] });
process.once('SIGINT', () => { void browser.close(); });

const install = () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    localStorage.removeItem('petRally.render.v1');
    const raf = requestAnimationFrame, caf = cancelAnimationFrame, pending = new Set();
    window.requestAnimationFrame = callback => {
        const id = raf(time => { pending.delete(id); callback(time); }); pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); caf(id); };
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    const beginPath = CanvasRenderingContext2D.prototype.beginPath;
    const ellipse = CanvasRenderingContext2D.prototype.ellipse;
    const fill = CanvasRenderingContext2D.prototype.fill;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    let phase = null, record = null, currentEllipse = null, shadow = null;
    const isCourse = canvas => !!canvas.closest('.rally-economy-surface');
    CanvasRenderingContext2D.prototype.fillRect = function(x, y, width, height) {
        if (isCourse(this.canvas)) {
            if (x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
                record = { width, height, hazards: [], sprites: [], texts: [] };
                shadow = null; currentEllipse = null;
            } else if (record && ['#cf9c45', '#b35c55', '#529c78'].includes(this.fillStyle)) {
                record.hazards.push({ x, y, width, height, color: this.fillStyle });
            }
        }
        return fillRect.call(this, x, y, width, height);
    };
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (isCourse(this.canvas) && record) record.texts.push(String(text));
        return fillText.call(this, text, ...args);
    };
    CanvasRenderingContext2D.prototype.beginPath = function(...args) {
        if (isCourse(this.canvas)) currentEllipse = null;
        return beginPath.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.ellipse = function(x, y, ...args) {
        if (isCourse(this.canvas)) currentEllipse = { x, y };
        return ellipse.call(this, x, y, ...args);
    };
    CanvasRenderingContext2D.prototype.fill = function(...args) {
        if (isCourse(this.canvas) && currentEllipse && this.fillStyle === '#382c25') {
            shadow = { ...currentEllipse, player: false };
        }
        return fill.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.stroke = function(...args) {
        if (isCourse(this.canvas) && currentEllipse && shadow && this.strokeStyle === '#fff0a6') shadow.player = true;
        return stroke.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
        const height = source.naturalHeight || source.height, width = source.naturalWidth || source.width;
        if (isCourse(this.canvas) && record && args.length === 8 && width === height * 6) {
            if (phase !== null) args[0] = phase * height;
            record.sprites.push({ cell: args[0] / height, x: args[4], y: args[5], width: args[6], height: args[7], shadow: shadow && { ...shadow } });
        }
        return drawImage.call(this, source, ...args);
    };
    window.rallyPresentationPhase = value => { phase = value; };
    window.rallyPresentationSnapshot = () => {
        const qa = window.sunscarRallyQa, canvas = document.querySelector('.rally-economy-surface canvas');
        return qa && record && canvas ? {
            ...structuredClone(record), tick: qa.state.tick, frameCount: qa.frameCount,
            distances: qa.state.racers.map(racer => racer.distance), jumps: qa.state.racers.map(racer => racer.jump),
            labels: qa.labels.map(label => label.id),
            image: canvas.toDataURL('image/png'), pendingFrames: pending.size,
        } : null;
    };
    window.rallyPresentationPending = () => pending.size;
};

try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'no-preference' });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => { if (/\.glb(?:\?|$)|\/RallyCanvas-/.test(request.url())) report.modelDownloads.push(request.url()); });
    await page.addInitScript(install);
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch(), data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice') {
            data.practice.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 0,
                distance: [40, 48, 62, 84][i], lane: [0, 0, 1, -1][i], targetLane: [0, 0, 1, -1][i], motion: 'ready' }));
        }
        await route.fulfill({ response, json: data });
    });
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy' && window.sunscarRallyQa.spriteCount === 4);
    await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
    await page.waitForFunction(() => { const race = window.sunscarRallyQa?.state; return race?.tick > 60 && race.racers[0].jump === 0 && race.racers[0].landing === 0; });
    const running = await page.evaluate(() => window.rallyPresentationSnapshot());
    assert.equal(running.sprites.length, 4, 'all four pets remain visible');
    assert.deepEqual(running.labels, ['player'], 'only the player has a course nameplate');
    assert.equal(running.texts.filter(text => text === 'YOU').length, 1, 'one YOU marker is painted');
    assert.ok(!running.texts.some(text => /Copper|Ribbon|Rook/.test(text)), 'rival names are absent from the course');
    assert.ok(running.hazards.length > 0, 'actual obstacles are visible for the stationary-world check');
    await page.screenshot({ path: fileURLToPath(new URL('running-portrait.png', out)) });
    await writeFile(new URL('running-course.png', out), Buffer.from(running.image.split(',')[1], 'base64'));
    report.checks.push('four visible companions, one YOU marker, no rival names');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await expect.poll(() => page.evaluate(() => window.rallyPresentationPending())).toBe(0);
    const frozen = await page.evaluate(() => window.rallyPresentationSnapshot());
    assert.ok(frozen.jumps.every(jump => jump === 0), 'world is paused with every pet grounded');
    const frames = [];
    for (let phase = 0; phase < 4; phase++) {
        await page.evaluate(value => window.rallyPresentationPhase(value), phase);
        let previous = await page.evaluate(() => window.sunscarRallyQa.frameCount);
        await page.setViewportSize({ width: 390, height: 845 });
        await page.waitForFunction(value => window.sunscarRallyQa.frameCount > value, previous);
        previous = await page.evaluate(() => window.sunscarRallyQa.frameCount);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(value => window.sunscarRallyQa.frameCount > value, previous);
        await expect.poll(() => page.evaluate(() => window.rallyPresentationPending())).toBe(0);
        const frame = await page.evaluate(() => window.rallyPresentationSnapshot());
        assert.equal(frame.tick, frozen.tick, `phase ${phase}: simulation tick remains frozen`);
        assert.deepEqual(frame.distances, frozen.distances, `phase ${phase}: every world distance remains frozen`);
        assert.deepEqual(frame.hazards, frozen.hazards, `phase ${phase}: actual obstacle rectangles do not move`);
        assert.equal(frame.width, frozen.width); assert.equal(frame.height, frozen.height);
        assert.deepEqual(frame.labels, ['player']);
        assert.ok(frame.sprites.every(sprite => sprite.cell === phase), `phase ${phase}: all four atlas crops use the requested review cell`);
        const player = frame.sprites.find(sprite => sprite.shadow?.player);
        assert.ok(player, `phase ${phase}: player contact shadow is observed`);
        assert.ok(Math.abs(player.shadow.y - (player.y + player.height * .92) - 1) < .001, `phase ${phase}: 92% sole anchor stays on the road`);
        const png = Buffer.from(frame.image.split(',')[1], 'base64'); frames.push(png);
        await writeFile(new URL(`stationary-phase-${phase}.png`, out), png);
        const { image, ...geometry } = frame; void image;
        report.frames.push(geometry);
    }
    assert.ok(frames.some(frame => !frame.equals(frames[0])), 'gait images visibly change while the world remains frozen');
    const { width, height } = report.frames[0];
    report.stationaryObstaclePixels = [];
    for (const [index, obstacle] of frozen.hazards.entries()) {
        const left = Math.max(0, Math.floor(obstacle.x)), top = Math.max(0, Math.floor(obstacle.y));
        const rect = { left, top, width: Math.min(width, Math.ceil(obstacle.x + obstacle.width)) - left,
            height: Math.min(height, Math.ceil(obstacle.y + obstacle.height)) - top };
        const patches = await Promise.all(frames.map(frame => sharp(frame).extract(rect).removeAlpha().raw().toBuffer()));
        assert.ok(patches.every(patch => patch.equals(patches[0])), `obstacle ${index}: every painted pixel is identical across gait phases`);
        report.stationaryObstaclePixels.push({ index, rect, pixelsCompared: rect.width * rect.height, allPhasesIdentical: true });
    }
    const pixels = await sharp({ create: { width, height: height * frames.length, channels: 4, background: '#1b252b' } })
        .composite(frames.map((input, i) => ({ input, left: 0, top: height * i }))).raw().toBuffer();
    await sharp(pixels, { raw: { width, height: height * frames.length, channels: 4, pageHeight: height } })
        .gif({ loop: 0, delay: Array(4).fill(150) }).toFile(fileURLToPath(new URL('stationary-running.gif', out)));
    await mkdir(new URL('../../.tmp/rally-direction-qa/', import.meta.url), { recursive: true });
    await copyFile(new URL('stationary-running.gif', out), new URL('../../.tmp/rally-direction-qa/grounded-running.gif', import.meta.url));
    report.checks.push('all four gait phases preserve simulation tick, world distances, canvas size, obstacle paint rectangles and pixels, and grounded sole anchor',
        'stationary-world gait GIF replaces the misleading stitched gameplay loop');
    assert.deepEqual(report.modelDownloads, [], 'economy review does not download GLB models');
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
    await expect(page.locator('.rally-economy-surface canvas')).toHaveCount(0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    await expect.poll(() => page.evaluate(() => window.rallyPresentationPending())).toBe(0);
    report.checks.push('race exit removes course canvas, QA state, and animation callbacks');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ errors: report.errors, checks: report.checks, frozenTick: frozen.tick,
        worldDistances: frozen.distances, stationaryObstacles: frozen.hazards.length, phases: report.frames.length }, null, 2));
} catch (error) {
    report.errors.push(error.stack || error.message); process.exitCode = 1;
    console.error(error);
} finally {
    await browser.close();
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
}
