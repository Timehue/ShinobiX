import { useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { GATHERING_TOOLS, gatheringTool, gatheringToolRemaining } from '../../../shared/gathering-tools';
import { resourceRequest } from '../lib/resource-api';
import './resource-gathering.css';

export function GatheringEquipment({ character, commit }: { character: Character; commit: VersionedCharacterCommit }) {
    const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), inFlight = useRef(false);
    async function equip(id: string, unequip: boolean) {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setMessage('');
        try {
            const result = await resourceRequest({ action: 'equip', playerName: character.name, itemId: id, unequip });
            if (result.character) commit(result.character, result._saveVersion);
            if (!result.ok) setMessage(result.error ?? 'Could not equip this tool.');
        } finally { inFlight.current = false; setBusy(false); }
    }
    return <section className="gathering-equipment" aria-label="Gathering equipment">
        <div className="resource-section-heading"><strong>Gathering tools</strong><span>Equipped separately from your battle loadout</span></div>
        <div className="gathering-tool-grid">{(['fishingPole', 'pickaxe'] as const).map(slot => {
            const equipped = gatheringTool(character.equipment[slot]);
            const remaining = equipped ? gatheringToolRemaining(character, equipped.id) : 0;
            const options = GATHERING_TOOLS.filter(tool => tool.slot === slot && character.inventory.includes(tool.id));
            return <article key={slot} className={`gathering-tool-slot${equipped ? ' equipped' : ''}`}>
                <img src={`/items/${equipped?.id ?? (slot === 'pickaxe' ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole')}.svg`} alt="" />
                <div><h3>{slot === 'pickaxe' ? 'Pickaxe' : 'Fishing Pole'}</h3><p>{equipped?.name ?? 'Empty slot'}</p>
                    {equipped && <p className={remaining !== null && remaining <= 5 ? 'resource-warning' : ''}>{remaining === null ? 'Permanent · never breaks' : `${remaining} / 50 uses remaining`}</p>}
                    {equipped && <button type="button" disabled={busy} onClick={() => void equip(equipped.id, true)}>Unequip {slot === 'pickaxe' ? 'pickaxe' : 'fishing pole'}</button>}
                    {options.map(tool => <button type="button" key={tool.id} disabled={busy || gatheringToolRemaining(character, tool.id) === 0} onClick={() => void equip(tool.id, false)}>Equip {tool.name}</button>)}
                    {!equipped && options.length === 0 && <small>Available at the Ryo Shop. Permanent gold tools are in the Grand Marketplace.</small>}
                </div>
            </article>;
        })}</div>
        {message && <p role="status">{message}</p>}
    </section>;
}
