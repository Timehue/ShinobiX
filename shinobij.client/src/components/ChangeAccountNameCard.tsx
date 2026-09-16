import { useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { loadPlayerAccounts, savePlayerAccounts, accountKey } from '../lib/player-accounts';

export function ChangeAccountNameCard({ character, onVersionedCharacter }: { character: Character; onVersionedCharacter: VersionedCharacterCommit }) {
    const [next, setNext] = useState(character.accountName || character.name);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const [message, setMessage] = useState('');
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setMessage('');
        try {
            const response = await fetch('/api/player/account-name', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, accountName: next.trim() }),
                signal: AbortSignal.timeout(20000),
            });
            const result = await response.json() as { error?: string; character?: Character; _saveVersion?: number };
            if (!response.ok || !result.character || !Number.isFinite(result._saveVersion)) throw new Error(result.error || 'Could not confirm the name change.');
            if (onVersionedCharacter(result.character, result._saveVersion!) === false) throw new Error('Your account changed while saving. Refresh your profile to check the name.');
            const accounts = loadPlayerAccounts();
            const key = accountKey(character.name);
            accounts[key] = { ...accounts[key], accountName: result.character.accountName };
            savePlayerAccounts(accounts);
            setNext(result.character.accountName || result.character.name);
            setMessage(`Account name changed. Sign in with ${result.character.accountName}. Your password and progress stay the same.`);
        } catch (error) {
            setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Could not confirm the name change. Retry the same name to check it safely.');
        } finally { pending.current = false; setBusy(false); }
    }
    return <section className="change-password-card account-name-card" aria-labelledby="account-name-heading">
        <h3 id="account-name-heading">Change Account Name</h3>
        <p>This changes your public name and the name you use to log in. Your progress, clan and purchases stay with your account.</p>
        <form onSubmit={submit}>
            <label htmlFor="profile-account-name">Account name</label>
            <input id="profile-account-name" autoComplete="username" value={next} disabled={busy}
                onChange={(event) => setNext(event.target.value)} required minLength={3} maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{2,31}" aria-describedby="account-name-help" />
            <p id="account-name-help">3–32 letters, numbers, underscores or hyphens. After saving, use the new name to sign in.</p>
            <button type="submit" disabled={busy}>{busy ? 'Saving name…' : 'Save Account Name'}</button>
        </form>
        {message && <p role="status">{message}</p>}
    </section>;
}
