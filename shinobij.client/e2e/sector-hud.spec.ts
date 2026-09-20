import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const evidence = '../docs/sector-hud-layout-2026-09-19';
mkdirSync(evidence, { recursive: true });

async function boot(page: Page, count = 8, configure?: () => Promise<void>, sector = 22) {
    const save = uiAuditSave();
    save.currentSector = sector;
    await installUiAuditRuntime(page, save);
    await page.route('**/api/img?**', route => {
        const id = new URL(route.request().url()).searchParams.get('id');
        return id?.startsWith('avatar:')
            ? route.fulfill({ contentType: 'image/webp', path: 'public/portraits/corvo-latch.webp' })
            : route.fallback();
    });
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/player/heartbeat', route => route.fulfill({ json: {
        ok: true, sector, sectorMates: Array.from({length: count}, (_, i) => ({
            name: `Shinobi${String(i + 1).padStart(3, '0')}`, level: 40 + i, currentSector: sector,
            village: 'Ashen Leaf Village', character: {avatarImage:i%2?'/portraits/deni-cros.webp':'/portraits/corvo-latch.webp'}, tile: 38 + i % 50,
            inBattle: i === 1, travelingUntil: i === 2 ? Date.now() + 60000 : 0,
        })),
    }}));
    await configure?.();
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap', {timeout: 60_000});
    const returnButton = page.getByRole('button', {name: `Return to Sector ${sector}`, exact: false});
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible(), {timeout: 60_000}).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    await expect(page.locator('.sector-image-map')).toBeVisible({timeout: 60_000});
}

test('capture sector baseline', async ({page}) => {
    test.skip(process.env.SECTOR_HUD_BASELINE !== '1');
    for (const [width, height] of [[1366,768],[390,844]]) {
        await page.setViewportSize({width, height});
        await boot(page);
        await expect(page.getByText('Shinobi001', {exact: true}).first()).toBeVisible();
        await page.screenshot({path: `${evidence}/before-${width}x${height}.png`, fullPage: true});
    }
});

for (const [width, height] of [[320,568],[360,800],[390,844],[430,932],[667,375],[844,390],[768,800],[768,1024],[1366,768],[1920,1080]]) {
    test(`HUD fits ${width}x${height}`, async ({page}) => {
        await page.setViewportSize({width, height});
        await boot(page, 25);
        const trigger = page.getByRole('button', {name: 'Sector Info'});
        await expect(trigger).toBeVisible();
        await expect(page.getByRole('button',{name:/Players Here|^Actions$|^Recover$|^Leave$/})).toHaveCount(0);
        await expect(page.getByRole('list',{name:'Sector players'})).toBeVisible();
        for (const control of await page.locator('.sector-hud-controls > button').all()) {
            await expect(control).toBeVisible();
            expect(await control.evaluate(element => {
                const r = element.getBoundingClientRect();
                return document.elementFromPoint(r.right - 5, r.bottom - 5)?.closest('button') === element;
            })).toBe(true);
        }
        if (width === 320) {
            await page.getByRole('button', {name: 'Review World Map tip'}).click();
            await expect(page.getByRole('dialog', {name: 'World Map tip', exact: true})).toBeVisible();
            await page.keyboard.press('Escape');
        }
        await page.locator('.sector-image-map img').evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode().catch(()=>{}))));
        const closedMap = await page.locator('.sector-image-map').boundingBox();
        const closedHud = await page.locator('.sector-hud').boundingBox();
        if (width === 390 || width >= 980) {
            const nav = await page.locator('.mobile-bottom-nav').boundingBox();
            expect((nav?.height ? nav.y : height) - (closedHud!.y + closedHud!.height)).toBeLessThanOrEqual(14);
            await expect(page.getByRole('list', {name: 'Sector players'})).toBeVisible();
        }
        await expect(page.locator('.sector-hud-art')).toHaveCount(0);
        if (width === 1366) await expect(page.locator('.sector-stage-routes')).toContainText('Moonstone Rise');
        await page.screenshot({path: `${evidence}/after-${width}x${height}-closed.png`});
        await trigger.click();
        const panel = page.getByRole('dialog', {name: 'Sector Info', exact: true});
        await expect(panel).toBeVisible();
        await expect(page.locator('.sector-player-row')).toHaveCount(25);
        const bounds = await panel.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
        const controls = await page.locator('.sector-hud-controls button, .sector-hud-panel-heading button, .sector-roster-action').evaluateAll(elements =>
            elements.map(element => { const r = element.getBoundingClientRect(); return [r.width, r.height]; }));
        for (const [w,h] of controls) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const stage = await page.locator('.sector-image-map').boundingBox();
        expect(stage!.width).toBeCloseTo(closedMap!.width, 0);
        const hud = await page.locator('.sector-hud').boundingBox();
        const nav = await page.locator('.mobile-bottom-nav').boundingBox();
        expect(stage!.y + stage!.height).toBeLessThanOrEqual(nav?.height ? nav.y : height);
        if (width >= 980 || (width >= 560 && height <= 450)) {
            expect(hud!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width);
            if (height <= 450) expect(stage!.width).toBeGreaterThanOrEqual(height - 150);
        }
        else {
            expect(hud!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height);
            expect(hud!.y - (stage!.y + stage!.height)).toBeLessThanOrEqual(2);
            expect(hud!.y + hud!.height).toBeLessThanOrEqual(nav?.height ? nav.y : height);
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(hud!.y);
        }
        await page.screenshot({path: `${evidence}/after-${width}x${height}-info.png`});
    });
}

