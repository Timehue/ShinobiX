/* eslint-disable react-hooks/set-state-in-effect -- physical room and campaign polling */
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {cwListWars,cwQueueAction,warmClanWarActions,type ClanShrineRoomView,type CwWar,type CwChallenge} from '../../lib/clan-war-api';
import {visiblePoll} from '../../lib/poll';
import {resolveOwnAvatar} from '../../lib/own-avatar';
import {sharedAvatarFor} from '../../lib/shared-avatar';
import {onShrineFloor,shrineKeyStep,shrineTileToward,useHeldMovementKey} from '../../lib/held-movement-keys';
import {formatPetTimer} from '../../lib/utils';
import {clanWarPlayerKey} from '../../../../shared/clan-war-campaign';
import {setSectorReopen} from '../../lib/sector-return';
import type {Character} from '../../types/character';
import {ClanWarCampaignPanel} from '../../components/ClanWarCampaignPanel';
import './clan-shrine.css';

const REOPEN='clan.shrineReopen';
/** Non-breaking spaces keep a status part whole, so a phone wraps between parts, never inside one. */
const unbroken=(part:string)=>part.replace(/ /g,' ');
export function ClanShrineGateway({character,sector,present,blocked,sharedImages,onLaunchBattle,onRoomOpen}:
    {character:Character;sector:number;present:boolean;blocked:boolean;sharedImages:Record<string,string>;
        onLaunchBattle?:(challenge:CwChallenge,warId:string)=>void;
        /** The room covers the world: the map pauses its drawing while this is true, as it does under the village war shrine. */
        onRoomOpen:(open:boolean)=>void}) {
    const [wars,setWars]=useState<CwWar[]>([]),[now,setNow]=useState(()=>Date.now()),[open,setOpen]=useState<{warId:string;index:number}|null>(null);
    useEffect(()=>visiblePoll(async()=>{const next=await cwListWars();setWars(next);setNow(Date.now());},15_000,0.1,{immediate:true}),[]);
    useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
    const relevant=wars.filter(war=>war.clans.includes(character.clan??'')&&!war.endedAt&&war.campaignView?.eligible);
    const entrances=relevant.flatMap(war=>war.campaignView!.shrines.filter(window=>window.sector===sector&&now<window.closesAt).slice(0,1).map(window=>({war,window})));
    const enterable=present&&entrances.some(entry=>entry.window.state==='open');
    useEffect(()=>{if(enterable)warmClanWarActions();},[enterable]);
    useEffect(()=>{
        if(!present||blocked||open)return;
        try{const value=JSON.parse(sessionStorage.getItem(REOPEN)??'null') as {warId?:string;index?:number}|null;
            const entrance=entrances.find(entry=>entry.war.id===value?.warId&&entry.window.index===value?.index&&entry.window.state==='open');
            if(entrance){sessionStorage.removeItem(REOPEN);setOpen({warId:entrance.war.id,index:entrance.window.index});}
        }catch{/* The entrance still works if navigation storage is unavailable. */}
    },[present,blocked,open,entrances]);
    const selected= open?relevant.find(war=>war.id===open.warId):undefined;
    // WorldMap passes its state setter, which React keeps stable, so this runs only when the room opens or closes.
    const roomOpen=!!(selected&&open);
    useEffect(()=>{if(!roomOpen)return;onRoomOpen(true);return()=>onRoomOpen(false);},[roomOpen,onRoomOpen]);
    return <>{entrances.map(({war,window},index)=>{const status=window.state==='open'?'Open now':`Opens in ${formatPetTimer(Math.max(1e3,window.opensAt-now))}`;
        return <button key={`${war.id}:${window.index}`} type="button" className="clan-shrine-entrance"
        style={{left:`${50+index*16}%`}} disabled={!present||blocked||window.state!=='open'}
        aria-label={`Clan Golden Shrine · ${window.state==='open'?'Open now':'Opens soon'}`}
        title={!present?`Travel to Sector ${sector} to enter.`:`${war.clans.join(' vs ')} · ${status}`}
        onClick={()=>setOpen({warId:war.id,index:window.index})}><img src="/ui/village-war/war-shrine-landmark-gold-v1.webp" alt="" draggable={false}/><span>Clan Golden Shrine<br/>{status}</span></button>;})}
        {roomOpen&&createPortal(<ClanShrineRoom character={character} initialWar={selected} index={open.index} sharedImages={sharedImages}
            onExit={()=>setOpen(null)} onLaunchBattle={onLaunchBattle}/>,document.body)}</>;
}
function ClanShrineRoom({character,initialWar,index,sharedImages,onExit,onLaunchBattle}:
    {character:Character;initialWar:CwWar;index:number;sharedImages:Record<string,string>;onExit:()=>void;
        onLaunchBattle?:(challenge:CwChallenge,warId:string)=>void}) {
    const [war,setWar]=useState(initialWar),[room,setRoom]=useState<ClanShrineRoomView>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(()=>Date.now());
    const entered=useRef(false),pending=useRef(false),mounted=useRef(false),dialog=useRef<HTMLDialogElement>(null),walkPending=useRef(false);
    // One step is in flight at a time and the latest tap waits behind it. The
    // avatar shows on the step's tile at once, not a round trip later, and a
    // poll whose request overlapped any step cannot pull it back.
    const queued=useRef<number|null>(null),steps=useRef(0),[stepping,setStepping]=useState<number|null>(null);
    const leaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
    const refresh=useCallback(async()=>{
        // A poll that starts mid-step can reach the queue lock before the step and answer with the old tile.
        if(pending.current)return;pending.current=true;const sent=walkPending.current?-1:steps.current;
        try{const result=await cwQueueAction({warId:initialWar.id,action:entered.current?'shrine-state':'shrine-enter',scope:'shrine',windowIndex:index});
            if(!mounted.current)return;
            if(!result.ok){setError(result.error??'The shrine could not be reached.');return;}
            entered.current=true;if(result.war)setWar(result.war);if(result.room&&steps.current===sent&&!walkPending.current)setRoom(result.room);setNow(result.serverNow??Date.now());setError('');
        }finally{pending.current=false;}
    },[index,initialWar.id]);
    useEffect(()=>{
        if(leaveTimer.current!==undefined){clearTimeout(leaveTimer.current);leaveTimer.current=undefined;}
        mounted.current=true;const element=dialog.current;if(element&&!element.open){element.showModal();
            // Start on the courtyard, so the arrow keys walk at once (on a button they move focus).
            element.querySelector<HTMLElement>('[role=group]')?.focus();}
        const stop=visiblePoll(refresh,5_000,0.1,{immediate:true}),timer=setInterval(()=>setNow(value=>value+1000),1000);
        return()=>{mounted.current=false;stop();clearInterval(timer);element?.close();
            // Strict Mode immediately remounts the same room effect. Only a real
            // departure sends leave; an admitted battle retains its server visit.
            leaveTimer.current=setTimeout(()=>{void cwQueueAction({warId:initialWar.id,action:'shrine-leave',scope:'shrine',windowIndex:index});},0);};
    },[initialWar.id,index,refresh]);
    const mine=clanWarPlayerKey(character.name),window=war.campaignView!.shrines.find(entry=>entry.index===index)!,me=room?.players.find(player=>player.name===mine);
    const matchesLeft=Math.max(0,window.matchLimit-window.usedMatches);
    const active=war.campaignView!.matches.some(match=>match.scope==='shrine'&&match.windowIndex===index&&match.status==='active');
    const closed=now>=window.closesAt,avatar=resolveOwnAvatar(character,sharedImages),own=stepping??me?.tile??0;
    const held=useHeldMovementKey();
    async function leave(){if(pending.current||active)return;setBusy(true);const response=await cwQueueAction({warId:war.id,action:'shrine-leave',scope:'shrine',windowIndex:index});setBusy(false);if(response.ok)onExit();else setError(response.error??'Could not leave the shrine.');}
    async function walk(tile:number){
        if(!me||active||closed||me.inBattle)return;
        queued.current=tile;if(walkPending.current)return;
        walkPending.current=true;
        try{while(mounted.current&&queued.current!==null){
            const next:number=queued.current;queued.current=null;setStepping(next);steps.current++;
            const response=await cwQueueAction({warId:war.id,action:'shrine-walk',scope:'shrine',windowIndex:index,tile:next});
            // A refused step (the window just closed, a match began) only ends the walk. The next
            // poll shows what changed, or the connection error, so walking never raises a banner.
            if(!mounted.current||!response.ok)return;
            if(response.room)setRoom(response.room);setError('');
            // A key still held walks on from the tile just reached, without waiting out the OS key repeat.
            const ahead=shrineTileToward(held.current,next);
            if(queued.current===null&&ahead>=0)queued.current=ahead;
        }}finally{walkPending.current=false;queued.current=null;if(mounted.current)setStepping(null);}
    }
    function launch(challenge:CwChallenge,warId:string){
        try{sessionStorage.setItem(REOPEN,JSON.stringify({warId,index}));setSectorReopen(window.sector??null);}catch{/* Navigation remains available. */}
        onLaunchBattle?.(challenge,warId);
    }
    return <dialog ref={dialog} className="clan-shrine-dialog" aria-label="Clan golden shrine interior" onCancel={event=>{event.preventDefault();void leave();}}>
        <section className="clan-shrine-room" onKeyDown={event=>{
            // Anywhere in the room, so WASD and the arrows work without first focusing the courtyard.
            const tile=me?shrineKeyStep(event,held,own):-1;if(tile>=0)void walk(tile);
        }}><header><div><span className="clan-campaign-kicker">{war.clans.join(' vs ')}</span><h2>Golden War Shrine</h2></div><button disabled={busy||active} onClick={()=>void leave()}>Leave shrine</button></header>
            <p role="status">{[`Sector ${window.sector}`,closed?'Shrine closed':`Closes in ${formatPetTimer(window.closesAt-now)}`,`${matchesLeft} bonus ${matchesLeft===1?'match':'matches'} left`].map(unbroken).join(' · ')}</p>
            {error&&<p role="alert">{error} {!closed&&<button disabled={busy} onClick={()=>{entered.current=false;void refresh();}}>Re-enter shrine</button>}</p>}
            <div className="clan-shrine-layout"><div><div className="clan-shrine-floor" tabIndex={0} role="group" aria-label="Shrine courtyard"><img src="/ui/village-war/war-shrine-floor-gold-v1.webp" alt="Overhead golden shrine courtyard"/><div className="clan-shrine-tiles">{Array.from({length:144},(_,tile)=><button key={tile} tabIndex={-1} aria-label={`Walk to tile ${tile%12+1}, ${Math.floor(tile/12)+1}`}
                disabled={!me||closed||active||!onShrineFloor(tile)
                    ||Math.abs(tile%12-own%12)+Math.abs(Math.floor(tile/12)-Math.floor(own/12))>1} onClick={()=>void walk(tile)}/>)}</div>
                {room?.players.map(player=>{const tile=player===me?own:player.tile,portrait=player===me?avatar:sharedAvatarFor(sharedImages,player.displayName);return <span key={player.name} className={`clan-shrine-player ${player.clan===character.clan?'is-ally':'is-rival'}`}
                    style={{left:`${(tile%12+.5)/12*100}%`,top:`${(Math.floor(tile/12)+.5)/12*100}%`}}>
                    {portrait?<img src={portrait} alt=""/>:<b>{player.displayName.slice(0,2).toUpperCase()}</b>}<small>{player===me?'You':`${player.displayName} · ${player.clan===character.clan?'Ally':'Rival'}`}</small></span>;})}</div>
                <p className="hint">Select a nearby tile, or move with WASD or the arrow keys. A bonus match can begin once both clans are inside.</p>
                <details><summary>Players inside · {room?.players.length??0}</summary><ul>{room?.players.map(player=><li key={player.name}>{player.displayName} · {player.clan}{player.inBattle?' · fighting':''}</li>)}</ul></details></div>
                {room?<ClanWarCampaignPanel war={war} name={character.name} clanName={character.clan??''} scope="shrine" windowIndex={index}
                    onRefresh={refresh} onLaunchBattle={launch}/>:<p role="status">Entering the shrine…</p>}</div>
        </section></dialog>;
}
