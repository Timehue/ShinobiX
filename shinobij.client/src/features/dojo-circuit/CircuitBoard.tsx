import { useState } from 'react';
import { CIRCUIT_DISCIPLINES, CIRCUIT_VILLAGES, type CircuitEvent, type CircuitHistory } from '../../../../shared/dojo-circuit';
import { CircuitMark } from './CircuitMark';
import { DISCIPLINES, eventDate, villageTone } from './presentation';
import ceremonyArt from '../../assets/dojo-circuit/ceremony.webp';
import ceremonyMobile from '../../assets/dojo-circuit/ceremony-mobile.webp';

export function CircuitBoard({ event, playerName }: { event: CircuitEvent; playerName: string }) {
    const [filter, setFilter] = useState('');
    const entrants = event.entrants.filter(e => `${e.name} ${e.village}`.toLowerCase().includes(filter.toLowerCase()));
    const recent = event.entrants.flatMap(e => e.seals.map(seal => ({ ...seal, name: e.name, village: e.village }))).sort((a, b) => b.earnedAt - a.earnedAt).slice(0, 8);
    return <div className="dc-board-layout">
        <section className="dc-panel">
            <div className="dc-section-heading"><div><span className="dc-eyebrow">One world, familiar faces</span><h2>The gathering</h2></div><span className="dc-count">{event.entrants.length} entered</span></div>
            <div className="dc-village-roll">{CIRCUIT_VILLAGES.map(v => <div key={v} data-village-tone={villageTone(v)}><span className="dc-village-dot" /><span>{v.replace(' Village', '')}</span><strong>{event.entrants.filter(e => e.village === v).length}</strong></div>)}</div>
            <label className="dc-search">Find a participant<input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Player or village" /></label>
            <div className="dc-roster" role="list">{entrants.length ? entrants.map(e => <div className="dc-roster-row" role="listitem" key={e.id} data-self={e.name.toLowerCase() === playerName.toLowerCase()}>
                <span className="dc-avatar" data-village-tone={villageTone(e.village)}>{e.name.slice(0, 2).toUpperCase()}</span>
                <div className="dc-roster-name"><strong>{e.name}</strong><small>{e.village}{e.seals.length === 3 ? ' · Circuit finisher' : ''}</small></div>
                <div className="dc-mini-seals">{CIRCUIT_DISCIPLINES.map(d => <span key={d} className={e.seals.some(s => s.discipline === d) ? 'earned' : ''} title={`${DISCIPLINES[d].seal}: ${e.seals.some(s => s.discipline === d) ? 'earned' : 'not earned'}`}><CircuitMark discipline={d} /></span>)}</div>
            </div>) : <div className="dc-empty"><CircuitMark /><h3>{filter ? 'No matching participants' : 'The first page is still unwritten'}</h3><p>{filter ? 'Try another player name or village.' : 'Join the Circuit and be the first name on the world board.'}</p></div>}</div>
        </section>
        <aside className="dc-panel dc-news"><span className="dc-eyebrow">From across the villages</span><h2>Latest seals</h2>
            {recent.length ? <ol>{recent.map((r, i) => <li key={`${r.name}-${r.discipline}-${i}`}><CircuitMark discipline={r.discipline} /><div><strong>{r.name}</strong><p>Earned the {DISCIPLINES[r.discipline].seal.toLowerCase()}.</p><time dateTime={new Date(r.earnedAt).toISOString()}>{eventDate(r.earnedAt)}</time></div></li>)}</ol> : <div className="dc-quiet"><p>Lanterns are lit. The scribes are waiting.</p><small>Verified seals will appear here as players complete their trials.</small></div>}
        </aside>
    </div>;
}

export function CircuitHonours({ event, history, onHistory }: { event: CircuitEvent | null; history: CircuitHistory[]; onHistory: (id: string) => void }) {
    const champion = event?.entrants.find(e => e.id === event.championId);
    const finishers = event?.entrants.filter(e => e.seals.length === 3) ?? [];
    return <div className="dc-honours">
        <section className="dc-ceremony">
            <picture><source media="(max-width: 700px)" srcSet={ceremonyMobile} /><img src={ceremonyArt} alt="Lantern-lit dojo with four village banners and a ceremonial medal" loading="lazy" /></picture>
            <div><span className="dc-eyebrow">A place in the record</span><h2>{champion ? champion.name : 'Every seal tells a story.'}</h2><p>{champion ? `${champion.village} · Circuit champion` : 'Three disciplines. A lasting mark in the Circuit archive.'}</p></div>
        </section>
        <div className="dc-board-layout">
            <section className="dc-panel"><span className="dc-eyebrow">The three-seal honour</span><h2>Circuit finishers</h2><p className="dc-muted">Earn all three seals to receive the permanent finisher distinction in this event’s record. The event host may name one finisher as champion after closing.</p>
                {finishers.length ? <div className="dc-finishers">{finishers.map(e => <div key={e.id}><CircuitMark /><strong>{e.name}</strong><small>{e.village}</small><span className="dc-tag">{e.id === event?.championId ? 'Champion' : 'Three seals earned'}</span></div>)}</div> : <div className="dc-quiet"><CircuitMark /><p>The honours await their first names.</p><small>Each completed discipline brings you one seal closer.</small></div>}
            </section>
            <aside className="dc-panel"><span className="dc-eyebrow">Remembered together</span><h2>Past Circuits</h2>{history.length ? <div className="dc-history">{history.map(h => <button key={h.id} onClick={() => onHistory(h.id)}><strong>{h.name}</strong><small>{eventDate(h.startsAt)} · {h.participants} participants</small><span>{h.champion ? `Champion · ${h.champion}` : `${h.finishers} finishers`} <span aria-hidden="true">↗</span></span></button>)}</div> : <p className="dc-muted">The first Circuit will become the first chapter of this archive.</p>}</aside>
        </div>
    </div>;
}
