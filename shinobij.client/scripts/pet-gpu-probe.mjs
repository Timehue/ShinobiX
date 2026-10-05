import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = new URL('../../.tmp/pet-hardware-performance/', import.meta.url);
await mkdir(out, { recursive: true });
const results = [];
for (const [name, options] of [
    ['headless-shell', {}],
    ['full-chromium', { channel: 'chromium', args: ['--enable-gpu'] }],
    ['full-chromium-d3d11', { channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] }],
    ['edge-d3d11', { channel: 'msedge', args: ['--enable-gpu', '--use-angle=d3d11'] }],
]) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, ...options });
        const session = await browser.newBrowserCDPSession();
        const system = await session.send('SystemInfo.getInfo');
        const page = await browser.newPage();
        const webgl = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            if (!gl) return { available: false };
            const debug = gl.getExtension('WEBGL_debug_renderer_info');
            const info = { available: true, renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
                vendor: debug && gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), timerQueries: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return info;
        });
        const result = { name, version: browser.version(), webgl, gpu: system.gpu, modelName: system.modelName };
        results.push(result);
        console.log(JSON.stringify({ name, version: result.version, webgl, devices: system.gpu.devices, featureStatus: system.gpu.featureStatus }));
    } catch (error) {
        results.push({ name, error: error.message });
        console.log(JSON.stringify({ name, error: error.message }));
    } finally { await browser?.close(); }
}
await writeFile(new URL('gpu-probe.json', out), JSON.stringify(results, null, 2));
