import assert from 'node:assert/strict';

const button = (area,name) => area.getByRole('button',{name,exact:true});
async function picture(image) {
    return image.evaluate(async el => { await el.decode(); return el.naturalWidth; });
}
async function stableBoard(board) {
    return board.evaluate(el=>{const r=el.getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height].map(Math.round);});
}
async function hit(element) {
    await element.scrollIntoViewIfNeeded();
    return element.evaluate(el => {const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
}

function clearance(a,b) {
    return Math.hypot(Math.max(a.x-(b.x+b.width),b.x-(a.x+a.width),0),Math.max(a.y-(b.y+b.height),b.y-(a.y+a.height),0));
}

async function checkCourtyard(floor,page,expect,capture,models) {
    const people=floor.locator('.stairs-person');
    await expect(people).toHaveCount(3);
    if(models) await expect(floor.locator('.stairs-person.has-sector-model, .stairs-player.has-sector-model')).toHaveCount(4,{timeout:85000});
    await floor.locator('img.coast-floor, img.sector-avatar-sprite').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
    const stage=await floor.boundingBox(), actors=[], doors=floor.locator('button.coast-site:not(.stairs-person)');
    await expect(doors).toHaveCount(3);
    for(const door of await doors.all()) {
        assert(await hit(door),'Blocked courtyard door '+await door.getAttribute('aria-label'));
    }
    for(const person of await people.all()) {
        const box=await person.boundingBox(), label=await person.getAttribute('aria-label');
        // Read all bounding boxes at the same scroll offset.
        for(const door of await doors.all()) {
            const target=await door.boundingBox();
            assert(clearance(box,target)>0,label+' overlaps '+await door.getAttribute('aria-label')+' '+JSON.stringify({box,target,stage}));
        }
        for(const other of actors) assert(clearance(box,other)>.14*stage.width,label+' crowds another courtyard resident');
        actors.push(box);
    }
    await expect(floor).toHaveAttribute('data-tile','126');
    await capture('courtyard-overview-floor',floor,'css');
    await capture('courtyard-overview-layout',page,'css');
}

async function tapPaintedFloor(floor,x,y) {
    const box=await floor.boundingBox();
    await floor.click({position:{x:x*box.width,y:y*box.height}});
}

export async function checkResidents({page,board,world,sector,post,list,capture,expect,models},count) {
    await expect(board).toBeVisible({timeout:90000});
    const residents = (await list()).coast.people.filter(p=>p.sector===sector);
    assert.equal(residents.length,count);
    const status=page.locator('.sector-hud-context .coast-world-status');
    const labels=[];
    await expect(board.locator('button[aria-label^="Challenge "]').first()).toBeVisible({timeout:35000});
    const patrols=(await post('/api/coast/patrols',{})).patrols;
    if(sector===105) assert(patrols.length>=2);
    for(const p of patrols) await expect(button(board,'Challenge '+p.name+' · Level '+p.level)).toBeVisible();
    if(sector===105) {
        for(const p of residents) await expect(button(board,p.label)).toHaveCount(0);
        const site=world.sectors[sector].sites.find(s=>s.id==='saltstair-houses-105');
        await button(board,site.verb+': '+site.name).click();
        const town=page.locator('.stair-houses');
        const rooms=[
            ['Street',['medic','pilgrim','courier']],['Cook house',['merchant']],
            ['Provisions shop',['tracker']],['Noodle Den',['gambler']],
        ];
        const scales=[];
        const courtyard=town.locator('.stairs-street .coast-board');
        const thresholds={'Cook house':[.5,.25],'Provisions shop':[.24,.482],'Noodle Den':[.75,.48]};
        for(const [room,kinds] of rooms){
            if(room==='Street') await checkCourtyard(courtyard,page,expect,capture,models);
            else {
                await tapPaintedFloor(courtyard,...thresholds[room]);
                await expect(town.locator('h2')).toHaveText(room);
            }
            const floor=town.locator('.coast-room-board');
            await expect(floor.locator('.stairs-person')).toHaveCount(kinds.length);
            for(const p of residents){
                const actor=button(floor,p.label);
                if(!kinds.includes(p.model)){await expect(actor).toHaveCount(0);continue;}
                const seated=room==='Noodle Den' && p.label==='A woman sitting apart';
                const sprite=actor.locator('img.sector-avatar-sprite');
                const pose=seated ? 'gambler-seated-v1.webp' : p.model+(room==='Street'?'.webp':'-room-v1.webp');
                await expect(sprite).toHaveAttribute('src','/coast-map/residents/'+pose);
                assert(await picture(actor.locator('img.sector-avatar-sprite'))>0);
                if(models) await expect(actor).toHaveClass(/has-sector-model/,{timeout:85000});
                const traveler=floor.locator('.stairs-player');
                if(models) await expect(traveler).toHaveClass(/has-sector-model/,{timeout:85000});
                const selector=models ? '.sector-model-figure' : '.sector-avatar-sprite';
                const scene=await floor.boundingBox();
                const actorBox=await actor.locator(selector).boundingBox();
                const actorHeight=actorBox.height/scene.height;
                const playerHeight=(await traveler.locator(selector).boundingBox()).height/scene.height;
                const low=room==='Street'?.068:.18, high=room==='Street'?.135:.29;
                if(seated && !models){
                    const centerX=(actorBox.x+actorBox.width/2-scene.x)/scene.width;
                    const kneesY=(actorBox.y+actorBox.height-scene.y)/scene.height;
                    assert(Math.abs(centerX-.131)<.005 && Math.abs(kneesY-.352)<.005,'Diner misses the cushion');
                    assert(actorHeight>.143 && actorHeight<.152,'Seated body lost its indoor scale');
                    assert(kneesY<.38,'Diner covers the painted bowl');
                }else{
                    assert(actorHeight>=low && actorHeight<=high,room+' resident height '+actorHeight);
                    assert(Math.abs(playerHeight-actorHeight)<.05,room+' player and resident scale disagree');
                }
                assert(playerHeight>=low && playerHeight<=high,room+' player height '+playerHeight);
                if(room !== 'Street'){
                    for(const figure of [actor,traveler]){
                        const liveModel=models && !(figure===actor && seated);
                        const art=figure.locator(liveModel ? '.sector-model-detail' : '.sector-avatar-sprite');
                        await expect(art).toBeVisible();
                        assert.equal(await art.evaluate(async el=>{await el.decode();return el.naturalHeight;}),384);
                        if(liveModel) await expect(figure.locator(selector)).toHaveCSS('background-image','none');
                    }
                }
                const measurement={room,model:p.model,actorHeight,playerHeight};
                scales.push(measurement);
                assert(await hit(actor),'Blocked resident '+p.label);
                await actor.click();
                await expect(town.locator('.stairs-residents [role=status]')).toContainText(p.say);
                if(room==='Street'){
                    const playerBox=await traveler.locator(selector).boundingBox();
                    measurement.conversationGap=clearance(actorBox,playerBox)/scene.width;
                    assert(measurement.conversationGap>.02,p.label+' is crowded by the player');
                    if(p.model==='courier'){
                        await expect(floor).toHaveAttribute('data-tile','85');
                        await floor.focus();
                        await floor.press('ArrowRight');
                        await expect(floor).toHaveAttribute('data-tile','85');
                        await floor.press('ArrowDown');
                        await expect(floor).toHaveAttribute('data-tile','97');
                    }
                }else{
                    const shop=room==='Provisions shop', kitchen=room==='Cook house';
                    await expect(floor).toHaveAttribute('data-tile',shop?'98':kitchen?'93':'68');
                    const playerBox=await traveler.locator(models ? '.sector-model-detail' : '.sector-avatar-sprite').boundingBox();
                    const clearWidth=shop ? actorBox.x-(playerBox.x+playerBox.width) : playerBox.x-(actorBox.x+actorBox.width);
                    measurement.conversationGap=clearWidth/scene.width;
                    assert(measurement.conversationGap > (kitchen ? 0.33 : 0.45),room+' needs clear floor between player and resident');
                }
                if(room === 'Provisions shop'){
                    const counter=await button(floor,'Browse provisions').locator('span').boundingBox();
                    const body=await traveler.locator(models ? '.sector-model-detail' : '.sector-avatar-sprite').boundingBox();
                    assert(body.y >= counter.y+counter.height || body.x >= counter.x+counter.width, 'Player covers the counter label');
                }
            }
            const label=room.toLowerCase().replaceAll(' ','-');
            await capture(label); await capture(label+'-floor',floor);
            if(room!=='Street') await capture(label+'-layout',page,'css');
            if(room==='Noodle Den'){
                await floor.focus();
                await floor.press('ArrowRight');
                await expect(floor).toHaveAttribute('data-tile','68');
                const diner=residents.find(person=>person.model==='gambler');
                const dinerButton=button(floor,diner.label);
                await dinerButton.focus();
                await dinerButton.press('Enter');
                await expect(town.locator('.stairs-residents [role=status]')).toContainText(diner.say);
                await button(town,'Walk outside').click();
                await expect(town.locator('.stairs-street .coast-board')).toBeVisible();
            }else if(room!=='Street'){
                const resident=residents.find(person=>person.model===kinds[0]);
                const speakingTile=room==='Cook house' ? 93 : 98;
                await floor.focus();
                await floor.press('ArrowDown');
                await expect(floor).toHaveAttribute('data-tile',String(speakingTile+12));
                await button(floor,resident.label).press('Enter');
                await expect(floor).toHaveAttribute('data-tile',String(speakingTile));
                await expect(town.locator('.stairs-residents [role=status]')).toContainText(resident.say);
                await button(town,'Walk outside').click();
                await expect(town.locator('.stairs-street .coast-board')).toBeVisible();
            }
        }
        await tapPaintedFloor(courtyard,.54,.955);
        await expect(board).toHaveAttribute('data-tile',String(site.returnTile));
        return {scales,residents:residents.map(p=>p.label),patrols:patrols.map(p=>p.name)};
    }
    for(const person of residents) {
        const figure=button(board,person.label);
        await expect(figure).toBeVisible();
        const face=figure.locator('img.sector-avatar-sprite');
        assert(await picture(face)>0);
        assert((await face.boundingBox()).width < (await figure.boundingBox()).width,person.label+' portrait covers its whole tap target');
        assert(await hit(figure),person.label+' has an occluded tap target');
        const before=await stableBoard(board);
        await figure.click();
        await expect(status).toHaveText(person.label+': '+person.say);
        assert.deepEqual(await stableBoard(board),before,'Speaking moved the board');
        const fits=await status.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && getComputedStyle(el).visibility==='visible');
        assert(fits,person.label+' speech overflows');
        labels.push(person.label);
    }
    await capture('crowd',board);
    await status.scrollIntoViewIfNeeded();
    await capture('speech');
    if(sector===104) {
        const site=world.sectors[sector].sites.find(s=>s.gather==='fishing');
        const fish=button(board,site.verb+': '+site.name);
        assert(await hit(fish)); await fish.click();
        await expect(page.locator('.coast-site-sheet h3')).toHaveText(site.name);
    }
    return {residents:labels,patrols:patrols.map(p=>[p.name,p.level])};
}

export async function checkRoom({page,board,world,sector,prepared,capture,expect,touch}) {
    const keeper=prepared.keepers.find(f=>f.sector===sector);
    const site=world.sectors[sector].sites.find(s=>s.id===keeper.site);
    await button(board,keeper.label).click({timeout:90000});
    const entry=page.locator('.coast-site-sheet');
    await button(entry,'Enter '+site.name).click();
    const room=entry.locator('.coast-room-board');
    await expect(room.locator('.stairs-player, .coast-patrol')).toHaveCount(2);
    const face=room.getByRole('img',{name:keeper.label,exact:true});
    assert(await picture(face)>0);
    await expect(face).toHaveAttribute('src',keeper.image);
    await capture('ground',room);
    const station=site.floors[0].stations[0];
    await button(room,station.name).click();
    await expect(room).toHaveAttribute('data-tile',String(station.approach));
    await expect(entry.locator('[role=status]')).toHaveText(station.detail);
    const clues = [station.name];
    for(let floor=1;floor<site.floors.length;floor++) {
        const up=site.floors[floor-1].stairs.find(s=>s.to===floor);
        await button(room,up.label).click();
        await expect(room).toHaveAttribute('data-floor',String(floor+1));
        await expect(room.locator('.stairs-player, .coast-patrol')).toHaveCount(1);
        for(const clue of site.floors[floor].stations.filter(s=>s.clue)) {
            await button(room,clue.name).click();
            await expect(entry.locator('[role=status]')).toHaveText(clue.detail);
            clues.push(clue.name);
        }
    }
    if(site.id==='brackwater-tree-120') {
        assert.equal(clues.length,3);
        await capture('crown',entry);
    }
    for(let floor=site.floors.length-1;floor>0;floor--) {
        const down=site.floors[floor].stairs.find(s=>s.to===floor-1);
        const stair = button(room,down.label);
        if(touch) {
            const point = await stair.evaluate(el => {
                const rect=el.getBoundingClientRect(), x=rect.left+rect.width/2, y=rect.top+rect.height/2;
                return el.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
            });
            assert(point,'The painted stair must receive a tap at its centre');
            await page.touchscreen.tap(point.x,point.y);
        } else await stair.click();
        await expect(room).toHaveAttribute('data-floor',String(floor));
    }
    await expect(room.locator('.stairs-player, .coast-patrol')).toHaveCount(2);
    await button(entry,'Walk outside').click();
    await expect(entry).toHaveCount(0);
    await expect(board).toHaveAttribute('data-tile',String(site.returnTile??site.approach));
    return {site:site.id,keeper:keeper.label,portrait:keeper.image,station:station.name,floors:site.floors.length,clues};
}

export async function checkModels({page,board,kind,sector,list,capture,expect}) {
    const figure=(await list()).coast.figures.find(f=>f.sector===sector && Boolean(f.boss)===(kind==='boss'));
    assert(figure);
    const actor=button(board,figure.label), layer=actor.locator('.sector-model-figure'), fallback=actor.locator('img.sector-avatar-sprite');
    await expect(actor).toHaveClass(/has-sector-model/,{timeout:85000});
    await expect(layer).toHaveCSS('background-image',/url\(/);
    await expect(layer).toHaveAttribute('data-clip','idle');
    await expect(layer).toBeVisible(); await expect(fallback).toHaveCSS('visibility','hidden');
    const box=await layer.boundingBox(); assert(box.width>3 && box.height>3);
    await capture('on',board);
    await page.evaluate(()=>localStorage.setItem('worldAvatarMode.v1','2d'));
    // Init scripts apply the fixture preference on navigation. Use a storage
    // event to exercise the same live preference change as a second game tab.
    await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'worldAvatarMode.v1',newValue:'2d'})));
    await expect(layer).toHaveCount(0); await expect(fallback).toBeVisible(); assert(await picture(fallback)>0);
    await capture('off',board);
    return {label:figure.label,model:figure.model,dimensions:[box.width,box.height],exclusive:true};
}

