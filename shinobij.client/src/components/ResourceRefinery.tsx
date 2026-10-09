import { useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { RESOURCE_ITEMS } from '../../../shared/resource-items';
import { countOwnedItem } from '../lib/cafeteria';
import { resourceRequest } from '../lib/resource-api';
export function ResourceRefinery({ character, commit }: { character: Character; commit: VersionedCharacterCommit }) {
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), flight = useRef(false);
    async function refine(itemId: string) {
        if (flight.current) return; flight.current = true; setBusy(true); setMessage('');
        try {
            const result = await resourceRequest({ action: 'refine', playerName: character.name, itemId, quantity: 1 });
            if (result.character && !commit(result.character, result._saveVersion)) return;
            setMessage(result.ok ? 'Ore refined and added to your material stacks.' : result.error ?? 'Refining is unavailable.');
        } finally { flight.current = false; setBusy(false); }
    }
    const minerals = RESOURCE_ITEMS.filter(item => item.activity === 'mining' && item.grade > 0 && countOwnedItem(character, item.id) > 0);
    return <section className="outpost-refinery"><h2>Mineral refinery</h2><p>Keep pure ore for stronger weapons, or refine it into more common ingredient units. Fine yields 2, Superior 3, and Pristine 4. Refining cannot be reversed.</p>
        {minerals.length ? <div className="outpost-node-directory">{minerals.map(item => <article key={item.id}><strong>{item.name}</strong><span>Owned: {countOwnedItem(character, item.id)}</span><button type="button" disabled={busy} onClick={() => void refine(item.id)}>Refine 1 → {item.grade + 1} {RESOURCE_ITEMS.find(base => base.id === item.family)?.name}</button></article>)}</div>
            : <p className="resource-note">Bring back Fine, Superior or Pristine minerals to refine them here.</p>}
        {message && <p role="status">{message}</p>}
    </section>;
}
