/** Capture the live battle renderer at representative Raijin action beats. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5179';
const output = resolve(process.argv[3] ?? '.tmp/raijin-artist-pass');
await mkdir(output, { recursive: true });
const allStates = [
    ['idle', 'motion=idle', 550],
    ['gallop', 'motion=run&speed=8.5', 350],
    ['attack', 'motion=strike', 430],
    ['dodge', 'motion=dodge', 300],
    ['hit', 'motion=stagger', 280],
    ['cast', 'motion=idle&casting=1', 560],
    ['guard', 'motion=guard', 560],
    ['rest', 'motion=rest', 850],
    ['entrance', 'motion=idle&entrance=0.55', 430],
    ['victory', 'motion=idle&victorious=1', 700],
    ['defeat', 'motion=dead', 1700],
];
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice('--only='.length).split(',');
const states = only ? allStates.filter(([name]) => only.includes(name)) : allStates;
if (!states.length) throw new Error('No matching states requested');
const angle = process.argv.find(arg => arg.startsWith('--angle='))?.slice('--angle='.length) ?? 'threequarter';
const at = process.argv.find(arg => arg.startsWith('--at='))?.slice('--at='.length);
const requestedFrames = process.argv.find(arg => arg.startsWith('--frames='))?.slice('--frames='.length);
const modelUrl = process.argv.find(arg => arg.startsWith('--modelUrl='))?.slice('--modelUrl='.length);
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 920, height: 760 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [name, query, delay] of states) {
        const url = `${baseUrl}/petvfx.html?modelqa=1&pet=lightning&legendary=1&angle=${angle}&petQuality=high&${query}${modelUrl ? `&modelUrl=${encodeURIComponent(modelUrl)}` : ''}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForFunction(() => Boolean(document.documentElement.dataset.petModelReady), { timeout: 45_000 });
        if (name === 'defeat') {
            const models = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.includes('.glb')));
            process.stdout.write(`Loaded models: ${models.join(', ')}\n`);
            await page.evaluate(() => {
                window.__raijinQaFrames = 0;
                const tick = () => { window.__raijinQaFrames++; requestAnimationFrame(tick); };
                requestAnimationFrame(tick);
            });
        }
        if (name === 'defeat' && (requestedFrames || at === undefined)) {
            await page.waitForFunction(frames => window.__raijinQaFrames >= frames, Number(requestedFrames ?? 100), { timeout: 90_000 });
        } else {
            await page.waitForTimeout(at === undefined ? delay : Number(at));
        }
        if (name === 'defeat') process.stdout.write(`Animation frames after ready: ${await page.evaluate(() => window.__raijinQaFrames)}\n`);
        await page.screenshot({ path: resolve(output, `${name}.png`) });
        process.stdout.write(`Captured ${name}\n`);
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
    const tiles = await Promise.all(states.map(async ([name], index) => {
        const label = Buffer.from(`<svg width="460" height="380" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="170" height="38" rx="8" fill="#081320" fill-opacity="0.88"/><text x="24" y="36" fill="#ffffff" font-family="Arial, sans-serif" font-size="23" font-weight="bold">${name.toUpperCase()}</text></svg>`);
        return {
            input: await sharp(resolve(output, `${name}.png`)).resize(460, 380).composite([{ input: label }]).toBuffer(),
            left: (index % 3) * 460,
            top: Math.floor(index / 3) * 380,
        };
    }));
    await sharp({ create: { width: 1380, height: Math.ceil(states.length / 3) * 380, channels: 4, background: '#101726' } })
        .composite(tiles).png().toFile(resolve(output, 'motion-contact.png'));
    process.stdout.write(`Contact sheet: ${resolve(output, 'motion-contact.png')}\n`);
} finally {
    await browser.close();
}
