import { useEffect, useRef, useState } from 'react';
import { modelJobIdPattern } from '../../../shared/avatar-model-job';

type Read = { summary: string; readToken: string };

/** Every 429 from the check or the start, in words a player can act on. */
function limitMessage(result: { error?: unknown; code?: unknown }) {
    if (result.code === 'RATE_LIMITED') return 'Too many tries at once. Wait a minute, then retry.';
    if (result.error === 'limit') return 'You have used today\'s portrait checks. Try again tomorrow (UTC).';
    if (result.error === 'daily') return 'Today\'s models are all taken. Try again tomorrow (UTC). Your model for this month is still yours.';
    return 'Model making is full for this month. Your model for this month is still yours.';
}

/** Starts from the authenticated saved portrait. An accepted portrait is submitted at once and uses the monthly slot. */
export function ProfileModelCreation({ name, onCreated }: { name: string; onCreated: (id: string) => void }) {
    const [read, setRead] = useState<Read | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [startedAt, setStartedAt] = useState(0);
    const [now, setNow] = useState(0);
    const active = useRef<AbortController | null>(null);
    useEffect(() => () => active.current?.abort(), []);
    // A visible clock while the check runs, so a multi-minute wait reads as progress, not a hang.
    useEffect(() => {
        if (!busy) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [busy]);
    const elapsed = busy && now > startedAt ? Math.floor((now - startedAt) / 1000) : 0;

    async function submit() {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        // A failed submission keeps its accepted check, so the retry goes straight to the job.
        let accepted = read;
        setMessage(accepted ? 'Starting your model…' : 'Checking your portrait… This usually takes 2 to 6 minutes.');
        setStartedAt(Date.now());
        try {
            const headers = { 'Content-Type': 'application/json', 'x-player-name': name };
            // The server keeps a check alive while Modal queues it behind other players (up to two hours),
            // so a page that stops waiting here and retries resumes the same check.
            const deadline = Date.now() + 30 * 60_000;
            for (;;) {
                const res = await fetch('/api/avatar-model/' + (accepted ? 'jobs' : 'read'), {
                    method: 'POST', headers, cache: 'no-store',
                    body: JSON.stringify(accepted ? { readToken: accepted.readToken, idempotencyKey: accepted.readToken } : {}),
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
                });
                const result = await res.json();
                if (controller.signal.aborted) return;
                if (!res.ok) {
                    if (result.error === 'read-expired') setRead(null);
                    if (res.status === 409 && result.error === 'quota') throw new Error('You already have a model this month. Reopen World model to see it.');
                    if (res.status === 429) throw new Error(limitMessage(result));
                    if (result.error === 'read-expired') throw new Error('Your portrait check expired or your portrait changed. Check it again.');
                    throw new Error('Something went wrong on our side. You can retry.');
                }
                if (accepted && typeof result.jobId === 'string' && modelJobIdPattern.test(result.jobId)) {
                    onCreated(result.jobId);
                    return;
                }
                if (!accepted && result.state === 'ready' && typeof result.summary === 'string' &&
                    typeof result.readToken === 'string' && modelJobIdPattern.test(result.readToken)) {
                    accepted = { summary: result.summary, readToken: result.readToken };
                    setRead(accepted);
                    setMessage('Accepted. Starting your model…');
                    continue;
                }
                if (!accepted && result.state === 'declined') {
                    setMessage('We could not use this portrait. Your model for this month is still available.');
                    return;
                }
                if (accepted || result.state !== 'pending')
                    throw new Error('We could not finish checking your portrait. You can retry.');
                if (Date.now() >= deadline)
                    throw new Error('Your portrait is still in line to be checked. Press Check portrait to keep waiting.');
                await new Promise<void>(resolve => {
                    const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
                    const timer = setTimeout(finish, 5000);
                    controller.signal.addEventListener('abort', finish, { once: true });
                });
                if (controller.signal.aborted) return;
            }
        } catch (error) {
            if (!controller.signal.aborted) setMessage(error instanceof Error && error.name === 'Error' ? error.message : 'Connection interrupted. You can retry.');
        } finally {
            active.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    }
    return <div>
        {read && <p>{read.summary}</p>}
        <p>
            We check your saved portrait first. This usually takes 2 to 6 minutes, longer when several players
            are making models, so keep this window open.
            If your portrait passes, your model starts right away.
        </p>
        <p>
            You get one model each month (UTC). If we can't use your portrait, you keep it.
            If something breaks on our side, you get it back. If you cancel, it still counts.
        </p>
        <p><small>Your portrait is sent to OpenAI and Modal to check it and build your model.</small></p>
        <button type="button" disabled={busy} onClick={() => void submit()}>{read ? 'Retry' : 'Check portrait'}</button>
        {message && <small role="status">{message}</small>}
        {elapsed > 0 && <small aria-hidden="true"> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</small>}
    </div>;
}
