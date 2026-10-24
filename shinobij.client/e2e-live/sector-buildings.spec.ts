import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { sectorBuilding } from '../../shared/sector-buildings';
import { sectorName } from '../../shared/sector-geo';
import { readBuildingProgress } from '../../shared/sector-building-state';
import { buildingFestivalTasks } from '../../shared/sector-building-stories';
import type { BuildingWorldView, BuildingPoint } from '../../shared/sector-building-types';

async function player(request:APIRequestContext,context:BrowserContext,buildingId:string,level=85,priorRepairs=0,extraCharacter:Record<string,unknown>={}){
    const building=sectorBuilding(buildingId)!;
    const name=uniquePlayerName(stamp=>`builder${stamp}`);
    const registered=await request.post('/api/player-auth',{data:{action:'register',name,password:'BuildingJourney!1234'}});
    expect(registered.status(),await registered.text()).toBe(200);
    const token=String((await registered.json()).token),headers={'x-player-name':name,'x-player-token':token};
    const save=uiAuditSave();save.currentSector=building.sector;save.currentTile=building.approach;save.worldGeoV=2;delete save.worldPosition;
    save.character={...save.character,name,level,ryo:1000,boneCharms:0,fateShards:0,equippedJutsuIds:[],jutsuMastery:[],
        wandererCooldowns:quietRoadCooldowns(Array.from({length:66},(_,i)=>i+1)),
        sectorBuildings:{...readBuildingProgress(undefined,Date.now()),repairs:priorRepairs},
        itemStacks:[{itemId:'gather-iron-sand',count:30},{itemId:'hunt-torn-hide',count:20},{itemId:'gather-river-fish',count:20},{itemId:'gather-binding-fiber',count:40},{itemId:'gather-iron-sand-pristine',count:3}],...extraCharacter};
    const seeded=await request.post(`/api/save/${name}?signal=1`,{headers:{'x-admin-password':'live-express-e2e-admin'},data:save});
    expect(seeded.status(),await seeded.text()).toBe(200);expect((await request.post(`/api/save/${name}?ack=1`,{headers})).status()).toBe(200);
    const response=await request.get(`/api/save/${name}`,{headers});expect(response.status()).toBe(200);const canonical=await response.json();
    await context.addInitScript(({name,token,canonical,patch})=>{
        if(location.protocol!=='http:'&&location.protocol!=='https:')return;
        localStorage.setItem('ninjav-admin-build-v1',JSON.stringify({currentAccountName:name}));localStorage.setItem('ninjav-player-accounts-v1',JSON.stringify({[name]:{token}}));
        localStorage.setItem('shinobix:activePlayerPersist',name);localStorage.setItem('shinobix:activeTokenPersist',token);localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`,JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack','1');localStorage.setItem('patchNotes.lastSeenVersion.v1',patch);localStorage.setItem('dailyBriefing.seen.v1',new Date().toISOString().slice(0,10));
        localStorage.setItem(`legacyRumors.seen.v1:${name}`,JSON.stringify([10,20,30,40,45]));
    },{name,token,canonical,patch:LATEST_PATCH_NOTE?.version??''});
    return{name,headers,building};
}
async function enterWorld(page:Page,sector:number){
    // A repeated same-hash goto keeps the previous React session alive. Each
    // seeded actor must start a new document so its installed identity runs.
    await page.goto('about:blank');
    await page.goto('/#/worldMap',{waitUntil:'domcontentloaded'});
    const shell=page.locator('.app-shell[data-screen="worldMap"]'),enter=page.getByRole('button',{name:'Enter World Map',exact:true});
    await expect(shell.or(enter)).toBeVisible({timeout:60_000});if(await enter.isVisible())await enter.click();
    const back=sector===99?page.getByRole('button',{name:`You are here, ${sectorName(sector)}`,exact:true}):page.getByRole('button',{name:new RegExp(`Return to Sector ${sector}\\b`)});
    await expect.poll(async()=>await back.isVisible()||await page.locator('.sector-image-map').isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(page.locator('.sector-image-map')).toBeVisible();
    if(sector!==99)await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false',{timeout:60_000});
    else await expect(page.locator('.pixel-map[data-ground-floor="true"]').first()).toBeVisible();
}
async function openCounter(page:Page,id:string,atThreshold=true,input:'pointer'|'keyboard'='pointer'){
    const b=sectorBuilding(id)!;
    const opener=b.kind==='stronghold'?page.locator('.sector-ground-stronghold'):b.kind==='village'?page.locator('.sector-village-entrance'):b.kind==='shrine'?page.locator('.sector-ground-shrine'):page.locator(`[data-building-id="${id}"]`);
    await expect(opener).toBeVisible();
    if(input==='keyboard'){await opener.focus();await opener.press('Enter');}
    else{
        // The upper frontage stays clear of the player and staff at its feet.
        // Exercise real pointer/touch dispatch, without force or synthetic clicks.
        const box=await opener.boundingBox();expect(box).not.toBeNull();
        const position={x:box!.width/2,y:Math.max(2,box!.height*.2)};
        if(test.info().project.use.hasTouch)await opener.tap({position});else await opener.click({position});
    }
    const counter=page.getByRole('dialog',{name:b.name,exact:true});await expect(counter.locator('[data-building-counter]')).toBeVisible();
    if(atThreshold){
        const speak=counter.getByRole('button',{name:'Speak with the keeper',exact:true}),approach=counter.getByRole('button',{name:'Walk to the public counter',exact:true});
        await expect(speak.or(approach)).toBeVisible();
        if(await approach.isVisible()){
            // Admission can settle a seeded visitor on the adjacent road. Use
            // the actual approach flow before exercising a threshold action.
            await approach.click();await expect(counter).toBeHidden();await waitAt(page,{sector:b.sector,tile:b.approach});
            const reached=await openCounter(page,id,false,input);await expect(reached.getByRole('button',{name:'Speak with the keeper',exact:true})).toBeVisible();return reached;
        }
    }
    await expect(counter.locator('.building-counter-art')).toHaveJSProperty('naturalWidth',800);
    return counter;
}
async function world(request:APIRequestContext,owner:Awaited<ReturnType<typeof player>>):Promise<BuildingWorldView>{
    const response=await request.get(`/api/sector/buildings?playerName=${owner.name}&sector=${owner.building.sector}`,{headers:owner.headers});
    expect(response.status(),await response.text()).toBe(200);return(await response.json()).view;
}
async function waitAt(page:Page,target:Pick<BuildingPoint,'sector'|'tile'>){
    const tile=page.locator(`[data-world-chunk="${target.sector}"] .continuous-world-tile`).nth(target.tile);
    await expect(tile).toHaveClass(/sector-player-tile/,{timeout:180_000});
}
test('real material repair journey continues past the old daily cap, resumes, repeats shard payouts and changes the shared building art',async({page,request,context},info)=>{
    test.setTimeout(420_000);
    const week=new Date();week.setUTCHours(0,0,0,0);week.setUTCDate(week.getUTCDate()-(week.getUTCDay()+6)%7);
    const owner=await player(request,context,'gorgewatch',85,39,{fateShards:5,
        sectorBuildings:{...readBuildingProgress(undefined,Date.now()),repairs:39,repairsToday:6,rewardsToday:20,shardClaims:1,shardWeek:week.toISOString().slice(0,10)}}),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await enterWorld(page,owner.building.sector);
    const finalRequestIds:string[]=[];
    // Commit the shard-paying completion, then lose its HTTP acknowledgement.
    // The visible recovery must reuse that ID and commit the saved reply once.
    await page.route('**/api/sector/buildings',async route=>{
        const body=route.request().postDataJSON();
        if(body?.action!=='step'||body.step!==2){await route.continue();return;}
        finalRequestIds.push(body.requestId);
        if(finalRequestIds.length===1){
            const committed=await route.fetch({maxRetries:API_CONNECTION_RETRIES});expect(committed.status(),await committed.text()).toBe(200);
            await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The saved completion reply was interrupted. Retry the same request.'})});
        }else await route.continue();
    });
    for(let order=0;order<4;order++){
        const counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Repairs',exact:true}).click();
        await expect(counter).toContainText('Every 3 personal repairs earn 3 bone charms');
        await expect(counter).toContainText('Every 20 personal repairs earn 5 fate shards');
        await expect(counter).toContainText('No daily repair cap or weekly shard limit.');
        await counter.getByRole('button',{name:'Choose repair materials',exact:true}).click();
        await counter.getByLabel('Iron Sand for Ore and mineral fittings',{exact:true}).fill('3');
        await counter.getByLabel('Torn Hide for Hunting materials for shelter lining',{exact:true}).fill('2');
        await counter.getByLabel('River Fish for Fish for the working crew',{exact:true}).fill('2');
        await counter.getByLabel('Binding Fiber for Harvested lashings and packing',{exact:true}).fill('4');
        if(order===0)await counter.screenshot({path:info.outputPath('repair-exact-materials.png')});
        await counter.getByRole('button',{name:'Reserve these materials',exact:true}).click();
        await expect(counter.getByRole('heading',{name:'Brace the frontage',exact:true})).toBeVisible();
        if(order===0){
            await page.keyboard.press('Escape');await page.reload();await enterWorld(page,owner.building.sector);
            await page.locator('.sector-building-work-chip').click();
        }
        for(const label of ['Brace the frontage','Bind the shelter lining','Finish the crew handover']){
            const step=page.getByRole('dialog').getByRole('button',{name:label,exact:true});await expect(step).toBeEnabled({timeout:20_000});await step.click();
            if(order===0&&label==='Finish the crew handover'){
                const retry=page.getByRole('dialog').getByRole('button',{name:'Retry the same request',exact:true});await expect(retry).toBeVisible();
                const committed=await(await request.get(`/api/save/${owner.name}`,{headers:owner.headers})).json();
                expect(committed.character.sectorBuildings.repairs).toBe(40);expect(committed.character.fateShards).toBe(10);
                await retry.click();await expect.poll(()=>finalRequestIds.length).toBe(2);
                expect(finalRequestIds[1]).toBe(finalRequestIds[0]);
                await expect(retry).toBeHidden();await page.unroute('**/api/sector/buildings');
            }
        }
        await expect(page.getByRole('dialog')).toContainText('No building order is active');await page.keyboard.press('Escape');
    }
    const result=await request.get(`/api/save/${owner.name}`,{headers:owner.headers}),saved=await result.json(),progress=readBuildingProgress(saved.character.sectorBuildings,Date.now());
    expect(progress.repairs).toBe(43);expect(progress.repairsToday).toBe(10);expect(progress.shardClaims).toBe(2);
    expect(progress.rewardsToday).toBe(24);
    expect(progress.receipts.reduce((sum,r)=>sum+r.reward.ryo,0)).toBe(720);expect(saved.character.fateShards).toBe(10);expect(saved.character.boneCharms).toBe(3);
    expect(progress.receipts.reduce((sum,r)=>sum+r.reward.fateShards,0)).toBe(5);expect(progress.receipts.reduce((sum,r)=>sum+r.reward.boneCharms,0)).toBe(3);
    const stock=saved.character.itemStacks as {itemId:string;count:number}[];expect(stock.find(i=>i.itemId==='gather-iron-sand')?.count).toBe(18);expect(stock.find(i=>i.itemId==='gather-iron-sand-pristine')?.count).toBe(3);
    await expect(page.locator('[data-building-restoration="gorgewatch"]')).toHaveAttribute('data-stage',/^[1-3]$/);
    await page.screenshot({path:info.outputPath('restored-frontage-world.png'),fullPage:true});
    const counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Repairs',exact:true}).click();await counter.screenshot({path:info.outputPath('restoration-roll-and-rewards.png')});
    expect(errors).toEqual([]);
});
test('a junior shinobi can speak at a named stronghold while its guarded interior remains restricted',async({page,request,context},info)=>{
    const owner=await player(request,context,'stronghold-3',1);await enterWorld(page,owner.building.sector);
    const counter=await openCounter(page,owner.building.id,true,'keyboard');await counter.getByRole('button',{name:'Speak with the keeper',exact:true}).click();
    await expect(counter).toContainText('entered your visit');await expect(counter).toContainText('Interior admission depends');
    await expect(counter.getByRole('button',{name:'Enter the stronghold',exact:true})).toHaveCount(0);
    await counter.screenshot({path:info.outputPath('junior-public-counter.png')});
});

test('Obsidian’s isolated map receives a junior visitor at its actual public threshold',async({page,request,context},info)=>{
    const owner=await player(request,context,'stronghold-99',1);await enterWorld(page,99);
    const counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Speak with the keeper',exact:true}).click();
    await expect(counter).toContainText('entered your visit');expect((await world(request,owner)).progress.standing[owner.building.id].visits).toBe(1);
    await expect(counter.getByRole('button',{name:'Enter the stronghold',exact:true})).toHaveCount(0);
    await counter.screenshot({path:info.outputPath('obsidian-junior-public-counter.png')});
    await counter.getByText('News of the road',{exact:true}).click();
    await counter.getByRole('button',{name:'Open atlas for this route',exact:true}).first().click();
    await expect(page.locator('.sector-image-map')).toHaveCount(0);
});

test('the Heartwood kettle table receives tea regulars and letters beside Tetsu’s existing mat',async({page,request,context},info)=>{
    const owner=await player(request,context,'heartwood-tea-counter');await enterWorld(page,15);
    await page.screenshot({path:info.outputPath('heartwood-tea-table-world.png'),fullPage:true});
    const counter=await openCounter(page,owner.building.id);await expect(counter).toContainText('Tea Seller Ren');await expect(counter).toContainText('Tetsu');
    await counter.getByRole('button',{name:'Letters',exact:true}).click();await expect(counter).toContainText('established harbor–deepwood circuit');
    await counter.getByRole('button',{name:'Tea stop',exact:true}).click();await counter.getByRole('button',{name:'Order tea and rest',exact:true}).click();
    const finish=counter.getByRole('button',{name:'Thank the host and finish your rest',exact:true});await expect(finish).toBeEnabled({timeout:20_000});await finish.click();
    await expect(counter).toContainText('No building order is active');
    expect((await world(request,owner)).progress.standing[owner.building.id].trust).toBe(1);
    await counter.screenshot({path:info.outputPath('heartwood-tea-regular-service.png')});
});

test('festival tea respects the existing serving ledge’s actual sky and opening routine',async({page,request,context},info)=>{
    const owner=await player(request,context,'festival-tea-counter');await enterWorld(page,52);
    const counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Tea stop',exact:true}).click();
    const order=counter.getByRole('button',{name:'Order tea and rest',exact:true});let available=false;
    await expect.poll(async()=>{
        const view=await world(request,owner),detail=view.buildings.find(entry=>entry.building.id===owner.building.id)!;
        available=detail.services.find(service=>service.service==='tea')!.available;
        return await order.isEnabled()===available;
    },{timeout:35_000,intervals:[1000]}).toBe(true);
    if(!available){
        await expect(counter).toContainText('Eda’s serving ledge is covered');await expect(order).toBeDisabled();
        const refused=await request.post('/api/sector/buildings',{headers:owner.headers,data:{playerName:owner.name,buildingId:owner.building.id,action:'tea',requestId:`closed-tea-${Date.now()}`}});
        expect(refused.status(),await refused.text()).toBe(409);expect(await refused.text()).toContain('covered');
    }else{
        await order.click();
        const finish=counter.getByRole('button',{name:'Thank the host and finish your rest',exact:true}),error=counter.getByRole('alert');
        await expect(finish.or(error)).toBeVisible();
        if(await finish.isVisible()){await expect(finish).toBeEnabled({timeout:20_000});await finish.click();await expect(counter).toContainText('No building order is active');}
        else await expect(error).toContainText('covered'); // Closing may win the admission race; no cup is charged.
    }
    const saved=await(await request.get(`/api/save/${owner.name}`,{headers:owner.headers})).json();
    const progress=readBuildingProgress(saved.character.sectorBuildings,Date.now());expect(progress.active).toBeUndefined();
    const served=progress.receipts.some(receipt=>receipt.message.includes('The host sets down the tea'));
    expect(saved.character.ryo).toBe(served?970:1000);
    await counter.screenshot({path:info.outputPath('festival-native-kettle-service.png')});
});

test('the village gate retains member entry during a counter outage and receives visitors without admitting them',async({page,request,context},info)=>{
    const owner=await player(request,context,'village-1',85,0,{village:'Stormveil Village'});
    await page.route('**/api/sector/buildings**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The counter books are temporarily unavailable.'})}));
    await enterWorld(page,owner.building.sector);await page.locator('.sector-village-entrance').click();
    const fallback=page.getByRole('dialog',{name:'Building counter',exact:true});
    await fallback.getByRole('button',{name:'Enter Stormveil Village',exact:true}).click();await expect(fallback).toHaveCount(0);
    await expect.poll(async()=>{const saved=await(await request.get(`/api/save/${owner.name}`,{headers:owner.headers})).json();return saved.currentSector;},{timeout:30_000}).toBe(0);
    await page.unroute('**/api/sector/buildings**');
    const visitor=await player(request,context,'village-1',85,0,{village:'Moonshadow Village'});await enterWorld(page,visitor.building.sector);
    const counter=await openCounter(page,visitor.building.id);await counter.getByRole('button',{name:'Speak with the keeper',exact:true}).click();
    await expect(counter).toContainText('Entry beyond the gate is for village members');await expect(counter.getByRole('button',{name:'Enter Stormveil Village',exact:true})).toHaveCount(0);
    await counter.screenshot({path:info.outputPath('visiting-village-public-counter.png')});
});

test('sealed courier work follows both real road relays and resumes away from the issuing counter',async({page,request,context},info)=>{
    test.setTimeout(420_000);const owner=await player(request,context,'stronghold-2');await enterWorld(page,owner.building.sector);
    let counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Letters',exact:true}).click();await counter.getByRole('button',{name:'Accept this work',exact:true}).click();
    for(let step=0;step<2;step++){
        const current=await world(request,owner),target=current.work!.target;
        await counter.getByRole('button',{name:'Walk to the next work point',exact:true}).click();await waitAt(page,target);
        if(step===0){await page.reload();await enterWorld(page,target.sector);}
        await page.locator('.sector-building-work-chip').click();counter=page.getByRole('dialog');
        await expect(counter.locator('.building-courier-itinerary')).toContainText(sectorBuilding(current.progress.active!.route![step])!.name);
        const stamp=counter.getByRole('button',{name:step===0?'Record the relay stamp':'Deliver the pouch',exact:true});await expect(stamp).toBeEnabled();await stamp.click();
    }
    await expect(counter).toContainText('No building order is active');await expect(counter).toContainText('120 ryo');
    const completed=await world(request,owner);expect(completed.progress.deliveries).toBe(1);expect(completed.progress.active).toBeUndefined();
    await counter.screenshot({path:info.outputPath('courier-delivered-away-from-issuer.png')});
});

test('a physical ruin investigation keeps its evidence, testimony and unanswered question after reconnect',async({page,request,context},info)=>{
    test.setTimeout(300_000);const owner=await player(request,context,'esplanade-record-house');await enterWorld(page,owner.building.sector);
    for(let step=0;step<3;step++){
        let counter=await openCounter(page,owner.building.id,false);await counter.getByRole('button',{name:'Field notes',exact:true}).click();
        const target=(await world(request,owner)).buildings.find(b=>b.building.id===owner.building.id)!.survey!.target!;
        const walk=counter.getByRole('button',{name:'Walk to this evidence point',exact:true});
        if(await walk.isVisible()){
            await walk.click();await waitAt(page,target);counter=await openCounter(page,owner.building.id,false);await counter.getByRole('button',{name:'Field notes',exact:true}).click();
        }
        await counter.getByRole('button',{name:'Record this evidence',exact:true}).click();await expect(counter).toContainText(`${step+1} / 3 evidence`);await page.keyboard.press('Escape');
    }
    let counter=await openCounter(page,owner.building.id,false);await counter.getByRole('button',{name:'Field notes',exact:true}).click();
    const back=counter.getByRole('button',{name:'Return to the keeper',exact:true});if(await back.isVisible()){
        await back.click();await waitAt(page,{sector:owner.building.sector,tile:owner.building.approach});counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Field notes',exact:true}).click();
    }
    await expect(counter).toContainText('Chise:');await counter.getByRole('button',{name:'Record an unanswered question',exact:true}).click();
    await page.keyboard.press('Escape');await page.reload();await enterWorld(page,owner.building.sector);
    counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Field notes',exact:true}).click();
    await expect(counter.getByRole('heading',{name:'Recorded Chronicle account',exact:true})).toBeVisible();await expect(counter).toContainText('Which households used');
    await counter.screenshot({path:info.outputPath('retained-chronicle-evidence-account.png')});
});

test('tea completes existing recovery and the road book keeps its receipt after reconnect',async({page,request,context},info)=>{
    const owner=await player(request,context,'midlands-tea-house',85,0,{pets:[],activePetId:null,hp:10,maxHp:100,chakra:10,maxChakra:100,stamina:10,maxStamina:100});
    await enterWorld(page,owner.building.sector);const counter=await openCounter(page,owner.building.id);await expect(counter).toContainText('A quiet rest mat stands beside the kettle.');
    await counter.getByRole('button',{name:'Tea stop',exact:true}).click();await counter.getByRole('button',{name:'Order tea and rest',exact:true}).click();
    const finish=counter.getByRole('button',{name:'Thank the host and finish your rest',exact:true});await expect(finish).toBeEnabled({timeout:20_000});await finish.click();
    await expect(counter).toContainText('No building order is active');
    const saved=await(await request.get(`/api/save/${owner.name}`,{headers:owner.headers})).json();expect(saved.character.ryo).toBe(970);expect(saved.character.hp).toBeGreaterThan(10);
    expect(saved.character.chakra).toBeGreaterThan(10);expect(saved.character.stamina).toBeGreaterThan(10);
    await page.keyboard.press('Escape');await page.reload();await enterWorld(page,owner.building.sector);await page.locator('.sector-building-work-chip').click();
    const book=page.getByRole('dialog',{name:'Your road book',exact:true});await book.getByText(/Recent counter receipts/).click();await expect(book).toContainText('The host sets down the tea');
    await book.screenshot({path:info.outputPath('tea-persistent-road-book.png')});
});

test('all six named shrine registers accept witnessed local accounts while retaining offering access',async({page,request,context},info)=>{
    test.setTimeout(360_000);
    for(const id of ['tide','heartwood','frostveil','moonwell','hollowgate','ancients']){
        const owner=await player(request,context,`shrine-${id}`);await enterWorld(page,owner.building.sector);const counter=await openCounter(page,owner.building.id);
        await expect(counter.getByRole('button',{name:'Make an offering',exact:true})).toBeVisible();
        await counter.getByRole('button',{name:'Register',exact:true}).click();await counter.getByRole('button',{name:'Sign this verified account',exact:true}).first().click();
        await expect(counter.getByRole('button',{name:'Account entered',exact:true})).toBeDisabled();
        expect((await world(request,owner)).progress.standing[owner.building.id].registerEntry).toBe('local-record');
        await counter.screenshot({path:info.outputPath(`shrine-${id}-register.png`)});await page.keyboard.press('Escape');
    }
});

test('regional workshop consumes exact existing ingredients without unlocking a trust-gated recipe',async({page,request,context},info)=>{
    const owner=await player(request,context,'stronghold-3',85,0,{inventory:[],itemStacks:[{itemId:'gather-heartwood-bark',count:5},{itemId:'gather-field-herb',count:20},{itemId:'gather-binding-fiber',count:10}]});
    await enterWorld(page,owner.building.sector);const counter=await openCounter(page,owner.building.id);await counter.getByRole('button',{name:'Workshop',exact:true}).click();
    const recipes=(await world(request,owner)).buildings.find(b=>b.building.id===owner.building.id)!.recipes,recipe=recipes[0];
    await expect(counter.locator('.building-recipe-list article').nth(2).getByRole('button')).toBeDisabled();
    await counter.locator('.building-recipe-list article').first().getByRole('button',{name:'Choose exact materials',exact:true}).click();
    const spent=new Map<string,{owned:number;count:number}>();
    for(const row of recipe.ingredients){const item=row.owned.find(item=>item.count>=row.count)!;expect(item).toBeTruthy();await counter.getByLabel(`${item.name} for ${row.label}`,{exact:true}).fill(String(row.count));spent.set(item.id,{owned:item.count,count:(spent.get(item.id)?.count??0)+row.count});}
    await counter.getByRole('button',{name:'Confirm craft',exact:true}).click();await expect(counter).toContainText('The keeper checks your selected materials and hands over the finished item.');
    const saved=await(await request.get(`/api/save/${owner.name}`,{headers:owner.headers})).json();expect(saved.character.itemStacks.find((s:{itemId:string})=>s.itemId===recipe.id)?.count).toBe(1);
    for(const[id,stock]of spent)expect(saved.character.itemStacks.find((s:{itemId:string})=>s.itemId===id)?.count??0).toBe(stock.owned-stock.count);
    await expect(counter.locator('.building-recipe-list article').nth(2).getByRole('button')).toBeDisabled();
    await counter.screenshot({path:info.outputPath('regional-workshop-crafted.png')});
});

test('festival premises have different duties and fit the crowded painted square',async({page,request,context},info)=>{
    test.setTimeout(240_000);
    for(const id of ['festival-welcome','festival-lantern-house','festival-steps-house']){
        const owner=await player(request,context,id);await enterWorld(page,owner.building.sector);
        if(id==='festival-welcome')await page.screenshot({path:info.outputPath('festival-frontages-world.png'),fullPage:true});
        const counter=await openCounter(page,id);await counter.getByRole('button',{name:'Festival',exact:true}).click();await counter.getByRole('button',{name:'Accept this work',exact:true}).click();
        for(const task of buildingFestivalTasks(id)){const next=counter.getByRole('button',{name:task.label,exact:true});await expect(next).toBeEnabled({timeout:20_000});await next.click();}
        await expect(counter).toContainText('No building order is active');expect((await world(request,owner)).progress.standing[id].festivalDay).toBeTruthy();
        await counter.screenshot({path:info.outputPath(`${id}-duty-complete.png`)});await page.keyboard.press('Escape');
    }
});

test('contact surveillance uses its sealed observed marker and bridge-watch reports publish actual conditions',async({page,request,context},info)=>{
    test.setTimeout(300_000);
    for(const [id,kind]of [['shuttered-boathouse','intelligence'],['gorgewatch','watch']]as const){
        const owner=await player(request,context,id);await enterWorld(page,owner.building.sector);let counter=await openCounter(page,id);
        await counter.getByRole('button',{name:kind==='watch'?'Watch':'Contact',exact:true}).click();await counter.getByRole('button',{name:'Accept this work',exact:true}).click();
        for(let step=0;step<3;step++){
            const current=await world(request,owner),work=current.work!;
            // The server can answer before React has switched from the service
            // tab to the admitted order. Wait for that instruction before
            // deciding whether this step needs a walk.
            await expect(counter.locator('.building-current-work h3')).toHaveText(work.target.label);
            const walk=counter.getByRole('button',{name:'Walk to the next work point',exact:true});if(await walk.isVisible()){
                await walk.click();await waitAt(page,work.target);await page.locator('.sector-building-work-chip').click();counter=page.getByRole('dialog');
            }
            const choice=kind==='intelligence'?step===0?'observe':step===1?'read-mark':`handoff-${current.progress.active!.protocol}`:undefined;
            const label=choice?work.choices!.find(c=>c.id===choice)!.label:work.actionLabel;
            const action=counter.getByRole('button',{name:label,exact:true});await expect(action).toBeEnabled({timeout:20_000});await action.click();
            await expect.poll(async()=>(await world(request,owner)).progress.active?.step??3).toBe(step+1);
        }
        await expect(counter).toContainText('No building order is active');await counter.screenshot({path:info.outputPath(`${kind}-completed.png`)});
        const completed=await world(request,owner);if(kind==='watch')expect(completed.buildings.find(b=>b.building.id===id)!.shared.reports.at(-1)!.text).toMatch(/S38:/);
        else expect(completed.progress.standing[id].intelDay).toBeTruthy();await page.keyboard.press('Escape');
    }
});
