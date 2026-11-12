import { useEffect, useRef, useState } from 'react';
import { modelJobIdPattern } from '../../../shared/avatar-model-job';

type Read = { summary: string; readToken: string };

/** Starts from the authenticated saved portrait. Only confirmation consumes the monthly slot. */
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
        setMessage(read ? 'Submitting your model request…' : 'Checking your portrait…');
        try {
            const headers = { 'Content-Type': 'application/json', 'x-player-name': name };
            const deadline = Date.now() + 12 * 60_000;
            for (;;) {
                const res = await fetch('/api/avatar-model/' + (read ? 'jobs' : 'read'), {
                    method: 'POST', headers, cache: 'no-store',
                    body: JSON.stringify(read ? { readToken: read.readToken, idempotencyKey: read.readToken } : {}),
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
                if (read && typeof result.jobId === 'string' && modelJobIdPattern.test(result.jobId)) {
                    onCreated(result.jobId);
                    return;
                }
                if (!read && result.state === 'ready' && typeof result.summary === 'string' &&
                    typeof result.readToken === 'string' && modelJobIdPattern.test(result.readToken)) {
                    setRead({ summary: result.summary, readToken: result.readToken });
                    setMessage('');
                    return;
                }
                if (!read && result.state === 'declined') {
                    setMessage('This portrait could not be used. Your monthly creation is still available.');
                    return;
                }
                if (read || result.state !== 'pending' || Date.now() >= deadline)
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
        {read ? <>
            <p>{read.summary}</p>
            <p>You can create one world model per calendar month in UTC. Automatic retries are included. A system failure returns the slot. Cancelling uses it.</p>
        </> : <p>
            Make Model sends your saved portrait to OpenAI and Modal for AI screening and processing.
            Checking the portrait leaves your monthly creation available.
        </p>}
        <button type="button" disabled={busy} onClick={() => void submit()}>{read ? 'Create model' : 'Check portrait'}</button>
        {message && <small role="status">{message}</small>}
    </div>;
}