test('nearby roster uses explicit actions and the shared current-roster gate', async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await boot(page,25);
    const preview = page.getByRole('list', {name:'Sector players'});
    await expect(preview).toBeVisible();
    const original = await page.locator('.sector-player-tile').getAttribute('aria-label');
    let attacks = 0;
    await page.route('**/api/player/attack',route=>{attacks++;return route.fulfill({status:409,json:{error:'Fixture: preview refusal.'}});});
    await preview.getByText('Shinobi001', {exact:true}).click();
    expect(attacks).toBe(0);
    const attack = preview.getByRole('button', {name:'Attack Shinobi001',exact:true});
    await attack.focus();
    await page.keyboard.press('d');
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label',original!);
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.markSectorRosterUnavailable(22);});
    await expect(attack).toBeDisabled();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.pushLiveSectorPlayers(store.getLiveSectorPlayers(),22);});
    await expect(attack).toBeEnabled();
    await attack.click();
    await expect.poll(()=>attacks).toBe(1);
    await expect(page.getByText('Fixture: preview refusal.', {exact:true})).toBeVisible();
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label',original!);
});

test('dismissal consumes the gesture, isolates shortcuts and keeps the canvas mounted', async ({page}) => {
    await page.setViewportSize({width: 1366, height: 768});
    await boot(page);
    const trigger = page.getByRole('button', {name: 'Sector Info'});
    await expect(trigger).toBeVisible();
    const map = await page.locator('.sector-image-map').elementHandle();
    const tile = page.locator('.sector-player-tile');
    const original = await tile.getAttribute('aria-label');
    await trigger.click();
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    await expect(tile).toHaveAttribute('aria-label', original!);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('dialog', {name:'Sector Info',exact:true})).toHaveCount(0);
    await trigger.click();
    const freshTile = page.getByRole('button', {name:'Move to tile row 10 column 3',exact:true});
    await freshTile.click();
    await expect(tile).toHaveAttribute('aria-label', original!);
    await freshTile.click();
    await expect(tile).toHaveAttribute('aria-label', 'Current tile row 10 column 3');
    await page.keyboard.press('d');
    await expect(tile).toHaveAttribute('aria-label', 'Current tile row 10 column 4');
    for (let i=0; i<10; i++) { await trigger.click(); await page.getByRole('button',{name:'Close Sector Info'}).click(); }
    expect(await map!.evaluate(element => element.isConnected)).toBe(true);
});

