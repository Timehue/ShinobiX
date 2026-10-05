import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const shotOnly = process.argv.includes('--shot-only');
const out = new URL(shotOnly ? '../../.tmp/rally-performance-qa/shot/' : '../../.tmp/rally-performance-qa/', import.meta.url);
const expect = baseExpect.configure({ timeout: 45000 });
const report = { environment: 'Desktop Chromium, CDP 4x CPU slowdown, 4 cores/2 GB hints, no WebGL, DPR 3; not a physical phone. Canvas CPU timing runs from first background fill through final context restore, includes hook overhead, and excludes QA state cloning/GPU completion.', errors: [], failures: [], courses: [], labels: [], cleanup: [] };
await mkdir(out, { recursive: true });
const tracks = [
    { id: 'grand-circuit', name: 'Sunscar Grand Circuit' }, { id: 'scorpions-spine', name: "Scorpion's Spine" },
    { id: 'burning-dunes', name: 'Burning Dunes' }, { id: 'caravan-clash', name: 'Caravan Clash' },
];
let page, scenario = 'performance';
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
const distribution = values => ({ samples: values.length, median: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: Math.max(0, ...values) });
const install = () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    localStorage.removeItem('petRally.render.v1');
    const raf = requestAnimationFrame, caf = cancelAnimationFrame, frames = new Set(), bitmapRecords = new WeakMap(), images = [], knownImages = new WeakSet();
    let bitmapCreated = 0, bitmapClosed = 0, imageCreated = 0, imageReleased = 0;
    const glAttempts = [], draws = [], geometries = [], paint = new WeakMap();
    let measuring = false, inspect = true, lastPublication = 0, lastGeometry = null;
    window.requestAnimationFrame = callback => { const id = raf(time => { frames.delete(id); callback(time); }); frames.add(id); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); caf(id); };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (/webgl/i.test(type)) { if (document.querySelector('.rally-stage')) glAttempts.push(type); return null; }
        return getContext.call(this, type, ...args);
    };
    const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src'), NativeImage = Image;
    window.Image = function(...args) {
        const image = new NativeImage(...args);
        Object.defineProperty(image, 'src', { get() { return imageSource.get.call(this); }, set(value) {
            if (/\/pet-rally\//.test(String(value)) && !knownImages.has(this)) { knownImages.add(this); imageCreated++; images.push(new WeakRef(this)); }
            imageSource.set.call(this, value);
        } });
        return image;
    };
    window.Image.prototype = NativeImage.prototype;
    const removeAttribute = HTMLImageElement.prototype.removeAttribute;
    HTMLImageElement.prototype.removeAttribute = function(name) {
        if (name === 'src' && knownImages.has(this) && this.hasAttribute('src')) imageReleased++;
        return removeAttribute.call(this, name);
    };
    const bitmap = createImageBitmap, close = ImageBitmap.prototype.close;
    window.createImageBitmap = async (source, ...args) => {
        const result = await bitmap(source, ...args);
        if (source instanceof HTMLImageElement && /\/pet-rally\//.test(source.currentSrc || source.src)) { bitmapRecords.set(result, { closed: false }); bitmapCreated++; }
        return result;
    };
    ImageBitmap.prototype.close = function() { const record = bitmapRecords.get(this); if (record && !record.closed) { bitmapClosed++; record.closed = true; } return close.call(this); };
    const fill = CanvasRenderingContext2D.prototype.fillRect, sprite = CanvasRenderingContext2D.prototype.drawImage, text = CanvasRenderingContext2D.prototype.fillText;
    const measureText = CanvasRenderingContext2D.prototype.measureText, restore = CanvasRenderingContext2D.prototype.restore;
    const beginPath = CanvasRenderingContext2D.prototype.beginPath, arc = CanvasRenderingContext2D.prototype.arc, fillPath = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fillRect = function(x, y, width, height) {
        if (this.canvas.closest('.rally-economy-surface') && x === 0 && y === 0 && width === this.canvas.width && height === this.canvas.height) {
            const canvas = this.canvas;
            const record = { start: performance.now(), end: 0, sequence: 0, sprites: [], texts: [], annotations: [], hazards: [], plates: [], circles: [], arc: null };
            paint.set(canvas, record);
            queueMicrotask(() => {
                const value = window.sunscarRallyQa, published = performance.now();
                if (!value || !canvas.isConnected || !record.end) return;
                if (measuring && draws.length < 1000) {
                    draws.push({ cpu: record.end - record.start, interval: lastPublication ? published - lastPublication : null, tick: value.state.tick, time: published });
                    lastPublication = published;
                }
                if (inspect) {
                    lastGeometry = { tick: value.state.tick, width: canvas.width, height: canvas.height, labels: structuredClone(value.labels ?? []),
                        blockers: structuredClone(value.labelBlockers ?? []), sprites: record.sprites, texts: record.texts, plates: record.plates,
                        annotations: record.annotations, hazards: record.hazards, circles: record.circles, shots: structuredClone(value.state.shots),
                        names: Object.fromEntries(value.state.racers.map(racer => [racer.id, racer.id === 'player' ? 'YOU' : racer.pet.name])),
                        playerJump: value.state.racers[0].jump, finished: value.state.finished, widthOnlyMetrics: !!window.rallyPerformanceWidthOnly };
                    if (geometries.length < 400) geometries.push(lastGeometry);
                }
            });
        }
        const record = paint.get(this.canvas);
        // Chromium may serialize the eight-digit plate color as rgba().
        // Match its actual painted rectangle to the published plate geometry.
        if (inspect && record && width < this.canvas.width * .9 && height < this.canvas.height * .4)
            record.plates.push({ x, y, width, height, color: this.fillStyle, sequence: ++record.sequence });
        if (inspect && record && ['#529c78', '#cf9c45', '#b35c55'].includes(this.fillStyle)) record.hazards.push({ x, y, width, height, sequence: ++record.sequence });
        return fill.call(this, x, y, width, height);
    };
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
        const record = paint.get(this.canvas);
        if (inspect && record && args.length === 8) record.sprites.push({ x: args[4], y: args[5], width: args[6], height: args[7], sequence: ++record.sequence });
        return sprite.call(this, source, ...args);
    };
    CanvasRenderingContext2D.prototype.beginPath = function(...args) {
        const record = paint.get(this.canvas); if (record) record.arc = null;
        return beginPath.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, ...args) {
        const record = paint.get(this.canvas); if (inspect && record) record.arc = { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
        return arc.call(this, x, y, radius, ...args);
    };
    CanvasRenderingContext2D.prototype.fill = function(...args) {
        const record = paint.get(this.canvas);
        if (inspect && record?.arc) record.circles.push({ ...record.arc, color: this.fillStyle, sequence: ++record.sequence });
        return fillPath.call(this, ...args);
    };
    CanvasRenderingContext2D.prototype.fillText = function(value, x, y, ...args) {
        const record = paint.get(this.canvas);
        if (inspect && record) {
            // Detailed QA glyph bounds remain available when the renderer's
            // measureText API is deliberately reduced to width-only below.
            const metrics = measureText.call(this, String(value));
            const scale = args[0] && metrics.width > args[0] ? args[0] / metrics.width : 1;
            const bounds = { text: String(value), x: x - metrics.actualBoundingBoxLeft * scale, y: y - metrics.actualBoundingBoxAscent,
                width: (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * scale, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
                sequence: ++record.sequence };
            if (/^(↑|⌃|×|FINISH)$/.test(String(value))) record.annotations.push(bounds);
            else record.texts.push(bounds);
        }
        return text.call(this, value, x, y, ...args);
    };
    CanvasRenderingContext2D.prototype.restore = function(...args) {
        const result = restore.call(this, ...args), record = paint.get(this.canvas);
        if (record) record.end = performance.now();
        return result;
    };
    window.rallyPerformanceArm = () => { lastGeometry = null; inspect = true; measuring = false; };
    window.rallyPerformanceStart = () => { draws.length = 0; inspect = false; measuring = true; lastPublication = 0; };
    window.rallyPerformanceStop = () => { measuring = false; inspect = true; lastGeometry = null; return structuredClone(draws); };
    window.rallyPerformanceGeometry = () => structuredClone(lastGeometry);
    window.rallyPerformanceResources = () => ({ frames: frames.size, canvas: document.querySelectorAll('.rally-stage canvas').length, qa: !!window.sunscarRallyQa,
        liveBitmaps: bitmapCreated - bitmapClosed, bitmapCreated, bitmapClosed, imageCreated, imageReleased,
        activeImages: images.filter(ref => ref.deref()?.hasAttribute('src')).length, glAttempts: [...glAttempts], locked: document.body.classList.contains('ui-scroll-locked') });
};
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl'] });
process.once('SIGINT', () => { void browser.close(); });
const overlaps = (a, b) => a.x < b.x + b.width - .5 && a.x + a.width > b.x + .5 && a.y < b.y + b.height - .5 && a.y + a.height > b.y + .5;
const inspectLabels = async name => {
    await page.waitForFunction(() => {
        const geometry = window.rallyPerformanceGeometry(), canvas = document.querySelector('.rally-economy-surface canvas'), bounds = canvas?.getBoundingClientRect();
        return geometry && bounds && Math.abs(geometry.width - bounds.width) <= 1 && Math.abs(geometry.height - bounds.height) <= 1;
    });
    const geometry = await page.evaluate(() => window.rallyPerformanceGeometry()), failures = [];
    for (const label of geometry.labels) {
        if (label.x < 0 || label.y < 0 || label.x + label.width > geometry.width + .5 || label.y + label.height > geometry.height + .5) failures.push(`${label.id} outside canvas`);
        if (geometry.blockers.some(blocker => overlaps(label, blocker))) failures.push(`${label.id} covers pet/hazard/shot`);
        if (geometry.sprites.some(sprite => overlaps(label, sprite))) failures.push(`${label.id} actual plate covers sprite`);
        if (geometry.annotations.some(annotation => overlaps(label, annotation))) failures.push(`${label.id} actual plate covers hazard/finish glyph`);
        if (geometry.hazards.some(hazard => overlaps(label, hazard))) failures.push(`${label.id} actual plate covers hazard rectangle`);
        if (geometry.circles.some(circle => overlaps(label, circle))) failures.push(`${label.id} actual plate covers projectile circle`);
        if (geometry.labels.some(other => other.id !== label.id && overlaps(label, other))) failures.push(`${label.id} overlaps another label`);
        const text = geometry.texts.find(text => text.text === geometry.names[label.id]);
        const plate = geometry.plates.find(plate => Math.abs(plate.x - label.x) < .5 && Math.abs(plate.y - label.y) < .5);
        if (!plate || !text) failures.push(`${label.id} has no actual painted plate/text`);
        if (text && (text.x < label.x - 1 || text.y < label.y - 1 || text.x + text.width > label.x + label.width + 1 || text.y + text.height > label.y + label.height + 1)) failures.push(`${label.id} actual glyph exceeds plate`);
        if (text && geometry.sprites.some(sprite => text.sequence < sprite.sequence)) failures.push(`${label.id} painted before sprites`);
    }
    for (const text of geometry.texts) if (geometry.sprites.some(sprite => overlaps(text, sprite))) failures.push(`${text.text} actual glyphs cover sprite`);
    for (const annotation of geometry.annotations) {
        if (!geometry.blockers.some(blocker => blocker.x <= annotation.x + .5 && blocker.y <= annotation.y + .5
            && blocker.x + blocker.width >= annotation.x + annotation.width - .5 && blocker.y + blocker.height >= annotation.y + annotation.height - .5))
            failures.push(`${annotation.text} actual glyphs are outside the protected bounds`);
    }
    for (const hazard of geometry.hazards) {
        if (!geometry.blockers.some(blocker => Math.abs(blocker.x - hazard.x) < .5 && Math.abs(blocker.y - hazard.y) < .5
            && Math.abs(blocker.width - hazard.width) < .5 && Math.abs(blocker.height - hazard.height) < .5))
            failures.push('actual hazard rectangle has no protected bounds');
    }
    if (name.startsWith('finish-') && (!geometry.widthOnlyMetrics || !geometry.annotations.some(annotation => annotation.text === 'FINISH')))
        failures.push('width-only FINISH glyph case was not exercised');
    if (name.startsWith('projectile-')) {
        if (!geometry.shots.length || !geometry.circles.length || geometry.circles.length !== geometry.shots.length)
            failures.push('actual active projectile circle case was not exercised');
        for (const circle of geometry.circles) if (!geometry.blockers.some(blocker => Math.abs(blocker.x - circle.x) < .5 && Math.abs(blocker.y - circle.y) < .5
            && Math.abs(blocker.width - circle.width) < .5 && Math.abs(blocker.height - circle.height) < .5))
            failures.push('actual projectile circle has no protected bounds');
    }
    if (geometry.labels.length !== 1 || geometry.labels[0].id !== 'player') failures.push('course must show only the YOU marker');
    if (geometry.texts.some(label => label.text !== 'YOU')) failures.push('persistent rival course name was painted');
    if (scenario !== 'performance') {
        if (geometry.sprites.length !== 4) failures.push(`fixture shows ${geometry.sprites.length} sprites instead of four`);
        if (!geometry.texts.some(label => label.text === 'YOU')) failures.push('YOU marker was not painted');
    }
    const hud = await page.evaluate(() => {
        const course = document.querySelector('.rally-stage').getBoundingClientRect();
        return [...document.querySelectorAll('.rally-hud,.rally-dashboard,.rally-controls')].some(element => { const r = element.getBoundingClientRect(); return r.left < course.right - .5 && r.right > course.left + .5 && r.top < course.bottom - .5 && r.bottom > course.top + .5; });
    });
    if (hud) failures.push('HUD overlaps course');
    report.labels.push({ name, ...geometry, failures }); report.failures.push(...failures.map(failure => `${name}: ${failure}`));
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
    console.log(JSON.stringify({ labels: name, count: geometry.labels.length, width: geometry.width, failures }));
};
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'no-preference' });
    page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(install);
    const modelDownloads = []; page.on('request', request => { if (/\.glb(?:\?|$)|\/RallyCanvas-/.test(request.url())) modelDownloads.push(request.url()); });
    await page.route('**/api/festival/rally', async route => {
        const response = await route.fetch(), data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice' && scenario !== 'performance') {
            const race = data.practice;
            race.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 0, distance: (shotOnly ? [40, 70, 82, 102] : [40, 38, 62, 84])[i], lane: [0, 0, 1, -1][i], targetLane: [0, 0, 1, -1][i], motion: 'ready' }));
            race.racers[0].attackCharge = 100;
            // Keep every prefinish companion inside the deliberate -12m
            // rear-view cutoff so the strict four-label fixture is valid.
            if (scenario === 'finish') { race.tick = 3600; race.racers.forEach((racer, i) => Object.assign(racer, { distance: 1020 - [20, 10, 24, 28][i], speed: 20 })); }
        }
        await route.fulfill({ response, json: data });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Performance.enable');
    await page.request.post(`${base}/__qa/reset`); await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    let warmHeap = 0;
    for (let cycle = shotOnly ? 4 : 0; cycle < (shotOnly ? 5 : 8); cycle++) {
        scenario = cycle < 4 ? 'performance' : cycle === 6 ? 'finish' : 'labels';
        const viewport = cycle === 4 || cycle === 6 ? { width: 320, height: 568 } : cycle >= 5 ? { width: 568, height: 320 } : { width: 390, height: 844 };
        await page.setViewportSize(viewport);
        if (cycle === 6) await page.evaluate(() => {
            const native = CanvasRenderingContext2D.prototype.measureText;
            CanvasRenderingContext2D.prototype.measureText = function(text) { return { width: native.call(this, text).width }; };
            window.rallyPerformanceWidthOnly = true;
        });
        if (cycle === 7) await page.evaluate(() => { window.createImageBitmap = undefined; });
        await page.locator('.rally-course-card').filter({ has: page.getByText(cycle < 4 ? tracks[cycle].name : tracks[0].name, { exact: true }) }).click();
        await page.evaluate(() => window.rallyPerformanceArm());
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
        await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy' && window.sunscarRallyQa.spriteCount === 4);
        if (cycle >= 4) await inspectLabels(`cycle-${cycle + 1}-ready`);
        await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
        await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 60);
        if (cycle < 4) {
            await page.evaluate(() => window.rallyPerformanceStart());
            const before = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, time: performance.now() }));
            await page.waitForTimeout(3000);
            const after = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, time: performance.now() }));
            const draws = await page.evaluate(() => window.rallyPerformanceStop());
            const elapsed = (after.time - before.time) / 1000, simulated = (after.tick - before.tick) / 60;
            const metric = { track: tracks[cycle].id, elapsed, simulated, clockDriftMs: (simulated - elapsed) * 1000, fps: draws.length / elapsed,
                drawCpuMs: distribution(draws.map(draw => draw.cpu)), paintIntervalMs: distribution(draws.map(draw => draw.interval).filter(value => value !== null)), draws };
            assert.ok(draws.length >= 15, 'CPU timing contains real drawn-frame samples');
            report.courses.push(metric); assert.ok(Math.abs(simulated - elapsed) < .45, 'simulation clock follows wall time under desktop4x CPU throttle');
            console.log(JSON.stringify({ track: metric.track, fps: metric.fps, clockDriftMs: metric.clockDriftMs, drawCpuMs: metric.drawCpuMs, paintIntervalMs: metric.paintIntervalMs }));
        }
        if (shotOnly) {
            await page.keyboard.press('KeyQ');
            await page.waitForFunction(() => { const geometry = window.rallyPerformanceGeometry(); return geometry?.shots.length > 0 && geometry.circles.length > 0; });
            await inspectLabels('projectile-portrait302');
        } else await inspectLabels(`cycle-${cycle + 1}-running`);
        if (!shotOnly && cycle >= 4 && cycle !== 6) {
            await page.waitForFunction(() => { const p = window.sunscarRallyQa?.state.racers[0]; return p && !p.stagger && !p.jumpCooldown; });
            await page.getByRole('button', { name: 'Jump, right trigger or Space' }).click();
            await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].jump > .1); await inspectLabels(`cycle-${cycle + 1}-jump`);
            await page.getByRole('button', { name: 'Steer right, left stick, D or Right Arrow' }).click();
            await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].targetLane === 1); await page.keyboard.press('KeyQ');
            await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].shotsFired === 1);
        }
        if (cycle === 6) {
            await page.waitForFunction(() => window.sunscarRallyQa?.state.finished);
            await inspectLabels('finish-portrait302'); await page.setViewportSize({ width: 568, height: 320 }); await inspectLabels('finish-landscape320');
            await expect.poll(() => page.evaluate(() => window.rallyPerformanceResources().frames)).toBe(0);
            await page.getByRole('button', { name: 'Return to the race desk' }).click();
        } else {
            await page.getByRole('button', { name: 'Pause race' }).click(); await page.waitForTimeout(300);
            const frozen = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount }));
            await page.waitForTimeout(300);
            assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount })), frozen, 'pause sleeps draw and simulation');
            await page.getByRole('button', { name: 'Save & return' }).click();
        }
        await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled(); await page.waitForTimeout(350);
        const resource = await page.evaluate(() => window.rallyPerformanceResources()); report.cleanup.push({ cycle: cycle + 1, ...resource });
        assert.equal(resource.frames, 0); assert.equal(resource.canvas, 0); assert.equal(resource.liveBitmaps, 0); assert.equal(resource.activeImages, 0); assert.equal(resource.qa, false); assert.equal(resource.locked, false);
        assert.deepEqual(resource.glAttempts, []); console.log(JSON.stringify({ cleanup: cycle + 1, ...resource }));
        if (cycle === 1 || cycle === 7) {
            await cdp.send('HeapProfiler.collectGarbage');
            const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
            if (cycle === 1) warmHeap = metrics.JSHeapUsedSize;
            else report.heap = { afterWarmup: warmHeap, afterEightCycles: metrics.JSHeapUsedSize, growth: metrics.JSHeapUsedSize - warmHeap };
        }
    }
    assert.deepEqual(modelDownloads, []); assert.deepEqual(report.errors, []); assert.deepEqual(report.failures, []);
    if (!shotOnly) assert.ok(report.heap.growth < 5_000_000, 'eight cycles do not retain an unbounded JS heap');
    report.checks = shotOnly ? ['only the YOU marker appears and avoids the actual painted projectile circle', 'projectile painted circle exactly matches protected bounds', 'pause and exit release all sprites and stop RAF']
        : ['four-course instrumented Canvas CPU/frame intervals and sim-clock parity under desktop4x CPU throttle', 'only YOU appears in 302px portrait/320px landscape fixtures and stays outside every pet/hazard/shot', 'player marker paints after sprites and protects hazard rectangles and hazard/FINISH glyphs', 'jump/steer/shot and unoccluded HUD', 'width-only TextMetrics fallback protects actual glyph bounds', 'native Image fallback', 'eight repeated race exits release all bitmap/image sources and stop RAF', 'bounded post-warmup JS heap'];
    console.log(JSON.stringify({ checks: report.checks, errors: report.errors, failures: report.failures, cycles: report.cleanup.length, heap: report.heap }));
    await context.close();
} catch (error) {
    report.fatal = error.message;
    if (page && !page.isClosed()) { await page.screenshot({ path: fileURLToPath(new URL('failure.png', out)) }); report.last = await page.evaluate(() => ({ qa: window.sunscarRallyQa, resources: window.rallyPerformanceResources?.() })); }
    throw error;
} finally { await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2)); await browser.close(); }
