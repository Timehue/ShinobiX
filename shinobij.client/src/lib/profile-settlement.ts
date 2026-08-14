import type { Character } from '../types/character';
import { AMBIGUOUS_ACTION_MESSAGE } from './ambiguous-action';

export type ProfileSettlementAction =
    | { type: 'respec-stats' }
    | { type: 'purchase-title'; title: string }
    | { type: 'purchase-title-style'; styleId: string }
    | { type: 'purchase-title-icon'; icon: string };

export async function settleProfileAction(
    playerName: string,
    action: ProfileSettlementAction,
): Promise<{ ok: true; character: Character; changed: boolean; cost: number; _saveVersion?: number } | { ok: false; error: string }> {
    try {
        const response = await fetch('/api/profile/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, action }),
        });
        const data = await response.json().catch(() => ({})) as {
            ok?: boolean;
            error?: string;
            character?: Character;
            changed?: boolean;
            cost?: number;
            _saveVersion?: number;
        };
        if (!response.ok || !data.ok || !data.character) {
            return { ok: false, error: data.error || AMBIGUOUS_ACTION_MESSAGE };
        }
        return { ok: true, character: data.character, changed: data.changed === true, cost: Number(data.cost ?? 0), _saveVersion: data._saveVersion };
    } catch {
        return { ok: false, error: AMBIGUOUS_ACTION_MESSAGE };
    }
}
