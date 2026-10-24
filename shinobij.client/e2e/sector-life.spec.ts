import { test,expect,type Page } from '@playwright/test';
import { mkdirSync,writeFileSync } from 'node:fs';
import { installUiAuditRuntime,uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import {installDateOnlyClock,setDateOnlyClock} from './helpers/date-only-clock';
import {waitForCurrentSectorMap} from './helpers/sector-navigation';
import { lifeAnchors,lifeEventView,lifeSceneView,parseLifeState,advanceLifeEvent,LIFE_WINDOW_MS } from '../../shared/sector-life';
import { travelerRoute,lifeActorsAt,lifeCourierRoute,LIFE_ACTIVE_MS } from '../../shared/sector-life';
import { COURIER_REST_MS } from '../../shared/sector-life-courier';
import { isWorldNight } from '../../shared/world-phase';
import { nearestWalkableTile,tileNeighbors,isWalkableTile } from '../../shared/sector-walk-mask';
import { WORLD_DAY_MS, WORLD_HOUR_MS } from '../../shared/world-clock';
import {DOCK_SHIPMENT_DELIVERY_MS} from '../../shared/sector-dock-shipment';
import { wandererCastAt } from '../../shared/wanderer-roster';
import { PLAYABLE_WILD_SECTOR_IDS } from '../../shared/sector-geo';
import { trackerTrailSectors,TRACKER_TRAIL_TTL_MS } from '../../shared/tracker-trail';
import type { LifeHunt } from '../../shared/sector-life-tracking';
import { harvestGroundTile } from '../../shared/sector-harvest';
import { sealLifeWitnesses } from '../../shared/sector-life-witness';
import { SCAR_TTL_MS,type SectorScar } from '../../shared/sector-scars';
import { SHRINE_DEFS } from '../../shared/shrines';
import { sectorFloorLayout } from '../src/lib/sector-floor-layout';
import {wildlifeDiscovery,WILDLIFE_DISCOVERY_WINDOW} from '../../shared/sector-life-discovery';
import {currentWorkingAngler,nextAnglerState,anglerWorkRoutine,type AnglerState} from '../../shared/sector-angler-work';
import {WANDERER_BUCKET_MS} from '../../shared/wanderer-roster';
import {LIFE_ROAD_CREWS} from '../../shared/sector-life-routines';
import {TETSU_ROUTE,TEA_COURIER_LINES} from '../../shared/sector-tea-courier';
import {FORAGER_SITE,FORAGER_LINES} from '../../shared/sector-forager-work';
import {MIDLANDS_FIELD_LINES} from '../../shared/sector-midlands-work';

const evidence='../output/living-world/browser';mkdirSync(evidence,{recursive:true});
for(const cached of ['empty','working'] as const)test(`angler cache ${cached}: a later natural roll retains its ordinary service during a life API outage`,async({page},info)=>{
    const sector=6,bucket=Math.floor(Date.now()/WANDERER_BUCKET_MS);
    let initial=0;
    for(let i=0;i<120;i++){const at=(bucket+i)*WANDERER_BUCKET_MS+10*WORLD_HOUR_MS;if(!!currentWorkingAngler(sector,at)===(cached==='working')){initial=at;break;}}
    expect(initial).toBeGreaterThan(0);
    let later=0,work:NonNullable<ReturnType<typeof currentWorkingAngler>>|undefined;
    for(let i=1;i<120&&!work;i++){later=(Math.floor(initial/WANDERER_BUCKET_MS)+i)*WANDERER_BUCKET_MS+10*WORLD_HOUR_MS;work=currentWorkingAngler(sector,later);}
    expect(work).toBeTruthy();const previous=currentWorkingAngler(sector,initial),{wanderer,site}=work!;
    await page.clock.install({time:new Date(initial)});
    const save=uiAuditSave(),cooldowns={...quietRoadCooldowns([sector],initial),...quietRoadCooldowns([sector],later)};
    delete cooldowns[wanderer.id];if(previous)delete cooldowns[previous.wanderer.id];
    save.currentSector=sector;save.currentTile=tileNeighbors(site.bank).find(tile=>isWalkableTile(sector,tile))!;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:cooldowns};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let offline=false,polls=0;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/sector/life**',async route=>{
        polls++;if(offline){await route.abort();return;}
        const service=previous?anglerWorkRoutine(sector,nextAnglerState(sector,null,initial,'clear',previous),initial,previous):undefined;
        await route.fulfill({json:{ok:true,serverNow:initial,view:{...lifeSceneView(sector,parseLifeState(null,initial),initial,'clear'),service}}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator(`[data-life-resident="resident:${sector}"]`)).toBeAttached();await expect.poll(()=>polls).toBeGreaterThan(0);
    if(previous)await expect(page.locator(`[data-life-resident="${previous.wanderer.id}"]`)).toBeVisible();else await expect(page.locator('.sector-fishing-tackle')).toHaveCount(0);
    offline=true;
    // Cross a real night/day transition so the established natural-roster hook
    // refreshes its cast, while the loaded service cache survives in this page.
    await page.clock.fastForward(later-12*WORLD_HOUR_MS-initial);await page.clock.runFor(100);
    await page.clock.fastForward(12*WORLD_HOUR_MS+31_000);
    const actor=page.locator('.sector-wanderer-figure').filter({has:page.getByAltText(wanderer.name,{exact:true})});
    await expect(actor).toBeVisible();await expect(page.locator('.sector-fishing-tackle')).toHaveCount(0);
    await actor.click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Ask about the water',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Ask about the water',exact:true}).click();await expect(dialog).toContainText(/Try .+ shoal\./);
    await dialog.screenshot({path:`${evidence}/${info.project.name}-angler-rollover-${cached}-outage.png`});expect(errors).toEqual([]);
});
for(const sector of [6,18])for(const mode of ['weather','stale-night','unavailable'] as const)test(`working angler ${sector} ${mode}: the existing service fishes real water and uses the gatehouse`,async({page},info)=>{
    let initial=0,work:NonNullable<ReturnType<typeof currentWorkingAngler>>|undefined;
    for(let i=0;i<120&&!work;i++){initial=(Math.floor(Date.now()/WANDERER_BUCKET_MS)+i)*WANDERER_BUCKET_MS+10*WORLD_HOUR_MS;work=currentWorkingAngler(sector,initial);}
    expect(work).toBeTruthy();const {wanderer,site}=work!;
    await page.clock.install({time:new Date(initial)});
    const save=uiAuditSave(),cooldowns=quietRoadCooldowns([sector],initial);delete cooldowns[wanderer.id];
    const nearby=tileNeighbors(site.bank).filter(tile=>isWalkableTile(sector,tile)&&tile!==site.door);
    save.currentSector=sector;save.currentTile=nearby.find(tile=>Math.floor(tile/12)===Math.floor(site.bank/12))??nearby[0]??site.bank;save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:cooldowns};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',state:AnglerState|undefined,frozen:ReturnType<typeof anglerWorkRoutine>|undefined,polls=0;
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector,ownerClan:'ReviewHolding',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        polls++;if(mode==='unavailable'){await route.abort();return;}
        const now=await page.evaluate(()=>Date.now()),current=currentWorkingAngler(sector,now)!;
        if(mode==='stale-night'&&frozen){await route.fulfill({json:{ok:true,serverNow:now,view:{...lifeSceneView(sector,parseLifeState(null,now),now,weather),service:frozen}}});return;}
        state=nextAnglerState(sector,state,now,weather,current);const service=anglerWorkRoutine(sector,state,now,current);frozen??=service;
        await route.fulfill({json:{ok:true,serverNow:now,view:{...lifeSceneView(sector,parseLifeState(null,now),now,weather),service}}});
    });
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    const figure=page.locator('.sector-wanderer-figure').filter({has:page.getByAltText(wanderer.name,{exact:true})});await expect(figure).toBeVisible();await expect(figure).toHaveCount(1);
    const gear=page.locator('.sector-fishing-tackle');
    const pose=()=>figure.evaluate(el=>{const values=el.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/)!;const grid=el.closest('.continuous-world-chunk')!,box=grid.getBoundingClientRect(),css=getComputedStyle(grid),px=parseFloat(css.paddingLeft)||0,py=parseFloat(css.paddingTop)||0,gx=parseFloat(css.columnGap)||0,gy=parseFloat(css.rowGap)||0,tw=(box.width-2*px-11*gx)/12,th=(box.height-2*py-11*gy)/12;return [(Number(values[1])-px-tw/2)/(tw+gx),(Number(values[2])-py-th/2)/(th+gy)];});
    const snap=async(stage:string)=>{await page.mouse.move(2,2);await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-angler-${sector}-${mode}-${stage}.png`});};
    if(mode==='unavailable'){
        await expect.poll(()=>polls).toBeGreaterThan(0);await expect(gear).toHaveCount(0);await figure.click();
        const dialog=page.getByRole('dialog');await expect(dialog).toContainText(wanderer.name);await expect(dialog.getByRole('button',{name:'Ask about the water',exact:true})).toBeVisible();await snap('ordinary-service');expect(errors).toEqual([]);return;
    }
    await expect(gear).toHaveAttribute('data-water',String(site.water));await expect(gear).toBeVisible();await expect(figure).toHaveAttribute('data-activity','Fishing by the bank');await page.clock.fastForward(4000);await snap('fishing');
    await figure.click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText("I'm watching the float.");
    await dialog.getByRole('button',{name:'Ask about the water',exact:true}).click();await expect(dialog).toContainText(/Try .+ shoal\./);await dialog.getByRole('button',{name:'Close',exact:true}).click();
    const cover=async()=>{await page.evaluate(()=>{const node=document.createElement('div');node.className='combat-instance';document.body.append(node);});await page.waitForTimeout(80);};
    const uncover=async()=>{await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.waitForTimeout(80);};
    const advanceTo=async(time:number)=>{const now=await page.evaluate(()=>Date.now());if(time>now)await page.clock.fastForward(time-now);};
    if(mode==='stale-night'){
        await cover();await advanceTo(frozen!.fishing!.until+6000);await uncover();await expect(gear).toBeHidden();
        await expect(figure).toHaveAttribute('data-activity','Walking into the gatehouse');await snap('night-return');
        await cover();await advanceTo(frozen!.hideAt!+1000);await uncover();await expect(figure).toBeHidden();await page.clock.runFor(800);await expect(figure).toBeHidden();const [x,y]=await pose();expect(Math.hypot(x-site.door%12,y-Math.floor(site.door/12))).toBeLessThan(.05);await snap('inside-with-stale-snapshot');
    }else{
        const before=await pose();weather='rain';await page.clock.fastForward(21_000);await expect(figure).toHaveAttribute('data-activity','Putting the line away');await expect(gear).toHaveCount(0);
        const packed=await pose();expect(Math.hypot(packed[0]-before[0],packed[1]-before[1])).toBeLessThan(.18);await snap('packing');
        await page.clock.runFor(6500);await expect(figure).toHaveAttribute('data-activity','Walking into the gatehouse');await snap('walking-to-shelter');
        const closed=anglerWorkRoutine(sector,state!,await page.evaluate(()=>Date.now()),work!);await cover();await advanceTo(closed.hideAt!+1000);await uncover();await expect(figure).toBeHidden();await snap('inside');
        weather='clear';await page.clock.fastForward(21_000);await expect(figure).toBeVisible();await expect(figure).toHaveAttribute('data-activity','Walking to the fishing spot');await expect(gear).toBeHidden();
        const door=await pose();expect(Math.hypot(door[0]-site.door%12,door[1]-Math.floor(site.door/12))).toBeLessThan(.25);await snap('leaving-gatehouse');
        const returning=anglerWorkRoutine(sector,state!,await page.evaluate(()=>Date.now()),work!);await cover();await advanceTo(returning.fishing!.startsAt+1000);await uncover();await expect(gear).toBeVisible();await snap('fishing-again');
    }
    expect(errors).toEqual([]);
});
for(const mode of ['live','expires','quiet','reduced'] as const)test(`wildlife discovery ${mode}: an existing bird investigates actual ground and remains an animal`,async({page},info)=>{
    let slot=Math.floor(Date.now()/WILDLIFE_DISCOVERY_WINDOW);
    const candidates=Array.from({length:144},(_,tile)=>tile).filter(tile=>harvestGroundTile(42,tile)===tile)
        .sort((a,b)=>Math.abs(a%12-6)+Math.abs(Math.floor(a/12)-7)-Math.abs(b%12-6)-Math.abs(Math.floor(b/12)-7));
    let selectedTarget:number|undefined;
    for(let i=0;i<256;i++,slot++){
        const at=slot*WILDLIFE_DISCOVERY_WINDOW+20_000;
        if(isWorldNight(at)||(slot+42)%4)continue;
        const samples=[0,5000,15000].map(delta=>{const time=at+delta;return{time,view:lifeSceneView(42,parseLifeState(null,time),time,'clear')};});
        selectedTarget=candidates.find(tile=>samples.every(({time,view})=>wildlifeDiscovery(42,time,'clear',view.campTile,[[tile,undefined,at+3_600_000]],view.actors.flatMap(a=>[a.restTile,a.workTile]))));
        if(selectedTarget!==undefined)break;
    }
    expect(selectedTarget,'a real worked-ground tile stays unoccupied during bootstrap').toBeDefined();
    const initial=slot*WILDLIFE_DISCOVERY_WINDOW+20_000,target=selectedTarget!;
    expect(harvestGroundTile(42,target)).toBe(target);
    await page.clock.install({time:new Date(initial)});if(mode==='reduced')await page.emulateMedia({reducedMotion:'reduce'});
    const save=uiAuditSave();save.currentSector=42;save.currentTile=nearestWalkableTile(42,130);
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([42],initial)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>{
        Math.random=()=>.2;localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45]));
        const stats={frames:0,points:[] as number[][]};Object.assign(window,{discoveryQa:stats});
        const clear=CanvasRenderingContext2D.prototype.clearRect,translate=CanvasRenderingContext2D.prototype.translate;
        CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('.sector-life-wildlife')){stats.frames++;stats.points=[];}return clear.apply(this,args);};
        CanvasRenderingContext2D.prototype.translate=function(x,y){if(this.canvas.closest('.sector-life-wildlife'))stats.points.push([x,y,this.canvas.clientWidth,this.canvas.clientHeight]);return translate.call(this,x,y);};
    });
    let flight:ReturnType<typeof wildlifeDiscovery>,firstFlight:ReturnType<typeof wildlifeDiscovery>;
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:42,ownerClan:'ReviewHolding',weather:'clear',hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        const now=await page.evaluate(()=>Date.now()),view=lifeSceneView(42,parseLifeState(null,now),now,'clear'),groundTrail=mode==='quiet'?[]:[[target,undefined,initial+3_600_000] as const];
        flight=wildlifeDiscovery(42,now,'clear',view.campTile,groundTrail,view.actors.flatMap(a=>[a.restTile,a.workTile]));
        firstFlight??=flight;
        await route.fulfill({json:{ok:true,serverNow:now,view:{...view,groundTrail,wildlife:mode==='expires'?firstFlight:flight}}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 42',exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    const holder=page.locator('.sector-life-wildlife'),canvas=holder.locator('canvas');await expect(canvas).toBeAttached();
    const stats=()=>page.evaluate(()=>(window as unknown as {discoveryQa:{frames:number;points:number[][]}}).discoveryQa);
    await expect.poll(async()=>(await stats()).points.length).toBeGreaterThan(0);const count=(await stats()).points.length;
    if(mode==='quiet')expect(firstFlight).toBeUndefined();else await expect.poll(()=>!!firstFlight).toBe(true);
    const advanceTo=async(time:number)=>{const now=await page.evaluate(()=>Date.now());if(time>now)await page.clock.fastForward(time-now);};
    const screenshot=async(name:string)=>{await page.mouse.move(2,2);await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-wildlife-discovery-${name}.png`});};
    if(mode==='live'||mode==='expires'){
        const start=flight!.motion.start,until=flight!.until;
        await advanceTo(start);await page.clock.runFor(3000);await screenshot('approaching');
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});await page.waitForTimeout(80);
        const paused=(await stats()).frames;await page.clock.fastForward(2000);expect((await stats()).frames).toBe(paused);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await advanceTo(start+9000);await page.clock.runFor(5000);
        await expect.poll(async()=>(await stats()).frames).toBeGreaterThan(paused);
        const [x,y,w,h]=(await stats()).points[0];expect(Math.hypot(x/w*12-.5-target%12,y/h*12-.5-Math.floor(target/12))).toBeLessThan(.7);
        expect((await stats()).points.length).toBe(count);await screenshot('investigating');
        if(mode==='expires'){
            // Keep delivering the original snapshot after expiry. The client
            // must resume ordinary flight from its own server-clock deadline.
            await advanceTo(until+1000);await page.clock.runFor(5000);
            const [ex,ey,ew,eh]=(await stats()).points[0],last=firstFlight!.motion.frames.at(-1)![1];
            expect(Math.hypot(ex/ew*12-.5-last%12,ey/eh*12-.5-Math.floor(last/12))).toBeGreaterThan(1);
            expect((await stats()).points.length).toBe(count);await screenshot('expired-without-refresh');return;
        }
        const before=Number(await canvas.getAttribute('data-wildlife-reaction')??0),tile=page.locator('.continuous-world-tile').nth(target);await tile.focus();await tile.press('Enter');
        for(let i=0;i<16&&Number(await canvas.getAttribute('data-wildlife-reaction')??0)===before;i++)await page.clock.runFor(400);
        expect(Number(await canvas.getAttribute('data-wildlife-reaction')??0)).toBeGreaterThan(before);await screenshot('startled');
        await advanceTo(until+25_000);await page.clock.runFor(1000);
        expect((await stats()).points.length).toBe(count);await screenshot('continued');
    }else if(mode==='reduced'){
        const frames=(await stats()).frames;await page.clock.fastForward(25_000);expect((await stats()).frames).toBe(frames);expect((await stats()).points.length).toBe(count);await screenshot('reduced');
    }else{await page.clock.fastForward(25_000);expect(firstFlight).toBeUndefined();expect((await stats()).points.length).toBe(count);await screenshot('ordinary');}
});
for(const sector of [2,15,23,31])test(`ownership cloth sector ${sector}: live server capture and release recolor existing painted flags`,async({page},info)=>{
    let start=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+35*60_000;while(isWorldNight(start))start+=LIFE_WINDOW_MS;
    await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=sectorFloorLayout(sector).sites.stronghold!.approach;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let ownerVillage:string|undefined,polls=0,floorLoaded=false;
    page.on('response',response=>{if(response.url().includes('/sector-life/')&&response.url().endsWith('.webp')&&response.status()===200)floorLoaded=true;});
    await page.route('**/api/world-state**',route=>{polls++;return route.fulfill({json:{territories:ownerVillage?[{sector,ownerClan:'ReviewHolding',ownerVillage,hp:100}]:[],wars:[],standings:[]}});});
    const scene=lifeSceneView(sector,parseLifeState(null,start),start,'clear');
    await page.route('**/api/sector/life**',async route=>route.fulfill({json:{ok:true,serverNow:await page.evaluate(()=>Date.now()),view:scene}}));
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');await expect.poll(()=>polls).toBeGreaterThan(0);
    const terrain=page.locator('.continuous-world-map>canvas'),map=page.locator('.continuous-world-map');
    const stable=async()=>{let last='',count=0;await expect.poll(async()=>{const next=await terrain.evaluate(el=>(el as HTMLCanvasElement).toDataURL());count=next===last?count+1:0;last=next;return count;},{intervals:[150]}).toBeGreaterThanOrEqual(3);return last;};
    // Let floor decoding and native raster-cache arrival finish before the baseline.
    await expect.poll(()=>floorLoaded).toBe(true);
    const initial=await stable(),states=new Set([initial]);let previous=initial;
    for(const [id,village] of [['moonshadow','Moonshadow Village'],['stormveil','Stormveil Village'],['ashen-leaf','Ashen Leaf Village'],['frostfang','Frostfang Village'],['neutral',undefined]] as const){
        const before=polls;ownerVillage=village;await page.clock.fastForward(16_000);await expect.poll(()=>polls).toBeGreaterThan(before);
        await expect.poll(()=>terrain.evaluate(el=>(el as HTMLCanvasElement).toDataURL())).not.toBe(previous);
        const pixels=await stable();if(village){expect(states.has(pixels)).toBe(false);states.add(pixels);}else expect(pixels).toBe(initial);previous=pixels;
        const prefix=`${evidence}/${info.project.name}-ownership-sector-${sector}-${id}`;
        await map.screenshot({path:`${prefix}.png`});writeFileSync(`${prefix}-terrain.png`,Buffer.from(pixels.split(',')[1],'base64'));
    }
    expect(errors).toEqual([]);
});
for(const shrine of SHRINE_DEFS.filter(s=>s.sector!==15))test(`regional shrine ${shrine.id}: painted support states preserve the actual staffed sector`,async({page},info)=>{
    // A late unattended round has finished the courier's return/departure.
    // It leaves room to review both supported visitors; busy rounds retain the
    // same five-person budget and may show only one visitor alongside a requester.
    let start=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+35*60_000;while(isWorldNight(start))start+=LIFE_WINDOW_MS;
    const sector=shrine.sector,previewFunded=start-100_000;
    const preview=lifeSceneView(sector,parseLifeState(null,start),start,'clear',undefined,undefined,{tier:2,maintainedAt:0,by:'',supportStartedAt:previewFunded});
    const visitingWindows=preview.actors.filter(a=>a.id.startsWith('pilgrim:')).map(a=>{const frames=a.motion!.frames,index=frames.findIndex((frame,i)=>i>0&&frame[1]===frames[i-1][1]&&frame[0]-frames[i-1][0]===120_000);expect(index).toBeGreaterThan(0);return [a.motion!.start-previewFunded+frames[index-1][0],a.motion!.start-previewFunded+frames[index][0]];});
    expect(visitingWindows).toHaveLength(2);const lower=Math.max(...visitingWindows.map(w=>w[0])),upper=Math.min(...visitingWindows.map(w=>w[1]));expect(upper).toBeGreaterThan(lower);
    const fundedAt=start+42_000-(lower+upper)/2;await page.clock.install({time:new Date(start)});await page.clock.setFixedTime(new Date(start));
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=sectorFloorLayout(sector).sites.shrine!.approach;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let tier=0;const loaded=new Set<string>();page.on('response',response=>{if(response.status()===200)loaded.add(response.url().split('/').at(-1)!.split('?')[0]);});
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(sector,parseLifeState(null,now),now,'clear',undefined,undefined,{tier,maintainedAt:0,by:'',supportStartedAt:fundedAt})}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');
    // Compilation must not consume the authored overlap of both visits. Pause
    // native loops while preparing the clock, then advance Date/RAF together
    // only when exercising the real funding polls and decoded terrain draws.
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(start-60_000));await page.clock.pauseAt(new Date(start));
    await page.evaluate(()=>{delete (document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    const terrain=page.locator('.continuous-world-map>canvas'),map=page.locator('.continuous-world-map');
    const settled=async()=>{let previous='',stable=0;await expect.poll(async()=>{await page.clock.runFor(200);const pixels=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());stable=pixels===previous?stable+1:0;previous=pixels;return stable;},{intervals:[100]}).toBeGreaterThanOrEqual(3);return previous;};
    let before='';for(const [index,state] of ['dormant','supported','radiant'].entries()){
        if(index){tier=index;await page.clock.fastForward(21_000);}
        await expect.poll(async()=>{await page.clock.runFor(200);return loaded.has(`${shrine.id}-${state}-shrine${sector===31?'-supply-v2':'-v1'}.webp`);}).toBe(true);
        if(before)await expect.poll(async()=>{await page.clock.runFor(200);return terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());}).not.toBe(before);
        before=await settled();const prefix=`${evidence}/${info.project.name}-regional-shrine-${shrine.id}-${state}`;
        await map.screenshot({path:`${prefix}.png`});writeFileSync(`${prefix}-terrain.png`,Buffer.from(before.split(',')[1],'base64'));
        if(index){await expect(page.locator(`[data-life-resident="keeper:${sector}"]`)).toBeAttached();await expect(page.locator('[data-life-resident^="pilgrim:"]').first()).toBeAttached();}
        if(index===2)await expect.poll(async()=>{await page.clock.runFor(200);return page.locator('[data-life-resident^="pilgrim:"][data-activity="Visiting the shrine"]').count();}).toBe(2);
        expect(await page.locator('.sector-life-shrine-light').count()).toBe(0,'light belongs in the floor painting');
        if(sector===31)await expect(page.locator('[data-life-resident="resident:31"]')).toBeAttached();
    }
});
for(const memory of ['observed','unwitnessed','expired'] as const)test(`duel witness ${memory}: an existing worker keeps factual memory without adding an NPC`,async({page},info)=>{
    const start=shrineRoundTime(),observedAt=memory==='expired'?start-SCAR_TTL_MS-1000:start-2000;
    await page.clock.install({time:new Date(start)});const save=uiAuditSave();save.currentSector=15;save.currentTile=115;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    const cast=lifeSceneView(15,parseLifeState(null,observedAt),observedAt,'clear').actors;
    const scar:SectorScar={kind:'duel',victor:'Rin',fallen:'Kota',tile:104,at:start-1000,...(memory==='unwitnessed'?{}:{witnesses:sealLifeWitnesses(15,104,cast,observedAt)})};
    const scene=lifeSceneView(15,parseLifeState(null,start),start,'clear',undefined,scar,undefined,[scar]);
    await page.route('**/api/sector/life**',route=>route.fulfill({json:{ok:true,view:scene,serverNow:start}}));
    await enterLifeSector(page,15);await expect(page.locator('[data-life-resident]')).toHaveCount(scene.actors.length);
    const seller=page.locator('[data-life-resident="resident:15"]');await seller.click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Tea Seller Ren');
    await page.clock.runFor(300);
    writeFileSync(`${evidence}/${info.project.name}-witness-layout.json`,JSON.stringify(await dialog.evaluate(node=>{const card=getComputedStyle(node),backdrop=getComputedStyle(node.parentElement!);return {card:{position:card.position,display:card.display,maxHeight:card.maxHeight,background:card.background,rect:node.getBoundingClientRect().toJSON()},backdrop:{position:backdrop.position,display:backdrop.display,rect:node.parentElement!.getBoundingClientRect().toJSON()},viewport:{width:innerWidth,height:innerHeight},sheets:Array.from(document.styleSheets).map(s=>s.href)};}),null,2));
    await expect(page.locator('.ui-modal-backdrop')).toHaveCSS('position','fixed');
    const bounds=await dialog.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(info.project.use.viewport!.height+1);
    const close=dialog.getByRole('button',{name:/Close/});await expect(close).toBeInViewport();await close.click({trial:true});
    if(memory==='observed')await expect(dialog).toContainText('I saw Rin and Kota fighting near here.');else await expect(dialog).not.toContainText('I saw');
    await page.screenshot({path:`${evidence}/${info.project.name}-duel-witness-${memory}.png`});
    await dialog.getByRole('button',{name:/Close/}).click();await page.locator('[data-life-resident="keeper:15"]').click();
    await expect(page.getByRole('dialog')).not.toContainText('I saw');
});
for(const sector of [42,15,21,31,58])test(`committed gathering ${sector}: paints the actual verge and expires locally when polling is unavailable`,async({page},info)=>{
    const start=shrineRoundTime(),tile=harvestGroundTile(sector,nearestWalkableTile(sector,125))!;expect(tile).toBeDefined();
    const shot=(scene:string)=>`${evidence}/${info.project.name}-harvest-${sector}-${scene}.png`;
    await page.clock.install({time:new Date(start)});const save=uiAuditSave();save.currentSector=sector;save.currentTile=tileNeighbors(tile).find(t=>isWalkableTile(sector,t))!;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);let worked=false,allowPoll=true,polls=0;
    await page.route('**/api/sector/life**',async route=>{
        if(!allowPoll)return route.abort();polls++;const now=await page.evaluate(()=>Date.now());
        const view=lifeSceneView(sector,parseLifeState(null,now),now,'clear');
        await route.fulfill({json:{ok:true,view:{...view,groundTrail:worked?[[tile,undefined,start+35_000]]:[]},serverNow:now}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');
    const terrain=page.locator('.continuous-world-map>canvas');
    const settled=async()=>{let previous='',stable=0;await expect.poll(async()=>{const pixels=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());stable=pixels===previous?stable+1:0;previous=pixels;return stable;},{intervals:[100]}).toBeGreaterThanOrEqual(3);return previous;};
    const clean=await settled();await terrain.screenshot({path:shot('clean-verge')});
    worked=true;await page.clock.fastForward(21_000);await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(clean);const changed=await settled();
    await terrain.screenshot({path:shot('worked-verge')});
    writeFileSync(shot('clean-terrain'),Buffer.from(clean.split(',')[1],'base64'));writeFileSync(shot('worked-terrain'),Buffer.from(changed.split(',')[1],'base64'));
    allowPoll=false;const before=polls;await page.clock.fastForward(16_000);
    await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).toBe(clean);expect(polls).toBe(before);
    await terrain.screenshot({path:shot('expired-verge')});
});
function shrineRoundTime() {
    let round=Math.floor(Date.now()/LIFE_WINDOW_MS);if(round%2===0)round++;
    while(isWorldNight(round*LIFE_WINDOW_MS+60_000))round+=2;
    return round*LIFE_WINDOW_MS+60_000;
}
function worldTrackingSite() {
    const base=Math.floor(Date.now()/21_600_000)*21_600_000;
    for(let round=0;round<24;round++){const now=base+round*LIFE_WINDOW_MS+60_000;if(isWorldNight(now))continue;
        for(const sector of PLAYABLE_WILD_SECTOR_IDS){const view=lifeEventView(sector,parseLifeState(null,now),now);if(view.kind==='tracks'&&view.tracker)return {now,sector,tracker:view.tracker,tile:view.tile};}}
    throw new Error('No daytime natural tracker site found');
}
test('world tracking hands its real roster tracker to the existing two-sector trail flow',async({page},info)=>{
    const site=worldTrackingSite(),{sector,tracker}=site;await page.clock.install({time:new Date(site.now)});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=site.tile;const cooldowns=quietRoadCooldowns([sector],site.now);delete cooldowns[tracker.id];
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:cooldowns};const runtime=await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let state=parseLifeState(null,site.now),started=0;
    const trail={id:'trail-world-ui-00000001',requestId:'world-trail-ui-request-0001',originSector:sector,giver:tracker.name,sectors:trackerTrailSectors('trail-world-ui-00000001',sector),step:0 as 0|1,expiresAt:site.now+TRACKER_TRAIL_TTL_MS};
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());if(route.request().method()==='POST'){const body=route.request().postDataJSON();state=advanceLifeEvent(sector,state,body.window,body.step,'AuditNinja',now).state;}await route.fulfill({json:{ok:true,view:lifeSceneView(sector,state,now,'clear'),serverNow:now}});});
    await page.route('**/api/sector/wanderer-service',async route=>{
        const body=route.request().postDataJSON();expect(body.action).toBe('tracker-trail-start');expect(body.wandererId).toBe(tracker.id);started++;
        const now=await page.evaluate(()=>Date.now()),hunt:LifeHunt={window:state.window,owner:'AuditNinja',trackerId:tracker.id,giver:tracker.name,homeTile:tracker.homeTile,trailId:trail.id,requestId:trail.requestId,sectors:trail.sectors,startedAt:now,expiresAt:trail.expiresAt};
        state={...state,step:2,updatedAt:now,hunt};const version=runtime.currentVersion()+1;runtime.commitServerCharacter({...runtime.serverSave().character,activeTrackerTrail:trail},version);
        await route.fulfill({json:{ok:true,trail,_saveVersion:version,cooldownUntil:now+21_600_000}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');await expect(page.locator('.sector-life-point')).toHaveAttribute('title','An animal trail');await page.clock.runFor(700);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-tracking-ground-signs.png`});
    await doRoadWork(page,lifeEventView(sector,state,site.now),true);expect(state.step).toBe(1);
    await page.locator('.sector-life-point').click();await page.getByRole('dialog').getByRole('button',{name:'Ask the tracker to follow the trail',exact:true}).click();
    await expect.poll(()=>started).toBe(1);await expect(page.getByRole('dialog')).toContainText(`Meet me in sector ${trail.sectors[0]}`);
    await page.getByRole('dialog').screenshot({path:`${evidence}/${info.project.name}-tracking-existing-trail-dialog.png`});
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.clock.fastForward(21_000);const hunter=page.locator(`[data-life-resident="hunter:${sector}"]`);await expect(hunter).toBeAttached();
    const before=await hunter.getAttribute('style');await page.clock.runFor(4000);expect(await hunter.getAttribute('style')).not.toBe(before);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-tracking-party-leaving.png`});expect(errors).toEqual([]);expect(runtime.saveConflictCount()).toBe(0);
});
for(const result of ['bound','unbound'] as const)test(`world tracking ${result}: the returning party rests at distinct real positions`,async({page},info)=>{
    const site=worldTrackingSite(),{sector,tracker}=site;
    const hunt:LifeHunt={window:Math.floor(site.now/LIFE_WINDOW_MS),owner:'AuditNinja',trackerId:tracker.id,giver:tracker.name,homeTile:tracker.homeTile,trailId:'trail-world-return-0001',requestId:'world-trail-return-0001',sectors:trackerTrailSectors('trail-world-return-0001',sector),startedAt:site.now,expiresAt:site.now+TRACKER_TRAIL_TTL_MS,result,resolvedAt:site.now+90_000};
    const state={...parseLifeState(null,site.now),step:3,hunt,updatedAt:hunt.resolvedAt!},initial=lifeSceneView(sector,state,hunt.resolvedAt!,'clear'),person=initial.actors.find(a=>a.id===`hunter:${sector}`)!;
    const frames=person.motion!.frames,arrival=frames.find((frame,i)=>frame[1]===person.restTile&&frames[i+1]?.[1]===person.restTile&&frames[i+1][0]-frame[0]>=180_000)!;
    const at=hunt.startedAt+arrival[0]+2000;await page.clock.install({time:new Date(at)});
    const occupied=new Set(lifeSceneView(sector,state,at,'clear').actors.map(a=>a.restTile)),playerTile=[1,-1,12,-12,2,-2].map(delta=>nearestWalkableTile(sector,person.restTile+delta)).find(tile=>!occupied.has(tile))??person.restTile;
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=playerTile;const cooldowns=quietRoadCooldowns([sector],at);delete cooldowns[tracker.id];
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:cooldowns};await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,view:lifeSceneView(sector,state,now,'clear'),serverNow:now}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');const hunter=page.locator(`[data-life-resident="hunter:${sector}"]`);await expect(hunter).toHaveAttribute('data-activity','Resting after the animal trail');
    const original=page.locator(`.sector-wanderer-figure:not([data-life-resident])[title^="${tracker.name}"]`);await expect(original).toHaveCount(1);await expect(original).toBeHidden();
    await page.clock.runFor(700);await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-tracking-${result}-party-returned.png`});
    await hunter.click();await expect(page.getByRole('dialog')).toContainText('back at the stop after following the animal trail');
});
async function enterLifeSector(page:Page,sector:number) {
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
    if(await back.isVisible())await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('[data-life-resident="keeper:15"]')).toBeAttached();
}

