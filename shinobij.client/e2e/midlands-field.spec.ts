import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeActorsAt,lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {MIDLANDS_FIELD,MIDLANDS_FIELD_LINES,MIDLANDS_CROP_TILES} from '../../shared/sector-midlands-work';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';

type Pose={col:number;row:number;activity?:string;visible:boolean};
declare global{interface Window{fieldWorkPoses:()=>Record<string,Pose>}}
const evidence='../output/living-world/field-work/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const FIELD_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);
for(const mode of ['round','weather','cached exit','missing garden','reduced motion'] as const)test(`Midlands field and courier: ${mode}`,async({page},info)=>{
    test.setTimeout(600_000);
    page.setDefaultTimeout(15_000);
    let day=Math.floor(FIELD_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS;
    const fixture=(day:number)=>{
        const worker=lifeActorsAt(42,day+8*WORLD_HOUR_MS,'clear').find(a=>a.id==='crew:42:0')!;
        const phase=worker.cyclePhases!.find(p=>mode==='round'?p.activity==='Exchanging road news':p.working)!;
        return{worker,period:worker.motion!.repeat!,now:worker.motion!.start+3*worker.motion!.repeat!+phase.at+1000};
    };
    // Use a real ordinary cast at the actual join time, with the whole pair.
    for(let i=0;i<20;i++,day+=WORLD_DAY_MS){const at=fixture(day).now;if(lifeSceneView(42,{...parseLifeState(null,at),step:3,updatedAt:at-1000},at,'clear').actors.some(a=>a.id==='crew:42:0'))break;}
    const {worker,period,now}=fixture(day);
    if(mode==='reduced motion')await page.emulateMedia({reducedMotion:'reduce'});
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=42;save.currentTile=mode==='round'?126:125;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([42],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false;const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    if(mode==='missing garden')await page.route('**/sector-life/midlands-herb-*.webp',route=>route.abort());
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:42,ownerClan:'FieldReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()!=='GET')mutations.push(route.request().method());if(offline){await route.abort();return;}
        const at=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(42,{...parseLifeState(null,at),step:3,updatedAt:now-1000},at,weather)}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 42',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    const suzu=page.locator('[data-life-resident="crew:42:0"]'),kota=page.locator('[data-life-resident="crew:42:1"]'),tool=suzu.locator('..').locator('.sector-ground-work-tool');
    await expect(suzu).toHaveCount(1);await expect(kota).toHaveCount(1);
    await page.evaluate(async()=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.fieldWorkPoses=()=>Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-life-resident]')).map(node=>{
        const p=registry.figureGroundPosition(node);if(!p)throw Error('Native field pose missing');return[node.dataset.lifeResident!,{...p,activity:node.dataset.activity,visible:node.style.visibility!=='hidden'}];
    }));});
    const read=()=>page.evaluate(()=>window.fieldWorkPoses());await page.clock.runFor(300);
    const floor=()=>page.evaluate(async()=>(await import('/src/lib/sector-displayed-floor.ts')).displayedSectorFloor(42));
    await expect.poll(floor).toContain(mode==='missing garden'?'/midlands-tea-stop-v1.webp':'/midlands-herb-tea-stop-v2.webp');
    await expect(suzu).toHaveAttribute('data-activity',mode==='round'?'Exchanging road news':mode==='missing garden'?'Checking the roadside verge':'Tending the roadside herb rows');
    if(mode==='missing garden'||mode==='round')await expect(tool).toBeHidden();else{await expect(tool).toBeVisible();expect(await tool.locator('image').getAttribute('href')).toBe('/sector-life/field-hoe-v1.webp');}
    await suzu.click();await expect(page.getByRole('dialog')).toContainText(mode==='round'?"I'm comparing the approaches with Road Courier Kota":mode==='missing garden'?MIDLANDS_FIELD_LINES.fallback:MIDLANDS_FIELD_LINES.work);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    if(mode==='round'){
        await kota.click();await expect(page.getByRole('dialog')).toContainText("I'm comparing the approaches with Field Runner Suzu");await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        expect(await page.locator('.sector-life-point').evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.sector-life-point')===node;}),'the existing tea-stop marker remains independently reachable').toBe(true);
    }
    const captures:Record<string,Pose>[]=[];
    const check=async()=>{const poses=await read();captures.push(poses);writeFileSync(`${evidence}/${info.project.name}-${mode.replaceAll(' ','-')}-latest.json`,JSON.stringify(poses,null,2));for(const [id,p]of Object.entries(poses))if(p.visible){
        const tile=Math.round(p.row)*12+Math.round(p.col);expect(MIDLANDS_CROP_TILES,`${id} crosses the actual planted beds`).not.toContain(tile);
        if(p.activity==='Tending the roadside herb rows'){expect(id).toBe('crew:42:0');expect(Math.abs(p.col-7)).toBeLessThan(.18);expect([9,10].some(row=>Math.abs(p.row-row)<.18)).toBe(true);}
        if(p.activity==='Checking the southern road'){expect(p.col).toBeCloseTo(5,1);expect(p.row).toBeCloseTo(11,1);}
    }return poses;};
    const capture=async(name:string)=>{
        await map.screenshot({path:`${evidence}/${info.project.name}-${name}.png`});
        if(await tool.isVisible()){
            const geometry=await tool.evaluate(svg=>{const rect=(node:Element)=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{tool:rect(svg.querySelector('image')!),labels:Array.from(document.querySelectorAll<HTMLElement>('.sector-wanderer-label,.sector-wanderer-bubble')).filter(node=>node.offsetParent&&node.parentElement!.style.visibility!=='hidden').map(node=>({text:node.textContent,speech:node.classList.contains('sector-wanderer-bubble'),rect:rect(node),body:rect(node.parentElement!.querySelector('.sector-avatar-body')!)}))};});
            writeFileSync(`${evidence}/${info.project.name}-${name}-geometry.json`,JSON.stringify(geometry,null,2));
            expect(geometry.labels.filter(({rect:r})=>r.x<geometry.tool.x+geometry.tool.width&&r.x+r.width>geometry.tool.x&&r.y<geometry.tool.y+geometry.tool.height&&r.y+r.height>geometry.tool.y).map(l=>l.text),'name/speech must leave the real hoe visible').toEqual([]);
            for(const {rect:r,body:b,text,speech}of geometry.labels)if(!speech)expect(Math.hypot(Math.max(b.x-r.x-r.width,r.x-b.x-b.width,0),Math.max(b.y-r.y-r.height,r.y-b.y-b.height,0)),`${text}: name remains near its owner`).toBeLessThanOrEqual(Math.max(28,b.height*1.2));
        }
    };
    await check();await capture(`${mode.replaceAll(' ','-')}-initial`);
    if(mode==='round'){
        let previous=await check();const workRows=new Set<number>(),strokes=new Set<string>();let south=false,returned=false,returnedBoth=false,upperCaptured=false,lowerCaptured=false;
        expect(previous['crew:42:0'].activity).toBe('Exchanging road news');expect(previous['crew:42:1'].activity).toBe('Exchanging road news');
        for(const [index,tile]of MIDLANDS_FIELD.meeting.entries()){expect(previous[`crew:42:${index}`].col).toBeCloseTo(tile%12,1);expect(previous[`crew:42:${index}`].row).toBeCloseTo(Math.floor(tile/12),1);}
        await capture('shared-handover');
        for(let elapsed=0;elapsed<period+15_000;elapsed+=4000){
            // Skip alternate clock intervals, then let the real native navigator
            // catch up through bounded physical steps. Pose-gated work speech
            // must remain honest even with this deliberately late navigator.
            await page.clock.fastForward(2000);await page.clock.runFor(2000);const poses=await check();for(const id of ['crew:42:0','crew:42:1'])expect(Math.hypot(poses[id].col-previous[id].col,poses[id].row-previous[id].row),'native actor follows connected steps').toBeLessThan(1.35);
            if(poses['crew:42:0'].activity==='Tending the roadside herb rows'){
                const row=Math.round(poses['crew:42:0'].row);workRows.add(row);await expect(tool).toBeVisible();expect(await tool.locator('image').getAttribute('href')).toBe('/sector-life/field-hoe-v1.webp');strokes.add((await tool.locator('g').getAttribute('transform'))!);
                if(row===10&&!lowerCaptured){await capture('lower-soil-work');lowerCaptured=true;await suzu.click();await expect(page.getByRole('dialog')).toContainText(MIDLANDS_FIELD_LINES.work);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();}
                if(row===9&&!upperCaptured){await capture('upper-soil-work');upperCaptured=true;}
            }
            if(poses['crew:42:1'].activity==='Checking the southern road')south=true;
            if(south&&poses['crew:42:1'].activity==='Checking the eastern road')returned=true;
            previous=poses;
            if(workRows.size===2&&returned&&Math.hypot(poses['crew:42:0'].col-worker.workTile%12,poses['crew:42:0'].row-Math.floor(worker.workTile/12))<.18&&Math.hypot(poses['crew:42:1'].col-10,poses['crew:42:1'].row-5)<.18){returnedBoth=true;break;}
        }
        expect([...workRows].sort((a,b)=>a-b)).toEqual([9,10]);expect(strokes.size).toBeGreaterThan(1);expect(south).toBe(true);expect(returned).toBe(true);expect(returnedBoth).toBe(true);await expect(tool).toBeHidden();
    }else if(mode==='weather'){
        weather='rain';await page.clock.fastForward(21_000);let previous=await check();
        for(let i=0;i<15;i++){await page.clock.runFor(2000);const p=await check();for(const id of ['crew:42:0','crew:42:1'])expect(Math.hypot(p[id].col-previous[id].col,p[id].row-previous[id].row)).toBeLessThan(1.35);previous=p;if(MIDLANDS_FIELD.meeting.every((tile,index)=>Math.hypot(p[`crew:42:${index}`].col-tile%12,p[`crew:42:${index}`].row-Math.floor(tile/12))<.04))break;}
        for(const [index,tile]of MIDLANDS_FIELD.meeting.entries()){expect(previous[`crew:42:${index}`].col).toBeCloseTo(tile%12,1);expect(previous[`crew:42:${index}`].row).toBeCloseTo(Math.floor(tile/12),1);}await expect(tool).toHaveCount(0);
        await kota.click();await expect(page.getByRole('dialog')).toContainText(MIDLANDS_FIELD_LINES.courierWeather);await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    }else if(mode==='cached exit'){
        offline=true;await page.clock.setSystemTime(new Date(day+20*WORLD_HOUR_MS+1000));let previous=await check();
        for(let i=0;i<30;i++){await page.clock.runFor(2000);const p=await check();for(const id of ['crew:42:0','crew:42:1'])expect(Math.hypot(p[id].col-previous[id].col,p[id].row-previous[id].row)).toBeLessThan(1.35);previous=p;if(!p['crew:42:0'].visible&&!p['crew:42:1'].visible)break;}
        for(const [id,tile]of [['crew:42:0',60],['crew:42:1',71]] as const){expect(previous[id].col).toBeCloseTo(tile%12,1);expect(previous[id].row).toBeCloseTo(Math.floor(tile/12),1);expect(previous[id].visible).toBe(false);}
        await expect(tool).toBeHidden();
    }else if(mode==='reduced motion'){
        const transform=await tool.locator('g').getAttribute('transform');await page.clock.runFor(1000);expect(await tool.locator('g').getAttribute('transform')).toBe(transform);
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});const before=await read();await page.clock.runFor(1000);expect(await read()).toEqual(before);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(300);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await read();await page.clock.runFor(1000);expect(await read()).toEqual(hidden);
        await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(300);
    }
    await capture(mode.replaceAll(' ','-'));writeFileSync(`${evidence}/${info.project.name}-${mode.replaceAll(' ','-')}-poses.json`,JSON.stringify(captures,null,2));expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
