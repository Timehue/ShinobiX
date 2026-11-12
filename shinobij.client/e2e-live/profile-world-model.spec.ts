import { expect, type APIRequestContext, type BrowserContext, type Page, type Route } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

const modelQaPassword = 'LocalModelQA123!';

async function loginModelAccount(request: APIRequestContext, context: BrowserContext | null, name: string, supporter: boolean, plazaTile?: number, seeded = false) {
    const response = await request.post('/api/player-auth', { data: { action: seeded ? 'verify' : 'register', name, password: modelQaPassword } });
    expect(response.status(), await response.text()).toBe(200);
    const { token } = await response.json();
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave();
    // Both QA players need a walkable continuous-world position for peer projection.
    save.worldGeoV = 2;
    save.currentSector = plazaTile === undefined ? 9 : 46;
    save.currentTile = plazaTile ?? 102;
    save.character = { ...save.character, name, patreon: supporter ? { active: true, tier: 'Shinobi Supporter' } : null,
        starterCardsClaimed: true, equippedJutsuIds: [], ...(plazaTile !== undefined && {wandererCooldowns:quietRoadCooldowns([46])}) };
    const url = '/api/save/' + name;
    expect((await request.post(url + '?signal=1', { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save })).status()).toBe(200);
    expect((await request.post(url + '?ack=1', { headers })).status()).toBe(200);
    const canonical = await (await request.get(url, { headers })).json();
    if (context) await installModelSession(context, name, token, canonical);
    return { headers, url, sector: canonical.currentSector, tile: canonical.currentTile };
}

async function installModelSession(context: BrowserContext, name: string, token: string, canonical: unknown) {
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        if (!localStorage.getItem('ninjav-save-preview-v1:' + name))
            localStorage.setItem('ninjav-save-preview-v1:' + name, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, '[10,20,30,40,45]');
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE?.version ?? '' });
}

const equipTest = test.extend<{ watching: Page }>({
    watching: async ({ browser, baseURL }, runCase) => {
        const observer = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
            isMobile: true, hasTouch: true, serviceWorkers: 'block' });
        try { await runCase(await observer.newPage()); }
        finally { await observer.close(); }
    },
});

