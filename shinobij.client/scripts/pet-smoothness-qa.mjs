import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import express from 'express';

const out = new URL(`../../.tmp/${process.env.PET_SMOOTH_OUTPUT_DIR || 'pet-smoothness-qa'}/`, import.meta.url);
await mkdir(out, { recursive: true });
const app = express();
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = await new Promise(resolve => { const server = app.listen(5201, '127.0.0.1', () => resolve(server)); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] });
const report = { errors: [], colosseum: [], rally: {} };
const cycles = Number(process.env.PET_LIFECYCLE_CYCLES || 5);
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    const cdp = await page.context().newCDPSession(page);
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('http://127.0.0.1:5201/showdownpreview.html?vfxreview&lifecycle&move=4&rosterpet=standard-0&enemypet=rare-24&petQuality=high');
    await page.getByLabel('Lifecycle metrics').waitFor();
    const metrics = async () => JSON.parse(await page.getByLabel('Lifecycle metrics').textContent());
    // Harness controls intentionally live outside the battle's focus trap.
    const clickHarness = name => page.evaluate(label => [...document.querySelectorAll('button')].find(button => button.textContent === label)?.click(), name);
    for (let cycle = 0; cycle < cycles; cycle++) {
        await page.waitForTimeout(4000);
        if (cycle === 0) await page.screenshot({ path: fileURLToPath(new URL('colosseum-ready.png', out)) });
        await clickHarness('Play review');
        await page.waitForTimeout(3000);
        if (cycle === 0) await page.screenshot({ path: fileURLToPath(new URL('colosseum-action.png', out)) });
        await clickHarness('Unmount battle');
        await page.waitForFunction(() => {
            const node = document.querySelector('[aria-label="Lifecycle metrics"]');
            return node && JSON.parse(node.textContent).activeContexts === 0;
        }, undefined, { timeout: 60000 });
        await page.waitForTimeout(1200);
        // Compare retained heaps after collection, not the browser's variable
        // allocation/collection cadence between battles.
        await cdp.send('HeapProfiler.collectGarbage');
        const sample = await metrics();
        sample.retainedHeapBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        sample.dom = await cdp.send('Memory.getDOMCounters');
        if (process.env.PET_HEAP_SNAPSHOTS && (cycle === 0 || cycle === cycles - 1)) {
            const chunks = [];
            const collect = ({ chunk }) => chunks.push(chunk);
            cdp.on('HeapProfiler.addHeapSnapshotChunk', collect);
            await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
            cdp.off('HeapProfiler.addHeapSnapshotChunk', collect);
            await writeFile(new URL(`cycle-${cycle + 1}.heapsnapshot`, out), chunks.join(''));
        }
        report.colosseum.push(sample);
        console.log(JSON.stringify({ cycle: cycle + 1, retainedHeapBytes: sample.retainedHeapBytes, activeContexts: sample.activeContexts }));
        assert.equal(await page.locator('canvas').count(), 0);
        assert.equal(sample.activeContexts, 0);
        assert.equal(sample.pendingFrames, 0);
        for (const count of Object.values(sample.handles)) assert.equal(count, 0);
        if (cycle < cycles - 1) {
            await clickHarness('Pause review');
            await clickHarness('Mount battle');
        }
    }
    for (const sample of report.colosseum.slice(1)) {
        assert.equal(sample.pendingTimers, report.colosseum[0].pendingTimers);
        assert.equal(sample.intervals, report.colosseum[0].intervals);
        assert.deepEqual(sample.dom, report.colosseum[0].dom, 'Battle exits must not accumulate DOM nodes or event listeners');
    }
    await page.goto('http://127.0.0.1:5199/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 80);
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.screenshot({ path: fileURLToPath(new URL('rally-jump.png', out)) });
    await page.keyboard.up('Shift');
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(600);
    await page.screenshot({ path: fileURLToPath(new URL('rally-technique.png', out)) });
    report.rally = await page.evaluate(() => window.sunscarRallyQa);
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.waitForTimeout(600);
    const frozen = await page.evaluate(() => window.sunscarRallyQa.frameCount);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.frameCount), frozen);
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ colosseum: report.colosseum, rallyFps: report.rally.fps, errors: report.errors }));
} finally {
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
}
