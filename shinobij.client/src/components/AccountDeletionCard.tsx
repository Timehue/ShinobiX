import { useEffect, useRef, useState } from 'react';
import { gameConfirm } from './GameAlert';

type DeletionStatus = { name: string; requestedAt: number | null; availableAt: number | null; serverNow: number; ready: boolean };

export function AccountDeletionCard({ playerName, onDelete }: { playerName: string; onDelete: () => Promise<void> }) {
    const [status, setStatus] = useState<DeletionStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [remaining, setRemaining] = useState(0);
    const pending = useRef(false);
    const mounted = useRef(true);

    async function update(action?: 'request' | 'cancel', signal?: AbortSignal) {
        const response = await fetch('/api/player/account-deletion', action ? {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }), signal,
        } : { signal });
        const data = await response.json();
        if (!response.ok || !data.ok || data.name !== playerName.trim().toLowerCase()
            || !Number.isFinite(data.serverNow)) throw new Error(data.error || 'Could not verify this account. Please retry.');
        if (mounted.current && !signal?.aborted) { setRemaining(data.availableAt === null ? 0 : Math.max(0, data.availableAt - data.serverNow)); setStatus(data); setError(''); }
    }

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        void update(undefined, controller.signal).catch(() => {
            if (!controller.signal.aborted) setError('Could not load deletion status. Please retry.');
        });
        return () => { mounted.current = false; controller.abort(); };
        // The owning Settings screen is keyed by the canonical account name.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerName]);

    useEffect(() => {
        if (!status?.availableAt) return;
        const start = performance.now();
        const tick = () => setRemaining(Math.max(0, status.availableAt! - status.serverNow - (performance.now() - start)));
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [status]);

    async function act(action: 'request' | 'cancel' | 'delete' | 'retry') {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
            if (action === 'request' && !await gameConfirm('Start the 24-hour waiting period? You can cancel it in Settings. After the wait, return here to confirm permanent deletion.', { title: 'Request account deletion', confirmLabel: 'Start 24-hour wait', danger: true })) return;
            if (action === 'delete') { await onDelete(); if (mounted.current) await update(); }
            else await update(action === 'retry' ? undefined : action);
        } catch (err) {
            if (mounted.current) setError(err instanceof Error ? err.message : 'Could not confirm the request. Please retry.');
        } finally { pending.current = false; if (mounted.current) setBusy(false); }
    }

    const waiting = !!status?.availableAt && remaining > 0;
    const minutes = Math.ceil(remaining / 60_000);
    return <section className="settings-section settings-danger" aria-labelledby="deletion-heading">
        <h2 id="deletion-heading">Delete account</h2>
        <p>Deletion permanently removes your character, save, and sign-in details. Request it first, wait 24 hours, then return here to confirm. Nothing is deleted automatically.</p>
        {!status && !error && <p role="status">Checking deletion status…</p>}
        {status?.availableAt ? <>
            <p>{waiting ? `Waiting period: ${Math.floor(minutes / 60)}h ${minutes % 60}m remaining.` : 'The waiting period has ended. You can now confirm deletion.'}</p>
            <p className="hint">Available after {new Date(status.availableAt).toLocaleString()}. You can keep playing or cancel the request.</p>
            <div className="settings-actions">
                <button disabled={busy} onClick={() => void act('cancel')}>Cancel deletion request</button>
                <button className="danger-button" disabled={busy || waiting} onClick={() => void act('delete')}>Delete account permanently</button>
            </div>
        </> : status && <button className="danger-button" disabled={busy} onClick={() => void act('request')}>Request account deletion</button>}
        {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => void act('retry')}>Retry deletion status</button></div>}
    </section>;
}
