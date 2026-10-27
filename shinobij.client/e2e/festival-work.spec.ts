import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeActorsAt,lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {festivalStallPlan,FESTIVAL_SITE,FESTIVAL_LINES,FESTIVAL_STAGE} from '../../shared/sector-festival-work';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';

type Pose={col:number;row:number;activity?:string;visible:boolean};
declare global{interface Window{festivalWorkPoses:()=>Record<string,Pose>}}
const evidence=process.env.FESTIVAL_WORK_EVIDENCE_DIR??'../output/living-world/festival/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const FESTIVAL_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);
for(const mode of ['square steps','opening','packing','rain','cached closure','missing counter','reduced motion','crowded counter'] as const)test(`Festival work: ${mode}`,async({page},info)=>{
    test.setTimeout(600_000);page.setDefaultTimeout(15_000);
    let day=Math.floor(FESTIVAL_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS;
    const crowded=mode==='square steps'||mode==='crowded counter';
    const fixture=(day:number)=>{
        const pair=lifeActorsAt(52,day+8*WORLD_HOUR_MS,'clear').filter(a=>a.id.startsWith('crew:'));
        const phase=pair[0].cyclePhases!.find(p=>p.activity==='Exchanging road news')!;
        return{pair,now:mode==='opening'?day+5*WORLD_HOUR_MS+1000:mode==='packing'?festivalStallPlan(day+8*WORLD_HOUR_MS).packAt-3000:crowded?pair[0].motion!.start+3*pair[0].motion!.repeat!+phase.at+1000:day+8*WORLD_HOUR_MS};
    };
    for(let i=0;i<30;i++,day+=WORLD_DAY_MS){const at=fixture(day).now;if(lifeSceneView(52,{...parseLifeState(null,at),step:3,updatedAt:at-1000},at,'clear').actors.some(a=>a.id==='crew:52:0'))break;}
    const {pair,now}=fixture(day),plan=festivalStallPlan(now);
    if(mode==='reduced motion')await page.emulateMedia({reducedMotion:'reduce'});
    // This clock is for functional route/floor checks, never a timing benchmark.
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=52;save.currentTile=crowded?102:116;
    // The square case also retains the ordinary unclaimed Chronicle scribe.
    save.character={...save.character,starterCardsClaimed:!crowded,wandererCooldowns:quietRoadCooldowns([52],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false;const errors:string[]=[],mutations:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    if(mode==='missing counter')await page.route('**/sector-life/festival-tea-counter-*.webp',route=>route.abort());
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:52,ownerClan:'FestivalReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{if(route.request().method()!=='GET')mutations.push(route.request().method());if(offline){await route.abort();return;}const at=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(52,{...parseLifeState(null,at),step:3,updatedAt:now-1000},at,weather)}});});
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 52',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    const eda=page.locator('[data-life-resident="resident:52"]'),nene=page.locator('[data-life-resident="crew:52:0"]'),ko=page.locator('[data-life-resident="crew:52:1"]');
    await expect(eda).toBeVisible();await expect(nene).toHaveCount(1);await expect(ko).toHaveCount(1);
    await page.evaluate(async()=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.festivalWorkPoses=()=>Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-life-resident]')).map(node=>{const p=registry.figureGroundPosition(node);if(!p)throw Error('Native festival pose missing');return[node.dataset.lifeResident!,{...p,activity:node.dataset.activity,visible:node.style.visibility!=='hidden'}];}));});
    const floor=()=>page.evaluate(async()=>(await import('/src/lib/sector-displayed-floor.ts')).displayedSectorFloor(52));
    await page.clock.runFor(300);
    await expect.poll(floor).toContain(mode==='missing counter'?'/sector-map/s14.webp':mode==='opening'?FESTIVAL_SITE.packed:FESTIVAL_SITE.open);
    await page.clock.runFor(300);
    const captures:Record<string,Pose>[]=[],read=()=>page.evaluate(()=>window.festivalWorkPoses());
    const check=async()=>{const poses=await read();captures.push(poses);writeFileSync(`${evidence}/${info.project.name}-${mode.replaceAll(' ','-')}-latest.json`,JSON.stringify(poses,null,2));
        for(const [id,p]of Object.entries(poses))if(p.visible){const tile=Math.round(p.row)*12+Math.round(p.col);
            if(p.activity==='Demonstrating the festival steps'){expect(FESTIVAL_STAGE).toContain(tile);expect(['crew:52:0','crew:52:1']).toContain(id);}
            if(p.activity==='Serving at the festival counter'){expect(id).toBe('resident:52');expect(p.col).toBeCloseTo(8,1);expect(p.row).toBeCloseTo(8,1);expect(await floor()).toContain(FESTIVAL_SITE.open);}
            if(id.startsWith('crew:52:'))expect([92,104]).not.toContain(tile);
        }return poses;};
    const capture=async(name:string)=>{await map.screenshot({path:`${evidence}/${info.project.name}-${name}.png`});};
    const talk=async(actor:typeof eda,line:string)=>{await actor.click();await expect(page.getByRole('dialog')).toContainText(line);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();};
    await check();await capture(`${mode.replaceAll(' ','-')}-initial`);
    if(mode==='crowded counter'){
        await expect(page.locator('.sector-wanderer-label').filter({hasText:'Scribe Ihara'})).toBeVisible();
        const geometry=await map.evaluate(root=>{const rect=(node:Element)=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return Array.from(root.querySelectorAll<HTMLElement>('.sector-wanderer-label,.sector-wanderer-bubble')).filter(node=>node.offsetParent&&node.parentElement!.style.visibility!=='hidden').map(node=>({text:node.textContent,speech:node.classList.contains('sector-wanderer-bubble'),rect:rect(node),body:rect(node.parentElement!.querySelector('.sector-avatar-body')!)}));});
        writeFileSync(`${evidence}/${info.project.name}-crowded-counter-geometry.json`,JSON.stringify(geometry,null,2));
        for(const {rect:r,body:b,text,speech}of geometry)if(!speech)expect(Math.hypot(Math.max(b.x-r.x-r.width,r.x-b.x-b.width,0),Math.max(b.y-r.y-r.height,r.y-b.y-b.height,0)),`${text}: name stays near its actual owner`).toBeLessThanOrEqual(Math.max(28,b.height*1.2));
        await talk(eda,FESTIVAL_LINES.serving);await talk(nene,"I'm comparing the festival approaches with Festival Runner Ko");await talk(ko,"I'm comparing the festival approaches with Festival Guide Nene");
        expect(await page.locator('.sector-life-point').evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.sector-life-point')===node;})).toBe(true);
    }else if(mode==='square steps'){
        await talk(nene,"I'm comparing the festival approaches with Festival Runner Ko");await talk(ko,"I'm comparing the festival approaches with Festival Guide Nene");
        expect(await page.locator('.sector-life-point').evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.sector-life-point')===node;})).toBe(true);
        const step=pair[0].cyclePhases!.find(p=>p.workArea)!,end=pair[0].cyclePhases!.find(p=>p.activity==='Returning to the road post')!;
        await page.clock.fastForward(step.at-pair[0].cyclePhases!.find(p=>p.activity==='Exchanging road news')!.at-4000);await page.clock.runFor(3000);
        const corners=pair.map(()=>new Set<number>());let separation=Infinity;
        for(let i=0;i<8;i++){
            await page.clock.fastForward(2000);await page.clock.runFor(2000);const poses=await check(),a=poses['crew:52:0'],b=poses['crew:52:1'];separation=Math.min(separation,Math.hypot(a.col-b.col,a.row-b.row));
            for(const [index,p]of [a,b].entries())if(p.activity==='Demonstrating the festival steps')corners[index].add(Math.round(p.row)*12+Math.round(p.col));
            if(i===1){await capture('opposite-corner-steps');await talk(nene,FESTIVAL_LINES.steps);await talk(ko,FESTIVAL_LINES.otherSteps);}
            if(i===5)await capture('second-square-lap');
        }
        expect(separation).toBeGreaterThan(.8);for(const reached of corners)expect([...reached].sort((a,b)=>a-b)).toEqual([88,89,100,101]);
        const returnMs=Math.max(...pair.map(a=>a.cyclePhases!.at(-1)!.at))-end.at+5000;
        for(let elapsed=0;elapsed<returnMs;elapsed+=4000){await page.clock.fastForward(2000);await page.clock.runFor(2000);await check();}
        for(const [i,a]of pair.entries()){const p=(await read())[`crew:52:${i}`];expect(p.col).toBeCloseTo(a.workTile%12,1);expect(p.row).toBeCloseTo(Math.floor(a.workTile/12),1);}
        await expect(nene).toHaveAttribute('data-activity','Watching for festival arrivals');await expect(ko).toHaveAttribute('data-activity','Checking the festival approach');
    }else if(mode==='opening'){
        await page.clock.runFor(4000);await expect(eda).toHaveAttribute('data-activity','Preparing the festival counter');await capture('preparing-counter');
        await page.clock.runFor(10_000);await expect(eda).toHaveAttribute('data-activity','Collecting the festival bowls');await check();await capture('collecting-bowls');
        await page.clock.runFor(11_000);await expect.poll(floor).toContain(FESTIVAL_SITE.open);await expect(eda).toHaveAttribute('data-activity','Serving at the festival counter');await talk(eda,FESTIVAL_LINES.serving);
    }else if(mode==='packing'){
        await page.clock.runFor(5000);await expect(eda).toHaveAttribute('data-activity','Packing the festival counter');await capture('packing-counter');
        await page.clock.runFor(11_000);await expect.poll(floor).toContain(FESTIVAL_SITE.packed);await expect(eda).toHaveAttribute('data-activity','Securing the covered counter');await capture('covered-counter');
        await page.clock.runFor(8000);await expect(eda).toHaveAttribute('data-activity','Waiting beside the festival building');await talk(eda,FESTIVAL_LINES.resting);await check();
    }else if(mode==='rain'){
        weather='rain';await page.clock.fastForward(21_000);await page.clock.runFor(20_000);await expect.poll(floor).toContain(FESTIVAL_SITE.packed);await expect(eda).toHaveAttribute('data-activity','Waiting out the weather');await talk(eda,FESTIVAL_LINES.weather);await check();
        await expect(nene).toHaveAttribute('data-activity','Waiting out the weather');await expect(ko).toHaveAttribute('data-activity','Waiting out the weather');
    }else if(mode==='cached closure'){
        offline=true;await page.clock.setSystemTime(new Date(plan.closeAt+1000));let previous=await check();
        for(let i=0;i<50;i++){await page.clock.runFor(2000);const p=await check();for(const id of ['crew:52:0','crew:52:1','resident:52'])expect(Math.hypot(p[id].col-previous[id].col,p[id].row-previous[id].row)).toBeLessThan(1.35);previous=p;if(!p['crew:52:0'].visible&&!p['crew:52:1'].visible&&previous['resident:52'].activity==='Waiting beside the festival building')break;}
        for(const [id,tile]of [['crew:52:0',5],['crew:52:1',7]] as const){expect(previous[id].col).toBeCloseTo(tile%12,1);expect(previous[id].row).toBeCloseTo(Math.floor(tile/12),1);expect(previous[id].visible).toBe(false);}
        expect(previous['resident:52'].visible).toBe(true);expect(previous['resident:52'].col).toBeCloseTo(8,1);expect(previous['resident:52'].row).toBeCloseTo(7,1);await expect.poll(floor).toContain(FESTIVAL_SITE.packed);
        await page.clock.setSystemTime(new Date(plan.closeAt+WORLD_DAY_MS));await page.clock.runFor(300);await expect.poll(floor).toContain(FESTIVAL_SITE.packed);await expect(eda).toHaveAttribute('data-activity','Waiting beside the festival building');
    }else if(mode==='missing counter'){
        await expect(eda).toHaveAttribute('data-activity','Waiting for festival arrivals');await talk(eda,FESTIVAL_LINES.fallback);
    }else if(mode==='reduced motion'){
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});await page.clock.runFor(100);const before=await read();await page.clock.runFor(1000);expect(await read()).toEqual(before);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(300);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await read();await page.clock.runFor(1000);expect(await read()).toEqual(hidden);
        await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(300);
    }
    await check();await capture(mode.replaceAll(' ','-'));writeFileSync(`${evidence}/${info.project.name}-${mode.replaceAll(' ','-')}-poses.json`,JSON.stringify(captures,null,2));expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
