import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeActorsAt,lifeSceneView,parseLifeState,LIFE_WINDOW_MS} from '../../shared/sector-life';
import {FRONTIER_SITES,FRONTIER_LINES,frontierWorkPlan,FRONTIER_ROUND_MS} from '../../shared/sector-frontier-work';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWalkableTile} from '../../shared/sector-walk-mask';
import {wandererPresenceGate,wandererDayBucketFromMs} from '../../shared/wanderer-roster';
import {QUEST_GIVER_PRESENCE} from '../src/lib/wanderers';
import {storyRoadEvents} from '../src/data/story-road-events';

type Pose={col:number;row:number;activity?:string;visible:boolean;original:boolean};
const FRONTIER_SCENARIO_EPOCH=Date.UTC(2026,9,23,16);
declare global{interface Window{frontierOriginal:HTMLElement;frontierRead:()=>Pose}}
const evidence=process.env.FRONTIER_WORK_EVIDENCE_DIR??'../output/living-world/frontier/browser';mkdirSync(evidence,{recursive:true});
for(const sector of [55,60])for(const mode of ['inspection','weather','task','fallback'] as const)test(`Frontier ${sector}: ${mode}`,async({page},info)=>{
    test.setTimeout(600_000);page.setDefaultTimeout(15_000);
    const site=FRONTIER_SITES[sector],plan=frontierWorkPlan(sector)!;
    // A fixed scenario day, not the wall clock. quietRoadCooldowns silences the
    // natural cast, but a roaming Legacy Emissary (level 40+) visits a sector for a
    // whole 6 h window: started at 18:00-20:00 UTC on 2026-10-23, this scene put
    // Mapless Ojii on Gen's road tile and failed only then.
    let day=Math.floor(FRONTIER_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS;
    // The Hollow inspection retains the naturally visiting Gen; no extra
    // witness or invented crowd is inserted into either sparse region.
    if(sector===55)for(let i=0;i<500;i++,day+=WORLD_DAY_MS){
        const at=day+10*WORLD_HOUR_MS+plan.gearAt-2000;
        if(lifeActorsAt(sector,at,'clear').some(a=>a.id==='gen')&&(mode!=='inspection'||wandererPresenceGate(`road#${storyRoadEvents[0].id}#55#${wandererDayBucketFromMs(at)}`,QUEST_GIVER_PRESENCE.road)))break;
    }
    const start=day+10*WORLD_HOUR_MS,now=start+plan.gearAt-2000,id=`resident:${sector}`;
    const reduced=mode==='fallback'&&info.project.name==='phone';if(reduced)await page.emulateMedia({reducedMotion:'reduce'});
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=90;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],now)};await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false,step=3,updatedAt=now-300_000;
    const scene=(at:number)=>lifeSceneView(sector,{...parseLifeState(null,at),step,updatedAt},at,weather);
    const errors:string[]=[],mutations:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    if(mode==='fallback')await page.route(`**/sector-life/${site.painting}.webp`,r=>r.abort());
    await page.route('**/api/world-state**',r=>r.fulfill({json:{territories:[{sector,ownerClan:'FrontierReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async r=>{if(r.request().method()!=='GET')mutations.push(r.request().method());if(offline){await r.abort();return;}const at=await page.evaluate(()=>Date.now());await r.fulfill({json:{ok:true,serverNow:at,view:scene(at)}});});
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    const actor=page.locator(`[data-life-resident="${id}"]`);await expect(actor).toBeVisible();
    // Freeze the functional clock after bootstrap; these samples make no
    // browser performance claim. Real native timing has a separate fixture.
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(async id=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.frontierOriginal=document.querySelector<HTMLElement>(`[data-life-resident="${id}"]`)!;window.frontierRead=()=>{const n=document.querySelector<HTMLElement>(`[data-life-resident="${id}"]`)!,p=registry.figureGroundPosition(n);if(!p)throw Error('Native frontier ground position missing');return{...p,activity:n.dataset.activity,visible:n.style.visibility!=='hidden',original:n===window.frontierOriginal};};},id);
    const samples:Pose[]=[],read=()=>page.evaluate(()=>window.frontierRead());
    const check=async()=>{const p=await read();samples.push(p);expect(p.original).toBe(true);expect(p.visible).toBe(true);const tile=Math.round(p.row)*12+Math.round(p.col);expect(isWalkableTile(sector,tile)).toBe(true);expect(site.clearance).not.toContain(tile);expect(await page.locator('[data-life-resident]').count()).toBeLessThanOrEqual(5);writeFileSync(`${evidence}/${info.project.name}-${sector}-${mode}-poses.json`,JSON.stringify(samples,null,2));return p;};
    const floor=()=>page.evaluate(async sector=>(await import('/src/lib/sector-displayed-floor.ts')).displayedSectorFloor(sector),sector);
    await expect.poll(async()=>{await page.clock.runFor(100);return floor();}).toContain(mode==='fallback'?`/sector-map/${sector===55?'s12':'s52'}.webp`:`/sector-life/${site.painting}.webp`);
    await page.clock.runFor(3000);
    const activity=mode==='fallback'?'Checking the roadside ground':sector===55?'Inspecting the pack by the pines':'Inspecting the gear by the ruin';
    await expect.poll(async()=>{await page.clock.runFor(200);return actor.getAttribute('data-activity');}).toBe(activity);
    const p=await check();expect(Math.hypot(p.col-site.inspection%12,p.row-Math.floor(site.inspection/12))).toBeLessThan(.18);
    const talk=async(line:string)=>{await actor.click();await expect(page.getByRole('dialog')).toContainText(line);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();};
    await talk(mode==='fallback'?FRONTIER_LINES.fallback:sector===55?FRONTIER_LINES.pack:FRONTIER_LINES.frame);
    if(sector===55&&mode==='inspection'){
        await page.locator('[data-life-resident="gen"]').click();await expect(page.getByRole('dialog').getByRole('heading',{name:'Gen',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        const quest=map.locator('.sector-wanderer-figure').filter({has:page.locator('.sector-wanderer-label').filter({hasText:'Pell Marrow'})});
        expect(await quest.evaluate(node=>{const body=node.querySelector('.sector-avatar-body')!,r=body.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.sector-wanderer-figure')===node;}),'the original quest giver remains independently reachable').toBe(true);
    }
    const capture=async(name:string)=>{await page.mouse.move(2,2);await map.screenshot({path:`${evidence}/${info.project.name}-${sector}-${name}.png`});};
    const geometry=await map.locator('.sector-wanderer-label').evaluateAll(labels=>labels.filter(n=>n.parentElement!.style.visibility!=='hidden').map(n=>{const rect=(element:Element)=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{name:n.textContent,rect:rect(n),body:rect(n.parentElement!.querySelector('.sector-avatar-body')!)};}));
    writeFileSync(`${evidence}/${info.project.name}-${sector}-${mode}-geometry.json`,JSON.stringify(geometry,null,2));
    if(sector===55){const gen=geometry.find(n=>n.name==='Gen')!,bounds=(await map.boundingBox())!;expect(gen).toBeTruthy();expect(gen.body.x).toBeGreaterThanOrEqual(bounds.x+2);expect(gen.body.x+gen.body.width).toBeLessThanOrEqual(bounds.x+bounds.width-2);}
    for(const a of geometry){expect(Math.hypot(Math.max(a.body.x-a.rect.x-a.rect.width,a.rect.x-a.body.x-a.body.width,0),Math.max(a.body.y-a.rect.y-a.rect.height,a.rect.y-a.body.y-a.body.height,0))).toBeLessThanOrEqual(Math.max(28,a.body.height*1.2));for(const b of geometry)if(a!==b){expect(a.rect.x+a.rect.width<=b.rect.x||b.rect.x+b.rect.width<=a.rect.x||a.rect.y+a.rect.height<=b.rect.y||b.rect.y+b.rect.height<=a.rect.y).toBe(true);expect(a.body.x+a.body.width<=b.body.x||b.body.x+b.body.width<=a.body.x||a.body.y+a.body.height<=b.body.y||b.body.y+b.body.height<=a.body.y,`${a.name} and ${b.name} have distinct physical portraits`).toBe(true);}}
    if(sector===60)await expect(page.locator('.resource-world-node')).toHaveCount(0);
    await capture(`${mode}-inspection`);
    const settle=async(expected:string)=>{let previous=await read();for(let i=0;i<24;i++){await page.clock.runFor(2000);const next=await check();expect(Math.hypot(next.col-previous.col,next.row-previous.row)).toBeLessThan(1.35);previous=next;if(next.activity===expected)break;}expect(previous.activity).toBe(expected);expect(Math.hypot(previous.col-6,previous.row-6)).toBeLessThan(.18);};
    const refresh=async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.clock.runFor(300);};
    if(mode==='inspection'){
        offline=true;const before=await read();await page.clock.setSystemTime(new Date(now+WORLD_DAY_MS+1000));await page.clock.runFor(300);const after=await check();expect(Math.hypot(after.col-before.col,after.row-before.row)).toBeLessThan(.4);
        await settle('Waiting at the road stop');await talk(FRONTIER_LINES.rest);await capture('cached-round-finished');
        const fresh=Math.ceil((await page.evaluate(()=>Date.now()))/FRONTIER_ROUND_MS)*FRONTIER_ROUND_MS+1000;await page.clock.setSystemTime(new Date(fresh));offline=false;await refresh();await page.clock.runFor(10_000);await check();await talk(FRONTIER_LINES.roadApproach);await capture('next-authoritative-round');
        const night=Math.floor(fresh/WORLD_DAY_MS)*WORLD_DAY_MS+21*WORLD_HOUR_MS;await page.clock.setSystemTime(new Date(night));await refresh();await settle('Keeping watch at the road stop');await talk(FRONTIER_LINES.night);await capture('night-watch');
    }else if(mode==='weather'){
        weather='rain';await page.clock.fastForward(21_000);await settle('Waiting out the weather');await talk(FRONTIER_LINES.weather);await capture('rain-at-original-stop');
        weather='clear';const fresh=Math.ceil((await page.evaluate(()=>Date.now()))/FRONTIER_ROUND_MS)*FRONTIER_ROUND_MS+1000;await page.clock.setSystemTime(new Date(fresh));await refresh();await page.clock.runFor(10_000);await check();await talk(FRONTIER_LINES.roadApproach);await capture('clear-road-round');
    }else if(mode==='task'){
        const fresh=(Math.floor((await page.evaluate(()=>Date.now()))/LIFE_WINDOW_MS)+1)*LIFE_WINDOW_MS+1000;step=0;updatedAt=0;await page.clock.setSystemTime(new Date(fresh));await refresh();
        let view=scene(fresh);await settle(view.kind==='courier'?'Waiting for the road courier':'Waiting for the approach report');await talk((view.kind==='courier'?FRONTIER_LINES.courier:FRONTIER_LINES.signal)[0]);
        step=2;updatedAt=await page.evaluate(()=>Date.now());await refresh();view=scene(updatedAt);await talk((view.kind==='courier'?FRONTIER_LINES.courier:FRONTIER_LINES.signal)[2]);await capture('original-task-requester');
        offline=true;await page.clock.setSystemTime(new Date(view.endsAt+1000));await page.clock.runFor(300);await expect(actor).toHaveAttribute('data-activity','Waiting at the road stop');await talk(FRONTIER_LINES.rest);await check();
    }else if(reduced){
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});await page.clock.runFor(100);const before=await read();await page.clock.runFor(1000);expect(await read()).toEqual(before);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(300);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await read();await page.clock.runFor(1000);expect(await read()).toEqual(hidden);
        await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(300);await expect(actor).toHaveAttribute('data-activity','Checking the roadside ground');await check();
    }
    expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
