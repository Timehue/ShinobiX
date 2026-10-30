import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out=new URL('../../.tmp/warfront-garden/',import.meta.url);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
    for(const [name,width,height] of [['landscape',1280,720],['portrait',720,1600]]) {
        const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
        await page.goto('http://127.0.0.1:19984/scripts/warfront-terrain/garden.html');
        await page.locator('canvas[data-ready="true"]').waitFor();
        await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
        await page.close();
    }
} finally {await browser.close();}
