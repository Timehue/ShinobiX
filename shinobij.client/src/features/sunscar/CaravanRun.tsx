import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { requestCaravan, type CaravanResponse } from '../../lib/sunscar-caravan';
import { befriendWildPet, declineWildPetEncounter, startWildPetEncounter, type WildPetEncounterResult } from '../../lib/wild-pet-encounter-api';
import { petCardImage } from '../../lib/pet-battle-anim';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { CARAVAN_RANKS, CARAVAN_TOOLS, CARAVAN_WEATHER, caravanRank, type CaravanTool } from '../../../../shared/sunscar/caravan-types';
import { caravanChoiceBlock, caravanObjectiveComplete, currentCaravanNode } from '../../../../shared/sunscar/caravan-state';
import { caravanEvent } from '../../../../shared/sunscar/caravan-events';
import { CaravanMap } from './CaravanMap';
import { CARAVAN_NODE_LABELS } from './caravan-presentation';
import { CaravanBattle, type CaravanCombatCatalogs } from './CaravanBattle';
import { SunscarPrestige } from './SunscarPrestige';
import journeyArt from '../../assets/festival/sunscar-journey-atlas-v1.webp';
import { playPetSfx, primePetSfx } from '../../lib/pet-sfx';
import { startGameAmbience, stopGameAmbience } from '../../lib/game-audio';
import '../../styles/sunscar-modes.css';
import '../../styles/sunscar-caravan.css';

