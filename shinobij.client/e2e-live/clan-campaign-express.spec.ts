import {expect,type APIRequestContext,type BrowserContext,type Page,type TestInfo} from '@playwright/test';
import {test,API_CONNECTION_RETRIES} from './helpers/reconnecting-request';
import {uniquePlayerName} from './helpers/player-names';
import {LATEST_PATCH_NOTE} from '../src/data/patch-notes';
import {quietRoadCooldowns} from './helpers/quiet-road';
// This journey reads the real save, battle and reward response families; fields are asserted at use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json=Record<string,any>;
const admin={'x-admin-password':'live-express-e2e-admin'};
test.use({actionTimeout:30_000});
async function post(request:APIRequestContext,url:string,headers:Record<string,string>,data:Json){
    const response=await request.post(url,{headers,data}),body=await response.text();expect(response.status(),body).toBe(200);return body.trim()?JSON.parse(body) as Json:{};
}
async function seed(request:APIRequestContext,tag:string){
    const name=uniquePlayerName(stamp=>`cc${tag}${stamp}`);
    const registered=await post(request,'/api/player-auth',{}, {action:'register',name,password:'ClanCampaignJourney!1234'});
    const token=String(registered.token),headers={'x-player-name':name,'x-player-token':token};
    const pet={id:`pet-${name}`,templateId:'rare-21',name:'Stoneback Tanuki',element:'Earth',rarity:'rare',level:60,xp:0,maxLevel:100,
        hp:420,attack:72,defense:58,speed:64,jutsus:[],unlockedForPve:true,trait:'Loyal',happiness:88,origin:'wild',generation:0,
        breedingUsesMax:8,breedingUsesRemaining:8};
    await post(request,`/api/save/${name}?signal=1`,admin,{character:{name,village:'Moonshadow Village',storyVillage:'Moonshadow Village',specialty:'Ninjutsu',bloodline:'None',
        level:24,rankTitle:'Chunin',xp:0,unspentStats:0,storyProgress:99,onboardingStep:'done',academyChecklistClaimed:true,starterCardsClaimed:true,
        examsPassed:['genin','chunin'],profession:'vanguard',professionRank:1,professionXp:0,professionChosenAt:1,
        hp:500,maxHp:500,chakra:500,maxChakra:500,stamina:500,maxStamina:500,
        stats:Object.fromEntries(['strength','speed','intelligence','willpower','bukijutsuOffense','bukijutsuDefense','taijutsuOffense','taijutsuDefense','genjutsuOffense','genjutsuDefense','ninjutsuOffense','ninjutsuDefense'].map(key=>[key,100])),
        ryo:1000,honorSeals:500,clanPoints:1000,inventory:[],itemStacks:[{itemId:'gather-field-herb',count:10}],equipment:{},weaponElements:{},pets:[pet],
        tileCards:[],jutsuMastery:[],equippedJutsuIds:[],pendingCombatMissionClaims:[],wandererCooldowns:quietRoadCooldowns([12])},
        worldGeoV:2,currentSector:40,currentTile:65,acceptedMissionIds:[],missionProgress:{},triggeredEvents:['builtin-awakening-lv2','builtin-aura-sphere-lv9','builtin-hidden-dungeon',
            ...[20,30,42,58,70,80,88,92].map(level=>`story-interlude-moonshadow-village-${level}`)]});
    await post(request,`/api/save/${name}?ack=1`,headers,{});return {name,token,headers,petId:pet.id};
}
type Player=Awaited<ReturnType<typeof seed>>;
async function save(request:APIRequestContext,player:Player){const response=await request.get(`/api/save/${player.name}`,{headers:player.headers});expect(response.status(),await response.text()).toBe(200);return await response.json() as Json;}
async function install(context:BrowserContext,request:APIRequestContext,player:Player){
    const canonical=await save(request,player);
    await context.addInitScript(({name,token,canonical,patch})=>{
        if(localStorage.getItem('clan-journey-installed'))return;
        localStorage.setItem('clan-journey-installed',name);localStorage.setItem('ninjav-admin-build-v1',JSON.stringify({currentAccountName:name}));
        localStorage.setItem('ninjav-player-accounts-v1',JSON.stringify({[name]:{token}}));localStorage.setItem('shinobix:activePlayerPersist',name);localStorage.setItem('shinobix:activeTokenPersist',token);
        localStorage.setItem(`ninjav-save-preview-v1:${name}`,JSON.stringify(canonical));localStorage.setItem('shinobix:storage-notice-ack','1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1',patch);localStorage.setItem('dailyBriefing.seen.v1',new Date().toISOString().slice(0,10));
    },{...player,canonical,patch:LATEST_PATCH_NOTE?.version??''});
}
async function hall(page:Page){
    await page.goto('/#/clan',{waitUntil:'domcontentloaded'});await expect(page.locator('.clan-overview')).toBeVisible();
    const dismiss=page.locator('.screen-hint-dismiss');if(await dismiss.isVisible())await dismiss.click();
}
async function capture(page:Page,info:TestInfo,name:string){await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:true});}

