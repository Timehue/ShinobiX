import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import type { Pet } from '../../types/pet';
import type { ShowdownReplayScript } from '../../../../shared/pet-showdown-contract';
import { TOURNAMENT_LABELS, tournamentRules, tournamentEntryReady } from '../../../../shared/tournaments';
import { activeCarriedPets } from '../../lib/entitlements';
import { fetchTowerPvpSession, submitTowerPvpActionWithLostResponseRetry, type TowerPvpMatch } from '../../lib/tower-pvp-api';
import { setTowerPvpMatchId, setScreenFightActive } from '../../lib/screen-guards';
import { tournamentRequest } from './client';
import { useTournament, tournamentCountdown } from './useTournament';
import './tournaments.css';
const BattleTowerFight = lazy(() => import('../../screens/BattleTowerFight').then(m => ({ default: m.BattleTowerFight })));
const PetShowdownReplay = lazy(() => import('../../components/PetShowdownReplay').then(m => ({ default: m.PetShowdownReplay })));
export function TournamentPanel({ character, sharedImages, onVersionedCharacter, onFightStateChange }: {
    character: Character; sharedImages?: Record<string, string>; onVersionedCharacter: VersionedCharacterCommit; onFightStateChange?: (active: boolean) => void;
}) {
    const { data, error, busy, now, act, refresh } = useTournament();
    const [partner, setPartner] = useState(''), [petIds, setPetIds] = useState<string[]>([]);
    const [battle, setBattle] = useState<{ match: TowerPvpMatch; eventId: string; bracketId: string } | null>(null);
    const [script, setScript] = useState<ShowdownReplayScript | null>(null);
    const [opening, setOpening] = useState(false), [battleError, setBattleError] = useState('');
    const event = data?.event;
    const me = data?.playerId ?? '';
    const entry = event?.entries.find(e => e.members.some(m => m.id === me));
    const mine = entry?.members.find(m => m.id === me);
    const myMatch = event?.matches.find(m => m.status !== 'done' && (m.a === entry?.id || m.b === entry?.id));
    const pets = activeCarriedPets<Pet>(character);
    const fighting = battle !== null;
    useEffect(() => {
        setScreenFightActive('arenaDistrict', fighting);
        onFightStateChange?.(fighting);
        return () => { setScreenFightActive('arenaDistrict', false); onFightStateChange?.(false); };
    }, [fighting, onFightStateChange]);
    useEffect(() => {
        if (!battle) return;
        setTowerPvpMatchId(battle.match.matchId);
        try { sessionStorage.setItem('tournament-resume', battle.eventId); } catch { /* recovery also uses the server lease */ }
    }, [battle]);
    useEffect(() => {
        if (!data || battle || myMatch?.status === 'active') return;
        try {
            if (sessionStorage.getItem('tournament-resume')) {
                sessionStorage.removeItem('tournament-resume');
                setTowerPvpMatchId(null);
            }
        } catch { /* server state remains authoritative */ }
    }, [data, battle, myMatch?.status]);
    const settle = useCallback(async () => {
        if (!battle) throw new Error('No tournament match selected.');
        return tournamentRequest({ action: 'settle', eventId: battle.eventId, matchId: battle.bracketId });
    }, [battle]);
    const openBattle = async (matchId: string) => {
        if (!event || opening) return;
        setOpening(true); setBattleError('');
        try {
            const result = await tournamentRequest<{ match: TowerPvpMatch | null; script: ShowdownReplayScript | null }>({ action: 'battle', eventId: event.id, matchId });
            if (result.script) setScript(result.script);
            else if (result.match) setBattle({ match: result.match, eventId: event.id, bracketId: matchId });
            else setBattleError('Waiting for both sides to ready. The board will update automatically.');
        } catch (e) { setBattleError(e instanceof Error ? e.message : 'Unable to open match.'); }
        finally { setOpening(false); }
    };
    const exit = () => {
        setBattle(null); setScript(null); setTowerPvpMatchId(null);
        try { sessionStorage.removeItem('tournament-resume'); } catch { /* optional breadcrumb */ }
        void refresh();
    };
    if (script) return <Suspense fallback={<p>Loading Colosseum replay…</p>}><PetShowdownReplay script={script} playerPets={pets} sharedImages={sharedImages} onExit={exit} /></Suspense>;
    if (battle) return <Suspense fallback={<p>Loading tournament battle…</p>}><BattleTowerFight character={character} sharedImages={sharedImages}
        runId={battle.match.matchId} initialSession={battle.match.combat} stateFn={fetchTowerPvpSession}
        actionRetryFn={submitTowerPvpActionWithLostResponseRetry} settleFn={settle} settleOnAnyDone variant="team-pvp" pvpContextLabel="Tournament"
        onVersionedCharacter={onVersionedCharacter} onExit={exit} /></Suspense>;
    const label = (id: string | null) => event?.entries.find(e => e.id === id)?.members.map(m => m.name).join(' + ') ?? 'Bye';
    return <section className="tournament-panel summary-box" aria-label="Tournaments">
        <header><span className="tournament-eyebrow">THE ARENA CHAMPIONSHIP</span><h3>{event?.name ?? 'Tournaments'}</h3><p>Sign up. Face a random opponent. Fight your way through the bracket.</p></header>
        {(error || battleError) && <p role="alert">{error || battleError} <button onClick={() => { setBattleError(''); void refresh(); }}>Refresh</button></p>}
        {!data && !error && <p>Loading tournament board…</p>}
        {data && !event && <p>No tournament is open yet. An administrator can start one from Admin → World Events → Tournaments.</p>}
        {event && <>
            <div className="tournament-countdown"><div><strong>{TOURNAMENT_LABELS[event.mode]}</strong><p>{event.status === 'signup' ? 'Signup closes in' : event.status === 'live' ? 'Tournament window remaining' : event.status === 'complete' ? 'Tournament complete' : 'Tournament cancelled'}</p></div>
                {(event.status === 'signup' || event.status === 'live') && <strong className="tournament-clock" role="timer" aria-label="Time remaining">{tournamentCountdown((event.status === 'signup' ? event.signupEndsAt : event.endsAt) - now)}</strong>}
            </div>
            <details><summary>Tournament rules</summary><p>{tournamentRules(event)}</p>{(event.mode === 'ranked' || event.mode === '2v2') && <p>Level 11 or higher required.</p>}{event.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{event.notes}</p>}</details>
            {event.status === 'signup' && <div className="tournament-entry">
                <p><strong>{event.entries.filter(e => tournamentEntryReady(e, event.mode)).length} confirmed {event.mode === '2v2' ? 'pairs' : 'players'}</strong> · {event.entries.length}/{event.maxEntries} slots reserved</p>
                {!entry && event.mode === '2v2' && <label>Partner’s player name<input maxLength={40} value={partner} onChange={e => setPartner(e.target.value)} placeholder="Your partner must accept before signup closes" /></label>}
                {!entry && event.mode === 'pet' && <><p>Select {event.petFormat === '2v2' ? 'two carried pets' : 'one carried pet'} to lock in for this tournament.</p><div className="tournament-pets">{pets.map(p => <label key={p.id}><input type="checkbox" checked={petIds.includes(p.id)} onChange={e => setPetIds(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{p.name}</label>)}</div></>}
                {entry && <p>{entry.members.map(m => `${m.name}${m.accepted ? ' ✓' : ' (invited)'}`).join(' + ')}</p>}
                <div className="menu">
                    {!entry && <button disabled={busy || now >= event.signupEndsAt || event.entries.length >= event.maxEntries || (event.mode === '2v2' && !partner.trim()) || (event.mode === 'pet' && petIds.length !== (event.petFormat === '2v2' ? 2 : 1))} onClick={() => void act({ action: 'join', eventId: event.id, partner, petIds })}>{event.mode === '2v2' ? 'Sign up and invite partner' : 'Sign up'}</button>}
                    {mine && !mine.accepted && <button disabled={busy || now >= event.signupEndsAt} onClick={() => void act({ action: 'accept', eventId: event.id })}>Accept pair invitation</button>}
                    {entry && <button disabled={busy || now >= event.signupEndsAt} onClick={() => void act({ action: 'leave', eventId: event.id })}>{mine?.accepted ? 'Withdraw entry' : 'Decline invitation'}</button>}
                </div><p className="hint">Signup closes {new Date(event.signupEndsAt).toLocaleString()}. Stay on the board when the bracket opens. Incomplete pairs are excluded.</p>
            </div>}
            {myMatch && <div className="tournament-entry"><strong>Your round {myMatch.round}: {label(myMatch.a)} vs {label(myMatch.b)}</strong>
                <p>{myMatch.status === 'waiting' ? `Ready check: ${tournamentCountdown(myMatch.readyEndsAt - now)}` : `Round ends in ${tournamentCountdown(myMatch.endsAt - now)}`}</p>
                {myMatch.status === 'waiting' && <><p>{myMatch.ready.length}/{event.mode === '2v2' ? 4 : 2} players ready. Finish other battles before readying.</p><button disabled={busy || now >= myMatch.readyEndsAt || myMatch.ready.includes(me)} onClick={() => void act({ action: 'ready', eventId: event.id, matchId: myMatch.id })}>{myMatch.ready.includes(me) ? 'Ready — waiting for opponents' : 'Ready for this round'}</button></>}
                {myMatch.status === 'active' && <button disabled={opening} onClick={() => void openBattle(myMatch.id)}>Enter tournament match</button>}
            </div>}
            {event.champion && <p className="tournament-winner">Champion · {label(event.champion)}</p>}
            {event.message && <p role="status">{event.message}</p>}
            {event.matches.length > 0 && <div className="tournament-bracket" aria-label="Tournament bracket">{Array.from({ length: event.rounds }, (_, r) => <section className="tournament-round" key={r}><h4>{r + 1 === event.rounds ? 'Final' : `Round ${r + 1}`}</h4>
                {event.matches.filter(m => m.round === r + 1).map(m => <div className="tournament-match" data-mine={m.a === entry?.id || m.b === entry?.id} key={m.id}>
                    <p className={m.winner === m.a && m.a ? 'tournament-winner' : ''}>{label(m.a)}</p><small>vs</small><p className={m.winner === m.b && m.b ? 'tournament-winner' : ''}>{label(m.b)}</p>
                    <small>{m.reason ?? (m.status === 'active' ? 'In battle' : 'Ready check')}</small>
                    {event.mode === 'pet' && m.reason === 'Colosseum result' && (m.a === entry?.id || m.b === entry?.id) && <p><button disabled={opening} onClick={() => void openBattle(m.id)}>Watch Colosseum match</button></p>}
                </div>)}{r + 1 > event.round && <p className="hint">Awaiting advancing players</p>}
            </section>)}</div>}
            {!event.matches.length && event.entries.length > 0 && <details><summary>Entrants</summary>{event.entries.map(e => <p key={e.id}>{label(e.id)} · {tournamentEntryReady(e, event.mode) ? 'Confirmed' : 'Awaiting partner'}</p>)}</details>}
        </>}
    </section>;
}
