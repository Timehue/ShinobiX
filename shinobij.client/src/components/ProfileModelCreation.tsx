import { useEffect, useRef, useState } from 'react';
import { modelJobIdPattern } from '../../../shared/avatar-model-job';

type Read = { summary: string; readToken: string };

/** Starts from the authenticated saved portrait. An accepted portrait is submitted at once and uses the monthly slot. */
export function ProfileModelCreation({ name, onCreated }: { name: string; onCreated: (id: string) => void }) {
    const [read, setRead] = useState<Read | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const active = useRef<AbortController | null>(null);
    useEffect(() => () => active.current?.abort(), []);

    async function submit() {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        // A failed submission keeps its accepted check, so the retry goes straight to the job.
        let accepted = read;
        setMessage(accepted ? 'Starting your model…' : 'Checking your portrait…');
        try {
            const headers = { 'Content-Type': 'application/json', 'x-player-name': name };
            const deadline = Date.now() + 12 * 60_000;
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
                    if (res.status === 409 && result.error === 'quota') throw new Error('Your monthly creation is already in use. Reopen World model to see it.');
                    if (res.status === 429) throw new Error('The creation limit has been reached. Try again later.');
                    if (result.error === 'read-expired') throw new Error('Your portrait check expired or the portrait changed. Check it again.');
                    throw new Error('The server could not confirm the request. You can retry.');
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
                    setMessage('This portrait could not be used. Your monthly creation is still available.');
                    return;
                }
                if (accepted || result.state !== 'pending' || Date.now() >= deadline)
                    throw new Error('The portrait check could not be confirmed. You can retry.');
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
            Make Model sends your saved portrait to OpenAI and Modal for AI screening and processing.
            An accepted portrait starts your model right away and uses your creation for this calendar month (UTC).
            A declined portrait leaves it available. A system failure returns it. Cancelling uses it.
        </p>
        <button type="button" disabled={busy} onClick={() => void submit()}>{read ? 'Retry' : 'Check portrait'}</button>
        {message && <small role="status">{message}</small>}
    </div>;
}