test('recorded duel scuffs blend into the actual ground, preserve legacy reports and fade away',async({page},info)=>{
    const start=shrineRoundTime();await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=15;save.currentTile=123;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let scars:SectorScar[]=[];
    await page.route('**/api/sector/traces**',route=>route.fulfill({json:{ok:true,sector:15,footfallToday:2,signs:[],mySparked:[],scars}}));
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,view:lifeSceneView(15,parseLifeState(null,now),now,'clear',undefined,undefined,undefined,scars),serverNow:now}});});
    const terrain=page.locator('.continuous-world-map>canvas');
    const settled=async()=>{let previous='',stable=0;await expect.poll(async()=>{const pixels=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());stable=pixels===previous?stable+1:0;previous=pixels;return stable;},{intervals:[100]}).toBeGreaterThanOrEqual(3);return previous;};
    await enterLifeSector(page,15);const clean=await settled();await terrain.screenshot({path:`${evidence}/${info.project.name}-duel-clean-ground.png`});
    writeFileSync(`${evidence}/${info.project.name}-duel-clean-terrain.png`,Buffer.from(clean.split(',')[1],'base64'));
    scars=[{kind:'duel',victor:'Rin',fallen:'Kota',at:start,tile:122},{kind:'duel',victor:'Aki',fallen:'Ben',at:start}];
    await page.clock.fastForward(21_000);await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(clean);const marked=await settled();
    await terrain.screenshot({path:`${evidence}/${info.project.name}-duel-scuffed-ground.png`});
    writeFileSync(`${evidence}/${info.project.name}-duel-scuffed-terrain.png`,Buffer.from(marked.split(',')[1],'base64'));
    await page.locator('.sector-life-point').click();await page.getByRole('button',{name:'Read local reports'}).click();await expect(page.getByRole('dialog')).toContainText('Rin stood over Kota');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    scars=[];await page.clock.fastForward(21_000);
    await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).toBe(clean);await terrain.screenshot({path:`${evidence}/${info.project.name}-duel-faded-ground.png`});
});
test('shrine upkeep paints each lamp, keeps the previous floor during loading, and brings a visitor on a return visit',async({page},info)=>{
    const start=shrineRoundTime();await installDateOnlyClock(page,start);
    // Stamp requests from the same browser timeline, including after a reload.
    await page.addInitScript(()=>{
        const fetch=window.fetch.bind(window);
        window.fetch=(input,init)=>{
            const url=input instanceof Request?input.url:String(input);
            if(!url.includes('/api/sector/life'))return fetch(input,init);
            const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
            headers.set('x-qa-clock-now',String(Date.now()));return fetch(input,{...init,headers});
        };
    });
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const save=uiAuditSave();save.currentSector=15;save.currentTile=123;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let state=parseLifeState(null,start),care={tier:0,maintainedAt:0,by:''},actions=0;
    await page.route('**/api/sector/life**',async route=>{
        const now=Number(route.request().headers()['x-qa-clock-now']);expect(Number.isSafeInteger(now)).toBe(true);state=parseLifeState(state,now);
        if(route.request().method()==='POST') {
            const body=route.request().postDataJSON(),next=advanceLifeEvent(15,state,body.window,body.step,'AuditNinja',now);
            state=next.state;if(next.changed)actions++;if(next.changed&&state.step===3)care={tier:0,maintainedAt:now,by:'AuditNinja'};
        }
        await route.fulfill({json:{ok:true,view:lifeSceneView(15,state,now,'clear',undefined,undefined,care),serverNow:now}});
    });
    let releaseLeft=()=>{},leftRequested=false;
    const gate=new Promise<void>(resolve=>{releaseLeft=resolve;});
    await page.route('**/sector-life/heartwood-left-lamp-v1.webp',async route=>{leftRequested=true;await gate;await route.continue();});
    const initialFloor=page.waitForResponse(response=>response.url().includes('/sector-life/heartwood-dormant-shrine-v1.webp'));
    await enterLifeSector(page,15);await (await initialFloor).finished();await page.waitForTimeout(500);
    expect(await page.evaluate(()=>Object.values(window.dateOnlyClock.proof()).every(Boolean))).toBe(true);
    const terrain=page.locator('.continuous-world-map>canvas');
    await terrain.screenshot({path:`${evidence}/${info.project.name}-shrine-unlit-floor.png`});
    await doRoadWork(page,lifeEventView(15,state,start));expect(actions).toBe(1);
    const before=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());
    await doRoadWork(page,lifeEventView(15,state,start));expect(actions).toBe(2);
    await expect.poll(()=>leftRequested).toBe(true);await page.waitForTimeout(100);
    expect(await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())===before).toBe(true);
    releaseLeft();await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(before);
    const left=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());
    await terrain.screenshot({path:`${evidence}/${info.project.name}-shrine-left-lamp-floor.png`});
    await doRoadWork(page,lifeEventView(15,state,start));expect(actions).toBe(3);
    await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(left);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-shrine-both-lamps.png`});
    await expect(page.getByRole('button',{name:/Tea Seller Ren:.*Talk/})).toBeAttached();
    await expect(page.locator('[data-life-resident="pilgrim:15:0"]')).toBeAttached();
    const done=lifeSceneView(15,state,care.maintainedAt,'clear',undefined,undefined,care);
    const pilgrim=done.actors.find(actor=>actor.id==='pilgrim:15:0')!;
    const arrival=pilgrim.motion!.frames.find(([time,tile])=>time>0&&tile===pilgrim.restTile)![0];
    const visitingAt=pilgrim.motion!.start+arrival+8000;
    await setDateOnlyClock(page,visitingAt);
    await enterLifeSector(page,15);
    const visitor=page.locator('[data-life-resident="pilgrim:15:0"]');
    await expect(visitor).toHaveAttribute('data-activity','Visiting the shrine',{timeout:60_000});await visitor.click();
    await expect(page.getByRole('dialog')).toContainText("stopped to visit the shrine");
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-shrine-visitor-return.png`});
    await setDateOnlyClock(page,start+LIFE_WINDOW_MS+60_000);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.sector-life-point')).toHaveAttribute('title','Check the tea stop approaches');
    const keeper=page.locator('[data-life-resident="keeper:15"]');await keeper.click();
    await expect(page.getByRole('dialog')).toContainText('AuditNinja helped with the last round');
    expect(actions).toBe(3);expect(errors).toEqual([]);
});

