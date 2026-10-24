import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeSceneView,lifeActorsAt,parseLifeState,travelerRoute,lifeCourierRoute,LIFE_WINDOW_MS} from '../../shared/sector-life';
import {lifeActorPosition} from '../../shared/sector-life-motion';
import {isWalkableTile} from '../../shared/sector-walk-mask';
type Pose={col:number;row:number;visible:boolean;activity?:string;original:boolean};
declare global{interface Window{roadVisitOriginal:HTMLElement;roadVisitRead:()=>Pose}}
const evidence=process.env.ROAD_VISIT_EVIDENCE_DIR??'../output/living-world/road-visits/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const ROAD_VISIT_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);
for(const mode of ['recurring traveler','injured courier'] as const)test(`cached road visit: ${mode}`,async({page},info)=>{
    test.setTimeout(600_000);page.setDefaultTimeout(15_000);
    const recurring=mode==='recurring traveler',sector=recurring?26:52,id=recurring?'sumi':'courier:52';
    let slot=Math.floor(ROAD_VISIT_SCENARIO_EPOCH/300_000);
    if(recurring)for(let i=0;i<100;i++,slot++)if(lifeActorsAt(sector,slot*300_000+1000,'clear').some(a=>a.id===id))break;
    const now=slot*300_000+1000,route=lifeCourierRoute(sector);let completedAt=now,step=recurring?3:2,offline=false;
    const scene=(at:number)=>lifeSceneView(sector,{...parseLifeState(null,at),step,updatedAt:recurring?Math.floor(at/300_000)*300_000:completedAt},at,'clear');
    let initial=scene(now).actors.find(a=>a.id===id)!;expect(initial).toBeTruthy();
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=recurring?initial.restTile:route.meet;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],now)};await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    const errors:string[]=[],mutations:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/world-state**',r=>r.fulfill({json:{territories:[{sector,ownerClan:'RoadVisitReview',weather:'clear',hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async r=>{if(r.request().method()!=='GET')mutations.push(r.request().method());if(offline){await r.abort();return;}const at=await page.evaluate(()=>Date.now());await r.fulfill({json:{ok:true,serverNow:at,view:scene(at)}});});
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    const actor=page.locator(`[data-life-resident="${id}"]`);await expect(actor).toHaveCount(1);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(async id=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.roadVisitOriginal=document.querySelector<HTMLElement>(`[data-life-resident="${id}"]`)!;window.roadVisitRead=()=>{const n=document.querySelector<HTMLElement>(`[data-life-resident="${id}"]`)!,p=registry.figureGroundPosition(n);if(!p)throw Error('Actual road visitor pose missing');return{...p,activity:n.dataset.activity,visible:n.style.visibility!=='hidden',original:n===window.roadVisitOriginal};};},id);
    await page.clock.runFor(300);offline=true;const read=()=>page.evaluate(()=>window.roadVisitRead()),samples:Pose[]=[];
    let previous=await read();const restPhase=initial.phases!.find(p=>p.workTile!==undefined)!;
    // Pass the model arrival while the native navigator is still walking.
    await page.clock.setSystemTime(new Date(restPhase.at+1000));await page.clock.runFor(300);let p=await read();expect(p.activity).toBe(recurring?'Arriving along the road':'Returning to the roadside stop');expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(.4);previous=p;
    for(let i=0;i<45;i++){await page.clock.runFor(2000);p=await read();expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(1.35);expect(p.original).toBe(true);expect(isWalkableTile(sector,Math.round(p.row)*12+Math.round(p.col))).toBe(true);samples.push(p);previous=p;if(p.activity===restPhase.activity)break;}
    expect(p.activity).toBe(restPhase.activity);expect(Math.hypot(p.col-restPhase.workTile!%12,p.row-Math.floor(restPhase.workTile!/12))).toBeLessThan(.18);
    await actor.click();await expect(page.getByRole('dialog')).toContainText(restPhase.line);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();await map.screenshot({path:`${evidence}/${info.project.name}-${recurring?'sumi':'courier'}-cached-arrival.png`});
    if(!recurring){step=3;completedAt=await page.evaluate(()=>Date.now());offline=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.clock.runFor(300);await expect(actor).toHaveAttribute('data-activity','Resting before the next delivery');expect((await read()).original).toBe(true);initial=scene(completedAt).actors.find(a=>a.id===id)!;offline=true;}
    await page.clock.setSystemTime(new Date(initial.hideAt!+5000));await page.clock.runFor(300);p=await read();expect(p.visible).toBe(true);expect(p.activity).toBe(recurring?'Continuing along the road':'Continuing the delivery route');previous=p;
    for(let i=0;i<60;i++){await page.clock.runFor(2000);p=await read();expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(1.35);expect(p.original).toBe(true);expect(isWalkableTile(sector,Math.round(p.row)*12+Math.round(p.col))).toBe(true);samples.push(p);previous=p;if(!p.visible)break;}
    expect(p.visible).toBe(false);expect(Math.hypot(p.col-initial.hideTile!%12,p.row-Math.floor(initial.hideTile!/12))).toBeLessThan(.18);await map.screenshot({path:`${evidence}/${info.project.name}-${recurring?'sumi':'courier'}-cached-exit.png`});
    {
        const freshAt=recurring?slot*300_000+travelerRoute(3).length*300_000+1000:(Math.floor((await page.evaluate(()=>Date.now()))/LIFE_WINDOW_MS)+1)*LIFE_WINDOW_MS+1000;
        if(!recurring)expect(scene(freshAt).window).toBeGreaterThan(scene(completedAt).window);
        if(!recurring){step=0;completedAt=freshAt;}
        await page.clock.setSystemTime(new Date(freshAt));offline=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.clock.runFor(300);
        await expect.poll(async()=>{await page.clock.runFor(100);return(await read()).original;}).toBe(false);p=await read();const model=scene(await page.evaluate(()=>Date.now())).actors.find(a=>a.id===id)!;const clock=await page.evaluate(async()=>{const m=await import('/src/lib/server-clock.ts');return{now:m.serverNow(),offset:m.serverClockOffsetMs()};}),expected=lifeActorPosition(sector,model,clock.now);writeFileSync(`${evidence}/${info.project.name}-${recurring?'sumi':'courier'}-fresh-clock.json`,JSON.stringify({p,expected,clock,model},null,2));expect(Math.hypot(p.col-expected.col,p.row-expected.row)).toBeLessThan(.25);expect(p.visible).toBe(true);expect(await page.evaluate(()=>window.roadVisitOriginal.isConnected)).toBe(false);
        await map.screenshot({path:`${evidence}/${info.project.name}-${recurring?'sumi':'courier'}-fresh-visit.png`});
    }
    writeFileSync(`${evidence}/${info.project.name}-${recurring?'sumi':'courier'}-poses.json`,JSON.stringify({initial,samples,final:p},null,2));expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
