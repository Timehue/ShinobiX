import { chromium } from '@playwright/test';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const label = process.argv[2] ?? 'before';
const videoMode = process.argv[3] === 'video';
const output = resolve(import.meta.dirname, '../../docs/pet-motion-evidence', label);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const results = [];
try {
for (const [pet, mobile] of [['standard-10',false],['standard-0',false],['standard-1',false],['starter-lightning-l',false],['standard-10',true]]) {
    if (videoMode && (mobile || !['standard-10','standard-0'].includes(pet))) continue;
    const viewport = mobile ? {width:390,height:844} : {width:1100,height:760};
    const page = await browser.newPage({viewport, reducedMotion:'no-preference', ...(videoMode ? {recordVideo:{dir:output,size:viewport}} : {})});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:5199/petmotionpreview.html?pet=${pet}&quality=${mobile?'low':'medium'}`, {waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(() => Object.keys(JSON.parse(document.querySelector('canvas')?.dataset.bones ?? '{}')).length > 10, undefined, {timeout:90000});
    await page.waitForTimeout(300);
    const sample = async state => {
        const expected=state.startsWith('dodge-')?'dodge':state==='run'?'run':state==='contact'?'strike':state==='defeat'?'dead':'idle';
        if(await page.getByLabel('Motion').inputValue()!==expected) throw Error(`Preview reset during ${state}`);
        const name = `${pet}-${mobile?'mobile':'desktop'}-${state}`; await page.screenshot({path:resolve(output,`${name}.png`)});
        return {state, ...(await page.locator('canvas').evaluate(c => ({bones:JSON.parse(c.dataset.bones),calls:Number(c.dataset.renderCalls),triangles:Number(c.dataset.renderTriangles)})))};
    };
    const frozenChecks=[];
    const assertFrozen=async state=>{
        await page.getByRole('button',{name:'Pause',exact:true}).click();
        await page.waitForTimeout(100);
        const before=await page.locator('canvas').getAttribute('data-bones');
        await page.waitForTimeout(300);
        if(before!==await page.locator('canvas').getAttribute('data-bones')) throw Error(`Frozen host pose drifted during ${state}`);
        frozenChecks.push(state);
        await page.getByRole('button',{name:'Resume',exact:true}).click();
    };
    const samples = [await sample('idle')];
    await assertFrozen('idle');
    await page.getByLabel('Motion').selectOption('run'); await page.waitForTimeout(500); samples.push(await sample('run'));
    for (let cycle=0;cycle<3;cycle++) { await page.getByLabel('Motion').selectOption('dodge'); await page.waitForTimeout(350); samples.push(await sample(`dodge-${cycle}`)); await page.getByLabel('Motion').selectOption('idle'); await page.waitForTimeout(350); }
    samples.push(await sample('idle-after-dodges'));
    await page.getByLabel('Motion').selectOption('strike'); await page.waitForTimeout(200); samples.push(await sample('contact')); await assertFrozen('contact');
    await page.getByLabel('Motion').selectOption('dead'); await page.waitForTimeout(1600); samples.push(await sample('defeat'));
    await page.getByLabel('Motion').selectOption('idle'); await page.getByRole('button',{name:'Victory',exact:true}).click(); await page.waitForTimeout(900); samples.push(await sample('victory'));
    await assertFrozen('victory');
    results.push({pet,mobile,errors,frozenChecks,samples}); const video=page.video(); await page.close();
    if(video) await rename(await video.path(),resolve(output,`${pet}-motion.webm`));
}
await writeFile(resolve(output,'render-results.json'), JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r => ({pet:r.pet,mobile:r.mobile,errors:r.errors,calls:r.samples[0].calls,triangles:r.samples[0].triangles}))));
} finally { await browser.close(); }
