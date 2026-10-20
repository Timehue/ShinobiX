import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {MOONWELL_MOTH_LAMPS} from '../src/lib/sector-local-fauna';
import {SECTOR_FLOOR_LAYOUTS} from '../../shared/sector-floor-layouts';
import {sectorArtKey} from '../../shared/sector-geo';
const evidence='../output/living-world/local-fauna/browser';mkdirSync(evidence,{recursive:true});
type Kind='gull'|'moth';
type Probe={draws:Record<Kind,number>;max:Record<Kind,number>;points:Record<Kind,{x:number;y:number}[]>};
declare global{interface Window{localFaunaQa:Probe}}
async function probe(page:Page){await page.addInitScript(()=>{
    window.localFaunaQa={draws:{gull:0,moth:0},max:{gull:0,moth:0},points:{gull:[],moth:[]}};
    const clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fill;
    const frames=new WeakMap<CanvasRenderingContext2D,Record<'gull'|'moth',Set<string>>>();
    CanvasRenderingContext2D.prototype.clearRect=function(...args){
        if(this.canvas.closest('.sector-life-wildlife'))frames.set(this,{gull:new Set(),moth:new Set()});return clear.apply(this,args);
    };
    CanvasRenderingContext2D.prototype.fill=function(...args:Parameters<typeof fill>){
        const frame=frames.get(this),color=String(this.fillStyle),kind=['#d9ded8','#cdd4cf'].includes(color)?'gull':['#c6bda9','#b8b2a4'].includes(color)?'moth':undefined;
        if(frame&&kind){
            const matrix=this.getTransform(),p={x:matrix.e/this.canvas.width,y:matrix.f/this.canvas.height},s=window.localFaunaQa;
            frame[kind].add(`${p.x.toFixed(5)}:${p.y.toFixed(5)}`);s.draws[kind]++;s.max[kind]=Math.max(s.max[kind],frame[kind].size);
            if(s.points[kind].length<200)s.points[kind].push(p);
        }
        return fill.apply(this,args);
    };
});}
const reset=(page:Page)=>page.evaluate(()=>{window.localFaunaQa={draws:{gull:0,moth:0},max:{gull:0,moth:0},points:{gull:[],moth:[]}};});
const stats=(page:Page)=>page.evaluate(()=>window.localFaunaQa);
async function open(page:Page,sector:number,night:boolean,lite:boolean,missing=false){
    const now=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS+(night?21:9)*WORLD_HOUR_MS;
    await page.emulateMedia({reducedMotion:lite?'reduce':'no-preference'});await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);await probe(page);
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=sector===23?112:88;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let stage:'supported'|'radiant'|'dormant'='supported',requests=0;const errors:string[]=[],urls:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>urls.push(request.url()));
    if(missing)await page.route('**/sector-life/moonwell-supported-shrine-v1.webp*',async route=>{requests++;await route.abort();});
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector,ownerClan:'LocalFaunaReview',weather:'clear',hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        const at=await page.evaluate(()=>Date.now()),memory={tier:stage==='radiant'?2:stage==='supported'?1:0,maintainedAt:0,by:''};
        await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(sector,parseLifeState(null,at),at,'clear',undefined,undefined,memory)}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    // Leave protocol headroom before the intended pause instant; a busy browser
    // can consume a 100ms margin between the two clock commands.
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    const canvas=page.locator(`[data-world-chunk="${sector}"] .sector-life-wildlife canvas`);await expect(canvas).toBeVisible();
    const source=()=>page.evaluate(async sector=>(await import('/src/lib/sector-displayed-floor.ts')).displayedSectorFloor(sector),sector);
    await expect.poll(async()=>{await page.clock.runFor(200);return source();}).toContain(sector===23?(missing?'dormant':'supported'):'north-docks');
    await page.clock.runFor(1200);
    return {now,map,canvas,errors,urls,source,failedRequests:()=>requests,setStage:(next:typeof stage)=>{stage=next;},
        async refresh(){await page.clock.fastForward(21_000);await page.clock.runFor(400);}};
}