equipTest('a signed-in player equips a completed monthly model from Profile', async ({ page, context, request, watching }, info) => {
    test.skip(!process.env.SECTOR_MODEL_LIVE_RECEIPT || info.project.name !== 'chromium-desktop-live', 'Run once per disposable model account.');
    const ref = JSON.parse(await readFile(process.env.SECTOR_MODEL_LIVE_RECEIPT!, 'utf8'));
    const sharedArt = resolve(process.env.SECTOR_MODEL_TEST_CONTENT ?? '../.ci-evidence/sector-models');
    const playerArt = resolve(process.env.SECTOR_MODEL_TEST_PLAYER_CONTENT ?? sharedArt);
    const localNpcSlugs=new Set((await readdir(resolve('src/data/sector-models'))).filter(file=>file.endsWith('.json')).map(file=>file.slice(0,-5)));
    // Serve all pinned residents as well as player art; real roadside actors must
    // not silently fall back because the account fixture refused their files.
    const serveArt = async (route: Route) => {
        const file = new URL(route.request().url()).pathname.match(/^\/sector-models\/((?:[a-z0-9]+(?:-[a-z0-9]+)*|players\/[a-f0-9]{32})\/[a-f0-9]{64}\.(?:json|webp|gz|264))$/);
        if (!file || (!file[1].startsWith('players/') && !localNpcSlugs.has(file[1].split('/')[0]))) return route.abort();
        await route.fulfill({ path: resolve(file[1].startsWith('players/') ? playerArt : sharedArt, file[1]),
            headers: { 'Access-Control-Allow-Origin': '*' } });
    };
    await page.route('**/sector-models/**', serveArt);
    await watching.route('**/sector-models/**', serveArt);
    await Promise.all([page, watching].map(client=>client.emulateMedia({reducedMotion:'no-preference'})));
    const name = 'sectormodelqa';
    const owner = await loginModelAccount(request, context, name, false, 78, true);
    const { headers, url } = owner;
    const observer = await loginModelAccount(request, watching.context(), 'sectormodelpeerqa', false, 65);
    for (const account of [owner, observer]) {
        const peerName = account.headers['x-player-name'];
        const heartbeat = await request.post('/api/player/heartbeat', { headers: account.headers,
            data: { name: peerName, sector: account.sector, tile: account.tile, character: { name: peerName } } });
        expect(heartbeat.status(), await heartbeat.text()).toBe(200);
    }
    async function visibleToObserver() {
        const nearby = await request.get('/api/player/world-move', { headers: observer.headers });
        expect(nearby.status(), await nearby.text()).toBe(200);
        const snapshot = await nearby.json();
        const peer = snapshot.players.find((p: { name: string }) => p.name === name);
        expect(peer, 'Nearby world snapshot ' + JSON.stringify(snapshot)).toBeTruthy();
        return peer.character?.playerModel;
    }
    expect(await visibleToObserver()).toBeUndefined();
    const defaultRevisions=new Set(await Promise.all(['starter-one','starter-two'].map(async slug=>{
        const pin=JSON.parse(await readFile(resolve('src/data/sector-models',slug+'.json'),'utf8'));
        return '/sector-models/'+slug+'/'+pin.manifestSha256+'.json';
    })));
    const loadedDefaults=new Set<string>();
    watching.on('response',response=>{
        const path=new URL(response.url()).pathname;
        if(response.ok() && defaultRevisions.has(path)) loadedDefaults.add(path);
    });
    await watching.goto('/#/worldMap');
    const back = watching.getByRole('button', { name: new RegExp('Return to Sector '+observer.sector+'$') });
    const terrain = watching.locator('.continuous-world-map > canvas');
    await expect(back.or(terrain).first()).toBeVisible({ timeout:60_000 });
    if (await back.isVisible()) await back.click();
    const otherFigure = watching.locator('.continuous-world-peer').filter({hasText:name}).locator('.sector-model-figure');
    await expect(otherFigure).toHaveCSS('background-image', /blob:/);
    await expect.poll(()=>loadedDefaults.size).toBeGreaterThan(0);
    const nearbyResidents=watching.locator('[data-life-resident]:visible');
    await expect.poll(()=>nearbyResidents.count()).toBeGreaterThan(0);
    const residents=[];
    for(let n=0;n<await nearbyResidents.count();n++) {
        const resident=nearbyResidents.nth(n);
        await expect(resident).toHaveClass(/has-sector-model/);
        await expect(resident.locator('.sector-model-figure')).toHaveCSS('background-image',/blob:/);
        residents.push(await resident.getAttribute('aria-label'));
    }
    await writeFile(info.outputPath('real-roadside-models.json'),JSON.stringify(residents));
    await info.attach('real-roadside-models',{body:JSON.stringify(residents),contentType:'application/json'});
    let loadedEquippedRevision = false;
    watching.on('response', r => {
        if (r.ok() && r.url().endsWith('/'+ref.assetId+'/'+ref.version+'.json')) loadedEquippedRevision = true;
    });
    const progress = await request.get('/api/avatar-model/jobs/local-pending-qa', { headers });
    expect(progress.status()).toBe(200);
    expect(await progress.json()).toEqual({ id: 'local-pending-qa', month: '2026-11', state: 'render' });
    const opener = page.getByRole('button', { name: 'Equip Model', exact: true });
    const dialog = page.getByRole('dialog', { name: 'World model' });
    const select = dialog.getByRole('combobox', { name: 'World character' });
    await page.goto('/#/profile');
    await opener.click();
    await expect(dialog.getByText(/Rendering sprites/)).toBeVisible();
    await select.selectOption(ref.assetId);
    await expect(dialog.locator('.sector-model-figure')).toHaveAttribute('data-clip', 'idle');
    await dialog.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(dialog.getByText('World model equipped.', { exact: true })).toBeVisible();
    expect((await (await request.get(url, { headers })).json()).character.playerModel).toEqual(ref);
    expect(await visibleToObserver()).toEqual(ref);
    await expect.poll(()=>loadedEquippedRevision).toBe(true);
    await expect(otherFigure).toHaveCSS('background-image', /blob:/);
    await expect(otherFigure).toHaveAttribute('data-clip','idle');
    await page.reload();
    await opener.click();
    await expect(select).toHaveValue(ref.assetId);
    await expect(dialog.getByText(/Rendering sprites/)).toBeVisible();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    const ownerLoadedModel = page.waitForResponse(response => response.ok() &&
        response.url().endsWith('/'+ref.assetId+'/'+ref.version+'.json'));
    await page.goto('/#/worldMap');
    await page.reload();
    const road = page.locator('.continuous-world-map > canvas');
    const returnButton = page.getByRole('button', {name:new RegExp('Return to Sector '+owner.sector+'$')});
    await expect(returnButton.or(road).first()).toBeVisible({timeout:60_000});
    if (await returnButton.isVisible()) await returnButton.click();
    const ownerFigure = page.locator('[data-world-self] .sector-model-figure');
    await ownerLoadedModel;
    await expect(ownerFigure).toHaveAttribute('data-clip','idle');
    const run = page.getByRole('button',{name:'Run',exact:true});
    // The three road tiles west of the plaza provide time for the polling observer as well.
    const startX = Number(await road.getAttribute('data-world-x'));
    for (const [key,gait] of [['ArrowLeft','walk'],['ArrowRight','run']] as const) {
        if ((await run.getAttribute('aria-pressed')==='true') !== (gait==='run')) await run.click();
        await road.focus();
        await page.keyboard.down(key);
        try {
            // A short road can reach braking between Playwright's default polling intervals.
            // Sample actual painted frames on both displays through a complete stretch of the gait.
            const painted=await Promise.all([ownerFigure,otherFigure].map(figure=>figure.evaluate((el, gait)=>new Promise<{frames:string[];states:unknown[]}>((resolve)=>{
                const deadline = performance.now()+12_000;
                const frames = new Set<string>(), states:unknown[]=[];
                let previous='';
                function sample() {
                    const clip=el.getAttribute('data-clip'), frame=el.getAttribute('data-frame') ?? '';
                    const blob=getComputedStyle(el).backgroundImage.includes('blob:');
                    const state=JSON.stringify({clip,frame,blob,connected:el.isConnected,hidden:document.hidden,
                        current:el.parentElement?.querySelector('.sector-model-figure')===el,
                        walking:el.parentElement?.classList.contains('is-walking'),
                        transform:el.parentElement ? getComputedStyle(el.parentElement).transform : '',
                        gait:el.getAttribute('data-gait'),facing:el.getAttribute('data-facing')});
                    if(state!==previous) {
                        if(states.length<500) states.push({at:performance.now(),state:JSON.parse(state)});
                        previous=state;
                    }
                    if (clip===gait && blob) frames.add(frame);
                    if (frames.size>=4 || performance.now()>deadline) resolve({frames:[...frames],states});
                    else requestAnimationFrame(sample);
                }
                sample();
            }),gait)));
            for(const [index,result] of painted.entries()) {
                await writeFile(info.outputPath((index ? 'observer-' : 'owner-')+gait+'-frames.json'),JSON.stringify(result));
                await info.attach((index ? 'observer-' : 'owner-')+gait+'-frames',{body:JSON.stringify(result),contentType:'application/json'});
                expect(result.frames.length,(index ? 'Observer' : 'Owner')+' must paint four distinct '+gait+' frames').toBeGreaterThanOrEqual(4);
            }
            if (gait==='walk') await expect.poll(async()=>startX-Number(await road.getAttribute('data-world-x')),
                {timeout:15_000}).toBeGreaterThan(2.8);
            if (gait==='run') await Promise.all([page,watching].map((client,index)=>
                client.locator('.continuous-world-map').screenshot({path:info.outputPath(index ? 'observer-sector.png' : 'owner-sector.png')})));
        } finally { await page.keyboard.up(key); }
        await Promise.all([ownerFigure,otherFigure].map(figure=>expect(figure).toHaveAttribute('data-clip','idle',{timeout:12_000})));
    }
    // Releasing inside the first step selects a different page from braking at full speed.
    for (const gait of ['walk','run'] as const) {
        if ((await run.getAttribute('aria-pressed')==='true') !== (gait==='run')) {
            await expect(run).toBeEnabled({timeout:25_000});
            await run.click();
        }
        await ownerFigure.evaluate((el,gait)=>{
            const frames=new Set<string>();
            const start='start-'+gait, brake='stop-'+start+'-';
            el.removeAttribute('data-interrupted-start');
            el.removeAttribute('data-braking-cells');
            const observer=new MutationObserver(()=>{
                const clip=el.getAttribute('data-clip') ?? '';
                const frame=el.getAttribute('data-frame') ?? '';
                if (!getComputedStyle(el).backgroundImage.includes('blob:')) return;
                if (clip===start && Number(frame)>=3) el.setAttribute('data-interrupted-start',gait);
                if (clip.startsWith(brake)) {
                    frames.add(frame);
                    el.setAttribute('data-braking-cells',String(frames.size));
                }
                if (clip==='idle' && frames.size) observer.disconnect();
            });
            observer.observe(el,{attributes:true,attributeFilter:['data-clip','data-frame']});
        },gait);
        await road.focus();
        await page.keyboard.down('ArrowLeft');
        try {
            await expect.poll(()=>ownerFigure.getAttribute('data-interrupted-start'),
                {timeout:5000,intervals:[10,20]}).toBe(gait);
        } finally { await page.keyboard.up('ArrowLeft'); }
        await expect.poll(async()=>Number(await ownerFigure.getAttribute('data-braking-cells')),
            {timeout:5000}).toBeGreaterThanOrEqual(2);
        await expect(ownerFigure).toHaveAttribute('data-clip','idle');
    }
    await page.goto('/#/profile');
    await page.reload();
    await opener.click();
    const equippedIdle=await otherFigure.evaluate(el=>getComputedStyle(el).backgroundImage);
    await select.selectOption('');
    await dialog.getByRole('button', { name: 'Equip', exact: true }).click();
    await expect(dialog.getByText('Default character equipped.', { exact: true })).toBeVisible();
    expect((await (await request.get(url, { headers })).json()).character.playerModel).toBeUndefined();
    expect(await visibleToObserver()).toBeUndefined();
    await expect(otherFigure).toHaveCSS('background-image', /blob:/);
    await expect.poll(()=>otherFigure.evaluate(el=>getComputedStyle(el).backgroundImage)).not.toBe(equippedIdle);
    await expect(otherFigure).toHaveAttribute('data-clip','idle');
});

