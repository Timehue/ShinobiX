import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, dirname } from 'node:path';
import { build } from '../../node_modules/esbuild/lib/main.js';
await build({entryPoints:['src/chroniclepreview.tsx'], bundle:true, external:['/chronicle/*','/fonts/*'], outdir:'.chronicle-qa-out', format:'esm', jsx:'automatic', define:{'import.meta.env.DEV':'true','import.meta.env.PROD':'false','import.meta.env.MODE':'"development"'}, loader:{'.webp':'file','.png':'file','.jpg':'file','.svg':'file','.mp3':'file'}, logLevel:'warning'});
const server=createServer((req,res)=>{
  const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(url==='/') {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/chroniclepreview.css"><body style="margin:0;background:#05090d"><div id="root"></div><script type="module" src="/chroniclepreview.js"></script>');return;}
  const relative=url.slice(1);
  const file=existsSync(resolve('.chronicle-qa-out',relative))?resolve('.chronicle-qa-out',relative):resolve('public',relative);
  if(!file.startsWith(resolve('.chronicle-qa-out')+'\\')&&!file.startsWith(resolve('public')+'\\')){res.writeHead(403).end();return;}
  if(!existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
await page.goto(origin, {waitUntil:'domcontentloaded', timeout:120000});
await page.locator('.chronicle-hand .chronicle-card').first().waitFor({timeout:120000});
await page.addStyleTag({ content: '#demo-controls { display:none!important } body { margin:0 }' });
await mkdir('../docs/audits/chronicle-mobile', { recursive: true });
const results = [];
for (const [width, height] of [[320,568],[360,640],[375,667],[390,844],[412,915],[430,932],[768,1024],[844,390],[915,412],[1366,768]]) {
  await page.setViewportSize({width,height});
  await page.screenshot({path:`../docs/audits/chronicle-mobile/${width}x${height}.png`, fullPage:true});
  results.push(await page.evaluate(() => ({ width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
    handWidth:document.querySelector('.chronicle-hand .chronicle-card').getBoundingClientRect().width,
    dock:[...document.querySelectorAll('.chronicle-command-dock')].map(el => ({width:el.clientWidth,scroll:el.scrollWidth,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})),
    smallButtons:[...document.querySelectorAll('.chronicle-table button')].filter(el=>el.getBoundingClientRect().width && (el.getBoundingClientRect().height<44 || el.getBoundingClientRect().width<44)).map(el=>({text:el.textContent.trim().slice(0,40),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
  })));
  const result=results.at(-1);
  expect(result.scrollWidth).toBeLessThanOrEqual(width);
  if(width<=900 || height<=500) {
    expect(result.smallButtons).toEqual([]);
    expect(result.handWidth).toBeGreaterThanOrEqual(88);
    for(const dock of result.dock) { expect(dock.scroll).toBeLessThanOrEqual(dock.width); expect(dock.top).toBeGreaterThanOrEqual(0); expect(dock.bottom).toBeLessThanOrEqual(height); }
  }
}
const flows=[];
await page.setViewportSize({width:320,height:568});
for(const scenario of ['summon','defense','tribute','jutsu','target-jutsu','grave-jutsu','snare','attack','direct-attack']) {
  await page.goto(`${origin}/?scenario=${scenario}`);
  const hand=page.locator('.chronicle-hand .chronicle-card');
  await expect(hand).toHaveCount(6);
  if(scenario.includes('attack')) {
    await page.locator('[aria-label="Your Monster Zones"] > button').first().click();
    if(scenario==='attack') await page.locator('[aria-label="Opponent Monster Zones"] > button').first().click();
    else await page.getByRole('button',{name:/Direct Attack/}).click();
  } else {
    await hand.first().click();
    await expect(hand.first()).toHaveAttribute('aria-pressed','true');
    if(scenario==='tribute') {
      await expect(page.locator('.chronicle-decision')).toContainText('Select 1 Tribute');
      await page.locator('[aria-label="Your Monster Zones"] > button').first().click();
    }
    if(scenario==='summon'||scenario==='tribute'||scenario==='defense') {
      await page.locator('[aria-label="Your Monster Zones"] > button').nth(1).click();
      await page.getByRole('button',{name:scenario==='defense'?'Set Face-Down Defense':'Play Face-Up Attack',exact:true}).click();
    } else if(scenario==='snare') {
      await page.locator('.chronicle-zone-row.player.backrow > button').nth(1).click();
      await page.getByRole('button',{name:'Set Snare',exact:true}).click();
    } else {
      if(scenario==='target-jutsu') await page.locator('[aria-label="Your Monster Zones"] > button').first().click();
      if(scenario==='grave-jutsu') {
        await page.getByRole('button',{name:'Open Graveyard',exact:true}).click();
        await page.getByRole('button',{name:/^Choose Training Dummy/}).click();
      }
      await page.getByRole('button',{name:'Activate Jutsu',exact:true}).click();
    }
  }
  await expect(page.locator('.chronicle-error')).toHaveCount(0);
  await expect(page.locator('.chronicle-hand .selected')).toHaveCount(0);
  flows.push({scenario,action:await page.getByTestId('last-action').textContent()});
}
for(const count of [5,6,8,10]) {
  await page.goto(`${origin}/?scenario=summon&hand=${count}`);
  const hand=page.locator('.chronicle-hand .chronicle-card');
  await expect(hand).toHaveCount(count);
  for(let i=0;i<count;i++) {
    await hand.nth(i).click();
    await expect(hand.nth(i)).toHaveAttribute('aria-pressed','true');
    await expect(async()=>{
      const rect=await hand.nth(i).boundingBox();
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x+rect.width).toBeLessThanOrEqual(321);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      const dock=await page.locator('.chronicle-command-dock').boundingBox();
      expect(rect.y+rect.height).toBeLessThanOrEqual(dock.y+1);
    }).toPass();
  }
  if(count===10) await page.screenshot({path:'../docs/audits/chronicle-mobile/selected-hand-320.png'});
  await hand.last().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog=await page.getByRole('dialog').boundingBox();
  expect(dialog.y).toBeGreaterThanOrEqual(0);
  expect(dialog.y+dialog.height).toBeLessThanOrEqual(568);
  if(count===10) await page.screenshot({path:'../docs/audits/chronicle-mobile/inspector.png'});
  await page.getByRole('button',{name:'Close card details',exact:true}).click();
  await expect(hand.last()).toBeFocused();
  flows.push({scenario:'hand-inspection',count});
}
for(const response of ['activate','pass','other']) {
  await page.goto(`${origin}/?scenario=response${response==='other'?'-other':''}`);
  if(response==='other') {
    await expect(page.locator('.chronicle-response-waiting')).toContainText('Keeper is deciding');
    await expect(page.getByRole('button',{name:'Pass',exact:true})).toHaveCount(0);
  } else {
    const group=page.getByRole('group',{name:'Snare response'});
    await expect(group).toBeVisible();
    await group.getByRole('button',{name:response==='pass'?'Pass':/^Activate /}).click();
    await expect(page.locator('.chronicle-error')).toHaveCount(0);
    await expect(group).toHaveCount(0);
  }
  flows.push({scenario:`response-${response}`});
}
await page.goto(`${origin}/?library=collection`);
await page.setViewportSize({width:390,height:844});
await page.getByRole('searchbox').fill('Stone Turtle');
await expect(page.locator('.chronicle-collection > button')).toHaveCount(1);
await page.locator('.chronicle-collection > button').click();
await expect(page.getByRole('dialog')).toBeVisible();
await page.getByRole('button',{name:'Close card details',exact:true}).click();
await page.getByRole('searchbox').fill('');
await page.locator('.chronicle-card-filters summary').click();
await page.getByLabel('Class',{exact:true}).selectOption('trap');
await expect(page.locator('.chronicle-card-filters summary')).toHaveText('Filters (1)');
await page.getByRole('button',{name:'Clear filters',exact:true}).click();
await page.locator('.chronicle-card-filters summary').click();
await page.screenshot({path:'../docs/audits/chronicle-mobile/collection.png'});
flows.push({scenario:'collection-search-filter-inspect'});
await page.goto(`${origin}/?library=deck`);
await expect(page.locator('.chronicle-deck-status > button')).toBeDisabled();
await page.getByRole('searchbox').fill('Stone Turtle');
await page.getByRole('button',{name:'Add Stone Turtle to your deck',exact:true}).click();
await expect(page.getByRole('button',{name:'Add Stone Turtle to your deck',exact:true})).toBeDisabled();
await page.getByRole('button',{name:'My Deck',exact:true}).click();
await expect(page.locator('.chronicle-deck__row')).toHaveCount(1);
await page.getByRole('button',{name:'Stone Turtle',exact:true}).click();
await expect(page.getByRole('dialog')).toBeVisible();
await expect(page.getByRole('button',{name:'Add to Deck',exact:true})).toBeDisabled();
await page.getByRole('button',{name:'Close card details',exact:true}).click();
await page.getByRole('button',{name:'Remove one Stone Turtle',exact:true}).click();
await expect(page.locator('.chronicle-deck__row')).toHaveCount(0);
await page.getByRole('button',{name:'Collection',exact:true}).click();
await page.getByRole('searchbox').fill('Leaf Cat');
for(let i=0;i<3;i++) await page.getByRole('button',{name:'Add Leaf Cat to your deck',exact:true}).click();
await expect(page.getByRole('button',{name:'Add Leaf Cat to your deck',exact:true})).toBeDisabled();
await page.getByRole('button',{name:'My Deck',exact:true}).click();
await page.getByRole('button',{name:'Restore Migrated Deck',exact:true}).click();
await expect(page.locator('.chronicle-deck-status strong')).toHaveText('DECK 40 / 40');
await page.locator('.chronicle-deck-status > button').click();
await expect(page.getByTestId('saved-deck')).toHaveText('40');
await page.screenshot({path:'../docs/audits/chronicle-mobile/deck.png'});
flows.push({scenario:'deck-search-owned-limit-inspect-add-remove-complete-save'});
await page.goto(`${origin}/?scenario=attack`);
await page.locator('[aria-label="Opponent Monster Zones"] > button').first().click();
await expect(page.getByRole('dialog')).toBeVisible();
await page.keyboard.press('Escape');
await page.locator('[aria-label="Your Monster Zones"] > button').first().click();
await page.screenshot({path:'../docs/audits/chronicle-mobile/targeting.png'});
await page.locator('[aria-label="Your Monster Zones"] > button').first().click();
await expect(page.getByRole('dialog')).toBeVisible();
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Open your Graveyard, 2 cards',exact:true}).click();
await page.getByRole('button',{name:'Read Training Dummy',exact:true}).click();
await expect(page.getByRole('dialog',{name:'Training Dummy card details',exact:true})).toBeVisible();
await page.keyboard.press('Escape');
await expect(page.getByRole('dialog')).toBeVisible();
await page.keyboard.press('Escape');
flows.push({scenario:'field-and-graveyard-inspection-nested-dialog-escape'});
await page.goto(`${origin}/?scenario=busy`);
await expect(page.getByRole('button',{name:'End Turn',exact:true})).toBeDisabled();
await expect(page.locator('.chronicle-decision')).toContainText('Resolving');
await page.goto(`${origin}/?scenario=error`);
await expect(page.getByRole('alert')).toContainText('Try again');
await page.goto(`${origin}/?tutorial=1`);
await page.getByRole('button',{name:'Enter the Card Hall',exact:true}).click();
await expect(page.getByRole('searchbox')).toBeVisible();
flows.push({scenario:'busy-error-tutorial'});
await page.goto(`${origin}/?fixture=1`);
const fixture=JSON.parse(await page.getByTestId('fixture').textContent());
await page.addInitScript(()=>{
  for(const key of ['clanWarChallenge.v1','sectorWarCard.v1','cardClashFreePlay.v1']) sessionStorage.setItem(key,JSON.stringify({matchId:'mobile-qa',playerName:'Akari'}));
});
for(const host of ['clan','sector','pvp','ai','echoes']) {
  const requests=[];
  await page.route('**/api/**',async route=>{
    const body=route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({json:{ok:true,matchId:'mobile-qa',session:{...fixture,matchId:'mobile-qa',phase:body?.action==='enter-end-phase'?'main2':'main1'}}});
  });
  await page.goto(`${origin}/?host=${host}`);
  await expect(page.locator('.chronicle-shell--duel-active')).toBeVisible();
  await page.getByRole('button',{name:'End Turn',exact:true}).click();
  await expect.poll(()=>requests.some(body=>body?.action==='enter-end-phase')).toBe(true);
  await expect(page.locator('.chronicle-mobile-phase')).toContainText('Main Phase 2');
  await expect(page.locator('.chronicle-error')).toHaveCount(0);
  await page.unroute('**/api/**');
  flows.push({scenario:`host-${host}-request-and-projection`});
}
expect(errors).toEqual([]);
await writeFile('../docs/audits/chronicle-mobile/layout.json',JSON.stringify({results,errors,flows},null,2));
await rm('../docs/audits/chronicle-mobile/failure.png',{force:true});
console.log(JSON.stringify({viewports:results.length,flows:flows.length,errors},null,2));
} catch (error) {
  await page.screenshot({path:'../docs/audits/chronicle-mobile/failure.png'});
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
await browser.close();
server.closeAllConnections();
server.close();
const buildOutput=resolve('.chronicle-qa-out');
if(dirname(buildOutput)!==resolve(process.cwd())) throw new Error('QA cleanup must stay inside the client workspace');
await rm(buildOutput,{recursive:true,force:true});
}
