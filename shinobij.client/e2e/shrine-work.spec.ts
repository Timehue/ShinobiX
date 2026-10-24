import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {SHRINE_WORK_LINES} from '../../shared/sector-shrine-work';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWalkableTile} from '../../shared/sector-walk-mask';

type Pose={col:number;row:number;activity?:string};
declare global{interface Window{shrineWorkPose:()=>Pose;shrineWorkVisitors:()=>Pose[]}}
const evidence=process.env.SHRINE_WORK_EVIDENCE_DIR??'../output/living-world/leaf-work/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const LEAF_WORK_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);

test('a crowded shrine greeting leaves the caretaker name attached to its owner',async({page},info)=>{
    // A deterministic DOM geometry fixture: unlike the native journey below,
    // this keeps the transient greeting present through the layout pass.
    await page.route('**/__caption-layout',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>
        body{margin:0}.continuous-world-map,.pixel-map{position:relative;width:368px;height:368px}
        .sector-avatar-body,.sector-wanderer-label,.sector-wanderer-bubble,.obstacle{position:absolute;box-sizing:border-box}
        .sector-avatar-body{width:22px;height:22px;background:#976}.sector-wanderer-label{height:15px;font:11px sans-serif;background:#ddd}
        .sector-wanderer-bubble{font:12px sans-serif;background:#eef;border:1px solid #446}
        </style><div class="continuous-world-map"><div class="pixel-map">
        <div class="sector-wanderer-figure"><span class="sector-wanderer-bubble" style="left:76.492px;top:153.38px;width:168px;height:35.8125px">Mind your hands around the shrine.</span><span class="sector-avatar-body" style="left:153.294px;top:192.63px;width:22.078125px;height:22.078125px"></span><span class="sector-wanderer-label" style="left:127.33px;top:188.052px;width:74px;height:14.546875px">Shrine Keeper</span></div>
        <div class="sector-wanderer-figure"><span class="sector-avatar-body" style="left:276px;top:162px"></span><span class="sector-wanderer-label" style="left:250px;top:139px;width:74px">Tea Seller Ren</span></div>
        <div class="sector-avatar-figure"><span class="sector-avatar-body" style="left:183px;top:223px"></span></div>
        <div class="obstacle sector-life-point" style="left:106px;top:197px;width:48px;height:48px"></div>
        <div class="obstacle sector-ground-landmark-label" style="left:212px;top:206px;width:58px;height:15px">Stronghold</div>
        <div class="obstacle sector-ground-landmark-label" style="left:75px;top:130px;width:86px;height:15px">Heartwood Shrine</div>
        <div class="obstacle" data-work-tool-clearance style="left:164px;top:212px;width:18px;height:25px"></div>
        <div class="obstacle resource-world-node" style="left:137px;top:256px;width:54px;height:54px"></div>
        </div></div>`}));
    await page.goto('/__caption-layout');
    const {labels:geometry,obstacles}=await page.evaluate(async()=>{
        const {layoutWandererLabels}=await import('/src/lib/wanderer-label-layout.ts');
        layoutWandererLabels(document.querySelector<HTMLElement>('.sector-wanderer-figure')!);
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        const rect=(node:Element)=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
        return {labels:Array.from(document.querySelectorAll('.sector-wanderer-label,.sector-wanderer-bubble')).map(node=>({speech:node.classList.contains('sector-wanderer-bubble'),text:node.textContent,rect:rect(node),body:rect(node.parentElement!.querySelector('.sector-avatar-body')!)})),
            obstacles:Array.from(document.querySelectorAll('.obstacle,.sector-avatar-body')).map(rect)};
    });
    writeFileSync(`${evidence}/${info.project.name}-greeting-geometry.json`,JSON.stringify({labels:geometry,obstacles},null,2));
    await page.screenshot({path:`${evidence}/${info.project.name}-greeting-geometry.png`});
    for(const {speech,rect:r,body:b} of geometry){
        expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(368);expect(r.y+r.height).toBeLessThanOrEqual(368);
        if(!speech)expect(Math.hypot(Math.max(b.x-r.x-r.width,r.x-b.x-b.width,0),Math.max(b.y-r.y-r.height,r.y-b.y-b.height,0))).toBeLessThanOrEqual(28);
        for(const other of geometry.filter(other=>other.rect!==r)){
            const o=other.rect;expect(r.x<o.x+o.width&&r.x+r.width>o.x&&r.y<o.y+o.height&&r.y+r.height>o.y).toBe(false);
        }
        for(const o of obstacles)expect(r.x<o.x+o.width&&r.x+r.width>o.x&&r.y<o.y+o.height&&r.y+r.height>o.y,'captions leave authored obstacles and portraits clear').toBe(false);
    }
    await expect(page.getByText('Mind your hands around the shrine.',{exact:true})).toBeVisible();
});

for(const mode of ['round','weather and help','cached night','reduced motion'] as const)test(`Heartwood leaf work ${mode}: actual native caretaker, tool and approach remain coherent`,async({page},info)=>{
    test.setTimeout(240_000);
    const day=Math.floor(LEAF_WORK_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS,start=day+5*WORLD_HOUR_MS;
    const now=start+6*180_000+25_000;
    if(mode==='reduced motion')await page.emulateMedia({reducedMotion:'reduce'});
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=15;save.currentTile=125;
    save.character={...save.character,starterCardsClaimed:true,village:'Frostfang Village',wandererCooldowns:quietRoadCooldowns([15],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false,help=false;const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:15,ownerClan:'LeafWorkReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()!=='GET')mutations.push(route.request().method());if(offline){await route.abort();return;}
        const at=await page.evaluate(()=>Date.now()),state={...parseLifeState(null,at),step:help?0:3,updatedAt:now-300_000};
        await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(15,state,at,weather,'Frostfang Village',undefined,{tier:2,maintainedAt:now-1000,by:'Aki'})}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 15',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    const keeper=page.locator('[data-life-resident="keeper:15"]'),tool=keeper.locator('..').locator('.sector-ground-work-tool');
    await expect(keeper).toHaveCount(1);await page.evaluate(async()=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.shrineWorkPose=()=>{
        const node=document.querySelector<HTMLElement>('[data-life-resident="keeper:15"]')!,p=registry.figureGroundPosition(node);if(!p)throw Error('Native keeper pose missing');return {...p,activity:node.dataset.activity};
    };window.shrineWorkVisitors=()=>Array.from(document.querySelectorAll<HTMLElement>('[data-life-resident^="pilgrim:15:"]')).map(node=>{const p=registry.figureGroundPosition(node);if(!p)throw Error('Native visitor pose missing');return p;});});
    await page.clock.runFor(300);const read=()=>page.evaluate(()=>window.shrineWorkPose());
    await expect(keeper).toHaveAttribute('data-activity','Sweeping the shrine approach');await expect(tool).toBeVisible();
    expect(await tool.locator('image').getAttribute('href')).toBe('/sector-life/shrine-broom-v2.webp');
    await keeper.click();await expect(page.getByRole('dialog')).toContainText(SHRINE_WORK_LINES.sweep);await expect(page.getByRole('dialog')).toContainText('Aki helped');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    const clearTool=async(section:string)=>{
        const geometry=await tool.evaluate(svg=>{
            const rect=(node:Element)=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
            const broom=rect(svg.querySelector('image')!);
            return{broom,labels:Array.from(document.querySelectorAll<HTMLElement>('.sector-wanderer-label,.sector-wanderer-bubble')).filter(node=>node.offsetParent&&node.parentElement!.style.visibility!=='hidden').map(node=>({text:node.textContent,speech:node.classList.contains('sector-wanderer-bubble'),rect:rect(node),body:rect(node.parentElement!.querySelector('.sector-avatar-body')!)}))};
        });
        writeFileSync(`${evidence}/${info.project.name}-${section}-tool-clearance.json`,JSON.stringify(geometry,null,2));
        const overlaps=geometry.labels.filter(({rect})=>rect.x<geometry.broom.x+geometry.broom.width&&rect.x+rect.width>geometry.broom.x&&rect.y<geometry.broom.y+geometry.broom.height&&rect.y+rect.height>geometry.broom.y);
        expect(overlaps.map(label=>label.text),'native name/speech captions must leave the actual work tool visible').toEqual([]);
        for(const label of geometry.labels.filter(label=>!label.speech)){
            const r=label.rect,b=label.body,gap=Math.hypot(Math.max(b.x-r.x-r.width,r.x-b.x-b.width,0),Math.max(b.y-r.y-r.height,r.y-b.y-b.height,0));
            expect(gap,`${label.text}: captions must stay near their actual owners`).toBeLessThanOrEqual(Math.max(28,b.height*1.2));
        }
    };
    if(mode==='round'){
        const before=await tool.locator('g').getAttribute('transform');await page.clock.runFor(650);expect(await tool.locator('g').getAttribute('transform')).not.toBe(before);
        await page.clock.runFor(4000);await map.screenshot({path:`${evidence}/${info.project.name}-lower-section.png`});await clearTool('lower');
        let previous=await read(),minRow=previous.row;for(let i=0;i<17;i++){
            await page.clock.runFor(3000);const p=await read();expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(1.9);expect(isWalkableTile(15,Math.round(p.row)*12+Math.round(p.col))).toBe(true);minRow=Math.min(minRow,p.row);
            if(p.activity==='Sweeping the shrine approach'){expect([8,9].some(row=>Math.abs(p.row-row)<.18)).toBe(true);expect(Math.abs(p.col-4)).toBeLessThan(.18);for(const visitor of await page.evaluate(()=>window.shrineWorkVisitors()))expect(Math.hypot(visitor.col-p.col,visitor.row-p.row),'visitors must pass around the working keeper').toBeGreaterThan(.8);}
            if(i===6){await map.screenshot({path:`${evidence}/${info.project.name}-upper-section.png`});await clearTool('upper');}previous=p;
        }
        expect(minRow).toBeLessThan(8.1);expect(previous.col).toBeCloseTo(3,1);expect(previous.row).toBeCloseTo(9,1);await expect(tool).toBeHidden();
    }else if(mode==='weather and help'){
        weather='rain';await page.clock.fastForward(21_000);let previous=await read();
        for(let i=0;i<7;i++){await page.clock.runFor(2000);const p=await read();expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(1.3);previous=p;}
        expect(previous.col).toBeCloseTo(3,1);expect(previous.row).toBeCloseTo(9,1);await expect(tool).toHaveCount(0);
        weather='clear';help=true;let nextWindow=Math.floor(now/(45*60_000))+1;if(nextWindow%2===0)nextWindow++;const shrineWindow=nextWindow*45*60_000+60_000;
        await page.clock.setSystemTime(new Date(shrineWindow));await page.clock.fastForward(21_000);await page.clock.runFor(4000);await expect(tool).toHaveCount(0);await keeper.click();await expect(page.getByRole('dialog')).toContainText('Please start with the left one.');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    }else if(mode==='cached night'){
        offline=true;await page.clock.setSystemTime(new Date(day+20*WORLD_HOUR_MS+1000));let previous=await read();
        for(let i=0;i<9;i++){await page.clock.runFor(2000);const p=await read();expect(Math.hypot(p.col-previous.col,p.row-previous.row)).toBeLessThan(1.3);previous=p;}
        expect(previous.col).toBeCloseTo(3,1);expect(previous.row).toBeCloseTo(9,1);await expect(tool).toBeHidden();
        await page.clock.setSystemTime(new Date(day+WORLD_DAY_MS+4*WORLD_HOUR_MS));await page.clock.runFor(3000);expect((await read()).row).toBeCloseTo(9,1);await expect(tool).toBeHidden();
    }else{
        const before=await tool.locator('g').getAttribute('transform');await page.clock.runFor(1000);expect(await tool.locator('g').getAttribute('transform')).toBe(before);
        await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});const p=await read();await page.clock.runFor(1000);expect(await read()).toEqual(p);expect(await tool.locator('g').getAttribute('transform')).toBe(before);
        await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(300);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await read();await page.clock.runFor(1000);expect(await read()).toEqual(hidden);
        await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(300);
    }
    await map.screenshot({path:`${evidence}/${info.project.name}-${mode.replaceAll(' ','-')}.png`});expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
