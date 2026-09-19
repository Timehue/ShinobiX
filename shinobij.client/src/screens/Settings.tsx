import { useEffect, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { ChangePasswordCard } from '../components/ChangePasswordCard';
import { ChangeAccountNameCard } from '../components/ChangeAccountNameCard';
import { RecoveryCodeCard } from '../components/RecoveryCodeCard';
import { GoogleLinkCard } from '../components/GoogleLinkCard';
import { AccountDeletionCard } from '../components/AccountDeletionCard';
import { getReaderMode, setReaderMode, type ReaderMode } from '../lib/reader-preference';
import { getAudioVolume, isAudioMuted, setAudioMuted, setAudioVolume, subscribeAudioMute } from '../lib/pet-music';
import { primeGameAudio } from '../lib/game-audio';
import '../styles/settings.css';

export function Settings({ character, onVersionedCharacter, onDelete }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; onDelete: () => Promise<void>;
}) {
    const [reader, setReader] = useState(getReaderMode);
    const [muted, setMuted] = useState(isAudioMuted);
    const [volume, setVolume] = useState(getAudioVolume);
    useEffect(() => subscribeAudioMute(() => { setMuted(isAudioMuted()); setVolume(getAudioVolume()); }), []);
    return <div className="settings-page card">
        <header><p className="settings-eyebrow">YOUR PREFERENCES</p><h1>Settings</h1><p>Make yourself at home. Manage sound, story presentation, and your account.</p></header>
        <section className="settings-section" aria-labelledby="presentation-heading">
            <h2 id="presentation-heading">Story presentation</h2>
            <label htmlFor="settings-reader">Visual novel reader</label>
            <select id="settings-reader" value={reader} onChange={e => { const mode = e.target.value as ReaderMode; setReader(mode); setReaderMode(mode); }}>
                <option value="cinematic">Cinematic (recommended)</option><option value="classic">Classic — simple reader</option>
            </select>
            <p className="hint">Cinematic brings scenes to life. Classic uses a compact layout. Your story progress and choices stay the same.</p>
        </section>
        <section className="settings-section" aria-labelledby="audio-heading">
            <h2 id="audio-heading">Audio</h2>
            <div className="settings-volume-label"><label htmlFor="settings-volume">Master volume</label><output htmlFor="settings-volume">{Math.round(volume * 100)}%</output></div>
            <input id="settings-volume" type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} onChange={e => setAudioVolume(Number(e.target.value) / 100)} />
            <label className="settings-check"><input type="checkbox" checked={muted} onChange={e => { setAudioMuted(e.target.checked); if (!e.target.checked) primeGameAudio(); }} />Mute all audio</label>
            <p className="hint">Controls music, story ambience, and sound effects. Reader and audio preferences are saved on this device.</p>
        </section>
        <section className="settings-section" aria-labelledby="account-heading">
            <h2 id="account-heading">Account &amp; sign-in</h2>
            <GoogleLinkCard playerName={character.name} />
            <ChangeAccountNameCard character={character} onVersionedCharacter={onVersionedCharacter} />
            <ChangePasswordCard playerName={character.name} />
            <RecoveryCodeCard playerName={character.name} />
        </section>
        <AccountDeletionCard playerName={character.name} onDelete={onDelete} />
    </div>;
}
