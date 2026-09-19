import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { requestCaravan, type CaravanResponse } from '../../lib/sunscar-caravan';
import { befriendWildPet, declineWildPetEncounter, startWildPetEncounter, type WildPetEncounterResult } from '../../lib/wild-pet-encounter-api';
import { petCardImage } from '../../lib/pet-battle-anim';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { CARAVAN_RANKS, CARAVAN_TOOLS, CARAVAN_WEATHER, caravanRank, type CaravanChoice, type CaravanNode, type CaravanRun as CaravanRunState, type CaravanTool } from '../../../../shared/sunscar/caravan-types';
import { caravanChoiceBlock, caravanFieldCharacter, caravanRewardPreview, caravanTrackerBlock, caravanTravelCost, currentCaravanNode } from '../../../../shared/sunscar/caravan-state';
import { petRoleOf } from '../../lib/pet-roles';
import { caravanEvent } from '../../../../shared/sunscar/caravan-events';
import { CaravanMap } from './CaravanMap';
import { CaravanChangeSummary, CaravanMissionStatus } from './CaravanMissionStatus';
import { CARAVAN_NODE_LABELS, CARAVAN_MISSION_RANKS, CARAVAN_REGIONS } from './caravan-presentation';
import type { CaravanCombatCatalogs } from './CaravanBattle';
import { SunscarPrestige } from './SunscarPrestige';
import dunesArt from '../../assets/festival/sunscar-shinobi-dunes-v2.webp';
import canyonArt from '../../assets/festival/sunscar-shinobi-canyon-v2.webp';
import ruinsArt from '../../assets/festival/sunscar-shinobi-ruins-v2.webp';
import oasisArt from '../../assets/festival/sunscar-shinobi-oasis-v2.webp';
import { GameIcon } from '../../components/icons/GameIcon';
import { playPetSfx, primePetSfx } from '../../lib/pet-sfx';
import { startGameAmbience, stopGameAmbience } from '../../lib/game-audio';
import '../../styles/sunscar-modes.css';
import '../../styles/sunscar-caravan.css';
import '../../styles/caravan-run.css';

const journeyArt = { dunes: dunesArt, canyon: canyonArt, ruins: ruinsArt, oasis: oasisArt };
const CaravanBattle = lazy(() => import('./CaravanBattle').then(module => ({ default: module.CaravanBattle })));

