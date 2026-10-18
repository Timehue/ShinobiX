import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';

const argument = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const filter = argument('model')?.split(',');
const label = argument('label', 'source'), base = argument('base-url', 'http://127.0.0.1:5207');
const candidate = argument('asset');
const candidateRoot = argument('asset-root');
const headViews = process.argv.includes('--head');
const views = headViews ? ['head-front','head-side',...(process.argv.includes('--opposite-head-side')?['head-other-side']:[])] : ['front','side'];
if(process.argv.includes('--opposite-head-side')&&!headViews)throw Error('--opposite-head-side requires --head');
const tightBody = process.argv.includes('--tight-body');
const independentFaces = process.argv.includes('--independent-faces');
const productionDiffuse = process.argv.includes('--production-diffuse');
const phases=argument('progress','0,.25,.5,.75,1').split(',').map(Number);
if(phases.length<2||phases.some(p=>!Number.isFinite(p)||p<0||p>1))throw Error('Invalid capture progress values');
const width=phases.length*320;
// Camera-only region files let reviewers examine each face of a multi-headed pet
// independently without changing its repair mask or hiding the full-body review.
const regionFile = argument('region-file');
const regions = headViews ? JSON.parse(await readFile(regionFile ? resolve(regionFile) : resolve(import.meta.dirname,independentFaces?'pet-independent-face-landmarks.json':'pet-skull-regions.json'),'utf8')).pets : {};
const selected=runtimePetModels.filter(row=>!filter||filter.includes(row.pet.id));
if(!selected.length||filter?.some(id=>!selected.some(row=>row.pet.id===id)))throw Error('Empty or incomplete pet selection');
if (candidate && (!filter || filter.length !== 1)) throw Error('--asset needs one --model');
const output = resolve(import.meta.dirname, '../.tmp/pet-shape-review', label); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 320, height: 320 }, ignoreHTTPSErrors: process.argv.includes('--ignore-https-errors') });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/petshapeaudit.html`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(() => !!window.petShapeAudit,{},{timeout:120000});
    for (const row of selected) {
        const url = candidate ?? (candidateRoot ? `${candidateRoot}${new URL(row.model.url,'https://local.invalid').pathname.slice('/pet-models'.length)}` : row.model.url);
        const model = await page.evaluate(async ({ url, yaw }) => window.petShapeAudit.load(url, yaw), { url, yaw: row.model.yawOffset });
        const materialTreatment = productionDiffuse ? await page.evaluate(() => window.petShapeAudit.productionDiffuseMaterials()) : null;
        if(headViews) {
            if(!regions[row.pet.id])throw Error(`${row.pet.id}: skull region not defined`);
            const annotation=regions[row.pet.id];
            if(independentFaces&&(!annotation.geometrySha256||!annotation.landmarks))throw Error(`${row.pet.id}: independently reviewed anatomical framing missing`);
            await page.evaluate(config => window.petShapeAudit.region(config),annotation.camera??annotation);
        }
        const sheets = [];
        for (const view of views) {
            const cells = [];
            for (const [r, clip] of model.clips.entries()) for (const [c, progress] of phases.entries()) {
                const renderView=!headViews&&tightBody?`body-${view}`:view;
                const data = await page.evaluate(({ clip, progress, view }) => window.petShapeAudit.render(clip, progress, view), { clip: clip.name, progress, view:renderView });
                cells.push({ input: Buffer.from(data.split(',')[1], 'base64'), left: c * 320, top: r * 344 + 24 });
            }
            // Labels are fixed animation names. Never interpolate asset/user text into SVG.
            const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
            const labels = `<svg width="${width}" height="${model.clips.length * 344}">${model.clips.map((clip, i) => `<text x="8" y="${i * 344 + 18}" fill="white" font-family="sans-serif" font-size="16">${xml(clip.name)} | ${phases.map(p=>`${p*100}%`).join(', ')} | ${view}</text>`).join('')}</svg>`;
            const name = `${row.pet.id}-${view}.webp`;
            await sharp({ create: { width, height: model.clips.length * 344, channels: 3, background: '#101726' } }).composite([...cells, { input: Buffer.from(labels), left: 0, top: 0 }]).webp({ quality: 85 }).toFile(resolve(output, name));
            sheets.push(name);
        }
        const pathname=new URL(url,'https://local.invalid').pathname;
        const capturedPath=pathname.startsWith('/.tmp/') ? resolve(import.meta.dirname,'..',`.${pathname}`) : resolve(import.meta.dirname,'../public',`.${pathname}`);
        const finalSha256=createHash('sha256').update(await readFile(capturedPath)).digest('hex');
        if(finalSha256!==model.sha256)throw Error(`${row.pet.id}: model changed while its clips were being captured`);
        results.push({ id: row.pet.id, name: row.pet.name, url, sha256:model.sha256,
            clips: model.clips.map(c => c.name), progress: phases, views,
            ...(productionDiffuse ? { materialTreatment: { mode: 'production-diffuse', ...materialTreatment } } : {}),
            ...(headViews?{region:regions[row.pet.id].camera??regions[row.pet.id]}:{}),sheets, review: 'pending' });
        if(headViews&&regions[row.pet.id].landmarks)results.at(-1).anatomySha256=createHash('sha256').update(JSON.stringify(regions[row.pet.id])).digest('hex');
        if(!headViews&&tightBody)results.at(-1).framing='complete posed body bounds; camera follows pose without excluding any mesh vertices';
        if (results.length % 10 === 0) console.log(`Captured all clips: ${results.length} pet identities`);
    }
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ schema: 1, errors, pets: results, artisticCertification: false }, null, 2) + '\n');
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    await writeFile(resolve(output, 'index.html'), `<!doctype html><html><meta charset="utf-8"><title>Pet animation review</title><style>body{background:#101726;color:white;font:16px system-ui}img{width:100%;max-width:1600px}details{margin:20px}summary{cursor:pointer}</style><h1>Every pet, every clip</h1><p>Front and side, ${phases.length} phases including the terminal pose. Pending review is not approval. Numeric findings and model hashes are retained separately.</p>${results.map(p => `<details><summary>${escape(p.name)} · ${escape(p.id)} · pending review</summary>${p.sheets.map(s => `<a href="${s}">${s}</a><img loading="lazy" src="${s}">`).join('')}</details>`).join('')}</html>`);
    console.log(JSON.stringify({ identities: results.length, frames: results.reduce((n, p) => n + p.clips.length * phases.length * views.length, 0), errors, output }));
    if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
