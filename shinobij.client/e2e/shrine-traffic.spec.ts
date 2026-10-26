import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {LIFE_SHRINE_LINES} from '../../shared/sector-life-memory';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWalkableTile} from '../../shared/sector-walk-mask';

type Pose={col:number;row:number;visible:boolean;activity?:string;original:boolean};
declare global{interface Window{trafficOriginal:HTMLElement;trafficKeeper:HTMLElement;trafficRead:()=>Pose}}
const evidence='../output/living-world/shrine-traffic/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const TRAFFIC_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);

test('cached shrine visitor finishes the real visit, hides at the actual exit, and a fresh wave enters independently',async({page},info)=>{
    test.setTimeout(360_000);
    let since=Math.floor(TRAFFIC_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    for(let attempt=0;attempt<32;attempt++,since+=WORLD_DAY_MS){
        const memory={tier:2,maintainedAt:0,by:'',supportStartedAt:since};
        if([since+2000,since+2000+600_000-9000].every(at=>lifeSceneView(15,{...parseLifeState(null,at),step:3,updatedAt:since-1000},at,'clear',undefined,undefined,memory).actors.some(actor=>actor.id==='pilgrim:15:0')))break;
    }
    const now=since+2000,memory={tier:2,maintainedAt:0,by:'',supportStartedAt:since};
    const initial=lifeSceneView(15,{...parseLifeState(null,now),step:3,updatedAt:since-1000},now,'clear',undefined,undefined,memory).actors.find(actor=>actor.id==='pilgrim:15:0')!;
    expect(initial).toBeTruthy();const arrival=initial.phases!.find(phase=>phase.activity==='Visiting the shrine')!.at,departure=initial.phases!.find(phase=>phase.activity==='Continuing along the road')!.at;
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=15;save.currentTile=125;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([15],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let offline=false;const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:15,ownerClan:'TrafficReview',weather:'clear',hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()!=='GET')mutations.push(route.request().method());if(offline){await route.abort();return;}
        const at=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(15,{...parseLifeState(null,at),step:3,updatedAt:since-1000},at,'clear',undefined,undefined,memory)}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 15',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    const visitor=page.locator('[data-life-resident="pilgrim:15:0"]');await expect(visitor).toHaveCount(1);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(async()=>{
        const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();
        window.trafficOriginal=document.querySelector<HTMLElement>('[data-life-resident="pilgrim:15:0"]')!;window.trafficKeeper=document.querySelector<HTMLElement>('[data-life-resident="keeper:15"]')!;
        window.trafficRead=()=>{const node=document.querySelector<HTMLElement>('[data-life-resident="pilgrim:15:0"]')!,p=registry.figureGroundPosition(node);if(!p)throw Error('Actual visitor pose missing');return{...p,visible:getComputedStyle(node).visibility!=='hidden',activity:node.dataset.activity,original:node===window.trafficOriginal};};
    });
    await page.clock.runFor(300);offline=true;
    const read=()=>page.evaluate(()=>window.trafficRead()),samples:Pose[]=[];
    await expect(visitor).toHaveAttribute('data-activity','Walking to the shrine');let previous=await read();
    for(let i=0;i<Math.ceil((arrival-now)/3000)+4;i++){
        await page.clock.runFor(3000);const point=await read();expect(Math.hypot(point.col-previous.col,point.row-previous.row)).toBeLessThan(1.9);expect(point.original).toBe(true);expect(point.visible).toBe(true);
        const tile=Math.round(point.row)*12+Math.round(point.col);expect(isWalkableTile(15,tile)).toBe(true);expect(initial.clearance??[]).not.toContain(tile);samples.push(point);previous=point;
        if(point.activity==='Visiting the shrine')break;
    }
    await expect(visitor).toHaveAttribute('data-activity','Visiting the shrine');expect(Math.hypot(previous.col-initial.restTile%12,previous.row-Math.floor(initial.restTile/12))).toBeLessThan(.18);
    await visitor.click();await expect(page.getByRole('dialog')).toContainText(LIFE_SHRINE_LINES.visiting);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await map.screenshot({path:`${evidence}/${info.project.name}-cached-visit.png`});
    // The deadline has passed while this actual person is still at the shrine.
    // They must finish walking before hiding; the date jump cannot teleport them.
    await page.clock.setSystemTime(new Date(initial.hideAt!+5000));await page.clock.runFor(500);let point=await read();
    expect(point.visible).toBe(true);expect(point.activity).toBe('Continuing along the road');expect(Math.hypot(point.col-previous.col,point.row-previous.row)).toBeLessThan(.4);previous=point;
    for(let i=0;i<Math.ceil((initial.hideAt!-departure)/3000/.6/3)+4;i++){
        await page.clock.runFor(3000);point=await read();expect(Math.hypot(point.col-previous.col,point.row-previous.row)).toBeLessThan(1.9);expect(point.original).toBe(true);
        const tile=Math.round(point.row)*12+Math.round(point.col);expect(isWalkableTile(15,tile)).toBe(true);expect(initial.clearance??[]).not.toContain(tile);samples.push(point);previous=point;if(!point.visible)break;
    }
    expect(point.visible).toBe(false);expect(Math.hypot(point.col-initial.hideTile!%12,point.row-Math.floor(initial.hideTile!/12))).toBeLessThan(.18);await expect(visitor).toBeHidden();
    await map.screenshot({path:`${evidence}/${info.project.name}-cached-exit.png`});
    await page.clock.setSystemTime(new Date(now+600_000-30_000));offline=false;await page.clock.fastForward(21_000);await page.clock.runFor(300);
    await expect.poll(async()=>{await page.clock.runFor(200);return(await read()).original;}).toBe(false);
    const fresh=await read(),entry=initial.motion!.frames[0][1];expect(fresh.visible).toBe(true);expect(Math.hypot(fresh.col-entry%12,fresh.row-Math.floor(entry/12))).toBeLessThan(.18);
    expect(await page.evaluate(()=>window.trafficOriginal.isConnected)).toBe(false);expect(await page.evaluate(()=>window.trafficKeeper.isConnected)).toBe(true);
    await expect(visitor).toHaveAttribute('data-activity','Walking to the shrine');await map.screenshot({path:`${evidence}/${info.project.name}-fresh-wave-entry.png`});
    writeFileSync(`${evidence}/${info.project.name}-native-poses.json`,JSON.stringify({initial,arrival,departure,samples,exit:point,fresh},null,2));expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
