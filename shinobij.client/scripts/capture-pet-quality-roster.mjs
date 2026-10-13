import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
const label = process.argv.find(a => a.startsWith('--label='))?.slice(8) ?? 'candidate';
const candidates = process.argv.includes('--candidates');
const output = resolve(import.meta.dirname, '../.tmp/pet-quality-review', label);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5199/petmotionpreview.html?view=front${candidates ? '&candidates' : ''}`);
    const canvas = page.locator('canvas');
    for (const [i, { pet }] of runtimePetModels.entries()) {
        await page.getByLabel('Pet', { exact: true }).selectOption(pet.id);
        await page.waitForFunction(id => document.querySelector('canvas')?.dataset.petReady === id, pet.id, { timeout: 45000 });
        await page.waitForTimeout(180);
        const metrics = await canvas.evaluate(c => ({ bones: JSON.parse(c.dataset.bones), skinned: Number(c.dataset.skinned), atlases: Number(c.dataset.atlases), calls: Number(c.dataset.renderCalls), triangles: Number(c.dataset.renderTriangles) }));
        if (!metrics.skinned || !metrics.atlases || Object.values(metrics.bones).flat().some(v => !Number.isFinite(v))) throw Error(`${pet.id}: invisible atlas or invalid skeleton`);
        const image = await page.screenshot();
        await writeFile(resolve(output, `${pet.id}.png`), image);
        results.push({ id: pet.id, name: pet.name, ...metrics });
        if ((i + 1) % 20 === 0) console.log(`Rendered ${i + 1}/${runtimePetModels.length} pet identities`);
    }
    for (let offset = 0; offset < results.length; offset += 16) {
        const composites = await Promise.all(results.slice(offset, offset + 16).map(async (row, i) => ({ input: await sharp(resolve(output, `${row.id}.png`)).resize(400, 300).png().toBuffer(), left: i % 4 * 400, top: Math.floor(i / 4) * 300 })));
        await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#101726' } }).composite(composites).png().toFile(resolve(output, `contact-${String(offset / 16 + 1).padStart(2, '0')}.png`));
    }
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ identities: results.length, errors, results }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
    console.log(JSON.stringify({ identities: results.length, errors, output }));
} finally { await browser.close(); }
