import assert from 'node:assert/strict';

export async function checkRoads({page,board,world,sector,capture,expect,readSave,models}) {
    const layout=world.sectors[sector], site=layout.sites.find(s=>s.id==='saltstair-houses-105');
    const button=(area,name)=>area.getByRole('button',{name,exact:true});
    await expect(board).toBeVisible({timeout:90000});
    await expect(page.locator('.sector-hud-heading strong')).toHaveText(layout.name);
    await expect(board.getByRole('button',{name:'A cook carrying salt',exact:true})).toHaveCount(0);
    await expect(board.locator('button[aria-label^="Challenge "]').first()).toBeVisible();
    await expect(board.locator('.coast-road')).toHaveCount(0);
    await capture('sector');
    await button(board,site.verb+': '+site.name).click();
    const town=page.getByRole('main',{name:site.name}), street=town.locator('.stairs-street .coast-board');
    await expect(street).toBeVisible();
    await expect(street.locator('.coast-patrol')).toHaveCount(3);
    if(models) await expect(street.locator('.stairs-person.has-sector-model')).toHaveCount(3,{timeout:85000});
    await capture('street');
    await button(street,'Provisions shop').click();
    const shopRoom=town.locator('.stairs-counter-room .coast-board');
    await expect(button(shopRoom,'A man mending a roof')).toBeVisible();
    await button(shopRoom,'Browse provisions').click();
    const shop=town.locator('.shop-screen');
    await expect(shop).toBeVisible();
    await shop.locator('button.shop-item-button').first().click();
    const item=page.locator('.item-popup-card');
    const before=(await readSave()).character.ryo;
    const purchase=page.waitForResponse(r=>r.url().endsWith('/api/shop/purchase')&&r.request().method()==='POST');
    await item.getByRole('button',{name:/^Buy (for|1 for)/i}).first().click();
    const bought=await purchase;
    assert(bought.ok(),await bought.text());
    await expect.poll(async()=>(await readSave()).character.ryo).toBeLessThan(before);
    await expect(item).toBeHidden();
    await button(town,'Back to the room').click();
    await button(town,'Back to the street').click();
    await expect(street).toHaveAttribute('data-tile','74');
    await button(street,'Noodle Den').click();
    const denRoom=town.locator('.stairs-counter-room .coast-board');
    await expect(button(denRoom,'A woman sitting apart')).toBeVisible();
    await button(denRoom,'Order noodles').click();
    const den=town.locator('.cafeteria-screen');
    await expect(den).toBeVisible();
    const meal=page.waitForResponse(r=>r.url().includes('cafeteria')&&r.request().method()==='POST');
    await den.locator('.cafeteria-meal-card button, .cafeteria-meal button').first().click();
    const eaten=await meal;
    assert(eaten.ok(),await eaten.text());
    await expect.poll(async()=>(await readSave()).character.hp).toBeGreaterThan(100);
    await button(town,'Back to the room').click();
    await button(town,'Back to the street').click();
    await expect(street).toHaveAttribute('data-tile','81');
    await button(street,'Cook house').click();
    const room=town.locator('.coast-room-board');
    for(const station of site.floors[0].stations) {
        await button(room,station.name).click();
        await expect(room).toHaveAttribute('data-tile',String(station.approach));
        await expect(town.locator('.coast-site-body .coast-world-status')).toHaveText(station.detail);
    }
    await button(town,'Walk outside').click();
    await expect(street).toBeVisible();
    await button(town,'Leave settlement').click();
    await expect(board).toHaveAttribute('data-tile',String(site.returnTile));
    const crossings=[];
    async function follow(from,edge) {
        const title=world.sectors[edge.destinationSector].name;
        const wait=page.waitForResponse(r=>r.url().endsWith('/api/player/travel') && r.request().method()==='POST');
        const bounds=await board.boundingBox();
        const x=(edge.tile%12+.5)*bounds.width/12, y=(Math.floor(edge.tile/12)+.5)*bounds.height/12;
        if(crossings.length===0) {
            const direction={north:['ArrowUp',12],south:['ArrowDown',-12],east:['ArrowRight',-1],west:['ArrowLeft',1]}[edge.direction];
            const near=edge.tile+direction[1];
            await board.click({position:{x:(near%12+.5)*bounds.width/12,y:(Math.floor(near/12)+.5)*bounds.height/12}});
            await expect(board).toHaveAttribute('data-tile',String(near));
            await board.focus(); await page.keyboard.press(direction[0]);
        } else await board.click({position:{x,y}});
        const response=await wait, reply=await response.json();
        assert(response.ok(),JSON.stringify(reply)); assert.equal(reply.arrivalTile,edge.destinationTile);
        await expect(page.locator('.sector-hud-heading strong')).toHaveText(title);
        await expect(board).toHaveAttribute('data-tile',String(edge.destinationTile));
        crossings.push({from,to:edge.destinationSector,arrival:reply.arrivalTile});
    }
    for(const out of layout.exits) {
        await follow(sector,out);
        await follow(out.destinationSector,world.sectors[out.destinationSector].exits.find(e=>e.destinationSector===sector));
    }
    return {crossings,stations:site.floors[0].stations.map(s=>s.name),returnTile:site.returnTile};
}