test('empty and unknown presence are distinct', async ({page}) => {
    await boot(page, 0);
    await expect(page.getByText('No other players are here.', {exact:false})).toBeVisible();
    await page.screenshot({path:`${evidence}/empty.png`});
    await page.evaluate(async () => {
        const store = await import('/src/lib/presence-store.ts');
        store.markSectorRosterUnavailable(22);
    });
    await expect(page.getByText('Reconnecting.', {exact:false})).toBeVisible();
    await expect(page.locator('.sector-nearby-heading')).not.toContainText('0 in sector');
});

test('stable rows, scrolling, status updates and target departure', async ({page}) => {
    await boot(page,100);
    await expect(page.locator('.sector-player-row')).toHaveCount(100);
    // This case drives presence directly; later fixture heartbeats must not
    // replace its status delta with the original boot snapshot.
    await page.route('**/api/player/heartbeat', route => route.fulfill({json:{ok:true,sector:22}}));
    const lastAction=page.locator('.sector-player-row').last().getByRole('button');
    await lastAction.focus();
    await expect(lastAction).toBeInViewport();
    const scrolling = page.locator('.sector-nearby-scroll');
    await scrolling.evaluate(element => {element.scrollTop=400;});
    const before = await scrolling.evaluate(element => element.scrollTop);
    await page.evaluate(async () => {
        const store = await import('/src/lib/presence-store.ts');
        const rows=store.getLiveSectorRoster();
        store.pushLiveSectorPlayers(rows.map(p => ({...p,inBattle:p.name==='Shinobi040'})).reverse(),22);
    });
    expect(await scrolling.evaluate(element=>element.scrollTop)).toBe(before);
    await expect(page.locator('[data-player-key=shinobi040]')).toContainText('Fighting');
    await expect(page.getByRole('button',{name:'Spectate Shinobi040'})).toBeEnabled();
    await expect(page.locator('.sector-player-row').first()).toHaveAttribute('data-player-key','shinobi001');
    await scrolling.evaluate(element => {element.scrollTop=0;});
    const target = page.getByRole('button',{name:'Attack Shinobi001',exact:true});
    let attacks=0;
    await page.route('**/api/player/attack',route=>{attacks++;return route.fulfill({status:409,json:{error:'Fixture refusal'}});});
    const r=await target.boundingBox();
    await page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2);
    await page.mouse.down();
    await page.evaluate(async()=>{ const store=await import('/src/lib/presence-store.ts'); store.removeLiveSectorPlayers(['Shinobi001']); });
    await page.mouse.up();
    expect(attacks).toBe(0);
});

test('a failed roster update is read only and recovery does not reopen a closed panel',async({page})=>{
    await boot(page,1);
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.markSectorRosterUnavailable(22);});
    await expect(page.getByRole('button',{name:'Attack Shinobi001'})).toBeDisabled();
    await expect(page.getByText('Waiting for a current sector roster.')).toBeVisible();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.pushLiveSectorPlayers(store.getLiveSectorPlayers(),22);});
    await expect(page.getByRole('button',{name:'Sector Info'})).toHaveAttribute('aria-expanded','false');
    await expect(page.getByRole('button',{name:'Attack Shinobi001'})).toBeEnabled();
});

test('pending action is exclusive and rejection leaves the sector usable',async({page})=>{
    await boot(page);
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let attacks=0;
    await page.route('**/api/player/attack',async route=>{attacks++;await gate;await route.fulfill({status:409,json:{error:'Fixture: target moved sectors.'}});});
    await page.getByRole('button',{name:'Attack Shinobi001',exact:true}).click();
    await expect(page.getByRole('button',{name:'Attack Shinobi001',exact:true})).toHaveText('Starting…');
    await expect(page.getByRole('button',{name:'Attack Shinobi004',exact:true})).toBeDisabled();
    await page.screenshot({path:`${evidence}/pending.png`});
    release();
    await expect(page.getByText('Fixture: target moved sectors.',{exact:true})).toBeVisible();
    expect(attacks).toBe(1);
    await expect(page.locator('.sector-image-map')).toBeVisible();
});

