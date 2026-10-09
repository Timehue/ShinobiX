import { test, expect } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave, expectUiAuditBoot } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

test('saved find survives dismissal and refresh; exact choice claims once', async ({page}, testInfo) => {
    const save={...uiAuditSave(),currentSector:40};
    const find={id:'gather-browser-001',sector:33,biome:'volcano',rareTrace:true,at:Date.now()};
    save.character={...save.character,unspentStats:0,statPoints:0,gatherIntroSeen:true,pendingGatherFinds:[find]};
    const runtime=await installUiAuditRuntime(page,save);
    let claims=0;
    await page.route('**/api/world/claim-gather',async route=>{
        claims++;
        expect(route.request().postDataJSON()).toEqual({playerName:'AuditNinja',findId:find.id,sector:33,common:'gather-iron-sand',takeTrace:true});
        const character={...save.character,pendingGatherFinds:[],gatherIntroSeen:true,itemStacks:[{itemId:'gather-iron-sand',count:2},{itemId:'gather-ember-ore',count:1}]};
        const version=runtime.currentVersion()+1;
        runtime.commitServerCharacter(character,version);
        await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,character,_saveVersion:version,rewards:character.itemStacks})});
    });
    await expectUiAuditBoot(page,runtime,'worldMap');
    await page.getByRole('button',{name:'Resume find',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'The Find',exact:true});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.gather-reward')).toContainText('2 × Field Herb + 1 × Ember Ore');
    await dialog.getByRole('button',{name:'Save for later',exact:true}).click();
    expect(claims).toBe(0);
    await page.reload();
    await page.getByRole('button',{name:'Resume find',exact:true}).click();
    await dialog.getByRole('radio',{name:/Iron Sand/}).check();
    await dialog.getByRole('checkbox').uncheck();
    await expect(dialog.locator('.gather-reward')).toHaveText('YOU WILL RECEIVE3 × Iron Sand');
    await dialog.getByRole('checkbox').check();
    await expect(dialog.locator('.gather-reward')).toContainText('2 × Iron Sand + 1 × Ember Ore');
    const box=await dialog.boundingBox();
    expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
    const collectBox=await dialog.getByRole('button',{name:'Collect this harvest',exact:true}).boundingBox();
    expect(collectBox!.y).toBeGreaterThanOrEqual(0);
    expect(collectBox!.y+collectBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
    expect((await dialog.getByRole('radio',{name:/Iron Sand/}).boundingBox())!.width).toBeLessThanOrEqual(22);
    await page.screenshot({path:testInfo.outputPath('the-find-choice.png'),fullPage:true});
    await dialog.getByRole('button',{name:'Collect this harvest',exact:true}).click();
    await expect(dialog).toContainText('Gathering complete');
    expect(claims).toBe(1);
    await dialog.getByRole('button',{name:'Return to the map',exact:true}).click();
    await expect(page.getByRole('button',{name:'Resume find',exact:true})).toHaveCount(0);
});
test('first find uses the VN renderer and skipping leaves an explicit unclaimed choice',async({page},testInfo)=>{
    const save={...uiAuditSave(),currentSector:40};save.character={...save.character,unspentStats:0,statPoints:0,gatherIntroSeen:false,
        pendingGatherFinds:[{id:'gather-browser-first',sector:12,biome:'forest',rareTrace:false,at:Date.now()}]};
    const runtime=await installUiAuditRuntime(page,save);
    let claims=0;page.on('request',r=>{if(r.url().includes('/world/claim-gather'))claims++;});
    await expectUiAuditBoot(page,runtime,'worldMap');
    await page.getByRole('button',{name:'Resume find',exact:true}).click();
    const story=page.getByRole('dialog',{name:'The Find visual novel scene',exact:true});
    await expect(story).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('the-find-vn.png'),fullPage:true});
    await story.getByRole('button',{name:'Skip',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'The Find',exact:true});
    await expect(dialog).toBeVisible();await expect(dialog.locator('.gather-reward')).toContainText('3 × Field Herb');
    expect(claims).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Resume find',exact:true})).toBeVisible();
});

