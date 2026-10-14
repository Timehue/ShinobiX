import type {ApiRequest,ApiResponse} from './_vercel.js';
import {isFullAdmin} from './_auth.js';
import {kv} from './_storage.js';
import {withKvLock} from './_lock.js';
import {safeName,clanRecordKey,clanBareSlug} from './_utils.js';
import {mutatePlayerSave} from './save/_mutate-player-save.js';
import {retryOnSaveVersionConflict} from './save/_projected-write.js';
import {CLAN_WAR_RULES,type ClanWarShrineMode} from '../shared/clan-war-campaign.js';
import {isPlayableWildSector} from '../shared/sector-geo.js';
import {reconcileClanWarCampaign} from './clan/war/_campaign-reconcile.js';
import type {ClanWar} from './clan/war/_storage.js';
import {worldPositionModel} from '../shared/continuous-world-layout.js';
import {onlineStore} from './_realtime/online-store.js';
import {walkedTileKey} from './_realtime/walked-tile.js';
import {travelLeaseKey} from './_realtime/travel-lease.js';

/** No production mount. Only advances time/position in the disposable QA store.
 * It cannot invent results, scores, currencies, or reward eligibility.
 */
export function clanCampaignQaEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
    return env.NODE_ENV==='test'&&env.SHINOBIX_QA_MEMORY_KV==='1'&&env.CLAN_CAMPAIGN_QA==='1';
}
export default async function handler(req:ApiRequest,res:ApiResponse){
    res.setHeader('Cache-Control','no-store');
    if(!clanCampaignQaEnabled())return res.status(404).json({error:'Not found.'});
    if(req.method!=='POST')return res.status(405).end();
    if(!isFullAdmin(req))return res.status(403).json({error:'Admin only.'});
    try{
        const body=typeof req.body==='string'?JSON.parse(req.body):req.body??{},now=Date.now();
        if(body.action==='seed-clans'){
            const sides=body.clans;
            if(!Array.isArray(sides)||sides.length!==2)return res.status(400).json({error:'Two clans are required.'});
            const allNames:string[]=[],records:Array<{name:string;members:string[];village:string}>=[];
            for(const side of sides){
                const name=String(side.name??'');
                if(!/^qatest[a-z0-9]{3,25}$/.test(name)||!Array.isArray(side.members)||side.members.length!==4)return res.status(400).json({error:'Choose two fresh QA clan names and four registered members each.'});
                const members=side.members.map((entry:unknown)=>safeName(String(entry))),saves=await kv.mget<Record<string,any>[]>(...members.map((member:string)=>`save:${member}`));
                const auth=await kv.mget(...members.map((member:string)=>`auth:${member}`));
                if(members.some((member:string,index:number)=>!member||!saves[index]?.character||!auth[index]||saves[index].character.level<15)
                    ||new Set(members).size!==4||await kv.get(clanRecordKey(name)))return res.status(409).json({error:'Fresh registered level-15 accounts and unused clan names are required.'});
                if(saves.some(save=>save!.character.village!==saves[0]!.character.village||save!.character.clan))return res.status(409).json({error:'QA members must share a village and have no clan.'});
                allNames.push(...members);records.push({name,members,village:String(saves[0]!.character.village)});
            }
            if(new Set(allNames).size!==8||clanBareSlug(records[0].name)===clanBareSlug(records[1].name))return res.status(400).json({error:'Eight distinct accounts and two distinct clans are required.'});
            const createdAt=now-10*86_400_000;
            if(!kv.compareSetMany||!(await kv.compareSetMany(records.map(side=>({op:'cas' as const,key:clanRecordKey(side.name),expected:null,value:{
                name:side.name,village:side.village,founderName:side.members[0],createdAt,serverCreatedAt:createdAt,qaCampaignFixture:true,
                members:side.members.map(name=>({name,level:15})),memberJoinedAt:Object.fromEntries(side.members.map(name=>[name,createdAt])),
                xp:0,level:40,treasury:{ryo:0,warSupply:0,items:[],provisions:90},upgrades:{},notices:[],joinRequests:[],warHistory:[],
            }})))))throw new Error('QA clans changed before setup.');
            for(const side of records)for(const name of side.members){
                const written=await retryOnSaveVersionConflict(()=>mutatePlayerSave(name,({character})=>({ok:true,
                    character:{...character,clan:side.name,clanFounder:name===side.members[0]},value:undefined})));
                if(!written.ok)throw new Error('A QA member disappeared during setup.');
            }
            return res.status(200).json({ok:true});
        }
        const warId=String(body.warId??''),instanceId=String(body.instanceId??'');
        if(!/^[a-z0-9-]{3,100}$/.test(warId))return res.status(400).json({error:'Choose a valid campaign.'});
        const key=`clan-war:${warId}`;
        const war=await withKvLock(key,async()=>{
            const current=await kv.get<ClanWar>(key);
            if(!current?.campaign||current.campaign.instanceId!==instanceId||current.endedAt)throw new Error('The QA campaign is unavailable.');
            const clans=await kv.mget<Record<string,unknown>[]>(...current.clans.map(clanRecordKey));
            if(clans.some(clan=>clan?.qaCampaignFixture!==true))throw new Error('Only the disposable fixture clans can be advanced.');
            let campaign={...current.campaign};
            if(body.action==='advance'){
                if(Object.keys(campaign.matches).length||campaign.startsAt<=now)throw new Error('Only untouched preparation can be advanced.');
                const delta=now-1000-campaign.startsAt;
                campaign={...campaign,startsAt:campaign.startsAt+delta,endsAt:campaign.endsAt+delta,
                    shrines:campaign.shrines.map(shrine=>({...shrine,opensAt:shrine.opensAt+delta,closesAt:shrine.closesAt+delta}))};
            }else if(body.action==='open-shrine'){
                const index=Number(body.index),sector=Number(body.sector),mode=String(body.mode) as ClanWarShrineMode;
                if(!Number.isInteger(index)||index<0||index>=6||!isPlayableWildSector(sector)||!['pvp1v1','pet1v1','tilecards'].includes(mode))throw new Error('Choose a valid shrine fixture.');
                if(campaign.shrines[index].usedMatches||Object.values(campaign.matches).some(match=>match.scope==='shrine'&&match.windowIndex===index))throw new Error('A used appearance cannot be reset.');
                const cycle=Math.floor(index/3)*3,swap=campaign.shrines.slice(cycle,cycle+3).find(shrine=>shrine.mode===mode)!;
                const previous=campaign.shrines[index].mode;
                campaign={...campaign,shrines:campaign.shrines.map(shrine=>shrine.index===index?{...shrine,mode,sector,opensAt:now-30_000,closesAt:now+CLAN_WAR_RULES.shrineWindowMs}
                    :shrine.index===swap.index?{...shrine,mode:previous}:shrine)};
            }else if(body.action==='end-clock'){
                if(Object.values(campaign.matches).some(match=>match.status==='active'||match.status==='ready'))throw new Error('Finish admitted battles before advancing the deadline.');
                campaign={...campaign,endsAt:now-1};
            }else throw new Error('Unknown QA action.');
            const next={...current,campaign,updatedAt:now};
            if(!(await kv.compareSet(key,current,next)))throw new Error('QA campaign changed during the clock advance.');
            return next;
        },{failClosed:true});
        if(body.action==='open-shrine')for(const roster of war.campaign!.rosters)for(const member of roster.members){
            const result=await retryOnSaveVersionConflict(()=>mutatePlayerSave(member.name,({character})=>({ok:true,character,value:undefined,
                recordPatch:{currentSector:Number(body.sector),currentTile:65,worldGeoV:2,worldPosition:worldPositionModel().fallback(Number(body.sector),65)}})));
            if(!result.ok)throw new Error('A QA member disappeared before shrine positioning.');
            // Existing live/last-walk cursors are also authority. A fixture-only
            // position reset must discard those exact accounts' earlier cursor,
            // so the next heartbeat cold-starts from the versioned position.
            await kv.del(walkedTileKey(member.name),travelLeaseKey(member.name));
            onlineStore.remove(member.name);
        }
        if(body.action==='end-clock')await reconcileClanWarCampaign(war.id,now);
        return res.status(200).json({ok:true});
    }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Invalid QA fixture.'});}
}