function day(now: number) { return new Date(now).toISOString().slice(0, 10); }
function Resource({ name, value, max = 100, tone = '' }: { name: string; value: number; max?: number; tone?: string }) {
    return <div className={`caravan-resource ${tone}`}><span>{name}<strong>{Math.round(value)}{max === 100 ? '%' : ` / ${max}`}</strong></span><meter aria-label={name} min={0} max={max} value={value} low={max * .25} optimum={max} /></div>;
}
export default function CaravanRun({ character, onVersionedCharacter, onBack, ...catalogs }: CaravanCombatCatalogs & { character: Character; onVersionedCharacter: VersionedCharacterCommit; onBack: () => void }) {
    const [response, setResponse] = useState<CaravanResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [contractId, setContractId] = useState('market-goods');
    const [tools, setTools] = useState<CaravanTool[]>(['water', 'repair', 'medicine']);
    const [petId, setPetId] = useState(character.activePetId ?? '');
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
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
    const commitCharacter = useRef(onVersionedCharacter);
    useLayoutEffect(() => { commitCharacter.current = onVersionedCharacter; }, [onVersionedCharacter]);
    const adopt = useCallback((data: CaravanResponse) => { setResponse(data); setSelectedNode(null); setRetire(false); commitCharacter.current(data.character, data._saveVersion); return data; }, []);
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
    useEffect(() => { panel.current?.focus({ preventScroll: true }); }, [run?.version]);
    useEffect(() => {
        if (!selectedNode || !inspection.current) return;
        inspection.current.focus({ preventScroll: true });
        inspection.current.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [selectedNode]);
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
    return <div className="sunscar-mode caravan-mode">
        <header className="sunscar-mode-heading"><div><button className="sunscar-back" onClick={onBack}>← Festival grounds</button><p className="sunscar-eyebrow">Sunscar Dispatch Office</p><h1>Caravan Run</h1><p>One manifest. A road full of choices.</p></div><div className="sunscar-rank"><strong>{rank.name}</strong><span>{progress?.reputation ?? 0} reputation · {progress?.deliveries ?? 0} deliveries</span>{nextRank && <small>{nextRank.at - (progress?.reputation ?? 0)} to {nextRank.name}</small>}</div></header>
        {error && <div className="sunscar-error" role="alert"><span>{error}</span><div className="sunscar-button-row"><button disabled={busy} onClick={() => void send(pending.current ?? undefined)}>{busy ? 'Reconnecting…' : hasPending ? 'Retry this choice' : 'Reload expedition'}</button>{hasPending && <button className="sunscar-secondary" onClick={() => void send()}>Read saved state</button>}</div></div>}
        {!response && !error && <div className="sunscar-loading" role="status">Opening today’s manifests…</div>}
        <SunscarPrestige mode="caravan" reputation={progress?.reputation ?? 0}/>
        {response && !active && <>
{run?.result && <section ref={receipt} tabIndex={-1} aria-label="Expedition result" className={`caravan-receipt ${run.status}`}><p className="sunscar-eyebrow">{run.day} · Manifest closed</p><h2>{run.status === 'complete' ? `Delivered to ${run.contract.destination}` : 'The journey ends here'}</h2><p>{run.result.reason}</p><div className="caravan-receipt-numbers"><strong>{run.result.ryo.toLocaleString()}<span>Ryo received</span></strong><strong>+{run.result.reputation}<span>Reputation</span></strong><strong>{run.result.cargo}%<span>Cargo preserved</span></strong><strong>{run.visited.length}<span>Legs traveled</span></strong></div><p>{run.enemiesDefeated} enemies defeated · {run.discoveries.length} discoveries · Employer objective {run.result.objectiveComplete ? 'completed' : 'unfinished'}</p>{run.discoveries.length > 0 && <p>Recorded: {run.discoveries.map(d => d.replaceAll('-', ' ')).join(' · ')}</p>}</section>}
            <div className="caravan-weather"><strong>{CARAVAN_WEATHER[response.daily.weather].name}</strong><span>{CARAVAN_WEATHER[response.daily.weather].description}</span><small>One departure daily · resets at 00:00 UTC</small></div>
            <div className="caravan-contract-grid" role="group" aria-label="Daily contracts">{response.daily.contracts.map(c => {
                const locked = response.progress.reputation < c.reputationRequired;
                return <button key={c.id} className={`caravan-contract${contract?.id === c.id ? ' is-selected' : ''}`} aria-pressed={contract?.id === c.id} onClick={() => setContractId(c.id)}><span className="sunscar-eyebrow">{['Standard', 'Demanding', 'Dangerous'][c.difficulty - 1]} · {c.nodes} legs</span><h2>{c.title}</h2><p className="caravan-employer">{c.employer}</p><p>{c.description}</p><span className="caravan-contract-cargo">{c.cargo} → {c.destination}</span><small>{locked ? `Requires ${c.reputationRequired} reputation` : c.objective.label}</small></button>;
            })}</div>
            {contract && <section className="caravan-preparation"><div><p className="sunscar-eyebrow">Before departure</p><h2>Pack for the road</h2><p>Choose three packs. Each is supplied by your employer. Repeated packs are allowed. General supplies pay for travel and some choices.</p><div className="caravan-pack-slots">{tools.map((tool, i) => <label key={i}>Pack {i + 1}<select value={tool} disabled={used || busy} onChange={e => setTools(old => old.map((t, n) => n === i ? e.target.value as CaravanTool : t))}>{Object.entries(CARAVAN_TOOLS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select><small>{CARAVAN_TOOLS[tool].description}</small></label>)}</div><label className="caravan-pet-select">Companion<select value={petId} disabled={busy || used} onChange={e => setPetId(e.target.value)}><option value="">Travel without a companion</option>{character.pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><div className="caravan-departure"><h3>{contract.title}</h3><p>{contract.supplies} supplies · 100% cargo · {CARAVAN_WEATHER[response.daily.weather].name}</p><Resource name="Health" value={character.hp} max={character.maxHp} tone="health"/><Resource name="Chakra" value={character.chakra} max={character.maxChakra} tone="chakra"/><Resource name="Stamina" value={character.stamina} max={character.maxStamina}/><p className="caravan-condition-note">You travel in your current condition. Battles use your equipped skills and items. Companions level 50 and above can be summoned, following normal combat rules. Damage persists; defeat follows normal hospital rules and ends the delivery.</p><button disabled={busy || used || response.progress.reputation < contract.reputationRequired || character.hp <= 0} onClick={() => act('depart', { contractId: contract.id, tools, petId })}>{busy ? 'Preparing wagons…' : used ? 'Daily departure used' : response.progress.reputation < contract.reputationRequired ? 'Employer reputation required' : 'Accept contract & depart'}</button>{used && <small>Your next manifest arrives at the daily reset.</small>}</div></section>}
        </>}
        {active && <>
            <div className="caravan-manifest"><div><p className="sunscar-eyebrow">{run.contract.employer}</p><h2>{run.contract.title}</h2><p>{run.contract.cargo} → {run.contract.destination}</p></div><div><strong>Leg {run.visited.length} / {run.contract.nodes}</strong><span>{CARAVAN_WEATHER[run.weather].name}</span><small>{CARAVAN_WEATHER[run.weather].description}</small></div></div>
            <div className="caravan-resource-bar"><Resource name="Cargo" value={run.cargo}/><Resource name="Supplies" value={run.supplies} max={30}/><Resource name="Morale" value={run.morale}/><Resource name="Health" value={character.hp} max={character.maxHp} tone="health"/><Resource name="Chakra" value={character.chakra} max={character.maxChakra} tone="chakra"/><Resource name="Stamina" value={character.stamina} max={character.maxStamina}/></div>
            <div className="caravan-journey"><CaravanMap run={run} selected={selectedNode} onSelect={n => setSelectedNode(n.id)}/><section className="caravan-encounter" ref={panel} tabIndex={-1} aria-label="Current expedition encounter">
                <div className="caravan-scene" data-region={node?.region ?? 'dunes'} style={{ backgroundImage: `url(${journeyArt})` }} aria-hidden="true"><span className="caravan-scene-caption">{node?.region ?? 'Sunscar'}</span></div>
                {awaitingPet ? <><p className="sunscar-eyebrow">A rare discovery</p><h2>Tracks in the luminous sand</h2>{wild?.kind === 'hit' ? <><img className="caravan-wild-portrait" src={petCardImage(wild.pet)} alt={wild.pet.name}/><p><strong>{wild.pet.name}</strong> watches from the shade. There is room to approach slowly.</p><div className="sunscar-button-row"><button disabled={busy} onClick={() => void resolvePet(true)}>Befriend companion</button><button disabled={busy} className="sunscar-secondary" onClick={() => void resolvePet(false)}>Leave in peace</button></div></> : wild?.kind === 'miss' || wild?.kind === 'resolved' ? <><p>{wild.kind === 'miss' ? 'The tracks end at a cool, empty hollow. Your crew rests a moment before returning to the wagons.' : 'This discovery has already been resolved. The crew is waiting on the road.'}</p><button disabled={busy} onClick={() => void send({ action: 'pet-return', runId: run.id }).then(data => { if (data) setWild(null); })}>Return to the road</button></> : <><p>The scout has found fresh tracks beneath the rock shelter. Follow them to see whether a wild companion is still nearby.</p><button disabled={busy} onClick={() => void followTrail()}>{busy ? 'Following tracks…' : 'Follow the wild trail'}</button><button disabled={busy} className="sunscar-secondary" onClick={() => void send({ action: 'pet-skip', runId: run.id })}>Leave the trail undisturbed</button><small>Wild companions use the usual exploration chance and daily limit. You can continue without approaching.</small></>}</>
                : run.status === 'combat' ? <><p className="sunscar-eyebrow">The convoy is halted</p><h2>Hold the road</h2><p>{last?.text}</p><p>Your crew shelters the cargo while you engage. Victory opens the next leg. Defeat ends the delivery.</p><button disabled={busy} onClick={() => void openCombat()}>{busy ? 'Preparing encounter…' : 'Enter battle'}</button></>
                : encounter ? <><p className="sunscar-eyebrow">{CARAVAN_NODE_LABELS[node!.kind]} · Leg {node!.layer + 1}</p><h2>{encounter.title}</h2><p className="caravan-scene-copy">{encounter.scene}</p><div className="caravan-choices">{encounter.choices.map(choice => { const blocked = caravanChoiceBlock(run, choice, character.ryo); const price = Math.ceil((choice.cost?.ryoFraction ?? 0) * run.baseReward); return <button key={choice.id} disabled={busy || hasPending || !!blocked} onClick={() => act('choose', { choiceId: choice.id })}><strong>{choice.label}</strong><span>{choice.hint}{price ? ` · ${price.toLocaleString()} Ryo` : ''}</span>{blocked && <small>{blocked}</small>}</button>; })}</div></>
                : <><p className="sunscar-eyebrow">{last ? 'Journey journal' : 'Your first crossing'}</p><h2>{last?.title ?? 'The gates stand open'}</h2><p className="caravan-scene-copy">{last?.text ?? 'The quartermaster seals the manifest. Pick a connected road on the chart and inspect your first stop.'}</p>{petMessage && <p className="caravan-pet-message" role="status">{petMessage}</p>}{inspected ? <div className="caravan-next-stop" ref={inspection} tabIndex={-1} aria-label="Selected road"><strong>{CARAVAN_NODE_LABELS[inspected.kind]} · Leg {inspected.layer + 1}</strong><p>{run.available.includes(inspected.id) ? 'This road is connected to your caravan. Travel spends at least one general supply; exhausted supplies damage cargo.' : run.visited.includes(inspected.id) ? 'Your convoy has already passed this stop.' : 'You can inspect this stop, but must follow a connected road to reach it.'}</p><button disabled={busy || hasPending || !run.available.includes(inspected.id)} onClick={() => act('travel', { nodeId: inspected.id })}>{inspected.kind === 'destination' ? 'Deliver the cargo' : 'Travel to this stop'}</button></div> : <div className="caravan-route-options"><h3>Choose the next road</h3>{run.available.map(id => { const stop = run.map.find(n => n.id === id)!; return <button key={id} className="sunscar-secondary" onClick={() => setSelectedNode(id)}>{CARAVAN_NODE_LABELS[stop.kind]} · {['Western', 'Middle', 'Eastern', 'Far eastern'][stop.column]} road →</button>; })}</div>}</>}
                <div className="caravan-objective"><strong>{caravanObjectiveComplete(run) ? '✓ ' : ''}Employer objective</strong><span>{run.contract.objective.label}</span><small>Complete for a delivery bonus.</small></div>
            </section></div>
            <div className="caravan-tools-inventory">{Object.entries(run.tools).filter(([, n]) => n > 0).map(([id, n]) => <span key={id}>{CARAVAN_TOOLS[id as CaravanTool].name} × {n}</span>)}</div>
            <details className="caravan-journal"><summary>Journey journal · {run.log.length} entries</summary>{run.log.map((entry, i) => <article key={i}><h3>{entry.title}</h3><p>{entry.text}</p><small>Cargo {entry.cargo}% · Supplies {entry.supplies} · Morale {entry.morale}%</small></article>)}</details>
            <div className="caravan-retire">{retire ? <><p>Return without delivering? You keep earned discoveries and partial reputation. This uses today’s departure and pays no Ryo.</p><button disabled={busy} onClick={() => act('retire')}>End this expedition</button><button className="sunscar-secondary" onClick={() => setRetire(false)}>Keep traveling</button></> : <><p>Your expedition saves after each choice. You can leave the festival and resume here.</p><button className="sunscar-secondary" disabled={run.status === 'combat' || awaitingPet} onClick={() => setRetire(true)}>Return without delivery</button></>}</div>
        </>}
        {session && <CaravanBattle {...catalogs} character={character} session={session} title={run?.contract.title ?? 'Caravan Run'} onVersionedCharacter={onVersionedCharacter} settle={settleCombat} onExit={() => { setSession(null); void send(); }}/>}
    </div>;
}
