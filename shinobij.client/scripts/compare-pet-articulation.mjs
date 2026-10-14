import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(import.meta.dirname, '../.tmp/pet-performance-review');
await mkdir(output, { recursive: true });
const origin = process.env.PET_REVIEW_ORIGIN ?? 'http://127.0.0.1:4319';
const models = process.argv.find(arg => arg.startsWith('--models='))?.slice(9).split(',') ?? ['standard-0', 'standard-5', 'standard-7', 'standard-13', 'standard-27', 'standard-31', 'rare-1', 'starter-fire-l', 'starter-lightning-l'];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const errors = [], review = [];
try {
    for (const id of models) {
        const layers = [];
        for (const [row, candidate] of [false, true].entries()) for (const [column, time] of [.24, .42, .68, 1.05].entries()) {
            const page = await browser.newPage({ viewport: { width: 800, height: 620 } });
            page.on('pageerror', error => errors.push(`${id}: ${error.message}`));
            await page.goto(`${origin}/petmotionpreview.html?pet=${id}&sequence=1&time=${time}${candidate ? '' : '&original=1'}`);
            await page.waitForFunction(id => { const canvas = document.querySelector('canvas'); return canvas?.dataset.petReady === id && Number(canvas.dataset.atlases) > 0; }, id);
            await page.waitForTimeout(250);
            const pixels = await page.screenshot({ clip: { x: 100, y: 125, width: 600, height: 480 } });
            const frame = await sharp(pixels).resize(300, 240).png().toBuffer();
            layers.push({ input: frame, left: column * 300, top: row * 266 });
            layers.push({ input: Buffer.from(`<svg width="300" height="26"><text x="8" y="18" fill="white" font-family="sans-serif" font-size="13">${candidate ? 'Articulated' : 'Current'} · ${['windup','impact','recovery','settle'][column]}</text></svg>`), left: column * 300, top: row * 266 + 240 });
            await page.close();
        }
        await sharp({ create: { width: 1200, height: 532, channels: 3, background: '#101726' } }).composite(layers).png().toFile(resolve(output, `${id}-comparison.png`));
        review.push(id); console.log(`Compared ${id}`);
    }
    await writeFile(resolve(output, 'comparison-report.json'), JSON.stringify({ models: review, errors }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); }