test('a returning player sees which monthly model request used their creation', async ({ page, context, request }, info) => {
    test.skip(!process.env.SECTOR_MODEL_LIVE_RECEIPT || info.project.name !== 'chromium-desktop-live', 'Requires the isolated model account fixture.');
    const name = 'sectoroutcomeqa';
    const { headers } = await loginModelAccount(request, context, name, false, undefined, true);
    const library = '/api/avatar-model/models';
    const last = await request.get(library, { headers });
    expect(last.status()).toBe(200);
    expect((await last.json()).ended).toEqual({ id: 'retained-outcome-qa', month: '2026-10', state: 'cancelled', slot: 'used' });
    await page.goto('/#/profile');
    const opener = page.getByRole('button', { name: 'Equip Model', exact: true });
    const dialog = page.getByRole('dialog', { name: 'World model' });
    await opener.click();
    await expect(dialog.getByText(/Model creation was cancelled.*creation was used/)).toBeVisible();
    // A previous visit saw the November job before it failed and its slot was released.
    await page.evaluate(name => localStorage.setItem('shinobix:latest-model-request:' + name, 'returned-outcome-qa'), name);
    await page.reload();
    await opener.click();
    await expect(dialog.getByText(/Model creation failed.*creation was returned/)).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveValue('');
    expect((await (await request.get('/api/save/' + name, { headers })).json()).character.playerModel).toBeUndefined();
});

