// Run from the repository root after npm run build. See output/coast/CLAUDE-HANDOFF.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, chromium, expect } from '@playwright/test';
import { uiAuditSave } from '../../e2e/helpers/ui-audit-runtime.ts';
import { LATEST_PATCH_NOTE } from '../../src/data/patch-notes.ts';
import { COAST_MIN_LEVEL, COAST_REGION_COUNT, COAST_LANDING_SECTOR, HOME_HARBOR_SECTOR, coastRegionOf } from '../../../shared/world-maps.ts';
import { checkResidents, checkRoom, checkModels, checkAtlas, checkJournal, checkLetter, checkBell, checkCrossing } from './coast-handoff-checks.mjs';

import { checkLostLures } from './coast-recipe-check.mjs';
import { checkWeather } from './coast-weather-check.mjs';
import { checkRoads, checkLivery } from './coast-settlement-check.mjs';

const engine = process.env.COAST_QA_BROWSER || 'webkit';
const viewport = engine === 'webkit' ? { width: 390, height: 844 } : { width: 1366, height: 768 };
const out = path.resolve(process.env.COAST_QA_OUTPUT || '.ci-evidence/coast-level75', engine);
const tests = process.argv.slice(2);
const run = name => !tests.length || tests.includes(name);
const password = randomUUID();
const reservation = createServer();
await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const url = 'http://127.0.0.1:' + port;
await mkdir(out,{recursive:true});
const server = fork(fileURLToPath(new URL('./coast-handoff-server.cjs',import.meta.url)),[], {
    execArgv: [], windowsHide:true, env: { ...process.env, NODE_ENV:'test', SHINOBIX_QA_MEMORY_KV:'1',
        DISABLE_REALTIME:'0', DISABLE_SCHEDULED_JOBS:'1', DISABLE_SNAPSHOT_CRON:'1', SENTRY_DSN:'',
        SESSION_SECRET:randomUUID(), ADMIN_PASSWORD:password, PORT:String(port), HOST:'127.0.0.1',
        STATIC_DIR:path.resolve(process.env.COAST_QA_DIST || 'shinobij.client/dist'), R2_PUBLIC_BASE:process.env.SECTOR_MODEL_TEST_CONTENT ? url : process.env.COAST_QA_MODEL_ORIGIN || '' },
});
let browser, serial = 0;
async function send(request, route, body, headers = {}) {
    const response = await request.post(route,{headers,data:body});
    const text = await response.text();
    assert(response.ok(), route + ' ' + response.status() + ' ' + text.slice(0,500));
    return text ? JSON.parse(text) : {};
}
async function scenario(key,sector,kind,check) {
    const name = 'coastqa' + (++serial);
    const touch = engine==='webkit' && process.env.COAST_QA_TOUCH==='1';
    const ctx = await browser.newContext({baseURL:url,viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:engine==='webkit' && key==='residents-105' ? 3 : 1,reducedMotion:'reduce',serviceWorkers:'block'});
    const page = await ctx.newPage();
    page.setDefaultTimeout(25000);
    const request = ctx.request;
    const models = kind==='boss' || kind==='model' || (process.env.COAST_QA_RESIDENT_MODELS==='1' && ['people','roads'].includes(kind));
    try {
        if (models && process.env.SECTOR_MODEL_TEST_CONTENT) {
            await ctx.route(url+'/sector-models/**', async route => {
                const file = new URL(route.request().url()).pathname.match(/^\/sector-models\/([a-z0-9-]+\/[a-f0-9]{64}\.(?:json|webp|gz|264))$/);
                if (!file) return route.abort();
                await route.fulfill({path:path.resolve(process.env.SECTOR_MODEL_TEST_CONTENT,file[1])});
            });
        }
        const {token} = await send(request,'/api/player-auth',{action:'register',name,password:randomUUID()+'!Aa7'});
        const auth = {'x-player-name':name,'x-player-token':token};
        const {character} = uiAuditSave();
        await send(request,'/api/save/'+name+'?signal=1',{character:{...character,name,level:COAST_MIN_LEVEL,avatarImage:key==='residents-105-alt' ? '/starter-avatar-two.webp' : '/starter-avatar-one.webp', starterWorldModel:key==='residents-105-alt' ? 'starter-two' : 'starter-one'},currentSector:HOME_HARBOR_SECTOR}, {'x-admin-password':password});
        const prepared = await new Promise((resolve,reject) => {
            const timer = setTimeout(() => reject(Error('Seed timed out')),30000);
            server.once('message',message => { clearTimeout(timer); resolve(message); });
            server.send({name,sector,kind});
        });
        assert(prepared.ok,prepared.error);
        await send(request,'/api/events/claim',{playerName:name,eventId:'builtin-aura-sphere-lv9'},auth);
        const readSave = async () => (await request.get('/api/save/'+name,{headers:auth})).json();
        await readSave();
        await send(request,'/api/save/'+name+'?ack=1',{},auth);
        const save = await readSave();
        assert.equal(save.character.level,prepared.level);
        await ctx.addInitScript(({name,token,save,models,patch,reader}) => {
            const values = {
                'ninjav-admin-build-v1':JSON.stringify({currentAccountName:name}),
                'ninjav-player-accounts-v1':JSON.stringify({[name]:{token}}),
                'shinobix:activePlayerPersist':name,'shinobix:activeTokenPersist':token,
                'shinobix:storage-notice-ack':'1','dailyBriefing.seen.v1':new Date().toISOString().slice(0,10),
                'patchNotes.lastSeenVersion.v1':patch,'worldAvatarMode.v1':models?'3d':'2d',
                ['ninjav-save-preview-v1:'+name]:JSON.stringify(save),
            };
            if (reader) localStorage.setItem('vnReaderMode.v1',reader);
            for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value);
        },{name,token,save,models,patch:LATEST_PATCH_NOTE?.version??'',reader:process.env.COAST_QA_READER});
        const post = (route,data) => send(request,route,data,auth);
        const list = () => post('/api/quests/lines',{action:'list',playerName:name});
        const world = await (await request.get('/api/coast/world',{headers:auth})).json();
        await page.goto(['journal','below','letter','lost-lures','one-lure','bell-hang','bell-bury'].includes(kind) ? '/#/missions' : '/#/worldMap',{waitUntil:'domcontentloaded'});
        const board = page.locator('.coast-sector .continuous-world-map').first();
        // Acknowledged notices can finish mounting just after the world does.
        await page.addLocatorHandler(page.locator('.game-alert-backdrop').getByRole('button',{name:'OK',exact:true}), async loc => loc.click());
        await page.addLocatorHandler(page.getByRole('button',{name:'Close briefing',exact:true}), async loc => loc.click());
        const capture = async (label,locator=page,scale='device') => locator.screenshot({scale,path:path.join(out,key+'-'+label+'.png')});
        const stockLanding=(kind='stock-test-landing')=>new Promise((resolve,reject)=>{
            server.once('message',msg=>msg.ok?resolve():reject(new Error(msg.error)));
            server.send({name,sector,kind});
        });
        const details = await check({models,stockLanding,touch,page,board,world,sector,prepared,post,list,readSave,name,kind,capture,expect,ctx});
        await writeFile(path.join(out,key+'.json'),JSON.stringify({key,viewport,level:prepared.level,...details},null,2));
        console.log('PASS '+key);
        return prepared;
    } catch (error) {
        await page.screenshot({path:path.join(out,key+'-failure.png')}).catch(()=>{});
        await writeFile(path.join(out,key+'-failure.txt'),(await page.locator('body').innerText()).slice(-14000));
        throw error;
    } finally { await ctx.close(); }
}
try {
    await expect.poll(async () => {
        assert(server.exitCode===null,'Fixture server exited');
        return fetch(url+'/health').then(r=>r.ok,()=>false);
    },{timeout:90000}).toBe(true);
    browser = await ({webkit,chromium}[engine]).launch();
    if(run('weather')) {
        await scenario('coast-weather-held',102,'weather', s => checkWeather(s,
            () => scenario('coast-weather-visitor',102,'visitor',checkWeather)));
        await scenario('coast-weather-open',COAST_LANDING_SECTOR,'room',checkWeather);
    }
    if(run('livery')) await scenario('clan-hall',108,'livery',checkLivery);
    if(run('roads')) await scenario('stair-houses',105,'roads',checkRoads);
    for (const [sector,count] of [[105,6],[104,3],[144,2],[140,4],[137,1]]) {
        if(run('residents')||tests.includes('r'+sector)) await scenario('residents-'+sector,sector,'people',s=>checkResidents(s,count));
    }
    if(run('residents')) await scenario('residents-140-captain',140,'captain',s=>checkResidents(s,4));
    if(tests.includes('r105-alt')) await scenario('residents-105-alt',105,'people',s=>checkResidents(s,6));
    if(run('rooms')) {
        const state = await scenario('keeper-'+COAST_LANDING_SECTOR,COAST_LANDING_SECTOR,'room',checkRoom);
        assert.equal(state.keepers.length,5);
        for(const f of state.keepers.filter(f=>f.sector!==COAST_LANDING_SECTOR)) await scenario('keeper-'+f.sector,f.sector,'room',checkRoom);
    }
    if(tests.includes('tree')) await scenario('keeper-120',120,'room',checkRoom);
    if(run('models')) {
        await scenario('keeper-model',105,'model',checkModels);
        await scenario('boss-model',107,'boss',checkModels);
    }
    if(run('atlas')) await scenario('atlas',105,'atlas',s=>checkAtlas(s,coastRegionOf,COAST_REGION_COUNT));
    if(run('bell')) for(const choice of ['hang','bury']) await scenario('bell-'+choice,141,'bell-'+choice,checkBell);
    if(run('letter')) {
        for (const option of ['carry','keep']) await scenario('letter-'+option,105,'letter',s=>checkLetter(s,option));
    }
    if(run('recipes')) for (const kind of ['lost-lures','one-lure']) await scenario(kind,109,kind,checkLostLures);
    if(run('journal')) await scenario('journal',COAST_LANDING_SECTOR,'journal',checkJournal);
    if(run('gate')) {
        await scenario('below-gate',HOME_HARBOR_SECTOR,'below',s=>checkCrossing(s,COAST_MIN_LEVEL,COAST_LANDING_SECTOR));
        await scenario('at-gate',HOME_HARBOR_SECTOR,'crossing',s=>checkCrossing(s,COAST_MIN_LEVEL,COAST_LANDING_SECTOR));
    }
} finally { await browser?.close(); server.kill(); }

