import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../../.tmp/pet-smoothness-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const samples = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(60000);
    await page.goto('http://127.0.0.1:5199/sunscar-modes-qa.html');
    await page.getByRole('button', { name: 'Visit the race grounds' }).click();
    await page.getByRole('button', { name: 'Practice selected course' }).click();
    await page.getByRole('button', { name: 'Ready to race' }).click();
    await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 180);
    await page.waitForTimeout(4000);
    samples.push(await page.evaluate(() => {
        const gl = document.querySelector('canvas').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const metrics = window.sunscarRallyQa;
        return { mode: 'rally', renderer: info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL), fps: metrics.fps, quality: metrics.quality, calls: metrics.calls, triangles: metrics.triangles };
    }));
    await page.goto('http://127.0.0.1:5201/showdownpreview.html?vfxreview&play&petQuality=low&rosterpet=standard-0&enemypet=rare-24');
    await page.locator('canvas').waitFor();
    await page.waitForTimeout(8000);
    samples.push(await page.evaluate(async () => {
        const gl = document.querySelector('canvas').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const started = performance.now(); let frames = 0;
        await new Promise(resolve => { const tick = now => { frames++; if (now - started >= 4000) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        return { mode: 'colosseum', renderer: info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL), fps: frames / ((performance.now() - started) / 1000) };
    }));
    console.log(JSON.stringify(samples));
} finally {
    await writeFile(new URL('render-performance.json', out), JSON.stringify(samples, null, 2));
    await browser.close();
}
