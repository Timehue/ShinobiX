import {expect,test} from '@playwright/test';
import {installUiAuditRuntime,uiAuditSave} from './helpers/ui-audit-runtime';
import {createClanWarCampaign,projectClanWarCampaign,CLAN_WAR_RULES,closeClanWarCampaign} from '../../shared/clan-war-campaign';

for(const phase of ['preparing','active','service'] as const){
test(`clan campaign ${phase} is readable and exposes only available actions`,async({page},info)=>{
    const now=Date.now(),save=uiAuditSave();save.character={...save.character,clan:'Shadow Cell',clanFounder:true};
    await installUiAuditRuntime(page,save);
    const rosters:[{clan:string;members:Array<{name:string;level:number}>},{clan:string;members:Array<{name:string;level:number}>}]=[
        {clan:'Shadow Cell',members:['auditninja','rei','kuro','mei'].map(name=>({name,level:85}))},
        {clan:'Ember',members:['enemy1','enemy2','enemy3','enemy4'].map(name=>({name,level:85}))},
    ];
    const clan={name:'Shadow Cell',village:'Stormveil Village',founderName:'AuditNinja',level:25,xp:300,treasury:{ryo:25000,warSupply:10,provisions:90,items:[]},
        createdAt:now-10*86400000,members:rosters[0].members.map(member=>({...member,village:'Stormveil Village',month:new Date().toISOString().slice(0,7)})),
        roleOverrides:{},joinRequests:[],notices:[],warHistory:[]};
    let campaign=createClanWarCampaign({instanceId:'cw2-ui-audit-00001',now:phase==='preparing'?now:now-CLAN_WAR_RULES.preparationMs,
        rosters,sectors:Array(6).fill(12),offsets:Array(6).fill(0),modes:['pet1v1','tilecards','pvp1v1','pvp1v1','pet1v1','tilecards']});
    if(phase==='service')campaign=closeClanWarCampaign(campaign,now,'service');
    const war={id:'ember-vs-shadowcell',clans:['Ember','Shadow Cell'],villages:{},hp:{Ember:1000,'Shadow Cell':1000},startedAt:campaign.declaredAt,updatedAt:now,
        ...(phase==='service'?{endedAt:now}:{}),declaredBy:'auditninja',pendingChallenges:[],completedChallenges:[],campaignView:projectClanWarCampaign(campaign,'Shadow Cell','auditninja',now)};
    await page.route('**/api/save/clan-shadowcell',route=>route.fulfill({json:clan}));
    await page.route('**/api/clan/war/list',route=>route.fulfill({json:{wars:[war]}}));
    await page.route('**/api/clan/program',route=>route.fulfill({json:{view:{clan:clan.name,weekKey:'2026-W42',resetsAt:now+7*86400000,serverNow:now,
        contracts:[{id:'campaign',progress:0,contributors:[],claimed:false,available:true},{id:'operation',progress:0,contributors:[],claimed:false,available:true}],
        project:{progress:0,memberUsed:0,completed:false,completedProjects:0,hallRestored:false},assignments:{}}}}));
    await page.goto('/#/clan',{waitUntil:'domcontentloaded'});await expect(page.locator('.clan-overview')).toBeVisible();
    const dismiss=page.locator('.screen-hint-dismiss');if(await dismiss.isVisible())await dismiss.click();
    await expect(page.getByRole('heading',{name:'Weekly contracts',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(`overview-${phase}.png`),fullPage:true});
    await page.getByRole('button',{name:'Wars',exact:true}).click();
    const panel=page.getByRole('region',{name:'Clan war campaign'});await expect(panel).toBeVisible();
    if(phase==='service'){
        await expect(panel.getByRole('status')).toContainText('Campaign closed for a service failure');
        await expect(panel.getByRole('button',{name:'Join Queue',exact:true})).toHaveCount(0);
    }else{
        for(const mode of ['Shinobi Duel','Shinobi Team Battle','Pet Showdown','Chronicle Showdown'])await expect(panel.getByRole('heading',{name:mode,exact:true})).toBeVisible();
        const queues=panel.getByRole('button',{name:'Join Queue',exact:true});expect(await queues.count()).toBe(3);
        for(const queue of await queues.all()){if(phase==='preparing')await expect(queue).toBeDisabled();else await expect(queue).toBeEnabled();}
        await expect(panel.getByRole('button',{name:'Open Partner Slot',exact:true})).toBeVisible();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`war-${phase}.png`),fullPage:true});
});
}
