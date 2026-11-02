import { useContext, type ButtonHTMLAttributes } from 'react';
import { bindingLabel, type CombatAction } from '../lib/combat-hotkeys';
import { CombatBindingsContext } from '../lib/use-combat-hotkeys';
import '../styles/combat-hotkeys.css';

export function CombatHotkeyButton({ action, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { action?: CombatAction }) {
    const bindings = useContext(CombatBindingsContext);
    const key = action ? bindings[action] : '';
    return <button {...props} data-combat-action={action} aria-keyshortcuts={key ? key === 'escape' ? 'Escape' : bindingLabel(key) : undefined}>
        {children}{key && <kbd className="combat-hotkey-badge" aria-hidden="true">{bindingLabel(key)}</kbd>}
    </button>;
}