test('a failed supported-shrine image preserves the loaded terrain and retries on a fresh snapshot',async({page},info)=>{
    const start=shrineRoundTime();await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=15;save.currentTile=123;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let tier=0,failed=0,baseLoads=0;
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now()),state=parseLifeState(null,now);state.step=2;await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,state,now,'clear',undefined,undefined,{tier,maintainedAt:0,by:''})}});});
    await page.route('**/sector-life/heartwood-supported-shrine-v1.webp',async route=>{if(failed++===0)await route.abort('failed');else await route.continue();});
    // Start from the left-lit floor and never load the dormant image, so the
    // fallback cannot be satisfied by Chromium's decoded-image cache.
    await page.route('**/sector-life/heartwood-dormant-shrine-v1.webp',async route=>{baseLoads++;await route.abort('failed');});
    const initial=page.waitForResponse(response=>response.url().includes('/sector-life/heartwood-left-lamp-v1.webp'));
    await enterLifeSector(page,15);await (await initial).finished();await page.waitForTimeout(500);
    const terrain=page.locator('.continuous-world-map>canvas'),before=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL()),baseBefore=baseLoads;
    tier=1;await page.clock.fastForward(21_000);await expect.poll(()=>failed).toBe(1);await page.clock.runFor(1000);
    await expect.poll(()=>baseLoads).toBeGreaterThan(baseBefore);
    expect(await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())===before).toBe(true);
    await page.clock.fastForward(21_000);await expect.poll(()=>failed).toBe(2);
    await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(before);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-shrine-image-recovered.png`});
});

test('higher communal shrine support adds four painted lamps and two distinct visiting figures',async({page},info)=>{
    const start=shrineRoundTime();await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=15;save.currentTile=125;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',async route=>{
        const now=await page.evaluate(()=>Date.now());
        await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,parseLifeState(null,now),now,'clear',undefined,undefined,{tier:2,maintainedAt:start-120_000,by:'Aki',supportStartedAt:start-120_000})}});
    });
    const loaded=page.waitForResponse(response=>response.url().includes('/sector-life/heartwood-radiant-shrine-v1.webp'));
    await enterLifeSector(page,15);await (await loaded).finished();await page.waitForTimeout(500);
    const first=page.locator('[data-life-resident="pilgrim:15:0"]'),second=page.locator('[data-life-resident="pilgrim:15:1"]');
    await expect(first).toHaveAttribute('data-activity','Visiting the shrine');
    await expect(second).toHaveAttribute('data-activity','Visiting the shrine');
    await expect(first.locator('img')).toHaveAttribute('src',/courier/);await expect(second.locator('img')).toHaveAttribute('src',/tracker/);
    await expect(page.locator('[data-life-resident]')).toHaveCount(lifeSceneView(15,parseLifeState(null,start),start,'clear',undefined,undefined,{tier:2,maintainedAt:start-120_000,by:'Aki',supportStartedAt:start-120_000}).actors.length);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-shrine-high-support.png`});
});

