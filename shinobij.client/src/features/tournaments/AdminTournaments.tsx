import { useState } from 'react';
import { TOURNAMENT_LABELS, TOURNAMENT_MODES, tournamentRules, type TournamentMode } from '../../../../shared/tournaments';
import { useTournament, tournamentCountdown } from './useTournament';
import './tournaments.css';
export function AdminTournaments({ credential }: { credential: string }) {
    const { data, error, busy, now, act, refresh } = useTournament(credential);
    const [name, setName] = useState('Arena Championship');
    const [mode, setMode] = useState<TournamentMode>('standard');
    const [signupMinutes, setSignupMinutes] = useState(30);
    const [maxEntries, setMaxEntries] = useState(16);
    const [readySeconds, setReadySeconds] = useState(120);
    const [petFormat, setPetFormat] = useState<'1v1' | '2v2'>('1v1');
    const [notes, setNotes] = useState('');
    const [confirmCancel, setConfirmCancel] = useState(false);
    const event = data?.event;
    const active = event?.status === 'signup' || event?.status === 'live';
    return <section className="tournament-panel summary-box" aria-label="Tournament administration">
        <header><span className="tournament-eyebrow">ARENA OPERATIONS</span><h3>Tournaments</h3><p>Open signups now. When the countdown ends, confirmed entrants are randomly seeded into a single-elimination bracket with a one-hour play window.</p></header>
        {error && <p role="alert">{error} <button onClick={() => void refresh()}>Retry</button></p>}
        {event && <div className="tournament-current"><strong>{event.name}</strong><p>{TOURNAMENT_LABELS[event.mode]} · {event.status} · {event.entries.length} entries</p>
            {active && <p>{event.status === 'signup' ? 'Signup closes in' : 'Tournament closes in'} <strong>{tournamentCountdown((event.status === 'signup' ? event.signupEndsAt : event.endsAt) - now)}</strong></p>}
            {event.message && <p>{event.message}</p>}
            {active && (confirmCancel ? <div><p>Cancel this tournament and close its active matches?</p><button disabled={busy} onClick={() => { void act({ action: 'cancel', eventId: event.id }); setConfirmCancel(false); }}>Cancel tournament now</button><button onClick={() => setConfirmCancel(false)}>Keep tournament</button></div> : <button className="danger-button" onClick={() => setConfirmCancel(true)}>Cancel tournament</button>)}
        </div>}
        <form onSubmit={e => { e.preventDefault(); void act({ action: 'create', name, mode, signupMinutes, maxEntries, readySeconds, petFormat, notes }); }}>
            <div className="tournament-fields">
                <label>Tournament name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label>
                <label>Type and rules<select value={mode} onChange={e => setMode(e.target.value as TournamentMode)}>{TOURNAMENT_MODES.map(m => <option key={m} value={m}>{TOURNAMENT_LABELS[m]}</option>)}</select></label>
                <label>Signup timer (minutes)<input type="number" required min={1} max={10080} value={signupMinutes} onChange={e => setSignupMinutes(Number(e.target.value))} /></label>
                <label>Maximum {mode === '2v2' ? 'pairs' : 'players'}<select value={maxEntries} onChange={e => setMaxEntries(Number(e.target.value))}>{[4, 8, 16, 32, 64].map(n => <option key={n}>{n}</option>)}</select></label>
                <label>Round ready timer (seconds)<input type="number" required min={30} max={300} value={readySeconds} onChange={e => setReadySeconds(Number(e.target.value))} /></label>
                {mode === 'pet' && <label>Pet formation<select value={petFormat} onChange={e => setPetFormat(e.target.value as '1v1' | '2v2')}><option value="1v1">One pet per owner</option><option value="2v2">Two pets per owner</option></select></label>}
            </div>
            <p className="hint">{tournamentRules({ mode, petFormat, readySeconds })}</p>
            <label>Event notes (shown to players)<textarea maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional announcement or house rules for players" /></label>
            <p className="hint">Event notes are informational. Combat uses the selected rules above. At least two confirmed {mode === '2v2' ? 'pairs' : 'players'} are required.</p>
            <button type="submit" disabled={!data || busy || active}>{busy ? 'Updating…' : 'Start signup timer'}</button>
        </form>
    </section>;
}
