"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_CLASH = void 0;
exports.deriveClashStats = deriveClashStats;
exports.buildCreatorBaseMap = buildCreatorBaseMap;
exports.canonicalClashStats = canonicalClashStats;
// ── Built-in catalog (GENERATED — do not hand-edit) ──────────────────────────
// Regenerate with: node --import tsx scripts/_card-probe.ts  (then paste here).
// Guarded by _card-catalog.test.ts against the live client derivation.
exports.BUILTIN_CLASH = {
    'tc-01': { element: 'None', rarity: 'common', cost: 1, power: 2, ability: 'none' },
    'tc-02': { element: 'Wind', rarity: 'common', cost: 2, power: 3, ability: 'moveAfterReveal' },
    'tc-03': { element: 'Earth', rarity: 'common', cost: 2, power: 3, ability: 'protectSelf' },
    'tc-04': { element: 'Lightning', rarity: 'common', cost: 2, power: 3, ability: 'discountNextCard' },
    'tc-05': { element: 'Water', rarity: 'common', cost: 1, power: 3, ability: 'onRevealBuffAlliesHere' },
    'tc-06': { element: 'Neutral', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffSelf' },
    'tc-07': { element: 'Earth', rarity: 'common', cost: 1, power: 3, ability: 'protectSelf' },
    'tc-08': { element: 'Fire', rarity: 'common', cost: 2, power: 3, ability: 'onRevealDebuffEnemiesHere' },
    'tc-09': { element: 'Water', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffAlliesHere' },
    'tc-10': { element: 'Wind', rarity: 'common', cost: 2, power: 3, ability: 'moveAfterReveal' },
    'tc-11': { element: 'Neutral', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffSelf' },
    'tc-12': { element: 'Earth', rarity: 'common', cost: 2, power: 3, ability: 'protectSelf' },
    'tc-13': { element: 'Fire', rarity: 'common', cost: 2, power: 3, ability: 'summonClone' },
    'tc-14': { element: 'Lightning', rarity: 'common', cost: 2, power: 3, ability: 'discountNextCard' },
    'tc-15': { element: 'Water', rarity: 'common', cost: 2, power: 4, ability: 'protectSelf' },
    'tc-16': { element: 'Neutral', rarity: 'common', cost: 2, power: 3, ability: 'summonClone' },
    'tc-17': { element: 'Neutral', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffSelf' },
    'tc-18': { element: 'Wind', rarity: 'common', cost: 2, power: 3, ability: 'moveAfterReveal' },
    'tc-19': { element: 'Earth', rarity: 'common', cost: 2, power: 3, ability: 'protectSelf' },
    'tc-20': { element: 'Neutral', rarity: 'common', cost: 2, power: 4, ability: 'drawCard' },
    'tc-21': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-22': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-23': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffAlliesHere' },
    'tc-24': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-25': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-26': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-27': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffAlliesHere' },
    'tc-28': { element: 'Fire', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-29': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-30': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-31': { element: 'Wind', rarity: 'rare', cost: 3, power: 6, ability: 'moveAfterReveal' },
    'tc-32': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-33': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'drawCard' },
    'tc-34': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-35': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-36': { element: 'Wind', rarity: 'rare', cost: 3, power: 7, ability: 'moveAfterReveal' },
    'tc-37': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-38': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffAlliesHere' },
    'tc-39': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-40': { element: 'Neutral', rarity: 'rare', cost: 3, power: 7, ability: 'onRevealBuffSelf' },
    'tc-41': { element: 'Water', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffAlliesHere' },
    'tc-42': { element: 'Fire', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-43': { element: 'Earth', rarity: 'epic', cost: 4, power: 9, ability: 'protectSelf' },
    'tc-44': { element: 'Shadow', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-45': { element: 'Lightning', rarity: 'epic', cost: 4, power: 9, ability: 'discountNextCard' },
    'tc-46': { element: 'Water', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffAlliesHere' },
    'tc-47': { element: 'Earth', rarity: 'epic', cost: 4, power: 10, ability: 'protectSelf' },
    'tc-48': { element: 'Shadow', rarity: 'epic', cost: 4, power: 10, ability: 'onRevealDebuffEnemiesHere' },
    'tc-49': { element: 'Neutral', rarity: 'epic', cost: 4, power: 9, ability: 'summonClone' },
    'tc-50': { element: 'Fire', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-51': { element: 'Earth', rarity: 'common', cost: 2, power: 3, ability: 'summonClone' },
    'tc-52': { element: 'Lightning', rarity: 'common', cost: 2, power: 3, ability: 'discountNextCard' },
    'tc-53': { element: 'Water', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffAlliesHere' },
    'tc-54': { element: 'Fire', rarity: 'common', cost: 2, power: 3, ability: 'onRevealDebuffEnemiesHere' },
    'tc-55': { element: 'Wind', rarity: 'common', cost: 2, power: 3, ability: 'moveAfterReveal' },
    'tc-56': { element: 'Shadow', rarity: 'common', cost: 2, power: 4, ability: 'onRevealDebuffEnemiesHere' },
    'tc-57': { element: 'Ice', rarity: 'common', cost: 2, power: 3, ability: 'summonClone' },
    'tc-58': { element: 'Neutral', rarity: 'common', cost: 2, power: 3, ability: 'onRevealBuffSelf' },
    'tc-59': { element: 'None', rarity: 'common', cost: 2, power: 3, ability: 'none' },
    'tc-60': { element: 'Earth', rarity: 'common', cost: 2, power: 3, ability: 'protectSelf' },
    'tc-61': { element: 'Fire', rarity: 'common', cost: 2, power: 3, ability: 'onRevealDebuffEnemiesHere' },
    'tc-62': { element: 'Water', rarity: 'common', cost: 2, power: 4, ability: 'onRevealBuffAlliesHere' },
    'tc-63': { element: 'Lightning', rarity: 'common', cost: 2, power: 3, ability: 'discountNextCard' },
    'tc-64': { element: 'Wind', rarity: 'common', cost: 2, power: 4, ability: 'moveAfterReveal' },
    'tc-65': { element: 'Shadow', rarity: 'common', cost: 2, power: 4, ability: 'onRevealDebuffEnemiesHere' },
    'tc-66': { element: 'Ice', rarity: 'common', cost: 2, power: 4, ability: 'onRevealDebuffEnemiesHere' },
    'tc-67': { element: 'Neutral', rarity: 'common', cost: 2, power: 4, ability: 'onRevealBuffSelf' },
    'tc-68': { element: 'None', rarity: 'common', cost: 2, power: 3, ability: 'none' },
    'tc-69': { element: 'Earth', rarity: 'common', cost: 2, power: 4, ability: 'protectSelf' },
    'tc-70': { element: 'Fire', rarity: 'common', cost: 2, power: 3, ability: 'onRevealDebuffEnemiesHere' },
    'tc-71': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-72': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-73': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffAlliesHere' },
    'tc-74': { element: 'Fire', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-75': { element: 'Wind', rarity: 'rare', cost: 3, power: 6, ability: 'summonClone' },
    'tc-76': { element: 'Shadow', rarity: 'rare', cost: 3, power: 7, ability: 'onRevealDebuffEnemiesHere' },
    'tc-77': { element: 'Ice', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-78': { element: 'Neutral', rarity: 'rare', cost: 3, power: 6, ability: 'drawCard' },
    'tc-79': { element: 'None', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-80': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-81': { element: 'Lightning', rarity: 'rare', cost: 3, power: 7, ability: 'discountNextCard' },
    'tc-82': { element: 'Water', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffAlliesHere' },
    'tc-83': { element: 'Fire', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-84': { element: 'Wind', rarity: 'rare', cost: 3, power: 6, ability: 'moveAfterReveal' },
    'tc-85': { element: 'Shadow', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-86': { element: 'Ice', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-87': { element: 'Neutral', rarity: 'rare', cost: 3, power: 7, ability: 'drawCard' },
    'tc-88': { element: 'None', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealBuffSelf' },
    'tc-89': { element: 'Earth', rarity: 'rare', cost: 3, power: 6, ability: 'protectSelf' },
    'tc-90': { element: 'Lightning', rarity: 'rare', cost: 3, power: 6, ability: 'discountNextCard' },
    'tc-91': { element: 'Water', rarity: 'rare', cost: 3, power: 7, ability: 'onRevealBuffAlliesHere' },
    'tc-92': { element: 'Fire', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-93': { element: 'Wind', rarity: 'rare', cost: 3, power: 6, ability: 'moveAfterReveal' },
    'tc-94': { element: 'Shadow', rarity: 'rare', cost: 3, power: 7, ability: 'onRevealDebuffEnemiesHere' },
    'tc-95': { element: 'Ice', rarity: 'rare', cost: 3, power: 6, ability: 'onRevealDebuffEnemiesHere' },
    'tc-96': { element: 'Earth', rarity: 'epic', cost: 4, power: 9, ability: 'protectSelf' },
    'tc-97': { element: 'Lightning', rarity: 'epic', cost: 4, power: 9, ability: 'discountNextCard' },
    'tc-98': { element: 'Water', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffAlliesHere' },
    'tc-99': { element: 'Fire', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-100': { element: 'Wind', rarity: 'epic', cost: 4, power: 9, ability: 'moveAfterReveal' },
    'tc-101': { element: 'Shadow', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-102': { element: 'Ice', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-103': { element: 'Neutral', rarity: 'epic', cost: 4, power: 9, ability: 'drawCard' },
    'tc-104': { element: 'None', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffSelf' },
    'tc-105': { element: 'Earth', rarity: 'epic', cost: 4, power: 9, ability: 'protectSelf' },
    'tc-106': { element: 'Lightning', rarity: 'epic', cost: 4, power: 10, ability: 'discountNextCard' },
    'tc-107': { element: 'Water', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffAlliesHere' },
    'tc-108': { element: 'Fire', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-109': { element: 'Wind', rarity: 'epic', cost: 4, power: 9, ability: 'moveAfterReveal' },
    'tc-110': { element: 'Shadow', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-111': { element: 'Ice', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-112': { element: 'Neutral', rarity: 'epic', cost: 4, power: 9, ability: 'drawCard' },
    'tc-113': { element: 'None', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffSelf' },
    'tc-114': { element: 'Earth', rarity: 'epic', cost: 4, power: 9, ability: 'protectSelf' },
    'tc-115': { element: 'Lightning', rarity: 'epic', cost: 4, power: 9, ability: 'discountNextCard' },
    'tc-116': { element: 'Water', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealBuffAlliesHere' },
    'tc-117': { element: 'Fire', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-118': { element: 'Wind', rarity: 'epic', cost: 4, power: 9, ability: 'moveAfterReveal' },
    'tc-119': { element: 'Shadow', rarity: 'epic', cost: 4, power: 10, ability: 'onRevealDebuffEnemiesHere' },
    'tc-120': { element: 'Ice', rarity: 'epic', cost: 4, power: 9, ability: 'onRevealDebuffEnemiesHere' },
    'tc-121': { element: 'Earth', rarity: 'legendary', cost: 5, power: 11, ability: 'protectSelf' },
    'tc-122': { element: 'Lightning', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-123': { element: 'Water', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesEverywhere' },
    'tc-124': { element: 'Fire', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-125': { element: 'Wind', rarity: 'legendary', cost: 5, power: 11, ability: 'moveAfterReveal' },
    'tc-126': { element: 'Shadow', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-127': { element: 'Ice', rarity: 'legendary', cost: 5, power: 11, ability: 'protectSelf' },
    'tc-128': { element: 'Neutral', rarity: 'legendary', cost: 5, power: 11, ability: 'drawCard' },
    'tc-129': { element: 'None', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-130': { element: 'Earth', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-131': { element: 'Lightning', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesHere' },
    'tc-132': { element: 'Water', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesHere' },
    'tc-133': { element: 'Fire', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-134': { element: 'Wind', rarity: 'legendary', cost: 5, power: 11, ability: 'discountNextCard' },
    'tc-135': { element: 'Shadow', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-136': { element: 'Ice', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesHere' },
    'tc-137': { element: 'Neutral', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesEverywhere' },
    'tc-138': { element: 'None', rarity: 'legendary', cost: 5, power: 11, ability: 'drawCard' },
    'tc-139': { element: 'Earth', rarity: 'legendary', cost: 5, power: 11, ability: 'protectSelf' },
    'tc-140': { element: 'Lightning', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-141': { element: 'Water', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesEverywhere' },
    'tc-142': { element: 'Fire', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-143': { element: 'Wind', rarity: 'legendary', cost: 5, power: 11, ability: 'moveAfterReveal' },
    'tc-144': { element: 'Shadow', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-145': { element: 'Ice', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDebuffEnemiesHere' },
    'tc-146': { element: 'Neutral', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesEverywhere' },
    'tc-147': { element: 'None', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-148': { element: 'Shadow', rarity: 'legendary', cost: 4, power: 10, ability: 'onRevealDebuffEnemiesEverywhere' },
    'tc-149': { element: 'Fire', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealDoubleSelf' },
    'tc-150': { element: 'Water', rarity: 'legendary', cost: 5, power: 11, ability: 'onRevealBuffAlliesEverywhere' },
};
// ── Runtime derivation port (for CREATOR cards) ──────────────────────────────
// Faithful port of shinobij.client/src/lib/card-clash.ts deriveCardClashCard +
// its helpers. The drift test runs this over the full built-in catalog and
// asserts an exact match with the client, so any divergence fails CI.
// Hand-tuned legendary ability overrides — verbatim from card-clash.ts.
const LEGENDARY_ABILITY_OVERRIDES = {
    'tc-121': 'protectSelf', 'tc-122': 'onRevealDoubleSelf', 'tc-123': 'onRevealBuffAlliesEverywhere',
    'tc-124': 'onRevealDebuffEnemiesEverywhere', 'tc-125': 'moveAfterReveal', 'tc-126': 'onRevealDebuffEnemiesEverywhere',
    'tc-127': 'protectSelf', 'tc-128': 'drawCard', 'tc-129': 'onRevealDoubleSelf', 'tc-130': 'onRevealDebuffEnemiesEverywhere',
    'tc-131': 'onRevealDebuffEnemiesHere', 'tc-132': 'onRevealBuffAlliesHere', 'tc-133': 'onRevealDoubleSelf',
    'tc-134': 'discountNextCard', 'tc-135': 'onRevealDebuffEnemiesEverywhere', 'tc-136': 'onRevealDebuffEnemiesHere',
    'tc-137': 'onRevealBuffAlliesEverywhere', 'tc-138': 'drawCard', 'tc-139': 'protectSelf',
    'tc-140': 'onRevealDebuffEnemiesEverywhere', 'tc-141': 'onRevealBuffAlliesEverywhere', 'tc-142': 'onRevealDoubleSelf',
    'tc-143': 'moveAfterReveal', 'tc-144': 'onRevealDebuffEnemiesEverywhere', 'tc-145': 'onRevealDebuffEnemiesHere',
    'tc-146': 'onRevealBuffAlliesEverywhere', 'tc-147': 'onRevealDoubleSelf', 'tc-148': 'onRevealDebuffEnemiesEverywhere',
    'tc-149': 'onRevealDoubleSelf', 'tc-150': 'onRevealBuffAlliesEverywhere',
};
const cardAverage = (c) => (c.top + c.right + c.bottom + c.left) / 4;
const cardSpread = (c) => Math.max(c.top, c.right, c.bottom, c.left) - Math.min(c.top, c.right, c.bottom, c.left);
function deriveRole(card, spread) {
    const name = card.name.toLowerCase();
    if (name.includes('clone') || name.includes('spirit') || name.includes('wisp') || name.includes('summon'))
        return 'summoner';
    if (name.includes('guard') || name.includes('turtle') || name.includes('golem') || name.includes('behemoth') || name.includes('titan'))
        return 'defender';
    if (name.includes('spy') || name.includes('assassin') || name.includes('thief') || name.includes('stalker') || name.includes('reaper'))
        return 'assassin';
    if (name.includes('monk') || name.includes('sage') || name.includes('keeper') || name.includes('messenger'))
        return 'support';
    if (card.element === 'Ice' || card.element === 'Shadow')
        return 'control';
    if (spread >= 30)
        return 'fighter';
    return 'fighter';
}
function deriveAbility(card, role) {
    if (card.rarity === 'common' && card.element === 'None')
        return 'none';
    if (role === 'summoner')
        return 'summonClone';
    if (role === 'support' && card.element === 'Neutral')
        return 'drawCard';
    if (role === 'defender')
        return 'protectSelf';
    switch (card.element) {
        case 'Fire': return 'onRevealDebuffEnemiesHere';
        case 'Water': return 'onRevealBuffAlliesHere';
        case 'Earth': return 'protectSelf';
        case 'Wind': return 'moveAfterReveal';
        case 'Lightning': return 'discountNextCard';
        case 'Shadow': return 'onRevealDebuffEnemiesHere';
        case 'Ice': return 'onRevealDebuffEnemiesHere';
        case 'Neutral': return 'onRevealBuffSelf';
        case 'None':
        default: return 'onRevealBuffSelf';
    }
}
/** Port of deriveCardClashCard → the engine-facing canonical stats. */
function deriveClashStats(card) {
    const avg = cardAverage(card);
    const spread = cardSpread(card);
    let cost = 1;
    let power = Math.round(avg / 8);
    if (card.rarity === 'common')
        cost = avg < 24 ? 1 : avg < 32 ? 2 : 3;
    else if (card.rarity === 'rare')
        cost = avg < 45 ? 2 : avg < 56 ? 3 : 4;
    else if (card.rarity === 'epic')
        cost = avg < 68 ? 3 : avg < 78 ? 4 : 5;
    else
        cost = avg < 84 ? 4 : avg < 91 ? 5 : 6; // legendary
    cost = Math.max(1, Math.min(6, cost));
    power = Math.max(1, Math.min(12, power));
    const role = deriveRole(card, spread);
    const ability = LEGENDARY_ABILITY_OVERRIDES[card.id] ?? deriveAbility(card, role);
    return { element: card.element, rarity: card.rarity, cost, power, ability };
}
// Build an id→TileBase map from a save's top-level creatorCards array (admin-
// authored shared cards). Tolerant of malformed entries.
function buildCreatorBaseMap(creatorCards) {
    const map = new Map();
    if (!Array.isArray(creatorCards))
        return map;
    for (const c of creatorCards) {
        if (!c || typeof c !== 'object')
            continue;
        const o = c;
        const id = typeof o.id === 'string' ? o.id : '';
        if (!id)
            continue;
        map.set(id, {
            id,
            name: String(o.name ?? ''),
            element: String(o.element ?? 'None'),
            rarity: String(o.rarity ?? 'common'),
            top: Number(o.top) || 0, right: Number(o.right) || 0,
            bottom: Number(o.bottom) || 0, left: Number(o.left) || 0,
        });
    }
    return map;
}
/**
 * Resolve a card id to its canonical Clash stats — built-in from the generated
 * table, creator from its authoritative base stats. Returns null for an id that
 * is neither (not a real card → the handler rejects it for non-admins).
 */
function canonicalClashStats(id, creatorBaseById) {
    const builtin = exports.BUILTIN_CLASH[id];
    if (builtin)
        return builtin;
    const creator = creatorBaseById.get(id);
    if (creator)
        return deriveClashStats(creator);
    return null;
}
