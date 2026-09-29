import { chromium } from '@playwright/test';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const label = process.env.PET_HITCH_LABEL || 'before';
const out = new URL(`../../.tmp/pet-hitch-profile/${label}/`, import.meta.url);
await mkdir(out, { recursive: true });
const app = express();
app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../../.tmp/gauntlet-qa-dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = await new Promise(resolve => { const s = app.listen(5212, '127.0.0.1', () => resolve(s)); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=d3d11'] });
try {
    for (const [mode, url] of [
        ['colosseum', '/showdownpreview.html?vfxreview&play&move=4&petQuality=medium&rosterpet=standard-0&enemypet=rare-24'],
        ['gauntlet', '/gauntlet-qa.html?benchmark&full&petQuality=medium'],
        ['rally', 'http://127.0.0.1:5199/sunscar-modes-qa.html'],
    ].filter(([mode]) => !process.env.PET_HITCH_MODE || process.env.PET_HITCH_MODE === mode)) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            const seen = new WeakSet(), calls = [], frames = [], programs = [], marks = [];
            const native = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (...args) {
                const gl = native.apply(this, args);
                if (!gl || !String(args[0]).includes('webgl') || seen.has(gl)) return gl;
                seen.add(gl);
                const sources = new WeakMap(), programMeta = new WeakMap();
                const source = gl.shaderSource.bind(gl), attach = gl.attachShader.bind(gl);
                gl.shaderSource = (shader, text) => { sources.set(shader, text); return source(shader, text); };
                gl.attachShader = (program, shader) => {
                    let meta = programMeta.get(program);
                    if (!meta) { meta = { id: programs.length, createdAt: performance.now(), sources: [] }; programs.push(meta); programMeta.set(program, meta); }
                    meta.sources.push(sources.get(shader));
                    return attach(program, shader);
                };
                for (const key of ['compileShader', 'linkProgram', 'getProgramParameter', 'texImage2D', 'texSubImage2D', 'generateMipmap', 'drawElements', 'drawArrays']) {
                    const fn = gl[key].bind(gl);
                    gl[key] = (...values) => {
                        const start = performance.now();
                        const result = fn(...values), elapsed = performance.now() - start;
                        if (elapsed > 2) {
                            const image = values.find(v => v instanceof HTMLImageElement);
                            calls.push({ key, start, elapsed, parameter: key === 'getProgramParameter' ? values[1] : undefined,
                                programId: programMeta.get(values[0])?.id, image: image?.src, width: image?.naturalWidth, height: image?.naturalHeight });
                        }
                        return result;
                    };
                }
                return gl;
            };
            const raf = requestAnimationFrame;
            window.requestAnimationFrame = callback => raf(time => { const start = performance.now(); callback(time); const elapsed = performance.now() - start; if (elapsed > 20) frames.push({ start, elapsed }); });
            window.petHitchProfile = { calls, frames, programs, marks };
        });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await cdp.send('Profiler.start');
        if (mode === 'rally') {
            await page.request.post('http://127.0.0.1:5199/__qa/reset');
            await page.addInitScript(() => localStorage.setItem('liteFx.v1', '0'));
        }
        await page.goto((url.startsWith('http') ? '' : 'http://127.0.0.1:5212') + (process.env.PET_HITCH_QUALITY ? url.replace('petQuality=medium', `petQuality=${process.env.PET_HITCH_QUALITY}`) : url));
        if (mode === 'gauntlet') await page.getByRole('button', { name: 'Mount', exact: true }).click();
        if (mode === 'rally') {
            await page.getByRole('button', { name: 'Visit the race grounds' }).click();
            await page.getByRole('button', { name: 'Practice selected course' }).click();
            await page.getByRole('button', { name: 'Ready to race' }).click();
            await page.waitForFunction(() => window.sunscarRallyQa?.state.tick > 120);
            await page.waitForTimeout(5000);
            await page.evaluate(() => window.petHitchProfile.marks.push({ action: 'jump-burst', time: performance.now() }));
            await page.keyboard.down('Shift'); await page.keyboard.press('Space');
            await page.waitForTimeout(2000);
            await page.evaluate(() => window.petHitchProfile.marks.push({ action: 'technique', time: performance.now() }));
            await page.keyboard.press('KeyE'); await page.keyboard.up('Shift');
            await page.waitForTimeout(9000);
        } else await page.waitForTimeout(22000);
        const profile = (await cdp.send('Profiler.stop')).profile;
        const gpu = await page.evaluate(() => window.petHitchProfile);
        await writeFile(new URL(`${mode}.cpuprofile`, out), JSON.stringify(profile));
        await writeFile(new URL(`${mode}.json`, out), JSON.stringify({ errors, ...gpu }, null, 2));
        const times = new Map();
        for (let i = 0; i < profile.samples.length; i++) times.set(profile.samples[i], (times.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i]);
        const hot = profile.nodes.map(n => ({ ...n.callFrame, ms: (times.get(n.id) ?? 0) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 18);
        console.log(JSON.stringify({ mode, errors, hot, slowGpu: gpu.calls.filter(c => c.elapsed > 10), slowFrames: gpu.frames.filter(f => f.elapsed > 50) }));
        await page.screenshot({ path: fileURLToPath(new URL(`${mode}.png`, out)) });
        await page.close();
    }
} finally { await browser.close(); server.close(); }
