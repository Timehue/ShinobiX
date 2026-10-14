import {useCallback,useEffect,useRef,useState} from 'react';
import {CLAN_ASSIGNMENTS,CLAN_CONTRACTS,CLAN_PROJECT,type ClanAssignment,type ClanProgramView} from '../../../shared/clan-program';
import {COMMON_GATHER_IDS,GATHER_NAMES} from '../../../shared/gathering-materials';
import type {Character,VersionedCharacterCommit} from '../types/character';
import type {EnhancedClanData} from '../types/clan';
import type {MentorView} from '../lib/clan-mentor';
import {cwListWars,type CwWar} from '../lib/clan-war-api';
import {inventoryItemStacks} from '../lib/items';
import {GameArtIcon} from './GameArtIcon';
import {gameConfirm} from './GameAlert';
import '../styles/clan-overview.css';

type OverviewTab='wars'|'boss'|'mentor'|'missions'|'notices'|'treasury';
type PendingFund={clan:string;itemId:string;count:number;requestId:string};
export function ClanOverview({character,clan,mentor,bossAvailable,onOpen,onVersionedCharacter,onClanChanged,canManage}:{
    character:Character;clan:EnhancedClanData;mentor:MentorView|null;bossAvailable:boolean;onOpen:(tab:OverviewTab)=>void;
    onVersionedCharacter:VersionedCharacterCommit;onClanChanged:()=>Promise<void>;canManage:boolean;
}){
    const [view,setView]=useState<ClanProgramView|null>(null),[war,setWar]=useState<CwWar|null>(null);
    const [error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
    const [itemId,setItemId]=useState<string>(COMMON_GATHER_IDS[0]),[count,setCount]=useState(1),[member,setMember]=useState(character.name);
    const [pending,setPending]=useState<PendingFund|null>(()=>{
        try{const value=JSON.parse(localStorage.getItem(`clan.project.pending:${character.name}`)??'null') as PendingFund|null;
            return value&&typeof value.requestId==='string'&&COMMON_GATHER_IDS.some(id=>id===value.itemId)&&Number.isInteger(value.count)?value:null;
        }catch{return null;}
    });
    const alive=useRef(true),inFlight=useRef(false),generation=useRef(0);
    const reload=useCallback(async()=>{
        const stamp=++generation.current;
        try{
            const res=await fetch('/api/clan/program',{cache:'no-store'}),data=await res.json();
            if(!res.ok)throw new Error(data.error??'Shared goals could not load.');
            if(alive.current&&stamp===generation.current){setView(data.view);setReady(true);setError('');}
        }catch(error){if(alive.current&&stamp===generation.current){setReady(true);setError(error instanceof Error?error.message:'Shared goals could not load.');}}
    },[]);
    useEffect(()=>{
        alive.current=true;let active=true;
        const start=window.setTimeout(()=>void reload(),0);
        void cwListWars().then(wars=>{if(active)setWar(wars.find(entry=>entry.clans.includes(clan.name)&&!entry.endedAt)??null);});
        return()=>{active=false;alive.current=false;generation.current+=1;window.clearTimeout(start);};
    },[clan.name,reload]);
    async function act(input:Record<string,unknown>){
        if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');generation.current+=1;
        try{
            const res=await fetch('/api/clan/program',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
            const data=await res.json();
            if(!res.ok){
                if(input.action==='fund'&&data.refunded){localStorage.removeItem(`clan.project.pending:${character.name}`);if(alive.current)setPending(null);}
                throw new Error(data.error??'The clan action could not finish.');
            }
            if(data.character&&Number.isFinite(data._saveVersion))onVersionedCharacter(data.character,data._saveVersion);
            if(input.action==='fund'){localStorage.removeItem(`clan.project.pending:${character.name}`);if(alive.current)setPending(null);}
            if(alive.current&&data.view)setView(data.view);await onClanChanged();
        }catch(error){if(alive.current)setError(error instanceof Error?error.message:'The clan action could not finish.');}
        finally{inFlight.current=false;if(alive.current)setBusy(false);}
    }
    async function fund(){
        if(inFlight.current)return;
        let payment=pending;
        if(!payment){
            if(!await gameConfirm(`Use ${count} ${GATHER_NAMES[itemId]} for the shared Hall project? These materials are consumed.`,{title:'Contribute to the Hall'}))return;
            payment={clan:clan.name,itemId,count,requestId:`clan-project-${crypto.randomUUID().replaceAll('-','')}`};
            try{localStorage.setItem(`clan.project.pending:${character.name}`,JSON.stringify(payment));}catch{setError('The contribution request could not be retained. Enable storage and retry.');return;}
            setPending(payment);
        }
        await act({action:'fund',...payment});
    }
    const owned=inventoryItemStacks(character,[]).find(stack=>stack.itemId===itemId)?.count??0;
    const allowance=view?Math.max(0,Math.min(CLAN_PROJECT.memberLimit-view.project.memberUsed,CLAN_PROJECT.target-view.project.progress)):0;
    const memberKey=member.trim().toLowerCase();
    const assigned=view&&Object.hasOwn(view.assignments,memberKey)?view.assignments[memberKey]:'';
    const nextShrine=war?.campaignView?.shrines.find(shrine=>shrine.state!=='closed');
    const students=mentor?.asSensei.students??[],claimable=students.filter(student=>student.claimable.length>0).length;
    return <section className="clan-overview" aria-label="Clan overview">
        <div className="clan-overview-heading"><div><p className="act-label">Together in the Hall</p><h3>Your clan’s next steps</h3><p className="hint">Choose the activity that suits you. Shared goals reward the clan; assignments describe how you help.</p></div><button disabled={busy} onClick={()=>void reload()}>Refresh goals</button></div>
        <div className="clan-overview-actions">
            <button onClick={()=>onOpen('wars')}><GameArtIcon kind="attack" size={32}/><strong>{war?'Campaign underway':'Clan Wars'}</strong><span>{war?.campaignView?.phase==='preparing'?'Prepare with your sealed roster':war?'Four queues are ready for your clan':'Find rivalries and organize your battle team'}</span>{nextShrine&&<small>Next shrine · {new Date(nextShrine.opensAt).toLocaleString()}</small>}</button>
            <button disabled={!bossAvailable} onClick={()=>onOpen('boss')}><GameArtIcon kind="clanBoss" size={32}/><strong>Clan Boss Operations</strong><span>{bossAvailable?'Join clanmates in the ready room':'Operations are temporarily unavailable'}</span></button>
            <button onClick={()=>onOpen('mentor')}><GameArtIcon kind="clanMentor" size={32}/><strong>Mentorship</strong><span>{mentor?.asStudent.sensei?`Your sensei: ${mentor.asStudent.sensei}`:students.length?`${students.length} students · ${claimable} ready for rewards`:'Guide a new member or meet your sensei'}</span></button>
        </div>
        {clan.notices.find(notice=>notice.pinned)&&<button className="clan-overview-notice" onClick={()=>onOpen('notices')}><strong>Clan orders · {clan.notices.find(notice=>notice.pinned)!.title}</strong><span>Read the notice board</span></button>}
        {error&&<p role="alert" className="clan-overview-error">{error}</p>}
        {!ready&&<p role="status">Loading verified shared goals…</p>}
        {view&&<>
            <div className="clan-overview-section"><h3>Weekly contracts</h3><p className="hint">Reset {new Date(view.resetsAt).toLocaleString()}. These Clan XP awards are additional to existing battle rewards.</p>
                <div className="clan-overview-goals">{view.contracts.map(contract=>{const terms=CLAN_CONTRACTS[contract.id];return <article key={contract.id}>
                    <h4>{terms.name}</h4><p>{terms.description}</p><progress aria-label={`${terms.name} progress`} value={contract.progress} max={terms.target}/>
                    <p>{contract.progress} / {terms.target} · {terms.clanXp} Clan XP</p>
                    <div className="menu"><button disabled={busy||contract.claimed||contract.progress<terms.target} onClick={()=>void act({action:'claim',contractId:contract.id})}>{contract.claimed?'Reward collected':'Collect clan reward'}</button><button onClick={()=>onOpen(contract.id==='campaign'?'wars':'boss')} disabled={contract.id==='operation'&&!bossAvailable}>Join activity</button></div>
                    {contract.contributors.length>0&&<small>Contributors · {contract.contributors.join(', ')}</small>}
                </article>;})}</div>
            </div>
            <div className="clan-overview-section"><h3>{CLAN_PROJECT.name}</h3><p>Build together with Field Herb, Binding Fiber or Iron Sand. Each member can supply up to 10 materials per week. The completed project grants {CLAN_PROJECT.clanXp} Clan XP.</p>
                <progress aria-label="Hall project progress" value={view.project.progress} max={CLAN_PROJECT.target}/><p>{view.project.progress} / {CLAN_PROJECT.target} materials · Your share {view.project.memberUsed} / {CLAN_PROJECT.memberLimit}</p>
                <p className="hint">{view.project.completedProjects} completed weeks · {view.project.hallRestored?'Restored Hall decoration earned':`Complete ${CLAN_PROJECT.decorationWeeks} projects to earn the permanent Restored Hall decoration.`} Materials are consumed by this project.</p>
                {pending?<div className="menu"><p>A retained contribution is waiting: {pending.count} {GATHER_NAMES[pending.itemId]} for {pending.clan}.</p><button disabled={busy} onClick={()=>void fund()}>{busy?'Finishing…':'Retry recorded contribution'}</button></div>:!view.project.completed&&<div className="clan-project-form">
                    <label>Material<select value={itemId} onChange={event=>setItemId(event.target.value)}>{COMMON_GATHER_IDS.map(id=><option key={id} value={id}>{GATHER_NAMES[id]}</option>)}</select></label>
                    <label>Quantity<input type="number" min={1} max={Math.min(allowance,owned)||1} value={count} onChange={event=>setCount(Math.max(1,Math.floor(Number(event.target.value)||1)))}/></label>
                    <button disabled={busy||count>owned||count>allowance} onClick={()=>void fund()}>{busy?'Contributing…':'Contribute materials'}</button><small>{owned} held · {allowance} allowed this week</small>
                </div>}
                {view.project.completed&&<p className="clan-overview-earned" role="status"><GameArtIcon kind="clanHall" size={20}/> This week’s Hall project is complete.</p>}
            </div>
            <div className="clan-overview-section"><h3>Member assignments</h3><p className="hint">Volunteer for a specialty. Assignments grant recognition; clan rank continues to control permissions.</p>
                <div className="clan-project-form"><label>Member<select value={member} onChange={event=>setMember(event.target.value)}>{clan.members.filter(entry=>canManage||entry.name===character.name).map(entry=><option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
                    <label>Assignment<select value={assigned} disabled={busy} onChange={event=>void act({action:'assign',member,assignment:event.target.value||null})}><option value="">No assignment</option>{Object.entries(CLAN_ASSIGNMENTS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
                <ul className="clan-assignment-list">{Object.entries(view.assignments).map(([name,role])=><li key={name}><strong>{name}</strong><span>{CLAN_ASSIGNMENTS[role as ClanAssignment]}</span></li>)}</ul>
            </div>
        </>}
    </section>;
}
