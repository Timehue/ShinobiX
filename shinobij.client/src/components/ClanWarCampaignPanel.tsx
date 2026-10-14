/* eslint-disable react-hooks/set-state-in-effect -- queue heartbeat and server state reconciliation */
import {useCallback,useEffect,useRef,useState} from 'react';
import {CLAN_WAR_QUEUE_MODES,CLAN_WAR_RULES,clanWarPlayerKey,type ClanWarQueueMode} from '../../../shared/clan-war-campaign';
import {cwQueueAction,type CwWar,type CwChallenge} from '../lib/clan-war-api';
import {GameArtIcon,type GameArtIconKind} from './GameArtIcon';
import '../styles/clan-war-campaign.css';
import {gameConfirm} from './GameAlert';
import {setSectorReopen} from '../lib/sector-return';

const MODES:Record<ClanWarQueueMode,{label:string;icon:GameArtIconKind;detail:string}>={
    pvp1v1:{label:'Shinobi Duel',icon:'attack',detail:'1v1 combat · 100 points per win'},
    pvp2v2:{label:'Shinobi Team Battle',icon:'vanguard',detail:'Two clanmates · 200 points per team win'},
    pet1v1:{label:'Pet Showdown',icon:'petHome',detail:'Pet teams · 100 points per win'},
    tilecards:{label:'Chronicle Showdown',icon:'cardHall',detail:'Card duel · 100 points per win'},
};
function remaining(until:number,now:number):string {
    const seconds=Math.max(0,Math.ceil((until-now)/1000));
    if(seconds<60)return `${seconds}s`;
    const minutes=Math.ceil(seconds/60);if(minutes<60)return `${minutes}m`;
    return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
export function ClanWarCampaignPanel({war:initial,name,clanName,onRefresh,onLaunchBattle,onOpenMap,scope='normal',windowIndex,canProvision=false}:
    {war:CwWar;name:string;clanName:string;onRefresh:()=>Promise<void>;onLaunchBattle?:(challenge:CwChallenge,warId:string)=>void;
        onOpenMap?:()=>void;scope?:'normal'|'shrine';windowIndex?:number;canProvision?:boolean}) {
    const [war,setWar]=useState(initial),[now,setNow]=useState(()=>Date.now()),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const pending=useRef(false),clockOffset=useRef(0);
    useEffect(()=>{setWar(previous=>initial.updatedAt>=previous.updatedAt?initial:previous);},[initial]);
    useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()+clockOffset.current),1000);return()=>window.clearInterval(timer);},[]);
    const act=useCallback(async(action:string,extra:Omit<Parameters<typeof cwQueueAction>[0],'warId'|'action'>={})=>{
        if(pending.current)return;pending.current=true;setBusy(true);setError('');
        try {
            const result=await cwQueueAction({warId:initial.id,action,scope,windowIndex,...extra});
            if(!result.ok)setError(result.error??'The queue could not update.');
            else {if(result.serverNow)clockOffset.current=result.serverNow-Date.now();if(result.war)setWar(previous=>result.war!.updatedAt>=previous.updatedAt?result.war!:previous);await onRefresh();}
        }finally{pending.current=false;setBusy(false);}
    },[initial.id,onRefresh,scope,windowIndex]);
    const view=war.campaignView,me=clanWarPlayerKey(name),ownQueue=view?.queue.find(entry=>entry.players.includes(me));
    const queueId=ownQueue?.id,queueMode=ownQueue?.mode,queueScope=ownQueue?.scope,queueWindow=ownQueue?.windowIndex;
    const waiting=!!ownQueue||!!view?.matches.some(match=>match.status==='ready');
    useEffect(()=>{
        if(!waiting)return;let live=true,inFlight=false;
        const timer=setInterval(async()=>{
            if(inFlight||pending.current)return;inFlight=true;
            try{const response=await cwQueueAction({warId:initial.id,action:'state',scope,windowIndex});
                if(live&&response.ok&&response.war)setWar(previous=>response.war!.updatedAt>=previous.updatedAt?response.war!:previous);
            }finally{inFlight=false;}
        },4000);
        return()=>{live=false;clearInterval(timer);};
    },[waiting,initial.id,scope,windowIndex]);
    useEffect(()=>{
        if(!queueId)return;
        const heartbeat=()=>{void act('heartbeat',{mode:queueMode,scope:queueScope,windowIndex:queueWindow});};
        const timer=window.setInterval(heartbeat,15_000);
        return()=>window.clearInterval(timer);
    },[queueId,queueMode,queueScope,queueWindow,act]);
    if(!view)return null;
    const enemy=war.clans.find(clan=>clan!==clanName)??'',ready=view.matches.find(match=>match.status==='ready'&&match.readyUntil>now);
    const active=view.matches.find(match=>match.status==='active'),challenge=active?war.pendingChallenges.find(entry=>entry.id===active.id):undefined;
    const shrine=scope==='shrine'?view.shrines.find(entry=>entry.index===windowIndex):view.shrines.find(entry=>entry.closesAt>now);
    const preparing=view.phase==='preparing',ended=view.phase==='ended';
    const closedWithoutResult=view.closeReason==='withdrawal'||view.closeReason==='service';
    const closing=scope==='shrine'?!!shrine&&now>=shrine.closesAt-CLAN_WAR_RULES.admissionBufferMs:now>=view.endsAt-CLAN_WAR_RULES.admissionBufferMs;
    const locked=busy||!view.eligible||preparing||ended||!!ready||!!active||closing;
    const clanLeft=Math.max(0,view.normal.clanLimit-view.normal.clanUsed),memberLeft=Math.max(0,view.normal.memberLimit-view.normal.memberUsed);
    return <section className="clan-campaign" aria-label="Clan war campaign">
        <header className="clan-campaign-banner"><GameArtIcon kind="attack" size={38}/><div><span className="clan-campaign-kicker">{scope==='shrine'?'Golden Shrine':preparing?'Preparation':ended?'Campaign Result':`War Day ${(view.normal.day??0)+1} of 3`}</span><h3>{clanName} <span>vs</span> {enemy}</h3></div>
            <div className="clan-campaign-clock">{ended?'War complete':`${preparing?'Fighting begins':'Campaign ends'} in ${remaining(preparing?view.startsAt:view.endsAt,now)}`}</div></header>
        <div className="clan-campaign-score" aria-label="War Points"><div><span>{clanName}</span><strong>{(view.scores[clanName]??0).toLocaleString()}</strong></div><span>WAR POINTS</span><div><span>{enemy}</span><strong>{(view.scores[enemy]??0).toLocaleString()}</strong></div></div>
        {ended?<p className="clan-campaign-result" role="status">{closedWithoutResult?view.closeReason==='service'?'Campaign closed for a service failure. The declaration fee is returned to its original source.':'Campaign closed during preparation. No competitive result was recorded.':view.winnerClan?`${view.winnerClan} wins the campaign.`:'The campaign ends in a draw.'} {(view.playerContribution?.played??0)>0?'Your earned participation remains saved.':'Play a scored battle to earn participation rewards in your next war.'}</p>:<p className="clan-campaign-budget">{scope==='shrine'?`${Math.max(0,(shrine?.matchLimit??0)-(shrine?.usedMatches??0))} shared bonus matches remain · ${Math.max(0,(shrine?.memberLimit??0)-(shrine?.memberUsed??0))} personal attempts`:`${clanLeft} clan slots · ${memberLeft} personal slots remain today`}<small>{scope==='shrine'?'Each victory earns 100 bonus War Points.':'1v1 uses one clan slot. A 2v2 uses two. All modes share the daily limits.'}</small></p>}
        {!view.eligible&&<p role="status" className="hint">This war uses the roster sealed at declaration. Prepare with your clan for the next campaign.</p>}
        {preparing&&<p className="hint">Build your decks, ready your pets and arrange a 2v2 partner. Queues open when preparation ends.</p>}
        {scope==='normal'&&!preparing&&!ended&&<div className="clan-campaign-provisions"><span>{view.provisioned?'Provisioned · +10% match Clan Points today':'Optional provisions · 30 clan rations for +10% match Clan Points today'}</span>{!view.provisioned&&canProvision&&<button disabled={busy} onClick={()=>void act('provisions')}>Authorize Provisions</button>}<small>Leadership authorizes the expense. War Points and participation limits stay the same.</small></div>}
        {closing&&!ended&&<p className="hint">New matches have stopped for closing. Admitted battles can finish before the deadline.</p>}
        {error&&<p role="alert" className="clan-campaign-error">{error}</p>}
        {ready&&<section className="clan-campaign-ready" aria-label="Ready check"><h4 role="status">Match found · {MODES[ready.mode].label}</h4><p>{ready.fromPlayers.join(' + ')} vs {ready.toPlayers.join(' + ')} · {remaining(ready.readyUntil,now)} to confirm</p><div className="menu"><button disabled={busy||ready.readyPlayers.includes(me)} onClick={()=>void act('ready',{matchId:ready.id})}>{ready.readyPlayers.includes(me)?'Confirmed · waiting for opponents':'Ready to Battle'}</button><button disabled={busy} onClick={()=>void act('decline',{matchId:ready.id})}>Decline</button></div><small>Attempts are spent when everyone confirms.</small></section>}
        {active&&<section className="clan-campaign-ready"><h4>{MODES[active.mode].label} is ready</h4><p>Your match is reserved. Return to it if the battle screen was interrupted.</p><button disabled={!challenge||!onLaunchBattle} onClick={()=>challenge&&onLaunchBattle?.(challenge,war.id)}>Enter Battle</button></section>}
        {!ended&&<div className="clan-campaign-modes">{CLAN_WAR_QUEUE_MODES.filter(mode=>scope==='normal'||mode===shrine?.mode).map(mode=>{
            const details=MODES[mode],partners=view.queue.filter(entry=>entry.mode==='pvp2v2'&&entry.players.length===1&&!entry.players.includes(me));
            const selected=ownQueue?.mode===mode&&ownQueue.scope===scope;
            const exhausted=scope==='normal'?(memberLeft<1||clanLeft<(mode==='pvp2v2'?2:1)):!shrine||shrine.usedMatches>=shrine.matchLimit||shrine.memberUsed>=shrine.memberLimit;
            return <article key={mode} className={`clan-campaign-mode${selected?' is-queued':''}`}><GameArtIcon kind={details.icon} size={36}/><div><h4>{details.label}</h4><p>{scope==='shrine'?'100 bonus points per victory':details.detail}</p><small>{(scope==='shrine'?view.enemyShrineQueueCounts?.[String(windowIndex)]?.[mode]:view.enemyQueueCounts[mode])??0} rival players waiting</small></div>
                <div className="clan-campaign-mode-actions"><button disabled={busy||(!selected&&(locked||!!ownQueue||exhausted))} onClick={()=>void act(selected?'leave':'join',{mode})}>{selected?'Leave Queue':mode==='pvp2v2'?'Open Partner Slot':'Join Queue'}</button>
                    {mode==='pvp2v2'&&!ownQueue&&partners.map(partner=><button key={partner.id} disabled={locked||exhausted} onClick={()=>void act('join',{mode,partnerEntryId:partner.id})}>Team with {partner.players[0]}</button>)}
                    {selected&&<span role="status">{mode==='pvp2v2'&&ownQueue.players.length===1?'Waiting for a clanmate':'Finding an opposing clan match…'}</span>}</div></article>;
        })}</div>}
        {scope==='normal'&&shrine&&!ended&&<section className="clan-campaign-shrine"><GameArtIcon kind="gate" size={32}/><div><h4>Golden Shrine · {shrine.state==='open'?'Open now':`opens in ${remaining(shrine.opensAt,now)}`}</h4><p>{shrine.sector?`Sector ${shrine.sector}`:'Location revealed before opening'} · {shrine.mode?MODES[shrine.mode].label:'Battle rules revealed before opening'}</p><small>Travel to the shrine to enter its bonus queue. Six appearances, with each battle specialty appearing twice.</small></div>{onOpenMap&&<button onClick={()=>{if(shrine.sector)setSectorReopen(shrine.sector);onOpenMap();}}>Open World Map</button>}</section>}
        <details className="clan-campaign-guide"><summary>Scoring and rewards</summary><p>Win normal battles for 100 War Points per winning shinobi. Shrine victories add 100 bonus points. The higher score after 72 hours wins; equal scores draw. Defeats and draws consume attempts.</p><p>Played battles award {CLAN_WAR_RULES.participationPoints} Clan Points, plus {CLAN_WAR_RULES.matchWinPoints} for a win. Winning participants earn {CLAN_WAR_RULES.victoryPoints} more and a Legendary War Crate. All Clan Points share the weekly cap.</p></details>
        <details className="clan-campaign-guide"><summary>Sealed war rosters</summary>{view.eligibleRosters?.map(roster=><section key={roster.clan}><h4>{roster.clan} · {roster.members.length} eligible members</h4><p>{roster.members.map(member=>`${member.name} · Lv ${member.level}`).join(' / ')}</p></section>)}</details>
        {!!view.contributions.length&&<details className="clan-campaign-guide"><summary>Your clan’s contributions</summary><ul>{view.contributions.slice().sort((a,b)=>b.normalPoints+b.shrinePoints-a.normalPoints-a.shrinePoints).map(member=><li key={member.name}><strong>{member.name}</strong> · {member.played} battles · {member.normalPoints+member.shrinePoints} War Points</li>)}</ul></details>}
        {canProvision&&!ended&&scope==='normal'&&<details className="clan-campaign-guide"><summary>Leadership controls</summary><p>{preparing?'Closing during preparation burns the declaration fee. Both clans receive the normal recovery and rematch cooldown, with no victory rewards.':'Surrender ends the campaign and gives the rival the victory. Already earned participation remains saved.'}</p><button disabled={busy} onClick={async()=>{
            const action=preparing&&view.declaringClan===clanName?'withdraw':'surrender';
            if(await gameConfirm(preparing?'End this campaign during preparation? The declaration fee stays spent and no victory rewards are awarded.':'Surrender this clan war? The rival wins, and your clan enters recovery.'))void act(action);
        }}>{preparing&&view.declaringClan===clanName?'Withdraw Declaration':preparing?'Concede Preparation':'Surrender Campaign'}</button></details>}
    </section>;
}
