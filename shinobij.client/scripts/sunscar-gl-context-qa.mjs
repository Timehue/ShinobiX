import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/sunscar-gl-context-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const samples = [], errors = [];
let page;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    page = await context.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const active = new Set();
        let created = 0, lost = 0;
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const result = getContext.call(this, type, ...args);
            if (/^webgl2?$/.test(String(type)) && result && !active.has(this)) {
                active.add(this); created++;
                this.addEventListener('webglcontextlost', () => { active.delete(this); lost++; }, { once: true });
            }
            return result;
        };
        window.sunscarGpuQa = () => ({ active: active.size, created, lost });
    });
    await page.request.post(base + '/__qa/reset');
    await page.goto(base + '/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Visit the race grounds' }).waitFor();
    await page.waitForTimeout(300);
    const hub = await page.evaluate(() => window.sunscarGpuQa());
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.waitForTimeout(300);
    const baseline = await page.evaluate(() => window.sunscarGpuQa());
    for (let i = 0; i < 4; i++) {
        await page.getByRole('button', { name: 'Practice selected course' }).click();
        await page.getByText('All companions ready').waitFor();
        assert.equal((await page.evaluate(() => window.sunscarGpuQa())).active, baseline.active + 1, 'One additional WebGL context per Rally canvas');
        if (i % 2 === 0) await page.getByRole('button', { name: 'Race desk' }).click();
        else {
            await page.getByRole('button', { name: 'Ready to race' }).click();
            await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 60);
            await page.getByRole('button', { name: 'Pause race' }).click();
            await page.getByRole('button', { name: 'Save & return' }).click();
        }
        await page.waitForFunction(() => !document.querySelector('.rally-stage canvas'));
        // react-three-fiber releases the WebGL context 500ms after unmount.
        await page.waitForFunction(expected => window.sunscarGpuQa().active === expected, baseline.active, { timeout: 10_000 });
        samples.push(await page.evaluate(() => window.sunscarGpuQa()));
    }
    assert.deepEqual(samples.map(sample => sample.active), Array(4).fill(baseline.active));
    assert.equal(samples.at(-1).created - baseline.created, samples.at(-1).lost - baseline.lost, 'Every Rally context is explicitly lost');
    await page.getByRole('button', { name: '← Festival' }).click();
    await page.getByRole('button', { name: 'Visit the race grounds' }).waitFor();
    await page.waitForFunction(expected => window.sunscarGpuQa().active === expected, hub.active, { timeout: 10_000 });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ hub, baseline, samples, errors }));
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify({ samples, errors }, null, 2));
    await browser.close();
}