test('an initial floor still decodes when a newer shrine state is waiting behind it',async({page})=>{
    const start=shrineRoundTime();await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=15;save.currentTile=123;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let tier=0,baseRequested=false,newRequested=false,releaseBase=()=>{},releaseNew=()=>{};
    const baseGate=new Promise<void>(resolve=>{releaseBase=resolve;}),newGate=new Promise<void>(resolve=>{releaseNew=resolve;});
    await page.route('**/sector-life/heartwood-dormant-shrine-v1.webp',async route=>{baseRequested=true;await baseGate;await route.continue();});
    await page.route('**/sector-life/heartwood-supported-shrine-v1.webp',async route=>{newRequested=true;await newGate;await route.continue();});
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,parseLifeState(null,now),now,'clear',undefined,undefined,{tier,maintainedAt:0,by:''})}});});
    await enterLifeSector(page,15);await expect.poll(()=>baseRequested).toBe(true);await page.waitForTimeout(500);
    tier=1;await page.clock.fastForward(21_000);await expect.poll(()=>newRequested).toBe(true);
    const terrain=page.locator('.continuous-world-map>canvas'),waiting=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());
    releaseBase();await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(waiting);
    // The renderer deliberately fills its tile cache over several frames.
    // Wait for that budgeted repaint to settle before checking retention.
    let decodedBase='',stable=0;
    await expect.poll(async()=>{const pixels=await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL());stable=pixels===decodedBase?stable+1:0;decodedBase=pixels;return stable;},{intervals:[100]}).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(100);expect(await terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())===decodedBase).toBe(true);
    releaseNew();await expect.poll(()=>terrain.evaluate(node=>(node as HTMLCanvasElement).toDataURL())).not.toBe(decodedBase);
});
for(const sector of Object.keys(LIFE_ROAD_CREWS).map(Number))test(`regional workers ${sector} meet a real partner at the handover and wait out bad weather`,async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',error=>{errors.push(error.message);console.log('[handover page error]',error.stack);});
    let day=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS+(LIFE_ROAD_CREWS[sector].night?21:8)*WORLD_HOUR_MS;
    // Review a naturally populated handover. Busy events may correctly omit the
    // complete pair to keep five figures; do not fabricate an uncapped cast.
    for(let attempt=0;attempt<100;attempt++){
        const pair=lifeActorsAt(sector,day,'clear').filter(a=>a.id.startsWith('crew:'));
        const period=pair[0].motion!.repeat!,cycle=pair[0].motion!.start+Math.ceil((day-pair[0].motion!.start)/period)*period;
        const meet=Math.max(...pair.map(actor=>actor.motion!.frames.find(([time,tile])=>time>=60_000&&tile===actor.restTile)![0]));
        const start=cycle+meet-25_000;
        if([0,31_000,52_000].every(offset=>lifeSceneView(sector,parseLifeState(null,start+offset),start+offset,'clear').actors.filter(a=>a.id.startsWith('crew:')).length===2))break;
        day+=WORLD_DAY_MS;
    }
    const sample=lifeActorsAt(sector,day,'clear').filter(a=>a.id.startsWith('crew:'));
    const period=sample[0].motion!.repeat!,cycle=sample[0].motion!.start+Math.ceil((day-sample[0].motion!.start)/period)*period;
    const meetingAt=Math.max(...sample.map(actor=>actor.motion!.frames.find(([time,tile])=>time>=60_000&&tile===actor.restTile)![0]));
    const start=cycle+meetingAt-25_000;
    await page.clock.install({time:new Date(start)});await page.clock.setFixedTime(new Date(start));
    const save=uiAuditSave();save.currentSector=sector;
    const occupied=lifeActorsAt(sector,start,'clear').flatMap(actor=>[actor.restTile,actor.workTile]);
    save.currentTile=[12,-12,1,-1,13,-13].map(delta=>nearestWalkableTile(sector,sample[0].restTile+delta)).find(tile=>!occupied.includes(tile))!;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear';
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,view:lifeSceneView(sector,parseLifeState(null,now),now,weather),serverNow:now}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
    if(await back.isVisible())await back.click();
    const first=page.locator(`[data-life-resident="crew:${sector}:0"]`),second=page.locator(`[data-life-resident="crew:${sector}:1"]`);
    await expect(first).toBeAttached();await expect(second).toBeAttached();
    await expect.poll(async()=>({activity:await first.getAttribute('data-activity'),errors}),{timeout:20_000}).toMatchObject({activity:expect.any(String),errors:[]});
    const moving=sample[0].motion!.frames.find(([time,tile])=>time>=60_000&&tile===sample[0].restTile)![0]===meetingAt?first:second;
    // Keep the shared route still while real bootstrap timers/RAF run, then
    // release Date before observing motion. A slow compile cannot skip arrival.
    await page.clock.setSystemTime(new Date(start));
    const before=await moving.getAttribute('style');
    await page.clock.fastForward(Math.max(0,cycle+61_000-start));await page.clock.runFor(3000);
    expect(await moving.getAttribute('style')).not.toBe(before);
    // Observe real walking, then cover the scene while its shared route moves
    // on. Resume at the meeting and keep drawing to catch cached-waypoint drift.
    await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});
    await page.waitForTimeout(80);
    const now=await page.evaluate(()=>Date.now());await page.clock.fastForward(cycle+meetingAt+6000-now);
    await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(1000);
    await expect(first).toHaveAttribute('data-activity',LIFE_ROAD_CREWS[sector].handover?.activity??'Exchanging road news');
    await expect(second).toHaveAttribute('data-activity',LIFE_ROAD_CREWS[sector].handover?.activity??'Exchanging road news');
    await expect(first).toBeVisible();await expect(second).toBeVisible();
    expect(await moving.getAttribute('style')).not.toBe(before);
    const a=(await first.boundingBox())!,b=(await second.boundingBox())!,map=(await page.locator('.continuous-world-map').boundingBox())!;
    expect(Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2)/(map.width/12)).toBeLessThan(1.4);
    const left=(await first.locator('.sector-wanderer-label').boundingBox())!,right=(await second.locator('.sector-wanderer-label').boundingBox())!;
    expect(Math.min(left.x+left.width,right.x+right.width)<=Math.max(left.x,right.x)||Math.min(left.y+left.height,right.y+right.height)<=Math.max(left.y,right.y)).toBe(true);
    await page.mouse.move(2,2);await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-regional-road-handover-${sector}.png`});
    await first.click();await expect(page.getByRole('dialog')).toContainText(LIFE_ROAD_CREWS[sector].names[1]);
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    weather='rain';await page.clock.fastForward(21_000);
    await expect(first).toHaveAttribute('data-activity','Waiting out the weather');
    await first.click();await expect(page.getByRole('dialog')).toContainText(sector===42?MIDLANDS_FIELD_LINES.weather:sector===52?"I'll wait beside the road until I can see the approaches clearly.":"stopped here while the view of the road is poor");
    expect(errors).toEqual([]);
});

test('the recurring Chronicle scribe remembers a meeting and discusses weather and a recorded local duel',async({page},info)=>{
    const start=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS+150_000;
    const route=travelerRoute(3),sector=route[(Math.floor(start/300_000)+6)%route.length];
    const sample=lifeActorsAt(sector,start,'clear').find(a=>a.id==='sumi')!;
    await page.clock.install({time:new Date(start)});
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=sample.restTile;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear';let scar:SectorScar|undefined=undefined;
    await page.route('**/api/sector/life**',async request=>{const now=await page.evaluate(()=>Date.now());await request.fulfill({json:{ok:true,view:lifeSceneView(sector,parseLifeState(null,now),now,weather,undefined,scar),serverNow:now}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
    if(await back.isVisible())await back.click();
    const scribe=page.locator('[data-life-resident="sumi"]');
    await expect(scribe.locator('img')).toHaveAttribute('src',/sage/);
    await scribe.click();await expect(page.getByRole('dialog')).toContainText('record names and witnessed deeds for the Chronicle');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    weather='rain';await page.clock.fastForward(21_000);
    await scribe.click();await expect(page.getByRole('dialog')).toContainText('Good to see you again.');
    await expect(page.getByRole('dialog')).toContainText('keeping my notes covered');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    weather='clear';scar={kind:'duel',victor:'Rin',fallen:'Kota',at:start-60_000};await page.clock.fastForward(21_000);
    await scribe.click();await expect(page.getByRole('dialog')).toContainText('local duel record names Rin as the winner against Kota');
    await page.getByRole('dialog').screenshot({path:`${evidence}/${info.project.name}-scribe-local-duel-record.png`});
});
for(const visitor of ['Ashen Leaf Village','Frostfang Village'])test(`village reactions: Frostfang patrol and quartermaster meet ${visitor}`,async({page},info)=>{
    let bucket=Math.floor(Date.now()/21_600_000),now=bucket*21_600_000+12*WORLD_HOUR_MS;
    let guard=wandererCastAt(31,bucket,now).find(w=>w.verb==='patrol');
    for(let i=0;!guard&&i<200;i++) {bucket++;now=bucket*21_600_000+12*WORLD_HOUR_MS;guard=wandererCastAt(31,bucket,now).find(w=>w.verb==='patrol');}
    expect(guard).toBeTruthy();
    await page.clock.install({time:new Date(now)});
    const save=uiAuditSave(),cooldowns=quietRoadCooldowns([31],now);delete cooldowns[guard!.id];
    save.currentSector=31;save.currentTile=guard!.homeTile;
    save.character={...save.character,village:visitor,wandererCooldowns:cooldowns};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:31,ownerClan:'WinterWatch',ownerVillage:'Frostfang Village',hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',route=>route.fulfill({json:{ok:true,view:lifeSceneView(31,parseLifeState(null,now),now,'clear',visitor),serverNow:now}}));
    await page.goto('/#/worldMap');
    const back=page.getByRole('button',{name:'Return to Sector 31',exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
    if(await back.isVisible())await back.click();
    const patrol=page.locator('.sector-wanderer-figure[title^="Frostfang Village Patrol"]');
    await expect(patrol).toBeVisible();await patrol.click();
    const dialog=page.getByRole('dialog'),rival=visitor==='Ashen Leaf Village';
    await expect(dialog).toContainText(rival?'Leaf Rat. Keep walking.':/one of ours|friendly face|Safe travels/);
    await expect(dialog.getByRole('button',{name:'Move along',exact:true})).toBeVisible();
    if(!rival)await expect(dialog.getByRole('button',{name:'Fight patrol',exact:true})).toHaveCount(0);
    await dialog.screenshot({path:`${evidence}/${info.project.name}-frostfang-${rival?'rival':'home'}-patrol.png`});
    await dialog.getByRole('button',{name:'Move along',exact:true}).click();
    const tile=page.locator('.continuous-world-tile').nth(102);await tile.focus();await tile.press('Enter');
    const worker=page.getByRole('button',{name:/Quartermaster Ise:.*Talk/});
    await expect(worker).toBeVisible({timeout:30_000});await worker.click();
    await expect(dialog).toContainText(rival?"Don't touch our supplies. Ask first.":'Good to see one of ours.');
    await expect(dialog).toContainText('checking the blankets');
    await dialog.screenshot({path:`${evidence}/${info.project.name}-frostfang-${rival?'rival':'home'}-quartermaster.png`});
});
async function doRoadWork(page:Page,view:ReturnType<typeof lifeEventView>,clocked=false) {
    const {action,tile}=view;
    await page.locator('.sector-life-point').click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    const walk=dialog.getByRole('button',{name:'Walk to the work point',exact:true});
    if(await walk.isVisible()) {
        await walk.click();await expect(dialog).not.toBeVisible();
        await expect.poll(async()=>{
            if(clocked)await page.clock.runFor(1000);
            const map=await page.locator('.continuous-world-map').boundingBox(),goal=await page.locator('.continuous-world-tile').nth(tile).boundingBox();
            if(!map||!goal)return Infinity;
            return Math.hypot(goal.x+goal.width/2-map.x-map.width/2,goal.y+goal.height/2-map.y-map.height/2)/(map.width/12);
        },{timeout:30_000,intervals:[1000]}).toBeLessThan(1.5);
        await page.locator('.sector-life-point').click();
    }
    await page.getByRole('dialog').getByRole('button',{name:action,exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
}
for (const sector of [2,15,42]) test(`sector ${sector}: painted workplace stays staffed through the shared errand`,async({page},info)=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    let now=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+60_000;
    let state=parseLifeState(null,now),actions=0;
    if(sector===2){await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(new Date(now));}
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=sector===42?112:lifeAnchors(sector)[0];
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([sector]),avatarImage:'/portraits/corvo-latch.webp'};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()==='POST') {
            const body=route.request().postDataJSON(),next=advanceLifeEvent(sector,state,body.window,body.step,'AuditNinja',now);
            if(next.changed)actions++;state=next.state;
        }
        await route.fulfill({json:{ok:true,view:lifeSceneView(sector,state,now,'clear'),serverNow:sector===2?now:Date.now()}});
    });
    await page.route('**/api/sector/traces**',route=>route.fulfill({json:{ok:true,sector,footfallToday:7,signs:[],mySparked:[],scars:[{kind:'duel',victor:'Rin',fallen:'Kota',at:Date.now()-60_000}]}}));
    if(sector===42) now=Math.floor(now/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+19*60_000;
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','worldMap',{timeout:60_000});
    await waitForCurrentSectorMap(page,sector);
    await expect(page.locator('[data-life-resident]')).not.toHaveCount(0);
    await expect(page.locator('[data-life-resident] .sector-avatar-body img').first()).toHaveAttribute('src',/tracker|courier|pilgrim|merchant/);
    await expect(page.locator('.sector-life-wildlife canvas')).toBeAttached();
    if(sector===42) {
        await expect(page.locator('.sector-life-point')).toHaveClass(/life-unattended/);
        const seller=page.getByRole('button',{name:/Tea Seller Mako:.*Talk/});
        await expect(seller).toBeVisible();
        await seller.click();
        await expect(page.getByRole('dialog')).toContainText(/kettle|cups/);
        await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-midlands-staffed-no-errand.png`});
        now=Math.floor(now/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+60_000;
        await page.reload();
        await waitForCurrentSectorMap(page,sector);
        await expect(page.locator('.sector-life-point')).toHaveClass(/life-active/);
    }
    for(let step=0;step<3;step++) {
        if(sector===2&&step===2){
            // The dock now has a real carrying/unloading interval. Advance
            // this fixture's server and client clocks together before asking
            // for completion, instead of bypassing the delivery wait.
            now+=DOCK_SHIPMENT_DELIVERY_MS;await page.clock.setFixedTime(new Date(now));await page.clock.fastForward(21_000);
            await expect(page.locator('[data-life-resident="shipment:merchant"]')).toHaveAttribute('data-activity','Checking the delivered bundles');
        }
        await doRoadWork(page,lifeEventView(sector,state,now),sector===2);
        await expect.poll(()=>actions).toBe(step+1);
    }
    await expect(page.locator('.sector-life-point')).toHaveClass(/life-aftermath/);
    await expect(page.locator('[data-life-resident]').first()).toHaveAttribute('data-activity',lifeSceneView(sector,state,now,'clear').actors[0].activity);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-sector-${sector}-aftermath.png`});
    await page.locator('.sector-life-point').click();
    await page.getByRole('dialog').getByRole('button',{name:'Read local reports',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Rin stood over Kota');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    expect(errors).toEqual([]);
});

test('daytime wildlife reacts to walking and stays visible without animation under reduced motion',async({page},info)=>{
    const save=uiAuditSave();save.currentSector=42;save.currentTile=112;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([42])};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>{
        localStorage.setItem('dayCycle.hour','12');localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45]));
        const state={frames:0,points:[] as number[][]};Object.assign(window,{wildlifeQa:state});
        const clear=CanvasRenderingContext2D.prototype.clearRect,translate=CanvasRenderingContext2D.prototype.translate;
        CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.closest('.sector-life-wildlife')){state.frames++;state.points=[];}return clear.apply(this,args);};
        CanvasRenderingContext2D.prototype.translate=function(x,y){if(this.canvas.closest('.sector-life-wildlife'))state.points.push([x,y,this.canvas.clientWidth,this.canvas.clientHeight]);return translate.call(this,x,y);};
    });
    await page.route('**/api/sector/life**',request=>{const now=Date.now();return request.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(42,parseLifeState(null,now),now,'clear')}});});
    const stats=()=>page.evaluate(()=>(window as unknown as {wildlifeQa:{frames:number;points:number[][]}}).wildlifeQa);
    async function enter() {
        await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 42',exact:false});
        await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
        if(await back.isVisible())await back.click();
        await expect(page.locator('.sector-life-wildlife canvas')).toBeAttached();
    }
    await enter();await expect.poll(async()=>(await stats()).frames).toBeGreaterThan(3);
    const canvas=page.locator('.sector-life-wildlife canvas');
    const before=Number(await canvas.getAttribute('data-wildlife-reaction')??0);
    const points=(await stats()).points.filter(([x,y,w,h])=>x>0&&x<w&&y>0&&y<h);
    expect(points.length).toBeGreaterThan(0);
    const [x,y,w,h]=points.at(-1)!;
    const target=nearestWalkableTile(42,Math.min(11,Math.floor(y/h*12))*12+Math.min(11,Math.floor(x/w*12)));
    const tile=page.locator('.continuous-world-tile').nth(target);await tile.focus();await tile.press('Enter');
    await expect.poll(async()=>Number(await canvas.getAttribute('data-wildlife-reaction')??0),{timeout:30_000}).toBeGreaterThan(before);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-wildlife-response.png`});
    await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});
    await page.waitForTimeout(100);const paused=(await stats()).frames;await page.waitForTimeout(250);expect((await stats()).frames).toBe(paused);
    await page.evaluate(()=>document.querySelector('body > .combat-instance')?.remove());
    await expect.poll(async()=>(await stats()).frames).toBeGreaterThan(paused);
    await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await enter();
    await page.waitForTimeout(250);const still=(await stats()).frames;await page.waitForTimeout(250);expect((await stats()).frames).toBe(still);
    const viewport=page.viewportSize()!;await page.setViewportSize({width:viewport.width-10,height:viewport.height-10});
    await expect.poll(async()=>(await stats()).frames).toBeGreaterThan(still);
    const pixels=await canvas.evaluate(node=>{const c=node as HTMLCanvasElement,data=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let visible=0;for(let i=3;i<data.length;i+=4)if(data[i])visible++;return visible;});
    expect(pixels).toBeGreaterThan(0);
});

