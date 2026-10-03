import { useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { Profession } from '../types/core';
import {
    PROFESSION_CHANGE_APPROVAL_COST, PROFESSION_CHANGE_APPROVAL_ID, PROFESSION_CHANGE_APPROVAL_NAME,
    PROFESSION_CHANGE_LEVEL, PROFESSION_CHANGE_SCROLL_IMAGE, isProfession, professionChangeUnlockError,
} from '../../../shared/profession-change';
import { PROFESSION_INFO, PROFESSION_LABEL } from '../data/professions';
import { countItem } from '../lib/inventory';
import { activeElderFocus } from '../lib/village-elder-focus';
import { discountCost } from '../lib/village-upgrades';
import {
    clearProfessionChangeIntent, readProfessionChangeIntent, retainProfessionChangeIntent, type ProfessionChangeIntent,
} from '../lib/profession-change-intent';
import { GameIcon } from './icons/GameIcon';
import { Modal } from './ui/Modal';
import '../styles/village-transfer.css';

export function ProfessionChange({ character, onVersionedCharacter }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit;
}) {
    const [pending, setPending] = useState(() => readProfessionChangeIntent(character.name));
    const [open, setOpen] = useState(false);
    const [destination, setDestination] = useState<Profession | ''>(pending?.kind === 'change' ? pending.profession : '');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const busyRef = useRef(false);
    const intentRef = useRef(pending);
    const retryChange = pending?.kind === 'change';
    const retryPurchase = pending?.kind === 'purchase';
    const ownsScroll = countItem(character, PROFESSION_CHANGE_APPROVAL_ID) > 0;
    const unlockError = professionChangeUnlockError(character);
    const cost = discountCost(PROFESSION_CHANGE_APPROVAL_COST, activeElderFocus(character) === 'trade' ? 5 : 0);
    const fromProfession = pending?.kind === 'change' ? pending.fromProfession : character.profession;
    const choices = PROFESSION_INFO.filter(info => info.id !== fromProfession);

    async function act(action: 'purchase' | 'change') {
        if (busyRef.current || (intentRef.current && intentRef.current.kind !== action)) return;
        if (!intentRef.current && (unlockError || (action === 'change' && (!ownsScroll || !destination || destination === character.profession)))) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const intent: ProfessionChangeIntent = intentRef.current ?? (action === 'purchase'
                ? { kind: 'purchase', requestId: crypto.randomUUID() }
                : { kind: 'change', requestId: crypto.randomUUID(), fromProfession: character.profession!, fromProfessionChosenAt: character.professionChosenAt ?? null, profession: destination as Profession });
            intentRef.current = intent;
            retainProfessionChangeIntent(character.name, intent);
            setPending(intent);
            const body = intent.kind === 'purchase'
                ? { playerName: character.name, itemId: PROFESSION_CHANGE_APPROVAL_ID, qty: 1, requestId: intent.requestId }
                : { playerName: character.name, profession: intent.profession, fromProfession: intent.fromProfession, fromProfessionChosenAt: intent.fromProfessionChosenAt, respec: true };
            const response = await fetch(action === 'purchase' ? '/api/shop/purchase' : '/api/profession/choose', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                signal: AbortSignal.timeout(20_000),
            });
            const result = await response.json().catch(() => null) as { error?: string; character?: Character; _saveVersion?: number } | null;
            if (!response.ok || !result?.character) {
                const uncertain = response.status >= 500 || response.ok || [401, 408, 429].includes(response.status);
                if (!uncertain) {
                    clearProfessionChangeIntent(character.name);
                    intentRef.current = null;
                    setPending(null);
                }
                setError(result?.error || 'Could not confirm the action. Please retry.');
                return;
            }
            clearProfessionChangeIntent(character.name);
            intentRef.current = null;
            setPending(null);
            if (!onVersionedCharacter(result.character, result._saveVersion)) {
                setError('Your character has a newer update. Refresh to see the confirmed result.');
                return;
            }
            setDestination('');
            if (action === 'purchase') {
                setMessage('Scroll purchased. Choose your new profession when you are ready.');
                setOpen(true);
            } else {
                setMessage(`You are now a ${PROFESSION_LABEL[result.character.profession!]}. Your profession starts at Rank 1 with 0 XP.`);
                setOpen(false);
            }
        } catch {
            setError('Could not confirm the action. Retry to recover the same purchase or profession change.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return <section className="village-transfer profession-change" aria-labelledby="profession-change-title">
        <div className="village-transfer-heading">
            <img src={PROFESSION_CHANGE_SCROLL_IMAGE} alt="Profession Change Scroll" width={72} height={72} decoding="async" />
            <div>
                <p className="village-transfer-eyebrow">A new calling</p>
                <h3 id="profession-change-title">{PROFESSION_CHANGE_APPROVAL_NAME}</h3>
                <p>Start a new path as a Healer, Vanguard, or Pet Tamer.</p>
            </div>
        </div>
        <div className="village-transfer-requirements">
            <span>{character.level >= PROFESSION_CHANGE_LEVEL ? '✓' : '○'} Level {PROFESSION_CHANGE_LEVEL}</span>
            <span>{isProfession(character.profession) ? '✓' : '○'} Profession chosen</span>
            <strong><GameIcon name="shard" size={16} /> {cost} Fate Shards</strong>
        </div>
        <p className="hint">One scroll per change. Choose either of your other two professions and start at Rank 1 with 0 XP. Previous profession levels, XP, and mastery do not carry over. Your character level and XP stay the same.</p>
        <p className="hint">Current profession: <strong>{isProfession(character.profession) ? PROFESSION_LABEL[character.profession] : 'Not chosen'}</strong></p>
        {unlockError && <p className="hint">{unlockError}</p>}
        {!retryPurchase && (ownsScroll || retryChange) ? <button type="button" disabled={busy || (!retryChange && !!unlockError)} onClick={() => setOpen(true)}>
            {retryChange ? 'Resume profession change' : 'Use scroll · Choose profession'}
        </button> : <button type="button" disabled={busy || (!retryPurchase && (!!unlockError || character.fateShards < cost))} onClick={() => { void act('purchase'); }}>
            {busy ? 'Purchasing…' : retryPurchase ? 'Retry scroll purchase' : `Buy scroll · ${cost} Fate Shards`}
        </button>}
        {!ownsScroll && !pending && character.fateShards < cost && <p className="hint">You need {cost - character.fateShards} more Fate Shards.</p>}
        {message && <p role="status">{message}</p>}
        {error && !open && <p role="alert">{error}</p>}
        <Modal open={open} onClose={() => setOpen(false)} title="Choose your new profession" size="md" className="village-transfer-modal" disableBackdropClose={busy}>
            <div className="village-transfer-details">
                <p>Current profession: <strong>{fromProfession ? PROFESSION_LABEL[fromProfession] : 'Not chosen'}</strong>. Confirming consumes one {PROFESSION_CHANGE_APPROVAL_NAME}.</p>
                <fieldset className="village-transfer-destinations" disabled={busy || retryChange}>
                    <legend>New profession</legend>
                    {choices.map(info => <label key={info.id}>
                        <input type="radio" name="change-profession" value={info.id} checked={destination === info.id} onChange={() => setDestination(info.id)} />
                        <span><strong>{info.name}</strong><br /><small>{info.tagline}</small></span>
                    </label>)}
                </fieldset>
                <p className="hint">Your new profession begins at Rank 1 with 0 XP and no mastery. Your previous profession progress is lost, including if you switch back later. Your character level and XP are preserved.</p>
                {error && <p role="alert">{error}</p>}
            </div>
            <div className="village-transfer-actions">
                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" disabled={busy || (!retryChange && (!!unlockError || !destination || destination === character.profession || !ownsScroll))} onClick={() => { void act('change'); }}>
                    {busy ? 'Changing…' : retryChange ? 'Retry profession change' : destination ? `Become ${PROFESSION_LABEL[destination]}` : 'Select a profession'}
                </button>
            </div>
        </Modal>
    </section>;
}
