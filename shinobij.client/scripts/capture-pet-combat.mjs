import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output=resolve(import.meta.dirname,'../../docs/pet-motion-evidence/combat'); await mkdir(output,{recursive:true});
const origin=process.argv[2] ?? 'http://127.0.0.1:5199';
const browser=await chromium.launch({headless:true}); const results=[];
try {
for (const [label,viewport,query] of [
    ['desktop-owl-fox',{width:1366,height:768},'rosterpet=standard-10&enemypet=standard-0'],
    ['mobile-owl-fox',{width:390,height:844},'rosterpet=standard-10&enemypet=standard-0&petQuality=low'],
    ['desktop-3v3',{width:1366,height:768},'format=3v3'],
    ['desktop-showcase',{width:1366,height:768},'rosterpet=rare-1&enemypet=standard-7'],
    ['desktop-dodge',{width:1366,height:768},'rosterpet=standard-10&enemypet=standard-0&verdict=miss'],
]) {
    const page=await browser.newPage({viewport,reducedMotion:'no-preference'}); const errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message)); page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
    await page.route('**/api/perf-beacon',r=>r.fulfill({status:204}));
    await page.goto(`${origin}/showdownpreview.html?${query}&lifecycle=1&vfxreview=1&play=1&move=0`, {waitUntil:'domcontentloaded',timeout:90000});
    await page.locator('canvas').first().waitFor({timeout:90000});
    await page.waitForTimeout(4000);
    // Hide only the harness controls; retain the production HUD and stage.
    await page.getByRole('button',{name:'Pause review',exact:true}).locator('..').evaluate(el=>{el.style.opacity='0';el.style.pointerEvents='none';});
    const steps=[];
    for(let i=0;i<6;i++) {
        await page.screenshot({path:resolve(output,`${label}-${i}.png`)});
        steps.push(await page.locator('[data-testid="pet-showdown-root"]').evaluate(el=>({text:el.textContent?.slice(-600),rect:{width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}, overflow:document.documentElement.scrollWidth>innerWidth})));
        await page.waitForTimeout(1200);
    }
    results.push({label,errors,requests,steps}); await page.close();
}
await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({label:r.label,errors:r.errors,apiRequests:r.requests,overflow:r.steps.some(s=>s.overflow)}))));
} finally { await browser.close(); }
