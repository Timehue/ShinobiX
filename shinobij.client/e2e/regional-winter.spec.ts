import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeActorsAt,lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWalkableTile} from '../../shared/sector-walk-mask';
type Pose={col:number;row:number;visible:boolean};
declare global{interface Window{winterReadPose:()=>Pose[]}}
const evidence=process.env.REGIONAL_WINTER_EVIDENCE_DIR??'../output/living-world/winter/browser';mkdirSync(evidence,{recursive:true});
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const WINTER_SCENARIO_EPOCH=Date.UTC(2026,9,10,1);

test('winter supply stop: actual staff, warming pair and cached departure keep the painted supplies clear',async({page},info)=>{
    test.setTimeout(300_000);
    let day=Math.floor(WINTER_SCENARIO_EPOCH/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    let now=day;
    for(let attempt=0;attempt<100;attempt++,day+=WORLD_DAY_MS){
        const pair=lifeActorsAt(31,day,'clear').filter(a=>a.id.startsWith('crew:'));
        const motion=pair[0].motion!,meeting=pair[0].cyclePhases!.find(p=>p.activity==='Warming up between road rounds')!.at;
        now=motion.start+Math.ceil((day-motion.start)/motion.repeat!)*motion.repeat!+meeting+1000;
        if(lifeSceneView(31,parseLifeState(null,now),now,'clear').actors.filter(a=>a.id.startsWith('crew:')).length===2)break;
    }
    const pair=lifeActorsAt(31,now,'clear').filter(a=>a.id.startsWith('crew:'));
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=31;save.currentTile=138;
    save.character={...save.character,starterCardsClaimed:true,village:'Ashen Leaf Village',wandererCooldowns:quietRoadCooldowns([31],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false;const errors:string[]=[],mutations:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:31,ownerClan:'WinterReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()!=='GET')mutations.push(route.request().method());
        if(offline){await route.abort();return;}
        const at=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(31,parseLifeState(null,at),at,weather,'Ashen Leaf Village')}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 31',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(()=>{delete (document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(async()=>{const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();window.winterReadPose=()=>[0,1].map(index=>{
        const node=document.querySelector<HTMLElement>(`[data-life-resident="crew:31:${index}"]`);if(!node)throw Error('The winter pair was removed during its cached shift.');
        const pose=registry.figureGroundPosition(node);if(!pose)throw Error('The winter pose is not ready.');return {...pose,visible:getComputedStyle(node).visibility!=='hidden'};
    });});
    await page.clock.runFor(300);
    const first=page.locator('[data-life-resident="crew:31:0"]'),second=page.locator('[data-life-resident="crew:31:1"]'),quartermaster=page.locator('[data-life-resident="resident:31"]');
    await expect(first).toHaveAttribute('data-activity','Warming up between road rounds');await expect(second).toHaveAttribute('data-activity','Warming up between road rounds');
    await expect.poll(()=>page.evaluate(async()=>(await import('/src/lib/sector-displayed-floor.ts')).displayedSectorFloor(31))).toContain('frostveil-dormant-shrine-supply-v2.webp');
    await quartermaster.click();await expect(page.getByRole('dialog')).toContainText('blankets and parcel on this sled');await expect(page.getByRole('dialog')).toContainText("Don't touch our supplies. Ask first.");await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    await first.click();await expect(page.getByRole('dialog')).toContainText('warming up by the brazier');await expect(page.getByRole('dialog')).toContainText('Trail Watch Ryo');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
    // Let the initial greeting progress normally, then verify the actual scene
    // remains readable even if a different nearby native actor is speaking.
    await page.clock.runFor(4000);
    await expect.poll(()=>map.locator('[data-painted-name-clearance]').evaluate(clearance=>{
        const area=clearance.getBoundingClientRect();
        return Array.from(document.querySelectorAll('.sector-wanderer-label,.sector-wanderer-bubble')).every(label=>{
            if((label.parentElement as HTMLElement).style.visibility==='hidden')return true;
            const r=label.getBoundingClientRect();return !r.width||!r.height||r.right<=area.left||r.left>=area.right||r.bottom<=area.top||r.top>=area.bottom;
        });
    })).toBe(true);
    const names=await map.locator('[data-life-resident] .sector-wanderer-label').evaluateAll(labels=>labels.map(label=>{
        const owner=label.parentElement as HTMLElement,body=owner.querySelector('.sector-avatar-body')!,chunk=owner.closest('[data-world-chunk]')!;
        const rect=(element:Element)=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        return {id:owner.dataset.lifeResident,name:label.textContent,label:rect(label),body:rect(body),translate:(label as HTMLElement).style.translate,ownerWidth:owner.offsetWidth,ownerRect:rect(owner),ownerTransform:getComputedStyle(owner).transform,chunkTransform:getComputedStyle(chunk).transform};
    }));
    writeFileSync(`${evidence}/${info.project.name}-name-placement.json`,JSON.stringify(names,null,2));
    for(const name of names){
        const dx=Math.max(name.body.x-name.label.x-name.label.width,name.label.x-name.body.x-name.body.width,0),dy=Math.max(name.body.y-name.label.y-name.label.height,name.label.y-name.body.y-name.body.height,0);
        expect(Math.hypot(dx,dy),`${name.name}: a readable name must remain near its actual owner`).toBeLessThanOrEqual(Math.max(28,name.body.height*1.2));
    }
    await map.screenshot({path:`${evidence}/${info.project.name}-supplied-warming-stop.png`});
    const read=()=>page.evaluate(()=>window.winterReadPose());const resting=await read();
    for(let i=0;i<2;i++)expect(Math.hypot(resting[i].col-pair[i].restTile%12,resting[i].row-Math.floor(pair[i].restTile/12))).toBeLessThan(.1);
    weather='rain';await page.clock.fastForward(21_000);await page.clock.runFor(300);await expect(first).toHaveAttribute('data-activity','Waiting out the weather');
    offline=true;await page.clock.setSystemTime(new Date(pair[0].hideAt!+1000));let previous=await read();
    for(let step=0;step<20;step++){
        await page.clock.runFor(3000);const points=await read();
        for(let i=0;i<2;i++){
            expect(Math.hypot(points[i].col-previous[i].col,points[i].row-previous[i].row)).toBeLessThan(1.9);
            const tile=Math.round(points[i].row)*12+Math.round(points[i].col);expect(isWalkableTile(31,tile)).toBe(true);expect([101,102,113,114]).not.toContain(tile);
        }
        previous=points;if(points.every(p=>!p.visible))break;
    }
    const finished=await read();for(let i=0;i<2;i++){expect(finished[i].visible).toBe(false);expect(Math.hypot(finished[i].col-pair[i].hideTile!%12,finished[i].row-Math.floor(pair[i].hideTile!/12))).toBeLessThan(.18);}
    await expect(quartermaster).toBeVisible();await map.screenshot({path:`${evidence}/${info.project.name}-cached-road-exits.png`});expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