test('a recurring traveler remembers a meeting and walks out along the road',async({page},info)=>{
    const route=travelerRoute(1);let slot=Math.floor(Date.now()/3_000_000)*10+8;
    while(isWorldNight(slot*300_000+120_000))slot+=10;
    const start=slot*300_000;
    expect(route[(slot+2)%route.length]).toBe(15);
    await page.clock.install({time:new Date(start+120_000)});
    const save=uiAuditSave();save.currentSector=15;save.currentTile=115;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([15])};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>{localStorage.setItem('dayCycle.hour','12');localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45]));});
    let polls=0;
    await page.route('**/api/sector/life**',async request=>{
        const now=await page.evaluate(()=>Date.now());polls++;
        await request.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,parseLifeState(null,now),now,'clear')}});
    });
    async function openSector() {
        await page.goto('/#/worldMap');
        const back=page.getByRole('button',{name:'Return to Sector 15',exact:false});
        await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
        if(await back.isVisible())await back.click();
        await expect(page.locator('[data-life-resident="nao"]')).toBeVisible();
    }
    await openSector();
    const nao=page.locator('[data-life-resident="nao"]');
    await nao.focus();await nao.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('roadside shrines');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await page.reload();
    await openSector();
    await nao.focus();await nao.press('Enter');
    await expect(page.getByRole('dialog')).toContainText("We've met before");
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    // The exact body portal is the shared animation/poll suspension signal.
    await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});
    await page.clock.runFor(100);
    const paused=polls;
    await page.clock.fastForward(45_000);expect(polls).toBe(paused);
    await page.evaluate(()=>document.querySelector('body > .combat-instance')?.remove());
    await expect.poll(()=>polls).toBeGreaterThan(paused);
    const before=await nao.getAttribute('style');
    await page.clock.setSystemTime(new Date(start+265_000));
    await page.clock.fastForward(20_000);
    await page.clock.runFor(4_000);
    await expect(nao).toHaveAttribute('data-activity','Continuing along the road');
    expect(await nao.getAttribute('style')).not.toBe(before);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-traveler-departure.png`});
    await page.clock.fastForward(35_000);
    await expect(nao).toHaveCount(0);
});

test('tea staff follow server weather and night while staying beside the painted table',async({page},info)=>{
    const day=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS;
    await page.clock.install({time:new Date(day+8*WORLD_HOUR_MS)});
    const save=uiAuditSave();save.currentSector=42;save.currentTile=112;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([42])};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear';
    await page.route('**/api/sector/life**',async request=>{const now=await page.evaluate(()=>Date.now());await request.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(42,parseLifeState(null,now),now,weather)}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 42',exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
    if(await back.isVisible())await back.click();
    const seller=page.locator('[data-life-resident="resident:42"]');
    await expect(seller).toHaveAttribute('data-activity','Preparing tea');const position=await seller.getAttribute('style');
    weather='rain';await page.clock.fastForward(21_000);
    await expect(seller).toHaveAttribute('data-activity','Waiting out the weather');
    await seller.click();await expect(page.getByRole('dialog')).toContainText('weather');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    expect(await seller.getAttribute('style')).toBe(position);
    weather='clear';await page.clock.setSystemTime(new Date(day+21*WORLD_HOUR_MS));await page.clock.fastForward(21_000);
    await expect(seller).toHaveAttribute('data-activity','Resting at the stop');
    await seller.click();await expect(page.getByRole('dialog')).toContainText('last cups');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    expect(await seller.getAttribute('style')).toBe(position);
    await expect.poll(()=>page.locator('.continuous-world-map .day-night-tint').evaluate(node=>Number((node as HTMLElement).style.opacity))).toBeGreaterThan(.35);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-tea-stop-night.png`});
});