export async function checkAtlas({page,world,list,capture,expect},regionOf,regionCount) {
    await button(page,'Coast map').click({timeout:90000});
    const atlas=page.locator('.coast-atlas-canvas'), marks=(await list()).coast.places;
    assert(await picture(atlas.locator(':scope > img'))>0);
    const results=[];
    for(let region=1;region<=regionCount;region++) {
        const points=[...new Set(marks.map(m=>m.sector))].filter(id=>regionOf(id)===region);
        let selected;
        for(const id of points) {
            const pin=button(atlas,'Travel to '+world.sectors[id].name);
            if(await pin.count() && await pin.isEnabled()) { selected={id,pin};break; }
        }
        assert(selected,'Missing reachable marked pin in region '+region+': '+JSON.stringify(points));
        const {id,pin}=selected,scroll=pin.locator('img.coast-quest-mark');
        await pin.scrollIntoViewIfNeeded(); assert(await picture(scroll)>0);
        const backing=await scroll.evaluate(el=>getComputedStyle(el).backgroundColor);
        assert(!['rgba(0, 0, 0, 0)','transparent'].includes(backing),'Scroll needs a visible backing over terrain');
        await expect(scroll).toBeVisible(); assert(await hit(pin),'Pin is covered: '+id);
        await capture('region-'+region,page.locator('.coast-atlas-frame'));
        await pin.click();
        await expect(page.locator('.sector-hud-heading strong')).toHaveText(world.sectors[id].name,{timeout:35000});
        results.push({region,sector:id,site:world.sectors[id].name});
        await button(page,'Coast map').click();
    }
    return {markers:results};
}