function day(now: number) { return new Date(now).toISOString().slice(0, 10); }
function supplyCapacityNote(run: CaravanRunState, choice: CaravanChoice): string {
    const offered = choice.effect.supplies ?? 0;
    const space = Math.max(0, 30 - run.supplies + (choice.cost?.supplies ?? 0));
    return offered > space ? `Only ${space} of ${offered} extra supplies fit (30 maximum).` : '';
}
function Resource({ name, value, max = 100, tone = '', percent = false }: { name: string; value: number; max?: number; tone?: string; percent?: boolean }) {
    return <div className={`caravan-resource ${tone}${value <= max * .25 ? ' is-low' : ''}`}><span>{name}<strong>{Math.round(value)}{percent ? '%' : ` / ${max}`}</strong></span><meter aria-label={name} min={0} max={max} value={value} low={max * .25} optimum={max} /></div>;
}
export default function CaravanRun({ character, onVersionedCharacter, onBack, ...catalogs }: CaravanCombatCatalogs & { character: Character; onVersionedCharacter: VersionedCharacterCommit; onBack: () => void }) {
    const [response, setResponse] = useState<CaravanResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [contractId, setContractId] = useState('market-goods');
    const [tools, setTools] = useState<CaravanTool[]>(['water', 'repair', 'medicine']);
    const [petId, setPetId] = useState(character.activePetId ?? '');
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [view, setView] = useState<'decision' | 'map'>('decision');
    const [session, setSession] = useState<SoloPveSession | null>(null);
    const [wild, setWild] = useState<WildPetEncounterResult | null>(null);
    const [petMessage, setPetMessage] = useState('');
    const [retire, setRetire] = useState(false);
    const [hasPending, setHasPending] = useState(false);
    const pending = useRef<Record<string, unknown> | null>(null);
    const busyRef = useRef(false);
    const panel = useRef<HTMLElement>(null);
    const receipt = useRef<HTMLElement>(null);
    const inspection = useRef<HTMLDivElement>(null);
    const journey = useRef<HTMLDivElement>(null);
    const errorPanel = useRef<HTMLDivElement>(null);
    const commitCharacter = useRef(onVersionedCharacter);
    useLayoutEffect(() => { commitCharacter.current = onVersionedCharacter; }, [onVersionedCharacter]);
    const adopt = useCallback((data: CaravanResponse) => { setResponse(data); setSelectedNode(null); setView('decision'); setRetire(false); commitCharacter.current(data.character, data._saveVersion); return data; }, []);
    const inspectNode = useCallback((node: CaravanNode) => { setSelectedNode(node.id); setView('decision'); }, []);
    useEffect(() => {
        const controller = new AbortController();
        requestCaravan(character.name, undefined, controller.signal).then(adopt).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
        return () => controller.abort();
    }, [character.name, adopt]);
    const serverNow = response?.serverNow;
    useEffect(() => {
        if (serverNow === undefined) return;
        const controller = new AbortController();
        const nextDay = Date.parse(`${day(serverNow)}T00:00:00Z`) + 86_400_000;
        const timer = window.setTimeout(() => {
            requestCaravan(character.name, undefined, controller.signal).then(adopt).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
        }, Math.max(1000, nextDay - serverNow + 1000));
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [serverNow, character.name, adopt]);
    const run = response?.progress.current;
    useEffect(() => { if (!session) startGameAmbience('ambience-road', { gain: .022 }); else stopGameAmbience(300); return () => stopGameAmbience(300); }, [session]);
    useEffect(() => {
        if (session) return;
        panel.current?.focus({ preventScroll: true });
        if (window.matchMedia('(max-width: 900px)').matches) journey.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, [run?.id, run?.version, session]);
    useEffect(() => {
        if (!error) return;
        errorPanel.current?.focus({ preventScroll: true });
        errorPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [error]);
    useEffect(() => {
        if (!selectedNode || view === 'map') return;
        const target = inspection.current ?? panel.current;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [selectedNode, view]);
    useEffect(() => {
        if (session || !run?.result) return;
        receipt.current?.focus({ preventScroll: true });
        receipt.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, [session, run?.id, run?.result]);
    async function send(body?: Record<string, unknown>) {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try { const data = adopt(await requestCaravan(character.name, body)); pending.current = null; setHasPending(false); return data; }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The dispatch office is unreachable.'); }
        finally { busyRef.current = false; setBusy(false); }
    }
    function act(action: string, fields: Record<string, unknown> = {}) {
        if (busyRef.current || pending.current) return;
        primePetSfx(); playPetSfx(action === 'travel' ? 'uiMove' : 'uiConfirm');
        const body = { action, ...fields, runId: run?.id, version: run?.version, requestId: crypto.randomUUID() };
        pending.current = body;
        setHasPending(true);
        void send(body);
    }
    async function openCombat() { const data = await send({ action: 'combat', runId: run?.id }); if (data?.session) setSession(data.session); }
    async function settleCombat() { return adopt(await requestCaravan(character.name, { action: 'combat-result', runId: run?.id })); }
    async function followTrail() {
        if (!run?.petEncounter || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try {
            const found = await startWildPetEncounter(character.name, 54, run.petEncounter.requestId, run.id);
            if (found.kind === 'blocked') throw new Error(found.error);
            setWild(found);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'The trail could not be reached.'); }
        finally { busyRef.current = false; setBusy(false); }
    }
    async function resolvePet(befriend: boolean) {
        if (wild?.kind !== 'hit' || busyRef.current) return;
        busyRef.current = true; setBusy(true); setError('');
        try {
            if (befriend) {
                const result = await befriendWildPet(character.name, wild.token);
                if (!result.character) throw new Error(result.error || 'The companion could not be befriended.');
                onVersionedCharacter(result.character, result.saveVersion);
                setPetMessage(`${wild.pet.name} has joined ${result.destination === 'sanctuary' ? 'your sanctuary' : 'your companions'}${result.trait ? ` with the ${result.trait} trait` : ''}.`);
            } else { const result = await declineWildPetEncounter(character.name, wild.token); if (!result.ok) throw new Error(result.error); }
            adopt(await requestCaravan(character.name, { action: 'pet-return', runId: run?.id })); setWild(null);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your encounter could not be saved.'); }
        finally { busyRef.current = false; setBusy(false); }
    }
    const progress = response?.progress;
    const rank = caravanRank(progress?.reputation ?? 0);
    const nextRank = CARAVAN_RANKS.find(r => r.at > (progress?.reputation ?? 0));
    const active = run && !run.result;
    const node = active ? currentCaravanNode(run) : null;
    const encounter = node && run?.status === 'encounter' ? caravanEvent(node.eventId) : null;
    const inspected = active ? run.map.find(n => n.id === selectedNode) : null;
    const last = run?.log.at(-1);
    const awaitingPet = run?.petEncounter?.state === 'pending';
    const contract = response?.daily.contracts.find(c => c.id === contractId) ?? response?.daily.contracts[0];
    const used = !!response && response.progress.lastEntryDay === day(response.serverNow);
    const travelCost = run ? caravanTravelCost(run) : 1;
    const supplyShortfall = run ? Math.max(0, travelCost - run.supplies) : 0;
    const basePay = contract && response?.daily.baseRewards?.[contract.id];
    const fieldCharacter = caravanFieldCharacter(character, petRoleOf);
    const trackerReady = !caravanTrackerBlock({ selectedPetId: petId }, fieldCharacter, serverNow ?? 0);
    return <div className={`sunscar-mode caravan-mode${active ? ' caravan-on-road' : ''}`}>
        <header className={`sunscar-mode-heading${active ? '' : ' caravan-mission-header'}`} style={active ? undefined : { backgroundImage: `linear-gradient(90deg, #121c24f5, #121c24d9 45%, #121c2433), url(${dunesArt})` }}><div><button className="sunscar-back" onClick={onBack}>← Festival grounds</button><p className="sunscar-eyebrow">Sunscar Shinobi Dispatch</p><h1>Caravan Run</h1><p>Guard the convoy. Read the signs. Complete the mission.</p></div><div className="sunscar-rank"><strong>{rank.name}</strong><span>{progress?.reputation ?? 0} reputation · {progress?.deliveries ?? 0} deliveries</span>{nextRank && <small>{nextRank.at - (progress?.reputation ?? 0)} to {nextRank.name}</small>}</div></header>
        {error && <div ref={errorPanel} tabIndex={-1} className="sunscar-error" role="alert"><span>{error}</span><div className="sunscar-button-row"><button disabled={busy} onClick={() => void send(pending.current ?? undefined)}>{busy ? 'Reconnecting…' : hasPending ? 'Retry this choice' : 'Reload expedition'}</button>{hasPending && <button disabled={busy} className="sunscar-secondary" onClick={() => void send()}>Read saved state</button>}</div></div>}
        {!response && !error && <div className="sunscar-loading" role="status">Unsealing today’s mission scrolls…</div>}
        {!active && <SunscarPrestige mode="caravan" reputation={progress?.reputation ?? 0}/>}
        {response && !active && <>
{run?.result && <section ref={receipt} tabIndex={-1} aria-label="Expedition result" className={`caravan-receipt ${run.status}`}><p className="sunscar-eyebrow">{run.day} · Mission debrief</p><h2>{run.status === 'complete' ? `Delivered to ${run.contract.destination}` : 'The escort mission ends here'}</h2><p>{run.result.reason}</p><div className="caravan-receipt-numbers"><strong>{run.result.ryo.toLocaleString()}<span>Ryo received</span></strong><strong>+{run.result.reputation}<span>Reputation</span></strong><strong>{run.result.cargo}%<span>Cargo preserved</span></strong><strong>{run.visited.length}<span>Legs traveled</span></strong></div>{run.status === 'complete' && <p className="caravan-debrief-pay">Base pay {run.baseReward.toLocaleString()} Ryo · {run.result.cargo}% cargo delivered · {run.bonus}% extra delivery bonus · Objective {run.result.objectiveComplete ? `+${caravanRewardPreview(run).objectiveBonus.toLocaleString()} Ryo and +5 reputation included` : 'bonus not earned'}.</p>}<p>{run.enemiesDefeated} enemies defeated · {run.discoveries.length} discoveries · Mission objective {run.result.objectiveComplete ? 'completed' : 'unfinished'}</p>{run.discoveries.length > 0 && <p>Recorded: {run.discoveries.map(d => d.replaceAll('-', ' ')).join(' · ')}</p>}</section>}
            <div className="caravan-weather"><strong>{CARAVAN_WEATHER[response.daily.weather].name}</strong><span>{CARAVAN_WEATHER[response.daily.weather].description}</span><small>One departure daily · resets at 00:00 UTC</small></div>
            <div className="caravan-contract-grid" role="group" aria-label="Daily contracts">{response.daily.contracts.map(c => {
                const locked = response.progress.reputation < c.reputationRequired;
                return <button key={c.id} className={`caravan-contract${contract?.id === c.id ? ' is-selected' : ''}`} aria-pressed={contract?.id === c.id} disabled={busy || hasPending} onClick={() => setContractId(c.id)}><span className="sunscar-eyebrow">{CARAVAN_MISSION_RANKS[c.difficulty - 1]} · {c.nodes} legs</span><GameIcon name="scroll" size={26} className="caravan-contract-seal"/><h2>{c.title}</h2><p className="caravan-employer">{c.employer}</p><p>{c.description}</p><span className="caravan-contract-cargo">{c.cargo} → {c.destination}</span><small>{locked ? `Requires ${c.reputationRequired} reputation` : c.objective.label}</small>{response.daily.baseRewards?.[c.id] !== undefined && <small>{response.daily.baseRewards[c.id].toLocaleString()} Ryo base pay · objective adds 10%</small>}</button>;
            })}</div>
            {contract && <section className="caravan-preparation"><div><p className="sunscar-eyebrow">Mission preparation</p><h2>Prepare your field kit</h2><p>Draw three packs from the mission quartermaster. Repeated packs are allowed. Bring smoke for ambushes, a scout scroll for reconnaissance, or field supplies to protect the cargo. General supplies pay for travel and some choices.</p><div className="caravan-pack-slots">{tools.map((tool, i) => <label key={i}>Kit {i + 1}<select value={tool} disabled={used || busy || hasPending} onChange={e => setTools(old => old.map((t, n) => n === i ? e.target.value as CaravanTool : t))}>{Object.entries(CARAVAN_TOOLS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><small>{CARAVAN_TOOLS[tool].description}</small></label>)}</div><label className="caravan-pet-select">Mission companion<select value={petId} disabled={busy || used || hasPending} onChange={e => setPetId(e.target.value)}><option value="">Travel without a companion</option>{fieldCharacter.pets.map(p => <option key={p.id} value={p.id}>{p.name}{p.role === 'tracker' ? ' · Tracker' : ''}</option>)}</select></label><p className="caravan-technique-brief">Field techniques: scout clone (8% maximum chakra), cargo seal (12% maximum chakra), and Tracker reconnaissance (1 pet feed). Each can be used once per mission at matching encounters.</p><p className="caravan-technique-brief">{trackerReady ? 'Tracker reconnaissance available with this companion. Pack pet feed to use it.' : 'Choose a Tracker companion to unlock reconnaissance and ambush bypasses.'}</p></div><div className="caravan-departure"><h3>{contract.title}</h3>{basePay !== undefined && <p className="caravan-base-pay"><strong>{basePay.toLocaleString()} Ryo base pay</strong><span>Preserve cargo to protect your pay. The objective adds 10% of cargo-adjusted base pay and 5 reputation on delivery.</span></p>}<p>{contract.supplies} supplies · 100% cargo · {CARAVAN_WEATHER[response.daily.weather].name}</p><Resource name="Health" value={character.hp} max={character.maxHp} tone="health"/><Resource name="Chakra" value={character.chakra} max={character.maxChakra} tone="chakra"/><Resource name="Stamina" value={character.stamina} max={character.maxStamina}/><p className="caravan-condition-note">You travel in your current condition. Battles use your equipped skills and items. Companions level 50 and above can be summoned, following normal combat rules. Damage persists; defeat follows normal hospital rules and ends the delivery.</p><button disabled={busy || hasPending || used || response.progress.reputation < contract.reputationRequired || character.hp <= 0} onClick={() => act('depart', { contractId: contract.id, tools, petId })}>{busy ? 'Preparing wagons…' : used ? 'Daily departure used' : response.progress.reputation < contract.reputationRequired ? 'Employer reputation required' : character.hp <= 0 ? 'Recover health before departing' : 'Accept contract & depart'}</button>{used && <small>Your next mission scroll arrives at the daily reset.</small>}</div></section>}
        </>}
        {active && <>
            <div className="caravan-manifest"><div><p className="sunscar-eyebrow"><GameIcon name="scroll" size={16}/> {CARAVAN_MISSION_RANKS[run.contract.difficulty - 1]} · {run.contract.employer}</p><h2>{run.contract.title}</h2><p>{run.contract.cargo} → {run.contract.destination}</p></div><div><strong>Leg {run.visited.length} / {run.contract.nodes}</strong><span>{CARAVAN_WEATHER[run.weather].name}</span><small>{CARAVAN_WEATHER[run.weather].description}</small></div></div>
            <div className="caravan-journey" ref={journey} data-view={view}>
                <div className="caravan-resource-bar" aria-label="Caravan condition"><Resource name="Cargo" value={run.cargo} percent/><Resource name="Supplies" value={run.supplies} max={30}/><Resource name="Morale" value={run.morale} percent/><Resource name="Health" value={character.hp} max={character.maxHp} tone="health"/><Resource name="Chakra" value={character.chakra} max={character.maxChakra} tone="chakra"/><Resource name="Stamina" value={character.stamina} max={character.maxStamina}/></div>
                <div className="caravan-view-switch" role="group" aria-label="Journey view"><button className="sunscar-secondary" aria-pressed={view === 'decision'} onClick={() => setView('decision')}>Next decision</button><button className="sunscar-secondary" aria-pressed={view === 'map'} onClick={() => setView('map')}>Route map</button></div>
                <CaravanMap run={run} selected={selectedNode} onSelect={inspectNode}/><section className="caravan-encounter" ref={panel} tabIndex={-1} aria-label="Current expedition encounter" aria-busy={busy}>
                <div className="caravan-scene" data-region={node?.region ?? 'dunes'} aria-hidden="true"><img src={journeyArt[node?.region ?? 'dunes']} alt="" decoding="async" width={768} height={512}/><span className="caravan-scene-caption">{CARAVAN_REGIONS[node?.region ?? 'dunes']}</span><span className="caravan-scene-seal"><GameIcon name="chakra" size={26}/></span></div>
                <CaravanChangeSummary changes={last?.changes} title={last?.title}/>
                <CaravanMissionStatus run={run}/>
                {awaitingPet ? <><p className="sunscar-eyebrow">A rare discovery</p><h2>Tracks in the luminous sand</h2>{wild?.kind === 'hit' ? <><img className="caravan-wild-portrait" src={petCardImage(wild.pet)} alt={wild.pet.name}/><p><strong>{wild.pet.name}</strong> watches from the shade. There is room to approach slowly.</p><div className="sunscar-button-row"><button disabled={busy} onClick={() => void resolvePet(true)}>Befriend companion</button><button disabled={busy} className="sunscar-secondary" onClick={() => void resolvePet(false)}>Leave in peace</button></div></> : wild?.kind === 'miss' || wild?.kind === 'resolved' ? <><p>{wild.kind === 'miss' ? 'The tracks end at a cool, empty hollow. Your crew rests a moment before returning to the wagons.' : 'This discovery has already been resolved. The crew is waiting on the road.'}</p><button disabled={busy} onClick={() => void send({ action: 'pet-return', runId: run.id }).then(data => { if (data) setWild(null); })}>Return to the road</button></> : <><p>Your forward scout signals fresh tracks beneath the rock shelter. Follow them to see whether a wild companion is still nearby.</p><button disabled={busy} onClick={() => void followTrail()}>{busy ? 'Following tracks…' : 'Follow the wild trail'}</button><button disabled={busy} className="sunscar-secondary" onClick={() => void send({ action: 'pet-skip', runId: run.id })}>Leave the trail undisturbed</button><small>Wild companions use the usual exploration chance and daily limit. You can continue without approaching.</small></>}</>
                : run.status === 'combat' ? <><p className="sunscar-eyebrow">The convoy is halted</p><h2>Hold the road</h2><p>{last?.text}</p><p>The drivers shelter behind the cargo while your shinobi escort holds the perimeter. Victory opens the next leg. Defeat ends the mission.</p><button disabled={busy} onClick={() => void openCombat()}>{busy ? 'Preparing encounter…' : 'Enter battle'}</button></>
                : encounter ? <><p className="sunscar-eyebrow">{CARAVAN_NODE_LABELS[node!.kind]} · Leg {node!.layer + 1}</p><h2>{encounter.title}</h2><p className="caravan-scene-copy">{encounter.scene}</p><div className="caravan-choices">{encounter.choices.map(choice => {
                    const blocked = caravanChoiceBlock(run, choice, fieldCharacter, serverNow);
                    const price = Math.ceil((choice.cost?.ryoFraction ?? 0) * run.baseReward);
                    const capacity = supplyCapacityNote(run, choice);
                    return <button key={choice.id} disabled={busy || hasPending || !!blocked} onClick={() => act('choose', { choiceId: choice.id })}><strong>{choice.label}</strong><span>{choice.hint}{price ? ` · ${price.toLocaleString()} Ryo` : ''}</span>{capacity && <small>{capacity}</small>}{blocked && <small>{blocked}</small>}</button>;
                })}</div></>
                : <><p className="sunscar-eyebrow">{last ? 'Field report' : 'Escort orders'}</p><h2>{last?.title ?? 'Your escort begins'}</h2><p className="caravan-scene-copy">{last?.text ?? 'Miraa seals your mission scroll. Take point, protect the drivers, and deliver the cargo. Choose a road below, or open the route map to scout ahead.'}</p>{petMessage && <p className="caravan-pet-message" role="status">{petMessage}</p>}{inspected ? <div className="caravan-next-stop" ref={inspection} tabIndex={-1} aria-label="Selected road"><strong>{CARAVAN_NODE_LABELS[inspected.kind]} · Leg {inspected.layer + 1}</strong>{inspected.objectiveOpportunity && <small className="caravan-opportunity">Mission objective opportunity</small>}<p>{run.available.includes(inspected.id) ? 'Your scouts have marked this approach. Review the travel cost before moving the convoy.' : run.visited.includes(inspected.id) ? 'Your convoy has already passed this stop.' : 'You can inspect this stop, but must follow a connected road to reach it.'}</p><p className={`caravan-travel-cost${supplyShortfall ? ' is-warning' : ''}`}>{run.available.includes(inspected.id) && `${travelCost} ${travelCost === 1 ? 'supply' : 'supplies'} to travel${supplyShortfall ? ` · Short by ${supplyShortfall}: lose ${supplyShortfall * 5}% cargo and ${supplyShortfall * 3}% morale.` : ` · ${run.supplies - travelCost} remaining afterward`}`}</p><div className="sunscar-button-row"><button disabled={busy || hasPending || !run.available.includes(inspected.id)} onClick={() => act('travel', { nodeId: inspected.id })}>{busy ? 'Moving caravan…' : inspected.kind === 'destination' ? 'Deliver the cargo' : 'Travel to this stop'}</button><button className="sunscar-secondary" disabled={busy} onClick={() => setSelectedNode(null)}>Other roads</button></div></div> : <div className="caravan-route-options"><h3>Choose the next road</h3>{run.available.map(id => { const stop = run.map.find(n => n.id === id)!; return <button key={id} className="sunscar-secondary" disabled={busy || hasPending} onClick={() => setSelectedNode(id)}>{CARAVAN_NODE_LABELS[stop.kind]} · {['Western', 'Middle', 'Eastern', 'Far eastern'][stop.column]} road →{stop.objectiveOpportunity && <small className="caravan-opportunity">Mission objective opportunity</small>}</button>; })}</div>}</>}
            </section></div>
            <div className="caravan-tools-inventory">{Object.entries(run.tools).filter(([, n]) => n > 0).map(([id, n]) => <span key={id}>{CARAVAN_TOOLS[id as CaravanTool].name} × {n}</span>)}</div>
            <details className="caravan-journal"><summary>Field journal · {run.log.length} reports</summary>{run.log.map((entry, i) => <article key={i}><h3>{entry.title}</h3><p>{entry.text}</p><small>Cargo {entry.cargo}% · Supplies {entry.supplies} · Morale {entry.morale}%</small></article>)}</details>
            <div className="caravan-retire">{retire ? <><p>Return without delivering? You keep earned discoveries and partial reputation. This uses today’s departure and pays no Ryo.</p><button disabled={busy || hasPending} onClick={() => act('retire')}>End this expedition</button><button className="sunscar-secondary" onClick={() => setRetire(false)}>Keep traveling</button></> : <><p>Your mission saves after each choice. You can leave the festival and resume your escort here.</p><button className="sunscar-secondary" disabled={busy || hasPending || run.status === 'combat' || awaitingPet} onClick={() => setRetire(true)}>Return without delivery</button></>}</div>
        </>}
        {session && <Suspense fallback={<div className="sunscar-loading" role="status">Preparing the encounter…</div>}><CaravanBattle {...catalogs} character={character} session={session} title={run?.contract.title ?? 'Caravan Run'} settle={settleCombat} onExit={() => { setSession(null); void send(); }}/></Suspense>}
    </div>;
}