test('helping the winter courier brings them back to the staffed warming stop',async({page},info)=>{
    test.setTimeout(180_000);
    const start=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+60_000;
    await page.clock.install({time:new Date(start)});
    let state=parseLifeState(null,start),actions=0;
    const path=lifeCourierRoute(31),save=uiAuditSave();save.currentSector=31;save.currentTile=path.search;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([31])};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>{localStorage.setItem('dayCycle.hour','12');localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45]));});
    await page.route('**/api/sector/life**',async request=>{
        const now=await page.evaluate(()=>Date.now());
        if(request.request().method()==='POST') {const body=request.request().postDataJSON(),next=advanceLifeEvent(31,state,body.window,body.step,'AuditNinja',now);state=next.state;if(next.changed)actions++;}
        await request.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(31,state,now,'clear')}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 31',exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    const courier=page.locator('[data-life-resident="courier:31"]');
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');await expect(courier).toBeAttached();await page.clock.runFor(1000);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-winter-courier-search.png`});
    await doRoadWork(page,lifeEventView(31,state,start),true);await expect.poll(()=>actions).toBe(1);
    await expect(courier).toBeVisible();await courier.click();await expect(page.getByRole('dialog')).toContainText('twisted my ankle');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await doRoadWork(page,lifeEventView(31,state,await page.evaluate(()=>Date.now())),true);await expect.poll(()=>actions).toBe(2);
    const beforeReturn=await courier.getAttribute('style');await page.clock.runFor(6000);expect(await courier.getAttribute('style')).not.toBe(beforeReturn);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-winter-courier-returning.png`});
    await page.clock.fastForward(path.returnMs+21_000);await page.clock.runFor(15_000);await expect(courier).toHaveAttribute('data-activity','Waiting at the roadside stop');
    await doRoadWork(page,lifeEventView(31,state,await page.evaluate(()=>Date.now())),true);await expect.poll(()=>actions).toBe(3);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-winter-courier-resting.png`});
    await expect(page.locator('[data-life-resident="resident:31"]')).toBeVisible();
    const tile=page.locator('.continuous-world-tile').nth(path.stop),body=await courier.boundingBox(),ground=await tile.boundingBox();expect(body&&ground).toBeTruthy();
    expect(Math.abs(body!.x+body!.width/2-ground!.x-ground!.width/2)).toBeLessThan(ground!.width/2);
    await page.locator('.sector-life-point').click();await expect(page.getByRole('dialog')).toContainText('courier is back at the stop');
});

