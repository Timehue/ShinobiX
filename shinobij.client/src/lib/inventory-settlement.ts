import type { Character } from '../types/character';

export type WarCrateRewards = {
    ryo: number;
    honorSeals: number;
    boneCharms: number;
    relic: true;
    dungeonKey: boolean;
    equippableRelicId?: string;
    fateShards?: number;
};

export async function openWarCrate(playerName: string): Promise<
    { ok: true; character: Character; rewards: WarCrateRewards; _saveVersion?: number } | { ok: false; error: string }
> {
    try {
        const response = await fetch('/api/inventory/open-war-crate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName }),
        });
        const data = await response.json().catch(() => ({})) as {
            ok?: boolean;
            error?: string;
            character?: Character;
            rewards?: WarCrateRewards;
            _saveVersion?: number;
        };
        if (!response.ok || !data.ok || !data.character || !data.rewards) {
            return { ok: false, error: data.error || 'Could not open the war crate. Please retry.' };
        }
        return { ok: true, character: data.character, rewards: data.rewards, _saveVersion: data._saveVersion };
    } catch {
        return { ok: false, error: 'Could not open the war crate. Nothing was changed; please retry.' };
    }
}

export type HollowBeastCacheRewards = {
    ryo: number;
    boneCharms: number;
    materialId: string;
    dungeonKey: boolean;
};

export async function openHollowBeastCache(playerName: string, requestId: string): Promise<
    { ok: true; character: Character; rewards: HollowBeastCacheRewards; _saveVersion?: number } | { ok: false; error: string }
> {
    try {
        const response = await fetch('/api/inventory/open-hollow-beast-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, requestId }),
        });
        const data = await response.json().catch(() => ({})) as {
            ok?: boolean;
            error?: string;
            character?: Character;
            rewards?: HollowBeastCacheRewards;
            _saveVersion?: number;
        };
        if (!response.ok || !data.ok || !data.character || !data.rewards) {
            return { ok: false, error: data.error || 'Could not open the Hollow Beast Cache. Retry the same request.' };
        }
        return { ok: true, character: data.character, rewards: data.rewards, _saveVersion: data._saveVersion };
    } catch {
        return { ok: false, error: 'Could not confirm the Hollow Beast Cache opening. Retry the same request.' };
    }
}
