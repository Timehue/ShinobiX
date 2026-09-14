// Read/interaction-only browser diagnostic against the mocked immutable preview.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../shinobij.client/node_modules/playwright/index.mjs';
import { installUiAuditRuntime, expectUiAuditBoot } from '../../../shinobij.client/e2e/helpers/ui-audit-runtime.ts';
const browser=await chromium.launch();
const rows=[];
try {
 for(const [width,height] of [[430,932],[844,390],[390,844]]) {
  const context=await browser.newContext({baseURL:'http://127.0.0.1:14640',viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage();
  const runtime=await installUiAuditRuntime(page);
  await expectUiAuditBoot(page,runtime,'worldMap');
  await page.waitForTimeout(200);
  const markers=await page.locator('.atlas-landmark').evaluateAll(elements=>elements.map(el=>{
   const box=el.getBoundingClientRect(),style=getComputedStyle(el),after=getComputedStyle(el,'::after');
   return {label:el.getAttribute('aria-label'),rect:{x:box.x,y:box.y,width:box.width,height:box.height},css:{width:style.width,height:style.height,transform:style.transform,pointerEvents:style.pointerEvents},after:{content:after.content,inset:after.inset,pointerEvents:after.pointerEvents},centerHit:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===el};
  }));
  await page.screenshot({path:fileURLToPath(new URL(`./world-map-${width}x${height}-probe.png`,import.meta.url)),fullPage:false});
  rows.push({width,height,markers});
  await context.close();
 }
} finally {await browser.close();}
fs.writeFileSync(new URL('./worldmap-probe-results.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
