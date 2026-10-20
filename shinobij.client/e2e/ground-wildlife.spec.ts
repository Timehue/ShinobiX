import {test,expect,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {GROUND_HABITATS,groundSightingAt,type GroundHabitat} from '../src/lib/sector-ground-wildlife';
import {lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWorldNight} from '../../shared/world-phase';
import {isWalkableTile} from '../../shared/sector-walk-mask';

const evidence=resolve('../output/living-world/wildlife/browser');mkdirSync(evidence,{recursive:true});
declare global {interface Window{groundQa:{draws:number;frames:{ms:number;draws:number}[];last?:number[]}}}
function sightingTime(h:GroundHabitat){
 const day=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS,preferred=(h.night?22:11)*WORLD_HOUR_MS;
 for(let i=0;i<WORLD_DAY_MS;i+=1000){const now=day+(preferred+i)%WORLD_DAY_MS,s=groundSightingAt(h.sector,now,h.night);if(isWorldNight(now)===h.night&&s&&now>s.start+5000&&now<s.end-30_000)return now;}
 throw Error(`No reviewed sighting time for ${h.species}`);
}
function standingTiles(h:GroundHabitat){return Array.from({length:144},(_,tile)=>({tile,distance:Math.hypot(tile%12+.5-h.x*12,Math.floor(tile/12)+.5-h.y*12)})).filter(p=>isWalkableTile(h.sector,p.tile));}
async function installDrawProbe(page:Page){
 await page.addInitScript(()=>{
  window.groundQa={draws:0,frames:[]};let painting=false,active=false,draws=0;
  const request=window.requestAnimationFrame.bind(window),clear=CanvasRenderingContext2D.prototype.clearRect,draw=CanvasRenderingContext2D.prototype.drawImage;
  window.requestAnimationFrame=callback=>request(time=>{const start=performance.now();active=true;painting=false;draws=0;try{callback(time);}finally{if(painting&&window.groundQa.frames.length<5000)window.groundQa.frames.push({ms:performance.now()-start,draws});active=false;}});
  CanvasRenderingContext2D.prototype.clearRect=function(...args){if(active&&this.canvas.classList.contains('scene-critters-canvas'))painting=true;return clear.apply(this,args);};
  CanvasRenderingContext2D.prototype.drawImage=function(...args:Parameters<typeof draw>){
   const image=args[0];if(image instanceof HTMLImageElement&&image.src.includes('/sector-life/wildlife/ground-fauna-v1.webp')){
    window.groundQa.draws++;draws++;window.groundQa.last=args.slice(1) as number[];
   }
   return draw.apply(this,args);
  };
 });
}
async function openSite(page:Page,h:GroundHabitat,options:{missing?:boolean;lite?:boolean}={}){
 const now=sightingTime(h),sites=standingTiles(h).filter(p=>p.distance>=2.4&&p.distance<=3.4).sort((a,b)=>Math.abs(a.distance-2.7)-Math.abs(b.distance-2.7));expect(sites.length).toBeGreaterThan(0);
 await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);await installDrawProbe(page);
 const save=uiAuditSave();save.currentSector=h.sector;save.currentTile=sites[0].tile;save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([h.sector],now)};
 await installUiAuditRuntime(page,save);
 await page.addInitScript(lite=>{localStorage.setItem('liteFx.v1',lite?'1':'0');localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45]));},!!options.lite);
 let requests=0;
 await page.route('**/sector-life/wildlife/ground-fauna-v1.webp*',async route=>{requests++;if(options.missing)await route.abort();else await route.continue();});
 await page.route('**/api/sector/life**',route=>route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(h.sector,parseLifeState(null,now),now,'clear')}}));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${h.sector}`,exact:false});
 await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
 await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');
 const canvas=page.locator(`[data-world-chunk="${h.sector}"] .sector-life-wildlife canvas`);await expect(canvas).toBeVisible();
 if(!options.missing){await expect(canvas).toHaveAttribute('data-ground-species',h.species);await expect.poll(()=>page.evaluate(()=>window.groundQa.draws)).toBeGreaterThan(0);}
 await page.clock.setSystemTime(now);await page.clock.runFor(1000);
 return {now,canvas,errors,requests:()=>requests};
}

for(const habitat of GROUND_HABITATS)test(`painted ${habitat.species}: idle, native-player approach and cover`,async({page},info)=>{
 const {canvas,errors,requests}=await openSite(page,habitat);
 await expect(canvas).toHaveAttribute('data-ground-action','idle');
 await page.locator('.continuous-world-map').screenshot({path:resolve(evidence,`${info.project.name}-${habitat.species}-native-idle.png`)});
 const target=standingTiles(habitat).sort((a,b)=>a.distance-b.distance)[0];expect(target.distance).toBeLessThan(1.6);
 await page.locator(`[data-world-chunk="${habitat.sector}"] > button.scene-tile`).nth(target.tile).dispatchEvent('click');
 for(let i=0;i<70&&await canvas.getAttribute('data-ground-action')==='idle';i++)await page.clock.runFor(50);
 await expect(canvas).toHaveAttribute('data-ground-action','escaping');
 await page.locator('.continuous-world-map').screenshot({path:resolve(evidence,`${info.project.name}-${habitat.species}-native-escape.png`)});
 await page.clock.runFor(6000);await expect(canvas).toHaveAttribute('data-ground-action','hidden');
 const stats=await page.evaluate(()=>window.groundQa);expect(stats.frames.every(f=>f.draws<=1)).toBe(true);expect(requests()).toBe(1);expect(errors).toEqual([]);
 writeFileSync(resolve(evidence,`${info.project.name}-${habitat.species}-native-draws.json`),JSON.stringify({draws:stats.draws,maximumPerFrame:Math.max(...stats.frames.map(f=>f.draws)),requests:requests()},null,2));
});

test('hidden tabs and a real combat-cover signal stop ground drawing',async({page})=>{
 const {canvas,errors}=await openSite(page,GROUND_HABITATS[0]);await expect(canvas).toHaveAttribute('data-ground-action','idle');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 const hidden=await page.evaluate(()=>window.groundQa.draws);await page.clock.runFor(1500);expect(await page.evaluate(()=>window.groundQa.draws)).toBe(hidden);
 await page.evaluate(()=>{delete (document as unknown as {hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(200);expect(await page.evaluate(()=>window.groundQa.draws)).toBeGreaterThan(hidden);
 await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';cover.id='wildlife-cover-probe';document.body.append(cover);});await page.clock.runFor(100);
 const covered=await page.evaluate(()=>window.groundQa.draws);await page.clock.runFor(1500);expect(await page.evaluate(()=>window.groundQa.draws)).toBe(covered);
 await page.evaluate(()=>document.getElementById('wildlife-cover-probe')!.remove());await page.clock.runFor(200);expect(await page.evaluate(()=>window.groundQa.draws)).toBeGreaterThan(covered);expect(errors).toEqual([]);
});

test('reduced motion keeps one static animal and does not add a frame loop',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const {errors}=await openSite(page,GROUND_HABITATS[2]);
 const start=await page.evaluate(()=>({draws:window.groundQa.draws,frames:window.groundQa.frames.length}));await page.clock.runFor(2500);
 const end=await page.evaluate(()=>window.groundQa);expect(end.frames.length).toBe(start.frames);expect(end.draws-start.draws).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});

test('missing wildlife art leaves the loaded world usable',async({page})=>{
 const {canvas,errors,requests}=await openSite(page,GROUND_HABITATS[0],{missing:true});await page.clock.runFor(1500);
 expect(requests()).toBe(1);expect(await page.evaluate(()=>window.groundQa.draws)).toBe(0);await expect(canvas).toBeVisible();expect(errors).toEqual([]);
});
