import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildingRepairStageName, BUILDING_RESTORATION_TARGETS, BUILDING_REPAIR_REWARDS } from '../../../shared/sector-building-rules';
import type { BuildingAction, BuildingMaterialRow, BuildingPoint, BuildingService } from '../../../shared/sector-building-types';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { WorldPlayerPosition } from '../lib/world-player-position';
import { subscribeBuildingCounter, type BuildingCounterRequest } from '../lib/sector-building-counter';
import { useSectorBuildings } from '../lib/use-sector-buildings';
import { serverNow } from '../lib/server-clock';
import { Modal } from './ui/Modal';
import { BuildingMaterialSelection } from './BuildingMaterialSelection';
import { BuildingWorkHistory } from './BuildingWorkHistory';
import './sector-buildings.css';

type Tab='welcome'|BuildingService|'work';
const tabNames:Partial<Record<Tab,string>>={welcome:'Welcome',work:'Work book',tea:'Tea stop',survey:'Field notes',repair:'Repairs',courier:'Letters',watch:'Watch',workshop:'Workshop',intelligence:'Contact',register:'Register',festival:'Festival'};
export function SectorBuildings({character,sector,tile,commit,walk,directRoadWalking=true,onAtlas}:{character:Character;sector:number;tile:number;commit:VersionedCharacterCommit;walk:(sector:number,tile:number)=>void;directRoadWalking?:boolean;onAtlas?:()=>void}){
    const api=useSectorBuildings(character.name,sector,commit),position=useContext(WorldPlayerPosition);
    // The server projects only the visible sector and the issuing counter for
    // active work. The browser does not ship authoring catalogs or private-state parsers.
    const sectorBuilding=(id:string)=>api.details[id]?.building??(api.activeBuilding?.id===id?api.activeBuilding:undefined);
    const buildingsInSector=(id:number)=>Object.values(api.details).filter(detail=>detail.building.sector===id).map(detail=>detail.building);
    const[opened,setOpened]=useState<BuildingCounterRequest|null>(null),[tab,setTab]=useState<Tab>('welcome'),[now,setNow]=useState(serverNow);
    const[materials,setMaterials]=useState<{rows:BuildingMaterialRow[];recipeId?:string}|null>(null),[destination,setDestination]=useState<BuildingPoint>();
    const anchor=useRef<HTMLSpanElement>(null),[hudHost,setHudHost]=useState<HTMLElement|null>(null);
    useLayoutEffect(()=>{setHudHost(anchor.current?.closest<HTMLElement>('main.tile-scene')??null);},[]);
    const walkRef=useRef(walk);useEffect(()=>{walkRef.current=walk;},[walk]);
    useEffect(()=>subscribeBuildingCounter(request=>{setOpened(request);setTab('welcome');setMaterials(null);}),[]);
    useEffect(()=>{if(!opened)return;const id=window.setInterval(()=>setNow(serverNow()),500);return()=>clearInterval(id);},[opened]);
    useEffect(()=>{if(!opened)return;const building=sectorBuilding(opened.buildingId);if(building)void api.inspect(building.sector);
        // A counter refresh belongs to its opener, not to each state merge.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[opened?.buildingId]);
    useEffect(()=>{
        if(!destination||opened)return;let frame=0,attempts=0;
        const approach=()=>{if(document.querySelector('[aria-modal=true],dialog[open]')){if(++attempts<120)frame=requestAnimationFrame(approach);return;}walkRef.current(destination.sector,destination.tile);setDestination(undefined);};
        frame=requestAnimationFrame(approach);return()=>cancelAnimationFrame(frame);
    },[destination,opened]);
    const savedProgress=api.progress??character.sectorBuildings;
    const progress=savedProgress??{active:undefined,repairs:0,repairsToday:0},order=progress.active,work=api.work;
    const selected=opened?sectorBuilding(opened.buildingId):undefined,detail=selected?api.details[selected.id]:undefined;
    const actual=position?.current,point=actual?.sector===sector?actual:{sector,col:tile%12,row:Math.floor(tile/12)};
    // The server measures along the walkable graph. A diagonal's Euclidean
    // distance can look close across a corner while its path exceeds the lease
    // radius. Require the immediate approach segment before offering an action.
    const near=(target:BuildingPoint)=>point.sector===target.sector&&Math.abs(point.col-target.tile%12)+Math.abs(point.row-Math.floor(target.tile/12))<=.8;
    const threshold=selected?{sector:selected.sector,tile:selected.approach,label:selected.name,description:selected.description}:undefined;
    const fallbackThreshold=opened?.entrance?{...opened.entrance,label:'Public threshold',description:''}:undefined;
    const needsAtlas=(target:BuildingPoint)=>target.sector!==sector&&(!directRoadWalking||target.sector===99);
    const approach=(target:BuildingPoint)=>{setOpened(null);setMaterials(null);if(needsAtlas(target)){onAtlas?.();return;}setDestination(target);};
    const action=async(input:Omit<BuildingAction,'requestId'|'buildingId'>)=>{
        if(!selected)return false;const ok=await api.act({...input,buildingId:selected.id});if(ok)setMaterials(null);return ok;
    };
    const begin=(service:'repair'|'courier'|'watch'|'intelligence'|'festival'|'tea')=>{
        if(!threshold||!near(threshold)){if(threshold)approach(threshold);return;}
        if(service==='repair'&&detail){setMaterials({rows:detail.materials});return;}
        void action({action:service==='tea'?'tea':'begin',service}).then(ok=>{if(ok)setTab('work');});
    };
    const service=detail?.services.find(s=>s.service===tab);
    return<>
        <span ref={anchor} hidden/>
        {buildingsInSector(sector).map(building=>{const stage=api.details[building.id]?.shared.stage,site=building.restorationSite;return stage&&site?<img key={`restoration:${building.id}`} className="sector-building-restoration-art" data-building-restoration={building.id} data-stage={stage} src={`/sector-buildings/restoration-stage-${stage}-v1.webp`} alt="" style={{left:`${site.left}%`,top:`${site.top}%`,width:`${site.width}%`,height:`${site.height}%`}}/>:null;})}
        {buildingsInSector(sector).filter(b=>!['stronghold','village','shrine'].includes(b.kind)).map(building=><button type="button" key={building.id}
            className={`sector-building-threshold building-${building.kind}${Math.abs((point.col+.5)/12*100-building.left)<14&&Math.abs((point.row+.5)/12*100-building.top)<6?' is-player-at-label':''}`} data-building-id={building.id} data-footprint={building.footprint.join(' ')}
            style={{left:`${building.left}%`,top:`${building.top}%`,width:`${building.width}%`,height:`${building.height}%`}}
            title={`Visit ${building.name}`} aria-label={`Visit ${building.name}`} onClick={()=>{setOpened({buildingId:building.id});setTab('welcome');setMaterials(null);}}>
            {building.kind==='road-place'&&<img className="sector-building-road-sign" src="/landmarks/trail-sign.webp" alt=""/>}
            {building.kind==='road-place'&&!building.restorationSite&&!!api.details[building.id]?.shared.stage&&<span className={`sector-building-maintenance-seal maintenance-${api.details[building.id].shared.stage}`} aria-hidden="true">{['','I','II','III'][api.details[building.id].shared.stage]}</span>}
            <span className="sector-building-name">{building.name}</span>
            {api.details[building.id]?.shared.stage? <span className="sector-building-condition">{buildingRepairStageName(api.details[building.id].shared.stage)}</span>:null}
        </button>)}
        {hudHost&&createPortal(<button className="sector-building-work-chip" type="button" onClick={()=>{setOpened({buildingId:order?.buildingId??'road-book'});setTab('work');setMaterials(null);}}>
            <span>Work book</span> {order&&work?`${work.target.label} · S${work.target.sector}`:'Your saved road record'}
        </button>,hudHost)}
        {order&&work&&work.target.sector===sector&&<button type="button" className="sector-building-work-point" style={{left:`${(work.target.tile%12+.5)/12*100}%`,top:`${(Math.floor(work.target.tile/12)+.5)/12*100}%`}} aria-label={`Work point: ${work.target.label}`} onClick={()=>{setOpened({buildingId:order.buildingId});setTab('work');setMaterials(null);}}>◇</button>}
        <Modal open={!!opened} onClose={()=>{setOpened(null);setMaterials(null);}} title={selected?.name??(opened?.buildingId==='road-book'?'Your road book':'Building counter')} size="lg" className="building-counter-modal">
            {!selected&&opened?.buildingId==='road-book'&&<div className="building-counter"><BuildingWorkHistory progress={savedProgress}/></div>}
            {!selected&&opened?.buildingId!=='road-book'&&<div className="building-counter"><p role="status">{api.error||'The keeper is opening the counter book…'}</p>
                {opened?.restriction&&<p>{opened.restriction}</p>}
                {opened?.interior&&fallbackThreshold&&<button type="button" onClick={()=>{
                    if(!near(fallbackThreshold)){approach(fallbackThreshold);return;}
                    const enter=opened?.interior;setOpened(null);enter?.();
                }}>{near(fallbackThreshold)?opened.interiorLabel??'Enter the guarded interior':'Walk to the public threshold'}</button>}
            </div>}
            {selected&&<div className="building-counter" data-building-counter={selected.id}>
                <img className="building-counter-art" src={`/sector-buildings/${selected.art}-v1.webp`} alt="" width={800} height={450}/>
                <header className="building-counter-heading"><div><small>{selected.role} · Sector {selected.sector}</small><p>{selected.keeper}</p></div><span>{detail?.standing.trust??0} trust</span></header>
                <nav className="building-counter-tabs" aria-label="Building services">{(['welcome',...(selected.services.filter(s=>s!=='reception')), 'work'] as Tab[]).map(name=><button type="button" key={name} aria-pressed={tab===name} onClick={()=>{setTab(name);setMaterials(null);}}>{tabNames[name]??name}</button>)}</nav>
                {!detail?<p role="status">{api.error||'The keeper is opening the counter book…'}</p>:materials?<BuildingMaterialSelection key={`${selected.id}:${materials.recipeId??'repair'}`} rows={materials.rows} busy={api.busy} label={materials.recipeId?'Confirm craft':'Reserve these materials'} onCancel={()=>setMaterials(null)} onConfirm={selection=>{void action(materials.recipeId?{action:'craft',recipeId:materials.recipeId,materials:selection}:{action:'begin',service:'repair',materials:selection}).then(ok=>{if(ok&&!materials.recipeId)setTab('work');});}}/>:<>
                    {tab==='welcome'&&<><p className="building-greeting">“{detail.greeting}”</p><p>{selected.description}</p>
                        <p className="building-hint">{detail.conditions}</p>
                        <section className="building-relationship"><h3>{detail.relationship.title}</h3><p>{detail.relationship.text}</p><ul>{detail.relationship.benefits.map(benefit=><li key={benefit}>{benefit}</li>)}</ul></section>
                        <div className="building-actions"><button type="button" disabled={api.busy} onClick={()=>threshold&&(near(threshold)?void action({action:'visit'}):approach(threshold))}>{threshold&&near(threshold)?'Speak with the keeper':'Walk to the public counter'}</button>
                            {opened?.interior&&<button type="button" disabled={api.busy||!threshold||!near(threshold)} onClick={()=>{const enter=opened.interior;setOpened(null);enter?.();}}>{opened.interiorLabel??'Enter the guarded interior'}</button>}</div>
                        {opened?.restriction&&<p className="building-hint">{opened.restriction}</p>}
                        <details><summary>News of the road</summary>{detail.leads.map(lead=>{const target={sector:lead.sector,tile:lead.approach,label:lead.name,description:lead.reason};return<p key={lead.buildingId}><strong>{lead.name} · S{lead.sector}</strong><br/>{lead.reason} {needsAtlas(target)&&!onAtlas?<small>Use the atlas to reach this sector.</small>:<button type="button" onClick={()=>approach(target)}>{needsAtlas(target)?'Open atlas for this route':'Walk there'}</button>}</p>;})}</details>
                        {detail.shared.reports.length>0&&<details><summary>Recent watch reports</summary>{detail.shared.reports.map((report,index)=><p key={`${report.at}:${index}`}>{report.text}<small>{report.name}</small></p>)}</details>}
                    </>}
                    {service&&<><p>{service.description}</p>{service.reason&&<p className="building-hint">{service.reason}</p>}</>}
                    {tab==='repair'&&<><div className="building-restoration"><strong>{buildingRepairStageName(detail.shared.stage)}</strong><progress value={detail.shared.repairs} max={BUILDING_RESTORATION_TARGETS[2]}/><p>{detail.shared.repairs} completed orders · restoration stages at 4, 12 and 24.</p></div>
                        <p>Each completed order pays <b>{BUILDING_REPAIR_REWARDS.ryo} ryo</b>. Every {BUILDING_REPAIR_REWARDS.boneCharms.repairs} personal repairs earn <b>{BUILDING_REPAIR_REWARDS.boneCharms.amount} bone charms</b>. Every {BUILDING_REPAIR_REWARDS.fateShards.repairs} personal repairs earn <b>{BUILDING_REPAIR_REWARDS.fateShards.amount} fate shards</b>. No daily repair cap or weekly shard limit. Keep repairing while you have the required materials.</p>
                        <p>{progress.repairs} lifetime repairs · {progress.repairsToday} today. {detail.standing.repairCount} of your orders maintain this frontage. After restoration, orders maintain the public shelter.</p>
                        <button type="button" disabled={api.busy||!service?.available} onClick={()=>begin('repair')}>Choose repair materials</button>
                        {detail.shared.contributors.length>0&&<details><summary>The public work roll · leading 20</summary>{detail.shared.contributors.map(c=><p key={c.name}>{c.name} · {c.repairs} orders</p>)}</details>}
                    </>}
                    {tab==='survey'&&detail.survey&&<><h3>{detail.survey.title}</h3><p>{detail.survey.step} / 3 evidence points recorded.</p>
                        {detail.survey.evidence.length>0&&<details open={detail.survey.recorded}><summary>Collected field observations</summary>{detail.survey.evidence.map(evidence=><article key={evidence.label}><h4>{evidence.label}</h4><p>{evidence.description}</p></article>)}</details>}
                        {detail.survey.complete&&<blockquote>{detail.survey.testimony}</blockquote>}
                        {detail.survey.recorded?<section className="building-recorded-account"><h4>Recorded Chronicle account</h4><p>{detail.survey.account}</p>{detail.survey.question&&<><h4>Preserved unanswered question</h4><p>{detail.survey.question}</p></>}</section>:detail.survey.target?<><strong>{detail.survey.target.label}</strong><p>{detail.survey.target.description}</p><button type="button" disabled={api.busy} onClick={()=>{const target=detail.survey!.target!;if(!near(target))approach(target);else void action({action:'survey',step:detail.survey!.step});}}>{near(detail.survey.target)?'Record this evidence':'Walk to this evidence point'}</button></>:<><p>The three observations are collected. Return to the keeper to record the account. One first investigation pays 90 ryo.</p>{threshold&&!near(threshold)?<button type="button" onClick={()=>approach(threshold)}>Return to the keeper</button>:<div className="building-actions"><button type="button" disabled={api.busy} onClick={()=>void action({action:'record',choice:'evidence-only'})}>Record only the supported evidence</button><button type="button" disabled={api.busy} onClick={()=>void action({action:'record',choice:'open-question'})}>Record an unanswered question</button></div>}</>}
                    </>}
                    {['courier','watch','intelligence','festival','tea'].includes(tab)&&<><p className="building-hint">{tab==='courier'?'Two receiving counters · 120 ryo · three paid deliveries per UTC day.':tab==='watch'?'Three observations · 80 ryo · one paid round per post per UTC day.':tab==='intelligence'?'Three handling steps · 100 ryo · one paid handoff per contact per UTC day.':tab==='festival'?'Four preparation steps · 60 ryo · one paid participation per premises per UTC day.':'30 ryo for tea and small-meal recovery · fifteen minutes between kettle rounds.'}</p>{tab==='watch'&&<p>{detail.conditions} Each observation preserves the sky at that point. A report covers the checked approaches only.</p>}<button type="button" disabled={api.busy||!service?.available} onClick={()=>begin(tab as 'courier'|'watch'|'intelligence'|'festival'|'tea')}>{tab==='tea'?'Order tea and rest':'Accept this work'}</button></>}
                    {tab==='workshop'&&<div className="building-recipe-list">{detail.recipes.map(recipe=><article key={recipe.id}><strong>{recipe.name}</strong><small>Level {recipe.level}{recipe.trust?` · ${recipe.trust} local trust`:''} · regional workshop recipe</small><p>{recipe.ingredients.map(row=>`${row.count} ${row.label}`).join(' · ')}</p>{!recipe.available&&<p className="building-hint">Build local trust through visits, repairs or recorded work. The recipe’s other crafting locations remain available.</p>}<button type="button" disabled={api.busy||!service?.available||!recipe.available||character.level<recipe.level} onClick={()=>{if(threshold&&!near(threshold))approach(threshold);else setMaterials({rows:recipe.ingredients,recipeId:recipe.id});}}>Choose exact materials</button></article>)}</div>}
                    {tab==='register'&&<div className="building-register">{detail.register.map(entry=><article key={entry.id}><h3>{entry.title}</h3><p>{entry.text}</p>{!entry.eligible&&<small>{entry.reason}</small>}<button type="button" disabled={api.busy||!entry.eligible||detail.standing.registerEntry===entry.id} onClick={()=>{if(threshold&&!near(threshold))approach(threshold);else void action({action:'register',choice:entry.id});}}>{detail.standing.registerEntry===entry.id?'Account entered':'Sign this verified account'}</button></article>)}</div>}
                    {tab==='work'&&(order&&work?<section className="building-current-work"><small>{sectorBuilding(order.buildingId)?.name} · work step {order.step+1}</small><h3>{work.target.label}</h3><p>{work.instruction}</p><p>Sector {work.target.sector} · {near(work.target)?'At the work point':'Walk to the marked work point'}</p>
                        {work.itinerary&&<ol className="building-courier-itinerary">{work.itinerary.map(stop=><li key={stop.name}>{stop.stamped?'Stamped':'Awaiting receipt'} · {stop.name} · S{stop.sector}</li>)}</ol>}
                        {!near(work.target)?needsAtlas(work.target)&&!onAtlas?<p>Use the atlas to reach Sector {work.target.sector} before continuing this order.</p>:<button type="button" onClick={()=>approach(work.target)}>{needsAtlas(work.target)?'Open atlas for this route':'Walk to the next work point'}</button>:<>{work.readyAt>now&&<p role="status">The keeper is recording the step. Ready in {Math.ceil((work.readyAt-now)/1000)} seconds.</p>}<div className="building-actions">{(work.choices??[{id:'',label:work.actionLabel}]).map(choice=><button type="button" key={choice.id} disabled={api.busy||work.readyAt>now} onClick={()=>void api.act({action:'step',buildingId:order.buildingId,orderId:order.id,step:order.step,...(choice.id?{choice:choice.id}:{})})}>{choice.label}</button>)}</div></>}
                        {threshold&&near(threshold)&&order.buildingId===selected.id?<button type="button" disabled={api.busy} className="building-cancel" onClick={()=>void action({action:'cancel',orderId:order.id})}>Cancel order{order.kind==='repair'?' and return all reserved materials':order.kind==='tea'?' and refund the unserved tea':''}</button>:<p className="building-hint">Return to the issuing counter to cancel this order.</p>}
                    </section>:<p>No building order is active. Visit a counter to choose work.</p>)}
                    {tab==='work'&&<BuildingWorkHistory progress={savedProgress}/>}
                </>}
                {api.receipt&&<div className="building-receipt" role="status"><p>{api.receipt.message}</p>{(api.receipt.reward.ryo>0||api.receipt.reward.boneCharms>0||api.receipt.reward.fateShards>0)&&<p><b>Received:</b> {api.receipt.reward.ryo} ryo · {api.receipt.reward.boneCharms} bone charms · {api.receipt.reward.fateShards} fate shards</p>}</div>}
                {api.error&&<div className="building-error" role="alert"><p>{api.error}</p>{api.retryable&&<button type="button" disabled={api.busy} onClick={()=>void api.retry()}>Retry the same request</button>}</div>}
            </div>}
        </Modal>
    </>;
}