test('a player submits a world model, closes the tab, then equips the finished sprite', async ({ page, context, browser, baseURL, request }, info) => {
    test.skip(!process.env.SECTOR_MODEL_CREATION_QA, 'Requires an audited local model package and isolated provider fixtures.');
    const packageRoot = resolve(process.env.SECTOR_MODEL_CREATION_QA!);
    const portrait = resolve(process.env.SECTOR_MODEL_CREATION_PORTRAIT!);
    const evidence = resolve(process.env.SECTOR_MODEL_CREATION_EVIDENCE!);
    const { gameModel } = JSON.parse(await readFile(resolve(packageRoot, 'result.json'), 'utf8'));
    const name = 'modelqueueqa' + info.config.projects.findIndex(project => project.name === info.project.name);
    const { url, sector } = await loginModelAccount(request, context, name, true, 78);
    await page.goto('/#/profile');
    const uploaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/images' &&
        response.request().method() === 'POST' && response.request().postDataJSON()?.id === 'avatar:' + name);
    await page.getByLabel('Custom avatar image').setInputFiles(portrait);
    expect((await uploaded).status()).toBe(200);
    const saved = await request.get('/api/img?id=avatar:' + name, { maxRedirects: 0 });
    expect(saved.status()).toBe(200);
    expect(await saved.body()).toEqual(await readFile(portrait));

    const open = (view: Page) => view.getByRole('button', { name: 'Equip Model', exact: true }).click();
    const avatarActions = page.locator('.profile-avatar-upload');
    await expect(avatarActions.getByRole('button', { name: 'Upload avatar', exact: true })).toBeVisible();
    await avatarActions.getByRole('button', { name: 'Make Model', exact: true }).click();
    const creation = page.getByRole('dialog', { name: 'Make Model' });
    await expect(creation.getByText(/sends your saved portrait to OpenAI and Modal/)).toBeVisible();
    await creation.getByRole('button', { name: 'Check portrait', exact: true }).click();
    await expect(creation.getByText('Upright raccoon in a feathered coat')).toBeVisible();
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/avatar-model/jobs' &&
        response.request().method() === 'POST');
    const viewport = page.viewportSize() ?? undefined;
    await creation.getByRole('button', { name: 'Create model', exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const { jobId } = await response.json();
    expect(jobId).toMatch(/^[a-f0-9-]{36}$/);
    await page.close();
    const closedAt = Date.now();

    const receipt = resolve(evidence, jobId + '.json');
    await expect.poll(() => readFile(receipt, 'utf8').catch(() => ''), { timeout: 35_000 }).not.toBe('');
    const finished = JSON.parse(await readFile(receipt, 'utf8'));
    expect(finished.endedAt).toBeGreaterThanOrEqual(closedAt);
    expect(finished.stages).toEqual(['A', 'B', 'C', 'finish', 'recognize']);
    expect(finished.version).toBe(gameModel.version);
    const ref = { assetId: finished.assetId, version: finished.version };
    const returning = await browser.newContext({ baseURL, viewport,
        isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch,
        reducedMotion: 'no-preference', serviceWorkers: 'block' });
    try {
        const signIn = await returning.request.post('/api/player-auth', {
            data: { action: 'verify', name, password: modelQaPassword },
        });
        expect(signIn.status()).toBe(200);
        const { ok, token } = await signIn.json();
        expect(ok).toBe(true);
        expect(typeof token).toBe('string');
        const headers = { 'x-player-name': name, 'x-player-token': token };
        const reloaded = await returning.request.get(url, { headers });
        expect(reloaded.status()).toBe(200);
        await installModelSession(returning, name, token, await reloaded.json());
        await returning.route('https://art.example.invalid/**', route => route.abort());
        await returning.route('https://art.example.invalid/sector-models/players/' + ref.assetId + '/**', async route => {
            const path = new URL(route.request().url()).pathname.split('/');
            const file = path.at(-1) ?? '';
            expect(file).toMatch(/^[a-f0-9]{64}\.(json|gz|264)$/);
            await route.fulfill({ path: resolve(packageRoot, 'sector-models', 'players', gameModel.assetId, file),
                headers: { 'Access-Control-Allow-Origin': '*' } });
        });
        const next = await returning.newPage();
        await next.goto('/#/profile');
        await open(next);
        const library = next.getByRole('dialog', { name: 'World model' });
        const choice = library.getByRole('combobox', { name: 'World character' });
        await choice.selectOption(ref.assetId);
        const preview = library.locator('.sector-model-figure');
        await expect(preview).toHaveCSS('background-image', /blob:/);
        await library.getByRole('button', { name: 'Preview walk' }).click();
        await expect(preview).toHaveAttribute('data-clip', 'walk');
        await library.screenshot({ path: info.outputPath('created-model-preview.png') });
        await library.getByRole('button', { name: 'Equip', exact: true }).click();
        await expect(library.getByText('World model equipped.', { exact: true })).toBeVisible();
        expect((await (await returning.request.get(url, { headers })).json()).character.playerModel).toEqual(ref);
        await library.getByRole('button', { name: 'Close', exact: true }).click();
        await next.goto('/#/worldMap');
        await next.reload();
        const road = next.locator('.continuous-world-map > canvas');
        const back = next.getByRole('button', { name: new RegExp('Return to Sector ' + sector + '$') });
        await expect(back.or(road).first()).toBeVisible({ timeout: 60_000 });
        if (await back.isVisible()) {
            try { await back.click({ timeout: 10_000 }); }
            catch (error) {
                if (!await road.isVisible()) throw error;
            }
        }
        await expect(next.locator('[data-world-self] .sector-model-figure')).toHaveCSS('background-image', /blob:/);
        await next.locator('.continuous-world-map').screenshot({ path: info.outputPath('created-model-in-sector.png') });
    } finally {
        await returning.close();
    }
});

