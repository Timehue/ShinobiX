import { useCallback, useEffect, useRef, useState } from 'react';
import { TACTICS_ITEMS, TACTICS_ROSTER, tacticsPreset, tacticsSpecies } from '../../../shared/pet-tactics-roster';
import type { TacticsBuild, TacticsMoveOption, TacticsOrder, TacticsPetSheet, TacticsRound, TacticsView } from '../../../shared/pet-tactics-contract';
import type { ShowdownStateView } from '../../../shared/pet-showdown-contract';
import type { Pet } from '../types/pet';
import type { ShowdownTurnResult } from '../lib/pet-showdown-api';
import { petTacticsRequest } from '../lib/pet-tactics-api';
import { petScenicPortraitImage as petCardImage } from '../lib/pet-scenic-portrait';
import { PetShowdownBattle } from './PetShowdownBattle';
import { warmShowdownModels } from '../lib/pet-model-preload';
import { petRankedQueue, settleRankedPetMatch } from '../lib/pet-ranked-queue-api';
import type { Character } from '../types/character';
import { rankedBattlePresentationPets, rankedCarriedRoster } from '../lib/pet-ranked-roster';
import { ShowdownIcon, type ShowdownIconName } from './icons/ShowdownIcon';
import { elementCrest } from './pet-showdown/presentation-tokens';
import { ELEMENT_ICON } from '../lib/element-icons';
import { PetTacticsBuildEditor } from './PetTacticsBuildEditor';
import { savePetRankedBuild } from '../lib/pet-ranked-build-api';
import { tacticsBuildIssue } from '../../../shared/pet-tactics-build';
import '../styles/pet-tactics.css';
import '../styles/pet-arena-presentation.css';

