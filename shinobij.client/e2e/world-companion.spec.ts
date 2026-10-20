import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {rawPetPool} from '../src/data/pet-pool';
import {balanceBuiltInPetTemplate} from '../src/lib/pet-balance';
import {petPortraitImage} from '../src/lib/pet-battle-anim';
import {lifeSceneView,parseLifeState,LIFE_WINDOW_MS} from '../../shared/sector-life';
import {PLAYABLE_WILD_SECTOR_IDS} from '../../shared/sector-geo';
import {isWalkableTile} from '../../shared/sector-walk-mask';
import {sectorExits} from '../../shared/sector-links';
import type {Pet} from '../src/types/pet';

const evidence='../output/living-world/companion/browser';mkdirSync(evidence,{recursive:true});
const species=['standard-8','standard-5','standard-10'];
const owned=(id:string)=>({...balanceBuiltInPetTemplate(rawPetPool.find(p=>p.id===id)!),level:1,unlockedForPve:false});
async function boot(page:Page,options:{id?:string;away?:boolean;missing?:boolean;sector?:number;tile?:number;now?:number}={}){
    const now=options.now??300*LIFE_WINDOW_MS+60_000,sector=options.sector??42,tile=options.tile??65,pet=owned(options.id==='none'?species[0]:options.id??species[0]);
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(new Date(now));
    const save=uiAuditSave();save.currentSector=sector;save.currentTile=tile;
    const actual=options.away?{...pet,expedition:{type:'scout',endsAt:now-1000,startedAt:now-60_000} as Pet['expedition']}:pet;
    save.character={...save.character,starterCardsClaimed:true,pets:[actual,owned('standard-1')],activePetId:options.id==='none'?undefined:pet.id,activePetId2v2:'standard-1',wandererCooldowns:quietRoadCooldowns([sector],now)};
    const runtime=await installUiAuditRuntime(page,save);
    await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
    if(options.missing)await page.route(`**${petPortraitImage(pet).split('?')[0]}*`,route=>route.abort());
    await page.route('**/api/sector/life**',async route=>{
        const at=await page.evaluate(()=>Date.now()),requested=Number(new URL(route.request().url()).searchParams.get('sector')??sector);
        await route.fulfill({json:{ok:true,serverNow:at,view:lifeSceneView(requested,parseLifeState(null,at),at,'clear')}});
    });
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:`Return to Sector ${sector}`,exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(map).toHaveAttribute('aria-busy','false');await page.clock.runFor(1000);
    return {pet,map,now,sector,runtime,errors,requests,companion:page.locator('[data-companion-id]')};
}
const position=(page:Page)=>page.locator('[data-companion-id]').evaluate(el=>({x:Number((el as HTMLElement).dataset.worldX),y:Number((el as HTMLElement).dataset.worldY)}));
for(const id of species)test(`owned companion ${id}: native following, pauses and existing pet artwork`,async({page},info)=>{
    const lite=id==='standard-5';if(lite)await page.emulateMedia({reducedMotion:'reduce'});
    const site=await boot(page,{id});const {companion,map,pet,now}=site;
    await expect(companion).toBeVisible();await expect(companion).toHaveCount(1);await expect(companion).toHaveAttribute('data-companion-id',pet.id);
    await expect(companion.locator('img')).toHaveAttribute('src',petPortraitImage(pet));
    await expect.poll(()=>companion.locator('img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(companion.locator('.sector-avatar-initials')).toHaveCount(0);
    await expect.poll(()=>companion.locator('.sector-wanderer-label').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(8);
    await map.screenshot({path:`${evidence}/${info.project.name}-${id}-native.png`});
    const before=await position(page);await page.clock.setSystemTime(new Date(now));
    await page.keyboard.press('d');await page.keyboard.down('s');await page.clock.runFor(900);await page.keyboard.up('s');await page.clock.runFor(1600);
    await expect.poll(async()=>Math.hypot((await position(page)).x-before.x,(await position(page)).y-before.y)).toBeGreaterThan(.1);
    if(lite)await expect(companion).not.toHaveClass(/is-walking/);
    await map.screenshot({path:`${evidence}/${info.project.name}-${id}-following.png`});
    await page.evaluate(()=>{const cover=document.createElement('div');cover.className='combat-instance';document.body.append(cover);});await page.clock.runFor(100);
    const paused=await position(page);await page.clock.fastForward(30_000);expect(await position(page)).toEqual(paused);await expect(companion).toBeHidden();
    await page.evaluate(()=>document.querySelector('body>.combat-instance')?.remove());await page.clock.runFor(1000);await expect(companion).toBeVisible();
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(100);
    const hidden=await position(page);await page.clock.fastForward(30_000);expect(await position(page)).toEqual(hidden);await expect(companion).toBeHidden();
    await page.evaluate(()=>{delete(document as Document&{hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.clock.runFor(1000);await expect(companion).toBeVisible();
    expect(site.requests.filter(url=>/\.glb(?:\?|$)/.test(url))).toEqual([]);expect(site.errors).toEqual([]);
});
for(const mode of ['none','away','missing portrait'] as const)test(`companion absence and fallback: ${mode}`,async({page},info)=>{
    const site=await boot(page,{id:mode==='none'?'none':species[0],away:mode==='away',missing:mode==='missing portrait'});
    if(mode==='missing portrait'){
        await expect(site.companion).toBeVisible();await expect(site.companion.locator('img')).toHaveCount(0);
        await expect(site.companion.locator('.sector-avatar-initials')).not.toBeEmpty();
    }else await expect(site.companion).toHaveCount(0);
    await site.map.screenshot({path:`${evidence}/${info.project.name}-${mode}.png`});expect(site.errors).toEqual([]);
});
test('the owned companion notices actual active tracking clues, then resumes without reacting to expired ground',async({page},info)=>{
    let chosen:{now:number;sector:number;tile:number;view:ReturnType<typeof lifeSceneView>}|undefined;
    for(let window=300;window<310&&!chosen;window++)for(const sector of PLAYABLE_WILD_SECTOR_IDS){
        const now=window*LIFE_WINDOW_MS+60_000,view=lifeSceneView(sector,parseLifeState(null,now),now,'clear');
        const mark=view.groundTrail?.find(([tile,direction])=>direction!==undefined&&isWalkableTile(sector,tile));
        if(mark){chosen={now,sector,tile:mark[0],view};break;}
    }
    expect(chosen).toBeTruthy();const c=chosen!;const site=await boot(page,{...c,id:species[0]});
    let reveal=false,offline=false;
    await page.route('**/api/sector/life**',async route=>{if(offline){await route.abort();return;}await route.fulfill({json:{ok:true,serverNow:await page.evaluate(()=>Date.now()),view:{...c.view,groundTrail:reveal?c.view.groundTrail:[]}}});});
    // Clear the initial clue before observing a fresh authoritative arrival.
    await page.evaluate(async sector=>(await import('/src/lib/sector-life-art.ts')).setSectorGroundMarks(sector,[],Date.now(),[]),c.sector);
    await page.clock.runFor(2500);await expect(site.companion).toHaveAttribute('data-companion-state','following');
    reveal=true;await page.clock.setSystemTime(new Date(c.now));await page.clock.fastForward(21_000);await page.clock.runFor(500);
    await expect(site.companion).toHaveAttribute('data-companion-state','noticing');const before=await position(page);
    expect(await site.companion.evaluate(async el=>{
        const world=await import('/src/lib/continuous-world-client.ts').then(client=>client.loadContinuousWorld());
        const poses=await import('/src/lib/figure-ground-position.ts'),root=el.closest('[data-world-chunk]') as HTMLElement,chunk=world.space.chunks.find(c=>c.sector===Number(root.dataset.worldChunk))!;
        const p={x:Number((el as HTMLElement).dataset.worldX),y:Number((el as HTMLElement).dataset.worldY)};
        return [...root.querySelectorAll<HTMLElement>('.sector-wanderer-figure:not(.world-pet-companion)')].filter(node=>node.style.visibility!=='hidden').every(node=>{
            const q=poses.figureGroundPosition(node);return !q||Math.hypot(p.x-chunk.x-q.col-.5,p.y-chunk.y-q.row-.5)>=.75;
        });
    })).toBe(true);
    await page.clock.runFor(500);expect(await position(page)).toEqual(before);await site.map.screenshot({path:`${evidence}/${info.project.name}-actual-tracks-pause.png`});
    await page.clock.runFor(2200);await expect(site.companion).toHaveAttribute('data-companion-state','following');
    offline=true;await page.clock.fastForward(61_000);await page.clock.runFor(1000);await expect(site.companion).toHaveAttribute('data-companion-state','following');
    expect(site.errors).toEqual([]);
});

test('the same owned companion follows across a real sector road without respawning or cutting the route',async({page},info)=>{
    const exit=sectorExits(42).find(exit=>exit.direction==='south')??sectorExits(42)[0];
    const site=await boot(page,{tile:exit.tile,id:species[0]});await expect(site.companion).toBeVisible();
    await site.companion.evaluate(el=>{
        const state={element:el,samples:[] as {x:number;y:number}[]};Object.assign(window,{companionRoadQa:state});
        new MutationObserver(()=>{const node=el as HTMLElement;if(state.samples.length<1000)state.samples.push({x:Number(node.dataset.worldX),y:Number(node.dataset.worldY)});}).observe(el,{attributes:true,attributeFilter:['data-world-x','data-world-y']});
    });
    await page.clock.setSystemTime(new Date(site.now));
    const key={north:'w',south:'s',east:'d',west:'a'}[exit.direction];await page.keyboard.down(key);
    await expect.poll(async()=>{await page.clock.runFor(500);return page.locator('.continuous-world-map>canvas').getAttribute('data-world-sector');},{timeout:60_000}).not.toBe('42');
    await page.keyboard.up(key);await page.clock.runFor(1500);
    expect(await site.companion.evaluate(el=>el===(window as unknown as {companionRoadQa:{element:Element}}).companionRoadQa.element)).toBe(true);
    const samples=await page.evaluate(()=>(window as unknown as {companionRoadQa:{samples:{x:number;y:number}[]}}).companionRoadQa.samples);
    expect(samples.length).toBeGreaterThan(10);
    for(let i=1;i<samples.length;i++)expect(Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y)).toBeLessThanOrEqual(.401);
    await site.map.screenshot({path:`${evidence}/${info.project.name}-connected-road.png`});expect(site.errors).toEqual([]);
});