if (process.env.SECTOR_MODEL_TEST_PORTRAITS) {
    const extensions: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/png': 'png' };
    const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    test('Profile publishes the source bytes used for model fitting', async ({ page, context, request }, info) => {
        expect(process.env.R2_PUBLIC_BASE?.trim() || '', 'Run the upload replay with the public image mirror disabled').toBe('');
        const name = 'portraitqa' + info.config.projects.findIndex(project => project.name === info.project.name);
        await loginModelAccount(request, context, name, true);
        await page.goto('/#/profile');
        const files: string[] = JSON.parse(process.env.SECTOR_MODEL_TEST_PORTRAITS!);
        expect(files.length).toBeGreaterThan(0);
        for (const [index, file] of files.entries()) {
            const original = await readFile(file);
            const gif = original.subarray(0,3).toString('ascii') === 'GIF';
            const details = Boolean(process.env.SECTOR_MODEL_DETAIL_QA) && !gif;
            const path = details ? '/api/avatar-model/profile-portrait' : '/api/images';
            const posted = page.waitForResponse(res => new URL(res.url()).pathname === path &&
                res.request().method() === 'POST' && (details || res.request().postDataJSON()?.id === 'avatar:' + name));
            await page.getByLabel('Custom avatar image').setInputFiles(file);
            const upload = await posted;
            expect(upload.status()).toBe(200);
            const saved = await request.get('/api/img?id=avatar:' + name, { maxRedirects: 0 });
            expect(saved.status()).toBe(200);
            const mime = saved.headers()['content-type'].split(';')[0];
            const bytes = await saved.body();
            const submitted = upload.request().postDataJSON().image as string;
            const submittedBytes = Buffer.from(submitted.slice(submitted.indexOf(',') + 1), 'base64');
            if (details) {
                const published = (await upload.json()).image;
                expect(bytes.equals(Buffer.from(published.split(',')[1],'base64'))).toBe(true);
                expect(bytes.includes(Buffer.from('urn:shinobij:portrait'))).toBe(true);
                expect(bytes.includes(Buffer.from(sha256(submittedBytes)))).toBe(false);
                expect(bytes.length).toBeLessThan(submittedBytes.length);
                await writeFile(info.outputPath('fitting-'+index+'.'+extensions[submitted.slice(5,submitted.indexOf(';'))]),submittedBytes);
            } else expect(bytes.equals(submittedBytes)).toBe(true);
            expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
            const extension = extensions[mime];
            if (!extension) throw new Error('Unexpected stored portrait type ' + mime);
            if (original.subarray(0, 3).toString('ascii') === 'GIF') {
                expect(mime).toBe('image/gif');
                expect(bytes.equals(original)).toBe(true);
            }
            const source = info.outputPath('portrait-' + index + '.' + extension);
            await writeFile(source, bytes);
            await info.attach('portrait-' + index + '-receipt', {
                contentType: 'application/json',
                body: JSON.stringify({ mime, originalBytes: original.length, originalHash: sha256(original),
                    storedBytes: bytes.length, sourceSha256: sha256(bytes) }),
            });
        }
        if (process.env.SECTOR_MODEL_DETAIL_QA) {
            await page.reload();
            await page.locator('.profile-avatar-upload').getByRole('button',{name:'Make Model',exact:true}).click();
            const dialog=page.getByRole('dialog',{name:'Make Model'});
            const checked=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/avatar-model/read');
            await dialog.getByRole('button',{name:'Check portrait',exact:true}).click();
            expect(await (await checked).json()).toEqual({state:'declined'});
            await expect(dialog.getByText(/Your monthly creation is still available/)).toBeVisible();
        }
    });
}