export async function checkBell({page,list,readSave,kind,capture,expect}) {
    const id = 'tale-second-bell';
    const hanging = kind === 'bell-hang';
    const heard = hanging ? 'signed it off' : 'line for the clapper blank';
    const other = hanging ? 'line for the clapper blank' : 'signed it off';
    await page.locator('#mission-tab-wandering').click();
    const quest = (await list()).lines.find(line=>line.id===id);
    const card = page.locator('.quest-line-card').filter({has:page.getByText(quest.title,{exact:true})});
    await expect(card).toContainText(heard);
    await expect(card).not.toContainText(other);
    await capture('closing',card);
    const record = (await readSave()).questLines;
    const response = page.waitForResponse(r=>r.url().endsWith('/api/quests/lines') && r.request().postDataJSON()?.action==='recall');
    await button(card,'Hear it again').click();
    const recall = await (await response).json();
    assert.equal(recall.ok,true);
    assert(recall.talk.some(s=>s.text.includes(heard)));
    assert(!recall.talk.some(s=>s.text.includes(other)));
    await page.getByText('Skip',{exact:true}).last().click();
    await expect(page.locator('.coast-quest-scene')).toHaveCount(0);
    assert.deepEqual((await readSave()).questLines,record);
    return {quest:id,choice:record.done[id].choices.clapper,closing:quest.talk.map(s=>s.text)};
}

