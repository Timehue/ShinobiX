import { chromium, webkit } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5199';
const out = new URL('../../.tmp/sunscar-mobile-ux-qa/', import.meta.url);
await mkdir(out, { recursive: true });
const report = { checks: [], errors: [] };
async function measure(page, label, selector = '.sunscar-mode') {
  const result = await page.locator(selector).evaluate(root => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right }; };
    const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility !== 'hidden'; };
    const controls = [...root.querySelectorAll('button, select, summary')].filter(visible);
    return {
      viewport:[innerWidth,innerHeight], scrollY, overflow:document.documentElement.scrollWidth > innerWidth + 1,
      smallTargets:controls.filter(e => { const r=e.getBoundingClientRect(); return r.width<44 || r.height<44; }).map(e=>({text:e.getAttribute('aria-label') || e.textContent.trim().slice(0,80), ...rect(e)})),
      race:root.querySelector('.rally-stage') ? {stage:rect(root.querySelector('.rally-stage')),controls:rect(root.querySelector('.rally-controls')),hud:rect(root.querySelector('.rally-hud'))} : null,
      inspected:root.querySelector('.caravan-next-stop') ? rect(root.querySelector('.caravan-next-stop')) : null,
      brokenImages:[...root.querySelectorAll('img')].filter(e=>e.complete&&!e.naturalWidth).map(e=>e.src),
    };
  });
  report.checks.push({ label, ...result });
  console.log(label, JSON.stringify(result));
  await page.screenshot({path:fileURLToPath(new URL(label+'.png',out)),fullPage:false});
  assert.equal(result.overflow, false, label + ': page must fit the viewport');
  assert.deepEqual(result.smallTargets, [], label + ': touch targets must be at least 44 × 44');
  assert.deepEqual(result.brokenImages, [], label + ': art must load');
  if (result.race) for (const [name,r] of Object.entries(result.race)) {
    assert.ok(r.y >= -1 && r.bottom <= result.viewport[1] + 1, label + ': ' + name + ' must remain in view');
  }
  if (result.inspected) assert.ok(result.inspected.y >= 0 && result.inspected.bottom <= result.viewport[1] + 1, label + ': selected road and travel action must be visible');
}
for (const [browserName, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({headless:true,...browserName==='chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {}});
  try {
    for (const [width,height] of [[320,568],[390,844],[844,390],[768,1024]]) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
      const page=await context.newPage(); page.setDefaultTimeout(45000);
      const label=browserName+'-'+width+'x'+height;
      page.on('pageerror',e=>report.errors.push({label,message:e.message}));
      await page.request.post(base+'/__qa/reset');
      await page.goto(base+'/sunscar-modes-qa.html');
      await page.getByRole('button',{name:'Visit the race grounds'}).waitFor();
      await measure(page,label+'-hub');
      await page.getByRole('button',{name:'Visit the race grounds'}).click();
      await page.getByRole('button',{name:'Practice selected course'}).waitFor();
      await measure(page,label+'-rally-desk');
      if (width===320 || width===844) {
        await page.getByRole('button',{name:'Practice selected course'}).click();
        await page.getByRole('button',{name:'Ready to race'}).waitFor({state:'visible',timeout:120000});
        await measure(page,label+'-race-entry');
        await page.getByRole('button',{name:'Ready to race'}).click({timeout:120000});
        await page.getByRole('button',{name:'Pause race'}).waitFor();
        await page.waitForFunction(()=>!document.querySelector('.rally-pause')?.disabled);
        await measure(page,label+'-race-running');
        await page.getByRole('button',{name:'Steer left, A or Left Arrow'}).tap();
        await page.getByRole('button',{name:'Jump, Space'}).tap();
        await page.getByRole('button',{name:'Pause race'}).tap();
        await measure(page,label+'-race-paused');
        await page.getByRole('button',{name:'Continue race'}).focus();
        await page.keyboard.press('Space');
        await page.locator('.rally-pause-overlay').waitFor({state:'hidden'});
        await page.keyboard.press('Escape');
        await page.locator('.rally-pause-overlay').waitFor();
        await page.getByRole('button',{name:'Save & return'}).click();
        assert.equal(await page.evaluate(()=>document.body.classList.contains('ui-scroll-locked')),false,'race exit releases the existing body scroll lock');
      }
      await page.getByRole('button',{name:/Festival$/}).click();
      await page.getByRole('button',{name:'Read today’s contracts'}).click();
      await page.getByRole('button',{name:'Accept contract & depart'}).waitFor();
      await measure(page,label+'-contracts');
      if(width===390) {
        const audit=await new AxeBuilder({page}).include('.sunscar-mode').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        report.checks.push({label:label+'-contract-accessibility',violations:audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
        assert.deepEqual(audit.violations, [], 'No automated accessibility violations');
      }
      await page.getByRole('button',{name:'Accept contract & depart'}).click();
      await page.getByRole('heading',{name:'Choose the next road'}).waitFor();
      await measure(page,label+'-departure');
      await page.getByRole('button',{name:'Route map',exact:true}).click();
      await page.locator('.caravan-map-node.is-available').first().click();
      await measure(page,label+'-map-inspection');
      await page.getByRole('button',{name:'Travel to this stop'}).click();
      await page.locator('.caravan-choices button').first().waitFor();
      await measure(page,label+'-encounter');
      await page.locator('.caravan-choices button:enabled').first().click();
      await page.getByRole('button',{name:'← Festival grounds'}).click();
      await page.getByRole('button',{name:'Rejoin your caravan'}).click();
      await page.locator('.caravan-manifest').waitFor();
      await measure(page,label+'-resume');
      await context.close();
    }
  } finally {await browser.close();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));}
}
if(report.errors.length)throw new Error(JSON.stringify(report.errors));