test('real sector contest routes to its card table, retaining the war context',async({page})=>{
    let normalAttacks=0;
    await boot(page,1,async()=>{
        await page.route('**/api/sector/merc-roam',route=>route.fulfill({json:{mercs:[],contest:{
            id:'fixture-card-war',sector:22,winCondition:'card',attackerVillage:'Stormveil Village',
            defenderVillage:'Ashen Leaf Village',endsAt:Date.now()+3_600_000,garrisonReady:true,
        }}}));
        await page.route('**/api/player/attack',route=>{normalAttacks++;return route.fulfill({status:409,json:{error:'Wrong route'}});});
    });
    await expect(page.getByRole('button',{name:'Contested · Card Battle'})).toBeVisible();
    await page.screenshot({path:`${evidence}/contest.png`});
    await page.getByRole('button',{name:'Card Battle Shinobi001'}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','sectorCard');
    expect(normalAttacks).toBe(0);
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('sectorWarCard.v1')!))).toEqual({sectorWarId:'fixture-card-war'});
});

test('sleepers retain the existing confirmation and Strike Down endpoint',async({page})=>{
    let strikes=0;
    await boot(page,0,async()=>{
        await page.route('**/api/player/roster',route=>route.fulfill({json:{players:[{
            name:'SleepingNinja',level:50,village:'Ashen Leaf Village',currentSector:22,sleeping:true,
            character:{...uiAuditSave().character,name:'SleepingNinja'},
        }]}}));
        await page.route('**/api/player/sleeper-kill',route=>{strikes++;return route.fulfill({status:409,json:{error:'Fixture: sleeper has moved.'}});});
    });
    await page.getByRole('button',{name:'Strike Down SleepingNinja'}).click();
    expect(strikes).toBe(0);
    await expect(page.getByRole('button',{name:'Strike',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Strike',exact:true}).click();
    await expect(page.getByText('Fixture: sleeper has moved.',{exact:true})).toBeVisible();
    expect(strikes).toBe(1);
});

test('sector info, hunt and depleted exploration preserve their callbacks',async({page})=>{
    await page.goto('/e2e/fixtures/sector-hud.html');
    await page.getByRole('button',{name:'Explore',exact:true}).click();
    await page.getByRole('button',{name:'Track Trail Beast'}).click();
    await page.getByRole('button',{name:'Contested · Card Battle'}).click();
    await page.getByRole('button',{name:'Sector Info · Claim ready'}).click();
    await expect(page.getByText('River Guard',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Claim 288 ryo'}).click();
    await page.getByRole('button',{name:'Fight Garrison'}).click();
    await page.getByRole('button',{name:'Raid Controlled Sector'}).click();
    await page.screenshot({path:`${evidence}/details-fixture.png`});
    await page.getByRole('button',{name:'Close Sector Info'}).click();
    await page.evaluate(()=>window.sectorFixture.configure({depleted:true}));
    await page.getByRole('button',{name:'Find richer ground'}).click();
    expect(await page.evaluate(()=>window.sectorFixture.events)).toEqual(['explore','hunt','contest','claim','garrison','raid-sector','richer']);
});

test('scouting, blocked actions, image recovery, fullscreen and authoritative completion',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto('/e2e/fixtures/sector-hud.html');
    await expect(page.getByRole('button',{name:'Explore',exact:true})).toBeVisible();
    await page.evaluate(()=>window.sectorFixture.configure({present:false,contest:false,hunt:false}));
    await expect(page.getByRole('button',{name:'Explore',exact:true})).toBeDisabled();
    await expect(page.locator('.sector-player-row')).toHaveCount(0);
    await page.screenshot({path:`${evidence}/scouting-fixture.png`});
    await page.evaluate(()=>window.sectorFixture.configure({present:true,blocked:true,broken:true}));
    await expect(page.locator('.sector-player-row').first().locator('button')).toBeDisabled();
    await expect(page.locator('.sector-roster-portrait img')).toHaveCount(0);
    await expect(page.locator('.sector-roster-portrait').first()).toHaveText('A ');
    await page.screenshot({path:`${evidence}/blocked-broken-image-fixture.png`});
    await page.evaluate(()=>window.sectorFixture.configure({blocked:false,broken:false,pending:true}));
    await expect(page.locator('.sector-roster-portrait img').first()).toBeVisible();
    await page.locator('.sector-player-row').first().locator('button').click();
    await expect(page.locator('.sector-player-row').first().locator('button')).toHaveText('Starting…');
    await page.evaluate(()=>window.sectorFixture.finish());
    await expect.poll(()=>page.evaluate(()=>window.sectorFixture.events)).toEqual([
        'attack:A Very Long Shinobi Name From the Northern Watch','reconciled:A Very Long Shinobi Name From the Northern Watch']);
    await page.getByRole('button',{name:'Sector Info'}).click();
    await page.evaluate(()=>window.sectorFixture.configure({sector:23}));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'Sector Info'}).click();
    await page.evaluate(()=>window.sectorFixture.configure({suspended:true}));
    await expect(page.locator('.sector-hud')).toHaveCount(0);
    await page.evaluate(()=>window.sectorFixture.configure({suspended:false}));
    await expect(page.getByRole('button',{name:'Sector Info'})).toHaveAttribute('aria-expanded','false');
});

test('bright terrain, enlarged text and keyboard navigation',async({page})=>{
    await page.setViewportSize({width:360,height:800});
    await boot(page,1,undefined,28);
    await page.evaluate(()=>{document.documentElement.style.fontSize='20px';});
    await page.getByRole('button',{name:'Sector Info'}).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button',{name:'Close Sector Info'})).toBeFocused();
    await page.screenshot({path:`${evidence}/snow-enlarged-text.png`});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Sector Info'})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('HUD accessibility',async({page})=>{
    await boot(page);
    expect((await new AxeBuilder({page}).include('.sector-hud').analyze()).violations).toEqual([]);
    await page.getByRole('button',{name:'Sector Info'}).click();
    const results=await new AxeBuilder({page}).include('.sector-hud').analyze();
    expect(results.violations).toEqual([]);
});

test('the existing day and night vista leaves HUD text unchanged',async({page})=>{
    await page.setViewportSize({width:1366,height:768});
    const colors=[];
    for(const hour of [12,21]) {
        await page.addInitScript(value=>{localStorage.setItem('dayCycle.hour',String(value));},hour);
        await page.goto('/e2e/fixtures/sector-hud.html');
        await expect(page.locator('.sector-hud')).toBeVisible();
        await page.evaluate(()=>window.sectorFixture.configure({vista:true,contest:false,hunt:false}));
        await expect(page.locator('.day-night-tint')).toHaveCSS('opacity',hour===12?'0':'0.44');
        colors.push(await page.locator('.sector-hud').evaluate(element=>{
            const style=getComputedStyle(element);return [style.color,style.backgroundColor,style.filter];
        }));
        await page.getByRole('button',{name:'Sector Info'}).click();
        await page.screenshot({path:`${evidence}/vista-${hour===12?'day':'night'}-fixture.png`});
    }
    expect(colors[0]).toEqual(colors[1]);
});

test('ten sector and menu cycles release listeners and renderers',async({page,browserName})=>{
    test.skip(browserName!=='chromium');
    await page.goto('/e2e/fixtures/sector-hud.html');
    const cdp=await page.context().newCDPSession(page);
    const samples=[];
    for(let i=0;i<11;i++) {
        await page.getByRole('button',{name:'Sector Info · Claim ready'}).click();
        await page.getByRole('button',{name:'Close Sector Info'}).click();
        // Let frame-scheduled appends, observer callbacks and passive cleanup
        // finish before counting retained resources, rather than pending work.
        await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
        await cdp.send('HeapProfiler.collectGarbage');
        samples.push({...await cdp.send('Memory.getDOMCounters'),canvas:await page.locator('canvas').count()});
        if(i<10) {
            await page.evaluate(()=>window.sectorFixture.configure({suspended:true}));
            await expect(page.locator('.sector-hud')).toHaveCount(0);
            await page.evaluate(()=>window.sectorFixture.configure({suspended:false}));
        }
    }
    writeFileSync(`${evidence}/resource-cycles.json`,JSON.stringify(samples,null,2));
    expect(samples.at(-1)!.jsEventListeners).toBeLessThanOrEqual(samples[1].jsEventListeners+8);
    expect(samples.at(-1)!.nodes).toBeLessThanOrEqual(samples[1].nodes+100);
    expect(samples.at(-1)!.canvas).toBe(samples[1].canvas);
});

test('nearby roster touch scrolling stays inside its own area',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='chromium-touch');
    await boot(page,100);
    const panel=page.locator('.sector-nearby-scroll');
    await expect(page.getByRole('list', {name:'Sector players'})).toBeVisible();
    const r=await panel.boundingBox();
    const cdp=await page.context().newCDPSession(page);
    const point={x:r!.x+r!.width*.5,y:r!.y+r!.height-16};
    const pageScroll=await page.evaluate(()=>scrollY);
    const original=await page.locator('.sector-player-tile').getAttribute('aria-label');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-i*20}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>panel.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>scrollY)).toBe(pageScroll);
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label',original!);
});

