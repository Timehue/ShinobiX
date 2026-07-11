import { isAllowedCustomTitle } from '../_text-moderation.js';
import {
    isKnownEarnedTitle,
    TITLE_ICON_SET,
    TITLE_STYLE_IDS,
} from '../_titles-registry.js';

export const PROFILE_RESPEC_COST = 50;
export const PROFILE_TITLE_COST = 10;
export const PROFILE_TITLE_STYLE_COST = 40;
export const PROFILE_TITLE_ICON_COST = 25;
export const PROFILE_TITLE_MAX_LENGTH = 15;

export const PROFILE_STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense',
    'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
] as const;

export type ProfileSettlementAction =
    | { type: 'respec-stats' }
    | { type: 'purchase-title'; title: string }
    | { type: 'purchase-title-style'; styleId: string }
    | { type: 'purchase-title-icon'; icon: string };

export type ProfileSettlementResult =
    | {
        ok: true;
        character: Record<string, unknown>;
        changed: boolean;
        cost: number;
        action: ProfileSettlementAction['type'];
    }
    | { ok: false; status: 400 | 409; error: string };

function storedWholeNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function debitFateShards(
    character: Record<string, unknown>,
    cost: number,
): { ok: true; character: Record<string, unknown> } | { ok: false; status: 409; error: string } {
    const balance = storedWholeNumber(character.fateShards);
    if (balance === null) return { ok: false, status: 409, error: 'Stored Fate Shard balance is invalid. Contact support.' };
    if (balance < cost) return { ok: false, status: 409, error: `You need ${cost} Fate Shards.` };
    return { ok: true, character: { ...character, fateShards: balance - cost } };
}

function respecStats(character: Record<string, unknown>): ProfileSettlementResult {
    if (!character.stats || typeof character.stats !== 'object' || Array.isArray(character.stats)) {
        return { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' };
    }
    const stats = character.stats as Record<string, unknown>;
    let refund = 0;
    for (const key of PROFILE_STAT_KEYS) {
        const value = storedWholeNumber(stats[key]);
        if (value === null) return { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' };
        refund += Math.max(0, value - 10);
    }
    if (refund === 0) return { ok: false, status: 400, error: 'Nothing to respec; all stats are already at base.' };

    const unspentStats = storedWholeNumber(character.unspentStats);
    if (unspentStats === null || !Number.isSafeInteger(unspentStats + refund)) {
        return { ok: false, status: 409, error: 'Stored unspent stats are invalid. Contact support.' };
    }
    const debit = debitFateShards(character, PROFILE_RESPEC_COST);
    if (!debit.ok) return debit;
    const baseStats = Object.fromEntries(PROFILE_STAT_KEYS.map((key) => [key, 10]));
    return {
        ok: true,
        changed: true,
        cost: PROFILE_RESPEC_COST,
        action: 'respec-stats',
        character: { ...debit.character, stats: baseStats, unspentStats: unspentStats + refund },
    };
}

function purchaseTitle(character: Record<string, unknown>, titleRaw: string): ProfileSettlementResult {
    const title = String(titleRaw ?? '').trim().slice(0, PROFILE_TITLE_MAX_LENGTH);
    if (!title) return { ok: false, status: 400, error: 'Enter a title first.' };
    if (!isAllowedCustomTitle(title)) return { ok: false, status: 400, error: 'That title is not allowed.' };
    if (isKnownEarnedTitle(title)) {
        return { ok: false, status: 400, error: 'Earned titles must be equipped from your earned-title list.' };
    }
    if (character.customTitle === title) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title', character };
    }
    const debit = debitFateShards(character, PROFILE_TITLE_COST);
    if (!debit.ok) return debit;
    return {
        ok: true,
        changed: true,
        cost: PROFILE_TITLE_COST,
        action: 'purchase-title',
        character: { ...debit.character, customTitle: title },
    };
}

function purchaseTitleStyle(character: Record<string, unknown>, styleId: string): ProfileSettlementResult {
    if (!styleId || !TITLE_STYLE_IDS.has(styleId)) return { ok: false, status: 400, error: 'Unknown title style.' };
    if (character.customTitleStyle === styleId) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title-style', character };
    }
    const debit = debitFateShards(character, PROFILE_TITLE_STYLE_COST);
    if (!debit.ok) return debit;
    return {
        ok: true,
        changed: true,
        cost: PROFILE_TITLE_STYLE_COST,
        action: 'purchase-title-style',
        character: { ...debit.character, customTitleStyle: styleId },
    };
}

function purchaseTitleIcon(character: Record<string, unknown>, icon: string): ProfileSettlementResult {
    if (!icon || !TITLE_ICON_SET.has(icon)) return { ok: false, status: 400, error: 'Unknown title icon.' };
    if (character.customTitleIcon === icon) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title-icon', character };
    }
    const debit = debitFateShards(character, PROFILE_TITLE_ICON_COST);
    if (!debit.ok) return debit;
    return {
        ok: true,
        changed: true,
        cost: PROFILE_TITLE_ICON_COST,
        action: 'purchase-title-icon',
        character: { ...debit.character, customTitleIcon: icon },
    };
}

export function applyProfileSettlement(
    character: Record<string, unknown>,
    action: ProfileSettlementAction,
): ProfileSettlementResult {
    switch (action.type) {
        case 'respec-stats': return respecStats(character);
        case 'purchase-title': return purchaseTitle(character, action.title);
        case 'purchase-title-style': return purchaseTitleStyle(character, action.styleId);
        case 'purchase-title-icon': return purchaseTitleIcon(character, action.icon);
    }
}

export function parseProfileSettlementAction(raw: unknown): ProfileSettlementAction | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    switch (value.type) {
        case 'respec-stats': return { type: 'respec-stats' };
        case 'purchase-title': return typeof value.title === 'string' ? { type: value.type, title: value.title } : null;
        case 'purchase-title-style': return typeof value.styleId === 'string' ? { type: value.type, styleId: value.styleId } : null;
        case 'purchase-title-icon': return typeof value.icon === 'string' ? { type: value.type, icon: value.icon } : null;
        default: return null;
    }
}
