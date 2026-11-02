import { useState, type KeyboardEvent } from 'react';
import { COMBAT_ACTIONS, DEFAULT_COMBAT_BINDINGS, bindingConflict, bindingLabel, keyFromEvent, saveCombatBindings, type CombatAction, type CombatBindings } from '../lib/combat-hotkeys';
import { useCombatBindings } from '../lib/use-combat-hotkeys';

export function CombatHotkeySettings({ player }: { player: string }) {
    const bindings = useCombatBindings(player);
    const [capturing, setCapturing] = useState<CombatAction | null>(null);
    const [error, setError] = useState('');
    function commit(next: CombatBindings) { saveCombatBindings(player, next); setError(''); }
    function capture(event: KeyboardEvent<HTMLButtonElement>, action: CombatAction) {
        if (capturing !== action) return;
        if (event.key === 'Tab') { setCapturing(null); return; }
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { setCapturing(null); setError(''); return; }
        const key = keyFromEvent(event.nativeEvent);
        if (!key) { setError('Choose a letter, number, punctuation, navigation key, Space or Enter, optionally with Shift.'); return; }
        const conflict = bindingConflict(bindings, action, key);
        if (conflict) { setError(`${bindingLabel(key)} is already assigned to ${conflict.label}. Clear that binding first.`); return; }
        commit({ ...bindings, [action]: key }); setCapturing(null);
    }
    return <section className="settings-section" aria-labelledby="combat-hotkeys-heading">
        <h2 id="combat-hotkeys-heading">Combat hotkeys</h2>
        <p className="hint">Choose a control, then press a key. Shift combinations are supported. Saved for this player in this browser. Actions apply in combat modes that support them.</p>
        <div className="combat-hotkey-settings">
            {COMBAT_ACTIONS.map(({ id, label }) => <div className="combat-hotkey-setting" key={id}>
                <span id={`hotkey-label-${id}`}>{label}</span>
                <button type="button" aria-labelledby={`hotkey-label-${id} hotkey-value-${id}`} aria-pressed={capturing === id} disabled={id === 'deselect'}
                    onClick={event => { event.currentTarget.focus(); setCapturing(id); setError(''); }} onKeyDown={event => capture(event, id)} onBlur={() => { if (capturing === id) setCapturing(null); }}>
                    <span id={`hotkey-value-${id}`}>{capturing === id ? 'Press a key…' : bindings[id] ? bindingLabel(bindings[id]) : 'Unassigned'}</span>
                </button>
                <button type="button" aria-label={`Clear ${label} binding`} disabled={id === 'deselect' || !bindings[id]} onClick={() => { commit({ ...bindings, [id]: '' }); setCapturing(null); }}>Clear</button>
            </div>)}
        </div>
        <p className="hint">Items 1–3 match your combat item slots; Item 4 is your potion slot. Tab moves between controls; Escape cancels targeting or key capture. Hotkeys pause while typing or a dialog is open.</p>
        <p role="status" aria-live="polite">{error}</p>
        <button type="button" onClick={() => { commit({ ...DEFAULT_COMBAT_BINDINGS }); setCapturing(null); }}>Restore defaults</button>
    </section>;
}
