import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const idle = process.argv.includes('--idle');
const output = fileURLToPath(new URL(idle
    ? '../art-source/dawnmane-seraph/celestial-lion-colosseum-idle.png'
    : '../art-source/dawnmane-seraph/celestial-lion-colosseum-battle.png', import.meta.url));

const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const errors = [];
const models = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
    if (response.url().includes('/pet-models/roster/mythic-15.glb')) models.push(response.status());
});
const url = `https://127.0.0.1:5179/showdownpreview.html?rosterpet=mythic-15&enemypet=rare-24${idle ? '' : '&vfxreview&play&move=3&heavy'}`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.locator('[data-testid="pet-showdown-root"] canvas').waitFor({ timeout: 30_000 });
if (!idle) await page.evaluate(() => {
    const controls = [...document.querySelectorAll('div')].find(element => element.style.position === 'fixed' && element.style.zIndex === '99999');
    if (controls) controls.style.display = 'none';
});
for (const delay of [1000, 1500, 2000, 2500, 3000]) {
    await page.waitForTimeout(delay === 1000 ? delay : 500);
    const path = join(tmpdir(), `celestial-lion-${idle ? 'idle' : 'battle'}-${delay}.png`);
    await page.screenshot({ path });
    console.log(path);
    if (delay === 1500) await page.screenshot({ path: output });
}
console.log(JSON.stringify({ models, errors, title: await page.title(), output }));
await browser.close();
