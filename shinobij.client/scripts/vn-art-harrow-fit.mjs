import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-proxy-server']});
for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('vnTextSpeed.v1','instant'));
 await page.goto('http://127.0.0.1:4173/?preview=vn&event=story-reckoning-harrow-unbought&page=0&line=0');
 await page.locator('.cvn-root').waitFor();
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
 console.log(width,await page.locator('.cvn-actor img').evaluate(n=>({image:n.getBoundingClientRect().toJSON(),parent:n.parentElement.getBoundingClientRect().toJSON()})));
 await page.addStyleTag({content:'.cvn-actor:not(.is-player) img[src*="/portraits/cinematic/kite-harrow.webp"] {object-fit:cover;object-position:50% 0%;}'});
 await page.screenshot({path:`../tmp/vn-art-audit/harrow-fit-${width}.png`});
 await page.close();
}
await browser.close();
