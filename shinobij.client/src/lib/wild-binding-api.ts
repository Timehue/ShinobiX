import type { Character } from '../types/character';
import type { Pet } from '../types/pet';
import type { ShowdownCommand, ShowdownStateView, ShowdownTurnResponse } from '../../../shared/pet-showdown-contract';

export type WildSealView = {
    id: string;
    name: string;
    resolveThreshold: number;
    captureBonus: number;
    count: number;
    available: boolean;
    opportunity: string;
};

export type WildBindingView = {
    name: string;
    rarity: string;
    trait?: string | null;
    traitHint?: string | null;
    hpPercent: number;
    resolvePercent: number;
    tutorial: boolean;
    loanerPet?: Pet;
    seals: WildSealView[];
};

export type WildBattleResponse = {
    ok: boolean;
    state: ShowdownStateView;
    wild: WildBindingView;
    events?: ShowdownTurnResponse['events'];
    capture?: {
        success: boolean;
        chance: number;
        sealId: string;
        replayed: boolean;
        pet: Pet | null;
        destination: 'roster' | 'sanctuary' | null;
    };
    character?: Character;
    _saveVersion?: number;
};

async function post(playerName: string, token: string, action: string, fields: Record<string, unknown> = {}):
    Promise<WildBattleResponse | { error: string }> {
    try {
        const response = await fetch('/api/pet/wild-binding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, token, action, ...fields }),
        });
        const data = await response.json().catch(() => null) as (WildBattleResponse & { error?: string }) | null;
        if (!response.ok || !data) return { error: data?.error ?? 'The wild encounter could not be reached.' };
        return data;
    } catch {
        return { error: 'The wild encounter could not be reached. Try again.' };
    }
}

export const startWildBattle = (playerName: string, token: string, petId: string) =>
    post(playerName, token, 'start', { petId });

export const readWildBattle = (playerName: string, token: string) =>
    post(playerName, token, 'state');

export const turnWildBattle = (playerName: string, token: string, commands: ShowdownCommand[], expectedRound: number) =>
    post(playerName, token, 'turn', { commands, expectedRound });

export const captureWildPet = (playerName: string, token: string, sealId: string, attemptId: string) =>
    post(playerName, token, 'capture', { sealId, attemptId });

export const forfeitWildBattle = (playerName: string, token: string) =>
    post(playerName, token, 'forfeit');
