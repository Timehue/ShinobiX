import { useEffect, useId, useRef, useState } from 'react';
import { GameArtIcon } from './GameArtIcon';
import { worldRunRequest } from '../lib/continuous-world-client';
import { WORLD_RUN_MS, type WorldRunWindow } from '../../../shared/world-run';

export type WorldRunTimers = { endsAt: number; readyAt: number };

export function WorldRunButton({ timers, onWindow }: {
    timers: WorldRunTimers;
    onWindow: (run: WorldRunWindow) => void;
}) {
    const description = useId();
    const [now, setNow] = useState(() => performance.now());
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {
        if (timers.readyAt <= performance.now()) return;
        const tick = () => {
            const at = performance.now();
            setNow(at);
            if (at >= timers.readyAt) window.clearInterval(interval);
        };
        const interval = window.setInterval(tick, 250);
        document.addEventListener('visibilitychange', tick);
        return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
    }, [timers.readyAt]);

    const running = timers.endsAt > now;
    const refilling = !running && timers.readyAt > now;
    const seconds = Math.max(0, Math.ceil(((running ? timers.endsAt : timers.readyAt) - now) / 1000));
    const hint = pending ? 'Updating run' : running ? `Running for ${seconds}s. Click to walk.`
        : refilling ? `Run refills in ${seconds}s` : failed ? 'Run unavailable. Click to retry.' : `Run for ${WORLD_RUN_MS / 1000} seconds`;

    async function change() {
        if (request.current) return;
        const at = performance.now();
        if (at >= timers.endsAt && at < timers.readyAt) return;
        const controller = new AbortController();
        request.current = controller;
        setPending(true);
        setFailed(false);
        try {
            const reply = await worldRunRequest(at < timers.endsAt ? 'stop-run' : 'start-run',
                AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]));
            if (reply.run) {
                onWindow(reply.run);
                setNow(performance.now());
            }
            if (!reply.ok && (!reply.run || reply.run.readyAt <= reply.run.serverTime)) setFailed(true);
        } catch {
            if (!controller.signal.aborted) setFailed(true);
        } finally {
            if (!controller.signal.aborted) {
                request.current = null;
                setPending(false);
            }
        }
    }

    return <button type="button" className="world-run-toggle" aria-label="Run" aria-pressed={running}
        aria-describedby={description} title={hint} disabled={pending || refilling}
        data-run-state={running ? 'running' : refilling ? 'refilling' : 'ready'} onClick={() => void change()}>
        <GameArtIcon kind="speed" size={28} />
        <span className="world-run-count" aria-hidden="true">{seconds > 0 ? seconds : ''}</span>
        <span id={description} hidden>{hint}</span>
    </button>;
}
