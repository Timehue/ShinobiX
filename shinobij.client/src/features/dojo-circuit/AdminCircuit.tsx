import { useEffect, useState } from 'react';
import type { Character } from '../../types/character';
import { CIRCUIT_DISCIPLINES, circuitPhase, type CircuitDiscipline, type CircuitPhase } from '../../../../shared/dojo-circuit';
import { setSharedDojoCircuitEnabled } from '../../lib/world-state';
import { CircuitExperience } from './CircuitExperience';
import { useCircuit } from './useCircuit';
import { DISCIPLINES, eventDate, PHASE_LABELS } from './presentation';
import hero from '../../assets/dojo-circuit/dojo-hero-mobile.webp';
import './admin-circuit.css';

const localDateInput = (timestamp: number) => { const date = new Date(timestamp); return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
export function AdminCircuit({ credential, character }: { credential: string; character: Character }) {
    const { data, busy, error, act, refresh } = useCircuit(credential);
    const [name, setName] = useState('The Lantern Gathering');
    const [openedAt] = useState(Date.now);
    const [startsAt, setStartsAt] = useState(() => localDateInput(Date.now() + 600_000));
    const [days, setDays] = useState(7);
    const [featured, setFeatured] = useState<CircuitDiscipline>('combat');
    const [preview, setPreview] = useState(false);
    const [previewPhase, setPreviewPhase] = useState<CircuitPhase>('live');
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [champion, setChampion] = useState('');
    useEffect(() => { if (data) setSharedDojoCircuitEnabled(data.enabled); }, [data]);
    const event = data?.event;
    const phase = circuitPhase(!!data?.enabled, event ?? null, data?.serverNow ?? openedAt);
    const closed = !!event && (event.endedAt !== undefined || event.endsAt <= (data?.serverNow ?? openedAt));
    const submit = async (action: Record<string, unknown>) => { const next = await act(action); if (next) { setSharedDojoCircuitEnabled(next.enabled); setConfirmEnd(false); } };
    const previewNow = data?.serverNow ?? openedAt;
    const previewEvent = { ...(event ?? { id: 'preview', name, createdAt: previewNow, featured, entrants: [] }),
        startsAt: previewNow + (previewPhase === 'upcoming' ? 86400_000 : -86400_000),
        endsAt: previewNow + (previewPhase === 'results' ? -1000 : 6 * 86400_000), endedAt: undefined };
    return <section className="dc-admin" aria-label="Dojo Circuit administration">
        <header className="dc-admin-hero"><img src={hero} alt="Dojo Circuit art preview" /><div><span>WORLD EVENT OPERATIONS</span><h3>Dojo Circuit</h3><p>{data ? PHASE_LABELS[phase] : 'Loading event controls…'}</p></div></header>
        {error && <p role="alert" className="dc-admin-error">{error} <button onClick={() => { void refresh(); }}>Retry</button></p>}
        {data?.message && <p role="status">{data.message}</p>}
        <div className="dc-admin-grid"><section><h4>Global access</h4><p>Controls all four village notices, the Arena entry, and server participation. Turning off clears unfinished trials; earned seals and history remain. Scheduled closing times continue while off.</p><button disabled={!data || busy} onClick={() => { void submit({ action: 'toggle', enabled: !data?.enabled }); }}>{busy ? 'Updating…' : data?.enabled ? 'Turn Dojo Circuit Off' : 'Turn Dojo Circuit On'}</button><button onClick={() => setPreview(!preview)}>{preview ? 'Close player preview' : 'Preview player experience'}</button></section>
            <section><h4>{event ? 'Current Circuit' : 'No Circuit scheduled'}</h4>{event ? <><strong>{event.name}</strong><p>Opens {eventDate(event.startsAt)}<br />Closes {eventDate(event.endedAt ?? event.endsAt)}</p><p>{event.entrants.length} participants · {event.entrants.filter(e => e.seals.length === 3).length} finishers</p>{!closed && (confirmEnd ? <div className="dc-admin-confirm"><p>Close this Circuit now? No further trials or check-ins will be accepted. Recorded seals will be kept for the ceremony.</p><button disabled={busy} onClick={() => { void submit({ action: 'end', eventId: event.id }); }}>Close Circuit now</button><button onClick={() => setConfirmEnd(false)}>Keep it open</button></div> : <button className="danger-button" disabled={busy} onClick={() => setConfirmEnd(true)}>End current Circuit</button>)}</> : <p>Set the first invitation below. Scheduling works while access is off, so you can prepare before opening the doors.</p>}</section>
        </div>
        <div className="dc-admin-grid"><form onSubmit={e => { e.preventDefault(); void submit({ action: 'schedule', name, startsAt: new Date(startsAt).getTime(), days, featured }); }}><h4>Schedule the next gathering</h4><label>Event name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} /></label><label>Opens at · your local time<input required type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label><div className="dc-admin-fields"><label>Duration (days)<input type="number" required min={1} max={14} value={days} onChange={e => setDays(Number(e.target.value))} /></label><label>Opening spotlight<select value={featured} onChange={e => setFeatured(e.target.value as CircuitDiscipline)}>{CIRCUIT_DISCIPLINES.map(d => <option key={d} value={d}>{DISCIPLINES[d].title}</option>)}</select></label></div><p>The spotlight rotates daily through combat, cards, and pets, starting with your selection. All three remain available. A new gathering archives the completed Circuit.</p><button type="submit" disabled={!data || busy || (!!event && !closed)}>Schedule Circuit</button></form>
            <section><h4>Closing honours</h4><p>All three-seal finishers receive an archive distinction. After closing, you can name one of them champion. The choice is final once recorded.</p>{event?.championId ? <strong>Champion · {event.entrants.find(e => e.id === event.championId)?.name}</strong> : <><label>Eligible finisher<select value={champion} onChange={e => setChampion(e.target.value)}><option value="">Select a finisher</option>{event?.entrants.filter(e => e.seals.length === 3).map(e => <option key={e.id} value={e.id}>{e.name} · {e.village}</option>)}</select></label><button disabled={busy || !closed || !champion} onClick={() => { void submit({ action: 'champion', eventId: event?.id, championId: champion }); }}>Record champion</button></>}</section>
        </div>
        {preview && <div className="dc-admin-preview"><label>Preview state<select value={previewPhase} onChange={e => setPreviewPhase(e.target.value as CircuitPhase)}>{(['live', 'upcoming', 'results', 'offline'] as const).map(p => <option value={p} key={p}>{PHASE_LABELS[p]}</option>)}</select></label><CircuitExperience character={character} data={{ enabled: previewPhase !== 'offline', event: previewEvent, history: data?.history ?? [], attempt: null, serverNow: previewNow }} preview onBack={() => setPreview(false)} onAction={() => {}} onLaunch={() => {}} onRefresh={() => {}} onHistory={() => {}} /></div>}
    </section>;
}
