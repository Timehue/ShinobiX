import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Response fixtures belong only to this browser. Layout checks use actual
// painted hit targets and rectangles, independent of the rendering engine.
const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-hud-qa/', import.meta.url);
const expect = baseExpect.configure({ timeout: 45000 });
const report = { errors: [], failures: [], samples: [], cleanup: [], checks: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
process.once('SIGINT', () => { void browser.close(); });
let page, scenario = 'normal';
const init = ({ three }) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => three ? 16 : 4 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => three ? 8 : 2 });
    localStorage.setItem('petRally.render.v1', three ? '3d' : 'economy');
    localStorage.setItem('liteFx.v1', '1');
    const frames = new Set(), frame = requestAnimationFrame, cancel = cancelAnimationFrame;
    window.requestAnimationFrame = callback => { const id = frame(time => { frames.delete(id); callback(time); }); frames.add(id); return id; };
    window.cancelAnimationFrame = id => { frames.delete(id); cancel(id); };
    window.rallyHudResources = () => ({ frames: frames.size, canvases: document.querySelectorAll('.rally-stage canvas').length,
        qa: !!window.sunscarRallyQa, roots: window.sunscarRallyRootCount?.(), scrollLocked: document.body.classList.contains('ui-scroll-locked') });
    if (!three) {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/i.test(type) ? null : original.call(this, type, ...args); };
    }
};
const fixture = async route => {
    const response = await route.fetch(), data = await response.json();
    if (data.progress) data.progress.reputation = 1000;
    if (route.request().postDataJSON()?.action === 'practice') {
        const race = data.practice;
        race.racers.forEach((racer, i) => Object.assign(racer, { rivalId: null, speed: 0, distance: [40, 48, 62, 84][i],
            lane: [0, 0, 1, -1][i], targetLane: [0, 0, 1, -1][i], motion: 'ready' }));
        race.racers[0].attackCharge = 100;
        race.events = [{ tick: race.tick, racerId: 'player', kind: 'clean-jump', value: 4 }];
        if (scenario === 'warnings') race.shots = [{ id: 'hud-warning', ownerId: race.racers[1].id, element: 'Water', lane: 0,
            distance: 12, speed: 60, remaining: 180, width: .8, slowTicks: 120, slowSpeed: .7, targetId: 'player', targetPassed: false }];
        if (scenario === 'finish') {
            race.tick = 3600;
            race.racers.forEach((racer, i) => Object.assign(racer, { distance: 1020 - [20, 10, 30, 40][i], speed: 20 }));
        }
    }
    await route.fulfill({ response, json: data });
};
const capture = name => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
const checkLayout = async (name, { normal = false, results = false } = {}) => {
    const sample = await page.evaluate(() => {
        const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const race = document.querySelector('.rally-race'), shell = document.querySelector('.sunscar-rally-session'), course = document.querySelector('.rally-stage');
        const buttons = [...document.querySelectorAll('.rally-controls button, .rally-pause')].map(element => {
            const rect = box(element), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { label: element.getAttribute('aria-label'), pause: element.matches('.rally-pause'), disabled: element.disabled, rect,
                hit: hit === element || !!hit && element.contains(hit) };
        });
        const panels = [...document.querySelectorAll('.rally-race > .rally-hud, .rally-race > .rally-dashboard, .rally-race > .rally-controls, .rally-race > .rally-save-note')]
            .map(element => ({ name: element.className, rect: box(element), scrollX: element.scrollWidth - element.clientWidth, scrollY: element.scrollHeight - element.clientHeight }));
        const labels = [...document.querySelectorAll('.rally-race-hints > span, .rally-telemetry, .rally-stamina, .rally-finish-banner')]
            .filter(element => getComputedStyle(element).display !== 'none').map(element => ({ name: element.className, rect: box(element), text: element.textContent }));
        return { viewport: { width: innerWidth, height: innerHeight }, race: box(race), course: box(course), panels, labels, buttons,
            shell: { ...box(shell), scrollX: shell.scrollWidth - shell.clientWidth, scrollY: shell.scrollHeight - shell.clientHeight },
            dashboardScrollY: document.querySelector('.rally-dashboard').scrollHeight - document.querySelector('.rally-dashboard').clientHeight,
            hintCount: document.querySelectorAll('.rally-race-hints > span:not(:empty)').length, quality: window.sunscarRallyQa?.quality };
    });
    const failures = [];
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > .5;
    const within = rect => rect.x >= -.5 && rect.y >= -.5 && rect.right <= sample.viewport.width + .5 && rect.bottom <= sample.viewport.height + .5;
    if (!within(sample.race) || sample.shell.scrollX > 1 || !results && sample.shell.scrollY > 1) failures.push('race shell overflows the viewport');
    if (sample.course.width < 140 || sample.course.height < 140) failures.push('course is smaller than 140px');
    for (const panel of sample.panels) {
        if (overlap(panel.rect, sample.course)) failures.push(`${panel.name} overlaps course`);
        if (!within(panel.rect) || panel.scrollX > 1) failures.push(`${panel.name} overflows the viewport horizontally`);
    }
    for (let i = 0; i < sample.panels.length; i++) for (const other of sample.panels.slice(i + 1))
        if (overlap(sample.panels[i].rect, other.rect)) failures.push(`${sample.panels[i].name} overlaps ${other.name}`);
    for (const button of sample.buttons) {
        if (button.rect.width < 43.5 || button.rect.height < (button.pause ? 43.5 : 47.5)) failures.push(`${button.label} is smaller than its touch target`);
        if (!within(button.rect) || !button.disabled && !button.hit) failures.push(`${button.label} is clipped or occluded`);
    }
    if (sample.buttons.length !== 7) failures.push('six race controls and Pause are required');
    if (normal && sample.dashboardScrollY > 1) failures.push('usual hints require dashboard scrolling');
    sample.name = name; sample.failures = failures; report.samples.push(sample);
    report.failures.push(...failures.map(message => `${name}: ${message}`));
    await capture(name);
    console.log(JSON.stringify({ capture: name, course: sample.course, hintCount: sample.hintCount, dashboardScrollY: sample.dashboardScrollY, failures }));
    return sample;
};
const prepare = async () => {
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ })).toBeEnabled();
    await page.waitForFunction(() => window.sunscarRallyQa && (window.sunscarRallyQa.quality !== 'economy' || window.sunscarRallyQa.spriteCount === 4));
    await page.getByRole('button', { name: /Ready to race|Resume from checkpoint/ }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 10);
};
const leave = async finished => {
    if (finished) await page.getByRole('button', { name: 'Return to the race desk' }).click();
    else {
        await page.getByRole('button', { name: 'Pause race' }).click();
        await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
        await page.waitForTimeout(350);
        const frozen = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount }));
        await page.waitForTimeout(300);
        assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount })), frozen, 'paused demand rendering and simulation sleep');
        await page.getByRole('button', { name: 'Save & return' }).click();
    }
    await expect(page.getByRole('button', { name: 'Practice selected course' })).toBeEnabled();
    await page.waitForTimeout(750);
    const resources = await page.evaluate(() => window.rallyHudResources()); report.cleanup.push(resources);
    assert.equal(resources.frames, 0); assert.equal(resources.canvases, 0); assert.equal(resources.qa, false); assert.equal(resources.scrollLocked, false);
    if (resources.roots !== undefined) assert.equal(resources.roots, 0);
};
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
    page = await context.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(init, { three: false }); await page.route('**/api/festival/rally', fixture);
    await page.request.post(`${base}/__qa/reset`); await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    const viewports = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 640, height: 360 }, { width: 568, height: 320 }];
    for (const viewport of viewports) {
        await page.setViewportSize(viewport); scenario = 'normal'; await prepare();
        const key = `${viewport.width}x${viewport.height}`;
        await checkLayout(`economy-${key}-running`, { normal: true });
        await page.waitForFunction(() => { const racer = window.sunscarRallyQa?.state.racers[0]; return racer && racer.stagger === 0 && racer.jumpCooldown === 0; });
        await page.getByRole('button', { name: 'Jump, right trigger or Space' }).click();
        await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].jump > .1);
        await checkLayout(`economy-${key}-jump`, { normal: true });
        if (viewport.width === 390) {
            const burst = page.getByRole('button', { name: 'Hold Burst, left trigger or Shift' }), box = await burst.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
            await page.waitForFunction(() => window.sunscarRallyQa?.state.racers[0].burst);
            const heldTick = await page.evaluate(() => window.sunscarRallyQa.state.tick);
            await page.setViewportSize({ width: 844, height: 390 });
            await page.waitForFunction(tick => window.sunscarRallyQa?.state.tick > tick + 5 && window.sunscarRallyQa.state.racers[0].burst, heldTick);
            await checkLayout('economy-rotation-held-burst'); await page.mouse.up();
            await page.waitForFunction(() => window.sunscarRallyQa && !window.sunscarRallyQa.state.racers[0].burst);
            await page.getByRole('button', { name: 'Pause race' }).click();
            await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
            const pausedTick = await page.evaluate(() => window.sunscarRallyQa.state.tick);
            await page.getByRole('button', { name: 'Continue race' }).click();
            await page.waitForFunction(tick => window.sunscarRallyQa?.state.tick > tick + 5, pausedTick);
            assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.racers[0].burst), false, 'pointer release after rotation and pause leaves Burst off');
            report.rotation = { heldTick, pausedTick, resumed: true, releasedBurst: true };
        }
        await leave(false);
    }
    scenario = 'warnings'; await page.setViewportSize({ width: 568, height: 320 }); await prepare();
    const warningSample = await checkLayout('economy-568x320-four-hints');
    assert.equal(warningSample.hintCount, 4, 'worst-case fixture actually displays all four warnings'); await leave(false);
    scenario = 'finish'; await page.setViewportSize({ width: 390, height: 844 }); await prepare();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.finished);
    await expect(page.getByRole('button', { name: 'Return to the race desk' })).toBeVisible();
    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.locator('.rally-race').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.waitForTimeout(200); await checkLayout(`economy-${viewport.width}x${viewport.height}-finish`, { results: true });
    }
    await expect.poll(() => page.evaluate(() => window.rallyHudResources().frames)).toBe(0);
    const settled = await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount }));
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ tick: window.sunscarRallyQa.state.tick, frame: window.sunscarRallyQa.frameCount })), settled, 'finished presentation sleeps');
    await leave(true); await context.close();
    const threeContext = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await threeContext.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(init, { three: true }); await page.route('**/api/festival/rally', fixture);
    scenario = 'normal'; await page.goto(`${base}/sunscar-modes-qa.html`); await page.getByRole('button', { name: 'Visit the race grounds' }).click(); await prepare();
    assert.equal(await page.evaluate(() => window.sunscarRallyQa?.quality), 'light');
    await checkLayout('3d-844x390-running', { normal: true }); await page.setViewportSize({ width: 390, height: 844 });
    await checkLayout('3d-390x844-running', { normal: true }); await leave(false); await threeContext.close();
    report.checks.push('five viewport sizes in running/jumping/finished states', 'HUD docks never intersect course', 'all six touch controls >=44x48 and Pause>=44x44',
        'viewport overflow and hit occlusion checks', 'usual portrait/landscape dashboard does not scroll', 'four warning hints on smallest landscape', 'held Burst survives rotation, releases by pointer and resumes after pause', 'paused/finished demand sleep and exit cleanup', 'light3D shares the same unobstructed shell');
    assert.deepEqual(report.errors, []); assert.deepEqual(report.failures, []);
    console.log(JSON.stringify({ checks: report.checks, samples: report.samples.length, errors: report.errors, failures: report.failures, cleanupCycles: report.cleanup.length }, null, 2));
} catch (error) {
    if (page && !page.isClosed()) { await capture('failure'); report.lastState = await page.evaluate(() => ({ qa: window.sunscarRallyQa, resources: window.rallyHudResources?.() })); }
    throw error;
} finally { await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2)); await browser.close(); }
