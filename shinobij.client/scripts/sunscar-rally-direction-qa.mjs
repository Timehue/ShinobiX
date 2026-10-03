import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Independent no-WebGL coverage for the rear-view raster artwork. Practice
// fixtures alter this browser's response only; official saves are untouched.
const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-direction-qa/', import.meta.url);
const preview = process.argv.includes('--preview');
const bake = JSON.parse(await readFile(new URL(`../../.tmp/rally-sprite-bake/${preview ? 'preview-report' : 'report'}.json`, import.meta.url), 'utf8'));
const contactRows = Object.fromEntries(bake.rows.map(row => [row.file, row.contacts]));
assert.ok(Object.values(contactRows).every(contacts => contacts?.length === 6), 'bake report supplies six measured contact points per atlas');
assert.ok(!preview || bake.rows.every(row => row.contacts.every(contact => contact.method === 'sole')), 'all four footed preview pets use genuine sole contacts');
const expect = baseExpect.configure({ timeout: 45000 });
const report = { errors: [], checks: [], assets: [], surfaces: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-webgl'] });
process.once('SIGINT', () => { void browser.close(); });
let page, scenario = 'play', collectAssets = false;
const capture = name => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'no-preference',
        recordVideo: { dir: fileURLToPath(new URL('video/', out)), size: { width: 390, height: 844 } } });
    page = await context.newPage(); page.setDefaultTimeout(45000);
    const motionVideo = page.video();
    page.on('pageerror', error => report.errors.push(error.message));
    const raceAssets = new Set(), failedAssets = [];
    page.on('request', request => {
        if (/\/pet-models\/|\.glb(?:\?|$)/.test(request.url()) || collectAssets && /\/pet-(?:rally|poses)\//.test(request.url())) raceAssets.add(request.url());
    });
    page.on('response', response => {
        if (collectAssets && /\/pet-rally\//.test(response.url()) && !response.ok()) failedAssets.push(`${response.status()} ${response.url()}`);
    });
    const installRasterChecks = ({ bitmapMode, contactRows }) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
        localStorage.removeItem('petRally.render.v1');
        if (bitmapMode === 'absent') Object.defineProperty(window, 'createImageBitmap', { value: undefined, configurable: true });
        if (bitmapMode === 'reject') window.createImageBitmap = async () => { throw new Error('Injected bitmap decoder failure'); };
        const webglAttempts = [], bootWebglAttempts = [], frames = new Set(), bitmaps = new WeakMap();
        window.rallyDirectionRaceActive = false;
        let created = 0, closed = 0, cropped = 0;
        const cells = {}, badCrops = [], spriteLoads = [], contacts = [], rasterContacts = {}, geometry = new WeakMap(), motionFrames = {};
        let jumpFrames = 0;
        const NativeImage = Image, imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        window.Image = function(...args) {
            const image = new NativeImage(...args);
            if (document.querySelector('.rally-economy-surface')) Object.defineProperty(image, 'src', {
                get() { return imageSource.get.call(this); },
                set(value) { spriteLoads.push(String(value)); imageSource.set.call(this, value); },
            });
            return image;
        };
        window.Image.prototype = NativeImage.prototype;
        const originalContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            if (/webgl/i.test(type)) {
                // Authentication fingerprints probe the GPU once during app
                // boot. Block that too, while measuring racing separately.
                (window.rallyDirectionRaceActive ? webglAttempts : bootWebglAttempts).push(type); return null;
            }
            return originalContext.call(this, type, ...args);
        };
        const originalFrame = requestAnimationFrame, originalCancel = cancelAnimationFrame;
        window.requestAnimationFrame = callback => {
            const id = originalFrame(time => { frames.delete(id); callback(time); }); frames.add(id); return id;
        };
        window.cancelAnimationFrame = id => { frames.delete(id); return originalCancel(id); };
        if (typeof createImageBitmap === 'function') {
            const originalBitmap = createImageBitmap, originalClose = ImageBitmap.prototype.close;
            window.createImageBitmap = async (source, ...args) => {
                const bitmap = await originalBitmap(source, ...args);
                const url = source instanceof HTMLImageElement ? source.currentSrc || source.src : '';
                if (/\/pet-rally\//.test(url)) { bitmaps.set(bitmap, { url, closed: false }); created++; }
                return bitmap;
            };
            ImageBitmap.prototype.close = function() {
                const record = bitmaps.get(this);
                if (record && !record.closed) { record.closed = true; closed++; }
                return originalClose.call(this);
            };
        }
        const originalBegin = CanvasRenderingContext2D.prototype.beginPath, originalEllipse = CanvasRenderingContext2D.prototype.ellipse;
        const originalFill = CanvasRenderingContext2D.prototype.fill, originalStroke = CanvasRenderingContext2D.prototype.stroke;
        CanvasRenderingContext2D.prototype.beginPath = function(...args) {
            if (this.canvas.closest('.rally-economy-surface')) { const record = geometry.get(this) || {}; record.ellipse = null; geometry.set(this, record); }
            return originalBegin.call(this, ...args);
        };
        CanvasRenderingContext2D.prototype.ellipse = function(x, y, rx, ry, ...args) {
            if (this.canvas.closest('.rally-economy-surface')) geometry.get(this).ellipse = { x, y, rx, ry };
            return originalEllipse.call(this, x, y, rx, ry, ...args);
        };
        CanvasRenderingContext2D.prototype.fill = function(...args) {
            const record = geometry.get(this);
            if (record?.ellipse && this.fillStyle === '#382c25') { record.shadow = { ...record.ellipse, alpha: this.globalAlpha }; record.player = false; }
            return originalFill.call(this, ...args);
        };
        CanvasRenderingContext2D.prototype.stroke = function(...args) {
            const record = geometry.get(this);
            if (record?.ellipse && this.strokeStyle === '#fff0a6') record.player = true;
            return originalStroke.call(this, ...args);
        };
        const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
            if (this.canvas.closest('.rally-economy-surface')) {
                const url = bitmaps.get(source)?.url || (source instanceof HTMLImageElement ? source.currentSrc || source.src : '');
                const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
                const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
                const cell = args[0] / height;
                if (/\/pet-rally\//.test(url) && args.length === 8 && width === height * 6 && height === (bitmapMode === 'normal' ? 128 : 192)
                    && Number.isInteger(cell) && cell >= 0 && cell <= 5 && args[1] === 0 && args[2] === height && args[3] === height) {
                    cropped++;
                    (cells[url] ??= Array(6).fill(0))[cell]++;
                    const path = new URL(url, location.href).pathname, points = contactRows[path], record = geometry.get(this);
                    if (points && record?.shadow) {
                        if (!rasterContacts[path]) {
                            const scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
                            const ctx = scratch.getContext('2d', { willReadFrequently: true }); originalDraw.call(ctx, source, 0, 0);
                            const pixels = ctx.getImageData(0, 0, width, height).data;
                            rasterContacts[path] = points.map((point, i) => {
                                const x = Math.round(point.normalized.x * height), y = Math.round(point.normalized.y * height);
                                let alpha = 0;
                                for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                                    const atX = Math.max(0, Math.min(height - 1, x + dx)) + i * height, atY = Math.max(0, Math.min(height - 1, y + dy));
                                    alpha = Math.max(alpha, pixels[(atY * width + atX) * 4 + 3]);
                                }
                                return { cell: i, method: point.method, alpha, height };
                            });
                        }
                        const point = points[cell].normalized;
                        const contact = { path, cell, player: record.player, sourceHeight: height, shadow: { ...record.shadow },
                            dest: { x: args[4], y: args[5], width: args[6], height: args[7] },
                            sole: { x: args[4] + point.x * args[6], y: args[5] + point.y * args[7] } };
                        // The renderer publishes the state at the end of this
                        // same draw. Read it after drawing, not one frame earlier.
                        queueMicrotask(() => {
                            const qa = window.sunscarRallyQa, racer = qa?.state.racers[0];
                            if (!racer) return;
                            contact.tick = qa.state.tick; contact.finished = qa.state.finished;
                            contact.racer = { jump: racer.jump, landing: racer.landing, motion: racer.motion, speed: racer.speed, finishTick: racer.finishTick };
                            contact.gap = contact.shadow.y - contact.sole.y;
                            contact.expectedLift = racer.finishTick === null ? racer.jump * Math.min(this.canvas.width * .085, 54) * .7 : 0;
                            contacts.push(contact); if (contacts.length > 1600) contacts.shift();
                            if (contact.player && !contact.finished) {
                                const label = racer.jump > .01 && jumpFrames < 24 ? `jump-${jumpFrames++}` : racer.jump === 0 && racer.landing > 0 && racer.motion === 'land' ? 'landing'
                                    : racer.jump === 0 && racer.landing === 0 ? racer.speed <= 1 ? 'ready' : `run-${cell}` : null;
                                if (label && !motionFrames[label]) {
                                    const tile = document.createElement('canvas'); tile.width = 220; tile.height = 210;
                                    const x = Math.max(0, Math.min(this.canvas.width - tile.width, contact.shadow.x - tile.width / 2));
                                    const y = Math.max(0, Math.min(this.canvas.height - tile.height, contact.shadow.y - 175));
                                    originalDraw.call(tile.getContext('2d'), this.canvas, x, y, tile.width, tile.height, 0, 0, tile.width, tile.height);
                                    motionFrames[label] = { image: tile.toDataURL('image/png'), contact };
                                }
                            }
                        });
                    }
                } else if (badCrops.length < 12) badCrops.push({ url, width, height, args });
            }
            return originalDraw.call(this, source, ...args);
        };
        window.rallyDirectionSnapshot = () => ({ webglAttempts: [...webglAttempts], bootWebglAttempts: [...bootWebglAttempts], frames: frames.size, created, closed,
            liveBitmaps: created - closed, cropped, cells: structuredClone(cells), badCrops: structuredClone(badCrops), spriteLoads: [...spriteLoads],
            contacts: structuredClone(contacts), rasterContacts: structuredClone(rasterContacts) });
        window.rallyGroundingFrames = () => structuredClone(motionFrames);
    };
    await page.addInitScript(installRasterChecks, { bitmapMode: 'normal', contactRows });
    await page.route(/\.glb(?:\?|$)/, route => route.abort());
    const practiceFixture = async route => {
        const response = await route.fetch(), data = await response.json();
        if (route.request().postDataJSON()?.action === 'practice') {
            const race = data.practice;
            race.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 0, distance: [40, 48, 62, 84][i],
                lane: [0, 0, 1, -1][i], targetLane: [0, 0, 1, -1][i], motion: 'ready' }));
            race.racers[0].attackCharge = 100;
            if (scenario === 'finish') {
                race.tick = 3600;
                race.racers.forEach((racer, i) => { racer.distance = 1020 - [20, 10, 30, 40][i]; racer.speed = 20; });
            }
        }
        await route.fulfill({ response, json: data });
    };
    await page.route('**/api/festival/rally', practiceFixture);
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    const files = (await readdir(new URL('../public/pet-rally/', import.meta.url))).filter(name => name.endsWith('.webp') && (!preview || contactRows[`/pet-rally/${name}`])).sort();
    assert.ok(preview ? files.length >= 4 : files.length === 161, `expected ${preview ? 'at least 4 preview' : '161 canonical'} atlases, found ${files.length}`);
    // A separate context checks native files without warming the race's
    // decoded-image cache or inflating its live sprite memory measurement.
    const catalogContext = await browser.newContext(), catalogPage = await catalogContext.newPage();
    await catalogPage.goto(`${base}/__qa/session`);
    report.assets = await catalogPage.evaluate(async ({ names, contactRows }) => {
        const results = [];
        const surface = document.createElement('canvas'); surface.width = 1152; surface.height = 192;
        const ctx = surface.getContext('2d', { willReadFrequently: true });
        for (const name of names) {
            const image = new Image(); image.src = `/pet-rally/${name}`;
            try {
                await image.decode(); ctx.clearRect(0, 0, 1152, 192); ctx.drawImage(image, 0, 0);
                const pixels = ctx.getImageData(0, 0, 1152, 192).data;
                const cells = Array.from({ length: 6 }, () => ({ visible: 0, border: 0 }));
                for (let y = 0; y < 192; y++) for (let x = 0; x < 1152; x++) {
                    if (pixels[(y * 1152 + x) * 4 + 3] <= 12) continue;
                    const cell = cells[Math.floor(x / 192)]; cell.visible++;
                    if (x % 192 < 2 || x % 192 >= 190 || y < 2 || y >= 190) cell.border++;
                }
                for (const [i, point] of contactRows[`/pet-rally/${name}`].entries()) {
                    let contactAlpha = 0;
                    const x = Math.round(point.pixel.x), y = Math.round(point.pixel.y);
                    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
                        const atX = Math.max(0, Math.min(191, x + dx)) + i * 192, atY = Math.max(0, Math.min(191, y + dy));
                        contactAlpha = Math.max(contactAlpha, pixels[(atY * 1152 + atX) * 4 + 3]);
                    }
                    Object.assign(cells[i], { contact: point, contactAlpha });
                }
                results.push({ name, width: image.naturalWidth, height: image.naturalHeight, cells });
            }
            catch { results.push({ name, failed: true }); }
            image.removeAttribute('src');
        }
        return results;
    }, { names: files, contactRows });
    await catalogContext.close();
    for (const asset of report.assets) {
        assert.deepEqual([asset.width, asset.height], [1152, 192], `${asset.name}: six square native cells`);
        assert.ok(asset.cells.every(cell => cell.visible > 20 && cell.visible < 192 * 192), `${asset.name}: every pose contains visible artwork and transparent space`);
        assert.ok(asset.cells.every(cell => Math.abs(cell.contact.pixel.y - .92 * 192) <= 2), `${asset.name}: every measured sole/support contact stays within 2px of the shared ground anchor`);
        assert.ok(asset.cells.every(cell => cell.contactAlpha > 12), `${asset.name}: the projected sole/support point has visible artwork nearby`);
    }
    report.edgeContact = report.assets.filter(asset => asset.cells.some(cell => cell.border > 0)).map(asset => asset.name);
    report.checks.push(`${files.length} atlas files decode as six 192px square cells`);
    report.checks.push(`${files.length * 6} visible sole/support contacts share the 92% ground anchor`);
    const prepare = async () => {
        collectAssets = true;
        await page.evaluate(() => { window.rallyDirectionRaceActive = true; });
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
        await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy' && window.sunscarRallyQa.spriteCount === 4);
        await expect.poll(() => page.evaluate(() => Object.values(window.rallyDirectionSnapshot().cells).some(cells => cells[4] > 0))).toBe(true);
    };
    const start = async () => {
        await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
        await page.waitForFunction(() => {
            const race = window.sunscarRallyQa?.state;
            return race && race.tick > (race.tick > 3000 ? 3600 : 60);
        });
    };
    await prepare();
    await capture('rear-ready-portrait');
    await start();
    await expect.poll(() => page.evaluate(() => Object.values(window.rallyDirectionSnapshot().cells).some(cells => cells.slice(0, 4).every(count => count > 0)))).toBe(true);
    await page.waitForFunction(() => [0, 1, 2, 3].every(cell => window.rallyGroundingFrames()[`run-${cell}`]));
    await capture('rear-running-portrait');
    await page.getByRole('button', { name: 'Steer right, left stick, D or Right Arrow' }).click();
    await expect.poll(() => page.evaluate(() => window.sunscarRallyQa.state.racers[0].targetLane)).toBe(1);
    await page.waitForFunction(() => { const p = window.sunscarRallyQa?.state.racers[0]; return p && p.stagger === 0 && p.jumpCooldown === 0; });
    await page.getByRole('button', { name: 'Jump, right trigger or Space' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].jump > .1);
    await capture('rear-jump-portrait');
    await page.waitForFunction(() => !!window.rallyGroundingFrames().landing);
    await page.waitForFunction(() => { const p = window.sunscarRallyQa?.state.racers[0]; return p && p.jump === 0 && p.landing === 0; });
    const groundedFrames = await page.evaluate(() => window.rallyGroundingFrames());
    const jumping = Object.entries(groundedFrames).filter(([name]) => name.startsWith('jump-')).map(([, frame]) => frame);
    assert.ok(jumping.length >= 3, 'motion capture includes airborne ascent and descent');
    const apex = jumping.reduce((highest, frame) => frame.contact.expectedLift > highest.contact.expectedLift ? frame : highest);
    const sequence = [
        ['Ready', groundedFrames.ready], ...[0, 1, 2, 3].map(cell => [`Run ${cell + 1}`, groundedFrames[`run-${cell}`]]),
        ['Jump up', jumping[0]], ['Jump apex', apex], ['Jump down', jumping.at(-1)], ['Landing', groundedFrames.landing],
    ];
    const tileWidth = 220, tileHeight = 234, overlays = [];
    report.motion = [];
    for (const [i, [label, frame]] of sequence.entries()) {
        assert.ok(frame, `${label}: course frame captured`);
        const image = Buffer.from(frame.image.split(',')[1], 'base64');
        await writeFile(new URL(`grounding-${label.toLowerCase().replaceAll(' ', '-')}.png`, out), image);
        overlays.push({ input: image, left: (i % 3) * tileWidth, top: Math.floor(i / 3) * tileHeight });
        overlays.push({ input: Buffer.from(`<svg width="220" height="24"><rect width="220" height="24" fill="#1b252b"/><text x="8" y="17" fill="white" font-family="sans-serif" font-size="13">${label} · gap ${frame.contact.gap.toFixed(1)}px</text></svg>`),
            left: (i % 3) * tileWidth, top: Math.floor(i / 3) * tileHeight + 210 });
        report.motion.push({ label, contact: frame.contact });
    }
    await sharp({ create: { width: tileWidth * 3, height: tileHeight * 3, channels: 4, background: '#1b252b' } }).composite(overlays).png().toFile(fileURLToPath(new URL('grounding-motion-strip.png', out)));
    // These contact samples come from different race ticks. Looping them snaps
    // the world backward; use the continuous video or the frozen-world gait
    // review generated by sunscar-rally-presentation-qa.mjs instead.
    await capture('rear-landed-portrait');
    const contactDraw = await page.evaluate(() => window.rallyDirectionSnapshot());
    const playerContacts = contactDraw.contacts.filter(contact => contact.player && !contact.finished);
    assert.ok(playerContacts.length > 10 && playerContacts.some(contact => contact.cell === 4) && [0, 1, 2, 3].every(cell => playerContacts.some(contact => contact.cell === cell && contact.racer.jump === 0)), 'ready and all four running contacts observed');
    assert.ok(playerContacts.every(contact => Math.abs(contact.gap - (1 + contact.expectedLift)) <= 2), 'visible sole follows the road at rest and exactly the physics jump while airborne, with no gait bob');
    assert.ok(Object.values(contactDraw.rasterContacts).flat().every(contact => contact.alpha > 12), 'resized sprites preserve visible artwork at every reported sole/support point');
    const airborne = playerContacts.filter(contact => contact.expectedLift > 2), landing = playerContacts.filter(contact => contact.racer.motion === 'land' && contact.racer.landing > 0);
    assert.ok(airborne.length >= 3 && airborne.every(contact => contact.shadow.alpha < .36), 'jump leaves a lighter road shadow below the lifted feet');
    const groundShadow = playerContacts.find(contact => contact.expectedLift === 0).shadow;
    assert.ok(airborne.every(contact => contact.shadow.rx < groundShadow.rx && contact.shadow.ry < groundShadow.ry), 'airborne contact shadows shrink with lift');
    assert.ok(landing.length && landing.every(contact => Math.abs(contact.gap - 1) <= 2), 'landing squash returns its sole to the road');
    assert.ok(landing.some(contact => contact.dest.width > contact.dest.height), 'landing capture includes actual contact-preserving squash');
    report.grounding = { samples: playerContacts.length, groundedGap: Math.max(...playerContacts.filter(contact => contact.expectedLift === 0).map(contact => Math.abs(contact.gap - 1))),
        physicsGapError: Math.max(...playerContacts.map(contact => Math.abs(contact.gap - 1 - contact.expectedLift))),
        jumpSamples: airborne.length, landingSamples: landing.length, rasterContacts: contactDraw.rasterContacts };
    report.checks.push('actual course ready/run/jump/landing contact follows the physics ground with <=2px error', 'landing squash stays anchored and airborne shadows fade', 'nine actual course frames capture grounded gait and jump/landing');
    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].shotsFired === 1);
    await page.setViewportSize({ width: 844, height: 390 });
    await capture('rear-running-landscape');
    const surface = await page.locator('.rally-economy-surface canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height,
        cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height, dpr: devicePixelRatio }));
    report.surfaces.push(surface);
    assert.equal(surface.dpr, 3); assert.ok(Math.abs(surface.width - surface.cssWidth) <= 1 && Math.abs(surface.height - surface.cssHeight) <= 1, 'high-DPR display keeps a 1x course surface');
    const draw = await page.evaluate(() => window.rallyDirectionSnapshot());
    assert.deepEqual(draw.webglAttempts, []); assert.deepEqual(draw.badCrops, []); assert.equal(draw.liveBitmaps, 4);
    assert.ok(draw.spriteLoads.length >= 4 && draw.spriteLoads.every(url => url.startsWith('/pet-rally/')), 'course image loaders exclusively request rear-view atlases');
    assert.ok(draw.liveBitmaps * 768 * 128 * 4 <= 1.5 * 1024 * 1024, 'four decoded atlas sprites fit the 1.5MiB budget');
    report.draw = draw;
    report.checks.push('automatic no-WebGL 4-core/2GB economy boot', 'square runtime crops for running cells 0–3 and rear ready cell 4', 'steer/jump/shot controls', 'DPR3 display keeps 1x canvas and <=1.5MiB sprite memory');
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.waitForTimeout(600);
    const frozen = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, draw: window.rallyDirectionSnapshot().cropped }));
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, draw: window.rallyDirectionSnapshot().cropped })), frozen, 'pause sleeps simulation and sprite drawing');
    collectAssets = false;
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.rallyDirectionSnapshot().liveBitmaps)).toBe(0);
    await expect(page.locator('.rally-economy-surface canvas')).toHaveCount(0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    scenario = 'finish';
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(); await start();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.finished);
    await expect.poll(() => page.evaluate(() => Object.values(window.rallyDirectionSnapshot().cells).some(cells => cells[5] > 0))).toBe(true);
    await capture('front-finish-portrait');
    await expect(page.locator('.rally-podium > div')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => window.rallyDirectionSnapshot().frames)).toBe(0);
    const settled = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, draw: window.rallyDirectionSnapshot().cropped }));
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount, draw: window.rallyDirectionSnapshot().cropped })), settled, 'finish presentation settles and sleeps');
    collectAssets = false;
    await page.getByRole('button', { name: 'Return to the race desk' }).click();
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.rallyDirectionSnapshot().liveBitmaps)).toBe(0);
    await page.waitForTimeout(700);
    report.cleanup = await page.evaluate(() => window.rallyDirectionSnapshot());
    assert.equal(report.cleanup.frames, 0); assert.equal(report.cleanup.liveBitmaps, 0);
    await expect(page.locator('.rally-economy-surface canvas')).toHaveCount(0);
    assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
    report.requests = [...raceAssets];
    assert.ok(report.requests.some(url => /\/pet-rally\//.test(url)), 'race requests its rear-view artwork');
    // Desk cards can lazily request their portrait poses as Practice scrolls
    // into view. Course-loader URLs and actual crops distinguish those from
    // racing artwork without weakening the all-model network prohibition.
    assert.deepEqual(report.requests.filter(url => /\/pet-models\/|\.glb(?:\?|$)/.test(url)), [], 'race never requests pet models');
    assert.ok(report.cleanup.spriteLoads.every(url => url.startsWith('/pet-rally/')), 'course never loads old side poses');
    assert.deepEqual(failedAssets, []); assert.deepEqual(report.errors, []);
    report.checks.push('paused drawing sleeps', 'front finish cell 5 and settled finish clock', 'all race artwork requests use pet-rally atlases', 'exit closes bitmap sprites and cancels RAF');
    await context.close();
    await motionVideo.saveAs(fileURLToPath(new URL('grounded-course-motion.webm', out)));
    report.imageFallbacks = [];
    scenario = 'play';
    for (const bitmapMode of ['absent', 'reject']) {
        const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
        page = await fallbackContext.newPage(); page.setDefaultTimeout(45000);
        page.on('pageerror', error => report.errors.push(error.message));
        const assets = new Set(); let requestingRace = false;
        page.on('request', request => {
            if (/\.glb(?:\?|$)/.test(request.url()) || requestingRace && /\/pet-(?:rally|poses|models)\//.test(request.url())) assets.add(request.url());
        });
        await page.addInitScript(installRasterChecks, { bitmapMode, contactRows });
        await page.route(/\.glb(?:\?|$)/, route => route.abort());
        await page.route('**/api/festival/rally', practiceFixture);
        await page.request.post(`${base}/__qa/reset`);
        await page.goto(`${base}/sunscar-modes-qa.html`);
        await page.getByRole('button', { name: 'Visit the race grounds' }).click();
        requestingRace = true;
        await page.evaluate(() => { window.rallyDirectionRaceActive = true; });
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
        await page.waitForFunction(() => window.sunscarRallyQa?.quality === 'economy' && window.sunscarRallyQa.spriteCount === 4);
        await page.getByRole('button', { name: 'Ready to race' }).click();
        await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 60);
        await expect.poll(() => page.evaluate(() => Object.values(window.rallyDirectionSnapshot().cells).some(cells => cells.slice(0, 4).every(count => count > 0)))).toBe(true);
        const fallbackDraw = await page.evaluate(() => window.rallyDirectionSnapshot());
        assert.deepEqual(fallbackDraw.badCrops, []); assert.deepEqual(fallbackDraw.webglAttempts, []);
        assert.equal(fallbackDraw.created, 0, 'the native image path does not retain a decoded bitmap');
        assert.ok(fallbackDraw.spriteLoads.length >= 4 && fallbackDraw.spriteLoads.every(url => url.startsWith('/pet-rally/')), 'native fallback course loads only the new atlases');
        assert.ok(Object.values(fallbackDraw.rasterContacts).flat().every(contact => contact.alpha > 12), 'native sprites preserve visible artwork at each reported ground contact');
        assert.ok(fallbackDraw.contacts.some(contact => contact.player) && fallbackDraw.contacts.filter(contact => contact.player).every(contact => Math.abs(contact.gap - 1 - contact.expectedLift) <= 2), 'native 192px fallback maps measured feet to the same road anchor');
        assert.deepEqual([...assets].filter(url => /\/pet-models\/|\.glb(?:\?|$)/.test(url)), [], 'native image fallback never requests pet models');
        await capture(`image-fallback-${bitmapMode}`);
        await page.getByRole('button', { name: 'Pause race' }).click();
        requestingRace = false;
        await page.getByRole('button', { name: 'Save & return' }).click();
        await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
        await page.waitForTimeout(700);
        const cleanup = await page.evaluate(() => window.rallyDirectionSnapshot());
        assert.equal(cleanup.frames, 0); assert.equal(cleanup.liveBitmaps, 0);
        assert.equal(await page.evaluate(() => !!window.sunscarRallyQa), false);
        await expect(page.locator('.rally-economy-surface canvas')).toHaveCount(0);
        report.imageFallbacks.push({ bitmapMode, draw: fallbackDraw, requests: [...assets], cleanup });
        await fallbackContext.close();
    }
    assert.deepEqual(report.errors, []);
    report.checks.push('absent or rejected ImageBitmap decoding uses correct native 192px square crops and cleans up');
    console.log(JSON.stringify({ errors: report.errors, checks: report.checks, assetCount: report.assets.length,
        edgeContact: report.edgeContact, surfaces: report.surfaces, liveBitmaps: report.draw.liveBitmaps,
        grounding: { samples: report.grounding.samples, groundedGap: report.grounding.groundedGap, physicsGapError: report.grounding.physicsGapError,
            jumpSamples: report.grounding.jumpSamples, landingSamples: report.grounding.landingSamples },
        motionStrip: fileURLToPath(new URL('grounding-motion-strip.png', out)),
        imageFallbacks: report.imageFallbacks.map(entry => entry.bitmapMode), cleanup: { frames: report.cleanup.frames, liveBitmaps: report.cleanup.liveBitmaps } }, null, 2));
} catch (error) {
    if (page && !page.isClosed()) { await capture('failure'); report.lastState = await page.evaluate(() => ({ race: window.sunscarRallyQa, draw: window.rallyDirectionSnapshot?.() })); }
    throw error;
} finally {
    await writeFile(new URL(preview ? 'report-preview.json' : 'report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
}
