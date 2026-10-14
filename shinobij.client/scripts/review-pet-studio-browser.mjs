import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';

const root = resolve(process.env.PET_REVIEW_OUTPUT_ROOT ?? resolve(import.meta.dirname, '../.tmp/pet-studio-review'));
await mkdir(root, { recursive: true });
const origin = process.env.PET_REVIEW_ORIGIN ?? 'https://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const failures = [], captures = [];
let reviewedMotionCount = 0;
let page;
try {
    for (let i = 0; i < (process.argv.includes('--motions-only') ? 0 : runtimePetModels.length); i++) {
        const { pet } = runtimePetModels[i];
        // Keep the bulk asset audit independent of the dev gallery's model
        // cache and Suspense transitions. Runtime switching is tested in the
        // Pet Yard and ranked journeys; each identity gets a clean renderer here.
        if (page) await page.close();
        page = await browser.newPage({ viewport: { width: 900, height: 650 }, ignoreHTTPSErrors: true });
        page.setDefaultTimeout(180000);
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(`${origin}/petmotionpreview.html?pet=${pet.id}`, { waitUntil: 'commit', timeout: 180000 });
        try {
            await page.waitForFunction(id => {
                const c = document.querySelector('canvas');
                return c?.dataset.petReady === id && Number(c.dataset.skinned) > 0 && Number(c.dataset.atlases) > 0;
            }, pet.id);
        } catch (error) {
            const state = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => ({ ready: canvas.dataset.petReady,
                skinned: canvas.dataset.skinned, atlases: canvas.dataset.atlases, motion: canvas.dataset.motion })));
            await writeFile(resolve(root, 'failed-render.json'), JSON.stringify({ requested: pet.id, state, failures, error: String(error) }, null, 2));
            await page.screenshot({ path: resolve(root, 'failed-render.png') });
            throw error;
        }
        await page.waitForTimeout(220);
        const file = resolve(root, `${pet.id}.png`);
        await page.screenshot({ path: file, clip: { x: 170, y: 150, width: 560, height: 495 } });
        captures.push({ id: pet.id, name: pet.name, file });
        if (i % 20 === 19) console.log(`Reviewed ${i + 1}/161 textured skinned pets`);
    }
    for (let start = 0; start < captures.length; start += 16) {
        const group = captures.slice(start, start + 16), layers = [];
        for (const [i, item] of group.entries()) {
            layers.push({ input: await sharp(item.file).resize(300, 265).png().toBuffer(), left: i % 4 * 300, top: Math.floor(i / 4) * 290 });
            const label = Buffer.from(`<svg width="300" height="25"><text x="8" y="18" fill="#fff" font-family="sans-serif" font-size="13">${item.id} · ${item.name.replaceAll('&', '&amp;')}</text></svg>`);
            layers.push({ input: label, left: i % 4 * 300, top: Math.floor(i / 4) * 290 + 265 });
        }
        await sharp({ create: { width: 1200, height: Math.ceil(group.length / 4) * 290, channels: 3, background: '#101726' } }).composite(layers).png().toFile(resolve(root, `roster-${String(start / 16 + 1).padStart(2, '0')}.png`));
    }
    // Sample the actual production state machine across every locomotion family,
    // including showcase, evolved and repaired bird rigs. Transitions share a page.
    const filter = process.argv.find(p => p.startsWith('--motion-models='))?.split('=')[1]?.split(',');
    const representatives = filter ?? ['standard-0', 'rare-1', 'standard-7', 'standard-5', 'standard-13', 'standard-27', 'standard-31', 'rare-24', 'legendary-7', 'mythic-0', 'mythic-8', 'starter-water', 'starter-fire-l', 'starter-lightning-l'];
    if (!page) {
        page = await browser.newPage({ viewport: { width: 900, height: 650 }, ignoreHTTPSErrors: true });
        page.setDefaultTimeout(180000);
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(`${origin}/petmotionpreview.html?pet=standard-0`);
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.petReady === 'standard-0');
    }
    for (const id of representatives) {
        await page.getByLabel('Pet', { exact: true }).selectOption(id);
        await page.waitForFunction(id => document.querySelector('canvas')?.dataset.petReady === id, id);
        const frames = [];
        for (const motion of ['idle', 'run', 'dash', 'windup', 'strike', 'recover', 'stagger', 'dodge', 'guard', 'rest', 'dead']) {
            await page.getByLabel('Motion', { exact: true }).selectOption(motion);
            await page.waitForFunction(({ motion, age }) => {
                const canvas = document.querySelector('canvas');
                return canvas?.dataset.motion === motion && Number(canvas.dataset.motionAge) >= age;
            }, { motion, age: motion === 'dead' ? 3 : .33 });
            frames.push({ input: await sharp(await page.screenshot({ clip: { x: 170, y: 150, width: 560, height: 495 } })).resize(240, 212).png().toBuffer(), left: frames.length % 4 * 240, top: Math.floor(frames.length / 4) * 240 });
            frames.push({ input: Buffer.from(`<svg width="240" height="28"><text x="8" y="18" fill="white" font-family="sans-serif" font-size="13">${motion}</text></svg>`), left: (frames.length - 1) / 2 % 4 * 240, top: Math.floor((frames.length - 1) / 2 / 4) * 240 + 212 });
        }
        // Rebuild positions because each sample contributes image + label.
        frames.forEach((f, i) => { const cell = Math.floor(i / 2); f.left = cell % 4 * 240; f.top = Math.floor(cell / 4) * 240 + (i % 2 ? 212 : 0); });
        await sharp({ create: { width: 960, height: 720, channels: 3, background: '#101726' } }).composite(frames).png().toFile(resolve(root, `motions-${id}.png`));
        await page.getByLabel('Motion', { exact: true }).selectOption('idle');
        reviewedMotionCount++;
    }
} finally { await browser.close(); }
const reportName = process.argv.some(p => p.startsWith('--motion-models=')) ? 'motion-targeted-report.json' : process.argv.includes('--motions-only') ? 'motion-browser-report.json' : 'browser-report.json';
await writeFile(resolve(root, reportName), JSON.stringify({ reviewedPets: captures.length, reviewedMotionModels: reviewedMotionCount, failures }, null, 2));
if (failures.length) throw Error(failures.join('\n'));
console.log(`Captured ${captures.length} pets and ${reviewedMotionCount} motion sheets in ${root}`);
