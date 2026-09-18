import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
await page.addInitScript(()=>localStorage.setItem('vnTextSpeed.v1','instant'));
await page.goto('http://127.0.0.1:4173/?preview=vn&event=story-interlude-moonshadow-village-80&page=0&line=0');
await page.locator('.cvn-root').waitFor();
await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
const info=await page.locator('.cvn-actor img').evaluate(node=>{
 const s=getComputedStyle(node), p=getComputedStyle(node.parentElement);
 return Object.fromEntries(['backgroundColor','backgroundImage','boxShadow','filter','mixBlendMode','maskImage','opacity','border'].map(k=>[k,{img:s[k],parent:p[k]}]));
});
await writeFile('../tmp/vn-art-audit/portrait-diagnosis.json',JSON.stringify(info,null,2));
await page.addStyleTag({content:'.cvn-root.is-moonshadow .cvn-actor img { filter: drop-shadow(0 22px 25px rgba(0,0,0,.72)); }'});
await page.screenshot({path:'../tmp/vn-art-audit/harrow-no-glow.png'});
await page.addStyleTag({content:'.cvn-root.is-moonshadow .cvn-actor img { background:transparent; box-shadow:none; }'});
await page.screenshot({path:'../tmp/vn-art-audit/harrow-no-matte.png'});
console.log(info);
await browser.close();
