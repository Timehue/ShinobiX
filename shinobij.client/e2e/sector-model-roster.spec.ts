import {test,expect,type Page} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {lifeSceneView,lifeWanderer,parseLifeState,type LifeActor} from '../../shared/sector-life';
import {worldPositionModel} from '../../shared/continuous-world-layout';
import catalog from '../../shared/cinderhold-world-models.json';
import {cinderholdWorldModel} from '../../shared/cinderhold-world-models';
import {MemoryOnlineStateStore} from '../../api/_realtime/online-store';
import {toPlayerRecord} from '../../api/_realtime/presence-input';
import {expectUiAuditBoot,installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {quietRoadCooldowns} from '../e2e-live/helpers/quiet-road';
import {previewRootFor,smokeE2ePort} from '../e2e-ports';

// Exercise every completed appearance in the immutable build. Scripted residents
// qualify portrait delivery and movement, separately from encounters or combat.
const content=resolve(process.env.SECTOR_MODEL_TEST_CONTENT??'../.ci-evidence/sector-models');
// Discovery can run before the preview is created. Workers must inspect the
// same immutable build the preview serves, even if dist is rebuilt meanwhile.
const buildRoot=process.env.TEST_WORKER_INDEX === undefined ? 'dist' : previewRootFor(smokeE2ePort());
const assets=resolve(buildRoot,'assets');
const registries=readdirSync(assets).filter(file=>/^sector-model-pins-.+\.json$/.test(file));
assert.equal(registries.length,1,'Build one unambiguous model registry before this test');
const built=new Map<string,string>(JSON.parse(readFileSync(resolve(assets,registries[0]!),'utf8')));
const manifest:Record<string,{file:string}>=JSON.parse(readFileSync(resolve(buildRoot,'.vite/manifest.json'),'utf8'));
const inventory:{rows:{group:string;id:string;sourceSha256:string}[]}=JSON.parse(readFileSync(resolve('../.ci-evidence/bundled-model-sources.json'),'utf8'));
const expectedNpcPortraits=new Set(inventory.rows.filter(row=>row.group!=='starter').map(row=>row.sourceSha256));
const candidates:{slug:string;revision:string;portrait:string;portraitSha256:string}[]=[];
const unbuilt:string[]=[];
for(const filename of readdirSync(resolve('src/data/sector-models')).sort()){
    if(!filename.endsWith('.json')||filename.startsWith('starter-'))continue;
    const slug=filename.slice(0,-5);
    const pin:{portrait:string;portraitSha256:string;manifestSha256:string}=JSON.parse(readFileSync(resolve('src/data/sector-models',filename),'utf8'));
    const bytes=readFileSync(resolve(content,slug,pin.manifestSha256+'.json'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.manifestSha256);
    const model=JSON.parse(bytes.toString());
    if(model.format!=='sector-motion-v2')continue;
    if(built.get(slug)!==pin.manifestSha256){unbuilt.push(slug);continue;}
    assert.ok(expectedNpcPortraits.has(pin.portraitSha256),'A model must belong to the canonical NPC inventory');
    const portrait=pin.portrait.startsWith('public/')?'/'+pin.portrait.slice(7):'/'+manifest[pin.portrait]?.file;
    assert.ok(!portrait.includes('undefined')&&existsSync(resolve(buildRoot,portrait.slice(1))),slug+' portrait is absent from the build');
    candidates.push({slug,revision:pin.manifestSha256,portrait,portraitSha256:pin.portraitSha256});
}
assert.ok(candidates.length,'Mount completed NPC movement packages before this test');
assert.equal(new Set(candidates.map(row=>row.portraitSha256)).size,candidates.length,'Test each canonical appearance once');
const coveredPortraits=new Set(candidates.map(row=>row.portraitSha256));
const notInBuild=inventory.rows.filter(row=>row.group!=='starter'&&!coveredPortraits.has(row.sourceSha256));
if(process.env.SECTOR_MODEL_REQUIRE_COMPLETE_ROSTER==='1'){
    assert.deepEqual(new Set(candidates.map(row=>row.portraitSha256)),expectedNpcPortraits,'Final qualification requires the complete NPC inventory in this exact build');
    assert.deepEqual(unbuilt,[],'Rebuild after the last NPC pin changes');
}
let server:Server|undefined,artBase='';
const network=new WeakMap<Page,{at:number;path:string;status?:number;failure?:string}[]>();
test.use({contextOptions:{reducedMotion:'no-preference'}});
test.beforeEach(({page})=>{
    const events:{at:number;path:string;status?:number;failure?:string}[]=[];
    network.set(page,events);
    const relevant=(url:string)=>/\/sector-models\/|\/api\/(?:world\/sector-layout|player\/world-move)|sector-pose\.worker/.test(url);
    page.on('response',response=>{
        if(relevant(response.url()))events.push({at:Date.now(),path:new URL(response.url()).pathname,status:response.status()});
    });
    page.on('requestfailed',request=>{
        if(relevant(request.url()))events.push({at:Date.now(),path:new URL(request.url()).pathname,failure:request.failure()?.errorText});
    });
});
test.beforeAll(async()=>{
    const allowed=new Set([...candidates.map(row=>row.slug), 'starter-one', 'starter-two']);
    server=createServer(async(req,res)=>{
        const match=req.url?.match(/^\/sector-models\/([a-z0-9-]+|players\/[a-f0-9]{32})\/([a-f0-9]{64}\.(json|gz|264))$/);
        if(!match||!(allowed.has(match[1]!)||catalog.some(npc=>match[1]==='players/'+npc.assetId))){res.writeHead(404).end();return;}
        try{
            const bytes=await readFile(resolve(content,match[1]!,match[2]!));
            res.writeHead(200,{'Content-Type':match[3]==='json'?'application/json':'application/octet-stream',
                'Content-Length':bytes.length,'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=31536000, immutable'}).end(bytes);
        }catch{res.writeHead(404).end();}
    });
    await new Promise<void>((ok,bad)=>server!.once('error',bad).listen(0,'127.0.0.1',ok));
    const address=server.address();assert.ok(address&&typeof address!=='string');
    artBase='http://127.0.0.1:'+address.port+'/sector-models';
});
for(let start=0; start<catalog.length; start+=6){
    const npcs=catalog.slice(start,start+6);
    test('Cinderhold presence models '+npcs.map(npc=>npc.id).join(', '),async({page},info)=>{
        test.skip(process.env.SECTOR_MODEL_CINDERHOLD_QA!=='1','Requires the staged Cinderhold public object pack');
        test.setTimeout(75_000);
        const sector=46, world=worldPositionModel(), tile=66;
        const store=new MemoryOnlineStateStore();
        const npcTiles=[49,50,51,52,73,74];
        for(const [i,npc] of npcs.entries()){
            const ref=cinderholdWorldModel(npc.id,npc.avatar);
            assert.ok(ref);
            store.upsert({name:npc.id,sector,tile:npcTiles[i],character:{level:10},
                serverPlayerModel:ref});
        }
        const own=start===0?'starter-two':'starter-one';
        const other=own==='starter-two'?'starter-one':'starter-two';
        store.upsert({name:'Starter Observer',sector,tile:76,character:{level:10},restoredStarterWorldModel:other});
        // Hold the observer's art until the local starter is drawn. This
        // catches a swapped binding even when both revisions are requested.
        let releaseObserverArt!: () => void;
        const observerArtReady = new Promise<void>(done => { releaseObserverArt = done; });
        await page.route(`${artBase}/${other}/${built.get(other)}.json`, async route => {
            await observerArtReady;
            await route.continue();
        });
        const names=[...npcs.map(npc=>npc.id),'Starter Observer'];
        const save=uiAuditSave();
        save.currentSector=sector; save.currentTile=tile;
        save.character={...save.character,starterCardsClaimed:true,starterWorldModel:own,
            avatarImage:'/api/img?id=avatar:auditninja',wandererCooldowns:quietRoadCooldowns([sector])};
        const runtime=await installUiAuditRuntime(page,save);
        await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]'));
        await page.route('**/api/world/sector-layout',route=>route.fulfill({json:{
            obstaclesEnabled:true,playerGaitsEnabled:true,modelArtBase:artBase,
        }}));
        await page.route('**/api/player/world-move**',route=>route.request().method()!=='GET'?route.fallback():
            route.fulfill({json:{ok:true,sector,tile,sequence:0,worldPosition:world.fallback(sector,tile),
                players:names.map(name=>toPlayerRecord(store.get(name)!))}}));
        const requested=new Set<string>();
        page.on('response',response=>{if(response.ok())requested.add(new URL(response.url()).pathname);});
        const back=page.getByRole('button',{name:/Return to Sector 46/});
        const map=page.locator('.continuous-world-map');
        const observer = page.locator('.continuous-world-peer').filter({
            has: page.getByText('Starter Observer', {exact: true}),
        });
        try {
            await expectUiAuditBoot(page,runtime,'worldMap');
            await expect(back.or(map).first()).toBeVisible({timeout:30_000});
            if(await back.isVisible())await back.click();
            await expect(map).toHaveAttribute('aria-busy','false',{timeout:30_000});
            await expect(page.locator('[data-world-self]')).toHaveClass(/has-sector-model/, {timeout: 30_000});
            await expect(observer).toBeAttached();
            await expect(observer).not.toHaveClass(/has-sector-model/);
        } finally {
            releaseObserverArt();
        }
        const markers=npcs.map(npc=>page.locator('.continuous-world-peer').filter({
            has:page.getByText(npc.id,{exact:true}),
        }));
        await Promise.all(markers.map(marker=>expect(marker).toHaveClass(/has-sector-model/,{timeout:30_000})));
        await expect(observer).toHaveClass(/has-sector-model/, {timeout: 30_000});
        for(const npc of npcs)assert.ok(requested.has('/sector-models/players/'+npc.assetId+'/'+npc.version+'.json'),npc.id);
        for(const starter of [own,other])assert.ok(requested.has('/sector-models/'+starter+'/'+built.get(starter)+'.json'),starter);
        const before=await Promise.all(markers.map(marker=>marker.getAttribute('style')));
        // Observe each clip from before the move. One NPC may finish a step
        // while another is still waiting for its first painted facing.
        const painted = await page.evaluateHandle(ids => {
            const names = new Set(ids);
            const walking = new Set<string>();
            const observer = new MutationObserver(records => {
                for (const record of records) {
                    const figure = record.target as HTMLElement;
                    if (record.oldValue !== 'walk' && figure.dataset.clip !== 'walk') continue;
                    const name = figure.parentElement?.querySelector('.sector-peer-label')?.textContent ?? '';
                    if (names.has(name)) walking.add(name);
                }
            });
            observer.observe(document.querySelector('.continuous-world-peers')!, {
                subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-clip'],
            });
            return {walking, observer};
        }, npcs.map(npc => npc.id));
        for(const npc of npcs){
            const current=store.get(npc.id)!.tile!;
            const next=[current+1,current-1,current+12,current-12].find(target=>
                target>=0&&target<144&&world.fallback(sector,target)?.from!==world.fallback(sector,current)?.from
                && store.moveToTile(npc.id,target)!==null);
            assert.notEqual(next,undefined,npc.id+' has a walkable adjacent tile');
        }
        await Promise.all(markers.map((marker,i)=>expect.poll(()=>marker.getAttribute('style'),{timeout:12_000}).not.toBe(before[i])));
        await expect.poll(() => painted.evaluate(result => [...result.walking].sort()), {timeout: 12_000})
            .toEqual(npcs.map(npc => npc.id).sort());
        await painted.evaluate(result => result.observer.disconnect());
        await painted.dispose();
        await page.screenshot({path:info.outputPath('cinderhold-moving.png')});
        await Promise.all(markers.map(marker=>expect(marker.locator('.sector-model-figure'))
            .toHaveAttribute('data-clip','idle',{timeout:15_000})));
    });
}
test.afterAll(async()=>{
    if(!server)return;server.closeAllConnections();
    await new Promise<void>(ok=>server!.close(()=>ok()));
});
test.afterEach(async({browserName,page},info)=>{
    const path=info.outputPath('roster-coverage.json');
    const coverage=existsSync(path)?JSON.parse(await readFile(path,'utf8')):{scope:'Setup failed before roster checks'};
    const presentation=await page.evaluate(()=>({
        hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
        screen:document.querySelector('.app-shell')?.getAttribute('data-screen'),
        status:document.querySelector('.continuous-world-status')?.textContent,
        ready:document.querySelector('.continuous-world-map')?.getAttribute('aria-busy'),
        regionalMapVisible:!!document.querySelector('[role="group"][aria-label="World map"]'),
        residents:[...document.querySelectorAll<HTMLElement>('[data-life-resident^="roster-"]')].map(actor=>({
            id:actor.dataset.lifeResident,classes:actor.className,
            model:{...actor.querySelector<HTMLElement>('.sector-model-figure')?.dataset},
        })),
    })).catch(error=>({unavailable:String(error)}));
    await writeFile(info.outputPath('roster-case-result.json'),JSON.stringify({
        ...coverage,engine:browserName,outcome:info.status,expectedOutcome:info.expectedStatus,
        presentation,network:network.get(page)??[],
        errors:info.errors.map(error=>error.message?.slice(0,1000)),
    },null,2));
});
for(let start=0;start<candidates.length;start+=3){
    const batch=candidates.slice(start,start+3);
    test('completed NPC roster '+batch.map(row=>row.slug).join(', '),async({page},info)=>{
        test.setTimeout(90_000);
        const coveragePath=info.outputPath('roster-coverage.json');
        await writeFile(coveragePath,JSON.stringify({
            scope:'Scripted residents: exact portrait binding, decoded appearance and idle/walk game clocks; not encounter or combat qualification.',
            registry:registries[0],appearances:batch,unbuilt,notInBuild,
            expectedUniqueNpcAppearances:expectedNpcPortraits.size,builtCandidates:candidates.length,
            completeInventoryRequired:process.env.SECTOR_MODEL_REQUIRE_COMPLETE_ROSTER==='1',
        },null,2));
        await info.attach('roster-coverage.json',{path:coveragePath,contentType:'application/json'});
        const save=uiAuditSave();save.currentSector=46;save.currentTile=70;
        save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([46])};
        const runtime=await installUiAuditRuntime(page,save);
        await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]'));
        await page.route('**/api/world/sector-layout',route=>route.fulfill({json:{obstaclesEnabled:true,modelArtBase:artBase}}));
        await page.route('**/api/sector/life**',route=>{
            const now=Date.now(),scene=lifeSceneView(46,parseLifeState(null,now),now,'clear');
            const actors=batch.map((row,index)=>{
                const tile=65+index;
                const actor:LifeActor={id:'roster-'+row.slug,name:row.slug.replaceAll('-',' '),art:'guard',
                    tile,restTile:tile,workTile:tile-1,activity:row.slug==='bell-wraith'?'Resting':'Walking',line:'The road is clear.',
                    motion:{start:now,repeat:13000,frames:row.slug==='bell-wraith'?[[0,tile],[13000,tile]]:
                        [[0,tile],[6000,tile-1],[12000,tile],[13000,tile]]}};
                return {...actor,wanderer:{...lifeWanderer(46,actor),avatarKey:'merchant',avatarImage:row.portrait}};
            });
            return route.fulfill({json:{ok:true,serverNow:now,view:{...scene,actors}}});
        });
        const errors:string[]=[],received=new Set<string>();
        page.on('pageerror',error=>errors.push(error.message));
        page.on('response',response=>{if(response.ok())received.add(response.url());});
        await expectUiAuditBoot(page,runtime,'worldMap');
        expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
        const back=page.getByRole('button',{name:/Return to Sector 46/});
        await expect.poll(async()=>await back.isVisible()||await page.locator('.continuous-world-map').isVisible(),{timeout:30_000}).toBe(true);
        if(await back.isVisible()){
            try{await back.click({timeout:15_000});}
            catch(error){
                if(await back.isVisible()||!await page.locator('.continuous-world-map > canvas').isVisible())throw error;
            }
        }
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy','false',{timeout:30_000});
        await Promise.all(batch.map(row=>expect(page.locator('[data-life-resident="roster-'+row.slug+'"]')).toHaveClass(/has-sector-model/,{timeout:25_000})));
        await Promise.all(batch.map(row=>expect(page.locator('[data-life-resident="roster-'+row.slug+'"] .sector-model-figure'),
            row.slug+' must enter its authored gait before recording').toHaveAttribute('data-gait',row.slug==='bell-wraith'?'idle':'walk')));
        const samples=await page.evaluate(async()=>{
            const samples=[];
            for(let index=0;index<60;index++){
                samples.push({at:Date.now(),hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
                    covered:!!document.querySelector('body > .combat-instance'),
                    actors:[...document.querySelectorAll<HTMLElement>('[data-life-resident^="roster-"]')].map(actor=>({
                        id:actor.dataset.lifeResident,transform:actor.style.transform,walking:actor.classList.contains('is-walking'),
                        modelVisible:actor.classList.contains('has-sector-model'),
                        model:{...actor.querySelector<HTMLElement>('.sector-model-figure')?.dataset},
                    }))});
                await new Promise(ok=>setTimeout(ok,100));
            }
            return samples;
        });
        const samplesPath=info.outputPath('motion-samples.json');
        await writeFile(samplesPath,JSON.stringify(samples));
        await info.attach('motion-samples.json',{path:samplesPath,contentType:'application/json'});
        await Promise.all(batch.map(async row=>{
            const actor=page.locator('[data-life-resident="roster-'+row.slug+'"]');
            await expect(actor).toHaveClass(/has-sector-model/,{timeout:25_000});
            const figure=actor.locator('.sector-model-figure');
            await expect(figure).toBeVisible();
            await expect(figure,row.slug+' must use its live gait').toHaveAttribute('data-gait',row.slug==='bell-wraith'?'idle':'walk');
            const frame=await figure.getAttribute('data-frame');
            await expect.poll(()=>figure.getAttribute('data-frame'),{message:row.slug+' must advance its visible poses'}).not.toBe(frame);
            const observed=samples.flatMap(sample=>sample.actors.filter(actor=>actor.id==='roster-'+row.slug));
            const gait=row.slug==='bell-wraith'?'idle':'walk';
            const poses=new Set(observed.filter(actor=>actor.modelVisible&&actor.model.gait===gait).map(actor=>actor.model.frame));
            expect(poses.size,row.slug+' must show multiple authored poses inside the recorded interval').toBeGreaterThanOrEqual(3);
            if(row.slug!=='bell-wraith')expect(new Set(observed.map(actor=>actor.transform)).size,
                row.slug+' must travel while its poses animate').toBeGreaterThanOrEqual(3);
            expect(received.has(artBase+'/'+row.slug+'/'+row.revision+'.json')).toBe(true);
        }));
        await page.screenshot({path:info.outputPath('roster-in-sector.png')});
        expect(errors).toEqual([]);
    });
}