export async function checkLetter({page,list,readSave,capture,expect},key) {
    const id = 'tale-unsent-letter';
    await page.locator('#mission-tab-wandering').click();
    const quest = (await list()).lines.find(line => line.id === id);
    const { prompt, options, place } = quest.stage.choice;
    assert.equal(place, "The Hound Trace");
    const card = page.locator('.quest-line-card').filter({has:page.getByText(quest.title,{exact:true})});
    await expect(card.getByText(prompt,{exact:true})).toBeVisible();
    await button(card,'Give your answer').click();
    await button(page,'Next').last().click();
    const picks = page.getByRole('button',{name:new RegExp(options.find(o=>o.key===key).label)});
    await expect(picks.last()).toBeEnabled();
    await expect(page.getByText(prompt,{exact:true}).last()).toBeVisible();
    await expect(page.getByText(place,{exact:true}).filter({visible:true}).first()).toBeVisible();
    if(key==='keep') {
        await page.getByText('Skip',{exact:true}).last().click();
        await expect(page.locator('.coast-quest-scene')).toHaveCount(0);
        assert.equal((await readSave()).questLines.active[id].choices?.letter,undefined);
        await expect(card.getByText(prompt,{exact:true})).toBeVisible();
    }
    await capture('question',key==='keep' ? card : page);
    const response = page.waitForResponse(r => r.url().endsWith('/api/quests/lines') && r.request().postDataJSON()?.action==='choose');
    await picks.last().click();
    assert.equal((await (await response).json()).ok,true);
    const next = (await list()).lines.find(line => line.id===id);
    await expect(card).toContainText(next.talk[0].text);
    assert.match(next.talk[0].text,key==='carry' ? /carried home/ : /read by no one/);
    assert.equal((await readSave()).questLines.active[id].choices.letter,key);
    return {quest:id,prompt,key,keeperReply:next.talk[0].text};
}

