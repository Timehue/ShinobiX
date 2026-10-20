import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {lifeActorsAt,lifeSceneView,parseLifeState} from '../../shared/sector-life';
import {LIFE_TRAINING_LINES} from '../../shared/sector-life-routines';
import {WORLD_DAY_MS,WORLD_HOUR_MS} from '../../shared/world-clock';
import {isWalkableTile} from '../../shared/sector-walk-mask';
type Pose={col:number;row:number;visible:boolean;activity:string|undefined};
declare global{interface Window{trainingReadPose:()=>Pose[]}}
const evidence='../output/living-world/training/browser';mkdirSync(evidence,{recursive:true});

for(const mode of ['drill','rain','cached shift'] as const)test(`Ashen training ${mode}: the existing pair uses clear grass, actual steps and real road exits`,async({page},info)=>{
    test.setTimeout(240_000);
    const base=Math.floor(Date.now()/WORLD_DAY_MS)*WORLD_DAY_MS+8*WORLD_HOUR_MS;
    const pair=lifeActorsAt(9,base,'clear').filter(actor=>actor.id.startsWith('crew:'));
    const motion=pair[0].motion!,practice=pair[0].cyclePhases!.find(phase=>phase.activity==='Practising footwork')!.at;
    const cycle=motion.start+Math.ceil((base-motion.start)/motion.repeat!)*motion.repeat!,now=cycle+practice+1000;
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(now);
    const save=uiAuditSave();save.currentSector=9;save.currentTile=75;
    save.character={...save.character,starterCardsClaimed:true,village:'Frostfang Village',wandererCooldowns:quietRoadCooldowns([9],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    let weather='clear',offline=false;const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/world-state**',route=>route.fulfill({json:{territories:[{sector:9,ownerClan:'TrainingReview',weather,hp:100}],wars:[],standings:[]}}));
    await page.route('**/api/sector/life**',async route=>{
        if(route.request().method()!=='GET')mutations.push(route.request().method());if(offline){await route.abort();return;}
        const at=await page.evaluate(()=>Date.now());await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(9,parseLifeState(null,at),at,weather,'Frostfang Village')}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 9',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();await expect(map).toHaveAttribute('aria-busy','false');
    const first=page.locator('[data-life-resident="crew:9:0"]'),second=page.locator('[data-life-resident="crew:9:1"]');await expect(first).toHaveCount(1);await expect(second).toHaveCount(1);
    await page.clock.setSystemTime(new Date(now-60_000));await page.clock.pauseAt(new Date(now));
    await page.evaluate(async()=>{
        const registry=await import('/src/lib/figure-ground-position.ts');registry.observeFigureGroundPositions();
        window.trainingReadPose=()=>[0,1].map(index=>{
            const node=document.querySelector<HTMLElement>(`[data-life-resident="crew:9:${index}"]`);
            if(!node)throw Error('The native training pair was replaced or removed.');
            const p=registry.figureGroundPosition(node);if(!p)throw Error('The native training pose is not ready.');
            return {...p,visible:getComputedStyle(node).visibility!=='hidden',activity:node.dataset.activity};
        });
    });
    await page.clock.runFor(300);const read=()=>page.evaluate(()=>window.trainingReadPose());
    await expect(first).toHaveAttribute('data-activity','Practising footwork');await expect(second).toHaveAttribute('data-activity','Practising footwork');
    if(mode==='drill'){
        const rows:number[]=[];for(let i=0;i<7;i++){
            await page.clock.runFor(3000);const p=await read();rows.push(p[0].row);
            for(let j=0;j<2;j++){expect(Math.abs(p[j].col-(j?1:2))).toBeLessThan(.05);expect(p[j].row).toBeGreaterThanOrEqual(4.98);expect(p[j].row).toBeLessThanOrEqual(6.02);expect(p[j].visible).toBe(true);}
            expect(Math.abs(p[0].row-p[1].row)).toBeLessThan(.05);
        }
        expect(Math.max(...rows)-Math.min(...rows)).toBeGreaterThan(.85);
        await first.click();await expect(page.getByRole('dialog')).toContainText(LIFE_TRAINING_LINES.practice);await expect(page.getByRole('dialog')).toContainText('Stay on the path');await page.getByRole('dialog').getByRole('button',{name:/Close/}).click();
        const a=(await first.locator('.sector-wanderer-label').boundingBox())!,b=(await second.locator('.sector-wanderer-label').boundingBox())!;
        expect(Math.min(a.x+a.width,b.x+b.width)<=Math.max(a.x,b.x)||Math.min(a.y+a.height,b.y+b.height)<=Math.max(a.y,b.y)).toBe(true);
    }else if(mode==='rain'){
        weather='rain';await page.clock.fastForward(21_000);await page.clock.runFor(4000);
        await expect(first).toHaveAttribute('data-activity','Waiting out the weather');await expect(second).toHaveAttribute('data-activity','Waiting out the weather');
        const p=await read();await page.clock.runFor(3000);const still=await read();
        for(let i=0;i<2;i++){expect(Math.hypot(p[i].col-still[i].col,p[i].row-still[i].row)).toBeLessThan(.02);expect(Math.hypot(still[i].col-pair[i].restTile%12,still[i].row-Math.floor(pair[i].restTile/12))).toBeLessThan(.1);}
    }else{
        offline=true;await page.clock.setSystemTime(new Date(pair[0].hideAt!+1000));let previous=await read();
        for(let i=0;i<14;i++){
            await page.clock.runFor(3000);const p=await read();
            for(let j=0;j<2;j++){expect(Math.hypot(p[j].col-previous[j].col,p[j].row-previous[j].row)).toBeLessThan(1.9);expect(isWalkableTile(9,Math.round(p[j].row)*12+Math.round(p[j].col))).toBe(true);}
            previous=p;if(p.every(point=>!point.visible))break;
        }
        const p=await read();for(let i=0;i<2;i++){expect(p[i].visible).toBe(false);expect(Math.hypot(p[i].col-pair[i].hideTile!%12,p[i].row-Math.floor(pair[i].hideTile!/12))).toBeLessThan(.18);}
    }
    await map.screenshot({path:`${evidence}/${info.project.name}-${mode.replace(' ','-')}.png`});expect(errors).toEqual([]);expect(mutations).toEqual([]);
});