test('two clans declare, use every battle host, enter a physical bonus shrine, settle rewards and recover purchases',async({page,browser,context,request},info)=>{
    test.setTimeout(720_000);
    const a:Player[]=[],b:Player[]=[];
    for(let index=0;index<4;index++){a.push(await seed(request,`a${index}`));b.push(await seed(request,`b${index}`));}
    const stamp=uniquePlayerName(value=>`campaign${value}`),clanA=uniquePlayerName(value=>`qatestazure${value}`),clanB=uniquePlayerName(value=>`qatestember${value}`);
    await post(request,'/api/_qa/clan-campaign',admin,{action:'seed-clans',clans:[{name:clanA,members:a.map(p=>p.name)},{name:clanB,members:b.map(p=>p.name)}]});
    const declaration={toClan:clanB,requestId:`clan-journey-declare-${stamp}`,funding:'personal'};
    const first=await post(request,'/api/clan/war/declare',a[0].headers,declaration),warId=first.war.id,instanceId=first.war.campaignView.instanceId;
    expect(first.war.campaignView.phase).toBe('preparing');expect(first.character.honorSeals).toBe(400);
    expect((await post(request,'/api/clan/war/declare',a[0].headers,declaration)).character.honorSeals).toBe(400);
    for(let index=0;index<4;index++){
        const funded=await post(request,'/api/clan/program',a[index].headers,{action:'fund',clan:clanA,itemId:'gather-field-herb',count:10,requestId:`clan-project-${stamp}-${index}`});
        expect(funded.character.clanPoints).toBe(1000);
        expect(funded.view.project.progress).toBe((index+1)*10);
    }
    const repeatedProject=await post(request,'/api/clan/program',a[3].headers,{action:'fund',clan:clanA,itemId:'gather-field-herb',count:10,requestId:`clan-project-${stamp}-3`});
    expect(repeatedProject.view.project.completedProjects).toBe(1);
    const queue=(player:Player,action:string,extra:Json={})=>post(request,'/api/clan/war/queue',player.headers,{warId,action,...extra});
    const list=async(player=a[0])=>{const response=await request.get('/api/clan/war/list',{headers:player.headers});expect(response.status()).toBe(200);return (await response.json()).wars.find((war:Json)=>war.id===warId) as Json;};
    const rivalContext=await browser.newContext({baseURL:String(info.project.use.baseURL),viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,reducedMotion:'reduce'});
    try{
        const rival=await rivalContext.newPage();await install(context,request,a[0]);await install(rivalContext,request,b[0]);
        await hall(page);await hall(rival);await capture(page,info,'hall-overview');
        await expect(page.getByRole('status').filter({hasText:'This week’s Hall project is complete.'})).toBeVisible();
        await page.getByRole('button',{name:'Exchange',exact:true}).click();
        const frame=page.locator('.clan-exchange-card').filter({has:page.getByRole('heading',{name:'Clan Banner Sigil',exact:true})});
        await frame.getByRole('button',{name:'Requisition · 500 CP',exact:true}).click();
        let delivered=false;
        await page.route('**/api/clan/exchange/purchase',async route=>{
            const response=await route.fetch({maxRetries:API_CONNECTION_RETRIES});expect(response.status()).toBe(200);delivered=true;
            // The server commits, but the buyer loses the reply before seeing it.
            await route.abort('failed');
        },{times:1});
        await page.getByRole('dialog',{name:'Confirm purchase of Clan Banner Sigil'}).getByRole('button',{name:'Confirm Purchase',exact:true}).click();
        await expect.poll(()=>delivered).toBe(true);
        await expect.poll(async()=> (await save(request,a[0])).character.clanPoints).toBe(500);
        await page.reload();await hall(page);await page.getByRole('button',{name:'Exchange',exact:true}).click();
        await expect(frame.getByRole('button',{name:'Limit reached',exact:true})).toBeDisabled();
        await expect(page.locator('.clan-header .clan-sigil-frame')).toBeVisible();
        expect((await save(request,a[0])).character.clanExchangePurchases.oneTime.clanBannerFrame).toBe(true);
        await capture(page,info,'exchange');
        await page.getByRole('button',{name:'Wars',exact:true}).click();await expect(page.locator('.clan-campaign-kicker')).toHaveText('Preparation');
        await capture(page,info,'campaign-preparation');
        await post(request,'/api/_qa/clan-campaign',admin,{action:'advance',warId,instanceId});
        async function pair(mode:string,from:Player[],to:Player[],extra:Json={}){
            for(const side of [from,to]){
                const opened=await queue(side[0],'join',{mode,...extra});
                if(side[1])await queue(side[1],'join',{mode,...extra,partnerEntryId:opened.war.campaignView.queue.find((entry:Json)=>entry.players.includes(side[0].name)).id});
            }
            const state=await queue(from[0],'state',extra),match=state.war.campaignView.matches.find((entry:Json)=>entry.status==='ready');expect(match).toBeTruthy();
            for(const player of [...from,...to])await queue(player,'ready',{...extra,matchId:match.id});return match.id as string;
        }
        const petId=await pair('pet1v1',[a[0]],[b[0]]);
        for(const player of [a[0],b[0]])await post(request,'/api/clan/war/pet',player.headers,{action:'submit',warId,challengeId:petId,petId:player.petId});
        expect((await list()).campaignView.matches.find((match:Json)=>match.id===petId).status).toBe('completed');
        const cardId=await pair('tilecards',[a[3]],[b[3]]);
        for(const player of [a[3],b[3]])await post(request,'/api/clan/war/tilecards',player.headers,{action:'join',warId,challengeId:cardId});
        await post(request,'/api/clan/war/tilecards',b[3].headers,{action:'forfeit',warId,challengeId:cardId});
        const teamId=await pair('pvp2v2',a.slice(0,2),b.slice(0,2));
        const team=await post(request,'/api/clan/war/pvp-2v2',a[0].headers,{action:'start',warId,challengeId:teamId,playerName:a[0].name});
        expect(team.match.status).toBe('active');
        for(const player of b.slice(0,2)){
            const state=await request.get(`/api/towers/pvp-state?matchId=${team.match.matchId}&playerName=${player.name}`,{headers:player.headers});expect(state.status()).toBe(200);
            const match=(await state.json()).match;
            await post(request,'/api/towers/pvp-action',player.headers,{type:'forfeit',matchId:team.match.matchId,playerName:player.name,expectedVersion:match.version,moveToken:`campaign-forfeit-${player.name}`});
        }
        await post(request,'/api/clan/war/pvp-2v2',a[0].headers,{action:'settle',challengeId:teamId,playerName:a[0].name});
        const duelId=await pair('pvp1v1',[a[2]],[b[2]]),duelWar=await list(a[2]),challenge=duelWar.pendingChallenges.find((entry:Json)=>entry.id===duelId);
        const fighters=[...a,...b],from=fighters.find(player=>player.name===challenge.fromPlayer)!,to=fighters.find(player=>player.name===challenge.acceptedPlayer)!;
        const duel=await post(request,'/api/pvp/session',from.headers,{clanWarId:warId,clanWarChallengeId:duelId,baseRewards:true,p1Character:{name:from.name},p2Character:{name:to.name}});
        for(const [player,role] of [[from,'p1'],[to,'p2']] as const)await post(request,'/api/pvp/move',player.headers,{battleId:duel.battleId,role,action:'join'});
        await expect.poll(async()=>{const response=await request.get(`/api/pvp/session?id=${duel.battleId}`,{headers:from.headers});const state=await response.json();return Number(state.turnStartedAt??0)<=Date.now();}).toBe(true);
        for(let turn=0;turn<30;turn++){
            const response=await request.get(`/api/pvp/session?id=${duel.battleId}`,{headers:from.headers}),state=await response.json();if(state.status==='done')break;
            const player=state.activePlayer==='p1'?from:to;
            await post(request,'/api/pvp/move',player.headers,{battleId:duel.battleId,role:state.activePlayer,action:'flee',moveToken:`campaign-flee-${turn}`});
            const afterResponse=await request.get(`/api/pvp/session?id=${duel.battleId}`,{headers:from.headers}),after=await afterResponse.json();
            // These two fighters are API-driven; the ordinary UI normally sends
            // Wait when an unsuccessful flee has consumed the turn's AP.
            if(after.status!=='done'&&after.activePlayer===state.activePlayer)
                await post(request,'/api/pvp/move',player.headers,{battleId:duel.battleId,role:state.activePlayer,action:'wait',moveToken:`campaign-wait-${turn}`});
            await expect.poll(async()=>{const response=await request.get(`/api/pvp/session?id=${duel.battleId}`,{headers:from.headers});const next=await response.json();return next.status==='done'||next.activePlayer!==state.activePlayer;}).toBe(true);
        }
        await expect.poll(async()=>{const response=await request.get(`/api/pvp/session?id=${duel.battleId}`,{headers:from.headers});return (await response.json()).status;}).toBe('done');
        await expect.poll(async()=> (await list(a[2])).campaignView.matches.find((match:Json)=>match.id===duelId)?.status).toBe('completed');
        // Four more completed card bouts reach the real shared contract and
        // remove a random overall tie without inventing a battle result.
        for(let round=0;round<4;round++){
            const card=await pair('tilecards',[a[3]],[b[3]]);
            for(const player of [a[3],b[3]])await post(request,'/api/clan/war/tilecards',player.headers,{action:'join',warId,challengeId:card});
            await post(request,'/api/clan/war/tilecards',b[3].headers,{action:'forfeit',warId,challengeId:card});
        }
        const before=await list(a[0]),normalUses=before.campaignView.normal.clanUsed;expect(normalUses).toBe(9);
        const goal=await post(request,'/api/clan/program',a[0].headers,{action:'claim',contractId:'campaign'});expect(goal.view.contracts.find((entry:Json)=>entry.id==='campaign').claimed).toBe(true);
        await post(request,'/api/_qa/clan-campaign',admin,{action:'open-shrine',warId,instanceId,index:0,sector:12,mode:'pet1v1'});
        for(const player of [a[0],b[0]]){
            const canonical=await save(request,player);const beat=await post(request,'/api/player/heartbeat',player.headers,{name:player.name,sector:12,tile:65,character:canonical.character});expect(beat.sector).toBe(12);
        }
        await page.goto('/#/worldMap');await rival.goto('/#/worldMap');await page.reload();await rival.reload();
        await expect(page.getByRole('button',{name:'Clan Golden Shrine · Open now'})).toBeEnabled();await expect(rival.getByRole('button',{name:'Clan Golden Shrine · Open now'})).toBeEnabled();
        await page.getByRole('button',{name:'Clan Golden Shrine · Open now'}).click();await rival.getByRole('button',{name:'Clan Golden Shrine · Open now'}).click();
        const room=page.getByRole('dialog',{name:'Clan golden shrine interior'}),enemyRoom=rival.getByRole('dialog',{name:'Clan golden shrine interior'});
        await expect(room).toBeVisible();await expect(enemyRoom).toBeVisible();await expect(room.getByRole('heading',{name:'Pet Showdown',exact:true})).toBeVisible();
        // The dialog opens before the server admits either player to its room.
        await expect(room.locator('.clan-shrine-player small').getByText('You',{exact:true})).toBeVisible();
        await expect(enemyRoom.locator('.clan-shrine-player small').getByText('You',{exact:true})).toBeVisible();
        await expect(room.getByRole('heading',{name:'Shinobi Duel',exact:true})).toHaveCount(0);await capture(page,info,'shrine-room');
        const bonus=await pair('pet1v1',[a[0]],[b[0]],{scope:'shrine',windowIndex:0});
        for(const [client,interior] of [[page,room],[rival,enemyRoom]] as const){
            const battle=client.getByRole('heading',{name:'Clan War Pet Battle',exact:true}),enter=interior.getByRole('button',{name:'Enter Battle',exact:true});
            // Existing accepted-match recovery can open either participant's battle.
            await expect(battle.or(enter)).toBeVisible();
            if(await enter.isVisible())await enter.click({timeout:3000}).catch(async error=>{try{await expect(battle).toBeVisible();}catch{throw error;}});
            await expect(battle).toBeVisible();
            await client.getByRole('button',{name:'Send into battle',exact:true}).click();
        }
        await expect.poll(async()=> (await list()).campaignView.matches.find((match:Json)=>match.id===bonus)?.status).toBe('completed');
        expect((await list()).campaignView.normal.clanUsed).toBe(normalUses);
        for(const client of [page,rival])await client.getByRole('button',{name:'Return to Clan War',exact:true}).or(client.getByRole('button',{name:'Leave the Showdown',exact:true})).click();
        await expect(room).toBeVisible();await expect(enemyRoom).toBeVisible();
        await room.getByRole('button',{name:'Leave Shrine',exact:true}).click();await enemyRoom.getByRole('button',{name:'Leave Shrine',exact:true}).click();
        await post(request,'/api/_qa/clan-campaign',admin,{action:'end-clock',warId,instanceId});
        const ended=await list();expect(ended.endedAt).toBeTruthy();expect(ended.campaignView.phase).toBe('ended');expect(ended.winnerClan).toBeTruthy();
        const paid=await save(request,a[0]);expect(paid.character.clanPoints).toBeGreaterThan(500);
        await list();expect((await save(request,a[0])).character.clanPoints).toBe(paid.character.clanPoints);
        expect(ended.winnerClan).toBe(clanA);
        const departure=await post(request,'/api/clan/leave',a[3].headers,{playerName:a[3].name,clan:clanA});
        expect(departure.character.clan).toBeFalsy();
        const crateBody={playerName:a[3].name,warCrateId:ended.warCrateId};
        expect((await post(request,'/api/village/claim-war-crate',a[3].headers,crateBody)).granted).toBe(true);
        expect((await post(request,'/api/village/claim-war-crate',a[3].headers,crateBody)).reason).toBe('already-claimed');
        expect((await post(request,'/api/village/claim-war-crate',b[3].headers,{...crateBody,playerName:b[3].name})).granted).toBe(false);
        const recovering=await request.post('/api/clan/war/declare',{headers:a[0].headers,data:{...declaration,requestId:`clan-journey-rematch-${stamp}`}});
        expect(recovering.status()).toBe(409);expect((await save(request,a[0])).character.honorSeals).toBe(400);
        await expect(page.getByRole('dialog',{name:'Clan golden shrine interior'})).toHaveCount(0);
        await capture(page,info,'returned-to-world');
    }finally{await rivalContext.close();}
});