for(const mode of ['full','lite','missing art'] as const)test(`lamp moths ${mode}: follow actual lit lamps, extinguishing and foreground visibility`,async({page},info)=>{
    test.setTimeout(180_000);const site=await open(page,23,true,mode==='lite',mode==='missing art');
    if(mode==='missing art'){
        expect(site.failedRequests()).toBeGreaterThan(0);await expect(site.canvas).toHaveAttribute('data-local-fauna','');expect((await stats(page)).draws.moth).toBe(0);
    }else{
        await expect(site.canvas).toHaveAttribute('data-local-fauna','lamp-moths');let s=await stats(page);expect(s.draws.moth).toBeGreaterThan(0);expect(s.max.moth).toBeLessThanOrEqual(2);
        for(const p of s.points.moth)expect(MOONWELL_MOTH_LAMPS.some(lamp=>Math.abs(p.x-lamp.x)<=23/1024+.00001&&Math.abs(p.y-lamp.y)<=23/1024*.65+.00001)).toBe(true);
        await site.map.screenshot({path:`${evidence}/${info.project.name}-moths-${mode}-supported.png`});
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});await reset(page);await page.clock.runFor(1200);expect((await stats(page)).draws.moth).toBe(0);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(1000);expect((await stats(page)).draws.moth).toBeGreaterThan(0);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await reset(page);await page.clock.runFor(1200);expect((await stats(page)).draws.moth).toBe(0);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(1000);expect((await stats(page)).draws.moth).toBeGreaterThan(0);
        site.setStage('dormant');await site.refresh();await expect.poll(async()=>{await page.clock.runFor(100);return site.source();}).toContain('dormant');
        await expect(site.canvas).toHaveAttribute('data-local-fauna','');await reset(page);await page.clock.runFor(1000);expect((await stats(page)).draws.moth).toBe(0);
        site.setStage('radiant');await site.refresh();await expect.poll(async()=>{await page.clock.runFor(100);return site.source();}).toContain('radiant');await expect(site.canvas).toHaveAttribute('data-local-fauna','lamp-moths');
        await page.clock.runFor(1000);s=await stats(page);expect(s.draws.moth).toBeGreaterThan(0);expect(s.max.moth).toBeLessThanOrEqual(2);
        const day=Math.floor(site.now/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;await page.clock.setSystemTime(new Date(day));await page.clock.fastForward(16_000);await page.clock.runFor(400);
        await expect(site.canvas).toHaveAttribute('data-local-fauna','');await reset(page);await page.clock.runFor(1000);expect((await stats(page)).draws.moth).toBe(0);
    }
    await site.map.screenshot({path:`${evidence}/${info.project.name}-moths-${mode}-final.png`});expect(site.errors).toEqual([]);expect(site.urls.filter(url=>/\.glb(?:\?|$)|ground-fauna-v1/.test(url))).toEqual([]);
});
for(const lite of [false,true])test(`harbor gulls ${lite?'lite':'full'}: reuse bounded flyers over real water`,async({page},info)=>{
    const site=await open(page,2,false,lite);await expect(site.canvas).toHaveAttribute('data-local-fauna','harbor-gulls');
    const first=await stats(page);expect(first.draws.gull).toBeGreaterThan(0);expect(first.max.gull).toBeLessThanOrEqual(2);
    const water=SECTOR_FLOOR_LAYOUTS[sectorArtKey(2)].hydrology!.waterTiles;
    for(const p of first.points.gull)expect(water.includes(Math.floor(p.y*12)*12+Math.floor(p.x*12))).toBe(true);
    if(!lite){
        const before=Number(await site.canvas.getAttribute('data-wildlife-reaction')??0);
        await page.locator('[data-world-chunk="2"] > button.scene-tile').nth(99).dispatchEvent('click');
        for(let i=0;i<30&&Number(await site.canvas.getAttribute('data-wildlife-reaction')??0)===before;i++)await page.clock.runFor(1000);
        expect(Number(await site.canvas.getAttribute('data-wildlife-reaction')??0)).toBeGreaterThan(before);
    }
    await site.map.screenshot({path:`${evidence}/${info.project.name}-gulls-${lite?'lite':'full'}.png`});
    expect(site.errors).toEqual([]);expect(site.urls.filter(url=>/\.glb(?:\?|$)|ground-fauna-v1/.test(url))).toEqual([]);
});

for(const lite of [false,true])test(`lamp moths resume ${lite?'lite':'full'}: current sky applies before the first foreground frame`,async({page},info)=>{
    const site=await open(page,23,true,lite);await expect(site.canvas).toHaveAttribute('data-local-fauna','lamp-moths');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(Math.floor(site.now/WORLD_DAY_MS)*WORLD_DAY_MS+WORLD_DAY_MS+8*WORLD_HOUR_MS));
    await reset(page);await page.clock.runFor(200);expect((await stats(page)).draws.moth).toBe(0);
    await page.evaluate(()=>{delete (document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await expect(site.canvas).toHaveAttribute('data-local-fauna','');
    await reset(page);await page.clock.runFor(200);expect((await stats(page)).draws.moth).toBe(0);
    await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});
    await page.clock.setSystemTime(new Date(site.now+WORLD_DAY_MS));await reset(page);await page.clock.runFor(200);expect((await stats(page)).draws.moth).toBe(0);
    await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());
    await expect(site.canvas).toHaveAttribute('data-local-fauna','lamp-moths');await page.clock.runFor(200);expect((await stats(page)).draws.moth).toBeGreaterThan(0);
    await site.map.screenshot({path:`${evidence}/${info.project.name}-moths-resume-${lite?'lite':'full'}.png`});expect(site.errors).toEqual([]);
});
