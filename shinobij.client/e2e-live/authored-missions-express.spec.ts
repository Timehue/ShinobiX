import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { readFileSync } from 'node:fs';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

const cases = [
    ['combat-c-patrol','C-Rank Patrol','Ember Duelist',15,'Granite Elbow'],
    ['combat-b-escort','B-Rank Escort','Frost Sealer',30,'Lantern Fear'],
    ['combat-a-hunt','A-Rank Hunt','Shadow Weaver',50,'Moonlit Tide Dream'],
    ['combat-s-crisis','S-Rank Crisis','Central Champion',70,'Stone Needle Volley'],
] as const;

for (const [key,title,opponent,level,moveName] of cases) test(`${title} renders its sealed authored opponent and real combat feedback`,async({page,request},info)=>{
    page.setDefaultTimeout(20_000);
    const name=`authored${level}${info.project.name.includes('mobile')?'mob':'desk'}`;
    const reg=await request.post('/api/player-auth',{data:{action:'register',name,password:'AuthoredLocal!1234'}});
    expect(reg.status()).toBe(200);const {token}=await reg.json();
    const headers={'x-player-name':name,'x-player-token':token};
    const fixture=JSON.parse(readFileSync('../docs/mission-encounter-evidence/player-fixtures.json','utf8'))[level];
    const character={...fixture.character,name,profession:'vanguard',professionRank:1,professionChosen:true,
        academyTrialClaimed:true,academyChecklistClaimed:true,firstContractClaimed:true,
        companionQuestComplete:true,pendingCombatMissionClaims:[],dailyMissionsCompleted:0};
    // Seed earned progression only in the isolated memory server, then enter
    // and act with the normally registered player's authority.
    {
        let prior:Record<string,any>={};
        const seedRequest=()=>request.post(`/api/save/${name}?signal=1`,{headers:{'x-admin-password':'live-express-e2e-admin'},data:{
            ...prior,...fixture,character,currentSector:40,acceptedMissionIds:[],missionProgress:{},
            triggeredEvents:['builtin-awakening-lv2','builtin-aura-sphere-lv9','builtin-hidden-dungeon'],
            _saveVersion:prior._saveVersion,
        }});
        let seeded=await seedRequest();
        for(let retry=0;retry<5&&[409,429].includes(seeded.status());retry++) {
            const body=await seeded.json();
            if(seeded.status()===429) await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(0,Number(body.retryAfterMs)||3100))+100));
            prior=await (await request.get(`/api/save/${name}`,{headers})).json();
            if(body.storedVersion) prior._saveVersion=Math.max(Number(prior._saveVersion)||0,body.storedVersion);
            seeded=await seedRequest();
        }
        expect(seeded.status(),await seeded.text()).toBe(200);
    }
    const canonical=await (await request.get(`/api/save/${name}`,{headers})).json();
    expect(canonical.character.level).toBeGreaterThanOrEqual(level);
    await request.post(`/api/save/${name}?ack=1`,{headers});
    await page.addInitScript(({name,token,patch})=>{
        localStorage.setItem('ninjav-admin-build-v1',JSON.stringify({currentAccountName:name}));
        localStorage.setItem('ninjav-player-accounts-v1',JSON.stringify({[name]:{token}}));
        localStorage.setItem('shinobix:activePlayerPersist',name);
        localStorage.setItem('shinobix:activeTokenPersist',token);
        localStorage.setItem('shinobix:storage-notice-ack','1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1',patch);
        localStorage.setItem('dailyBriefing.seen.v1',new Date().toISOString().slice(0,10));
    },{name,token,patch:LATEST_PATCH_NOTE.version});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/#/missions',{waitUntil:'networkidle'});
    for(let i=0;i<6;i++) {
        const notice=page.getByRole('button',{name:/Skip visual novel scene|^Skip$|Close briefing|^Got it/}).last();
        if(!await notice.isVisible().catch(()=>false)) break;
        await notice.click();
    }
    await expect(page.getByRole('heading',{name:'Mission Hall'})).toBeVisible();
    await page.getByRole('tab',{name:'Combat',exact:true}).click();
    const card=page.locator('.mh-combat-card').filter({hasText:title});
    const start=page.waitForResponse(r=>r.url().includes('/api/missions/combat-start')&&r.request().method()==='POST');
    await card.getByRole('button',{name:/Begin Mission/}).click();
    const response=await start;expect(response.status()).toBe(200);
    const {session}=await response.json();
    expect(session.encounter.id).toBe(key);expect(session.enemy.character.missionTactics).toBe(true);
    const arena=page.locator('.mission-arena-fight');await expect(arena).toBeVisible();
    await expect(arena.getByText(opponent,{exact:true}).first()).toBeVisible();
    let demonstrated=false;
    for(let turn=0;turn<4&&!demonstrated;turn++) {
        const wait=arena.getByRole('button',{name:/Wait.*End turn/});
        await expect(wait).toBeEnabled();
        const action=page.waitForResponse(r=>r.url().includes('/api/solo-pve/action')&&r.request().method()==='POST');
        await wait.click();
        const resolved=await action;expect(resolved.status()).toBe(200);
        const state=await resolved.json();
        demonstrated=state.session.log.some((line:string)=>line.includes(`${opponent} uses ${moveName}`));
    }
    expect(demonstrated).toBe(true);
    const logTab=arena.getByRole('tab',{name:/Battle Log/});
    if(await logTab.isVisible()) await logTab.click();
    for(const round of await arena.getByRole('button',{name:/^Round \d/}).all()) {
        if(await round.getAttribute('aria-expanded')==='false') await round.click();
    }
    const moveLog=arena.getByText(new RegExp(moveName),{exact:false}).last();
    await moveLog.scrollIntoViewIfNeeded();
    await expect(moveLog).toBeVisible();
    const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
    expect(overflowing).toBe(false);
    const dossier=arena.getByRole('complementary',{name:`${opponent} combat status`});
    await expect(dossier.locator('.combat-avatar')).toHaveText(opponent.slice(0,2).toUpperCase());
    // The empty local image registry uses the normal initials portrait fallback;
    // the shipped battlefield sprite must still match the sealed profile.
    const sprite=arena.locator('[data-battlefield-actor-id="enemy"] img');
    await expect(sprite).toHaveAttribute('src',new RegExp(String(session.enemy.character.visual)));
    await expect.poll(()=>sprite.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    const effect=key==='combat-b-escort'?'Decrease Damage Taken':key==='combat-a-hunt'?'Poison':'Increase Damage Taken';
    await expect(arena.locator(`[title^="${effect}"]:visible`).first()).toBeVisible();
    await arena.screenshot({path:info.outputPath(`${key}.png`)});
    const actionsTab=arena.getByRole('tab',{name:'Actions',exact:true});
    if(await actionsTab.isVisible()) {
        await actionsTab.click();
        await arena.getByRole('button',{name:/View Flicker jutsu details/}).scrollIntoViewIfNeeded();
        await arena.getByRole('button',{name:/Wait.*End turn/}).scrollIntoViewIfNeeded();
        await arena.screenshot({path:info.outputPath(`${key}-controls.png`)});
    }
    await expect(arena.getByRole('button',{name:/Wait.*End turn/})).toBeEnabled();
    expect(errors).toEqual([]);
});