test('service cancellation refunds once, refuses player authority and allows a new campaign instance',async({request},info)=>{
    test.skip(info.project.name!=='chromium-desktop-live','This API-only authority test runs once; both viewports exercise the full player journey.');
    const a:Player[]=[],b:Player[]=[];
    for(let index=0;index<4;index++){a.push(await seed(request,`sa${index}`));b.push(await seed(request,`sb${index}`));}
    const stamp=uniquePlayerName(value=>`service${value}`),clanA=uniquePlayerName(value=>`qatestsilver${value}`),clanB=uniquePlayerName(value=>`qatestcopper${value}`);
    await post(request,'/api/_qa/clan-campaign',admin,{action:'seed-clans',clans:[{name:clanA,members:a.map(p=>p.name)},{name:clanB,members:b.map(p=>p.name)}]});
    const declaration={toClan:clanB,requestId:`clan-service-declare-${stamp}`,funding:'personal'};
    const first=await post(request,'/api/clan/war/declare',a[0].headers,declaration);
    const cancel={warId:first.war.id,instanceId:first.war.campaignView.instanceId,action:'service-cancel',reason:'Verified fixture service failure.'};
    expect((await request.post('/api/clan/war/queue',{headers:a[0].headers,data:cancel})).status()).toBe(403);
    await post(request,'/api/clan/war/queue',admin,cancel);
    await post(request,'/api/clan/war/queue',admin,cancel);
    const refunded=await save(request,a[0]);expect(refunded.character.honorSeals).toBe(500);expect(refunded.character.clanPoints).toBe(1000);
    const next=await post(request,'/api/clan/war/declare',a[0].headers,{...declaration,requestId:`clan-service-next-${stamp}`});
    expect(next.war.campaignView.instanceId).not.toBe(cancel.instanceId);expect(next.character.honorSeals).toBe(400);
    expect((await request.post('/api/clan/war/queue',{headers:admin,data:cancel})).status()).toBe(409);
    expect((await save(request,a[0])).character.honorSeals).toBe(400);
});