test('sector info touch scrolling stays inside its panel and dismissal does not move',async({page},testInfo)=>{
    test.skip(testInfo.project.name!=='chromium-touch');
    await page.goto('/e2e/fixtures/sector-hud.html');
    await page.getByRole('button',{name:'Sector Info · Claim ready'}).tap();
    const panel=page.locator('.sector-hud-panel-scroll');
    const r=await panel.boundingBox();
    const cdp=await page.context().newCDPSession(page);
    const point={x:r!.x+r!.width*.5,y:r!.y+r!.height-16};
    const pageScroll=await page.evaluate(()=>scrollY);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(let i=1;i<=6;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-i*20}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>panel.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>scrollY)).toBe(pageScroll);
    const tile=page.getByRole('button',{name:'Move to tile row 1 column 2',exact:true});
    await tile.tap();
    await expect(page.getByRole('dialog',{name:'Sector Info',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.sectorFixture.events)).toEqual([]);
    await tile.tap();
    expect(await page.evaluate(()=>window.sectorFixture.events)).toEqual(['tile']);
});

test('a fresh outside touch consumes only the dismissal gesture',async({page},testInfo)=>{
    test.skip(!testInfo.project.use.hasTouch);
    await page.setViewportSize({width:390,height:844});
    await boot(page);
    await page.getByRole('button',{name:'Sector Info'}).tap();
    const original=await page.locator('.sector-player-tile').getAttribute('aria-label');
    const tile=page.getByRole('button',{name:'Move to tile row 1 column 2',exact:true});
    await tile.tap();
    await expect(page.getByRole('dialog',{name:'Sector Info',exact:true})).toHaveCount(0);
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label',original!);
    await tile.tap();
    await expect(page.locator('.sector-player-tile')).toHaveAttribute('aria-label','Current tile row 1 column 2');
});