function portrait(speciesId: string, images: Record<string, string>): string {
    const pet = tacticsSpecies(speciesId)!;
    return petCardImage({ id: speciesId, templateId: speciesId, name: pet.name, rarity: pet.rarity, element: pet.element, level: 50 } as Pet, images);
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The arena could not answer.';

export function PetTacticsArena({ playerName, character, sharedImages = {}, onExit, onActiveChange, onFullscreenChange, ranked = false, rankedEligible = true, onVersionedCharacter }: {
    playerName: string; sharedImages?: Record<string, string>; onExit: () => void;
    onActiveChange?: (active: boolean) => void; onFullscreenChange?: (active: boolean) => void;
    character?: Character; ranked?: boolean; rankedEligible?: boolean; onVersionedCharacter?: (character: Character, version: number) => boolean;
}) {
    const roster = ranked ? rankedCarriedRoster(character) : TACTICS_ROSTER.map(p => ({ ...p, key: p.id, unavailable: null, build: tacticsPreset(p.id) }));
    const [builds, setBuilds] = useState<TacticsBuild[]>(() => ranked ? [] : ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth'].map(id => tacticsPreset(id)));
    const usableBuilds = ranked ? builds.filter(b => roster.some(p => p.key === b.ownedPetId && p.id === b.speciesId && !p.unavailable)) : builds;
    const buildIssue = usableBuilds.map(build => tacticsBuildIssue(build)).find(Boolean);
    const [view, setView] = useState<TacticsView | null>(null);
    const [initial, setInitial] = useState<ShowdownStateView | null>(null);
    const [presented, setPresented] = useState(0);
    const [terminalPresented, setTerminalPresented] = useState(false);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [recovering, setRecovering] = useState(true);
    const [queued, setQueued] = useState(false);
    const [settlement, setSettlement] = useState<'pending' | 'recorded'>('pending');
    const settling = useRef(false);
    const [clock, setClock] = useState(Date.now);
    const live = useRef<TacticsView | null>(null);
    const initialRef = useRef<ShowdownStateView | null>(null);
    const rounds = useRef(new Map<number, TacticsRound>());
    const acked = useRef(new Set<string>());
    const presentedRef = useRef(0);
    const alive = useRef(true);
    const [offset, setOffset] = useState(0);
    const ingest = useCallback((next: TacticsView | null) => {
        if (!alive.current || !next) return;
        if (live.current?.roomId === next.roomId && live.current.revision > next.revision) return;
        if (live.current?.roomId !== next.roomId) {
            rounds.current.clear(); acked.current.clear(); initialRef.current = null;
            setInitial(null); setTerminalPresented(false);
            setSettlement('pending');
        }
        // The clock only advances when the shown second changes (below), so a
        // new deadline/offset must arrive with a fresh clock in the same render.
        const receivedAt = Date.now();
        live.current = next; setOffset(next.serverNow - receivedAt); setClock(receivedAt);
        for (const turn of next.transcript) rounds.current.set(turn.round, turn);
        if (!initialRef.current && next.opponent && ['planning', 'playback', 'finished'].includes(next.phase)) {
            initialRef.current = next.battle; presentedRef.current = next.round; setInitial(next.battle); setPresented(next.round);
        }
        setView(next);
    }, []);
    const request = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
        if (ranked && ['recover', 'queue', 'queue-leave', 'queue-poll'].includes(action)) {
            const queue = await petRankedQueue(action === 'queue' ? 'join' : action === 'queue-leave' ? 'leave' : 'poll', playerName,
                undefined, undefined, payload.builds as TacticsBuild[] | undefined);
            if (!alive.current) return null;
            if ((queue.state === 'active' || queue.state === 'completed') && queue.control === 'pet-arena-player-v1' && queue.roomId) {
                const next = await petTacticsRequest('poll', { roomId: queue.roomId }); ingest(next); setQueued(false); return next;
            }
            setQueued(queue.state === 'queued');
            if (queue.state !== 'idle' && queue.state !== 'queued') throw new Error('Finish your retained ranked result in the Pet Ladder before starting another match.');
            return null;
        }
        const next = await petTacticsRequest(action, { ...(live.current ? { roomId: live.current.roomId } : {}), ...payload });
        ingest(next); return next;
    }, [ingest, ranked, playerName]);
    useEffect(() => {
        alive.current = true;
        const timer = window.setTimeout(() => {
            void request('recover').catch(e => { if (alive.current) setError(errorMessage(e)); }).finally(() => { if (alive.current) setRecovering(false); });
        }, 0);
        return () => { alive.current = false; window.clearTimeout(timer); };
    }, [request, playerName]);
    useEffect(() => {
        if (!ranked || !queued || view) return;
        let cancelled = false; let timer = 0;
        const poll = async () => {
            try { await request('queue-poll'); if (!cancelled) setError(''); }
            catch (e) { if (!cancelled) setError(errorMessage(e)); }
            if (!cancelled) timer = window.setTimeout(poll, 2500);
        };
        timer = window.setTimeout(poll, 2500);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [ranked, queued, view, request]);
    // Display clock for the room/preview/planning countdown. It ticks only while
    // a room is live and not finished, and it commits a new value only when the
    // whole second on screen changes, so the 3D battle re-renders at most 1 Hz.
    const clockDeadline = view?.deadline;
    const clockLive = !!view && view.phase !== 'finished';
    useEffect(() => {
        if (!clockLive || clockDeadline == null) return;
        const shownSeconds = (at: number) => Math.max(0, Math.ceil((clockDeadline - at - offset) / 1000));
        const timer = window.setInterval(() => {
            const at = Date.now();
            setClock(prev => shownSeconds(prev) === shownSeconds(at) ? prev : at);
        }, 500);
        return () => window.clearInterval(timer);
    }, [clockLive, clockDeadline, offset]);
    useEffect(() => {
        if (view?.opponent) void warmShowdownModels(view.battle, []);
        // Warm both sealed squads during preview, before the first attack.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view?.roomId, view?.opponent]);
    const roomId = view?.roomId, finished = view?.phase === 'finished', opponent = view?.opponent;
    useEffect(() => {
        if (!roomId || finished) return;
        let cancelled = false;
        let timer: number;
        const poll = async () => {
            try { await request('poll', { afterRound: presentedRef.current }); if (!cancelled) setError(''); }
            catch (e) { if (!cancelled) setError(errorMessage(e)); }
            if (!cancelled) timer = window.setTimeout(poll, 1500);
        };
        timer = window.setTimeout(poll, 1500);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [roomId, finished, request]);
    useEffect(() => {
        onActiveChange?.(queued || !!opponent && !finished);
        onFullscreenChange?.(!!initial);
        return () => { onActiveChange?.(false); onFullscreenChange?.(false); };
    }, [queued, opponent, finished, initial, onActiveChange, onFullscreenChange]);
    const run = async (action: string, payload: Record<string, unknown> = {}) => {
        setBusy(true); setError('');
        try { await request(action, payload); }
        catch (e) { if (alive.current) setError(errorMessage(e)); }
        finally { if (alive.current) setBusy(false); }
    };
    const acknowledge = useCallback((round: number) => {
        setPresented(round);
        presentedRef.current = round;
        const current = live.current;
        if (!current || current.phase !== 'playback' || current.round !== round) return;
        const key = `${current.roomId}:${round}`;
        if (acked.current.has(key)) return;
        acked.current.add(key);
        void request('ack', { round }).catch(e => { acked.current.delete(key); if (alive.current) setError(errorMessage(e)); });
    }, [request]);
    // Polling is the authority transport. The renderer receives only a committed round.
    const playback = useCallback(async (_commands: unknown, expectedRound: number): Promise<ShowdownTurnResult> => {
        // Renderer effects can request a round while a poll is being ingested.
        // Hold the transport promise until that sealed script is available;
        // absence of a script is a waiting state, not a refused command batch.
        while (alive.current) {
            const next = rounds.current.get(expectedRound + 1);
            if (next) return { ok: true, practice: true, events: next.events, state: next.state };
            const current = live.current;
            if (current?.phase === 'finished') return { ok: true, practice: true, events: [], state: current.battle };
            await new Promise(resolve => window.setTimeout(resolve, 200));
        }
        return { expired: true };
    }, []);
    const seconds = view ? Math.max(0, Math.ceil((view.deadline - clock - offset) / 1000)) : 0;
    const recordRanked = useCallback(async () => {
        const current = live.current;
        if (!current?.ranked || current.phase !== 'finished' || settling.current) return;
        settling.current = true;
        try {
            const snapshot = await settleRankedPetMatch({ playerName, matchToken: current.ranked.matchToken, opponentName: current.opponent!, outcome: current.result! });
            if (onVersionedCharacter && !onVersionedCharacter(snapshot.character, snapshot._saveVersion)) throw new Error('The ranked result is recorded, but your newer save must be recovered before leaving. Retry.');
            if (alive.current) { setSettlement('recorded'); setError(''); }
        } catch (e) { if (alive.current) setError(errorMessage(e)); }
        finally { settling.current = false; }
    }, [playerName, onVersionedCharacter]);
    const rankedToken = view?.ranked?.matchToken;
    useEffect(() => {
        if (!rankedToken || !finished || settlement === 'recorded') return;
        const timer = window.setTimeout(() => void recordRanked(), 0);
        return () => window.clearTimeout(timer);
    }, [rankedToken, finished, settlement, recordRanked]);
    const leaveResult = async () => {
        if (view?.ranked) {
            if (settlement !== 'recorded') { await recordRanked(); return; }
            try { await petRankedQueue('acknowledge', playerName, view.ranked.matchToken); } catch (e) { setError(errorMessage(e)); return; }
        }
        live.current = null; initialRef.current = null; setView(null); setInitial(null); setError(''); setTerminalPresented(false); setQueued(false);
    };
    const network = error ? <div className="pta-error" role="alert">{error}<button type="button" onClick={() => void run(view ? 'poll' : 'recover')}>Reconnect</button></div> : null;

    if (initial && view) {
        const commandReady = view.phase === 'planning' && presented === view.round;
        const ownPresentationPets = rankedBattlePresentationPets(character, view.own);
        return <PetShowdownBattle key={view.roomId} spectator initialState={initial} playerPets={ownPresentationPets} sharedImages={sharedImages}
            submitTurn={playback} inputLocked={view.round <= presented && view.phase !== 'finished'}
            onRoundPresented={acknowledge} onForfeit={async () => { await run('concede'); }} onExit={leaveResult}
            onFinished={() => setTerminalPresented(true)} onRematch={leaveResult} hideRematch
            exitLabel={view.ranked && settlement !== 'recorded' ? 'Record ranked result' : 'Back to squad builder'} eventLabel={`Pet Arena · ${view.opponent}`}
            resultTitle={() => view.result === 'draw' ? 'DRAW' : view.result === 'win' ? 'VICTORY' : 'DEFEAT'}
            resultNote={() => `${view.ranked ? settlement === 'recorded' ? 'Pet Elo recorded' : 'Recording Pet Elo' : 'Unrated sparring'} · ${view.reason ?? 'Battle complete'} · ${view.round} rounds`}
            hidePlayerHud={commandReady} externalControls={!terminalPresented || !!error ? <div className="pta-console">
                {network}
                {commandReady ? <CommandDeck key={`${view.roomId}:${view.round}`} view={view} seconds={seconds} busy={busy} images={sharedImages}
                    onLock={orders => void run('orders', { round: view.round + 1, orders })} />
                    : <div className="pta-wait" role="status">{view.phase === 'finished' ? 'Playing the confirmed battle result…' : presented < view.round ? 'Round resolving' : 'Waiting for both players to finish playback'}<small>Both players share the same planning clock.</small></div>}
            </div> : null} />;
    }
    return <section className="pet-tactics" aria-label="Pet Arena">
        <header className="pta-heading"><div><span className="pta-kicker">{ranked ? 'Ranked Pet Colosseum · player controlled' : 'Live PvP · sparring'}</span><h1>Pet Arena</h1><p>Two minds. Four companions. Every order matters.</p></div>{!ranked && <button type="button" onClick={onExit}>Back to Pet Arena</button>}</header>
        {network}
        {recovering ? <p role="status">Recovering your arena session…</p> : queued && !view ? <div className="pta-invite"><h2>Finding a ranked opponent</h2><p role="status">Your loadout is locked for this match. Both players choose their own orders each round.</p><button type="button" disabled={busy} onClick={() => void run('queue-leave')}>Cancel ranked search</button></div> : view?.phase === 'waiting' ? <div className="pta-invite">
            <span className="pta-kicker">Your squad is locked in</span><h2>Bring a challenger</h2><p>Give this code to another player. They join with their own account and squad.</p>
            <strong className="pta-room-code" aria-label="Arena room code">{view.roomId.toUpperCase()}</strong>
            <p>Room closes in {seconds}s. Your owned pets and rating are unaffected.</p>
            <button type="button" disabled={busy} onClick={() => void run('concede')}>Close room</button>
        </div> : view?.phase === 'preview' ? <Preview view={view} seconds={seconds} images={sharedImages} busy={busy} onLock={leads => void run('leads', { leads })} onConcede={() => void run('concede')} />
            : <>
                <div className="pta-rules"><span>Level 50 · balanced stats</span><span>2 active + 2 reserves</span><span>4 equipped moves + signature</span><span>45s simultaneous orders</span></div>
                <div className="pta-builder-layout"><div>
                    <h2>{ranked ? 'Choose your carried companions' : 'Build your squad'} <small>{usableBuilds.length}/4 selected</small></h2>
                    {ranked && roster.filter(p => !p.unavailable).length < 4 && <p role="status">Carry four available pets to enter ranked. Manage your companions in the Pet Yard.</p>}
                    <div className="pta-roster">{roster.map(pet => {
                        const index = usableBuilds.findIndex(b => ranked ? b.ownedPetId === pet.key : b.speciesId === pet.id);
                        return <button type="button" key={pet.key} aria-pressed={index >= 0} disabled={!!pet.unavailable || (index < 0 && usableBuilds.length >= 4)}
                            className={`pta-roster-pet element-${pet.element}`} onClick={() => setBuilds(index >= 0 ? usableBuilds.filter((_, i) => i !== index) : [...usableBuilds, pet.build])}>
                            <img src={portrait(pet.id, sharedImages)} alt="" loading="lazy" /><span><strong>{pet.name}</strong><small>{pet.unavailable ?? `${pet.element} · ${pet.role}`}</small></span>{index >= 0 && <b>{index + 1}</b>}
                        </button>;
                    })}</div>
                    <div className="pta-builds">{usableBuilds.map((build, index) => <PetTacticsBuildEditor key={build.ownedPetId ?? build.speciesId} build={build}
                        defaultExpanded={index === 0}
                        name={roster.find(p => p.key === (build.ownedPetId ?? build.speciesId))?.name}
                        onChange={next => setBuilds(usableBuilds.map((b, i) => i === index ? next : b))}
                        savedBuild={character?.pets.find(p => p.id === build.ownedPetId)?.rankedBuild}
                        onSave={ranked && onVersionedCharacter ? async next => {
                            const result = await savePetRankedBuild(playerName, next);
                            onVersionedCharacter(result.character, result._saveVersion);
                        } : undefined} />)}</div>
                </div><aside className="pta-admission"><span className="pta-kicker">{ranked ? 'Pet Colosseum ranked queue' : 'Challenge room'}</span><h2>Meet on equal ground</h2>
                    <p>{ranked ? 'Bring the companions you carry. Their species and evolved forms stay their own; competitive stats are balanced at level 50.' : 'Choose from the sparring roster. Rarity changes identity, never your damage multiplier.'}</p>
                    {buildIssue && <p role="status">Complete each pet’s move loadout before entering.</p>}
                    {ranked ? <><p>Player-controlled 2v2 with two reserves. Pet Elo changes only after the committed battle ends.</p>{!rankedEligible && <p role="alert">Reach the ranked level requirement before joining.</p>}<button className="pta-primary" type="button" disabled={busy || usableBuilds.length !== 4 || !!buildIssue || !rankedEligible} onClick={() => void run('queue', { builds: usableBuilds })}>Find ranked match</button></> : <><button className="pta-primary" type="button" disabled={busy || builds.length !== 4 || !!buildIssue} onClick={() => void run('create', { builds })}>Create arena room</button>
                    <div className="pta-divider">or join a challenger</div><label htmlFor="pta-room">Arena code</label>
                    <input id="pta-room" value={code} maxLength={8} autoComplete="off" spellCheck={false} placeholder="8-character code" onChange={e => setCode(e.target.value)} />
                    <button type="button" disabled={busy || builds.length !== 4 || !!buildIssue || !/^[0-9a-f]{8}$/i.test(code.trim())} onClick={() => void run('join', { roomId: code, builds })}>Join arena</button></>}
                    <details><summary>How to create an advantage</summary><p>Expose a target, then focus fire. Intercept covers your partner. Switch before attacks to change an elemental matchup. Rest or rotate to recover stamina. Save a signature for the right opening; it costs stamina and takes at least three field rounds to prepare.</p><p>Guard resolves before attacks, but repeated Guard costs more and blocks less. Purify answers marks, wounds and control. Read the other team’s four moves before choosing your leads.</p><p>{ranked ? 'Ranked changes Pet Elo for both participants. Your companions keep their training. No ryo or battle items are spent.' : 'Sparring is unrated. No ryo or battle items are spent.'}</p></details>
                </aside></div>
            </>}
    </section>;
}

function TeamSheet({ pets, label, images = {} }: { pets: TacticsPetSheet[]; label: string; images?: Record<string, string> }) {
    return <details className="pta-sheet"><summary>{label} · open team sheet</summary><div className="pta-sheet-grid">{pets.map(p => <article key={p.id}>
        <img src={portrait(p.speciesId, images)} alt="" /><strong>{p.name}</strong><small>{p.element} · {p.role} · {p.slot === null ? 'reserve' : `slot ${p.slot + 1}`}</small>
        <p>{p.trait}</p><p>{TACTICS_ITEMS.find(i => i.id === p.item)?.name}</p>
        <dl>{Object.entries(p.stats).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {p.moves.filter(m => m.id !== 'basic').map(m => <p key={m.id}><b>{m.name}</b> · {m.cost} STA<br />{m.effect}</p>)}<p><b>{p.signature.name}</b><br />{p.signature.effect}</p>
    </article>)}</div></details>;
}
function Preview({ view, seconds, images, busy, onLock, onConcede }: { view: TacticsView; seconds: number; images: Record<string, string>; busy: boolean; onLock: (leads: number[]) => void; onConcede: () => void }) {
    const [draftLeads, setLeads] = useState<number[]>(() => view.ownLeads ?? [0, 1]);
    const leads = view.ownLeads ?? draftLeads;
    return <div className="pta-preview"><div className="pta-preview-title"><span className="pta-kicker">{view.opponent} has entered</span><h2>Read their squad. Choose your opening.</h2><strong>{seconds}s</strong></div>
        <TeamSheet pets={view.enemy} label={view.opponent ?? 'Challenger'} images={images} />
        <div className="pta-leads">{view.own.map((pet, index) => <button type="button" aria-pressed={leads.includes(index)} disabled={busy || view.ready.own}
            key={pet.id} onClick={() => setLeads(old => old.includes(index) ? old.filter(i => i !== index) : old.length < 2 ? [...old, index] : [old[1], index])}>
            <img src={portrait(pet.speciesId, images)} alt="" /><strong>{pet.name}</strong><small>{pet.element} · {pet.role}</small><b>{leads.includes(index) ? `Lead ${leads.indexOf(index) + 1}` : 'Reserve'}</b>
        </button>)}</div>
        <TeamSheet pets={view.own} label="Your squad" images={images} />
        <p>Lead selections stay private until both sides lock. At the deadline, unlocked selections use the first two squad pets.</p>
        <button className="pta-primary" type="button" disabled={busy || view.ready.own || leads.length !== 2} onClick={() => onLock(leads)}>{view.ready.own ? 'Leads locked · waiting for challenger' : 'Lock opening pair'}</button>
        <button type="button" onClick={onConcede} disabled={busy}>Concede</button>
    </div>;
}

function ArenaGlyph({ name }: { name: string }) {
    const utility: Record<string, ShowdownIconName> = { guard: 'brace', rest: 'breath', switch: 'rotate', signature: 'signature',
        damage: 'strike', heal: 'mend', shield: 'aegis', protect: 'brace', redirect: 'aegis', cleanse: 'steadfast', buff: 'wax', mark: 'mark', stun: 'bind', wound: 'rend', slow: 'drag', weather: 'elem-wind', burn: 'pyre' };
    return <ShowdownIcon name={utility[name] ?? elementCrest(name)} size={24} />;
}

function orderName(order: TacticsOrder | undefined, pet: TacticsPetSheet, squad: TacticsPetSheet[]) {
    if (!order) return 'Choose an action';
    if (order.kind === 'move') return pet.moves.find(m => m.id === order.moveId)?.name ?? 'Move';
    if (order.kind === 'signature') return pet.signature.name;
    if (order.kind === 'switch') return `Switch to ${squad.find(p => p.id === order.reserveId)?.name}`;
    return order.kind === 'basic' ? pet.moves.find(m => m.id === 'basic')?.name ?? 'Basic attack' : order.kind === 'guard' ? 'Guard' : 'Rest';
}

function CommandDeck({ view, seconds, busy, images, onLock }: { view: TacticsView; seconds: number; busy: boolean; images: Record<string, string>; onLock: (orders: TacticsOrder[]) => void }) {
    const [draft, setDraft] = useState<Record<string, TacticsOrder>>({});
    const field = view.own.filter(p => p.slot !== null && !p.ko).sort((a, b) => a.slot! - b.slot!);
    const [actorId, setActorId] = useState(() => field[0]?.id);
    const [category, setCategory] = useState<'moves' | 'tactics' | 'reserves'>('moves');
    const commandScroll = useRef<HTMLDivElement>(null);
    const actionDetail = useRef<HTMLElement>(null);
    const intel = useRef<HTMLDialogElement>(null);
    const locked = view.ready.own;
    const orders = locked ? view.ownOrders ?? [] : field.map(p => draft[p.id]).filter(Boolean);
    const switches = orders.filter(o => o.kind === 'switch');
    const batchError = orders.filter(o => o.kind === 'signature').length > 1 ? 'Choose one signature per team this round.'
        : new Set(switches.map(o => o.reserveId)).size !== switches.length ? 'Each switch needs a different reserve.' : null;
    const pet = field.find(p => p.id === actorId) ?? field[0];
    const order = orders.find(o => o.actorId === pet?.id);
    const selected = !order ? '' : order.kind === 'move' ? order.moveId : order.kind === 'switch' ? `switch:${order.reserveId}` : order.kind;
    useEffect(() => {
        if (selected && window.matchMedia('(max-width: 800px)').matches) actionDetail.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);
    const move = order?.kind === 'signature' ? pet.signature : order?.kind === 'move' ? pet.moves.find(m => m.id === order.moveId) : order?.kind === 'basic' ? pet.moves.find(m => m.id === 'basic') : undefined;
    const targets = move?.target === 'foe' ? view.enemy : view.own;
    const aim = order && 'targetSlot' in order ? order.targetSlot : pet?.slot ?? 0;
    const range = move?.ranges.find(r => r.slot === aim);
    const update = (next: TacticsOrder) => setDraft(old => ({ ...old, [next.actorId]: next }));
    const chooseMove = (chosen: TacticsMoveOption, signature = false) => {
        const eligible = (chosen.target === 'foe' ? view.enemy : view.own).filter(p => p.slot !== null && !p.ko);
        const targetSlot = chosen.target === 'self' || chosen.target === 'team' ? pet.slot! : eligible.find(p => p.slot === aim)?.slot ?? eligible[0]?.slot ?? 0;
        update(signature ? { kind: 'signature', actorId: pet.id, targetSlot } : chosen.id === 'basic' ? { kind: 'basic', actorId: pet.id, targetSlot } : { kind: 'move', actorId: pet.id, moveId: chosen.id, targetSlot });
    };
    if (!pet) return <div className="pta-wait" role="status">Waiting for your next pair…</div>;
    const moveCard = (option: TacticsMoveOption, signature = false) => {
        const active = selected === (signature ? 'signature' : option.id);
        return <button type="button" key={option.id} data-action={signature ? 'signature' : option.id}
            className={`pta-move-card element-${option.element} ${signature ? 'is-signature' : ''}`}
            style={{ '--move-art': ELEMENT_ICON[option.element] ? `url(${ELEMENT_ICON[option.element]})` : 'none' } as React.CSSProperties}
            aria-label={`${option.name}, ${option.cost} stamina${option.reason ? `, ${option.reason}` : ''}`}
            aria-pressed={active} disabled={busy || locked || !option.available} onClick={() => chooseMove(option, signature)}
            title={`${option.effect}${option.reason ? ` · ${option.reason}` : ''}`}>
            <span className="pta-move-glyph"><ArenaGlyph name={signature ? 'signature' : option.element === 'None' ? option.kind : option.element} /></span>
            <span className="pta-move-copy"><strong>{option.name}</strong><small>{option.reason ?? (signature ? 'Signature · once per battle' : `${option.element === 'None' ? 'Neutral' : option.element} · ${option.cls === 'status' ? 'Support' : option.cls}`)}</small></span>
            <span className="pta-move-cost"><b>{option.cost}</b><small>STA</small></span>
            {active && <span className="pta-selected-mark" aria-hidden="true">✓</span>}
        </button>;
    };
    return <div className={`pta-orders ${locked ? 'is-locked' : ''}`}>
        <header className="pta-orders-heading">
            <div><span className="pta-kicker">Pet Arena · Round {view.round + 1}</span><strong>{locked ? 'Orders locked in' : 'Plan your next play'}</strong></div>
            <span className={`pta-opponent-state ${view.ready.opponent ? 'is-ready' : ''}`}><i />{view.ready.opponent ? 'Opponent ready' : 'Opponent planning'}</span>
            <span className={`pta-clock ${seconds <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${seconds} seconds remaining`}><b>{seconds}</b><small>SEC</small></span>
        </header>
        <div className="pta-command-layout" ref={commandScroll}>
            <nav className="pta-actor-rail" aria-label="Choose a pet to command">
                {field.map(p => { const picked = orders.find(o => o.actorId === p.id); return <button type="button" key={p.id}
                    className={`pta-actor element-${p.element}`} aria-label={`Command ${p.name}`} aria-pressed={p.id === pet.id}
                    onClick={() => { setActorId(p.id); commandScroll.current?.scrollTo({ top: 0 }); }}>
                    <img src={portrait(p.speciesId, images)} alt="" /><span><strong>{p.name}</strong><small>{orderName(picked, p, view.own)}</small>
                        {([['HP', p.hp, p.maxHp], ['Energy', p.stamina, 100]] as const).map(([label, value, max]) => <span className="pta-vital" key={label}><small>{label}<b>{value}/{max}</b></small><progress aria-label={`${p.name} ${label}`} value={value} max={max} /></span>)}
                    </span><b aria-label={picked ? 'Order chosen' : 'Order needed'}>{picked ? '✓' : p.slot! + 1}</b>
                </button>; })}
            </nav>
            <section className={`pta-action-panel element-${pet.element}`} aria-label={`Orders for ${pet.name}`}>
                <div className="pta-pet-resources"><span><ArenaGlyph name={pet.element} /><strong>{pet.name}</strong></span>
                    <div><small>Meter <b>{pet.meter}%</b></small></div>
                </div>
                {pet.conditions.length > 0 && <small className="pta-conditions">{pet.conditions.join(' · ')}</small>}
                <nav className="pta-action-tabs" aria-label="Action categories">
                    {(['moves', 'tactics', 'reserves'] as const).map(c => <button type="button" key={c} aria-pressed={category === c} onClick={() => { setCategory(c); commandScroll.current?.scrollTo({ top: 0 }); }}><ArenaGlyph name={c === 'moves' ? 'damage' : c === 'tactics' ? 'guard' : 'switch'} />{c === 'moves' ? 'Moves' : c === 'tactics' ? 'Guard / Rest' : 'Switch'}</button>)}
                </nav>
                <div className="pta-action-grid">
                    {category === 'moves' ? <>{pet.moves.map(m => moveCard(m))}{moveCard(pet.signature, true)}</> : category === 'tactics' ? <>
                        <button type="button" className="pta-utility-card" data-action="guard" aria-pressed={selected === 'guard'} disabled={busy || locked || pet.stamina < pet.guardCost} onClick={() => update({ kind: 'guard', actorId: pet.id })}>
                            <ArenaGlyph name="guard" /><strong>Guard</strong><small>{pet.guardCost} STA · {pet.guardReduction}% block</small>{pet.stamina < pet.guardCost && <small>Not enough stamina</small>}
                        </button>
                        <button type="button" className="pta-utility-card" data-action="rest" aria-pressed={selected === 'rest'} disabled={busy || locked} onClick={() => update({ kind: 'rest', actorId: pet.id })}>
                            <ArenaGlyph name="rest" /><strong>Rest</strong><small>Recover 30 STA + passive recovery</small>
                        </button>
                    </> : view.own.filter(p => p.slot === null && !p.ko).map(p => <button type="button" key={p.id} data-action={`switch:${p.id}`} className={`pta-reserve-card element-${p.element}`} aria-pressed={selected === `switch:${p.id}`} disabled={busy || locked} onClick={() => update({ kind: 'switch', actorId: pet.id, reserveId: p.id })}>
                        <img src={portrait(p.speciesId, images)} alt="" /><span><strong>{p.name}</strong><small>{p.hp}/{p.maxHp} HP · {p.stamina} STA</small></span><ArenaGlyph name="switch" />
                    </button>)}
                    {category === 'reserves' && !view.own.some(p => p.slot === null && !p.ko) && <p className="pta-empty">No reserves available.</p>}
                </div>
            </section>
            <aside className={`pta-action-detail ${!order ? 'is-empty' : ''}`} aria-label="Selected action" ref={actionDetail}>
                {!order && <img className="pta-detail-art" src={portrait(pet.speciesId, images)} alt="" />}
                <span className="pta-kicker">{order ? 'Your play' : 'Choose your play'}</span>
                <strong>{orderName(order, pet, view.own)}</strong>
                <p className="pta-order-effect">{move?.effect ?? (order?.kind === 'switch' ? 'Switch before attacks. Your incoming pet takes aimed hits and uses this action.' : order?.kind === 'guard' ? `Block ${pet.guardReduction}% damage before attacks. Repeated Guard costs more and blocks less.` : order?.kind === 'rest' ? 'Recover stamina without healing. Cover your partner while they recharge.' : 'Choose a move, cover your partner, or rotate a reserve into a better matchup.')}</p>
                {move && ['foe', 'ally'].includes(move.target) && <div className="pta-targets" role="group" aria-label={`Target for ${pet.name}`}>
                    <span>{move.target === 'foe' ? 'Aim at opponent' : 'Choose an ally'}</span>
                    <div>{targets.filter(p => p.slot !== null && !p.ko).map(p => <button type="button" key={p.id} data-target-slot={p.slot!} aria-label={`Target ${p.name}`} aria-pressed={p.slot === aim} disabled={busy || locked} className={`element-${p.element}`} onClick={() => order && 'targetSlot' in order && update({ ...order, targetSlot: p.slot! })}>
                        <img src={portrait(p.speciesId, images)} alt="" /><span><strong>{p.name}</strong><small>{Math.ceil(p.hp / p.maxHp * 100)}% HP</small></span>
                    </button>)}</div>
                </div>}
                {move?.target === 'self' && <small className="pta-target-label">Targets {pet.name}</small>}
                {move?.target === 'team' && <small className="pta-target-label">Targets your active pair</small>}
                {range && range.max > 0 && <small className="pta-range"><b>{range.min}–{range.max}</b> estimated damage<small>Before Guard, protection or a switch</small></small>}
            </aside>
        </div>
        <footer className="pta-review">
            <div className="pta-order-progress"><b>{orders.length}<span>/{field.length}</span></b><span>{locked ? 'Orders locked' : 'Orders chosen'}<small>{batchError ?? (locked ? 'Waiting for your opponent' : 'Review both pets before committing')}</small></span></div>
            <button className="pta-primary" type="button" disabled={busy || locked || !!batchError || orders.length !== field.length || seconds === 0} onClick={() => onLock(orders)}>{locked ? 'Orders locked ✓' : busy ? 'Locking orders…' : 'Lock both orders'}<span aria-hidden="true">→</span></button>
        </footer>
        {batchError && <p className="pta-batch-error" role="alert">{batchError}</p>}
        <div className="pta-reference"><button type="button" onClick={() => intel.current?.showModal()}>Battle intel <span>Team sheets · last round</span></button></div>
        <dialog ref={intel} className="pta-intel" aria-label="Battle intel">
            <header><div><span className="pta-kicker">Round {view.round + 1} · {seconds}s remaining</span><h2>Battle intel</h2></div><button type="button" onClick={() => intel.current?.close()}>Close ×</button></header>
            <TeamSheet pets={view.enemy} label={view.opponent ?? 'Challenger'} images={images} /><TeamSheet pets={view.own} label="Your squad" images={images} />
            <small>Miss a round: Guard / Rest. Three consecutive misses concede.</small>
            {view.transcript.at(-1)?.notes.length ? <div className="pta-notes">{view.transcript.at(-1)!.notes.map((note, i) => <p key={i}>{note}</p>)}</div> : null}
        </dialog>
    </div>;
}
