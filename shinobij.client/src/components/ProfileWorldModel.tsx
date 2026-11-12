import { useEffect, useRef, useState } from 'react';
import { isPlayerModel, type PlayerModel } from '../lib/player-model';
import { readPlayerSaveSnapshot } from '../lib/save-api';
import { visiblePoll } from '../lib/poll';
import { recentModelRequest, rememberModelRequest, modelRequestOutcome } from '../lib/model-request-receipt';
import { useSectorModelArtBase, useWorldModelCreationAvailable } from '../lib/sector-obstacles';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { Modal } from './ui/Modal';
import { ProfileModelPreview } from './ProfileModelPreview';
import { ProfileModelCreation } from './ProfileModelCreation';
import { isPendingModelJob, isEndedModelJob, modelJobStages, modelMonthPattern as monthPattern,
    type PendingModelJob, type EndedModelJob } from '../../../shared/avatar-model-job';

type Owned = PlayerModel & { month: string };
const retryMessage = 'Could not check model progress. Retrying…';
function monthLabel(month: string) {
    return new Date(month + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function ProfileWorldModel({ character, canUploadAvatar, onVersionedCharacter }: {
    character: Character; canUploadAvatar: boolean; onVersionedCharacter: VersionedCharacterCommit;
}) {
    const enabled = useSectorModelArtBase();
    const creationEnabled = useWorldModelCreationAvailable();
    const equipped = isPlayerModel(character.playerModel) ? character.playerModel.assetId : '';
    const [view, setView] = useState<'create' | 'library' | null>(null);
    const open = view !== null;
    const [models, setModels] = useState<Owned[]>([]);
    const [pending, setPending] = useState<PendingModelJob | null>(null);
    const [ended, setEnded] = useState<EndedModelJob | null>(null);
    const [before, setBefore] = useState<string | null>(null);
    const [selected, select] = useState(equipped);
    const [busy, setBusy] = useState(false);
    const [creationAvailable, setCreationAvailable] = useState(false);
    const [message, setMessage] = useState('');
    const request = useRef<AbortController | null>(null);
    const opener = useRef<HTMLButtonElement>(null);
    useEffect(() => () => { request.current?.abort(); }, []);
    const jobId = pending?.id;
    const jobMonth = pending?.month;
    useEffect(() => {
        if (!open || !jobId || !jobMonth) return;
        const controller = new AbortController();
        const stop = visiblePoll(async () => {
            try {
                const res = await fetch('/api/avatar-model/jobs/' + jobId, {
                    headers: { 'x-player-name': character.name }, cache: 'no-store',
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
                });
                if (controller.signal.aborted) return;
                if (res.status === 404 || res.status === 401) {
                    setPending(null);
                    setMessage('Model request unavailable. Reopen your library to refresh it.');
                    return;
                }
                if (!res.ok) throw new Error();
                const job = await res.json();
                if (controller.signal.aborted) return;
                if (job.id !== jobId || job.month !== jobMonth) throw new Error();
                if (isPendingModelJob(job)) {
                    setPending(job);
                    setMessage(current => current === retryMessage ? '' : current);
                } else if (job.state === 'ready' && isPlayerModel(job.model)) {
                    const owned = { ...job.model, month: job.month };
                    setModels(current => [owned, ...current.filter(m => m.assetId !== owned.assetId)]);
                    setPending(null);
                    rememberModelRequest(character.name, null);
                    setMessage('Your new world model is ready to preview and equip.');
                    return;
                } else if (isEndedModelJob(job)) {
                    setPending(null);
                    setEnded(job);
                    setMessage('');
                    return;
                } else throw new Error();
            } catch {
                if (!controller.signal.aborted) setMessage(retryMessage);
            }
        }, 12_000, 0.1);
        return () => {
            stop();
            controller.abort();
        };
    }, [open, jobId, jobMonth, character.name]);
    if (!enabled && !equipped) return null;

    async function change(action: 'list' | 'older' | 'equip' | 'cancel') {
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setMessage('');
        try {
            const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
                headers: { 'x-player-name': character.name, 'Content-Type': 'application/json' }, cache: 'no-store' as const };
            if (action === 'cancel' && pending) {
                const res = await fetch('/api/avatar-model/jobs/' + pending.id + '/cancel', {...options, method:'POST'});
                if (!res.ok) throw new Error('Could not confirm cancellation. Check the request again.');
                setEnded({id:pending.id, month:pending.month, state:'cancelled', slot:'used'});
                setPending(null);
                return;
            }
            if (action === 'equip') {
                const res = await fetch('/api/avatar-model/equip?snapshot=1', {
                    ...options, method: 'POST', body: JSON.stringify({ assetId: selected || null }),
                });
                if (!res.ok) throw new Error(res.status === 404 ? 'That model is unavailable. Reopen the list to refresh it.' : 'Could not confirm the change. You can retry.');
                const save = await readPlayerSaveSnapshot<{ character: Character }>(await res.json(), character.name);
                if (controller.signal.aborted) return;
                if (!Number.isSafeInteger(save._saveVersion) || (save.character.playerModel?.assetId ?? '') !== selected || onVersionedCharacter(save.character, save._saveVersion) === false)
                    throw new Error('Your character changed. Reopen your profile to check the equipped model.');
                setMessage(selected ? 'World model equipped.' : 'Default character equipped.');
            } else {
                const search = new URLSearchParams();
                const recent = recentModelRequest(character.name);
                if (action === 'older' && before) search.set('before', before);
                else if (recent) search.set('recent', recent);
                const url = '/api/avatar-model/models' + (search.size ? '?' + search.toString() : '');
                const res = await fetch(url, options);
                if (!res.ok) throw new Error('Could not load your models. Reopen the list to try again.');
                const page = await res.json();
                if (!Array.isArray(page.models) || !page.models.every((m: Owned) => isPlayerModel(m) && monthPattern.test(m.month)) ||
                    !(page.before === null || typeof page.before === 'string' && monthPattern.test(page.before))) throw new Error('Could not read the model list.');
                if (controller.signal.aborted) return;
                if (page.pending !== undefined && !isPendingModelJob(page.pending)) throw new Error('Could not read model progress.');
                if (page.ended !== undefined && !isEndedModelJob(page.ended)) throw new Error('Could not read the model result.');
                if (action === 'list') {
                    setCreationAvailable(page.creationAvailable === true);
                    setEnded(page.ended ?? null);
                    rememberModelRequest(character.name, page.pending?.id ?? page.ended?.id ?? null);
                }
                if (action === 'list' || page.pending) setPending(page.pending ?? null);
                setModels(current => action === 'older' ? [...current, ...page.models.filter((m: Owned) =>
                    !current.some(existing => m.assetId === existing.assetId))] : page.models);
                setBefore(page.before);
            }
        } catch (error) {
            if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not reach the game server.');
        } finally {
            request.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    }
    function openPanel(next: 'create' | 'library', button: HTMLButtonElement) {
        opener.current = button;
        setView(next);
        if (request.current) return;
        select(equipped);
        setModels([]);
        setBefore(null);
        setPending(null);
        setEnded(null);
        setCreationAvailable(false);
        void change('list');
    }

    return <>
        {enabled && creationEnabled && canUploadAvatar &&
            <button type="button" className="sic-avatar-upload-button" aria-haspopup="dialog"
                onClick={event => openPanel('create', event.currentTarget)}>Make Model</button>}
        <button type="button" className="sic-avatar-upload-button" aria-haspopup="dialog"
            onClick={event => openPanel('library', event.currentTarget)}>World model</button>
        <Modal open={open} size="sm" title={view === 'create' ? 'Make Model' : 'World model'}
            onClose={() => setView(null)} returnFocusRef={opener}>
          {open && <div className="profile-model-controls">
            {pending && <small role="status">{monthLabel(pending.month)} model · {modelJobStages[pending.state]}</small>}
            {pending && <button type="button" disabled={busy} onClick={() => {
                if (window.confirm('Cancel this model? This month’s creation will stay used.')) void change('cancel');
            }}>Cancel model request</button>}
            {ended && <small role="status">{modelRequestOutcome(ended)}</small>}
            {view === 'create' && creationAvailable && !pending && <ProfileModelCreation name={character.name} onCreated={id => {
                rememberModelRequest(character.name, id);
                setCreationAvailable(false);
                setEnded(null);
                setView('library');
                void change('list');
            }} />}
            {view === 'create' && !creationAvailable && !pending && !busy && !message &&
                <p>Model creation is currently unavailable for this account.</p>}
            {view === 'library' && <>
            <label>World character
                <select value={selected} disabled={busy} onChange={event => select(event.target.value)}>
                    <option value="">Default character</option>
                    {equipped && !models.some(m => m.assetId === equipped) && <option value={equipped}>Current custom model</option>}
                    {models.map(m => <option key={m.assetId} value={m.assetId}>{monthLabel(m.month)}</option>)}
                </select>
            </label>
            {before && <button type="button" disabled={busy} onClick={() => void change('older')}>Load older models</button>}
            {enabled && (!selected || models.some(m => m.assetId === selected) || selected === equipped) &&
                <ProfileModelPreview key={selected} artBase={enabled} avatar={character.avatarImage || ''} starterWorldModel={character.starterWorldModel} model={
                    selected ? models.find(m => m.assetId === selected) ?? character.playerModel : undefined
                } />}
            <button type="button" disabled={busy || selected === equipped} onClick={() => void change('equip')}>Equip</button>
            </>}
            {(busy || message) && <small role="status">{busy ? 'Updating…' : message}</small>}
          </div>}
        </Modal>
    </>;
}