for (const width of [390,1366]) test(`Spectate opens live fight and chat and returns to sector at ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:768});
    const battleId='sector-spectator-fixture';
    const fighter=(name:string,pos:number)=>({name,pos,hp:500,maxHp:500,chakra:500,maxChakra:500,stamina:500,maxStamina:500,shield:0,statuses:[],character:{name,level:40,village:'Ashen Leaf Village'}});
    const session={battleId,stateRevision:1,p1:fighter('Shinobi002',10),p2:fighter('RivalNinja',30),round:1,activePlayer:'p1',ap:{p1:100,p2:100},actionsThisTurn:0,cooldowns:{p1:{},p2:{}},log:[],status:'active',winner:null,joined:{p1:true,p2:true},createdAt:Date.now()};
    const mutations:string[]=[];
    const chatPosts:{author:string;text:string;role:string}[]=[];
    const chatMessages=[{author:'RivalNinja',text:'Fixture battle chat is live.',ts:Date.now(),role:'fighter'}];
    let rejectChat=true;
    await boot(page,25,async()=>{
        // Exercise the existing live-poll fallback deterministically.
        await page.addInitScript(()=>Object.defineProperty(window,'EventSource',{value:undefined,configurable:true}));
        await page.route('**/api/game-state',route=>{
            if(route.request().method()==='POST') mutations.push('game-state');
            return route.fulfill({json:{villageStates:{},arenaActiveFights:[{id:'fixture',battleId,title:'Shinobi002 vs RivalNinja',fighters:['Shinobi002','RivalNinja'],mode:'PvP',startedAt:Date.now()}]}});
        });
        await page.route('**/api/pvp/session?**',route=>route.fulfill({json:session}));
        await page.route('**/api/pvp/spectate?**',route=>route.fulfill({json:[{name:'AuditNinja',joinedAt:Date.now()}]}));
        await page.route('**/api/player/account-status',route=>route.fulfill({json:{ok:true,account:{name:'AuditNinja',guest:false,google:false,hasPassword:true,socialLocked:false}}}));
        await page.route('**/api/pvp/chat?**',route=>{
            if(route.request().method()==='POST') {
                const body=route.request().postDataJSON() as {author:string;text:string;role:string};
                chatPosts.push(body);
                if(rejectChat) return route.fulfill({status:403,json:{error:'Fixture: message refused.'}});
                chatMessages.push({...body,ts:Date.now()});
            }
            return route.fulfill({json:chatMessages});
        });
        await page.route('**/api/pvp/move',route=>{mutations.push('move');return route.fulfill({json:session});});
        await page.route('**/api/player/attack',route=>{mutations.push('attack');return route.fulfill({status:409,json:{error:'Unexpected attack'}});});
    });
    await page.getByRole('button',{name:'Spectate Shinobi002'}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','pvpBattle');
    await expect(page.getByRole('button',{name:'Stop watching'})).toBeVisible();
    if(await page.getByRole('button',{name:'Show battle chat'}).isVisible()) await page.getByRole('button',{name:'Show battle chat'}).click();
    await expect(page.getByText('Fixture battle chat is live.',{exact:true})).toBeVisible();
    const compose=page.getByPlaceholder('Chat as spectator…');
    await expect(compose).toBeEnabled();
    await compose.fill('Local spectator test message');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText('Fixture: message refused.',{exact:true})).toBeVisible();
    await expect(compose).toHaveValue('Local spectator test message');
    await expect(page.getByText('Local spectator test message',{exact:true})).toHaveCount(0);
    rejectChat=false;
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByText('Local spectator test message',{exact:true})).toBeVisible();
    await expect(compose).toHaveValue('');
    expect(chatPosts).toEqual(Array(2).fill({author:'AuditNinja',text:'Local spectator test message',role:'spectator'}));
    session.stateRevision=2; session.round=2; session.activePlayer='p2';
    await expect(page.getByText("Watching RivalNinja's turn · Round 2",{exact:true})).toBeVisible();
    expect(mutations).toEqual([]);
    await page.screenshot({path:`${evidence}/spectator-${width}.png`});
    if(await page.getByRole('button',{name:'Hide battle chat'}).isVisible()) await page.getByRole('button',{name:'Hide battle chat'}).click();
    await page.getByRole('button',{name:'Stop watching'}).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','worldMap');
    await expect(page.locator('.sector-image-map')).toBeVisible();
    await expect(page.locator('.sector-hud-heading')).toContainText('Moonlit Cove Cliffs');
});

test('unavailable and stale spectator targets stay in the sector without attacking',async({page})=>{
    await boot(page,8);
    const spectate=page.getByRole('button',{name:'Spectate Shinobi002'});
    await spectate.click();
    await expect(page.getByText('This fight is not available to spectate. Try again shortly.')).toBeVisible();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.markSectorRosterUnavailable(22);});
    await expect(spectate).toBeDisabled();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.pushLiveSectorPlayers(store.getLiveSectorPlayers(),22);});
    await expect(spectate).toBeEnabled();
    let attacks=0;
    await page.route('**/api/player/attack',route=>{attacks++;return route.fulfill({status:409,json:{error:'Unexpected attack'}});});
    const r=await spectate.boundingBox();
    await page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2); await page.mouse.down();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.pushLiveSectorPlayers(store.getLiveSectorRoster().map(p=>({...p,inBattle:false})),22);});
    await page.mouse.up();
    expect(attacks).toBe(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','worldMap');
});


test('a late spectator lookup cannot navigate after its target leaves',async({page})=>{
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const fighter=(name:string,pos:number)=>({name,pos,hp:500,maxHp:500,chakra:500,maxChakra:500,stamina:500,maxStamina:500,shield:0,statuses:[],character:{name}});
    const session={battleId:'late-fixture',stateRevision:1,status:'active',p1:fighter('Shinobi002',10),p2:fighter('Rival',30),round:1,activePlayer:'p1',ap:{p1:100,p2:100},actionsThisTurn:0,cooldowns:{p1:{},p2:{}},log:[],winner:null};
    await boot(page,8,async()=>{
        await page.route('**/api/game-state',route=>route.fulfill({json:{arenaActiveFights:[{battleId:'late-fixture',fighters:['Shinobi002','Rival'],startedAt:Date.now()}]}}));
        await page.route('**/api/pvp/session?**',async route=>{await gate;await route.fulfill({json:session});});
    });
    await page.getByRole('button',{name:'Spectate Shinobi002'}).click();
    await expect(page.getByRole('button',{name:'Spectate Shinobi002'})).toHaveText('Opening…');
    await expect(page.getByRole('button',{name:'Attack Shinobi001'})).toBeDisabled();
    await page.evaluate(async()=>{const store=await import('/src/lib/presence-store.ts');store.removeLiveSectorPlayers(['Shinobi002']);});
    release();
    await expect(page.getByText('This player is no longer available to spectate.',{exact:true})).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen','worldMap');
    await expect(page.getByRole('button',{name:'Attack Shinobi001'})).toBeEnabled();
});


test('a hidden sector HUD retires its pending spectator navigation even after reopening',async({page})=>{
    await page.goto('/e2e/fixtures/sector-hud.html');
    await expect(page.locator('.sector-hud')).toBeVisible();
    await page.evaluate(()=>window.sectorFixture.configure({contest:false,hunt:false,fighting:true,pending:true}));
    await page.getByRole('button',{name:'Spectate A Very Long Shinobi Name From the Northern Watch'}).click();
    await expect(page.getByRole('button',{name:'Spectate A Very Long Shinobi Name From the Northern Watch'})).toHaveText('Opening…');
    await page.evaluate(()=>window.sectorFixture.configure({suspended:true}));
    await expect(page.locator('.sector-hud')).toHaveCount(0);
    await page.evaluate(()=>window.sectorFixture.configure({suspended:false}));
    await expect(page.locator('.sector-hud')).toBeVisible();
    await page.evaluate(()=>window.sectorFixture.finish());
    await expect.poll(()=>page.evaluate(()=>window.sectorFixture.events.at(-1))).toBe('spectator-cancelled');
});


test('a sleeper waking during a click never changes Strike Down into Attack',async({page})=>{
    await page.goto('/e2e/fixtures/sector-hud.html');
    await expect(page.locator('.sector-hud')).toBeVisible();
    await page.evaluate(()=>window.sectorFixture.configure({contest:false,hunt:false}));
    const strike=page.getByRole('button',{name:'Strike Down SleepingNinja'});
    await strike.scrollIntoViewIfNeeded();
    const r=await strike.boundingBox();
    await page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2);
    await page.mouse.down();
    await page.evaluate(()=>window.sectorFixture.configure({awake:true}));
    await expect(page.getByRole('button',{name:'Attack SleepingNinja'})).toBeVisible();
    await page.mouse.up();
    expect(await page.evaluate(()=>window.sectorFixture.events)).toEqual([]);
    await page.getByRole('button',{name:'Attack SleepingNinja'}).click();
    expect(await page.evaluate(()=>window.sectorFixture.events)).toEqual(['attack:SleepingNinja','reconciled:SleepingNinja']);
});
