import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { Veinbreaking, RelaxedMining } from './Veinbreaking';
import { scoreFishing, FISHING_REEL_MS, type FishingEvent } from '../../../shared/fishing-game';
import { serverNow } from '../lib/server-clock';
import { FishingScene } from './FishingScene';
import './resource-minigames.css';

const KunaiFishing = lazy(() => import('./KunaiFishing'));
export function ResourceMinigame({ attempt, busy, resolve, fishingGold = false }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void; fishingGold?: boolean }) {
    if (attempt.activity === 'fishing' && attempt.fishingStyle === 'kunai') return <Suspense fallback={<p role="status">Preparing your fishing kunai…</p>}><KunaiFishing attempt={attempt} busy={busy} resolve={resolve} golden={fishingGold} /></Suspense>;
    if (attempt.activity === 'mining') return attempt.mode === 'relaxed' ? <RelaxedMining attempt={attempt} busy={busy} resolve={resolve} /> : <Veinbreaking attempt={attempt} busy={busy} resolve={resolve} />;
    if (attempt.mode === 'relaxed') return <RelaxedGathering attempt={attempt} busy={busy} resolve={resolve} />;
    return <CastAndReel attempt={attempt} busy={busy} resolve={resolve} />;
}
function RelaxedGathering({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const [elapsed, setElapsed] = useState(() => Math.max(0, serverNow() - attempt.startedAt));
    const ready = elapsed >= 3000;
    useEffect(() => {
        if (ready) return;
        const timer = window.setInterval(() => setElapsed(Math.max(0, serverNow() - attempt.startedAt)), 50);
        return () => clearInterval(timer);
    }, [attempt.startedAt, ready]);
    return <div className={`resource-relaxed resource-relaxed--${attempt.activity}`}>
        <div className="resource-relaxed-art" aria-hidden="true"><FishingScene elapsed={elapsed} hookAt={1800} relaxed /></div>
        <p>Your line settles into the current. A shadow approaches the float.</p>
        <p>Animation mode uses your skill’s baseline success rate.</p>
        <button type="button" disabled={busy || !ready} onClick={() => resolve({})}>{busy ? 'Recovering result…' : ready ? 'Collect result' : 'Gathering…'}</button>
    </div>;
}
function CastAndReel({ attempt, busy, resolve }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void }) {
    const key = `outpost-fishing:${attempt.id}`;
    const [events, setEvents] = useState<FishingEvent[]>(() => {
        try {
            const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
            if (!Array.isArray(saved) || saved.length > 48 || saved.some(event => !event || !['hook', 'reel', 'release'].includes(event.kind) || !Number.isFinite(event.at))) return [];
            // A reload releases the physical control, while retaining the admitted timeline.
            const restored = saved as FishingEvent[];
            if (restored.at(-1)?.kind === 'reel' && restored.length < 48) restored.push({ kind: 'release', at: Math.max(restored.at(-1)!.at, serverNow() - attempt.startedAt) });
            sessionStorage.setItem(key, JSON.stringify(restored));
            return restored;
        } catch { return []; }
    });
    const [elapsed, setElapsed] = useState(() => Math.max(0, serverNow() - attempt.startedAt));
    const held = useRef(false);
    useEffect(() => {
        function releaseControl() {
            held.current = false;
            setEvents(current => {
                if (current.at(-1)?.kind !== 'reel' || current.length >= 48) return current;
                const next: FishingEvent[] = [...current, { kind: 'release', at: Math.max(current.at(-1)!.at, serverNow() - attempt.startedAt) }];
                try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ }
                return next;
            });
        }
        function visibilityChanged() { if (document.hidden) releaseControl(); }
        window.addEventListener('blur', releaseControl);
        document.addEventListener('visibilitychange', visibilityChanged);
        return () => {
            window.removeEventListener('blur', releaseControl);
            document.removeEventListener('visibilitychange', visibilityChanged);
        };
    }, [attempt.startedAt, key]);
    function record(kind: FishingEvent['kind']) {
        const at = Math.max(0, serverNow() - attempt.startedAt);
        setEvents(current => { if (current.length >= 48) return current; const next = [...current, { kind, at }]; try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* memory only */ } return next; });
    }
    function reel(value: boolean) { if (held.current === value || !events.length || done || (value && events.length >= 47)) return; held.current = value; record(value ? 'reel' : 'release'); }
    const hooked = events.length > 0, hookMissed = !hooked && elapsed > attempt.hookAt + 1200;
    const done = hookMissed || (hooked && elapsed >= events[0].at + FISHING_REEL_MS);
    const live = hooked ? scoreFishing(attempt.hookAt, events, elapsed, true) : null;
    const tension = Math.round(live?.tension ?? 35);
    const broken = live?.tension === 100;
    const reeling = !done && !broken && events.at(-1)?.kind === 'reel';
    const phase = done || broken ? '03' : hooked ? '02' : '01';
    useEffect(() => {
        if (done) return;
        const timer = window.setInterval(() => setElapsed(Math.max(0, serverNow() - attempt.startedAt)), 50);
        return () => clearInterval(timer);
    }, [attempt.startedAt, done]);
    const status = broken ? 'The line snapped. Release sooner next time.'
        : done ? hookMissed ? 'The fish slipped away.' : live?.failed ? 'The fish got away. Reel within the marked zone.' : 'The catch is ready.'
        : !hooked ? elapsed < attempt.hookAt ? 'Line cast. Watch the float…' : 'The float dipped — hook now!'
        : tension > 80 ? 'Release now — the line is close to snapping!' : tension < 20 ? 'Hold to reel — take up the slack.'
        : reeling ? 'Keep pulling. Release before the line strains.' : 'Hold to pull. Release to ease tension.';
    return <div className="fishing-game">
        <div className="gather-game-heading"><div><p className="resource-kicker">Fishing · Cast · Hook · Reel</p><h3>{broken ? 'The line snapped' : done ? hookMissed || live?.failed ? 'Lost to the current' : 'Within reach' : hooked ? 'Follow the pull' : 'Read the water'}</h3></div><span className="gather-game-method">{phase} / 03</span></div>
        <FishingScene elapsed={elapsed} hookAt={attempt.hookAt} hooked={hooked} reeling={reeling} tension={tension}
            progress={live?.progress ?? 0} outcome={broken ? 'escaped' : done ? hookMissed || live?.failed ? 'escaped' : 'landed' : undefined} />
        <p className="fishing-status" role="status">{status}</p>
        {!hooked && !hookMissed && <button type="button" autoFocus className="resource-primary" onClick={() => { if (elapsed >= attempt.hookAt && !busy) record('hook'); }} aria-disabled={elapsed < attempt.hookAt || busy}>Hook fish</button>}
        {hooked && <><div className="fishing-instruments"><label className="resource-meter"><span>Line tension <strong>{tension > 80 ? 'Ease off' : tension < 20 ? 'Pull now' : 'Steady'}</strong></span><span className={`fishing-tension${tension > 80 ? ' is-danger' : tension < 20 ? ' is-slack' : ''}`} role="meter" aria-label="Line tension" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tension} aria-valuetext={`${tension}% · ${tension > 80 ? 'High tension' : tension < 20 ? 'Slack line' : 'Safe tension'}`}><span className="fishing-tension-fill" style={{ width: `${tension}%` }}/></span><small>Slack <span>Keep within the marked zone</span> Strain</small></label>
            <label className="resource-meter"><span>Catch progress <strong>{Math.round(live?.progress ?? 0)}%</strong></span><progress aria-label="Catch progress" max={100} value={live?.progress ?? 0}/><small>Bring the catch to shore</small></label></div>
            <button type="button" autoFocus aria-pressed={reeling} className={`resource-primary fishing-reel${reeling ? ' is-held' : ''}`} disabled={done || broken || busy}
                onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); reel(true); }} onPointerUp={event => { if (event.isPrimary) reel(false); }} onPointerCancel={event => { if (event.isPrimary) reel(false); }} onLostPointerCapture={() => reel(false)} onBlur={() => reel(false)}
                onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); reel(true); } }}
                onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); reel(false); } }}>Hold to reel</button></>}
        {done && <button type="button" autoFocus className="resource-primary fishing-collect" disabled={busy} onClick={() => resolve({ events: hookMissed ? [{ kind: 'hook', at: elapsed }, { kind: 'reel', at: elapsed }] : events.length === 1 ? [...events, { kind: 'reel', at: elapsed }] : events })}>{busy ? 'Recovering catch…' : 'Collect result'}</button>}
    </div>;
}