export async function checkJournal({page,readSave,list,capture,expect}) {
    await page.locator('#mission-tab-wandering').click();
    const done=(await list()).lines.find(l=>l.id==='shuttered-boat');
    assert.equal(done.state,'done');
    const card=page.locator('.quest-line-card').filter({has:page.getByText(done.title,{exact:true})});
    const replay=button(card,'Hear it again');
    await replay.scrollIntoViewIfNeeded(); assert(await picture(card.locator('.quest-line-scene'))>0);
    await capture('card',card);
    const snapshot=(await readSave()).questLines;
    const reply=page.waitForResponse(r=>r.url().endsWith('/api/quests/lines')&&r.request().postDataJSON()?.action==='recall');
    await replay.click(); assert((await reply).ok());
    const scene=page.locator('.coast-quest-scene'); await expect(scene).toBeVisible();
    // The cinematic reader portals its controls to the top of the document.
    const next=page.getByRole('button',{name:'Next',exact:true}).last();
    await expect(next).toBeVisible(); await capture('reader'); await next.click();
    await page.getByText('Skip',{exact:true}).last().click();
    await expect(scene).toHaveCount(0);
    await expect(replay).toBeEnabled(); assert.deepEqual((await readSave()).questLines,snapshot);
    return {quest:done.id,replayReturned:true};
}

export async function checkCrossing({page,ctx,prepared,name,readSave,world,expect},minimum,destinationSector) {
    const below=prepared.level<minimum;
    const session=await page.evaluate(name=>JSON.parse(localStorage.getItem('ninjav-player-accounts-v1'))[name].token,name);
    const headers={'x-player-name':name,'x-player-token':session};
    const save=await readSave();
    await ctx.request.post('/api/player/heartbeat',{headers,data:{name,sector:save.currentSector,tile:save.currentTile??78,character:{name}}});
    if(below) {
        await page.locator('#mission-tab-wandering').click();
        await expect(page.locator('.quest-lines--journal')).toHaveCount(0);
    }
    const reply=await ctx.request.post('/api/player/travel',{headers,data:{destinationSector}});
    const data=await reply.json();
    if(below) { assert.equal(reply.status(),403,JSON.stringify(data)); assert.match(data.error,new RegExp(String(minimum))); }
    else { assert.equal(reply.status(),200,JSON.stringify(data)); assert.equal(data.destinationSector,destinationSector); }
    return {destination:world.sectors[destinationSector].name,status:reply.status(),reason:data.reason};
}