test('the helped winter courier resumes deliveries and their departure survives a return visit',async({page},info)=>{
    const path=lifeCourierRoute(31),start=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+300_000;
    await page.clock.install({time:new Date(start)});const state={...parseLifeState(null,start),step:3,updatedAt:start-COURIER_REST_MS-6000,contributors:['AuditNinja']};
    const save=uiAuditSave();save.currentSector=31;save.currentTile=path.onward[1];save.character={...save.character,wandererCooldowns:quietRoadCooldowns([31],start)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,view:lifeSceneView(31,state,now,'clear'),serverNow:now}});});
    const enter=async()=>{await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 31',exact:false});await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');};
    await enter();const courier=page.locator('[data-life-resident="courier:31"]');await expect(courier).toHaveAttribute('data-activity','Continuing the delivery route');
    const before=await courier.getAttribute('style');await page.clock.runFor(4000);expect(await courier.getAttribute('style')).not.toBe(before);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-winter-courier-leaving.png`});
    await page.clock.fastForward((path.onward.length-1)*3000+21_000);await expect(courier).toHaveCount(0);await enter();await expect(courier).toHaveCount(0);
    await expect(page.locator('[data-life-resident="resident:31"]')).toBeVisible();await page.locator('.sector-life-point').click();await expect(page.getByRole('dialog')).toContainText('courier has rested');
});

test('an unattended winter courier returns and rests without claiming player help',async({page},info)=>{
    const path=lifeCourierRoute(31),start=Math.floor(Date.now()/LIFE_WINDOW_MS)*LIFE_WINDOW_MS+LIFE_ACTIVE_MS+path.returnMs+3000;
    await page.clock.install({time:new Date(start)});const save=uiAuditSave();save.currentSector=31;save.currentTile=path.meet;
    save.character={...save.character,wandererCooldowns:quietRoadCooldowns([31],start)};await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',async route=>{const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,view:lifeSceneView(31,parseLifeState(null,now),now,'clear'),serverNow:now}});});
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 31',exact:false});await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    const courier=page.locator('[data-life-resident="courier:31"]');await expect(courier).toHaveAttribute('data-activity','Resting at the roadside stop');
    await courier.click();await expect(page.getByRole('dialog')).toContainText("resting my ankle");await expect(page.getByRole('dialog')).not.toContainText('Thank');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-winter-courier-unattended.png`});
    await page.locator('.sector-life-point').click();await expect(page.getByRole('dialog')).toContainText('returned without help');
});

