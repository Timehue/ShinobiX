import type { Character } from '../types/character';

export type CardPackType = 'standard' | 'epic' | 'legendary';

export interface CardPackResult {
    ok: boolean;
    error?: string;
    cards?: string[];
    currency?: 'ryo' | 'fateShards';
    cost?: number;
    balance?: number;
    character?: Character;
    _saveVersion?: number;
}

export async function openCardPack(playerName: string, packType: CardPackType): Promise<CardPackResult> {
    try {
        const response = await fetch('/api/card-clash/open-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, packType }),
        });
        const data = await response.json().catch(() => ({})) as CardPackResult;
        if (!response.ok || !data.ok || !data.character || !Array.isArray(data.cards)) {
            return { ok: false, error: data.error || 'Could not open the card pack.' };
        }
        return data;
    } catch {
        return { ok: false, error: 'Pack opening unconfirmed. Refresh before retrying.' };
    }
}
