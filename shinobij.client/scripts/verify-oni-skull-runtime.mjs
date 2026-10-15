import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.argv.find(a => a.startsWith('--base-url='))?.slice(11) ?? 'http://127.0.0.1:5207';
const original = process.argv.includes('--original');
const output = resolve(import.meta.dirname, '../.tmp/oni-runtime', original ? 'before' : 'after');
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true});
const results = [], errors = [];
try {
    for (const mobile of [false,true]) {
        const page = await browser.newPage({ viewport:mobile ? {width:390,height:844} : {width:900,height:700} });
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`${base}/petmotionpreview.html?pet=mythic-4&view=front&skullProbe=1&quality=${mobile?'low':'medium'}${original?'&original':''}`);
        await page.waitForFunction(()=>Number(document.querySelector('canvas')?.dataset.skullVertices)>5000);
        let peak = 0;
        const read = async () => {
            const drift = Number(await page.locator('canvas').getAttribute('data-max-skull-drift'));
            if (!Number.isFinite(drift)) throw Error('Missing rendered skull metrics'); peak=Math.max(peak,drift);
            if (!original && drift>.00002) throw Error(`Rendered skull deformed by ${drift}`);
        };
        for (const motion of ['idle','run','dash','windup','strike','recover','stagger','dodge','guard','rest','dead','idle']) {
            await page.getByLabel('Motion',{exact:true}).selectOption(motion);
            for(let tick=0;tick<5;tick++){ await page.waitForTimeout(100); await read(); }
            await page.screenshot({path:resolve(output,`${mobile?'mobile':'desktop'}-${motion}.png`)});
        }
        await page.getByRole('button',{name:'Attack sequence',exact:true}).click();
        for(let tick=0;tick<30;tick++){await page.waitForTimeout(100);await read();}
        await page.getByRole('button',{name:'Victory',exact:true}).click();
        for(let tick=0;tick<10;tick++){await page.waitForTimeout(100);await read();}
        results.push({mobile,peak,quality:mobile?'low':'medium'});await page.close();
    }
    if(errors.length)throw Error(errors.join('\n'));
    if(original && !results.some(r=>r.peak>.005))throw Error('Original reproduction did not expose the reported distortion');
    await writeFile(resolve(output,'report.json'),JSON.stringify({original,results,errors},null,2)+'\n');console.log(JSON.stringify({original,results,errors}));
}finally{await browser.close();}
