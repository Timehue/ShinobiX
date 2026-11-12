import { useEffect, useRef, useState } from 'react';
import { GameArtIcon } from './GameArtIcon';
import { worldRunRequest } from '../lib/continuous-world-client';
import { WORLD_RUN_MS, type WorldRunWindow } from '../../../shared/world-run';

export type WorldRunTimers = { endsAt: number; readyAt: number };

export function WorldRunButton({ timers, onWindow }: {
    timers: WorldRunTimers;
    onWindow: (run: WorldRunWindow) => void;
}) {
    const [now, setNow] = useState(() => performance.now());
    const [status, setStatus] = useState<'pending' | 'failed' | null>(null);
    const request = useRef<AbortController | null>(null);
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => {
        if (timers.readyAt <= performance.now()) return;
        const interval = window.setInterval(() => {
            const at = performance.now();
            setNow(at);
            if (at >= timers.readyAt) window.clearInterval(interval);
        }, 250);
        return () => window.clearInterval(interval);
    }, [timers.readyAt]);

    const running = timers.endsAt > now;
    const refilling = !running && timers.readyAt > now;
    const seconds = Math.max(0, Math.ceil(((running ? timers.endsAt : timers.readyAt) - now) / 1000));
    const hint = running ? `${seconds}s left. Click to walk.` : refilling ? `Refills in ${seconds}s`
        : status === 'failed' ? 'Run unavailable. Try again.' : `Run for ${WORLD_RUN_MS / 1000} seconds`;

    async function change() {
        if (request.current) return;
        const at = performance.now();
        if (at >= timers.endsAt && at < timers.readyAt) return;
        const controller = new AbortController();
        request.current = controller;
        setStatus('pending');
        try {
            const reply = await worldRunRequest(at < timers.endsAt ? 'stop-run' : 'start-run',
                AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]));
            if (controller.signal.aborted) return;
            if (reply.run) onWindow(reply.run);
            setNow(performance.now());
            setStatus(reply.ok || (reply.run && reply.run.readyAt > reply.run.serverTime) ? null : 'failed');
        } catch {
            if (!controller.signal.aborted) setStatus('failed');
        } finally {
            request.current = null;
        }
    }

    return <button type="button" className="world-run-toggle" aria-label="Run" aria-pressed={running}
        aria-description={hint} title={hint} disabled={status === 'pending' || refilling}
        data-run-state={running ? 'running' : refilling ? 'refilling' : 'ready'} onClick={() => void change()}>
        <GameArtIcon kind="speed" size={28} />
        {seconds > 0 && <span className="world-run-count" aria-hidden="true">{seconds}</span>}
    </button>;
}
