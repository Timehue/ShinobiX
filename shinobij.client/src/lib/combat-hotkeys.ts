import { isLegacyJutsuId } from './legacy-jutsu-id';

export type CombatAction = 'attack' | 'move' | 'dash' | 'heal' | 'clear' | 'cleanse' | 'summon' | 'flee' | 'endTurn' | 'deselect' | 'weapon' | `jutsu${number}` | `item${number}`;
export const COMBAT_ACTIONS: readonly { id: CombatAction; label: string }[] = [
    ...Array.from({ length: 15 }, (_, i) => ({ id: `jutsu${i + 1}` as CombatAction, label: `Jutsu ${i + 1}` })),
    { id: 'weapon', label: 'Weapon' },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `item${i + 1}` as CombatAction, label: `Item ${i + 1}` })),
    ...(['attack', 'move', 'dash', 'heal', 'clear', 'cleanse', 'summon', 'flee', 'endTurn', 'deselect'] as const).map(id => ({ id, label: id === 'endTurn' ? 'End turn' : id[0].toUpperCase() + id.slice(1) })),
];
export type CombatBindings = Record<CombatAction, string>;
export const DEFAULT_COMBAT_BINDINGS = Object.fromEntries(COMBAT_ACTIONS.map(({ id }) => [id, ({ attack: 'a', move: 'm', heal: 'h', clear: 'c', cleanse: 'x', flee: 'f', endTurn: 'w', deselect: 'escape' } as Partial<CombatBindings>)[id] ?? ''])) as CombatBindings;
const namedKeys = new Set(['space', 'enter', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'backspace']);
export function validBinding(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const key = value.replace(/^shift\+/, '');
    return value === '' || value === 'escape' || (/^[a-z0-9,.;/[\]\\'`=-]$/.test(key) || namedKeys.has(key)) && value === (value.startsWith('shift+') ? `shift+${key}` : key);
}
export function normalizeBindings(raw: unknown): CombatBindings {
    const result = { ...DEFAULT_COMBAT_BINDINGS };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    for (const { id } of COMBAT_ACTIONS) {
        const value = (raw as Record<string, unknown>)[id];
        if (id !== 'deselect' && validBinding(value) && value !== 'escape') result[id] = value;
    }
    const used = new Set<string>();
    for (const { id } of COMBAT_ACTIONS) {
        if (result[id] && used.has(result[id])) result[id] = '';
        if (result[id]) used.add(result[id]);
    }
    result.deselect = 'escape';
    return result;
}
export function bindingConflict(bindings: CombatBindings, action: CombatAction, key: string) {
    return key ? COMBAT_ACTIONS.find(({ id }) => id !== action && bindings[id] === key) : undefined;
}
export function combatBindingKey(player: string) { return `combatHotkeys.v1:${encodeURIComponent(player.trim().toLowerCase())}`; }
const memory = new Map<string, CombatBindings>();
export function readCombatBindings(player: string): CombatBindings {
    const key = combatBindingKey(player);
    if (memory.has(key)) return { ...memory.get(key)! };
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? { ...DEFAULT_COMBAT_BINDINGS } : normalizeBindings(JSON.parse(raw));
    } catch { return { ...(memory.get(key) ?? DEFAULT_COMBAT_BINDINGS) }; }
}
export function saveCombatBindings(player: string, bindings: CombatBindings): void {
    const key = combatBindingKey(player), safe = normalizeBindings(bindings);
    try { localStorage.setItem(key, JSON.stringify(safe)); memory.delete(key); } catch { memory.set(key, safe); }
    window.dispatchEvent(new Event('combat-hotkeys-change'));
}
export function keyFromEvent(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat' | 'isComposing'>): string | null {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing) return null;
    const shifted: Record<string, string> = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
    const key = event.key === ' ' ? 'space' : event.shiftKey ? shifted[event.key] ?? event.key.toLowerCase() : event.key.toLowerCase();
    const binding = event.shiftKey ? `shift+${key}` : key;
    return validBinding(binding) && binding ? binding : null;
}
const keyLabels: Record<string, string> = { space: 'Space', escape: 'Esc', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', pageup: 'PageUp', pagedown: 'PageDown' };
export function bindingLabel(key: string): string { return key.split('+').map(part => keyLabels[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))).join('+'); }
export function jutsuHotkey(id: string | undefined, orderedIds: readonly string[]): CombatAction | undefined {
    const index = id ? orderedIds.indexOf(id) : -1;
    return index >= 0 && index < 15 ? `jutsu${index + 1}` : undefined;
}
/** Match the profile's resolved slots, using this fight's sealed preferences. */
export function combatJutsuSlotIds(sealedIds: unknown, jutsu: readonly { id?: string }[]): readonly string[] {
    const available = jutsu.map(entry => entry.id).filter((id): id is string => typeof id === 'string' && id.length > 0 && !isLegacyJutsuId(id));
    const availableIds = new Set(available);
    const requested = Array.isArray(sealedIds) && sealedIds.length > 0 ? sealedIds : available;
    // Deleted IDs and duplicates do not occupy numbered slots in the loadout UI.
    const preferred = requested.filter((id): id is string => typeof id === 'string' && availableIds.has(id));
    return [...new Set([...preferred, ...available])];
}
export function equipmentHotkey(id: string | undefined, raw: unknown): CombatAction | undefined {
    if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const equipment = raw as Record<string, unknown>;
    const slotId = (slot: string) => typeof equipment[slot] === 'string' && equipment[slot] ? equipment[slot] : undefined;
    if ((slotId('hand') ?? slotId('weapon')) === id) return 'weapon';
    const slots = [slotId('item1') ?? slotId('item'), slotId('item2'), slotId('item3'), slotId('potion')];
    const slot = slots.indexOf(id);
    return slot >= 0 ? `item${slot + 1}` : undefined;
}