export async function checkLivery({stockLanding,page,board,world,sector,post,capture,expect,readSave}) {
    const plot=world.sectors[sector].sites.find(s=>s.id.endsWith('-plot-'+sector));
    await board.getByRole('button',{name:plot.verb+': '+plot.name,exact:true}).click({timeout:90000});
    const sheet=page.locator('.coast-site-sheet');
    const choice=sheet.getByRole('group',{name:'Clan hall appearance'});
    await expect(choice).toBeVisible();
    assert.equal(await choice.locator('option').count(),5);
    const dyes=choice.getByRole('group',{name:'Banner dye'}).getByRole('button');
    assert.equal(await dyes.count(),10);
    for(const id of ['gale','tide','heron','kiln','pine']) {
        await choice.getByRole('combobox').selectOption(id);
        await expect.poll(()=>choice.locator('.hall-painting img').evaluate(el=>el.complete && el.naturalWidth)).toBe(480);
    }
    await choice.getByRole('button',{name:'Vermilion',exact:true}).click();
    await capture('picker',choice);
    await choice.getByRole('button',{name:'Found Landing',exact:true}).click();
    await expect.poll(async()=>(await post('/api/coast/landing',{action:'status'})).landing?.hallStyle).toEqual({model:'pine',dye:'vermilion'});
    // Change the founding choice and verify it again after a fresh page load.
    await page.getByText('Customize clan hall',{exact:true}).click();
    await choice.getByRole('combobox').selectOption('heron');
    await choice.getByRole('button',{name:'Sea Jade',exact:true}).click();
    await choice.getByRole('button',{name:'Save hall appearance',exact:true}).click();
    await expect.poll(async()=>(await post('/api/coast/landing',{action:'status'})).landing?.hallStyle).toEqual({model:'heron',dye:'jade'});
    await page.reload();
    await board.getByRole('button',{name:plot.verb+': '+plot.name,exact:true}).click();
    await sheet.getByText('Customize clan hall',{exact:true}).click();
    await expect(choice.getByRole('combobox')).toHaveValue('heron');
    await expect(choice.getByRole('button',{name:'Sea Jade',exact:true})).toHaveAttribute('aria-pressed','true');
    await stockLanding();
    await sheet.getByRole('button',{name:'Refresh coast status'}).click();
    const raise=sheet.getByRole('button',{name:'Raise Founding Camp',exact:true}); await expect(raise).toBeEnabled();
    await raise.click();
    await expect.poll(async()=>(await post('/api/coast/land',{action:'status'})).sectors.find(s=>s.sector===sector)?.holder?.hallStyle).toEqual({model:'heron',dye:'jade'});
    await sheet.getByRole('button',{name:'Enter Founding Camp',exact:true}).click();
    const town=page.getByRole('main',{name:'Clan town'});
    const facilities=town.getByRole('navigation',{name:'Town facilities'}).getByRole('button');
    const state=()=>post('/api/coast/landing',{action:'status'});
    let entries=0;
    page.on('request', req=>{if(req.url().endsWith('/api/coast/landing') && req.postDataJSON()?.action==='town-enter')entries++;});
    for(const tier of [1,2,3]){
        const status=await state();
        await expect(facilities).toHaveCount(status.landing.town.length);
        await expect(town.getByRole('heading',{name:status.landing.name})).toBeVisible();
        assert((await state()).inTown);
        const paint=town.locator('.clan-town-paint');
        await expect(paint).toHaveCSS('background-image',new RegExp('tier-'+tier+'\\.webp'));
        await paint.evaluate(async el=>{const img=new Image();img.src=getComputedStyle(el).backgroundImage.slice(5,-2);await img.decode();if(img.naturalWidth!==1672||img.naturalHeight!==941)throw Error('Town painting dimensions');});
        await capture('town-tier-'+tier);
        if(tier===3){
            await expect(town.locator('.clan-town-works figcaption')).toHaveText(['Store Shed','Drying Racks','Watch Fire']);
            await expect(town.locator('.clan-town-works button')).toHaveCount(0);
        }
        if(tier===2){
            await facilities.getByText('Hospital',{exact:true}).click();
            await expect(page.getByRole('heading',{name:'Clan Town Hospital'})).toBeVisible();
            const pulse=await page.waitForRequest(req=>req.url().endsWith('/api/player/heartbeat') && req.method()==='POST',{timeout:90000});
            assert.equal(pulse.postDataJSON().enterTown,false);
            assert.equal(pulse.postDataJSON().sector,sector);
            assert.equal((await readSave()).currentSector,sector);
            await capture('town-hospital');
            const before=entries;
            await page.getByRole('button',{name:'Return to clan town',exact:true}).click();
            await expect(facilities).toHaveCount(5);
            assert(entries>before,'Coming back from the hospital must renew the visit');
        }
        if(tier<3){
            await town.getByRole('button',{name:'Walk inside the hall'}).click();
            const interior=page.locator('.clan-town .coast-room');
            await expect(interior).toBeVisible();
            await stockLanding();
            await post('/api/coast/landing',{action:'raise'});
            await interior.getByRole('button',{name:'Walk outside',exact:true}).click();
            await expect(town).toBeVisible();
        }
    }
    for(const label of ['Clan Hall','Noodle Den','Bank','Shop','Mission Hall','Stat Training','Jutsu Training']){
        const enter=facilities.filter({hasText:label});
        await enter.click();
        await expect(town).toBeHidden();
        // A return uses the live admission endpoint (12 entries per minute).
        // Give each facility a normal visit before opening the next one.
        await new Promise(resolve=>setTimeout(resolve,6500));
        await page.getByRole('button',{name:'Return to clan town',exact:true}).first().click();
        await expect(facilities).toHaveCount(8);
    }
    await page.reload();
    await expect(facilities).toHaveCount(8,{timeout:90000});
    await post('/api/coast/landing',{action:'town-leave'});
    await town.getByRole('button',{name:'Walk inside the hall',exact:true}).click();
    await expect(town.getByRole('status')).toContainText('facility is closed');
    await expect(page.locator('.clan-town .coast-room')).toHaveCount(0);
    assert.equal((await state()).inTown,false);
    await town.getByRole('button',{name:'Try again'}).click();
    await expect(facilities).toHaveCount(8);
    await post('/api/coast/landing',{action:'town-leave'});
    await town.getByRole('button',{name:'Enter Bank',exact:true}).click();
    await expect(town.getByRole('status')).toContainText('facility is closed');
    await town.getByRole('button',{name:'Try again'}).click();
    await expect(facilities).toHaveCount(8);
    await town.getByRole('button',{name:'Walk out to sector '+sector}).click();
    await expect(board).toBeVisible();
    assert.equal((await state()).inTown,false);
    await expect(board.locator('.coast-hall-marker img')).toHaveAttribute('src','/coast-map/halls/heron.webp');
    await capture('raised',board);
    await stockLanding('rest-test-landing');
    await board.getByRole('button',{name:plot.verb+': '+plot.name,exact:true}).click();
    await sheet.getByRole('button',{name:'Enter Defended Landing',exact:true}).click();
    await expect(town.getByRole('status')).toHaveText('The Landing is dormant, and its town is shut. Stock its stores so it can pay its upkeep.');
    await expect(facilities).toHaveCount(0);
    await town.getByRole('button',{name:'Walk out to sector '+sector}).click();
    await expect(board).toBeVisible();
    return {models:5,dyes:10,persisted:{model:'heron',dye:'jade'}};
}