test('sprite worker output preserves pose sheet pixels on either encoding path', async ({browserName, page}, info) => {
    const folder = resolve(content, 'starter-one');
    const revision = built.get('starter-one');
    assert.ok(revision);
    const manifest = JSON.parse(await readFile(resolve(folder, revision + '.json'), 'utf8'));
    const bank = JSON.parse(gunzipSync(await readFile(resolve(folder, manifest.styles.A[0]))).toString());
    const spec = bank.pages[bank.clips['pivot-2'].file];
    const worker = readdirSync(assets).find(file => /^sector-pose\.worker-.+\.js$/.test(file));
    assert.ok(worker);
    await page.route('**/sprite-decoder-review', route => route.fulfill({contentType: 'text/html', body: '<!doctype html>'}));
    await page.route('**/sprite-decoder-review-sheet', route =>
        route.fulfill({contentType: 'application/octet-stream', path: resolve(folder, spec.file)}));
    await page.goto('/sprite-decoder-review');
    const compare = await page.evaluate(async ({spec, worker}) => {
        const response = await fetch('/sprite-decoder-review-sheet');
        if (!response.ok) throw new Error('Sprite decoder fixture returned ' + response.status);
        const bytes = await response.arrayBuffer();
        const decoder = new Worker('/assets/' + worker, {type: 'module'});
        type RawSheet = {width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer>};
        const decode = (encodePng: boolean) => new Promise<RawSheet | {blob: Blob} | {error: string}>(resolve => {
            decoder.onmessage = ({data}) => resolve(data);
            decoder.onerror = event => resolve({error: event.message});
            decoder.postMessage({...spec, bytes, encodePng});
        });
        try {
            const raw = await decode(false);
            if (!('pixels' in raw)) throw new Error('Raw pose decoder: ' + ('error' in raw ? raw.error : 'unexpected PNG'));
            const encodedSheet = await decode(true);
            if ('error' in encodedSheet) throw new Error('PNG pose decoder: ' + encodedSheet.error);
            const makeCanvas = () => {
                const canvas = document.createElement('canvas');
                canvas.width = raw.width;
                canvas.height = raw.height;
                return canvas.getContext('2d')!;
            };
            const fallback = makeCanvas();
            fallback.putImageData(new ImageData(raw.pixels, raw.width, raw.height), 0, 0);
            const original = fallback.getImageData(0, 0, raw.width, raw.height).data;
            const encoded = makeCanvas();
            let dimensions: number[];
            const type = 'blob' in encodedSheet ? encodedSheet.blob.type : 'raw';
            if ('blob' in encodedSheet) {
                const objectUrl = URL.createObjectURL(encodedSheet.blob);
                const image = new Image();
                try {
                    image.src = objectUrl;
                    await image.decode();
                    encoded.drawImage(image, 0, 0);
                    dimensions = [image.naturalWidth, image.naturalHeight];
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            } else {
                const {pixels, width, height} = encodedSheet;
                encoded.putImageData(new ImageData(pixels, width, height), 0, 0);
                dimensions = [width, height];
            }
            const actual = encoded.getImageData(0, 0, raw.width, raw.height).data;
            let opaquePixels = 0, alphaMismatch = 0, opaqueMismatch = 0;
            for (let i = 0; i < actual.length; i += 4) {
                if (actual[i + 3] !== original[i + 3]) alphaMismatch++;
                if (original[i + 3] !== 255) continue;
                opaquePixels++;
                if (actual[i] !== original[i] || actual[i + 1] !== original[i + 1] || actual[i + 2] !== original[i + 2]) opaqueMismatch++;
            }
            return {type, dimensions, opaquePixels, alphaMismatch, opaqueMismatch};
        } finally {
            decoder.terminate();
        }
    }, {spec, worker});
    await info.attach('pose-sheet-pixel-parity', {body: JSON.stringify(compare), contentType: 'application/json'});
    expect(compare.type).toMatch(browserName === 'webkit' ? /^(image\/png|raw)$/ : /^image\/png$/);
    expect(compare.dimensions).toEqual([spec.cols * spec.cell[0], Math.ceil(spec.frames / spec.cols) * spec.cell[1]]);
    expect(compare.opaquePixels).toBeGreaterThan(100);
    expect(compare.alphaMismatch).toBe(0);
    expect(compare.opaqueMismatch).toBe(0);
});

test('crowded sector preserves mobile frame pacing and touch walk response', async ({page}, info) => {
    test.skip(process.env.SECTOR_MODEL_CROWD_QA !== '1' ||
        !['chromium-mobile', 'webkit-mobile'].includes(info.project.name), 'Run the local phone benchmark on its two target engines');
    test.setTimeout(180_000);
    const crowd = ['ember-fox', 'underground-bandit', 'underground-night-ninja', 'patrol', 'medic', 'merchant']
        .map(slug => {
            const candidate = candidates.find(row => row.slug === slug);
            assert.ok(candidate, 'Crowd benchmark requires the current ' + slug + ' pin');
            return candidate;
        });
    const sector = 46;
    const world = worldPositionModel();
    const starterFolder = resolve(content, 'starter-one');
    const starterRevision = built.get('starter-one');
    assert.ok(starterRevision);
    const starter = JSON.parse(await readFile(resolve(starterFolder, starterRevision + '.json'), 'utf8'));
    const east = JSON.parse(gunzipSync(await readFile(resolve(starterFolder, starter.styles.A[2]))).toString());
    const eastStart = east.pages[east.clips['start-walk'].file].file as string;
    const startRequests: number[] = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/starter-one/' + eastStart)) startRequests.push(Date.now());
    });
    const save = uiAuditSave();
    save.currentSector = sector;
    save.currentTile = 66;
    save.character = { ...save.character, avatarImage: '/starter-avatar-one.webp?v=2',
        starterCardsClaimed: true, wandererCooldowns: quietRoadCooldowns([sector]) };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem('legacyRumors.seen.v1:auditninja', '[10,20,30,40,45]');
    });
    let modelArt = false;
    await page.route('**/api/world/sector-layout', route => route.fulfill({json: {
        obstaclesEnabled: true, playerGaitsEnabled: true, modelArtBase: modelArt ? artBase : null,
    }}));
    const peerTiles = [49, 50, 51, 52, 73, 74, 75, 76];
    const peers = peerTiles.map((tile, index) => ({
        name: 'Crowd Scout ' + (index + 1), level: 5, currentSector: sector, tile,
        worldPosition: world.fallback(sector, tile), movementSequence: 0,
        character: { avatarImage: `/starter-avatar-${index % 2 ? 'one' : 'two'}.webp?v=2` },
    }));
    await page.route('**/api/player/world-move**', route => route.request().method() !== 'GET' ? route.fallback() :
        route.fulfill({json: {ok: true, sector, tile: 66, sequence: 0, worldPosition: world.fallback(sector, 66), players: peers}}));
    await page.route('**/api/sector/life**', route => {
        const now = Date.now();
        const scene = lifeSceneView(sector, parseLifeState(null, now), now, 'clear');
        const actors = crowd.map((row, index) => {
            const tile = [54, 55, 56, 78, 79, 80][index];
            const actor: LifeActor = {
                id: 'roster-' + row.slug, name: row.slug.replaceAll('-', ' '), art: 'guard',
                tile, restTile: tile, workTile: tile - 1, activity: 'Walking', line: 'The road is clear.',
                motion: {start: now, repeat: 16000, frames: [[0,tile],[7000,tile-1],[14000,tile],[16000,tile]]},
            };
            return {...actor, wanderer: {...lifeWanderer(sector, actor), avatarKey: 'merchant', avatarImage: row.portrait}};
        });
        return route.fulfill({json: {ok: true, serverNow: now, view: {...scene, actors}}});
    });

    async function measure(enabled: boolean) {
        modelArt = enabled;
        runtime.placeOnWorldTile(sector, 66);
        await page.goto('about:blank');
        await expectUiAuditBoot(page, runtime, 'worldMap');
        const map = page.locator('.continuous-world-map');
        const back = page.getByRole('button', {name: /Return to Sector 46/});
        await expect(back.or(map).first()).toBeVisible({timeout: 30_000});
        if (await back.isVisible()) await back.click();
        await expect(map).toHaveAttribute('aria-busy', 'false', {timeout: 30_000});
        await expect(page.locator('[data-life-resident^="roster-"]')).toHaveCount(crowd.length);
        await expect(page.locator('.continuous-world-peer')).toHaveCount(peers.length);
        await expect(page.locator('[data-life-resident^="roster-"].has-sector-model')).toHaveCount(enabled ? crowd.length : 0, {timeout: 30_000});
        await expect(page.locator('.continuous-world-peer.has-sector-model')).toHaveCount(enabled ? peers.length : 0, {timeout: 30_000});
        if (enabled) {
            await expect(page.locator('[data-world-self].has-sector-model .sector-model-figure'))
                .toHaveAttribute('data-clip', 'idle');
        }
        const run = page.getByRole('button', {name: 'Run', exact: true});
        if (await run.getAttribute('aria-pressed') === 'true') await run.tap();
        // The standing actor warms its first walking pose for each road. Tap once it has.
        if (enabled) await expect.poll(() => startRequests.length, {timeout: 15_000}).toBeGreaterThan(0);
        const canvas = map.locator(':scope > canvas');
        await canvas.scrollIntoViewIfNeeded();
        const point = await canvas.evaluate(el => {
            const rect = el.getBoundingClientRect();
            const tile = rect.width / 12;
            const y = rect.top + rect.height / 2;
            for (const east of [3.5, 4, 3, 4.5, 2.5]) {
                const x = rect.left + rect.width / 2 + east * tile;
                for (const offset of [0, -0.2, 0.2]) {
                    const py = y + tile * offset;
                    if (document.elementFromPoint(x, py) === el) return {x, y: py, east, offset};
                }
            }
            throw new Error('Crowd fixture obscures the touch walking route');
        });
        await canvas.evaluate(el => {
            const start = Number(el.getAttribute('data-world-x'));
            const intervals: number[] = [];
            let pressedAt: number | undefined;
            let firstMovement: number | undefined;
            let firstResponse: number | undefined;
            let firstClip: string | undefined;
            let last = 0;
            el.addEventListener('pointerup', () => { pressedAt = performance.now(); }, {once: true});
            function sample(now: number) {
                if (pressedAt !== undefined) {
                    if (last) intervals.push(now - last);
                    last = now;
                    if (firstMovement === undefined && Math.abs(Number(el.getAttribute('data-world-x')) - start) >= 0.01) {
                        firstMovement = now - pressedAt;
                    }
                    const figure = document.querySelector('[data-world-self] .sector-model-figure');
                    const clip = figure?.getAttribute('data-clip') ?? '';
                    if (firstResponse === undefined && (firstMovement !== undefined || /^(pivot|start-)/.test(clip))) {
                        firstResponse = now - pressedAt;
                        firstClip = clip;
                    }
                    if (now - pressedAt >= 4500) {
                        el.setAttribute('data-crowd-measurement', JSON.stringify({intervals, firstMovement, firstResponse, firstClip,
                            distance: Number(el.getAttribute('data-world-x')) - start}));
                        return;
                    }
                }
                requestAnimationFrame(sample);
            }
            requestAnimationFrame(sample);
        });
        await page.touchscreen.tap(point.x, point.y);
        await expect(canvas).toHaveAttribute('data-crowd-measurement', /"intervals"/, {timeout: 15_000});
        const samples = JSON.parse((await canvas.getAttribute('data-crowd-measurement'))!) as {
            intervals: number[]; firstMovement?: number; firstResponse?: number; firstClip?: string; distance: number;
        };
        const sorted = [...samples.intervals].sort((a,b) => a-b);
        await page.screenshot({path: info.outputPath(enabled ? 'crowd-models.png' : 'crowd-baseline.png')});
        return {...samples, east: point.east, offset: point.offset, p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
    }

    const baseline = await measure(false);
    const fitted = await measure(true);
    await info.attach('crowd-frame-and-input-timing', {contentType: 'application/json',
        body: JSON.stringify({baseline, fitted, residents: crowd.map(row => row.slug), peers: peers.length, startRequests})});
    for (const sample of [baseline, fitted]) {
        expect(sample.intervals.length).toBeGreaterThanOrEqual(50);
        expect(sample.firstResponse, 'Touch input must produce visible feedback').toBeDefined();
        expect(sample.firstMovement, 'Touch input must start local travel').toBeDefined();
        expect(sample.distance, 'Player must move down the east road').toBeGreaterThan(0.5);
    }
    expect([fitted.east, fitted.offset], 'Both profiles must sample the same touch destination')
        .toEqual([baseline.east, baseline.offset]);
    expect(fitted.firstClip, 'The fitted avatar must step off without a planted turn').toBe('start-walk');
    expect(startRequests, 'The warmed east start page must serve the initial tap without a second fetch').toHaveLength(1);
    expect(fitted.firstMovement!, 'Touch-to-travel delay').toBeLessThanOrEqual(baseline.firstMovement! + 250);
    expect(fitted.p95, '95th percentile frame interval').toBeLessThanOrEqual(Math.max(baseline.p95 * 1.25, baseline.p95 + 6));
    expect(fitted.firstResponse!, 'Touch-to-visible-response delay').toBeLessThanOrEqual(baseline.firstResponse! + 50);
});
