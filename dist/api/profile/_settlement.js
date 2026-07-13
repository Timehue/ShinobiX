"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROFILE_STAT_KEYS = exports.PROFILE_TITLE_MAX_LENGTH = exports.PROFILE_TITLE_ICON_COST = exports.PROFILE_TITLE_STYLE_COST = exports.PROFILE_TITLE_COST = exports.PROFILE_RESPEC_COST = void 0;
exports.applyProfileSettlement = applyProfileSettlement;
exports.parseProfileSettlementAction = parseProfileSettlementAction;
const _text_moderation_js_1 = require("../_text-moderation.js");
const _titles_registry_js_1 = require("../_titles-registry.js");
exports.PROFILE_RESPEC_COST = 50;
exports.PROFILE_TITLE_COST = 10;
exports.PROFILE_TITLE_STYLE_COST = 40;
exports.PROFILE_TITLE_ICON_COST = 25;
exports.PROFILE_TITLE_MAX_LENGTH = 15;
exports.PROFILE_STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense',
    'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
];
function storedWholeNumber(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function debitFateShards(character, cost) {
    const balance = storedWholeNumber(character.fateShards);
    if (balance === null)
        return { ok: false, status: 409, error: 'Stored Fate Shard balance is invalid. Contact support.' };
    if (balance < cost)
        return { ok: false, status: 409, error: `You need ${cost} Fate Shards.` };
    return { ok: true, character: { ...character, fateShards: balance - cost } };
}
function respecStats(character) {
    if (!character.stats || typeof character.stats !== 'object' || Array.isArray(character.stats)) {
        return { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' };
    }
    const stats = character.stats;
    let refund = 0;
    for (const key of exports.PROFILE_STAT_KEYS) {
        const value = storedWholeNumber(stats[key]);
        if (value === null)
            return { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' };
        refund += Math.max(0, value - 10);
    }
    if (refund === 0)
        return { ok: false, status: 400, error: 'Nothing to respec; all stats are already at base.' };
    const unspentStats = storedWholeNumber(character.unspentStats);
    if (unspentStats === null || !Number.isSafeInteger(unspentStats + refund)) {
        return { ok: false, status: 409, error: 'Stored unspent stats are invalid. Contact support.' };
    }
    const debit = debitFateShards(character, exports.PROFILE_RESPEC_COST);
    if (!debit.ok)
        return debit;
    const baseStats = Object.fromEntries(exports.PROFILE_STAT_KEYS.map((key) => [key, 10]));
    return {
        ok: true,
        changed: true,
        cost: exports.PROFILE_RESPEC_COST,
        action: 'respec-stats',
        character: { ...debit.character, stats: baseStats, unspentStats: unspentStats + refund },
    };
}
function purchaseTitle(character, titleRaw) {
    const title = String(titleRaw ?? '').trim().slice(0, exports.PROFILE_TITLE_MAX_LENGTH);
    if (!title)
        return { ok: false, status: 400, error: 'Enter a title first.' };
    if (!(0, _text_moderation_js_1.isAllowedCustomTitle)(title))
        return { ok: false, status: 400, error: 'That title is not allowed.' };
    if ((0, _titles_registry_js_1.isKnownEarnedTitle)(title)) {
        return { ok: false, status: 400, error: 'Earned titles must be equipped from your earned-title list.' };
    }
    if (character.customTitle === title) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title', character };
    }
    const debit = debitFateShards(character, exports.PROFILE_TITLE_COST);
    if (!debit.ok)
        return debit;
    return {
        ok: true,
        changed: true,
        cost: exports.PROFILE_TITLE_COST,
        action: 'purchase-title',
        character: { ...debit.character, customTitle: title },
    };
}
function purchaseTitleStyle(character, styleId) {
    if (!styleId || !_titles_registry_js_1.TITLE_STYLE_IDS.has(styleId))
        return { ok: false, status: 400, error: 'Unknown title style.' };
    if (character.customTitleStyle === styleId) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title-style', character };
    }
    const debit = debitFateShards(character, exports.PROFILE_TITLE_STYLE_COST);
    if (!debit.ok)
        return debit;
    return {
        ok: true,
        changed: true,
        cost: exports.PROFILE_TITLE_STYLE_COST,
        action: 'purchase-title-style',
        character: { ...debit.character, customTitleStyle: styleId },
    };
}
function purchaseTitleIcon(character, icon) {
    if (!icon || !_titles_registry_js_1.TITLE_ICON_SET.has(icon))
        return { ok: false, status: 400, error: 'Unknown title icon.' };
    if (character.customTitleIcon === icon) {
        return { ok: true, changed: false, cost: 0, action: 'purchase-title-icon', character };
    }
    const debit = debitFateShards(character, exports.PROFILE_TITLE_ICON_COST);
    if (!debit.ok)
        return debit;
    return {
        ok: true,
        changed: true,
        cost: exports.PROFILE_TITLE_ICON_COST,
        action: 'purchase-title-icon',
        character: { ...debit.character, customTitleIcon: icon },
    };
}
function applyProfileSettlement(character, action) {
    switch (action.type) {
        case 'respec-stats': return respecStats(character);
        case 'purchase-title': return purchaseTitle(character, action.title);
        case 'purchase-title-style': return purchaseTitleStyle(character, action.styleId);
        case 'purchase-title-icon': return purchaseTitleIcon(character, action.icon);
    }
}
function parseProfileSettlementAction(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const value = raw;
    switch (value.type) {
        case 'respec-stats': return { type: 'respec-stats' };
        case 'purchase-title': return typeof value.title === 'string' ? { type: value.type, title: value.title } : null;
        case 'purchase-title-style': return typeof value.styleId === 'string' ? { type: value.type, styleId: value.styleId } : null;
        case 'purchase-title-icon': return typeof value.icon === 'string' ? { type: value.type, icon: value.icon } : null;
        default: return null;
    }
}
