import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/rally-polish-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], layouts = [], checkpoints = [];
const expect = baseExpect.configure({ timeout: 45000 });
const capture = (page, name) => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
let page;
try {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => {
        if (response.url().includes('/api/festival/rally') && response.request().postDataJSON()?.action === 'checkpoint') {
            const data = await response.json();
            checkpoints.push({ status: response.status(), tick: data.progress?.current?.race?.tick, shots: data.progress?.current?.race?.racers[0].shotsFired });
        }
    });
    const player = () => page.evaluate(() => window.sunscarRallyQa.state.racers[0]);
    await page.request.post(`${base}/__qa/reset`);
    await page.goto(`${base}/sunscar-modes-qa.html`);
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await expect(page.getByText('Species sets the racing style.', { exact: false })).toBeVisible();
    await capture(page, 'desk-desktop');
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await capture(page, 'intro-desktop');
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 80);
    await page.keyboard.press('KeyQ');
    assert.equal((await player()).shotsFired, 0, 'unready shots are rejected');
    await page.keyboard.down('Shift');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].burst && window.sunscarRallyQa.state.racers[0].stamina < 95);
    const burst = await player();
    await capture(page, 'burst-desktop');
    await page.keyboard.press('Escape');
    await page.keyboard.up('Shift');
    await expect(page.getByRole('heading', { name: 'Taking a breather' })).toBeVisible();
    // Let the final demand frame and its queued QA snapshot settle.
    await page.waitForTimeout(700);
    const pausedAt = await page.evaluate(() => window.sunscarRallyQa.state.tick);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.sunscarRallyQa.state.tick), pausedAt);
    await page.getByRole('button', { name: 'Continue race' }).click();
    await page.waitForFunction(() => !window.sunscarRallyQa.state.racers[0].burst);
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].attackCharge === 100);
    await page.keyboard.press('KeyQ');
    const shot = await (await page.waitForFunction(() => {
        const racer = window.sunscarRallyQa.state.racers[0];
        return racer.shotsFired === 1 && racer;
    })).jsonValue();
    assert.ok(shot.recoilTicks > 0 && shot.attackCharge < 10, 'firing spends charge and starts recoil');
    await capture(page, 'shot-desktop');
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].techniqueUsed);
    await expect(page.locator('.rally-technique')).toBeDisabled();
    await expect(page.locator('.rally-technique')).toHaveClass(/is-used/);
    await expect(page.locator('.rally-technique')).toContainText('Used');
    await page.getByRole('button', { name: 'Pause race' }).click();
    for (const [width, height] of [[390, 844], [320, 640], [844, 390]]) {
        await page.setViewportSize({ width, height });
        const layout = await page.locator('.rally-controls button').evaluateAll(buttons => buttons.map(button => {
            const box = button.getBoundingClientRect();
            return { label: button.textContent, x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        }));
        assert.ok(layout.every(box => box.width >= 44 && box.height >= 44 && box.x >= 0 && box.right <= width && box.bottom <= height), `all controls fit ${width}x${height}: ${JSON.stringify(layout)}`);
        layouts.push({ width, height, controls: layout.length });
        await capture(page, `paused-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Continue race' }).click();
    const burstButton = page.getByRole('button', { name: 'Hold Burst, Shift' });
    const bounds = await burstButton.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].burst);
    await page.mouse.move(5, 5); await page.mouse.up();
    await page.waitForFunction(() => !window.sunscarRallyQa.state.racers[0].burst);
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].attackCharge === 100);
    await expect(page.locator('.rally-attack')).toBeEnabled();
    await page.locator('.rally-attack').focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].shotsFired === 2);
    assert.equal((await player()).jump, 0, 'Space on the shot button must not also jump');
    await capture(page, 'racing-mobile');
    const metrics = await page.evaluate(() => { const { state, ...metrics } = window.sunscarRallyQa; return metrics; });
    await page.getByRole('button', { name: 'Pause race' }).click();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Prepare Grand Prix' }).click();
    await expect(page.getByRole('button', { name: 'Ready to race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].attackCharge === 100);
    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => window.sunscarRallyQa.state.racers[0].shotsFired === 1);
    await page.getByRole('button', { name: 'Pause race' }).click();
    await expect(page.getByRole('button', { name: 'Continue race' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save & return' }).click();
    await expect(page.getByRole('button', { name: 'Resume Grand Prix' })).toBeVisible();
    assert.ok(checkpoints.some(checkpoint => checkpoint.status === 200 && checkpoint.shots === 1), 'server accepts and replays the shot');
    await page.getByRole('button', { name: 'Resume Grand Prix' }).click();
    await expect(page.getByRole('button', { name: 'Resume from checkpoint' })).toBeEnabled();
    assert.equal((await player()).shotsFired, 1, 'reopening retains verified shot state');
    assert.deepEqual(errors, []);
    const report = { errors, layouts, checkpoints, metrics, burstSpeed: burst.speed, recoilTicks: shot.recoilTicks };
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    if (page) {
        await capture(page, 'failure');
        console.error(JSON.stringify(await page.evaluate(() => ({ qa: window.sunscarRallyQa, active: document.activeElement?.outerHTML })), null, 2));
    }
    throw error;
} finally { await browser.close(); }