for(const kind of ['tea','shrine'] as const)test(`two independent players share ${kind} stages and keep the aftermath after a reload`,async({page,browser},info)=>{
    const other=await browser.newPage({viewport:page.viewportSize()!});
    const start=(Math.floor(Date.now()/LIFE_WINDOW_MS/2)*2+(kind==='shrine'?1:0))*LIFE_WINDOW_MS+60_000;
    let state=parseLifeState(null,start);
    const pages=[page,other],names=['AuditNinja','Mika'];
    async function enter(target:Page) {
        await target.goto('/#/worldMap');const back=target.getByRole('button',{name:'Return to Sector 15',exact:false});
        await expect.poll(async()=>await back.isVisible()||await target.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);
        if(await back.isVisible())await back.click();await expect(target.locator('.sector-life-point')).toBeVisible();
    }
    try {
        for(let i=0;i<pages.length;i++) {
            const target=pages[i],name=names[i],save=uiAuditSave();
            await target.clock.install({time:new Date(start)});
            save.currentSector=15;save.currentTile=lifeEventView(15,state,start).tile;save.character={...save.character,name,wandererCooldowns:quietRoadCooldowns([15])};
            await installUiAuditRuntime(target,save,false,name);
            await target.addInitScript(name=>{localStorage.setItem('dayCycle.hour','12');localStorage.setItem(`legacyRumors.seen.v1:${name.toLowerCase()}`,JSON.stringify([10,20,30,40,45]));},name);
            await target.route('**/api/sector/life**',async request=>{
                const now=await target.evaluate(()=>Date.now());
                if(request.request().method()==='POST') {const body=request.request().postDataJSON();state=advanceLifeEvent(15,state,body.window,body.step,body.playerName,now).state;}
                await request.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,state,now,'clear')}});
            });
            await enter(target);
        }
        const first=lifeEventView(15,state,start).action;
        await other.locator('.sector-life-point').click();await page.locator('.sector-life-point').click();
        await page.getByRole('dialog').getByRole('button',{name:first,exact:true}).click();await expect.poll(()=>state.step).toBe(1);
        await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        // Mika's already-open dialog carries the old stage. Replaying it must not skip the next task.
        await other.getByRole('dialog').getByRole('button',{name:first,exact:true}).click();await other.getByRole('dialog').getByRole('button',{name:/Close/}).click();expect(state.step).toBe(1);
        for(let step=1;step<3;step++){await doRoadWork(other,lifeEventView(15,state,start),true);await expect.poll(()=>state.step).toBe(step+1);}
        expect(state.contributors).toEqual(names);
        await page.clock.fastForward(21_000);await expect(page.locator('.sector-life-point')).toHaveClass(/life-aftermath/);
        await expect(other.locator('.sector-life-point')).toHaveClass(/life-aftermath/);
        await page.reload();await enter(page);await expect(page.locator('.sector-life-point')).toHaveClass(/life-aftermath/);
        await page.locator('.sector-life-point').click();await expect(page.getByRole('dialog')).toContainText('AuditNinja, Mika');
        await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        await other.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-shared-${kind}-aftermath.png`});
    } finally {await other.close();}
});

for(const weather of ['clear','rain'] as const)test(`courier tea stop ${weather}: Tetsu rests by the staffed painted table and leaves during an outage`,async({page},info)=>{
    let slot=Math.floor(Date.now()/300_000);
    const visit=weather==='clear'?TETSU_ROUTE.indexOf(15):TETSU_ROUTE.lastIndexOf(15);
    while(slot%TETSU_ROUTE.length!==visit||isWorldNight(slot*300_000+150_000))slot++;
    const initial=slot*300_000+150_000;
    await page.clock.install({time:new Date(initial)});await page.clock.setFixedTime(new Date(initial));
    const save=uiAuditSave();save.currentSector=15;save.currentTile=117;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([15],initial)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let offline=false,polls=0;
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/sector/life**',async route=>{
        polls++;if(offline){await route.abort();return;}
        const now=await page.evaluate(()=>Date.now());
        await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(15,parseLifeState(null,now),now,weather)}});
    });
    await page.goto('/#/worldMap');const back=page.getByRole('button',{name:'Return to Sector 15',exact:false});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    const courier=page.locator('[data-life-resident="tetsu"]'),seller=page.locator('[data-life-resident="resident:15"]');
    await expect(courier).toBeVisible();await expect(seller).toBeVisible();
    await expect(courier).toHaveAttribute('data-activity',weather==='clear'?'Resting at the tea table':'Keeping the letters covered');
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false');
    await courier.click();const rest=weather==='clear'?TEA_COURIER_LINES.resting:TEA_COURIER_LINES.covered;
    await expect(page.getByRole('dialog')).toContainText(rest);await expect(page.getByRole('dialog')).not.toContainText('Good to see you again.');
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await courier.click();await expect(page.getByRole('dialog')).toContainText(`Good to see you again. ${rest}`);
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await page.mouse.move(2,2);await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-courier-tea-${weather}-rest.png`});
    offline=true;await page.clock.setSystemTime(new Date(initial));const actor=lifeActorsAt(15,initial,weather).find(a=>a.id==='tetsu')!,departure=actor.phases!.at(-1)!.at;
    await page.clock.fastForward(departure-initial+1000);await page.clock.runFor(3000);
    await expect(courier).toHaveAttribute('data-activity','Continuing along the road');
    await courier.click();await expect(page.getByRole('dialog')).toContainText(TEA_COURIER_LINES.leaving);await expect(page.getByRole('dialog')).not.toContainText(rest);
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    const now=await page.evaluate(()=>Date.now());await page.clock.fastForward(actor.hideAt!-now+1000);
    // Let the actual navigator reach its exit; do not spend thirty simulated
    // seconds redrawing an actor who has already left on the shorter road.
    for(let seconds=0;seconds<30&&await courier.isVisible();seconds++)await page.clock.runFor(1000);
    await expect(courier).not.toBeVisible();await expect(seller).toBeVisible();expect(polls).toBeGreaterThan(1);
    await page.locator('.continuous-world-map').screenshot({path:`${evidence}/${info.project.name}-courier-tea-${weather}-departed.png`});expect(errors).toEqual([]);
});

for(const mode of ['round','rain'] as const)test(`Ashen herbalist ${mode}: inspects actual fern edges and walks into the painted village`,async({page},info)=>{
    test.setTimeout(240_000);
    const sector=FORAGER_SITE.sector,start=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    const sample=lifeActorsAt(sector,start,'clear').find(a=>a.id==='resident:9')!;
    const first=sample.phases![0].at,second=sample.phases![2].at;
    await page.clock.install({time:new Date(first+4000)});await page.clock.setFixedTime(new Date(first+4000));
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=39;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([sector],start)};
    await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector,ownerClan:'ForagerReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(offline){await route.abort();return;}
        const now=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(sector,parseLifeState(null,now),now,weather)}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(map).toHaveAttribute('aria-busy','false');
    const herbalist=page.locator('[data-life-resident="resident:9"]');await expect(herbalist).toBeAttached();await expect(herbalist).toHaveCount(1);
    // Suspend native movement while preparing a paused clock. Rewinding a live
    // navigator to make pauseAt headroom sends it toward an earlier work phase.
    // Resume at the same inspection instant used for bootstrap, then observe
    // every subsequent walk through normal coherent Date/RAF advancement.
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(first+4000-60_000));await page.clock.pauseAt(new Date(first+4000));
    await page.evaluate(()=>{delete (document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(async()=>{
        const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();
        Object.assign(window,{foragerReadPose:()=>{
            const node=document.querySelector<HTMLElement>('[data-life-resident="resident:9"]');
            if(!node)throw new Error('The native herbalist figure was removed during its round.');
            const point=registry.figureGroundPosition(node);if(!point)throw new Error('The native herbalist has not published a ground pose.');
            return {...point,at:performance.now()};
        }});
    });
    const position=()=>page.evaluate(()=>(window as unknown as {foragerReadPose:()=>{col:number;row:number;at:number}}).foragerReadPose());
    const atTile=async(tile:number)=>{const p=await position();expect(Math.hypot(p.col-tile%12,p.row-Math.floor(tile/12))).toBeLessThan(.18);};
    await page.clock.runFor(1000);await expect(herbalist).toBeVisible();await atTile(FORAGER_SITE.patches[0]);
    console.log(`[forager ${info.project.name} ${mode}] first leaf edge`,await position());
    await expect(herbalist).toHaveAttribute('data-activity','Examining the fern patch');
    const name=(await herbalist.locator('.sector-wanderer-label').boundingBox())!;
    for(const label of await page.locator('.sector-village-entrance-name,.sector-village-entrance-action').all()){
        const box=(await label.boundingBox())!;
        expect(Math.min(name.x+name.width,box.x+box.width)<=Math.max(name.x,box.x)||Math.min(name.y+name.height,box.y+box.height)<=Math.max(name.y,box.y)).toBe(true);
    }
    await map.screenshot({path:`${evidence}/${info.project.name}-forager-${mode}-fern.png`});
    await herbalist.click();await expect(page.getByRole('dialog')).toContainText(FORAGER_LINES.inspect);
    await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    if(mode==='round'){
        await page.clock.setSystemTime(new Date(second+1000));await page.clock.runFor(4000);await atTile(FORAGER_SITE.patches[1]);
        console.log(`[forager ${info.project.name} ${mode}] upper leaf edge`,await position());
        await expect(herbalist).toHaveAttribute('data-activity','Examining the upper leaves');
        await map.screenshot({path:`${evidence}/${info.project.name}-forager-upper-leaves.png`});
        offline=true;await page.clock.setSystemTime(new Date(sample.hideAt!+5000));
    }else{
        weather='rain';const before=await position();await page.clock.fastForward(21_000);
        const after=await position();expect(Math.hypot(after.col-before.col,after.row-before.row)).toBeLessThan(Math.max(0,after.at-before.at-21_000)/1000*.6+.18);
    }
    // Observe the actual native navigator, including each corner, rather than
    // asserting only that its server timeline ends at the right place.
    let previous=await position();for(let i=0;i<7;i++){
        await page.clock.runFor(3000);const next=await position();expect(Math.hypot(next.col-previous.col,next.row-previous.row)).toBeLessThan((next.at-previous.at)/1000*.6+.1);
        expect(isWalkableTile(sector,Math.round(next.row)*12+Math.round(next.col))).toBe(true);previous=next;
        console.log(`[forager ${info.project.name} ${mode}] return ${i+1}`,next);
    }
    await atTile(FORAGER_SITE.door);await expect(herbalist).not.toBeVisible();
    await map.screenshot({path:`${evidence}/${info.project.name}-forager-${mode}-inside.png`});
    if(mode==='round'){
        await page.clock.setSystemTime(new Date(start+FORAGER_SITE.period+40_000));await page.clock.runFor(1000);
        await expect(herbalist).not.toBeVisible();await atTile(FORAGER_SITE.door);
    }else{
        weather='clear';await page.clock.setSystemTime(new Date(start+FORAGER_SITE.period));await page.clock.fastForward(21_000);
        await page.clock.runFor(18_000);await expect(herbalist).toBeVisible();await atTile(FORAGER_SITE.patches[0]);
    }
    expect(errors).toEqual([]);
});