test('Explore Tile reaches The Find after discovery probes and a lost claim reply retries safely',async({page})=>{
    const save={...uiAuditSave(),currentSector:40};
    // Keep road hostiles from stopping the explorer mid-journey (they hunt and block).
    let character={...save.character,unspentStats:0,statPoints:0,gatherIntroSeen:true,pendingGatherFinds:[],wandererCooldowns:quietRoadCooldowns([40])} as Record<string,unknown>;
    save.character=character;
    const runtime=await installUiAuditRuntime(page,save);
    const stages:string[]=[];
    const claimBodies:unknown[]=[];
    let requestId='';
    let find:Record<string,unknown>;
    const versioned=()=>{
        const version=runtime.currentVersion()+1;
        runtime.commitServerCharacter(character,version);
        return {character,_saveVersion:version};
    };
    await page.route('**/api/dungeon/run',async route=>{
        const body=route.request().postDataJSON();requestId=body.requestId;
        expect(body).toMatchObject({action:'probe-free',playerName:'AuditNinja',sector:40});
        stages.push('dungeon');
        await route.fulfill({json:{ok:true,found:false,token:'',requestId,sector:40,resolved:false,...versioned()}});
    });
    await page.route('**/api/pet/encounter-start',async route=>{
        expect(route.request().postDataJSON()).toMatchObject({requestId,sector:40});
        stages.push('pet');
        await route.fulfill({json:{ok:true,requestId,sector:40,pet:null,replayed:false}});
    });
    await page.route('**/api/world/explore',async route=>{
        expect(route.request().postDataJSON()).toEqual({playerName:'AuditNinja',sector:40,credit:'tile',requestId,resolveOutcome:true});
        stages.push('explore');
        find={id:requestId,sector:40,biome:'central',rareTrace:false,at:Date.now()};
        character={...character,pendingGatherFinds:[find],serverExploreDate:new Date().toISOString().slice(0,10),serverExploresToday:1};
        await route.fulfill({json:{ok:true,outcome:{kind:'gather',find},reward:{sector:40,xp:0,ryo:0},fieldProgress:[],...versioned()}});
    });
    await page.route('**/api/world/claim-gather',async route=>{
        const request=route.request();
        expect(request.headers()['x-player-name']).toBe('AuditNinja');
        expect(request.headers()['x-player-token']).toBe('ui-audit-token');
        const body=request.postDataJSON();claimBodies.push(body);
        expect(body).toEqual({playerName:'AuditNinja',findId:requestId,sector:40,common:'gather-binding-fiber',takeTrace:false});
        if(claimBodies.length===1){
            character={...character,pendingGatherFinds:[],itemStacks:[{itemId:'gather-binding-fiber',count:3}]};
            versioned();
            await route.abort('failed'); // Server committed, but the client never got its acknowledgement.
            return;
        }
        await route.fulfill({json:{ok:true,replayed:true,character,_saveVersion:runtime.currentVersion(),rewards:[{itemId:'gather-binding-fiber',count:3}]}});
    });
    await expectUiAuditBoot(page,runtime,'worldMap');
    await page.getByRole('button',{name:/Return to Sector 40/}).click();
    await expect(page.locator('.sector-stage-panel')).toBeVisible();
    await page.keyboard.press('e');
    const dialog=page.getByRole('dialog',{name:'The Find',exact:true});
    await expect(dialog).toBeVisible();
    expect(stages).toEqual(['dungeon','pet','explore']);
    await dialog.getByRole('radio',{name:/Binding Fiber/}).check();
    await expect(dialog.locator('.gather-reward')).toContainText('3 × Binding Fiber');
    // Check the shipped scene and icons decode in each browser, rather than accepting a fallback.
    await expect.poll(()=>dialog.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth===256))).toBe(true);
    expect(await dialog.locator('.gather-art').evaluate(async node=>{
        const src=getComputedStyle(node).backgroundImage.slice(5,-2);
        const image=new Image();image.src=src;await image.decode();return [image.naturalWidth,image.naturalHeight];
    })).toEqual([1600,900]);
    await dialog.getByRole('button',{name:'Collect this harvest',exact:true}).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button',{name:'Collect this harvest',exact:true}).click();
    await expect(dialog).toContainText('Gathering complete');
    expect(claimBodies).toHaveLength(2);expect(claimBodies[0]).toEqual(claimBodies[1]);
    await dialog.getByRole('button',{name:'Return to the map',exact:true}).click();
    await page.reload();
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
    await expect(page.getByRole('button',{name:'Resume find',exact:true})).toHaveCount(0);
    expect(character.ryo).toBe(9_999_999);
    expect(character.itemStacks).toEqual([{itemId:'gather-binding-fiber',count:3}]);
});
